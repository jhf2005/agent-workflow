from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


SECRET_KEY_RE = re.compile(
    r"(?i)^(api[_-]?key|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|authorization|cookie)$"
)
WINDOWS_MCP_SAFETY = (
    "Observe the current UI state before acting. Perform one small reversible action at a time, "
    "then observe and validate the result. Never delete, replace, or overwrite user files. "
    "Do not change accounts, payments, permissions, security settings, or system settings. "
    "Save only to the unique output path explicitly provided. Stop if the UI is ambiguous."
)


class WorkflowError(RuntimeError):
    pass


class ValidationError(WorkflowError):
    pass


@dataclasses.dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str


class ProcessRunner:
    def run(
        self,
        args: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None = None,
        timeout: float = 900,
    ) -> ProcessResult:
        merged_env = os.environ.copy()
        if env:
            merged_env.update({str(k): str(v) for k, v in env.items()})
        try:
            completed = subprocess.run(
                [str(part) for part in args],
                cwd=str(cwd),
                env=merged_env,
                input="",
                text=True,
                capture_output=True,
                timeout=timeout,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise WorkflowError(f"process timed out after {timeout}s: {args[0]}") from exc
        return ProcessResult(completed.returncode, completed.stdout, completed.stderr)


@dataclasses.dataclass(frozen=True)
class RetryPolicy:
    attempts: int = 3
    base_seconds: float = 2.0
    max_seconds: float = 30.0
    jitter_seconds: float = 0.5

    @classmethod
    def from_config(cls, value: Mapping[str, Any] | None) -> "RetryPolicy":
        value = value or {}
        return cls(
            attempts=max(1, int(value.get("attempts", 3))),
            base_seconds=max(0.0, float(value.get("base_seconds", 2))),
            max_seconds=max(0.0, float(value.get("max_seconds", 30))),
            jitter_seconds=max(0.0, float(value.get("jitter_seconds", 0.5))),
        )


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_value(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: ("***" if SECRET_KEY_RE.search(str(key)) else redact(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1***", value)
        value = re.sub(r"(?i)((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+", r"\1***", value)
    return value


def resolve_inside(root: Path, candidate: Path) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise WorkflowError(f"path escapes allowed root: {candidate}") from exc
    return candidate


def command_parts(value: str | Sequence[str]) -> list[str]:
    if isinstance(value, str):
        return [value]
    return [str(part) for part in value]


def render_template(text: str, values: Mapping[str, Any]) -> str:
    rendered = text
    for key, value in values.items():
        replacement = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
        rendered = rendered.replace("{{" + key + "}}", replacement)
    return rendered


def validate_schema(value: Any, schema: Mapping[str, Any], path: str = "$") -> None:
    expected = schema.get("type")
    type_map = {
        "object": dict,
        "array": list,
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "null": type(None),
    }
    if expected in type_map:
        py_type = type_map[expected]
        if expected == "integer" and isinstance(value, bool):
            raise ValidationError(f"{path} must be integer")
        if expected == "number" and isinstance(value, bool):
            raise ValidationError(f"{path} must be number")
        if not isinstance(value, py_type):
            raise ValidationError(f"{path} must be {expected}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                raise ValidationError(f"{path}.{key} is required")
        if schema.get("additionalProperties") is False:
            extras = sorted(set(value) - set(properties))
            if extras:
                raise ValidationError(f"{path} has unexpected properties: {extras}")
        for key, item in value.items():
            if key in properties:
                validate_schema(item, properties[key], f"{path}.{key}")
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            validate_schema(item, schema["items"], f"{path}[{index}]")


def create_minimal_pptx(path: Path, slide_count: int) -> None:
    slide_count = max(1, int(slide_count))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        overrides = "".join(
            f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
            for i in range(1, slide_count + 1)
        )
        content_types = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            f"{overrides}</Types>"
        )
        presentation = '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'
        slide = '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>'
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", content_types)
            archive.writestr("ppt/presentation.xml", presentation)
            for i in range(1, slide_count + 1):
                archive.writestr(f"ppt/slides/slide{i}.xml", slide)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def validate_pptx(path: Path, min_slides: int = 1) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValidationError(f"PPTX is missing or empty: {path}")
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise ValidationError(f"invalid PPTX zip: {path}") from exc
    required = {"[Content_Types].xml", "ppt/presentation.xml"}
    if not required.issubset(names):
        raise ValidationError(f"PPTX misses required entries: {sorted(required - names)}")
    slides = sorted(name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))
    if len(slides) < int(min_slides):
        raise ValidationError(f"PPTX has {len(slides)} slides, expected at least {min_slides}")
    return {"path": str(path), "slides": len(slides), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


class Workflow:
    def __init__(
        self,
        project_root: Path,
        config: Mapping[str, Any],
        *,
        runner: ProcessRunner | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        random_fn: Callable[[], float] = random.random,
    ) -> None:
        self.root = project_root.resolve()
        self.config = dict(config)
        self.runner = runner or ProcessRunner()
        self.sleep_fn = sleep_fn
        self.random_fn = random_fn
        self.retry = RetryPolicy.from_config(self.config.get("retry"))
        self.timeout = float(self.config.get("process_timeout_seconds", 900))
        run_root_value = self.config.get("run_root", "runs")
        run_root_path = Path(run_root_value)
        if not run_root_path.is_absolute():
            run_root_path = self.root / run_root_path
        self.run_root = resolve_inside(self.root, run_root_path)
        self.run_root.mkdir(parents=True, exist_ok=True)

    def _event(self, run_dir: Path, event: str, **data: Any) -> None:
        record = {"time": utc_now(), "event": event, **redact(data)}
        with (run_dir / "events.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(canonical_json(record) + "\n")
            handle.flush()

    def _save_state(self, run_dir: Path, state: dict[str, Any]) -> None:
        state["updated_at"] = utc_now()
        atomic_write_json(run_dir / "state.json", state)

    def _load_prompt(self, name: str) -> str:
        path = resolve_inside(self.root, self.root / "prompts" / name)
        return path.read_text(encoding="utf-8")

    def _load_schema(self, name: str) -> dict[str, Any]:
        path = resolve_inside(self.root, self.root / "schemas" / name)
        value = load_json(path)
        if not isinstance(value, dict):
            raise ValidationError(f"schema must be object: {name}")
        return value

    def _artifact(self, run_dir: Path, name: str) -> Path:
        return resolve_inside(run_dir, run_dir / "artifacts" / name)

    def _tool(self, name: str) -> dict[str, Any]:
        tools = self.config.get("tools", {})
        value = tools.get(name)
        if not isinstance(value, dict):
            raise WorkflowError(f"missing tools.{name} configuration")
        return value

    def _invoke(self, name: str, args: Sequence[str], *, cwd: Path, env: Mapping[str, str] | None = None) -> ProcessResult:
        last_error: Exception | None = None
        for attempt in range(1, self.retry.attempts + 1):
            try:
                result = self.runner.run(args, cwd=cwd, env=env, timeout=self.timeout)
                if result.returncode == 0:
                    return result
                message = redact(result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")
                raise WorkflowError(f"{name} failed: {message}")
            except (OSError, WorkflowError) as exc:
                last_error = exc
                if attempt >= self.retry.attempts:
                    break
                delay = min(self.retry.max_seconds, self.retry.base_seconds * (2 ** (attempt - 1)))
                delay += self.retry.jitter_seconds * self.random_fn()
                self.sleep_fn(delay)
        raise WorkflowError(f"{name} failed after {self.retry.attempts} attempts: {last_error}")

    @staticmethod
    def _parse_agent_json(stdout: str) -> dict[str, Any]:
        outer = json.loads(stdout)
        if isinstance(outer, dict) and isinstance(outer.get("structured_output"), dict):
            return outer["structured_output"]
        if isinstance(outer, dict) and "result" in outer:
            result = outer["result"]
            if isinstance(result, dict):
                return result
            if isinstance(result, str):
                return json.loads(result)
        if isinstance(outer, dict):
            return outer
        raise ValidationError("agent output is not a JSON object")

    def _run_step(
        self,
        run_dir: Path,
        state: dict[str, Any],
        name: str,
        inputs: Any,
        action: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        step_hash = sha256_value({"name": name, "inputs": inputs, "config": self.config})
        previous = state["steps"].get(name, {})
        if previous.get("status") == "success" and previous.get("input_hash") == step_hash:
            outputs = [Path(item) for item in previous.get("outputs", [])]
            if all(path.exists() for path in outputs):
                self._event(run_dir, "step_skipped", step=name, reason="idempotent_cache")
                return previous.get("result", {})
        state["steps"][name] = {"status": "running", "input_hash": step_hash, "started_at": utc_now()}
        self._save_state(run_dir, state)
        self._event(run_dir, "step_started", step=name, input_hash=step_hash)
        try:
            result = action()
            outputs = [str(Path(item).resolve()) for item in result.pop("_outputs", [])]
            state["steps"][name] = {
                "status": "success",
                "input_hash": step_hash,
                "started_at": state["steps"][name]["started_at"],
                "finished_at": utc_now(),
                "outputs": outputs,
                "result": redact(result),
            }
            self._save_state(run_dir, state)
            self._event(run_dir, "step_succeeded", step=name, outputs=outputs)
            return result
        except Exception as exc:
            state["steps"][name].update({"status": "failed", "finished_at": utc_now(), "error": str(redact(str(exc)))})
            state["status"] = "failed"
            self._save_state(run_dir, state)
            self._event(run_dir, "step_failed", step=name, error=str(exc))
            raise

    def _analysis(self, run_dir: Path, task: dict[str, Any], dry_run: bool) -> dict[str, Any]:
        output = self._artifact(run_dir, "analysis.json")
        schema = self._load_schema("analysis.schema.json")
        if dry_run:
            data = {
                "summary": "Dry-run analysis",
                "assumptions": [],
                "requirements": [str(task.get("goal", "example goal"))],
                "architecture_decisions": ["Use JSON contracts and resumable steps"],
                "execution_plan": ["analyze", "design", "code", "ppt", "review"],
                "acceptance_criteria": ["All enabled gates pass"],
                "risks": ["GUI adapters require explicit approval"],
            }
        else:
            prompt = render_template(self._load_prompt("analysis.md"), {"TASK_JSON": task})
            tool = self._tool("claude")
            args = command_parts(tool["command"]) + [
                "-p", prompt,
                "--model", str(tool.get("analysis_model", "opus")),
                "--effort", str(tool.get("analysis_effort", "high")),
                "--output-format", "json",
                "--json-schema", canonical_json(schema),
                "--max-turns", "2",
                "--tools", "",
                "--no-session-persistence",
            ]
            result = self._invoke("claude_analysis", args, cwd=self.root, env=tool.get("env"))
            data = self._parse_agent_json(result.stdout)
        validate_schema(data, schema)
        atomic_write_json(output, data)
        return {"analysis": data, "_outputs": [output]}

    def _design(self, run_dir: Path, task: dict[str, Any], analysis: dict[str, Any], dry_run: bool) -> dict[str, Any]:
        output = self._artifact(run_dir, "design.json")
        schema = self._load_schema("design.schema.json")
        if dry_run:
            data = {
                "model": "claude-opus",
                "concept": "Precision workshop",
                "visual_direction": "Editorial industrial interface with strong hierarchy",
                "typography": ["Distinctive display serif", "Humanist sans body"],
                "color_tokens": {"canvas": "#F7F4EC", "ink": "#17202A", "accent": "#C9472D"},
                "layout_rules": ["Asymmetric 12-column grid", "Generous negative space"],
                "interaction_rules": ["One staged entrance", "Visible keyboard focus"],
                "responsive_rules": ["Collapse to one column below 720px"],
                "accessibility_rules": ["WCAG AA contrast", "Reduced-motion fallback"],
                "anti_patterns": ["No purple gradient", "No Inter/Arial", "No generic card grid"],
                "codex_prompt": "Build a production-ready interface using the supplied precision-workshop direction.",
                "acceptance_checks": ["Responsive", "Keyboard accessible", "No generic AI styling"],
            }
        else:
            prompt = render_template(
                self._load_prompt("frontend_design.md"),
                {"TASK_JSON": task, "ANALYSIS_JSON": analysis},
            )
            tool = self._tool("claude")
            args = command_parts(tool["command"]) + [
                "-p", prompt,
                "--model", str(tool.get("design_model", "opus")),
                "--effort", str(tool.get("design_effort", "high")),
                "--output-format", "json",
                "--json-schema", canonical_json(schema),
                "--max-turns", "2",
                "--tools", "",
                "--no-session-persistence",
            ]
            result = self._invoke("claude_design", args, cwd=self.root, env=tool.get("env"))
            data = self._parse_agent_json(result.stdout)
        validate_schema(data, schema)
        atomic_write_json(output, data)
        return {"design": data, "_outputs": [output]}

    def _target_dir(self, task: Mapping[str, Any]) -> Path:
        candidate = Path(str(task.get("target_dir", self.root / "generated_project")))
        if not candidate.is_absolute():
            candidate = self.root / candidate
        allowed = self.config.get("allowed_project_roots", [str(self.root)])
        resolved = candidate.resolve()
        if not any(_is_relative_to(resolved, Path(root).resolve()) for root in allowed):
            raise WorkflowError(f"target_dir is outside allowed_project_roots: {resolved}")
        resolved.mkdir(parents=True, exist_ok=True)
        return resolved

    def _code(self, run_dir: Path, task: dict[str, Any], analysis: dict[str, Any], design: dict[str, Any] | None, dry_run: bool) -> dict[str, Any]:
        output = self._artifact(run_dir, "code_result.json")
        schema = self._load_schema("code_result.schema.json")
        if dry_run:
            data = {"status": "success", "summary": "Dry-run code result", "changed_files": [], "validation_commands": [], "warnings": []}
        else:
            target = self._target_dir(task)
            prompt = render_template(
                self._load_prompt("codex_implementation.md"),
                {"TASK_JSON": task, "ANALYSIS_JSON": analysis, "DESIGN_JSON": design or {}},
            )
            tool = self._tool("codex")
            args = command_parts(tool["command"]) + [
                "-m", str(tool.get("model", "gpt-5.5")),
                "-c", f'model_reasoning_effort="{tool.get("reasoning_effort", "high")}"',
                "--ask-for-approval", "never",
                "--sandbox", "workspace-write",
                "--add-dir", str(output.parent),
                "exec", "--skip-git-repo-check", "--ephemeral",
                "-C", str(target),
                "--output-schema", str(self.root / "schemas" / "code_result.schema.json"),
                "-o", str(output),
                prompt,
            ]
            result = self._invoke("codex_code", args, cwd=target, env=tool.get("env"))
            if not output.exists():
                try:
                    data = json.loads(result.stdout)
                except json.JSONDecodeError as exc:
                    raise ValidationError("Codex did not produce code_result.json") from exc
            else:
                data = load_json(output)
        validate_schema(data, schema)
        if data.get("status") != "success":
            raise ValidationError("Codex code result status is not success")
        atomic_write_json(output, data)
        return {"code_result": data, "_outputs": [output]}

    def _ui_call(self, prompt: str, *, client: str) -> dict[str, Any]:
        if client == "claude":
            tool = self._tool("claude")
            mcp_config = str(self._tool("windows_mcp")["mcp_config"])
            args = command_parts(tool["command"]) + [
                "-p", prompt,
                "--model", str(tool.get("ui_model", "sonnet")),
                "--effort", "low",
                "--output-format", "json",
                "--max-turns", "12",
                "--mcp-config", mcp_config,
                "--strict-mcp-config",
                "--no-session-persistence",
            ]
            result = self._invoke("windows_mcp_via_claude", args, cwd=self.root, env=tool.get("env"))
            outer = json.loads(result.stdout)
            return {"result": outer.get("result", ""), "raw": outer}
        tool = self._tool("codex")
        args = command_parts(tool["command"]) + [
            "--ask-for-approval", "never", "--sandbox", "read-only",
            "exec", "--skip-git-repo-check", "--ephemeral", "-C", str(self.root), prompt,
        ]
        result = self._invoke("windows_mcp_via_codex", args, cwd=self.root, env=tool.get("env"))
        return {"result": result.stdout, "raw": {"stderr": result.stderr}}

    def _ppt(self, run_dir: Path, task: dict[str, Any], context: dict[str, Any], dry_run: bool, allow_ui: bool) -> dict[str, Any]:
        ppt_task = task.get("ppt", {})
        if not ppt_task.get("enabled", False):
            return {"skipped": True, "reason": "ppt disabled", "_outputs": []}
        slides = max(1, int(ppt_task.get("slides", 10)))
        output = self._artifact(run_dir, "slides.pptx")
        if dry_run:
            create_minimal_pptx(output, slides)
            validation = validate_pptx(output, slides)
            return {"ppt": validation, "_outputs": [output]}
        tool = self._tool("doubao")
        mode = str(tool.get("mode", "handoff"))
        prompt = render_template(
            self._load_prompt("doubao_ppt.md"),
            {"OUTPUT_PPTX": str(output), "PPT_CONTEXT": context},
        )
        if mode == "handoff":
            handoff = self._artifact(run_dir, "doubao_handoff.md")
            atomic_write_text(handoff, prompt)
            return {"handoff": str(handoff), "waiting": True, "_outputs": [handoff]}
        if mode != "windows_mcp":
            raise WorkflowError(f"unsupported doubao.mode: {mode}")
        if not allow_ui:
            raise WorkflowError("Doubao GUI automation requires explicit --allow-ui")
        response = self._ui_call(WINDOWS_MCP_SAFETY + "\n\n" + prompt, client=str(tool.get("ui_client", "claude")))
        validation = validate_pptx(output, slides)
        evidence = self._artifact(run_dir, "doubao_ui_result.json")
        atomic_write_json(evidence, response)
        return {"ppt": validation, "ui": response, "_outputs": [output, evidence]}

    def _review(self, run_dir: Path, task: dict[str, Any], context: dict[str, Any], dry_run: bool, allow_ui: bool) -> dict[str, Any]:
        output = self._artifact(run_dir, "review.json")
        schema = self._load_schema("review.schema.json")
        tool = self._tool("workbuddy")
        mode = str(tool.get("mode", "handoff"))
        threshold = int(self.config.get("quality", {}).get("review_score", 80))
        prompt = render_template(self._load_prompt("workbuddy_review.md"), {"REVIEW_CONTEXT": context})
        if dry_run:
            if mode == "handoff":
                handoff = self._artifact(run_dir, "workbuddy_review_request.md")
                atomic_write_text(handoff, prompt)
                return {"handoff": str(handoff), "waiting": True, "_outputs": [handoff]}
            data = {"passed": True, "score": 100, "summary": "Dry-run review", "blockers": [], "important_findings": [], "suggestions": [], "writing_output": ""}
        elif mode == "handoff":
            handoff = self._artifact(run_dir, "workbuddy_review_request.md")
            atomic_write_text(handoff, prompt)
            return {"handoff": str(handoff), "waiting": True, "_outputs": [handoff]}
        elif mode == "windows_mcp":
            if not allow_ui:
                raise WorkflowError("WorkBuddy GUI automation requires explicit --allow-ui")
            response = self._ui_call(WINDOWS_MCP_SAFETY + "\n\n" + prompt, client=str(tool.get("ui_client", "claude")))
            result_text = str(response.get("result", ""))
            try:
                data = json.loads(result_text)
            except json.JSONDecodeError as exc:
                raise ValidationError("WorkBuddy UI result was not review JSON") from exc
        else:
            raise WorkflowError(f"unsupported workbuddy.mode: {mode}")
        validate_schema(data, schema)
        if data.get("blockers") or not data.get("passed") or int(data.get("score", 0)) < threshold:
            raise ValidationError(f"WorkBuddy review gate failed (threshold {threshold})")
        atomic_write_json(output, data)
        return {"review": data, "_outputs": [output]}

    def execute(self, task: dict[str, Any], *, dry_run: bool, allow_ui: bool, run_dir: Path | None = None) -> Path:
        if run_dir is None:
            run_id = f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{sha256_value(task)[:8]}"
            run_dir = resolve_inside(self.run_root, self.run_root / run_id)
            run_dir.mkdir(parents=True, exist_ok=False)
            (run_dir / "artifacts").mkdir()
            atomic_write_json(run_dir / "task.json", task)
            atomic_write_json(run_dir / "config.snapshot.json", redact(self.config))
            state = {"run_id": run_id, "status": "created", "created_at": utc_now(), "updated_at": utc_now(), "steps": {}}
        else:
            run_dir = resolve_inside(self.run_root, run_dir)
            state = load_json(run_dir / "state.json")
            task = load_json(run_dir / "task.json")
        state["status"] = "running"
        self._save_state(run_dir, state)
        self._event(run_dir, "run_started", dry_run=dry_run, allow_ui=allow_ui)
        try:
            analysis_result = self._run_step(run_dir, state, "analysis", task, lambda: self._analysis(run_dir, task, dry_run))
            analysis = analysis_result["analysis"]
            design: dict[str, Any] | None = None
            if task.get("frontend", {}).get("enabled", False):
                design_result = self._run_step(run_dir, state, "frontend_design", {"task": task, "analysis": analysis}, lambda: self._design(run_dir, task, analysis, dry_run))
                design = design_result["design"]
            code_result: dict[str, Any] | None = None
            if task.get("code", {}).get("enabled", True):
                code_step = self._run_step(run_dir, state, "code", {"task": task, "analysis": analysis, "design": design}, lambda: self._code(run_dir, task, analysis, design, dry_run))
                code_result = code_step["code_result"]
            ppt_context = {"task": task, "analysis": analysis, "design": design, "code_result": code_result}
            ppt_result = self._run_step(run_dir, state, "ppt", ppt_context, lambda: self._ppt(run_dir, task, ppt_context, dry_run, allow_ui))
            if ppt_result.get("waiting"):
                state["status"] = "ready_for_ppt"
                self._save_state(run_dir, state)
                self._event(run_dir, "run_waiting", stage="ppt")
                return run_dir
            review_context = {**ppt_context, "ppt": ppt_result}
            review_result = self._run_step(run_dir, state, "review", review_context, lambda: self._review(run_dir, task, review_context, dry_run, allow_ui))
            if review_result.get("waiting"):
                state["status"] = "ready_for_review"
            else:
                state["status"] = "complete"
            manifest = {
                "run_id": state["run_id"],
                "status": state["status"],
                "created_at": state["created_at"],
                "finished_at": utc_now(),
                "task_sha256": sha256_value(task),
                "artifacts": self._manifest_artifacts(run_dir),
                "steps": state["steps"],
            }
            manifest_path = self._artifact(run_dir, "manifest.json")
            atomic_write_json(manifest_path, manifest)
            state["manifest"] = str(manifest_path)
            self._save_state(run_dir, state)
            self._event(run_dir, "run_finished", status=state["status"])
            return run_dir
        except Exception:
            state["status"] = "failed"
            self._save_state(run_dir, state)
            raise

    @staticmethod
    def _manifest_artifacts(run_dir: Path) -> list[dict[str, Any]]:
        result = []
        for path in sorted((run_dir / "artifacts").glob("*")):
            if path.is_file():
                result.append({"path": str(path.resolve()), "size": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        return result

    def doctor(self) -> dict[str, Any]:
        checks: dict[str, Any] = {}
        for name in ("claude", "codex"):
            try:
                command = command_parts(self._tool(name)["command"])[0]
                resolved = shutil.which(command) or (str(Path(command).resolve()) if Path(command).exists() else None)
                checks[name] = {"ok": bool(resolved), "command": command, "resolved": resolved}
            except Exception as exc:
                checks[name] = {"ok": False, "error": str(exc)}
        try:
            mcp_path = Path(str(self._tool("windows_mcp")["mcp_config"])).expanduser()
            checks["windows_mcp"] = {"ok": mcp_path.is_file(), "mcp_config": str(mcp_path)}
        except Exception as exc:
            checks["windows_mcp"] = {"ok": False, "error": str(exc)}
        checks["doubao"] = {"ok": True, "mode": self._tool("doubao").get("mode", "handoff"), "note": "handoff is valid when the app is unavailable"}
        checks["workbuddy"] = {"ok": True, "mode": self._tool("workbuddy").get("mode", "handoff")}
        return {"ok": all(item.get("ok") for item in checks.values()), "checks": checks}


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local Claude/Codex/Doubao/WorkBuddy workflow")
    sub = parser.add_subparsers(dest="command", required=True)
    doctor = sub.add_parser("doctor")
    doctor.add_argument("--config", default="workflow.config.example.json")
    run = sub.add_parser("run")
    run.add_argument("--config", default="workflow.config.example.json")
    run.add_argument("--task", default="task.example.json")
    run.add_argument("--dry-run", action="store_true")
    run.add_argument("--allow-ui", action="store_true")
    resume = sub.add_parser("resume")
    resume.add_argument("run_dir")
    resume.add_argument("--config", default="workflow.config.example.json")
    resume.add_argument("--dry-run", action="store_true")
    resume.add_argument("--allow-ui", action="store_true")
    status = sub.add_parser("status")
    status.add_argument("run_dir")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent
    try:
        if args.command == "status":
            state = load_json(Path(args.run_dir).resolve() / "state.json")
            print(json.dumps(state, ensure_ascii=False, indent=2))
            return 0
        config_path = Path(args.config)
        if not config_path.is_absolute():
            config_path = root / config_path
        config = load_json(config_path)
        workflow = Workflow(root, config)
        if args.command == "doctor":
            report = workflow.doctor()
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["ok"] else 2
        if args.command == "run":
            task_path = Path(args.task)
            if not task_path.is_absolute():
                task_path = root / task_path
            run_dir = workflow.execute(load_json(task_path), dry_run=args.dry_run, allow_ui=args.allow_ui)
        else:
            run_dir = workflow.execute({}, dry_run=args.dry_run, allow_ui=args.allow_ui, run_dir=Path(args.run_dir))
        state = load_json(run_dir / "state.json")
        print(json.dumps({"run_dir": str(run_dir), "status": state["status"]}, ensure_ascii=False, indent=2))
        return 0 if state["status"] in {"complete", "ready_for_ppt", "ready_for_review"} else 1
    except (OSError, ValueError, json.JSONDecodeError, WorkflowError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
