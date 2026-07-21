---
id: 20260720-artifact-review-human-loop
status: doing
type: feature
created: 2026-07-20
run_id: run-20260721-060413z-6e9a7be9
---

# Human Artifact Review Loop

## 需求

在控制平面基础之上交付第一个可用的 Artifact Review 闭环。配置了 Review Policy 的 Artifact 在 `run report` 后不再立即推进，而是创建完整 Review 及其首个 Round，等待全部 Human 在 View 中完成 Comment、Vote 和 Submit Review。具有 `decision.decide` 的 Human Vote 进入 Policy，只有 `decision.assess` 的 Human Vote 只提供建议；Runner 具有 `decision.decide` 时必须阅读全部意见并显式投票。主 Agent 使用 `run review wait` 阻塞；未通过时修改 Artifact、提交 Revision Summary 并在同一 Review 中进入下一轮，直至通过。

本需求是父 Epic 的第 2 个串行子需求，优先验证产品交互和多轮状态机，不引入 Agent Reviewer。

## 范围

- Artifact 支持引用 Decision Policy 的 `review` 配置，并通过 Memory Role Binding 解析 Runner 与 Human Review Assignment，以及各参与者是否具有决策权。
- `run report` 保留确定性 Artifact Validation；通过后创建 Review、Submission、Round 和 Human Review Assignment，返回跨轮次稳定的 `review_id`、当前单轮的 `review_round_id` 与等待命令。
- 新增 `memsphere run review wait --review <review_id>`：
  - 阻塞到所有 Assignment 完成或进入明确终态。
  - Review 已结束时立即返回持久化结果。
  - 等待中断不取消 Review，可用同一 id 重新等待。
  - Human 全部提交后返回完整意见；如 Runner 有决策权则进入 `awaiting_runner_vote` 并给出显式投票命令，否则直接返回结算结果。
  - 通过时直接返回下一条 Procedure 指令；未通过时返回完整意见和重报指令。
- 首版固定使用 `all_assigned + unanimous`：全部 Human Assignment 都要正式提交；unanimous 只统计具有 `decision.decide` 的 Human Vote 和 Runner 显式 Vote，assess-only Human 的 Vote 不参与结果。Human Vote 支持 `approve`、`request_changes`、`abstain`，Runner Vote 支持 `approve`、`request_changes`。
- Runner 具有 `decision.decide` 时使用与 Human 相同的 Vote 模型，但不自动通过。Human 决策票仍有可能达成 unanimous 时，`review wait` 返回全部意见，Runner 再执行 `memsphere run review vote`；Runner 的授权证据、Vote 与可选 Comment 一并持久化。
- Run View 提供当前 Artifact、要求、Comment、Vote、Submit Review 和参与进度，明确区分决策者与建议者；草稿不参与汇总。
- Task 列表显示待评审状态与 Human 提交进度；选中后中间区域渲染当前待评审 Submission，右侧 Artifact Review 面板负责 Identity、Comment、Vote、Submit、参与进度和 Round 汇总，避免在窄面板重复整份 Artifact。
- Identity 选择只列当前 Human Assignment，单人自动选择，多人恢复有效的最近选择或显式选择；每次 API 读取和变更仍按 `identity_id + review_id + review_round_id` 服务端鉴权。
- Comment 与 Vote 在 Submit 前是当前 Identity 的私有持久草稿，正式 Submit 后不可修改并对其他参与者可见；反对意见必须有 Comment。提交前使用不可撤回确认，所有禁用状态必须说明具体原因。
- 参与进度区明确显示 Human 的“决策票/建议票”和 Runner 的待投票/已投票状态；汇总区分别展示正式票数、是否通过以及 assess-only 建议。历史 Round 可只读切换并展示 Revision Summary，本期不做 diff。
- 轮询不得覆盖正在编辑的草稿；过期 Round/revision 返回冲突并保留未提交文本。桌面宽度下内容区与评审区之间提供可拖拽、可键盘调整且记忆宽度的分隔条；紧凑宽度使用“内容/评审”分段视图。全部新增交互提供 zh-CN/en、键盘焦点和非颜色状态表达。
- 未通过后当前 Action 不推进；主 Agent 使用 `run report --revision-summary-file` 原子提交新 Artifact 和修改摘要，创建下一轮。
- 持久化完整 Review，以及全部 Submission、Round、Assignment、Comment、统一 Vote、Vote 权限/自动标记、Round Result、Revision Summary 和最终 Outcome。
- 对 submit、assess、wait/read 使用第 1 个需求提供的 Identity、Role Binding、Permission 与 Snapshot 执行真实鉴权。

## 不做事项

- 不启动 Agent Reviewer，不实现 ACP Client 或 Agent Review CLI。
- 不实现 any/min approvals、Challenge、Override 等扩展治理。
- 不采集 Workspace Snapshot，不展示文件 diff 或复杂历史对比。
- 不废弃旧 `kind: task` Review；Memory Review 保持不变。
- 不提供 Human Review 操作型 CLI。

## 验收标准

- 未配置 `review` 的 Artifact 保持现有 report/推进行为。
- 配置 Review 的 Artifact 在确定性 Validation 通过后创建 Human Review Assignment，Action 保持 review 状态且 report 返回稳定 `review_id`；不存在 Human Assignment，或 Human 与 Runner 合计不存在任何 `decision.decide` 主体时拒绝启动 Review。
- Validation 失败时不创建 Review 数据、不唤起 Human、不推进 Action。
- Human 可完全在 View 中添加 Comment、选择 Vote、Submit；未 Submit 的草稿不计票。
- View 从 Task 待评审入口可完成身份选择、Artifact 锚定评论、Vote、不可撤回确认、提交和多轮只读查看；决策票/建议票及 Runner 待投票/已投票状态在界面上不会混淆。桌面端可拖动内容与评审之间的分隔条调整两侧宽度，刷新后恢复最近宽度，且不会把任一侧压缩到不可用。
- 切换 Identity 恢复各自私有草稿；正式意见不可修改。轮询和 `409` 过期冲突不会丢失正在输入的 Comment，也不会把旧 Round 草稿提交到新 Round。
- `review wait` 能长期阻塞、在最后一份 Human Review 提交后自动返回统一 Vote 汇总；需要 Runner 决策时返回 `awaiting_runner_vote` 和可执行命令，断线可重连，并且不依赖 View 服务维持等待状态。
- assess-only Vote 不改变结果；Human Decider 的 `request_changes` 或 `abstain` 使 unanimous Round 直接未通过。Runner 有决策权且 Human 决策票未否决时必须显式投票：`approve` 才接纳并推进，`request_changes` 必须附意见并进入返修。Runner 是唯一决策者时同样不得自动通过。
- 第二轮通过后只接受最新 Artifact，并原子关闭 Review、推进一次 Action、返回下一条 Procedure 指令。
- 每轮历史不可覆盖；并发 Submit、重复 report 和重复 wait 不产生两个 Result 或重复推进。
- 未绑定/无权限 Identity 不能提交 Artifact 或 Human Review，拒绝操作可审计且不改变状态。
- 自动化 Smoke 覆盖“首轮要求修改 -> 主 Agent重报 -> 第二轮 Human 通过 -> Run 推进”。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 前置：`20260720-artifact-review-control-plane`。
- 后续：`20260720-artifact-review-agent-acp`，在本闭环上增加自动 Agent Reviewer。

## 技术与测试方案

### 状态与策略

- 在当前 Run v3 中增加可选 `artifactReviews`，不增加 v4，不重命名既有 `contractVersion`。Review 保存稳定 id、候选 Submission、逐轮 Round、Human Assignment、私有 Draft、统一 Vote、Result、Revision Summary 和最终 Outcome。
- `!artifact.review` 是当前 `memsphere-20260721-stable` 的向前兼容可选字段。未配置时继续走原 report 快速路径；配置时先完成 type/format/schema 校验，再创建 Review，候选在通过前不进入 Run Event。
- `artifact_acceptance.unanimous` 固定采用 `all_assigned`。Human Assignment 按 Identity 合并 Role 权限；`decision.decide` 是决策票，只有 `decision.assess` 是建议票。Runner 有 `decision.decide` 时在 Human 提交完成后进入独立待投票状态，不预创建 Vote。
- Run 启动阶段和 report 阶段都校验控制平面、Runner `artifact.read`、至少一位 Human Assignment 以及至少一个决策主体；失败不写入 Review 或候选文件。

### CLI 与状态机

- `run report` 在首轮返回 `review_id`、`review_round_id` 和 `memsphere run review wait --review <id>`。pending 时同内容重报幂等，不同候选拒绝。
- `run review wait` 直接轮询 Run 持久状态；Review 已结束或进入 `awaiting_runner_vote` 时立即返回。Runner 使用 `run review vote --review <id> --round <id> --vote approve|request_changes` 显式决策，要求修改时必须提供 `--comment` 或 `--comment-file`。
- 最后一位 Human Submit 在 Run 写锁中判定是直接返修、直接结算，还是等待 Runner Vote。只有最终 unanimous 通过时才把当前 Submission 加入 Event 并推进一次；未通过时完整保留当轮意见和候选，等待 Runner 修订。

### View 与 API

- `/api/runs` 和 `/api/runs/:id` 使用公共投影，只返回当前评审摘要与 Human 进度，不返回候选、私有草稿或内部授权证据。
- 独立 Artifact Review API 按 `review_id + review_round_id + identity_id` 读取，服务端重新鉴权；Draft PATCH 和 Submit POST 都携带 expected revision，过期写入返回 `409`。
- Task 卡片和顶部 Review 按钮展示待评审进度；中间当前节点显示经身份授权后的候选 Artifact，右侧抽屉提供身份选择、决策票/建议票、私有评论、投票、不可撤回确认、参与进度、提交意见和历史 Round 摘要。
- 多 Identity 选择和桌面评审区宽度保存在浏览器本地，但授权只认 Run Snapshot。普通轮询在编辑器中存在未提交文本时不替换 DOM；紧凑宽度下 Review 抽屉切换为独占视图，避免内容与操作重叠。

### 验证

- 单元测试覆盖 Assignment 合并、Runner 显式通过/要求修改、旧自动票兼容、无 Human/无决策者拒绝、advisory 不参与 unanimous、Human 反对导致失败、重复 report 和即时 wait。
- API 测试使用两位 Human 真实启动 Run，断言公共 Run 接口脱敏、A 的 Draft 对 B 不可见、stale revision 返回 `409`、正式意见公开，以及最后一票只推进一次。
- Playwright 覆盖 View 中 Identity 切换、私有 Draft 恢复、决策票/建议票文案、确认 Modal、两位 Human Submit 和最终 Artifact 接纳。
- 最终门禁执行 `npm run typecheck`、`npm test`、`npm run build`、`node dist/cli.js validate`，并对当前 worktree View 做人工验收。

## 开发任务

- [x] 增加 `!artifact.review` AST、parser、serializer、静态治理校验和 Run Step 快照。
- [x] 实现 Artifact Review 领域模型、Assignment/统一 Vote 与 unanimous 结算。
- [x] 重构 report 接纳边界，支持首轮、幂等、返修轮、Revision Summary 和单次推进。
- [x] 增加 `run review wait`、`run review vote` 与 report 修订摘要参数。
- [x] 增加 View 公共投影、受保护 API、私有 Draft、鉴权和 revision 冲突。
- [x] 增加 Task 待评审入口、中间候选展示、右侧 Human Review 操作与多轮摘要。
- [x] 更新语法预置记忆、已安装记忆、Skill 和 README 的兼容演进规则与 Review 用法。
- [x] 增加领域、Run、API 和 Playwright 自动化测试。
- [ ] 完成全量门禁、可复现 smoke 和提需方人工验收。

## 验收结果

尚未开始。
