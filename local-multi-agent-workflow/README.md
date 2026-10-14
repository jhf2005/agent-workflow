# 本地多 AI 智能体协作工作流

这是一个 Windows 本地编排器，把 Claude Code、Codex、豆包、WorkBuddy 和 Windows-MCP 串成可恢复、可审计的任务流水线。核心实现仅使用 Python 标准库。

## 1. 当前实现结论

### 角色分工

| 阶段 | 执行者 | 主要输出 |
|---|---|---|
| 需求分析、推理与总结 | Claude Code / Claude Opus | `analysis.json` |
| 前端视觉总监 | Claude Code / Claude Opus | `design.json`，其中 `codex_prompt` 直接交给 Codex |
| 代码开发与验证 | Codex | 目标项目代码、`code_result.json` |
| PPT 制作 | 豆包桌面端 | `slides.pptx`，或 `doubao_handoff.md` |
| 独立审阅、论文与文章 | WorkBuddy | `review.json`、文章/论文，或 `workbuddy_review_request.md` |
| 桌面应用桥接 | Windows-MCP | 观察、点击、输入、导出和动作后校验 |
| 状态、重试、校验与清单 | 本地 Python 编排器 | `state.json`、`events.jsonl`、`manifest.json` |

### 前端提示词模型选择

本方案选择 **Claude Opus 4.7** 作为前端视觉总监，原因是：

1. 前端设计提示词首先是需求综合、视觉概念和约束表达任务，和 Claude 的长上下文分析能力最匹配。
2. Codex 保持单一职责，专注把明确设计规范变成代码。
3. WorkBuddy 保持独立审阅者身份，避免“自己设计、自己验收”。
4. 豆包负责演示稿，Windows-MCP 仅负责桌面桥接，不承担设计决策。

视觉提示词会强制定义视觉概念、字体、色彩令牌、版式、状态、动效、响应式与无障碍规则，并明确禁止紫色渐变白底、Inter/Arial、通用卡片网格等千篇一律的 AI 风格。

## 2. 调用顺序与数据流

```text
用户任务 task.json
        │
        ▼
Claude Code：结构化分析 ──> analysis.json
        │
        ▼
Claude Opus：前端视觉提示词 ──> design.json / codex_prompt
        │
        ▼
Codex：代码修改、构建、测试 ──> 项目代码 + code_result.json
        │
        ├────────> 豆包：PPT ──> slides.pptx
        │                         （未启用 UI 时生成 handoff）
        ▼
WorkBuddy：独立审阅、论文/文章 ──> review.json / writing output
        │                         （默认生成 review handoff）
        ▼
质量闸门 + manifest.json
```

每次运行创建独立目录：

```text
runs/<run_id>/
├─ task.json
├─ config.snapshot.json
├─ state.json
├─ events.jsonl
└─ artifacts/
   ├─ analysis.json
   ├─ design.json
   ├─ code_result.json
   ├─ slides.pptx
   ├─ doubao_handoff.md
   ├─ workbuddy_review_request.md
   ├─ review.json
   └─ manifest.json
```

只有启用的阶段才会产生对应文件。

## 3. 输入与输出约定

### 任务输入

示例见 `task.example.json`。核心字段：

- `goal`：任务最终目标。
- `context`：背景信息。
- `target_dir`：Codex 修改的项目目录，必须落在 `allowed_project_roots` 内。
- `constraints`：技术、安全和交付约束。
- `acceptance_criteria`：可验证的完成条件。
- `frontend.enabled`：是否运行视觉提示词阶段。
- `code.enabled`：是否运行 Codex。
- `ppt.enabled/slides`：是否制作 PPT 和最小页数。
- `writing.enabled/type`：是否需要论文或文章。

### 结构化契约

契约位于 `schemas/`：

- `analysis.schema.json`：摘要、假设、需求、架构决策、执行计划、验收标准、风险。
- `design.schema.json`：视觉概念、字体、色彩、布局、交互、响应式、无障碍、反模式、Codex 提示词。
- `code_result.schema.json`：状态、变更文件、验证命令、摘要、警告。
- `review.schema.json`：是否通过、分数、阻断项、重要发现、建议、写作输出。

编排器实现了满足本项目需要的轻量 JSON Schema 校验，不依赖第三方包。

## 4. 自动化实现

主程序：`multi_agent_flow.py`

支持四个命令：

```bat
run-workflow.cmd doctor --config workflow.config.example.json
run-workflow.cmd run --config workflow.config.example.json --task task.example.json --dry-run
run-workflow.cmd status runs\<run_id>
run-workflow.cmd resume runs\<run_id> --config workflow.config.example.json --dry-run
```

真实运行（不自动控制 GUI）：

```bat
run-workflow.cmd run --config workflow.config.example.json --task task.example.json
```

显式允许桌面自动化：

```bat
run-workflow.cmd run --config workflow.config.example.json --task task.example.json --allow-ui
```

`--allow-ui` 只是安全授权开关；还需要把配置中的豆包或 WorkBuddy `mode` 从 `handoff` 改为 `windows_mcp`。

### 配置要点

`workflow.config.example.json` 已写入本机检测到的路径：

- Claude Code：`C:/Users/Administrator/.local/bin/claude.exe`
- Codex 桌面 CLI：`C:/Users/Administrator/AppData/Local/OpenAI/Codex/bin/bffc5354119c8421/codex.exe`
- WorkBuddy MCP 配置：`C:/Users/Administrator/.workbuddy/mcp.json`
- Codex 代理：`http://127.0.0.1:7890`

不要使用当前 npm 全局 Codex 0.130.0：它不能解析现有 `service_tier` 和新版模型目录。配置优先使用 Codex 桌面内置 0.154.0-alpha.6.2。

## 5. 失败重试与断点恢复

### 重试

外部 CLI 失败后按以下公式退避：

```text
min(max_seconds, base_seconds × 2^(attempt-1)) + 随机抖动
```

默认最多 3 次；无效输入、Schema 不通过和 GUI 未授权属于确定性错误，不应该无限重试。

### 幂等

每一步的输入、步骤名和配置会规范化后计算 SHA-256。恢复运行时，若：

1. 上次状态为 `success`；
2. 输入哈希未变化；
3. 记录的输出文件仍存在；

则跳过该步骤，并在 `events.jsonl` 记录 `step_skipped`。

### 状态恢复

`state.json` 通过临时文件加原子替换写入。进程中断后使用 `resume`，从失败或未完成步骤继续，不重复执行已通过的相同输入步骤。

## 6. 结果校验与质量闸门

1. Claude 输出必须通过对应 JSON Schema。
2. `code_result.status` 必须为 `success`。
3. PPTX 必须是有效 ZIP，包含 `[Content_Types].xml`、`ppt/presentation.xml` 和不少于任务要求的 `slideN.xml`。
4. WorkBuddy 审阅必须没有 blocker、`passed=true` 且达到配置分数阈值。
5. WorkBuddy 处于 `handoff` 时，运行状态为 `ready_for_review`，不会伪装成完成。
6. 豆包处于 `handoff` 时，运行状态为 `ready_for_ppt`。

## 7. GUI 自动化安全规则

Windows-MCP 阶段强制使用以下规则：

- 先观察界面，再操作。
- 每次只做一个小而可逆的动作，动作后重新观察并验证。
- 不删除、不覆盖用户文件，只保存到唯一的新输出路径。
- 不处理账号切换、支付、权限、安全设置或系统设置。
- 界面不明确、登录失效或路径冲突时立即停止。
- 未显式传入 `--allow-ui` 时，GUI 阶段直接拒绝执行。

## 8. 本机实测结果与限制

已完成的实测：

- Claude Code 2.1.141 非交互调用正常；架构设计实际使用 Claude Opus 4.7。
- Windows-MCP 已通过 Claude Code 成功调用，截图中能发现 WorkBuddy。
- 当前桌面 1 未发现豆包；系统存在两个虚拟桌面，因此豆包可能未启动或位于桌面 2。
- Codex 联网需要显式使用 `127.0.0.1:7890` 代理。
- Codex 可以生成代码文本；当前桌面内置 CLI 的本地 code-mode host 出现 Windows `os error 231`（所有管道实例都在使用），真实代码写入前建议重启 Codex 桌面端。
- WorkBuddy 没有稳定公开的无头 CLI/API，因此默认采用 handoff；当前 WorkBuddy 会话可读取审阅包并完成最终审阅。

建议首次使用顺序：

1. 先运行 `doctor`。
2. 再运行 `--dry-run`，确认状态、日志、PPTX 校验和 handoff 正常。
3. 重启 Codex 后执行一个小型真实代码任务。
4. 打开并登录豆包，把 `doubao.mode` 改为 `windows_mcp`，在有人监督时传入 `--allow-ui`。
5. 稳定运行后，再考虑把真实 GUI 步骤放入定时任务。

## 9. 测试

```bat
C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe -m unittest discover -s tests -v
```

当前测试覆盖：

- 哈希稳定性
- 敏感信息脱敏
- JSON Schema 必填项和额外字段
- PPTX 结构与页数
- 失败后指数退避重试
- dry-run 不调用外部工具
- resume 幂等跳过
- Windows-MCP 未授权时阻断
