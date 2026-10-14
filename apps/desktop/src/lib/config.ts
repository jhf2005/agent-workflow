/**
 * Client-side defaults for launching a run. A real app would persist a user
 * config (per-agent model/params/credentials), but the demo builds a handoff
 * config so a dry-run needs no installed agents or credentials.
 */

export function buildDemoConfig(projectRoot: string) {
  return {
    run_root: "runs",
    allowed_project_roots: [projectRoot],
    process_timeout_seconds: 900,
    retry: { attempts: 3, base_seconds: 1, max_seconds: 8, jitter_seconds: 0 },
    quality: { review_score: 80 },
    tools: {
      claude: { command: "claude" },
      codex: { command: "codex" },
      windows_mcp: { mcp_config: "" },
      doubao: { mode: "handoff", ui_client: "claude" },
      workbuddy: { mode: "handoff", ui_client: "claude" },
    },
  };
}

export function buildDemoTask(goal: string, targetDir: string) {
  return {
    task_id: `ui-${Date.now()}`,
    goal,
    target_dir: targetDir,
    frontend: { enabled: true },
    code: { enabled: true },
    ppt: { enabled: true, slides: 3 },
  };
}
