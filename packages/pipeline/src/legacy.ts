import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  atomicWriteText,
  createMinimalPptx,
  isRelativeTo,
  renderTemplate,
  validatePptx,
  validateSchema,
  WorkflowError,
  type Step,
} from "@workspace/core";
import {
  buildClaudeJsonArgs,
  buildClaudeUiArgs,
  buildCodexArgs,
  buildCodexUiArgs,
  parseAgentJson,
  WINDOWS_MCP_SAFETY,
} from "@workspace/adapters";
import type { Task, WorkflowConfig } from "@workspace/protocol";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "assets");

function loadSchemaFile(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(assets, "schemas", name), "utf8"));
}

function loadPromptFile(name: string): string {
  return readFileSync(join(assets, "prompts", name), "utf8");
}

const analysisSchema = loadSchemaFile("analysis.schema.json");
const designSchema = loadSchemaFile("design.schema.json");
const codeResultSchema = loadSchemaFile("code_result.schema.json");
const reviewSchema = loadSchemaFile("review.schema.json");

function tool(config: WorkflowConfig, name: string): Record<string, unknown> {
  return (config.tools[name] ?? {}) as Record<string, unknown>;
}

function resolveTargetDir(task: Task, projectRoot: string, config: WorkflowConfig): string {
  const candidateRaw = task.target_dir ? String(task.target_dir) : join(projectRoot, "generated_project");
  const candidate = isAbsolute(candidateRaw) ? candidateRaw : join(projectRoot, candidateRaw);
  const resolved = resolve(candidate);
  const allowed = config.allowed_project_roots ?? [projectRoot];
  const ok = allowed.some((root) => isRelativeTo(resolved, resolve(String(root))));
  if (!ok) {
    throw new WorkflowError(`target_dir is outside allowed_project_roots: ${resolved}`);
  }
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * The original Claude → Codex → Doubao → WorkBuddy pipeline, ported as a
 * loadable, resumable `Step[]` template. This proves the engine runs arbitrary
 * templates rather than a hardcoded sequence.
 */
export function buildLegacyPipeline(): Step[] {
  return [
    {
      name: "analysis",
      inputs: ({ task }) => task,
      resultKey: "analysis",
      async run(ctx) {
        const output = ctx.artifact("analysis.json");
        let data: Record<string, unknown>;
        if (ctx.dryRun) {
          data = {
            summary: "Dry-run analysis",
            assumptions: [],
            requirements: [String(ctx.task.goal ?? "example goal")],
            architecture_decisions: ["Use JSON contracts and resumable steps"],
            execution_plan: ["analyze", "design", "code", "ppt", "review"],
            acceptance_criteria: ["All enabled gates pass"],
            risks: ["GUI adapters require explicit approval"],
          };
        } else {
          const claude = tool(ctx.config, "claude");
          const prompt = renderTemplate(loadPromptFile("analysis.md"), { TASK_JSON: ctx.task });
          const args = buildClaudeJsonArgs(String(claude.command ?? ""), prompt, analysisSchema, {
            model: String(claude.analysis_model ?? "opus"),
            effort: String(claude.analysis_effort ?? "high"),
          });
          const result = await ctx.invoke("claude_analysis", args, {
            cwd: ctx.projectRoot,
            env: claude.env as Record<string, string>,
          });
          data = parseAgentJson(result.stdout);
        }
        validateSchema(data, analysisSchema);
        await atomicWriteJson(output, data);
        return { result: data, outputs: [output] };
      },
    },
    {
      name: "frontend_design",
      inputs: ({ task, results }) => ({ task, analysis: results.analysis }),
      enabled: ({ task }) => task.frontend?.enabled === true,
      resultKey: "design",
      async run(ctx) {
        const output = ctx.artifact("design.json");
        let data: Record<string, unknown>;
        if (ctx.dryRun) {
          data = {
            model: "claude-opus",
            concept: "Precision workshop",
            visual_direction: "Editorial industrial interface with strong hierarchy",
            typography: ["Distinctive display serif", "Humanist sans body"],
            color_tokens: { canvas: "#F7F4EC", ink: "#17202A", accent: "#C9472D" },
            layout_rules: ["Asymmetric 12-column grid", "Generous negative space"],
            interaction_rules: ["One staged entrance", "Visible keyboard focus"],
            responsive_rules: ["Collapse to one column below 720px"],
            accessibility_rules: ["WCAG AA contrast", "Reduced-motion fallback"],
            anti_patterns: ["No purple gradient", "No Inter/Arial", "No generic card grid"],
            codex_prompt: "Build a production-ready interface using the supplied precision-workshop direction.",
            acceptance_checks: ["Responsive", "Keyboard accessible", "No generic AI styling"],
          };
        } else {
          const claude = tool(ctx.config, "claude");
          const prompt = renderTemplate(loadPromptFile("frontend_design.md"), {
            TASK_JSON: ctx.task,
            ANALYSIS_JSON: ctx.results.analysis,
          });
          const args = buildClaudeJsonArgs(String(claude.command ?? ""), prompt, designSchema, {
            model: String(claude.design_model ?? "opus"),
            effort: String(claude.design_effort ?? "high"),
          });
          const result = await ctx.invoke("claude_design", args, {
            cwd: ctx.projectRoot,
            env: claude.env as Record<string, string>,
          });
          data = parseAgentJson(result.stdout);
        }
        validateSchema(data, designSchema);
        await atomicWriteJson(output, data);
        return { result: data, outputs: [output] };
      },
    },
    {
      name: "code",
      inputs: ({ task, results }) => ({ task, analysis: results.analysis, design: results.frontend_design }),
      enabled: ({ task }) => task.code?.enabled !== false,
      resultKey: "code_result",
      async run(ctx) {
        const output = ctx.artifact("code_result.json");
        let data: Record<string, unknown>;
        if (ctx.dryRun) {
          data = {
            status: "success",
            summary: "Dry-run code result",
            changed_files: [],
            validation_commands: [],
            warnings: [],
          };
        } else {
          const target = resolveTargetDir(ctx.task, ctx.projectRoot, ctx.config);
          const codex = tool(ctx.config, "codex");
          const prompt = renderTemplate(loadPromptFile("codex_implementation.md"), {
            TASK_JSON: ctx.task,
            ANALYSIS_JSON: ctx.results.analysis,
            DESIGN_JSON: ctx.results.frontend_design ?? {},
          });
          const args = buildCodexArgs(String(codex.command ?? ""), prompt, {
            model: String(codex.model ?? "gpt-5.5"),
            reasoningEffort: String(codex.reasoning_effort ?? "high"),
            targetDir: target,
            addDir: dirname(output),
            outputSchemaPath: join(assets, "schemas", "code_result.schema.json"),
            outputPath: output,
          });
          const result = await ctx.invoke("codex_code", args, {
            cwd: target,
            env: codex.env as Record<string, string>,
          });
          if (!existsSync(output)) {
            try {
              data = JSON.parse(result.stdout);
            } catch {
              throw new WorkflowError("Codex did not produce code_result.json");
            }
          } else {
            data = JSON.parse(readFileSync(output, "utf8"));
          }
        }
        validateSchema(data, codeResultSchema);
        if (data.status !== "success") {
          throw new WorkflowError("Codex code result status is not success");
        }
        await atomicWriteJson(output, data);
        return { result: data, outputs: [output] };
      },
    },
    {
      name: "ppt",
      inputs: ({ task, results }) => ({
        task,
        analysis: results.analysis,
        design: results.frontend_design,
        code_result: results.code,
      }),
      runStatus: "ready_for_ppt",
      async run(ctx) {
        const pptTask = ctx.task.ppt ?? {};
        if (pptTask.enabled !== true) {
          return { result: { skipped: true, reason: "ppt disabled" }, outputs: [] };
        }
        const slides = Math.max(1, Math.floor(Number(pptTask.slides ?? 10)));
        const output = ctx.artifact("slides.pptx");
        if (ctx.dryRun) {
          createMinimalPptx(output, slides);
          const validation = validatePptx(output, slides);
          return { result: { ppt: validation }, outputs: [output] };
        }
        const doubao = tool(ctx.config, "doubao");
        const mode = String(doubao.mode ?? "handoff");
        const prompt = renderTemplate(loadPromptFile("doubao_ppt.md"), {
          OUTPUT_PPTX: output,
          PPT_CONTEXT: { task: ctx.task, analysis: ctx.results.analysis, design: ctx.results.frontend_design, code_result: ctx.results.code },
        });
        if (mode === "handoff") {
          const handoff = ctx.artifact("doubao_handoff.md");
          await atomicWriteText(handoff, prompt);
          return { result: { handoff, waiting: true }, outputs: [handoff] };
        }
        if (mode !== "windows_mcp") {
          throw new WorkflowError(`unsupported doubao.mode: ${mode}`);
        }
        if (!ctx.allowUi) {
          throw new WorkflowError("Doubao GUI automation requires explicit --allow-ui");
        }
        const uiPrompt = WINDOWS_MCP_SAFETY + "\n\n" + prompt;
        const uiClient = String(doubao.ui_client ?? "claude");
        let response: Record<string, unknown>;
        if (uiClient === "claude") {
          const claude = tool(ctx.config, "claude");
          const mcpConfig = String(tool(ctx.config, "windows_mcp").mcp_config ?? "");
          const args = buildClaudeUiArgs(String(claude.command ?? ""), uiPrompt, mcpConfig, String(claude.ui_model ?? "sonnet"));
          const result = await ctx.invoke("windows_mcp_via_claude", args, { cwd: ctx.projectRoot, env: claude.env as Record<string, string> });
          const outer = JSON.parse(result.stdout);
          response = { result: outer.result ?? "", raw: outer };
        } else {
          const codex = tool(ctx.config, "codex");
          const args = buildCodexUiArgs(String(codex.command ?? ""), uiPrompt, ctx.projectRoot);
          const result = await ctx.invoke("windows_mcp_via_codex", args, { cwd: ctx.projectRoot, env: codex.env as Record<string, string> });
          response = { result: result.stdout, raw: { stderr: result.stderr } };
        }
        const validation = validatePptx(output, slides);
        const evidence = ctx.artifact("doubao_ui_result.json");
        await atomicWriteJson(evidence, response);
        return { result: { ppt: validation, ui: response }, outputs: [output, evidence] };
      },
    },
    {
      name: "review",
      inputs: ({ task, results }) => ({
        task,
        analysis: results.analysis,
        design: results.frontend_design,
        code_result: results.code,
        ppt: results.ppt,
      }),
      runStatus: "ready_for_review",
      terminalWaiting: true,
      async run(ctx) {
        const output = ctx.artifact("review.json");
        const workbuddy = tool(ctx.config, "workbuddy");
        const mode = String(workbuddy.mode ?? "handoff");
        const threshold = Number(ctx.config.quality?.review_score ?? 80);
        const context = {
          task: ctx.task,
          analysis: ctx.results.analysis,
          design: ctx.results.frontend_design,
          code_result: ctx.results.code,
          ppt: ctx.results.ppt,
        };
        const prompt = renderTemplate(loadPromptFile("workbuddy_review.md"), { REVIEW_CONTEXT: context });

        let data: Record<string, unknown> | undefined;
        if (ctx.dryRun) {
          if (mode === "handoff") {
            const handoff = ctx.artifact("workbuddy_review_request.md");
            await atomicWriteText(handoff, prompt);
            return { result: { handoff, waiting: true }, outputs: [handoff] };
          }
          data = { passed: true, score: 100, summary: "Dry-run review", blockers: [], important_findings: [], suggestions: [], writing_output: "" };
        } else if (mode === "handoff") {
          const handoff = ctx.artifact("workbuddy_review_request.md");
          await atomicWriteText(handoff, prompt);
          return { result: { handoff, waiting: true }, outputs: [handoff] };
        } else if (mode === "windows_mcp") {
          if (!ctx.allowUi) {
            throw new WorkflowError("WorkBuddy GUI automation requires explicit --allow-ui");
          }
          const uiClient = String(workbuddy.ui_client ?? "claude");
          let resultText: string;
          if (uiClient === "claude") {
            const claude = tool(ctx.config, "claude");
            const mcpConfig = String(tool(ctx.config, "windows_mcp").mcp_config ?? "");
            const args = buildClaudeUiArgs(String(claude.command ?? ""), WINDOWS_MCP_SAFETY + "\n\n" + prompt, mcpConfig, String(claude.ui_model ?? "sonnet"));
            const result = await ctx.invoke("windows_mcp_via_claude", args, { cwd: ctx.projectRoot, env: claude.env as Record<string, string> });
            const outer = JSON.parse(result.stdout);
            resultText = String(outer.result ?? "");
          } else {
            const codex = tool(ctx.config, "codex");
            const args = buildCodexUiArgs(String(codex.command ?? ""), WINDOWS_MCP_SAFETY + "\n\n" + prompt, ctx.projectRoot);
            const result = await ctx.invoke("windows_mcp_via_codex", args, { cwd: ctx.projectRoot, env: codex.env as Record<string, string> });
            resultText = result.stdout;
          }
          try {
            data = JSON.parse(resultText);
          } catch {
            throw new WorkflowError("WorkBuddy UI result was not review JSON");
          }
        } else {
          throw new WorkflowError(`unsupported workbuddy.mode: ${mode}`);
        }

        if (data === undefined) {
          throw new WorkflowError("WorkBuddy review produced no result");
        }
        validateSchema(data, reviewSchema);
        if (data.blockers || !data.passed || Number(data.score ?? 0) < threshold) {
          throw new WorkflowError(`WorkBuddy review gate failed (threshold ${threshold})`);
        }
        await atomicWriteJson(output, data);
        return { result: { review: data }, outputs: [output] };
      },
    },
  ];
}
