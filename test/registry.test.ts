import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { AgentRegistry } from "@workspace/registry";
import type { Agent } from "@workspace/protocol";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "registry-"));
}

const claudeAgent: Agent = {
  id: "claude",
  name: "Claude Code",
  kind: "cli",
  capabilities: [],
  discover: { command: "claude" },
};

describe("AgentRegistry", () => {
  it("starts empty and discovers nothing when no agent is installed", () => {
    const dataDir = makeDataDir();
    try {
      const registry = new AgentRegistry({ dataDir, catalog: [], whichFn: () => undefined });
      expect(registry.listAgents()).toEqual([]);
      expect(registry.discover()).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("discovers installed agents without managing them", () => {
    const dataDir = makeDataDir();
    try {
      const registry = new AgentRegistry({
        dataDir,
        catalog: [claudeAgent],
        whichFn: (cmd) => (cmd === "claude" ? "C:/fake/claude.exe" : undefined),
      });
      const found = registry.discover();
      expect(found).toHaveLength(1);
      expect(found[0].agentId).toBe("claude");
      expect(found[0].lifecycle).toBe("discovered");
      expect(found[0].consentedAt).toBeUndefined();
      // discovery must NOT mutate the managed registry
      expect(registry.listAgents()).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("consent promotes an agent into the registry and persists it", () => {
    const dataDir = makeDataDir();
    try {
      const registry = new AgentRegistry({
        dataDir,
        catalog: [claudeAgent],
        whichFn: () => "C:/fake/claude.exe",
      });
      const [candidate] = registry.discover();
      const managed = registry.consent(candidate);

      expect(managed.lifecycle).toBe("connected");
      expect(managed.consentedAt).toBeDefined();
      expect(registry.listAgents().map((a) => a.agentId)).toEqual(["claude"]);

      // persists across a fresh instance
      const reloaded = new AgentRegistry({ dataDir, catalog: [claudeAgent], whichFn: () => undefined });
      expect(reloaded.listAgents().map((a) => a.agentId)).toEqual(["claude"]);
      expect(reloaded.listAgents()[0].lifecycle).toBe("connected");
      expect(reloaded.listAgents()[0].consentedAt).toBeDefined();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("refuses to consent an agent that is not pending consent", () => {
    const dataDir = makeDataDir();
    try {
      const registry = new AgentRegistry({
        dataDir,
        catalog: [claudeAgent],
        whichFn: () => "C:/fake/claude.exe",
      });
      const [candidate] = registry.discover();
      registry.consent(candidate);
      expect(() => registry.consent({ ...candidate, lifecycle: "connected" })).toThrow();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("disconnect stops a managed agent", () => {
    const dataDir = makeDataDir();
    try {
      const registry = new AgentRegistry({
        dataDir,
        catalog: [claudeAgent],
        whichFn: () => "C:/fake/claude.exe",
      });
      const [candidate] = registry.discover();
      registry.consent(candidate);
      expect(registry.disconnect("claude").lifecycle).toBe("stopped");
      expect(() => registry.disconnect("missing")).toThrow();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
