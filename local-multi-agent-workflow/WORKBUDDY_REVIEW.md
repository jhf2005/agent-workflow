# WorkBuddy 审阅报告

## 结论

- 审阅状态：**通过（受控试运行）**
- 评分：**90/100**
- 代码级 blocker：无
- 生产运行 blocker：2 项环境条件，见下文

## 已确认

1. 编排器仅使用 Python 标准库，CLI 包含 `doctor`、`run`、`resume`、`status`。
2. 外部进程使用参数数组和 `shell=False`，设置单步超时、失败重试、指数退避和抖动。
3. 运行状态、步骤输入哈希、事件日志和产物清单落盘；状态文件使用临时文件加原子替换。
4. 相同输入恢复时能跳过全部已成功步骤；测试覆盖 5 个步骤的幂等跳过。
5. GUI 自动化默认关闭；豆包和 WorkBuddy 的 Windows-MCP 模式必须显式传入 `--allow-ui`。
6. Windows-MCP 提示词包含观察后操作、小步可逆、动作后校验、禁止删除/覆盖、只写唯一输出路径等约束。
7. PPTX 校验检查 ZIP 结构、`[Content_Types].xml`、`ppt/presentation.xml` 和最小页数。
8. WorkBuddy handoff 不会被标记为“已完成”，而是 `ready_for_review`。
9. 敏感字段会脱敏；已修复 `color_tokens` 被误判为凭据导致下游哈希变化的问题。

## 验证证据

- Python 编译：通过
- 单元测试：8/8 通过
- `doctor`：Claude、Codex、Windows-MCP 配置路径均通过
- dry-run：通过，生成 10 页结构有效的模拟 PPTX
- resume：通过，状态保持 `ready_for_review`
- Windows-MCP：已通过 Claude Code 实际调用，能观察到 WorkBuddy 窗口

## 生产运行前条件

1. **Codex 本地执行宿主**：桌面内置 CLI 当前出现 Windows `os error 231`（所有管道实例都在使用）。联网和纯文本代码生成正常，但真实文件编辑前应重启 Codex 桌面端并重新运行 `doctor` 与小型代码任务。
2. **豆包桌面状态**：当前桌面 1 未发现豆包。使用 GUI 模式前需启动并登录豆包；系统存在桌面 2，也需确认应用所在虚拟桌面。

## 建议

- 保持豆包和 WorkBuddy 默认为 `handoff`，先稳定运行 Claude + Codex 主链路。
- GUI 模式仅在有人监督时使用；首次运行先用小型任务和新的输出目录。
- Codex 桌面更新后若内置 CLI 路径变化，同步更新 `workflow.config.example.json`。
