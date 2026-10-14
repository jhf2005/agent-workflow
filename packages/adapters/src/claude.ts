import { canonicalJson, ValidationError } from "@workspace/core";
import type { ProcessResult } from "@workspace/core";

/** Normalize a Claude Code `--output-format json` result into a plain object. */
export function parseAgentJson(stdout: string): Record<string, unknown> {
  const outer = JSON.parse(stdout);
  if (outer && typeof outer === "object") {
    const o = outer as Record<string, unknown>;
    if (o.structured_output && typeof o.structured_output === "object") {
      return o.structured_output as Record<string, unknown>;
    }
    if ("result" in o) {
      const r = o.result;
      if (r && typeof r === "object") return r as Record<string, unknown>;
      if (typeof r === "string") return JSON.parse(r);
    }
    return o;
  }
  throw new ValidationError("agent output is not a JSON object");
}

export interface ClaudeJsonOptions {
  model?: string;
  effort?: string;
  maxTurns?: string;
}

export function buildClaudeJsonArgs(
  command: string,
  prompt: string,
  schema: Record<string, unknown>,
  opts: ClaudeJsonOptions,
): string[] {
  return [
    command,
    "-p", prompt,
    "--model", opts.model ?? "opus",
    "--effort", opts.effort ?? "high",
    "--output-format", "json",
    "--json-schema", canonicalJson(schema),
    "--max-turns", opts.maxTurns ?? "2",
    "--tools", "",
    "--no-session-persistence",
  ];
}

export async function runClaudeJson(
  invoke: (name: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => Promise<ProcessResult>,
  name: string,
  command: string,
  prompt: string,
  schema: Record<string, unknown>,
  opts: ClaudeJsonOptions & { cwd: string; env?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const args = buildClaudeJsonArgs(command, prompt, schema, opts);
  const result = await invoke(name, args, { cwd: opts.cwd, env: opts.env });
  return parseAgentJson(result.stdout);
}
