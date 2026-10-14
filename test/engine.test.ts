import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { Workflow, validatePptx, type Step, type StepRuntime } from "@workspace/core";
import { buildLegacyPipeline } from "@workspace/pipeline";
import { FakeRunner, makeProject } from "./helpers.js";

describe("workflow engine", () => {
  it("dry run creates artifacts without spawning processes", async () => {
    const { root, config, task, cleanup } = makeProject();
    try {
      const runner = new FakeRunner();
      const workflow = new Workflow(root, config, { runner, sleepFn: async () => {}, randomFn: () => 0 });
      const steps = buildLegacyPipeline();

      const runDir = await workflow.execute(steps, task, { dryRun: true, allowUi: false });
      const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));

      expect(state.status).toBe("ready_for_review");
      expect(state.steps.frontend_design.result.design.color_tokens.accent).toBe("#C9472D");
      expect(existsSync(join(runDir, "artifacts", "analysis.json"))).toBe(true);
      expect(existsSync(join(runDir, "artifacts", "design.json"))).toBe(true);
      expect(existsSync(join(runDir, "artifacts", "code_result.json"))).toBe(true);
      expect(validatePptx(join(runDir, "artifacts", "slides.pptx"), 3).slides).toBe(3);
      expect(existsSync(join(runDir, "artifacts", "workbuddy_review_request.md"))).toBe(true);
      expect(runner.calls).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("resume skips steps whose hash is unchanged", async () => {
    const { root, config, task, cleanup } = makeProject();
    try {
      const workflow = new Workflow(root, config, {
        runner: new FakeRunner(),
        sleepFn: async () => {},
        randomFn: () => 0,
      });
      const steps = buildLegacyPipeline();

      const runDir = await workflow.execute(steps, task, { dryRun: true, allowUi: false });
      await workflow.execute(steps, task, { dryRun: true, allowUi: false, runDir });

      const events = readFileSync(join(runDir, "events.jsonl"), "utf8");
      expect(events.split("step_skipped").length - 1).toBeGreaterThanOrEqual(5);
    } finally {
      cleanup();
    }
  });

  it("doubao windows_mcp mode requires --allow-ui", async () => {
    const { root, config, task, cleanup } = makeProject();
    try {
      config.tools.doubao = { mode: "windows_mcp", ui_client: "claude" };
      const workflow = new Workflow(root, config, {
        runner: new FakeRunner(),
        sleepFn: async () => {},
        randomFn: () => 0,
      });
      const steps = buildLegacyPipeline();
      const pptStep = steps.find((s) => s.name === "ppt") as Step;
      const runDir = join(root, "runs", "manual");
      mkdirSync(join(runDir, "artifacts"), { recursive: true });

      const ctx: StepRuntime = {
        task,
        results: { analysis: {}, frontend_design: {}, code: {} },
        config,
        runDir,
        projectRoot: root,
        dryRun: false,
        allowUi: false,
        invoke: async () => {
          throw new Error("should not invoke");
        },
        artifact: (name) => join(runDir, "artifacts", name),
      };

      await expect(pptStep.run(ctx)).rejects.toThrow(/--allow-ui/);
    } finally {
      cleanup();
    }
  });
});
