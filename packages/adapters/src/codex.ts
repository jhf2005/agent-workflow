export interface CodexOptions {
  model?: string;
  reasoningEffort?: string;
  targetDir: string;
  outputSchemaPath: string;
  outputPath: string;
  addDir: string;
}

export function buildCodexArgs(command: string, prompt: string, opts: CodexOptions): string[] {
  return [
    command,
    "-m", opts.model ?? "gpt-5.5",
    "-c", `model_reasoning_effort="${opts.reasoningEffort ?? "high"}"`,
    "--ask-for-approval", "never",
    "--sandbox", "workspace-write",
    "--add-dir", opts.addDir,
    "exec", "--skip-git-repo-check", "--ephemeral",
    "-C", opts.targetDir,
    "--output-schema", opts.outputSchemaPath,
    "-o", opts.outputPath,
    prompt,
  ];
}
