import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ProcessResult } from "./process.js";
import type { Task, WorkflowConfig } from "@workspace/protocol";
import { ProcessRunner } from "./process.js";
import { RetryPolicy } from "./retry.js";
import { WorkflowError } from "./errors.js";
import { sha256, canonicalJson, loadJson } from "./json.js";
import { atomicWriteJson } from "./atomic.js";
import { resolveInside } from "./paths.js";
import { redact } from "./redact.js";

export interface StepOutcome {
  result: Record<string, unknown>;
  outputs: string[];
}

export interface StepInputs {
  task: Task;
  results: Record<string, unknown>;
}

export interface StepRuntime extends StepInputs {
  config: WorkflowConfig;
  runDir: string;
  projectRoot: string;
  dryRun: boolean;
  allowUi: boolean;
  invoke(name: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<ProcessResult>;
  artifact(name: string): string;
}

export interface Step {
  name: string;
  /** Values hashed for idempotency — only what this step actually depends on. */
  inputs: (ctx: StepInputs) => unknown;
  /** Optional gate: return false to skip the step entirely. */
  enabled?: (ctx: StepInputs) => boolean;
  /** Run-level status applied when this step returns `waiting: true`. */
  runStatus?: string;
  /**
   * When true, a `waiting: true` result is terminal: stop running further
   * steps but still write the manifest and emit `run_finished` with
   * `runStatus` (e.g. `ready_for_review`) instead of early-returning.
   */
  terminalWaiting?: boolean;
  /**
   * When set, the step's semantic `result` is persisted under this key (e.g.
   * `{"design": result}`) so the replay source is self-describing, while the
   * in-memory value passed to downstream steps stays the bare result. Mirrors
   * the Python prototype's per-step named-result wrappers.
   */
  resultKey?: string;
  run: (ctx: StepRuntime) => Promise<StepOutcome>;
}

interface StepState {
  status: string;
  input_hash: string;
  started_at: string;
  finished_at?: string;
  outputs?: string[];
  result?: unknown;
  error?: string;
  waiting?: boolean;
  runStatus?: string;
}

interface RunState {
  run_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  steps: Record<string, StepState>;
  manifest?: string;
}

function utcNow(): string {
  return new Date().toISOString();
}

function runIdStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Workflow {
  private readonly root: string;
  private readonly config: WorkflowConfig;
  private readonly runner: ProcessRunner;
  private readonly sleepFn: (seconds: number) => Promise<void>;
  private readonly randomFn: () => number;
  private readonly retry: RetryPolicy;
  private readonly timeout: number;
  private readonly runRoot: string;
  private readonly onEvent?: (event: string, data: Record<string, unknown>) => void;

  constructor(
    projectRoot: string,
    config: WorkflowConfig,
    opts: {
      runner?: ProcessRunner;
      sleepFn?: (seconds: number) => Promise<void>;
      randomFn?: () => number;
      onEvent?: (event: string, data: Record<string, unknown>) => void;
    } = {},
  ) {
    this.root = resolve(projectRoot);
    this.config = config;
    this.runner = opts.runner ?? new ProcessRunner();
    this.sleepFn = opts.sleepFn ?? ((s: number) => new Promise((r) => setTimeout(r, s * 1000)));
    this.randomFn = opts.randomFn ?? Math.random;
    this.onEvent = opts.onEvent;
    this.retry = new RetryPolicy(config.retry);
    this.timeout = config.process_timeout_seconds ?? 900;
    const runRootValue = config.run_root ?? "runs";
    const runRootPath = isAbsolute(runRootValue) ? runRootValue : join(this.root, runRootValue);
    this.runRoot = resolveInside(this.root, runRootPath);
    mkdirSync(this.runRoot, { recursive: true });
  }

  private event(runDir: string, eventName: string, data: Record<string, unknown>): void {
    const redacted = redact(data) as Record<string, unknown>;
    const record = { time: utcNow(), event: eventName, ...redacted };
    appendFileSync(join(runDir, "events.jsonl"), canonicalJson(record) + "\n", "utf8");
    this.onEvent?.(eventName, redacted);
  }

  private saveState(runDir: string, state: RunState): void {
    state.updated_at = utcNow();
    atomicWriteJson(join(runDir, "state.json"), state);
  }

  private artifact(runDir: string, name: string): string {
    return resolveInside(runDir, join(runDir, "artifacts", name));
  }

  async invoke(
    name: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<ProcessResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      try {
        const result = await this.runner.run(args, {
          cwd: opts.cwd ?? this.root,
          env: opts.env,
          timeout: this.timeout,
        });
        if (result.returncode === 0) {
          return result;
        }
        const message = redact(
          result.stderr.trim() || result.stdout.trim() || `exit ${result.returncode}`,
        ) as string;
        throw new WorkflowError(`${name} failed: ${message}`);
      } catch (err) {
        lastError = err;
        if (attempt >= this.retry.attempts) break;
        const delay = this.retry.delay(attempt, this.randomFn);
        await this.sleepFn(delay);
      }
    }
    throw new WorkflowError(`${name} failed after ${this.retry.attempts} attempts: ${String(lastError)}`);
  }

  private async runStep(
    runDir: string,
    state: RunState,
    name: string,
    inputs: unknown,
    runStatus: string | undefined,
    resultKey: string | undefined,
    action: () => Promise<StepOutcome>,
  ): Promise<StepOutcome> {
    const stepHash = sha256({ name, inputs, config: this.config });
    const previous = state.steps[name] ?? {};
    if (previous.status === "success" && previous.input_hash === stepHash) {
      const outputs = previous.outputs ?? [];
      if (outputs.every((p) => existsSync(p))) {
        this.event(runDir, "step_skipped", { step: name, reason: "idempotent_cache" });
        const stored = (previous.result as Record<string, unknown>) ?? {};
        const result = resultKey ? ((stored[resultKey] as Record<string, unknown>) ?? stored) : stored;
        return { result, outputs };
      }
    }

    state.steps[name] = { status: "running", input_hash: stepHash, started_at: utcNow() };
    this.saveState(runDir, state);
    this.event(runDir, "step_started", { step: name, input_hash: stepHash });

    try {
      const outcome = await action();
      const stored = resultKey ? { [resultKey]: outcome.result } : outcome.result;
      state.steps[name] = {
        status: "success",
        input_hash: stepHash,
        started_at: state.steps[name].started_at,
        finished_at: utcNow(),
        outputs: outcome.outputs,
        result: redact(stored),
        waiting: outcome.result.waiting === true,
        runStatus,
      };
      this.saveState(runDir, state);
      this.event(runDir, "step_succeeded", { step: name, outputs: outcome.outputs });
      return outcome;
    } catch (err) {
      state.steps[name] = {
        ...state.steps[name],
        status: "failed",
        finished_at: utcNow(),
        error: redact(String(err)) as string,
      };
      state.status = "failed";
      this.saveState(runDir, state);
      this.event(runDir, "step_failed", { step: name, error: String(err) });
      throw err;
    }
  }

  async execute(
    steps: Step[],
    task: Task,
    opts: { dryRun?: boolean; allowUi?: boolean; runDir?: string } = {},
  ): Promise<string> {
    const { dryRun = false, allowUi = false } = opts;
    let runDir: string;
    let state: RunState;

    if (opts.runDir === undefined) {
      const runId = `${runIdStamp()}-${sha256(task).slice(0, 8)}`;
      runDir = resolveInside(this.runRoot, join(this.runRoot, runId));
      mkdirSync(join(runDir, "artifacts"), { recursive: true });
      await atomicWriteJson(join(runDir, "task.json"), task);
      await atomicWriteJson(join(runDir, "config.snapshot.json"), redact(this.config));
      state = {
        run_id: runId,
        status: "created",
        created_at: utcNow(),
        updated_at: utcNow(),
        steps: {},
      };
    } else {
      runDir = resolveInside(this.runRoot, opts.runDir);
      state = loadJson(join(runDir, "state.json")) as RunState;
      task = loadJson(join(runDir, "task.json")) as Task;
    }

    state.status = "running";
    this.saveState(runDir, state);
    this.event(runDir, "run_started", { dry_run: dryRun, allow_ui: allowUi });

    const results: Record<string, unknown> = {};
    try {
      let terminalWaiting = false;
      for (const step of steps) {
        if (step.enabled && !step.enabled({ task, results })) {
          this.event(runDir, "step_skipped", { step: step.name, reason: "disabled" });
          continue;
        }
        const inputs = step.inputs({ task, results });
        const outcome = await this.runStep(runDir, state, step.name, inputs, step.runStatus, step.resultKey, () =>
          step.run({
            task,
            results,
            config: this.config,
            runDir,
            projectRoot: this.root,
            dryRun,
            allowUi,
            invoke: (n, a, o) => this.invoke(n, a, o),
            artifact: (n) => this.artifact(runDir, n),
          }),
        );
        if (outcome.result.waiting === true) {
          state.status = step.runStatus ?? "waiting";
          if (step.terminalWaiting === true) {
            terminalWaiting = true;
            break;
          }
          this.saveState(runDir, state);
          this.event(runDir, "run_waiting", { stage: step.name });
          return runDir;
        }
        results[step.name] = outcome.result;
      }

      if (!terminalWaiting) {
        state.status = "complete";
      }
      const manifest = {
        run_id: state.run_id,
        status: state.status,
        created_at: state.created_at,
        finished_at: utcNow(),
        task_sha256: sha256(task),
        artifacts: this.manifestArtifacts(runDir),
        steps: state.steps,
      };
      const manifestPath = this.artifact(runDir, "manifest.json");
      await atomicWriteJson(manifestPath, manifest);
      state.manifest = manifestPath;
      this.saveState(runDir, state);
      this.event(runDir, "run_finished", { status: state.status });
      return runDir;
    } catch (err) {
      state.status = "failed";
      this.saveState(runDir, state);
      throw err;
    }
  }

  private manifestArtifacts(runDir: string): Array<{ path: string; size: number; sha256: string }> {
    const dir = join(runDir, "artifacts");
    const result: Array<{ path: string; size: number; sha256: string }> = [];
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isFile()) {
        result.push({
          path: resolve(p),
          size: statSync(p).size,
          sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
        });
      }
    }
    return result;
  }

  async doctor(): Promise<{ ok: boolean; checks: Record<string, unknown> }> {
    const checks: Record<string, unknown> = {};
    for (const name of ["claude", "codex"] as const) {
      try {
        const command = String(this.config.tools[name]?.command ?? "").split(/\s+/)[0];
        const resolvedPath = existsSync(command) ? resolve(command) : undefined;
        checks[name] = { ok: Boolean(resolvedPath), command, resolved: resolvedPath };
      } catch (err) {
        checks[name] = { ok: false, error: String(err) };
      }
    }
    try {
      const mcpPath = String(this.config.tools.windows_mcp?.mcp_config ?? "");
      checks.windows_mcp = { ok: existsSync(mcpPath), mcp_config: mcpPath };
    } catch (err) {
      checks.windows_mcp = { ok: false, error: String(err) };
    }
    checks.doubao = {
      ok: true,
      mode: this.config.tools.doubao?.mode ?? "handoff",
      note: "handoff is valid when the app is unavailable",
    };
    checks.workbuddy = { ok: true, mode: this.config.tools.workbuddy?.mode ?? "handoff" };
    return { ok: Object.values(checks).every((c) => (c as { ok: boolean }).ok), checks };
  }
}
