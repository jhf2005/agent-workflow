/**
 * Browser-side client for the control-plane transport (HTTP JSON-RPC for
 * request/response, WebSocket for server-pushed run events). Self-contained —
 * no Node-only imports, so it bundles cleanly into the Tauri webview.
 */

export interface RpcErrorBody {
  code: number;
  message: string;
}

export interface AgentInstance {
  agentId: string;
  endpoint: string;
  lifecycle: string;
  health: string;
  lastSeenAt?: string;
  consentedAt?: string;
}

export interface RunEvent {
  time: string;
  event: string;
  [key: string]: unknown;
}

export interface StartRunResult {
  runDir: string;
  status: string;
}

export type EventHandler = (event: string, data: Record<string, unknown>) => void;

export class ControlClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<EventHandler>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: RpcErrorBody };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }

  connect(): void {
    if (this.ws) return;
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { method?: string; params?: Record<string, unknown> };
        if (msg.method) {
          for (const handler of this.handlers) handler(msg.method, msg.params ?? {});
        }
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
