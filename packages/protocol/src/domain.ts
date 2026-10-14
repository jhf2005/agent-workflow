/**
 * Domain model for the multi-agent workspace.
 *
 * The types below are the shared contract between the control plane (core),
 * the agent adapters, the workflow engine, and every UI surface (desktop /
 * web / mobile). They are intentionally transport-agnostic so the same model
 * backs a local single-machine install, a private deployment, or a cloud
 * control plane.
 */

/** How an agent is reached and driven. */
export type AgentKind = "cli" | "mcp" | "service" | "windows-mcp";

/**
 * Lifecycle state of a discovered agent instance.
 *
 * The registry starts empty. A local scan yields `discovered` instances that
 * are NOT yet managed; only after explicit user consent do they advance to
 * `connected` / `authenticated` and become part of the app's managed registry.
 */
export type AgentLifecycle = "unknown" | "discovered" | "connected" | "authenticated" | "running" | "stopped" | "error";

/** A capability an agent advertises, e.g. "code", "analyze", "design", "ppt", "review". */
export interface AgentCapability {
  id: string;
  version?: string;
  config?: Record<string, unknown>;
}

/** Static registration of an agent type (what it can do). */
export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  capabilities: AgentCapability[];
  /** How to locate the agent on this machine (command, mcp config path, url...). */
  discover: Record<string, unknown>;
}

/** A concrete, discovered instance of an agent on a machine. */
export interface AgentInstance {
  agentId: string;
  endpoint: string;
  lifecycle: AgentLifecycle;
  health: "ok" | "degraded" | "down";
  lastSeenAt?: string;
  /** ISO timestamp of when the user consented to manage this agent. Absent until consent. */
  consentedAt?: string;
  auth?: {
    scheme: "none" | "token" | "oauth" | "local";
    credentialRef?: string;
  };
}

/** A role bundles responsibilities with the capabilities required to fill it. */
export interface Role {
  id: string;
  name: string;
  responsibilities: string[];
  requiredCapabilities: string[];
  configProfile?: string;
}

/** A node in a workflow graph (DAG-capable). */
export interface NodeDefinition {
  id: string;
  type: "task" | "tool" | "gate" | "condition" | "parallel" | "human";
  agentRef?: string;
  roleRef?: string;
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
  /** Node ids this node depends on. */
  dependsOn?: string[];
}

/** A workflow is a directed graph of nodes. */
export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: NodeDefinition[];
  variables?: Record<string, unknown>;
  template?: string;
}

/** A single execution of a workflow. */
export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  steps: Record<string, unknown>;
}

export type RunStatus =
  | "created"
  | "running"
  | "complete"
  | "failed"
  | "ready_for_ppt"
  | "ready_for_review"
  | "waiting";

/** Append-only event emitted during a run; the replay data source. */
export interface RunEvent {
  time: string;
  event: string;
  [key: string]: unknown;
}

/** A versioned artifact produced by a run. */
export interface Artifact {
  id: string;
  runId: string;
  path: string;
  sha256: string;
  size: number;
}

/** An encrypted credential bound to an agent. */
export interface Credential {
  id: string;
  agentRef: string;
  /** Ciphertext; never stored or logged in plaintext. */
  encryptedBlob: string;
  scheme: string;
}

/* ------------------------------------------------------------------ */
/* Runtime configuration & task input (ported from the Python prototype) */
/* ------------------------------------------------------------------ */

export interface RetryConfig {
  attempts: number;
  base_seconds: number;
  max_seconds: number;
  jitter_seconds: number;
}

export interface QualityConfig {
  review_score: number;
  max_repair_cycles?: number;
}

export interface ToolConfig {
  command?: string;
  [key: string]: unknown;
}

export interface WorkflowConfig {
  run_root: string;
  allowed_project_roots: string[];
  process_timeout_seconds?: number;
  retry?: Partial<RetryConfig>;
  quality?: Partial<QualityConfig>;
  tools: Record<string, ToolConfig>;
}

export interface TaskFrontend {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface TaskCode {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface TaskPpt {
  enabled?: boolean;
  slides?: number;
  [key: string]: unknown;
}

export interface TaskWriting {
  enabled?: boolean;
  type?: string;
  [key: string]: unknown;
}

export interface Task {
  task_id?: string;
  goal: string;
  context?: string;
  target_dir?: string;
  constraints?: string[];
  acceptance_criteria?: string[];
  frontend?: TaskFrontend;
  code?: TaskCode;
  ppt?: TaskPpt;
  writing?: TaskWriting;
  [key: string]: unknown;
}
