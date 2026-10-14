import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent, AgentInstance, AgentLifecycle } from "@workspace/protocol";
import { atomicWriteJson, canonicalJson, loadJson, redact, WorkflowError } from "@workspace/core";
import { DEFAULT_CATALOG } from "./catalog.js";
import { whichCommand } from "./which.js";

export interface RegistryOptions {
  dataDir: string;
  catalog?: Agent[];
  whichFn?: (command: string) => string | undefined;
}

interface RegistryStore {
  agents?: AgentInstance[];
}

/**
 * The managed-agent registry. Starts empty; `discover()` scans the local
 * machine and returns candidates with `lifecycle: "discovered"` WITHOUT adding
 * them to the registry. Only `consent()` — the explicit user approval step —
 * promotes an instance to `connected`, stamps `consentedAt`, and persists it.
 */
export class AgentRegistry {
  private readonly dataDir: string;
  private readonly catalog: Agent[];
  private readonly whichFn: (command: string) => string | undefined;
  private readonly instances: Map<string, AgentInstance>;

  constructor(opts: RegistryOptions) {
    this.dataDir = opts.dataDir;
    this.catalog = opts.catalog ?? DEFAULT_CATALOG;
    this.whichFn = opts.whichFn ?? whichCommand;
    this.instances = this.load();
  }

  private storePath(): string {
    return join(this.dataDir, "registry.json");
  }

  private load(): Map<string, AgentInstance> {
    const path = this.storePath();
    if (!existsSync(path)) return new Map();
    const store = (loadJson(path) ?? {}) as RegistryStore;
    const map = new Map<string, AgentInstance>();
    for (const instance of store.agents ?? []) {
      map.set(instance.agentId, instance);
    }
    return map;
  }

  private persist(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const agents = [...this.instances.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
    atomicWriteJson(this.storePath(), { agents });
  }

  private audit(event: string, data: Record<string, unknown>): void {
    mkdirSync(this.dataDir, { recursive: true });
    const record = { time: new Date().toISOString(), event, ...(redact(data) as Record<string, unknown>) };
    appendFileSync(join(this.dataDir, "audit.jsonl"), canonicalJson(record) + "\n", "utf8");
  }

  /** Managed (consented) agents, sorted by id. Empty until consent is granted. */
  listAgents(): AgentInstance[] {
    return [...this.instances.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  /** Scan the local machine for installed agents. Read-only; mutates nothing. */
  discover(): AgentInstance[] {
    const found: AgentInstance[] = [];
    for (const agent of this.catalog) {
      const endpoint = this.resolveEndpoint(agent);
      if (!endpoint) continue;
      found.push({
        agentId: agent.id,
        endpoint,
        lifecycle: "discovered",
        health: "ok",
        lastSeenAt: new Date().toISOString(),
      });
    }
    return found.sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  private resolveEndpoint(agent: Agent): string | undefined {
    if (agent.kind === "cli") {
      const command = String(agent.discover.command ?? "");
      if (!command) return undefined;
      return this.whichFn(command);
    }
    if (agent.kind === "mcp" || agent.kind === "windows-mcp") {
      const mcpConfig = String(agent.discover.mcp_config ?? "");
      if (!mcpConfig) return undefined;
      return existsSync(mcpConfig) ? mcpConfig : undefined;
    }
    return undefined;
  }

  /** Explicit user approval: promote a discovered instance into the registry. */
  consent(candidate: AgentInstance): AgentInstance {
    if (candidate.lifecycle !== "discovered") {
      throw new WorkflowError(`agent ${candidate.agentId} is not pending consent`);
    }
    const instance: AgentInstance = {
      ...candidate,
      lifecycle: "connected",
      consentedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this.instances.set(instance.agentId, instance);
    this.persist();
    this.audit("agent_consented", { agentId: instance.agentId, endpoint: instance.endpoint });
    return instance;
  }

  /** Stop managing an agent without deleting its consent record. */
  disconnect(agentId: string): AgentInstance {
    const existing = this.instances.get(agentId);
    if (!existing) {
      throw new WorkflowError(`agent ${agentId} is not managed`);
    }
    const instance: AgentInstance = { ...existing, lifecycle: "stopped" };
    this.instances.set(agentId, instance);
    this.persist();
    this.audit("agent_disconnected", { agentId });
    return instance;
  }

  getAgentHealth(agentId: string): { ok: boolean; endpoint?: string; lifecycle: AgentLifecycle } {
    const existing = this.instances.get(agentId);
    if (!existing) return { ok: false, lifecycle: "unknown" };
    return { ok: existsSync(existing.endpoint), endpoint: existing.endpoint, lifecycle: existing.lifecycle };
  }
}
