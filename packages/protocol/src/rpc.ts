/**
 * Protocol v1 — the versioned control-plane contract.
 *
 * The control plane (core) is exposed to every UI surface over a local
 * transport (HTTP + WebSocket, JSON-RPC 2.0 messages). This module pins the
 * method and event names so the protocol can evolve without breaking clients.
 */

export const PROTOCOL_VERSION = "1.0.0";

export const RPC_METHODS = {
  registry: {
    listAgents: "registry.listAgents",
    discoverAgents: "registry.discoverAgents",
    connectAgent: "registry.connectAgent",
    disconnectAgent: "registry.disconnectAgent",
    getAgentHealth: "registry.getAgentHealth",
    startAgent: "registry.startAgent",
    stopAgent: "registry.stopAgent",
  },
  workflow: {
    createWorkflow: "workflow.create",
    updateWorkflow: "workflow.update",
    deleteWorkflow: "workflow.delete",
    listWorkflows: "workflow.list",
    getWorkflow: "workflow.get",
    validateWorkflow: "workflow.validate",
  },
  run: {
    startRun: "run.start",
    pauseRun: "run.pause",
    resumeRun: "run.resume",
    cancelRun: "run.cancel",
    getRun: "run.get",
    listRuns: "run.list",
    getRunEvents: "run.events",
    replayRun: "run.replay",
  },
  tools: {
    listTools: "tools.list",
    callTool: "tools.call",
  },
  security: {
    listCredentials: "security.listCredentials",
    setCredential: "security.setCredential",
    deleteCredential: "security.deleteCredential",
    getAuditLog: "security.auditLog",
  },
  extensions: {
    listPlugins: "extensions.listPlugins",
    installPlugin: "extensions.installPlugin",
    listTemplates: "extensions.listTemplates",
    listSkills: "extensions.listSkills",
  },
} as const;

export const EVENT_TYPES = {
  runStarted: "run_started",
  runFinished: "run_finished",
  runWaiting: "run_waiting",
  stepStarted: "step_started",
  stepSucceeded: "step_succeeded",
  stepFailed: "step_failed",
  stepSkipped: "step_skipped",
  nodeStateChanged: "node.state_changed",
  audit: "audit",
} as const;
