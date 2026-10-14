import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { ControlPlane } from "@workspace/control";
import { AgentRegistry } from "@workspace/registry";
import { createControlServer, type ControlServer } from "@workspace/server";
import { makeProject } from "./helpers.js";

function makeControl(): ControlPlane {
  const registry = new AgentRegistry({
    dataDir: `${process.env.TEMP ?? "/tmp"}/control-server-${Date.now()}-${Math.random()}`,
    whichFn: () => undefined,
  });
  return new ControlPlane({ registry });
}

interface WsMessage {
  id?: string | number | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

function openWs(url: string): Promise<{ ws: WebSocket; messages: () => WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const collected: WsMessage[] = [];
    ws.on("message", (data) => {
      try {
        collected.push(JSON.parse(String(data)) as WsMessage);
      } catch {
        /* ignore non-JSON */
      }
    });
    ws.on("open", () => resolve({ ws, messages: () => [...collected] }));
    ws.on("error", reject);
  });
}

function waitFor(server: ControlServer, predicate: () => boolean, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        reject(new Error("timed out waiting for condition"));
      }
    }, 10);
  });
}

describe("control server transport", () => {
  it("serves health and dispatches JSON-RPC over HTTP", async () => {
    const server = await createControlServer(makeControl(), { port: 0 });
    try {
      const health = (await fetch(`${server.httpUrl}/health`).then((r) => r.json())) as { ok: boolean };
      expect(health).toEqual({ ok: true });

      const listRes = (await fetch(`${server.httpUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "registry.listAgents", params: {} }),
      }).then((r) => r.json())) as WsMessage;
      expect(listRes.id).toBe(1);
      expect(listRes.result).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("returns a JSON-RPC error for unknown methods", async () => {
    const server = await createControlServer(makeControl(), { port: 0 });
    try {
      const res = (await fetch(`${server.httpUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "nope", params: {} }),
      }).then((r) => r.json())) as WsMessage;
      expect(res.error?.code).toBe(-32000);
      expect(res.error?.message).toContain("unknown method");
    } finally {
      await server.close();
    }
  });

  it("streams run events over WebSocket before the response", async () => {
    const { root, config, task, cleanup } = makeProject();
    const server = await createControlServer(makeControl(), { port: 0 });
    try {
      const { ws, messages } = await openWs(`${server.wsUrl}`);
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "run.startRun",
          params: { projectRoot: root, config, task, dryRun: true, allowUi: false },
        }),
      );

      await waitFor(server, () => messages().some((m) => m.id === 7));
      const all = messages();

      const response = all.find((m) => m.id === 7);
      expect(response?.result).toMatchObject({ status: "ready_for_review" });

      const notifications = all.filter((m) => m.method);
      const eventNames = notifications.map((m) => m.method);
      expect(eventNames).toContain("run_started");
      expect(eventNames).toContain("run_finished");
      expect(eventNames).not.toContain("run_waiting");

      ws.close();
    } finally {
      await server.close();
      cleanup();
    }
  });
});
