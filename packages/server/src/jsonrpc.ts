/**
 * Minimal JSON-RPC 2.0 message helpers shared by the HTTP and WebSocket
 * transports. No framework — just the wire shape.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** A server-initiated event notification: no `id`, carries an event name. */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

/** Standard JSON-RPC 2.0 error codes. */
export const RpcError = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Application-level error (e.g. WorkflowError thrown by the control plane). */
  appError: -32000,
} as const;

export function parseRequest(text: string): JsonRpcRequest | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj === null || typeof obj !== "object" || obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
      return null;
    }
    return {
      jsonrpc: "2.0",
      id: (obj.id as string | number | null | undefined) ?? null,
      method: obj.method,
      params: (obj.params as Record<string, unknown> | undefined) ?? {},
    };
  } catch {
    return null;
  }
}

export function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function notification(method: string, params: Record<string, unknown>): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}
