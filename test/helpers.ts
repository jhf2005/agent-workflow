import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProcessResult } from "@workspace/core";
import type { Task, WorkflowConfig } from "@workspace/protocol";

export interface Project {
  root: string;
  config: WorkflowConfig;
  task: Task;
  cleanup: () => void;
}

/** Build a throwaway project root, a handoff-mode config, and a minimal task. */
export function makeProject(): Project {
  const root = mkdtempSync(join(tmpdir(), "agent-ws-"));
  const config: WorkflowConfig = {
    run_root: "runs",
    allowed_project_roots: [root],
    process_timeout_seconds: 5,
    retry: { attempts: 3, base_seconds: 1, max_seconds: 8, jitter_seconds: 0 },
    quality: { review_score: 80 },
    tools: {
      claude: { command: "claude" },
      codex: { command: "codex" },
      windows_mcp: { mcp_config: join(root, "mcp.json") },
      doubao: { mode: "handoff", ui_client: "claude" },
      workbuddy: { mode: "handoff", ui_client: "claude" },
    },
  };
  const task: Task = {
    task_id: "test",
    goal: "test workflow",
    target_dir: "generated",
    frontend: { enabled: true },
    code: { enabled: true },
    ppt: { enabled: true, slides: 3 },
  };
  return { root, config, task, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A ProcessRunner stand-in that records calls and replays scripted results. */
export class FakeRunner {
  calls: { args: string[]; cwd: string; env: Record<string, string>; timeout?: number }[] = [];
  private results: ProcessResult[];

  constructor(results: ProcessResult[] = []) {
    this.results = [...results];
  }

  async run(
    args: string[],
    opts: { cwd: string; env?: Record<string, string>; timeout?: number },
  ): Promise<ProcessResult> {
    this.calls.push({ args: [...args], cwd: opts.cwd, env: opts.env ?? {}, timeout: opts.timeout });
    const result = this.results.shift();
    if (!result) throw new Error("unexpected external process call");
    return result;
  }
}
