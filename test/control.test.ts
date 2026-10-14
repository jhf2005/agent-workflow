import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { ControlPlane } from "@workspace/control";
import { AgentRegistry } from "@workspace/registry";
import { WorkflowError } from "@workspace/core";
import { makeProject } from "./helpers.js";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "control-"));
}

function makeRegistry(whichFn: (command: string) => string | undefined): AgentRegistry {
  return new AgentRegistry({ dataDir: makeDataDir(), whichFn });
}

describe("ControlPlane", () => {
  it("starts with an empty managed registry and discovers nothing without consent", async () => {
    const control = new ControlPlane({ registry: makeRegistry(() => undefined) });
    expect(await control.handle("registry.listAgents")).toEqual([]);
    expect(await control.handle("registry.discoverAgents")).toEqual([]);
  });

  it("discovers installed agents without managing them", async () => {
    const control = new ControlPlane({
      registry: makeRegistry((cmd) => (cmd === "claude" ? "C:/fake/claude.exe" : undefined)),
    });
    const found = (await control.handle("registry.discoverAgents")) as Array<{ agentId: string; lifecycle: string }>;
    expect(found).toHaveLength(1);
    expect(found[0].agentId).toBe("claude");
    expect(found[0].lifecycle).toBe("discovered");
    expect(await control.handle("registry.listAgents")).toEqual([]);
  });

  it("connectAgent consents a discovered agent", async () => {
    const control = new ControlPlane({
      registry: makeRegistry((cmd) => (cmd === "claude" ? "C:/fake/claude.exe" : undefined)),
    });
    const connected = (await control.handle("registry.connectAgent", {
      agentId: "claude",
    })) as { lifecycle: string; consentedAt?: string };
    expect(connected.lifecycle).toBe("connected");
    expect(connected.consentedAt).toBeDefined();
    expect(((await control.handle("registry.listAgents")) as Array<{ agentId: string }>).map((a) => a.agentId)).toEqual([
      "claude",
    ]);
  });

  it("connectAgent throws when the agent is not installed", async () => {
    const control = new ControlPlane({ registry: makeRegistry(() => undefined) });
    await expect(control.handle("registry.connectAgent", { agentId: "claude" })).rejects.toThrow(WorkflowError);
  });

  it("startRun dry-runs the pipeline and emits run_finished with ready_for_review", async () => {
    const { root, config, task, cleanup } = makeProject();
    try {
      const control = new ControlPlane({ registry: makeRegistry(() => undefined) });
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      for (const name of ["run_started", "step_started", "step_succeeded", "run_finished", "run_waiting"]) {
        control.events.on(name, (data) => events.push({ event: name, data: data as Record<string, unknown> }));
      }

      const result = (await control.handle("run.startRun", {
        projectRoot: root,
        config,
        task,
        dryRun: true,
        allowUi: false,
      })) as { runDir: string; status: string };

      expect(result.status).toBe("ready_for_review");
      expect(result.runDir).toContain(join(root, "runs"));

      const eventNames = events.map((e) => e.event);
      expect(eventNames).toContain("run_started");
      expect(eventNames).toContain("run_finished");
      expect(eventNames).not.toContain("run_waiting");

      const state = (await control.handle("run.getRun", { runDir: result.runDir })) as { status: string };
      expect(state.status).toBe("ready_for_review");

      const runEvents = (await control.handle("run.getRunEvents", { runDir: result.runDir })) as Array<{
        event: string;
      }>;
      expect(runEvents.length).toBeGreaterThan(0);
      expect(runEvents.some((e) => e.event === "run_finished")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("rejects unknown methods", async () => {
    const control = new ControlPlane({ registry: makeRegistry(() => undefined) });
    await expect(control.handle("nope")).rejects.toThrow(/unknown method/);
  });
});
