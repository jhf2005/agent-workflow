import { describe, it, expect } from "vitest";
import { Workflow } from "@workspace/core";
import { FakeRunner, makeProject } from "./helpers.js";

describe("retry", () => {
  it("retries a failing command then succeeds", async () => {
    const { root, config, cleanup } = makeProject();
    try {
      const sleeps: number[] = [];
      const runner = new FakeRunner([
        { returncode: 1, stdout: "", stderr: "temporary" },
        { returncode: 0, stdout: "ok", stderr: "" },
      ]);
      const workflow = new Workflow(root, config, {
        runner,
        sleepFn: (seconds) => {
          sleeps.push(seconds);
          return Promise.resolve();
        },
        randomFn: () => 0,
      });

      const result = await workflow.invoke("demo", ["tool"], { cwd: root });

      expect(result.stdout).toBe("ok");
      expect(runner.calls.length).toBe(2);
      expect(sleeps).toEqual([1]);
    } finally {
      cleanup();
    }
  });
});
