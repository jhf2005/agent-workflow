import { useCallback, useEffect, useState } from "react";
import type { AgentInstance, ControlClient } from "../lib/rpc";

export function AgentsScreen({ client }: { client: ControlClient }) {
  const [managed, setManaged] = useState<AgentInstance[]>([]);
  const [discovered, setDiscovered] = useState<AgentInstance[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [m, d] = await Promise.all([
        client.call<AgentInstance[]>("registry.listAgents"),
        client.call<AgentInstance[]>("registry.discoverAgents"),
      ]);
      setManaged(m);
      setDiscovered(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (agentId: string) => {
    setBusy(agentId);
    setError(null);
    try {
      await client.call("registry.connectAgent", { agentId });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (agentId: string) => {
    setBusy(agentId);
    setError(null);
    try {
      await client.call("registry.disconnectAgent", { agentId });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="agents">
      <div className="section-head">
        <h2>Agent 注册表</h2>
        <button onClick={() => void refresh()} disabled={busy !== null}>
          扫描本机
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <h3>已纳入管理（{managed.length}）</h3>
      {managed.length === 0 ? (
        <p className="muted">尚未纳入任何 Agent。App 初始为空，需扫描本机并逐个同意。</p>
      ) : (
        <ul className="agent-list">
          {managed.map((a) => (
            <li key={a.agentId} className="agent-row">
              <span className="agent-name">{a.agentId}</span>
              <span className={`badge ${a.lifecycle}`}>{a.lifecycle}</span>
              <code className="endpoint">{a.endpoint}</code>
              <button onClick={() => void disconnect(a.agentId)} disabled={busy === a.agentId}>
                断开
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>本机发现（{discovered.length}）</h3>
      {discovered.length === 0 ? (
        <p className="muted">未发现可管理的 Agent（未安装 CLI / MCP 配置）。</p>
      ) : (
        <ul className="agent-list">
          {discovered.map((a) => (
            <li key={a.agentId} className="agent-row">
              <span className="agent-name">{a.agentId}</span>
              <span className="badge discovered">discovered</span>
              <code className="endpoint">{a.endpoint}</code>
              <button onClick={() => void connect(a.agentId)} disabled={busy === a.agentId}>
                同意并纳入管理
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
