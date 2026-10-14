import { useEffect, useMemo, useState } from "react";
import { ControlClient } from "./lib/rpc";
import { AgentsScreen } from "./screens/AgentsScreen";
import { RunsScreen } from "./screens/RunsScreen";

const CONTROL_URL = (import.meta.env.VITE_CONTROL_URL as string | undefined) ?? "http://127.0.0.1:8787";

type Tab = "agents" | "runs";

export default function App() {
  const client = useMemo(() => new ControlClient(CONTROL_URL), []);
  const [tab, setTab] = useState<Tab>("agents");

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>多 Agent 工作空间</h1>
        <nav>
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>
            Agent 注册表
          </button>
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>
            工作流运行
          </button>
        </nav>
      </header>
      <main className="content">
        {tab === "agents" ? <AgentsScreen client={client} /> : <RunsScreen client={client} />}
      </main>
    </div>
  );
}
