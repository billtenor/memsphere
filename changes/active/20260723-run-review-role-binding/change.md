---
id: 20260723-run-review-role-binding
status: todo
type: feature
created: 2026-07-23
run_id: run-20260723-072257z-6dd9d3d4
---

# Run 创建期 Review Role Binding

## 需求

将 Artifact Review 的“评审角色声明”与“具体参与者绑定”拆分到正确的生命周期。

Procedure 负责声明哪些 Artifact 需要 Review、采用什么 Decision Policy，以及哪些 Role 应参与 Review；Procedure 和 Artifact 不再写死具体 Identity。创建 Run 时，系统根据当前项目的 Control Plane 配置列出本次流程涉及的 Review Role，由用户为每个 Role 选择一个或多个 Identity，或明确选择本次 Run 不绑定该 Role。

绑定结果属于 Run 实例配置。Run 创建后必须冻结本次使用的 Identity、Role、Permission、Binding、Decision Policy 和来源证据，后续配置或 Memory 变化不得静默改变运行中的 Review。这样同一 Procedure 可以跨项目、团队、环境和人员配置复用，不再依赖 `traex1`、`human` 等本地 Identity id。

未绑定 Role 会从本次 Run 的 Review 参与范围中移除：部分 Role 未绑定时，由剩余 Role 完成 Review；某个 Artifact 的全部 Review Role 均未绑定时，该 Artifact 不创建 Review 并按普通 Artifact 继续。系统必须在 Run 创建前清楚展示这一降级结果，并要求用户显式确认，不得因遗漏参数或配置错误静默减少 Review。

## 用户场景

- 用户启动一个声明了产品、研发、测试和架构 Review Role 的通用 Procedure，系统先列出这些 Role 及当前可用 Identity，再由用户决定本次分别由谁承担。
- 同一 Procedure 在不同 worktree、项目或团队中启动时，可以绑定不同 Agent/Human Identity，不需要复制或修改 Procedure YAML。
- 用户可以显式跳过当前环境暂时没有参与者的 Role；启动预检会展示哪些 Review 将减少参与者、哪些 Review 将被完全跳过。
- 一个 Role 可以由多个 Identity 承担，一个 Identity 也可以承担多个 Role；Run 和 View 能说明每个 Assignment 来自哪次 Run Binding。
- Procedure 通过 `!call` 使用子 Procedure 时，根 Run 创建阶段尽可能汇总全部可达 Review Role，避免运行到中途才发现缺少参与者。

## 范围

- 调整 Memory YAML 的 Review 控制面语法：
  - Procedure/Artifact 只声明 Review Policy、参与 Review 的 Role 和现有 Artifact 契约。
  - Identity Binding 不再保存在 Procedure 或 Artifact Memory 中。
  - Role 声明使用逻辑 Role id；Memory validate 校验语法和结构，不要求 Memory 引用某个项目的具体 Identity。
- 增加 Run 创建前的 Binding 预检：
  - 收集根 Procedure 和全部静态可达子 Procedure 中使用的 Review Role。
  - 展示 Role 名称、权限能力、可选 Identity、受影响 Artifact，以及绑定或跳过后的实际 Review 结果。
  - 未对每个 Role作出“绑定”或“显式跳过”选择时，不创建正式 Run。
- 支持在 CLI 创建 Run 时提交 Role Binding：
  - 同一 Role 可绑定一个或多个 Identity。
  - 支持显式跳过 Role，并区分“用户主动跳过”与“参数遗漏、Role 未定义、Identity 不存在”等错误。
  - 具体参数形式和是否提供 bindings 文件由技术方案确定。
- Run 创建必须原子完成：
  - 预检不留下半初始化、可误执行的 Run。
  - 全部选择确认后一次性创建 Run，并冻结 Control Plane 与 Run Role Binding 快照。
  - `runner` 继续由当前 Run 执行上下文隐式承担，不进入人工绑定列表。
- Review 运行时根据 Run Binding 创建 Assignment：
  - 未绑定 Role 不创建 Assignment。
  - Artifact 仍有绑定 Reviewer 时，按剩余 Role 和 Identity 执行 Review。
  - Artifact 的全部 Review Role 均未绑定时，不创建 Review，记录可审计的跳过原因并继续 Run。
  - 存在 Reviewer 但当前 Decision Policy 无法形成合法结论时，必须在创建 Run 前拒绝并解释，不得产生永久等待的 Review。
- `!call` 继承同一 Run 的 Binding；同一 Role id 在整个 Run 中复用同一绑定。
- 更新 Run/View 展示，使用户能够查看本次 Run 的 Role Binding、显式跳过项、来源和受影响 Review。
- 更新预置 Procedure，移除 `traex1`、`traex2`、`traex3`、`traex4`、`human` 等具体 Identity Binding。
- 为旧 `role_bindings` Memory 提供明确的 syntax migration 和诊断，不把旧 Identity Binding 静默复制成跨 Run 默认值。

## 验收标准

1. 一个 Procedure 可以声明 Review Policy 和参与 Role，但其 YAML 中不包含任何 Identity id；在两个具有不同 Identity 配置的项目中均能 validate 并进入 Run Binding 预检。
2. 启动含 Review Role 的 Procedure 且未提供 Binding 选择时，不创建正式 Run；CLI 返回全部待处理 Role、可用 Identity、受影响 Artifact 和下一步可执行操作。
3. 用户为全部 Role 明确选择 Identity 或跳过后，Run 一次性创建成功；Run 快照完整记录 Identity、Role、Permission、Binding、Decision Policy、来源和显式跳过项。
4. 同一 Role 绑定多个 Identity 时，每个 Identity 获得独立 Assignment；同一 Identity 承担多个 Role 时，Assignment 按既有规则合并权限并保留全部 Role 依据。
5. 部分 Role 被跳过时，只为剩余绑定创建 Assignment；View、CLI 进度和 Review Evidence 均不显示虚假的缺席 Assignment。
6. 某 Artifact 的全部 Review Role 均被显式跳过时，`run report` 不创建 Review，记录“本次 Run 无已绑定 Reviewer”或等价可审计原因，并按普通 Artifact 推进。
7. 参数遗漏、未知 Role、未知 Identity、Identity 重复、非法 Runner Binding 与显式跳过具有不同诊断；前六类错误不会被当作跳过处理。
8. 绑定后如果剩余参与者与 Runner 无法满足当前 Decision Policy 的决策要求，Run 创建被拒绝，并明确指出缺少哪类决策能力。
9. Run 创建后修改 `config.json`、Procedure 或 Artifact 的 Role 声明，不改变已冻结的 Binding 和后续 Assignment。
10. 根 Procedure 静态调用子 Procedure 时，预检会联合展示子 Procedure 所需 Role；进入子 Procedure 后不重复询问已处理的同名 Role。
11. 不含 Review 的 Procedure 保持现有一条命令直接启动行为，不出现无意义的 Binding 预检。
12. 旧 syntax 中的 `role_bindings` 不由新运行时继续解析；migrate 能识别并迁移 Role 声明，报告被移出的 Identity Binding，并要求用户在新 Run 创建时重新选择。
13. 预置敏捷需求开发流程不再引用具体 Identity，同一份安装副本可以由不同项目在 Run 创建时选择自己的产品、研发、测试和架构参与者。
14. 自动化测试覆盖无 Review、完整绑定、部分跳过、全部跳过、多人绑定、跨 Role 同 Identity、子 Procedure、无决策能力、快照冻结和旧 syntax migration。

## 不做事项

- 不把 Identity、Role 或 Permission 定义移出 `config.json`；本需求只调整 Role Binding 的所有权和创建时机。
- 不允许运行中的 Run 随意重新绑定 Role；中途增补或替换参与者如有需要，另行定义受权限控制的变更流程。
- 不改变 Comment、Vote、Review Round、Runner Vote 或 Decision Policy 的既有业务语义。
- 不在本需求中增加新的 Decision Policy。
- 不把某个团队的默认 Binding 写回 System Memory、Reserved Memory 或通用 Procedure。
- 不以隐式猜测、Role 名称相似度或历史 Run 自动选择 Identity。

## 关联需求

- 无重复需求。
- 强关联：`20260720-artifact-review-control-plane`。本需求修正其“Memory 持有 Identity Binding”的已交付边界，但复用 Identity、Role、Permission、鉴权和 Snapshot 模型。
- 强关联：`20260720-artifact-review-human-loop` 与 `20260720-artifact-review-agent-acp`。Human/Agent Assignment 改为消费 Run 创建期冻结的 Binding。
- 强关联：`20260720-artifact-review-compatibility-hardening`。旧 `role_bindings` syntax 的移除与迁移应纳入兼容收口。
- 相关：`20260722-view-config-management`。Identity/Role 定义仍由配置面板管理；Run Binding 选择属于 Run 启动体验，不属于静态配置编辑。
- 相关：`20260723-artifact-review-agent-dispatch-runtime`。Dispatcher 消费已经创建的 Agent Assignment，不负责决定 Role Binding。

## 技术与测试方案

待开发前补充。方案阶段重点确定：

- Procedure/Artifact 的 Review Role 声明字段及新 syntax version。
- CLI 预检、绑定、跳过和原子创建 Run 的命令协议。
- 是否以及如何在 View 中提供等价 Run 启动向导。
- 静态可达与动态 `!call` 的 Role 收集边界。
- Run Binding 与 Artifact 级 Role 选择、Permission Grant 的组合规则。
- 旧 `role_bindings` 的逐版本 migrate 输出和人工确认点。

## 开发任务

待开发前补充。

## 验收结果

尚未开始。
