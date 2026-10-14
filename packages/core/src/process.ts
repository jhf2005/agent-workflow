import { spawn } from "node:child_process";
import { WorkflowError } from "./errors.js";

export interface ProcessResult {
  returncode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Run an external command with a per-command timeout, capturing stdout/stderr.
 * Args are passed as an array (no shell), mirroring the Python prototype's
 * `shell=False` posture to avoid injection.
 */
export class ProcessRunner {
  async run(args: string[], opts: RunOptions): Promise<ProcessResult> {
    const { cwd, env, timeout = 900 } = opts;
    const [command, ...rest] = args;
    return new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      const child = spawn(command, rest, {
        cwd,
        env: { ...process.env, ...env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new WorkflowError(`process timed out after ${timeout}s: ${command}`));
      }, timeout * 1000);

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ returncode: code ?? -1, stdout, stderr });
      });
    });
  }
}
