import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const PIPELINE = ["analysis", "frontend_design", "code", "ppt", "review"] as const;

const LABELS: Record<string, string> = {
  analysis: "分析",
  frontend_design: "前端设计",
  code: "代码实现",
  ppt: "PPT",
  review: "审阅",
};

const COLORS: Record<string, string> = {
  pending: "#64748b",
  running: "#f59e0b",
  success: "#16a34a",
  failed: "#dc2626",
  skipped: "#94a3b8",
  waiting: "#2563eb",
};

export function FlowCanvas({ stepStatus }: { stepStatus: Record<string, string> }) {
  const nodes: Node[] = PIPELINE.map((id, i) => {
    const status = stepStatus[id] ?? "pending";
    return {
      id,
      position: { x: i * 190, y: 0 },
      data: { label: `${LABELS[id]} · ${status}` },
      style: {
        border: `2px solid ${COLORS[status]}`,
        borderRadius: 8,
        padding: 10,
        width: 160,
        background: "#fff",
        fontSize: 13,
      },
    };
  });

  const edges: Edge[] = PIPELINE.slice(0, -1).map((id, i) => ({
    id: `e-${id}`,
    source: id,
    target: PIPELINE[i + 1],
    animated: stepStatus[id] === "success",
  }));

  return (
    <div className="flow">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
