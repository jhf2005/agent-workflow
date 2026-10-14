import { useEffect, useState } from "react";
import type { ControlClient, RunEvent, StartRunResult } from "../lib/rpc";
import { buildDemoConfig, buildDemoTask } from "../lib/config";
import { FlowCanvas } from "../components/FlowCanvas";

const STEP_EVENTS: Record<string, string> = {
  step_started: "running",
  step_succeeded: "success",
  step_failed: "failed",
  step_skipped: "skipped",
};

export function RunsScreen({ client }: { client: ControlClient }) {
  const [goal, setGoal] = useState("构建一个带登录的落地页");
  const [projectRoot, setProjectRoot] = useState("D:\\agent-workspace-demo");
  const [targetDir, setTargetDir] = useState("generated");
  const [dryRun, setDryRun] = useState(true);
  const [allowUi, setAllowUi] = useState(false);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [runDir, setRunDir] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [stepStatus, setStepStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return client.onEvent((event, data) => {
      setEvents((prev) => [...prev, { time: new Date().toISOString(), event, ...data }]);
      const step = typeof data.step === "string" ? data.step : undefined;
      if (step && STEP_EVENTS[event]) {
        setStepStatus((prev) => ({ ...prev, [step]: STEP_EVENTS[event] }));
      }
      if (event === "run_finished") {
        setStatus(typeof data.status === "string" ? data.status : "complete");
      }
    });
  }, [client]);

  const start = async () => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setStepStatus({});
    setStatus("running");
    setRunDir(null);
    try {
      const result = await client.call<StartRunResult>("run.startRun", {
        projectRoot,
        config: buildDemoConfig(projectRoot),
        task: buildDemoTask(goal, targetDir),
        dryRun,
        allowUi,
      });
      setRunDir(result.runDir);
      setStatus(result.status);

      // Replay from persisted run artifacts (traceable execution).
      const [state, runEvents] = await Promise.all([
        client.call<{ status: string }>("run.getRun", { runDir: result.runDir }),
        client.call<RunEvent[]>("run.getRunEvents", { runDir: result.runDir }),
      ]);
      setStatus(state.status);
      setEvents(runEvents);
      for (const ev of runEvents) {
        const step = typeof ev.step === "string" ? ev.step : undefined;
        if (step && STEP_EVENTS[ev.event]) {
          setStepStatus((prev) => ({ ...prev, [step]: STEP_EVENTS[ev.event] }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="runs">
      <div className="section-head">
        <h2>工作流运行</h2>
      </div>

      <form
        className="run-form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label>
          目标
          <input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label>
          项目根目录
          <input value={projectRoot} onChange={(e) => setProjectRoot(e.target.value)} />
        </label>
        <label>
          目标子目录
          <input value={targetDir} onChange={(e) => setTargetDir(e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          试运行（不调用真实 Agent）
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={allowUi} onChange={(e) => setAllowUi(e.target.checked)} />
          允许 GUI 自动化（--allow-ui）
        </label>
        <button type="submit" disabled={running || projectRoot.trim() === ""}>
          {running ? "运行中…" : "启动运行"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="status-line">
        状态：<strong>{status ?? "—"}</strong>
        {runDir && (
          <>
            {" · "}
            <code>{runDir}</code>
          </>
        )}
      </div>

      <h3>节点状态</h3>
      <FlowCanvas stepStatus={stepStatus} />

      <h3>事件流（{events.length}）</h3>
      <ol className="event-log">
        {events.map((ev, i) => (
          <li key={i} className={`event ${ev.event}`}>
            <span className="event-name">{ev.event}</span>
            {typeof ev.step === "string" && <span className="event-step">{ev.step}</span>}
            <span className="event-time">{ev.time}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
