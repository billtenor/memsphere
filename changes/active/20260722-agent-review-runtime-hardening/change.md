---
id: 20260722-agent-review-runtime-hardening
status: todo
type: feature
created: 2026-07-22
run_id:
---

# Agent Reviewer 运行时加固

## 需求

在 Traex ACP Agent Reviewer 已能完成真实 Artifact Review 的基础上，收紧 Reviewer 的实际运行权限、上下文成本和审计闭环，使系统声明的只读权限在执行层真实生效，并让多问题评审以更少、更稳定且可复核的交互完成。

本需求不改变 Artifact Review 的角色、投票和决策语义，只处理真实 ACP Smoke 暴露出的运行时可靠性问题。

## 问题与基线证据

基线 Run：`run-20260722-013510z-bab13f6d`。

- 测试工程师第一轮 Session `019f8776-a61d-7663-ab97-eb8c8967b6e7` 正确发现六项违规并提交 `request_changes`；第二轮 Session `019f8778-feb4-72b2-8b1f-3480fec55856` 正确核对修订产物并提交 `approve`。
- Prompt 声明 Workspace 只读，但 Traex `turn_context` 实际为 `workspace-write`，`project_roots` 可写且工具网络开启。权限目前主要依赖自然语言约束，Reviewer 可以绕过 Memsphere CLI 修改工作区或本地 Run 数据。
- 每个 Session 都注入与评审无关的完整 Skills/Plugins 清单。第一轮在第六条评论保存后已累计消耗 `144212` tokens，最终 Submit 轮次尚未被日志统计。
- 每项违规分别调用一次 `run review comment`；并发调用会按响应到达顺序保存，曾出现 `commentCount: 3` 先于 `commentCount: 2`，评审意见顺序不稳定。
- 两轮 Session 都在发出 `run review submit` 后结束，原始 JSONL 没有对应的 `function_call_output` 或明确终态；Run Store 虽记录为 `submitted`，Provider Session 本身无法独立区分成功提交与意外中断。
- `run artifact show` 对第一轮语义不合格的 Artifact 返回 `validation.status: passed`。该状态实际只代表 type/format/schema 的程序化校验，容易被误解为 Review Contract 已通过。

## 范围

- **执行层只读隔离**：Agent Reviewer 的 Provider Session、Shell 和文件工具必须真实限制为 Workspace 只读；不得依靠 Prompt 代替沙箱。Reviewer 对 Review Store 的 Comment/Submit 写入只能经 Session Bridge 的窄接口完成。
- **最小权限运行环境**：默认关闭 Reviewer 不需要的工作区写权限和工具网络；确有读取范围或 Provider 运行依赖时显式声明，失败时 fail closed 并形成可见诊断。
- **Reviewer 专用上下文**：Agent Review Session 不注入无关 Skills、Plugins、工具说明和交互式开发规则，只保留评审任务、冻结契约、自然语言权限、必要查询命令和完成条件。
- **批量有序提交**：提供一次性提交有序 Comments、Vote 和 Summary 的原子 CLI/API；保留现有逐条 Comment 能力用于 Human/View 和渐进式使用。并发写入必须具有稳定顺序和幂等语义。
- **提交响应与终态闭环**：Worker 只能在 Submit 响应已返回并可被 Provider Session 日志观察后结束；Session、Attempt 和 Run Store 使用关联 ID 记录一致的成功或失败终态。
- **分层超时**：Agent Identity 分别配置启动超时、基于 ACP 活动自动续期的空闲超时和绝对最大运行时；最大运行时允许显式关闭，避免持续正常工作的复杂 Review 被固定总时限误杀。
- **校验状态分层**：Artifact 查询结果明确区分程序化结构校验与 Artifact Review Contract 结论，避免使用无上下文的 `validation.status: passed` 表达两种不同语义；兼容既有调用方。
- **成本与诊断指标**：记录每个 Attempt 的模型轮次、输入/缓存/输出 tokens、CLI 调用次数、耗时和停止原因，支持在 View 或调试证据中定位异常成本。

## 不做事项

- 不改变 `artifact_acceptance.unanimous` 等 Decision Policy，也不改变 Runner、Human 或 Agent 的 Vote 权重。
- 不调整 Reviewer 的业务 Prompt 内容、Role `system_prompt` 或 Artifact Contract 语法。
- 不实现远程 ACP、Agent 模型路由、跨 Run Session 复用或语义结果缓存。
- 不要求原始 Provider JSONL 成为业务真相来源；Run Store 仍是权威状态，但两者必须能通过关联 ID 和明确终态相互核验。
- 不在本需求中处理完整 Evidence View、历史 Review 迁移或旧 Task Review 退役。

## 验收标准

- 在真实 Traex ACP Session 中，Reviewer 尝试创建、修改或删除 Workspace 文件均被执行层拒绝；读取 Artifact、Run、Memory 和 Workspace 的授权内容仍可正常完成。
- Reviewer 无法直接修改 `.memsphere/runs` 或伪造 Review Store 数据，只能通过绑定当前 Assignment 的 `review comment/submit` 写入自己的意见和投票。
- Reviewer 默认工具网络不可用于任意外部请求；若 Provider 的模型通道不受该工具网络开关影响，真实 Traex Review 仍能正常运行。
- 记录的 Reviewer Prompt/Developer Context 不再包含与 Artifact Review 无关的 Skills/Plugins 清单；简单通过场景只需读取 Artifact 和提交 Vote。
- 六项违规基线用例能用一次 Artifact 查询和一次原子提交保存六条有序 Comment、`request_changes` Vote 与 Summary；重试不重复追加意见，View 顺序与提交顺序一致。
- 与基线第一轮相比，六项违规用例的模型总输入 tokens 至少降低 50%；自动化测试记录比较口径，真实 Traex Smoke 提供测量证据。
- 成功 Submit 在 Provider Session 中存在匹配的调用响应和明确成功终态；Worker 随后退出，Attempt 记录 `stopReason: submitted`。Submit 失败或响应未确认时不得记录成功。
- Agent 在启动阶段停滞、运行后无活动、持续有活动和持续活动但超过总上限四种场景分别得到正确结果；省略 `max_runtime_ms` 或设为 `null` 时，持续活动不会因总运行时被终止。
- `artifact show` 明确标注结构校验阶段，并单独展示当前 Review 状态；第一轮用例不会再以一个无上下文的 `passed` 暗示 Artifact 已满足语义契约。
- Fake ACP 覆盖只读拒绝、批量提交、并发顺序、重复提交、Submit 响应排空和进程中断；真实 Traex 两轮 Smoke 继续得到第一轮要求修改、第二轮通过的正确结论。
- Human-only Review、逐条 Comment、无 Review Artifact 和 Memory Review 回归保持通过。

## 关联需求

- 前置：`20260720-artifact-review-agent-acp`。
- 关联：`20260720-artifact-review-compatibility-hardening`；本需求聚焦真实 Agent Reviewer 暴露出的运行时问题，兼容迁移与全局可靠性收口仍由后者负责。
- 基线 Review：`review-20260722-013526z-201e5d88`。

## 技术与测试方案

待开发前结合 Traex ACP 的沙箱参数、Session 生命周期和可裁剪上下文能力补充。方案必须优先证明执行层权限，而不是只检查 Prompt 文案；成本测试使用固定 Artifact、固定契约和固定 Reviewer 配置进行前后对比。

## 开发任务

- [ ] 验证并修复真实 Provider Session 的只读沙箱和工具网络边界。
- [ ] 建立 Agent Reviewer 最小上下文与工具配置。
- [ ] 设计并实现批量、有序、幂等的 Review Submit。
- [ ] 补齐 Submit 响应排空、Provider Session 终态和 Run Store 关联审计。
- [ ] 拆分启动、空闲和最大运行时超时，并支持无限最大运行时。
- [ ] 区分结构校验状态与 Review Contract 状态并保持 API 兼容。
- [ ] 增加成本指标、Fake ACP 回归和真实 Traex 基线对比。

## 验收结果

尚未开始。
