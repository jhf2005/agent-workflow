# 多 Agent 工作空间 — 开发文档

> 目标产品：多 Agent 工作空间系统，首期交付 **Windows 桌面端**。
> 当前仓库为 TypeScript monorepo，是把 Python 原型（`local-multi-agent-workflow/` 子目录）迁移为可产品化架构的工程。

---

## 1. 概述

本应用把多个本地 AI Agent（Claude Code、Codex、豆包、WorkBuddy、Windows-MCP）统一注册、编排、协作，用自然语言驱动一条**可恢复、可审计、可追溯回放**的任务流水线。

十大能力（对应产品愿景）：

| # | 能力 | 当前状态 |
|---|---|---|
| ① | Agent 统一注册 / 编排 / 协作 | ✅ 注册表 + 控制面 + 流水线引擎 |
| ② | 多角色定义与职责划分 | 🔶 角色分工体现在流水线步骤（分析/设计/编码/PPT/审阅） |
| ③ | 各 Agent 独立配置（模型/参数/凭据隔离） | 🔶 配置快照已隔离，凭据加密未做 |
| ④ | 本机扫描发现 + 连接 + 鉴权 + 生命周期 | ✅ 发现→同意→连接→断开（见 §5） |
| ⑤ | 自然语言驱动 + 可视化编排 + 实时状态 + 回放 | ✅ 实时事件流 + React Flow 节点状态 + 事件回放 |
| ⑥ | 多端规划（Windows 优先） | 🔶 Windows 桌面 + Web，协议统一 |
| ⑦ | 本地工具集成（文件系统/终端/编辑器/浏览器） | 🔶 通过 Windows-MCP 桥接（预留） |
| ⑧ | 多部署（本地/私有化/云） | 🔶 控制面 transport-agnostic（HTTP+WS） |
| ⑨ | 插件 + MCP + Skill + 模板扩展 | 🔶 目录已规划，未实现 |
| ⑩ | 数据安全（加密/隔离/脱敏/审计） | 🔶 脱敏 + 审计已实现，本地加密未做 |

> ✅ 已完成 · 🔶 部分完成 / 预留 · ⬜ 未开始

---

## 2. 架构

```
┌───────────────────────────── 桌面壳 (Tauri 2) ─────────────────────────────┐
│  Rust 外壳 (src-tauri)  →  承载 WebView2，spawn 控制面 sidecar             │
│  React 前端 (apps/desktop/src)  →  Agent 注册表 / 工作流运行 / 回放        │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ HTTP POST /rpc  +  WebSocket /ws
                                     │ (JSON-RPC 2.0)
┌────────────────────────────────────▼───────────────────────────────────────┐
│  @workspace/server  →  传输层：把 ControlPlane 暴露为 HTTP+WS            │
│  @workspace/control →  控制面：分发 JSON-RPC 方法名 → 注册表 / 引擎        │
│  @workspace/registry →  Agent 注册表（发现 + 同意 + 生命周期 + 审计）       │
│  @workspace/pipeline →  流水线步骤模板（分析/设计/编码/PPT/审阅）            │
│  @workspace/core     →  引擎（幂等/重试/脱敏/原子写/质量闸门/回放）          │
│  @workspace/adapters →  Claude/Codex/Windows-MCP 参数构造与解析             │
│  @workspace/protocol →  领域类型 + 协议常量（RPC 方法名 / 事件名）           │
└────────────────────────────────────────────────────────────────────────────┘
```

核心设计原则：**控制面 transport-agnostic**。`ControlPlane` 只依赖 `EventEmitter` 和纯函数，不关心是 HTTP、WebSocket 还是 Tauri IPC 在调用它；传输层（`@workspace/server`）把方法调用和运行事件映射成 JSON-RPC 2.0。

---

## 3. 目录结构

```
D:\local-multi-agent-workflow\
├─ packages/
│  ├─ protocol/      领域模型 + RPC 方法名 / 事件名常量（无 Node 依赖）
│  ├─ core/          工作流引擎：幂等、重试退避、脱敏、原子写、PPTX/JSON 校验
│  ├─ adapters/      Claude / Codex / Windows-MCP 的 CLI 参数与结果解析
│  ├─ pipeline/      流水线步骤模板 + 提示词/契约资产（assets/）
│  ├─ registry/      Agent 注册表：发现、同意、连接、断开、审计
│  ├─ control/       控制面：JSON-RPC 方法分发 + 事件转发
│  └─ server/        传输层：HTTP + WebSocket JSON-RPC 2.0 服务 + CLI 入口
├─ apps/
│  └─ desktop/
│     ├─ src/        React 前端（Vite + React Flow）
│     └─ src-tauri/  Tauri 2 外壳（Rust）
├─ test/             vitest 测试（22 个用例）
├─ tsconfig.json     根 TS 配置（packages + test）
├─ package.json      npm workspaces 根（scripts 见下）
└─ local-multi-agent-workflow/   原始 Python 原型（设计资产来源）
```

---

## 4. 快速开始

### 4.1 前置条件

- Node.js ≥ 22（ESM + `fetch`/`WebSocket` 原生可用）
- npm ≥ 10
- （可选，桌面打包）Rust 工具链 + Visual Studio C++ Build Tools（Tauri 2 要求）

### 4.2 安装

```bash
npm install
```

### 4.3 运行（开发模式）

开两个终端：

```bash
# 终端 1：启动控制面服务（HTTP 8787 + WS 8787/ws）
npm run dev:server

# 终端 2：启动前端（Vite dev server，默认 5173）
npm run dev:desktop
```

打开浏览器访问 `http://localhost:5173`。前端默认连接 `http://127.0.0.1:8787`，可用环境变量 `VITE_CONTROL_URL` 覆盖。

### 4.4 测试与类型检查

```bash
npm test              # vitest，22 个用例
npm run typecheck     # 检查 packages + 前端
npm run typecheck:packages   # 仅 packages + test
```

### 4.5 桌面打包（Tauri）

```bash
# 1. 生成图标（需要一张源图 app-icon.png）
cd apps/desktop
npx tauri icon path/to/app-icon.png

# 2. 开发调试（会先跑 vite dev，再打开桌面窗口）
npm run tauri -w @workspace/desktop -- dev

# 3. 打包安装程序
npm run tauri -w @workspace/desktop -- build
```

> 注：生产打包需把 `packages/server/src/cli.ts` 用 Node SEA 或 `pkg` 编译成可执行 sidecar，再由 Rust 侧 spawn（见 §8）。

---

## 5. Agent 发现与同意（核心安全边界）

这是最关键的隐私/授权约束，**必须严格遵守**：

1. **初始为空**：App 首次安装后，注册表 `listAgents()` 返回空数组，**不预置任何 Agent**。
2. **显式扫描**：只有用户主动点击「扫描本机」，`discover()` 才会扫描本机已安装的 Agent（CLI 在 PATH 上 / MCP 配置文件存在）。
3. **发现 ≠ 纳入**：扫描结果停留在 `lifecycle: "discovered"`，**不会**自动进入统一管理。
4. **显式同意**：用户点击「同意并纳入管理」→ `consent()` 把实例推进到 `connected`，写入 `consentedAt` 时间戳，并追加审计事件 `agent_consented`。

对应生命周期：`discovered → connected → stopped`（`authenticated`/`running`/`error` 为预留态）。

相关代码：`packages/registry/src/registry.ts`、`packages/protocol/src/domain.ts`（`AgentLifecycle`）。

---

## 6. 工作流引擎与运行生命周期

### 6.1 步骤（Step）

流水线是 `Step[]` 数组（`packages/pipeline/src/legacy.ts`）：

| 步骤 | 执行者 | 输出 |
|---|---|---|
| `analysis` | Claude | `analysis.json` |
| `frontend_design` | Claude Opus | `design.json`（含 `codex_prompt`） |
| `code` | Codex | 项目代码 + `code_result.json` |
| `ppt` | 豆包 | `slides.pptx` 或 `doubao_handoff.md` |
| `review` | WorkBuddy | `review.json` 或 `workbuddy_review_request.md` |

每个 Step 支持：`inputs`（幂等哈希输入）、`enabled`（门控）、`runStatus`（waiting 时的运行态）、`resultKey`（具名结果包装）、`terminalWaiting`（waiting 是否终结）。

### 6.2 幂等与断点恢复

- 每步输入 + 步骤名 + 配置 → SHA-256 哈希。
- 恢复运行时，若上一步 `success`、哈希不变、输出文件仍存在 → 跳过并记 `step_skipped`。
- `state.json` 通过临时文件 + 原子替换写入，进程中断后可 `resume`。

### 6.3 waiting 语义（忠实于 Python 原型）

- **PPT handoff**：`waiting` 且非终结 → `run_waiting` + 提前返回，状态 `ready_for_ppt`（真正暂停，稍后恢复）。
- **Review handoff**：`waiting` 且 `terminalWaiting` → 停止后续步骤，但**仍写 manifest + 发 `run_finished`**，状态 `ready_for_review`（终态，不伪装成完成）。

### 6.4 每次运行目录

```
runs/<run_id>/
├─ task.json
├─ config.snapshot.json
├─ state.json        # 幂等哈希 + 步骤状态
├─ events.jsonl      # 追加式事件日志（回放数据源）
└─ artifacts/        # analysis/design/code_result/ppt/review + manifest.json
```

### 6.5 质量闸门

- 每个 Agent 输出通过对应 JSON Schema（`packages/pipeline/assets/schemas/`）。
- `code_result.status` 必须为 `success`。
- PPTX 必须是有效 ZIP 且页数达标。
- WorkBuddy 审阅无 blocker、`passed=true`、分数 ≥ `quality.review_score`。

---

## 7. 协议（JSON-RPC 2.0）

传输层 `@workspace/server` 暴露：

- `POST /rpc`：请求/响应（单次调用）
- `GET /health`：`{ ok: true }`
- `WS /ws`：服务器推送运行事件（无 `id` 的 notification）

### 7.1 已实现的 RPC 方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `registry.listAgents` | — | 已纳入管理的 Agent 列表 |
| `registry.discoverAgents` | — | 本机发现的 Agent（未纳入） |
| `registry.connectAgent` | `{ agentId }` | 同意后的实例 |
| `registry.disconnectAgent` | `{ agentId }` | 断开后的实例 |
| `registry.getAgentHealth` | `{ agentId }` | `{ ok, endpoint, lifecycle }` |
| `run.startRun` | `{ projectRoot, config, task, dryRun, allowUi }` | `{ runDir, status }` |
| `run.getRun` | `{ runDir }` | `state.json` 内容 |
| `run.getRunEvents` | `{ runDir }` | `events.jsonl` 解析结果 |

方法名常量集中在 `packages/protocol/src/rpc.ts`（`RPC_METHODS`）。

### 7.2 运行事件

`run_started`、`run_waiting`、`run_finished`、`step_started`、`step_succeeded`、`step_failed`、`step_skipped`（常量在 `EVENT_TYPES`）。

错误：应用级错误（`WorkflowError`）映射为 JSON-RPC `-32000`；协议错误 `-32700`；未知方法 `-32601`。

---

## 8. 桌面端集成策略

当前前端是**纯 Web 原生**（`fetch` + `WebSocket`），不 import 任何 Node-only 包，因此既能在 Vite 下开发，也能打包进 WebView。

控制面是一个 Node 进程，两种运行方式：

- **开发**：`npm run dev:server` 单独起服务，前端连 `127.0.0.1:8787`。
- **生产**：用 Node SEA（`node --experimental-sea-config` + `postject`）或 `pkg` 把 `packages/server/src/cli.ts` 编译成 `.exe`，放进 `src-tauri/binaries/` 作为 Tauri sidecar，由 `lib.rs` 在 `setup` 时 spawn。

Rust 侧已预留 `get_control_url` 命令（`apps/desktop/src-tauri/src/lib.rs`），前端接入 Tauri 时用 `invoke("get_control_url")` 替换硬编码 URL。

---

## 9. 已知差距与路线图

尚未实现（`rpc.ts` 中已定义方法名，控制面 `handle` 尚未覆盖）：

- `workflow.*`（工作流图的创建/校验/列表）
- `run.pause / resume / cancel / list / replay`（暂停/恢复/取消/列表/回放命令）
- `tools.*`（工具目录与调用）
- `security.*`（凭据管理：本地加密存储、权限隔离）
- `extensions.*`（插件 / MCP / Skill / 模板）

建议的下一步优先级：

1. **真实 Agent 接入**：接入已同意 Agent 的路径，跑通非 dry-run 的真实流水线。
2. **凭据与加密**（能力 ⑩）：`security.setCredential` + 本地加密存储。
3. **工作流可视化编排**（能力 ⑤ 完整版）：用 React Flow 让用户拖拽定义 DAG，而不是固定线性模板。
4. **插件体系**（能力 ⑨）：MCP / Skill / 模板的发现与安装。
5. **生产打包**：Node SEA sidecar + Tauri 打包 + 图标。

---

## 10. 数据安全要点

- **脱敏**：`core/redact.ts` 在写事件、状态前对已知敏感键（token/key/password/secret…）打码。
- **原子写**：`core/atomic.ts` 临时文件 + `rename` 替换，避免半写状态。
- **审计**：注册表操作写 `audit.jsonl`；运行事件写 `events.jsonl`（append-only）。
- **目标目录约束**：`code` 步骤的 `target_dir` 必须落在 `allowed_project_roots` 内（`pipeline/legacy.ts` 的 `resolveTargetDir`）。
- **GUI 自动化**：Windows-MCP 阶段必须显式 `--allow-ui`，且遵循「先观察→单步可逆动作→再校验」的安全规则（见 `adapters/windows-mcp.ts` 的 `WINDOWS_MCP_SAFETY`）。

---

## 11. 测试覆盖（22 用例）

| 文件 | 覆盖 |
|---|---|
| `test/engine.test.ts` | dry-run 产物、resume 幂等跳过、GUI 未授权阻断 |
| `test/registry.test.ts` | 空注册表、发现不写入、同意持久化、拒绝重复同意、断开 |
| `test/control.test.ts` | RPC 分发、同意、未安装报错、dry-run 启动、getRun/事件、未知方法 |
| `test/server.test.ts` | HTTP health、RPC 分发、未知方法错误、WS 事件流先于响应 |
| `test/json / redact / retry / schema / pptx` | 哈希、脱敏、退避、Schema、PPTX 结构 |
