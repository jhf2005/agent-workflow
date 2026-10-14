import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ControlPlane } from "@workspace/control";
import { WorkflowError } from "@workspace/core";
import {
  errorResponse,
  notification,
  parseRequest,
  RpcError,
  successResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./jsonrpc.js";

export interface ControlServerOptions {
  /** Bind address. Defaults to loopback-only for local desktop use. */
  host?: string;
  /** Port. 0 lets the OS pick an ephemeral port. */
  port?: number;
}

export interface ControlServer {
  port: number;
  /** HTTP JSON-RPC endpoint. */
  httpUrl: string;
  /** WebSocket streaming endpoint. */
  wsUrl: string;
  close(): Promise<void>;
}

/**
 * Events the engine emits that we forward to connected WebSocket clients as
 * JSON-RPC notifications (no `id`). Kept explicit so the transport stays a
 * dumb pipe and never guesses event names.
 */
const FORWARDED_EVENTS = [
  "run_started",
  "run_waiting",
  "run_finished",
  "step_started",
  "step_succeeded",
  "step_failed",
  "step_skipped",
] as const;

async function dispatch(control: ControlPlane, request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    const result = await control.handle(request.method, request.params);
    return successResponse(request.id ?? null, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof WorkflowError ? RpcError.appError : RpcError.internalError;
    return errorResponse(request.id ?? null, code, message);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Expose a `ControlPlane` over HTTP + WebSocket (JSON-RPC 2.0). The desktop
 * frontend POSTs `/rpc` for request/response calls and connects to `/ws` for
 * live run events, so the control plane stays transport-agnostic.
 */
export function createControlServer(
  control: ControlPlane,
  opts: ControlServerOptions = {},
): Promise<ControlServer> {
  const host = opts.host ?? "127.0.0.1";
  const clients = new Set<WebSocket>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/rpc") {
      const text = await readBody(req);
      const request = parseRequest(text);
      if (!request) {
        return sendJson(res, 200, errorResponse(null, RpcError.parseError, "Parse error"));
      }
      const response = await dispatch(control, request);
      return sendJson(res, 200, response);
    }
    return sendJson(res, 404, { error: "not found" });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("message", (data) => {
      const request = parseRequest(String(data));
      if (!request) {
        ws.send(JSON.stringify(errorResponse(null, RpcError.parseError, "Parse error")));
        return;
      }
      void dispatch(control, request).then((response) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
      });
    });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  for (const event of FORWARDED_EVENTS) {
    control.events.on(event, (data) => {
      const message = JSON.stringify(notification(event, data as Record<string, unknown>));
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });
  }

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : Number(opts.port ?? 0);
      resolve({
        port,
        httpUrl: `http://${host}:${port}`,
        wsUrl: `ws://${host}:${port}/ws`,
        close: () =>
          new Promise((res) => {
            for (const client of clients) client.terminate();
            wss.close();
            server.close(() => res());
          }),
      });
    });
  });
}
