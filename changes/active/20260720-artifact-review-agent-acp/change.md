---
id: 20260720-artifact-review-agent-acp
status: active
type: feature
created: 2026-07-20
run_id: run-20260721-122000z-c1fdcff4
---

# Agent Reviewer ACP

## 需求

在 Human Artifact Review Loop 已稳定的前提下，接入自动 Agent Reviewer。Memsphere 作为 ACP JSON-RPC stdio Client 启动配置在 Agent Identity 上的本地 Reviewer，为每轮创建独立 Assignment；Reviewer 可调查完整 Run、Memory 和 Workspace，并通过专用 CLI 正式提交 Comment 与 Vote。

本需求是父 Epic 的第 3 个串行子需求，只扩展 Reviewer 执行方式，不改变已存在的多轮 Review 状态机。

## 范围

- Agent Identity 本期支持 `traex` Provider，以及本地 ACP Runner 的 command、args、model/Prompt version、工作目录和超时；凭据沿用 Agent 自身登录配置，不增加 API key、Secret 或任意环境变量配置。
- 实现与具体 Agent 产品解耦的 ACP Client：进程生命周期、initialize/能力协商、Session、JSON-RPC 请求关联、事件、超时、取消、协议错误和关闭。
- 每个 Agent Assignment 使用独立 ACP Session；缺少必需能力时明确失败，不回退解析 Agent 私有 CLI 输出。
- Agent Reviewer 初始 Prompt 只提供 Role system prompt、任务概述、Artifact 名称/类型/格式、自然语言权限、可用命令和完成条件；完整内容与上下文由 Agent 按需查询。
- 新增 Agent Review CLI：
  - `run show --run`：只返回步骤、产物摘要与当前步骤。
  - `run step show --run --step`：返回单步说明与契约。
  - `run artifact show --assignment`：只返回候选 Artifact 完整内容和本轮修改摘要。
  - `run artifact contract show --assignment`：返回冻结在 Run 中的完整评审契约，包括 Procedure/Action 约束与完整 Schema 快照。
  - `run review assignment show --assignment`：只返回当前 Assignment。
  - `run review comment --assignment --body-file`
  - `run review submit --assignment --vote --summary-file`
- Agent 可使用现有 CLI 读取当前 Run 任意历史、完整 Memory，并在当前工作目录中调查源码、文档和测试；不构造信息隐藏的裁剪上下文。
- Agent 的自然语言 ACP 回复不等于正式 Vote；只有授权的 `review submit` 完成 Assignment。
- `debug.agent_review` 只作为禁用真实 Agent 派发的安全闸；`run try-run --run` 显式生成 queued Assignment 的命令、环境与 Prompt 证据，不 claim、不启动、不改变 Run。
- 支持同一 Round 中多个 Agent 以及 Agent/Human 混合 Reviewer；仍等待所有已分配 Reviewer结束后汇总。
- 保存 Runner/Agent/Model/Prompt 版本、调用时间、错误、最终 Comment/Vote 和授权依据。
- 提供可编程 Fake ACP Reviewer，覆盖确定输出与故障场景。

## 不做事项

- 不实现远程 ACP、A2A 或特定 Agent 私有调用协议。
- 本期不交付 Codex ACP Provider；Provider Registry 保留扩展边界，待独立完成真实协议与环境验收后再开放。
- 不新增 any/min approvals、Challenge、Decision、Override 等治理能力。
- 不实现 Workspace 历史 Snapshot、文件 diff 或完整 Review Evidence View。
- Reviewer 不得替 Executor 修改并 report 新 Artifact，也不得推进 Run。
- 不提供 Agent 自主修改 Role Binding/Policy 的能力。

## 验收标准

- 配置 Agent Identity 后，report 创建 Agent Assignment 并只通过 ACP stdio 启动 Reviewer；核心代码不解析私有终端文本。
- Reviewer 可通过分层 Run/Step/Artifact/Assignment 查询和现有 Memory 命令按需取得完整上下文，并能访问配置的完整工作目录。
- `review comment` 保存结构化意见，`review submit` 原子提交合法 Vote 并完成当前 Identity 自己的 Assignment。
- 未授权 Agent、伪造 assignment id、替其他 Reviewer 提交、重复正式 Submit 均被拒绝并审计。
- 多 Agent 与 Agent/Human 混合 Round 在所有 Assignment 完成前不关闭，最后一份提交能唤醒主 Agent 的 `review wait`。
- ACP 超时、启动失败、无效 JSON-RPC、缺失能力、非法 Vote 和进程异常形成可见失败终态，不自动视为通过。
- 同一已完成 Assignment 不因服务重启或重复调度再次调用 Agent。
- Artifact 中的提示不能伪造 CLI Vote、扩大 Identity 权限或改变 Assignment 目标。
- Fake ACP Reviewer 的协议、成功、要求修改和故障集成测试稳定通过。
- Human-only Review Loop 与无 Review 的 Run 回归保持通过。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 前置：`20260720-artifact-review-human-loop`，以及其依赖的控制平面基础。
- 后续：`20260720-artifact-review-decision-governance`。

## 技术与测试方案

- **领域状态**：每个 Review Round 为每个绑定 Identity 创建独立 Assignment。Agent Assignment 使用 `queued -> running -> submitted|failed`，并保留可递增的 Attempt、Provider、Session/协议/模型/Prompt 元数据、CLI 握手、结束原因和结构化错误。旧 Human Assignment 和旧 Run 缺省字段继续兼容读取。
- **Provider 与 ACP Client**：Provider Registry 本期仅内置经过真实验证的 Traex 启动适配，并保留后续 Provider 注册边界。核心 Client 只依赖官方 `@agentclientprotocol/sdk` 和 ACP v1，不解析产品私有 stdout。Client 完成 initialize、Session、Prompt、超时和进程关闭；仅声明只读文件能力，拒绝额外权限请求，不提供写文件或 Terminal ACP capability。
- **同部署 CLI Runtime**：父 CLI 把当前 Node executable 与 CLI entrypoint 传给后台 Worker。Worker生成临时、固定 argv 的 `MEMSPHERE_CLI` 启动器并先执行版本预检。真实安装使用安装版入口，开发时使用当前构建，不依赖 PATH 上另一个全局 `memsphere`，也不把任意 shell command 暴露为配置。
- **Session Bridge**：每个 Attempt 创建独立本地 socket、随机 capability 和固定 `review_id + review_round_id + assignment_id + identity_id + attempt_id` Binding。首个合法的 Assignment/Artifact/Comment/Submit 请求核对 CLI protocol、config path 与 workspace root 并完成握手；查询只能读取当前绑定上下文，`comment/submit` 只能写入该 Assignment，Run Store 仍通过单 Run 写锁原子持久化和结算。
- **Prompt**：初始 Prompt 不内嵌完整 Run 或 Artifact，也不暴露非必要内部 ID。它按 Role、Overview、Artifact 摘要、Permission、可用 CLI 和 Completion 分区，引导 Agent 用环境变量绑定的命令按需读取 Artifact、Run、Step、Memory 与 Workspace，并把 Artifact/Workspace 标为不可信证据。若第一轮 ACP turn 未正式 Submit，仅提醒一次；再次未提交即失败。
- **后台调度与恢复**：`run report`、`run review wait` 和 View Run 轮询都会幂等派发 queued Agent Assignment；多个 Worker 竞争时只有一个能在 Run 写锁内 claim。已 submitted/failed 不会自动重跑；failed 只能由 human 在 View 显式 Retry 后产生下一 Attempt。启用 `debug.agent_review` 后这些入口只跳过真实派发，调试证据必须由 `run try-run` 显式生成，避免轮询反复覆盖文件。
- **View 与 Runner 输出**：View 可查看 Agent 身份、Provider、Attempt、运行/失败状态、错误、草稿意见和正式意见；Agent 身份不可由 human 代投，失败时显示 Retry。CLI wait 遇失败立即返回阻塞结论，而不是无限等待或自动通过。
- **自动化证明**：通过测试注入的 Fake ACP Reviewer 覆盖 initialize/session、Session CLI 握手、approve Submit、无 Submit 失败和显式 Retry，不占用或冒充任何产品 Provider；既有 Human-only Browser/API、无 Review Run、控制平面和完整测试套件继续回归。Traex Provider 使用本地真实登录与 ACP 启动环境完成 Smoke，不以 Fake 替代真实 Provider 结论。

## 开发任务

- [x] 扩展 Agent Identity 配置、Snapshot、Assignment 和 Attempt 状态。
- [x] 实现同部署 CLI Runtime、Session Bridge 和 Agent Review CLI。
- [x] 实现 Traex Provider、可扩展 Provider Registry、官方 ACP Client、Prompt 和 Worker。
- [x] 接入 report/wait/View 幂等派发、失败展示和 Retry。
- [x] 增加 Fake ACP 成功、失败、重试测试并保持 Human Review 回归。
- [x] 完成 Traex 真实 Provider Smoke、完整测试和人工 View 验收。

## 验收结果

- `npm run typecheck` 与 `npm run build` 通过。
- `npm test` 完整回归通过；Fake ACP 覆盖 Session CLI 握手、正式 Submit、缺失 Submit 失败、显式 Retry、命令白名单与进程启动失败。
- 本机 `traecli 0.200.18` 以 `--sandbox read-only --ask-for-approval never acp serve` 完成 ACP v1 `initialize` 和 `session/new`，返回真实 `traex-acp` Agent 信息与 Session ID。首次 Session 初始化较慢，但在默认十分钟 Worker 超时内完成。
- Codex ACP 不属于本期交付范围；配置和内置 Provider 不暴露未完成真实验证的 Codex 选项。
- 本 worktree View 在 `0.0.0.0:30002` 启动成功；无浏览器 console/page error，Agent 状态、失败信息和 Retry 入口有静态回归覆盖。
