export const WINDOWS_MCP_SAFETY =
  "Observe the current UI state before acting. Perform one small reversible action at a time, " +
  "then observe and validate the result. Never delete, replace, or overwrite user files. " +
  "Do not change accounts, payments, permissions, security settings, or system settings. " +
  "Save only to the unique output path explicitly provided. Stop if the UI is ambiguous.";

export function buildClaudeUiArgs(
  command: string,
  prompt: string,
  mcpConfig: string,
  uiModel = "sonnet",
): string[] {
  return [
    command,
    "-p", prompt,
    "--model", uiModel,
    "--effort", "low",
    "--output-format", "json",
    "--max-turns", "12",
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
}

export function buildCodexUiArgs(command: string, prompt: string, root: string): string[] {
  return [
    command,
    "--ask-for-approval", "never",
    "--sandbox", "read-only",
    "exec", "--skip-git-repo-check", "--ephemeral",
    "-C", root,
    prompt,
  ];
}
