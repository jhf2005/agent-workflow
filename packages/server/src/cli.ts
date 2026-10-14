import { join } from "node:path";
import { ControlPlane } from "@workspace/control";
import { AgentRegistry } from "@workspace/registry";
import { createControlServer } from "./server.js";

/**
 * Dev / sidecar entrypoint: stand up a control plane with a persistent
 * registry and expose it over HTTP + WebSocket. Run with `tsx` (see the root
 * `dev:server` script) or bundle this file as the Tauri sidecar.
 */
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), ".agent-workspace");

const registry = new AgentRegistry({ dataDir });
const control = new ControlPlane({ registry });
const server = await createControlServer(control, { host: "127.0.0.1", port });

console.log(`[control] data dir : ${dataDir}`);
console.log(`[control] http rpc : ${server.httpUrl}/rpc`);
console.log(`[control] websocket: ${server.wsUrl}`);
