import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task, WorkflowConfig } from "@workspace/protocol";
import { Workflow, WorkflowError, loadJson } from "@workspace/core";
import { buildLegacyPipeline } from "@workspace/pipeline";
import type { AgentRegistry } from "@workspace/registry";

export interface ControlPlaneOptions {
  registry: AgentRegistry;
}

/**
 * Transport-agnostic control plane: dispatches JSON-RPC method names to the
 * agent registry and workflow engine, and forwards run events over an
 * `EventEmitter` so an HTTP/WebSocket (or Tauri IPC) transport can stream
 * real-time status to the UI.
 */
export class ControlPlane {
  readonly events = new EventEmitter();
  private readonly registry: AgentRegistry;

  constructor(opts: ControlPlaneOptions) {
    this.registry = opts.registry;
  }

  async handle(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "registry.listAgents":
        return this.registry.listAgents();
      case "registry.discoverAgents":
        return this.registry.discover();
      case "registry.connectAgent":
        return this.connectAgent(params);
      case "registry.disconnectAgent":
        return this.registry.disconnect(String(params.agentId));
      case "registry.getAgentHealth":
        return this.registry.getAgentHealth(String(params.agentId));
      case "run.startRun":
        return this.startRun(params);
      case "run.getRun":
        return this.getRun(params);
      case "run.getRunEvents":
        return this.getRunEvents(params);
      default:
        throw new WorkflowError(`unknown method: ${method}`);
    }
  }

  /** Explicit consent: discover the agent, then promote it into the registry. */
  private connectAgent(params: Record<string, unknown>): unknown {
    const agentId = String(params.agentId);
    const candidate = this.registry.discover().find((a) => a.agentId === agentId);
    if (!candidate) {
      throw new WorkflowError(`agent ${agentId} not found on this machine`);
    }
    return this.registry.consent(candidate);
  }

  private async startRun(params: Record<string, unknown>): Promise<unknown> {
    const projectRoot = String(params.projectRoot);
    const config = params.config as WorkflowConfig;
    const task = params.task as Task;
    const workflow = new Workflow(projectRoot, config, {
      onEvent: (event, data) => this.events.emit(event, data),
    });
    const steps = buildLegacyPipeline();
    const runDir = await workflow.execute(steps, task, {
      dryRun: Boolean(params.dryRun),
      allowUi: Boolean(params.allowUi),
    });
    const state = loadJson(join(runDir, "state.json")) as { status: string };
    return { runDir, status: state.status };
  }

  private getRun(params: Record<string, unknown>): unknown {
    return loadJson(join(String(params.runDir), "state.json"));
  }

  private getRunEvents(params: Record<string, unknown>): unknown {
    const path = join(String(params.runDir), "events.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  }
}
