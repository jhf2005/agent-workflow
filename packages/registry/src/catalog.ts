import type { Agent } from "@workspace/protocol";

/**
 * Built-in catalog of agent types the app knows how to discover. Discovery is
 * purely local: a `cli` agent is found when its command is on PATH, an `mcp` /
 * `windows-mcp` agent when its config file exists. Plugins can extend this list.
 */
export const DEFAULT_CATALOG: Agent[] = [
  {
    id: "claude",
    name: "Claude Code",
    kind: "cli",
    capabilities: [{ id: "analyze" }, { id: "design" }, { id: "code" }, { id: "review" }],
    discover: { command: "claude" },
  },
  {
    id: "codex",
    name: "Codex",
    kind: "cli",
    capabilities: [{ id: "code" }],
    discover: { command: "codex" },
  },
  {
    id: "doubao",
    name: "豆包",
    kind: "cli",
    capabilities: [{ id: "ppt" }],
    discover: { command: "doubao" },
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    kind: "cli",
    capabilities: [{ id: "review" }],
    discover: { command: "workbuddy" },
  },
];
