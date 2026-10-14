import json
import shutil
import tempfile
import unittest
from pathlib import Path

from multi_agent_flow import (
    ProcessResult,
    ValidationError,
    Workflow,
    WorkflowError,
    canonical_json,
    create_minimal_pptx,
    redact,
    sha256_value,
    validate_pptx,
    validate_schema,
)


SOURCE_ROOT = Path(__file__).resolve().parents[1]


class FakeRunner:
    def __init__(self, results=None):
        self.results = list(results or [])
        self.calls = []

    def run(self, args, *, cwd, env=None, timeout=900):
        self.calls.append({"args": list(args), "cwd": Path(cwd), "env": dict(env or {}), "timeout": timeout})
        if not self.results:
            raise AssertionError("unexpected external process call")
        return self.results.pop(0)


class WorkflowTests(unittest.TestCase):
    def make_project(self):
        holder = tempfile.TemporaryDirectory()
        root = Path(holder.name)
        shutil.copytree(SOURCE_ROOT / "prompts", root / "prompts")
        shutil.copytree(SOURCE_ROOT / "schemas", root / "schemas")
        config = {
            "run_root": "runs",
            "allowed_project_roots": [str(root)],
            "process_timeout_seconds": 5,
            "retry": {"attempts": 3, "base_seconds": 1, "max_seconds": 8, "jitter_seconds": 0},
            "quality": {"review_score": 80},
            "tools": {
                "claude": {"command": "claude"},
                "codex": {"command": "codex"},
                "windows_mcp": {"mcp_config": str(root / "mcp.json")},
                "doubao": {"mode": "handoff", "ui_client": "claude"},
                "workbuddy": {"mode": "handoff", "ui_client": "claude"},
            },
        }
        task = {
            "task_id": "test",
            "goal": "test workflow",
            "target_dir": "generated",
            "frontend": {"enabled": True},
            "code": {"enabled": True},
            "ppt": {"enabled": True, "slides": 3},
        }
        return holder, root, config, task

    def test_canonical_hash_is_order_independent(self):
        self.assertEqual(canonical_json({"b": 2, "a": 1}), canonical_json({"a": 1, "b": 2}))
        self.assertEqual(sha256_value({"b": 2, "a": 1}), sha256_value({"a": 1, "b": 2}))

    def test_redaction_masks_secrets(self):
        value = redact({"api_key": "abc", "nested": {"token": "xyz"}, "color_tokens": {"accent": "#C9472D"}, "message": "Authorization: Bearer secret-value"})
        self.assertEqual(value["api_key"], "***")
        self.assertEqual(value["nested"]["token"], "***")
        self.assertEqual(value["color_tokens"], {"accent": "#C9472D"})
        self.assertNotIn("secret-value", value["message"])

    def test_schema_validation_required_and_extra(self):
        schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}
        validate_schema({"name": "ok"}, schema)
        with self.assertRaises(ValidationError):
            validate_schema({}, schema)
        with self.assertRaises(ValidationError):
            validate_schema({"name": "ok", "extra": True}, schema)

    def test_minimal_pptx_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "slides.pptx"
            create_minimal_pptx(path, 4)
            result = validate_pptx(path, 4)
            self.assertEqual(result["slides"], 4)
            with self.assertRaises(ValidationError):
                validate_pptx(path, 5)

    def test_retry_then_success(self):
        holder, root, config, _ = self.make_project()
        self.addCleanup(holder.cleanup)
        sleeps = []
        runner = FakeRunner([ProcessResult(1, "", "temporary"), ProcessResult(0, "ok", "")])
        workflow = Workflow(root, config, runner=runner, sleep_fn=sleeps.append, random_fn=lambda: 0)
        result = workflow._invoke("demo", ["tool"], cwd=root)
        self.assertEqual(result.stdout, "ok")
        self.assertEqual(len(runner.calls), 2)
        self.assertEqual(sleeps, [1])

    def test_dry_run_creates_artifacts_without_processes(self):
        holder, root, config, task = self.make_project()
        self.addCleanup(holder.cleanup)
        runner = FakeRunner()
        workflow = Workflow(root, config, runner=runner, sleep_fn=lambda _: None, random_fn=lambda: 0)
        run_dir = workflow.execute(task, dry_run=True, allow_ui=False)
        state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "ready_for_review")
        self.assertEqual(
            state["steps"]["frontend_design"]["result"]["design"]["color_tokens"]["accent"],
            "#C9472D",
        )
        self.assertTrue((run_dir / "artifacts" / "analysis.json").exists())
        self.assertTrue((run_dir / "artifacts" / "design.json").exists())
        self.assertTrue((run_dir / "artifacts" / "code_result.json").exists())
        self.assertEqual(validate_pptx(run_dir / "artifacts" / "slides.pptx", 3)["slides"], 3)
        self.assertTrue((run_dir / "artifacts" / "workbuddy_review_request.md").exists())
        self.assertEqual(runner.calls, [])

    def test_resume_skips_successful_same_hash_steps(self):
        holder, root, config, task = self.make_project()
        self.addCleanup(holder.cleanup)
        workflow = Workflow(root, config, runner=FakeRunner(), sleep_fn=lambda _: None, random_fn=lambda: 0)
        run_dir = workflow.execute(task, dry_run=True, allow_ui=False)
        workflow.execute({}, dry_run=True, allow_ui=False, run_dir=run_dir)
        events = (run_dir / "events.jsonl").read_text(encoding="utf-8")
        self.assertGreaterEqual(events.count('"event":"step_skipped"'), 5)

    def test_windows_mcp_mode_requires_allow_ui(self):
        holder, root, config, task = self.make_project()
        self.addCleanup(holder.cleanup)
        config["tools"]["doubao"]["mode"] = "windows_mcp"
        workflow = Workflow(root, config, runner=FakeRunner(), sleep_fn=lambda _: None, random_fn=lambda: 0)
        run_dir = root / "runs" / "manual"
        (run_dir / "artifacts").mkdir(parents=True)
        with self.assertRaisesRegex(WorkflowError, "--allow-ui"):
            workflow._ppt(run_dir, task, {}, dry_run=False, allow_ui=False)


if __name__ == "__main__":
    unittest.main()
