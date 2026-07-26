---
id: 20260722-schema-artifact-composition-review
type: feature
created: 2026-07-22
completed_at: 2026-07-22
run_id: run-20260722-065730z-49b6ccee
---

# Schema Artifact 增量写作上下文与 Review 门禁

## 需求

Memsphere 使用 Schema 将复杂 Artifact 拆成可逐项上报的字段，并在最后自动组装完整文档。真实使用表明，这条链路当前存在两个会相互放大的问题：

1. Agent 在字段填写阶段主要看到当前节点，难以持续掌握父 Artifact 的阶段职责、根约束、祖先约束、已完成内容和剩余结构，容易产出局部合格但整体重复、越界、矛盾或时序倒置的长文档。
2. Schema frame 完成后直接组装 Artifact、写入 Event 并推进父 Action，没有进入父 Artifact 已配置的 `artifact_acceptance.unanimous` Review，导致产品、架构和 Human Review 失去门禁作用。

本需求要补齐 Schema 增量写作所需的全局上下文，并让最终组装 Artifact 与普通 Artifact 复用同一套提交、确定性校验和 Artifact Review 接纳语义。系统不尝试用代码判断自然语言是否正确，也不新建一套与 Artifact Review 重叠的 Semantic Review。

原始用户反馈保存在 [`assets/user-feedback.md`](./assets/user-feedback.md)。附件中的状态名、命令和解决方案只作为问题线索；本需求以 Memsphere 现有 Artifact Validator、Run 和 Artifact Review 架构为准。

## 用户心声

- 我愿意按 Schema 分段填写复杂文档，但每次只看到当前字段，会逐渐失去对整篇文档职责和结构的把握。
- 我希望开始填写第一个字段前先看到整份 Schema 的概览、填写顺序和最终产物要求，而不是进入字段后才一点点猜测整体结构。
- 我需要随时知道自己正在为哪个 Action、哪个 Artifact、哪个章节工作，哪些约束仍然生效，前面已经写了什么，后面还剩什么。
- 我需要每次填写完字段后都立即更新同一份最终 Artifact 草稿，并得到稳定文件路径，随时用熟悉的文档工具查看当前完整效果。
- 我希望全部字段填写完成后，系统明确提醒我从全局阅读和调整整份草稿；我可以直接编辑该文件，再显式提交最终候选。
- 我在生产 Artifact 时只需要看到会影响内容生产的信息；Review Policy、参与者、权限、轮次和投票等后续评审信息不应混入写作上下文。
- `validation.status = passed` 只能说明 type、format 和 schema 等确定性契约通过，不能让我误以为自然语言质量和正式评审也已通过。
- Procedure 明确配置 Review 后，我期待 Reviewer 真正看到最终组装文档并形成门禁；Review 没通过之前，后续 Design、Test 或 Tasks 不能开始。

## 已确认事实

- 普通 `run report` 在确定性 Validator 通过后会检查 `reviewPolicy`，配置 Review 时进入 `reportReviewedArtifact`。
- Schema frame 收束由 `collapseCompletedFrames` 单独完成；当前逻辑直接组装、创建父 Artifact Event 并递增父 frame index，没有检查父步骤的 `reviewPolicy`。
- 问题 Run `run-20260722-063807z-376729d1` 是 Run v3，Proposal 与 Design 父步骤均保存 Review Policy、Role Binding 和 Control Plane，但 `artifactReviews` 为空，父步骤已经推进。
- 当前 Schema 子步骤只携带当前节点的 `defines/asserts`；父 Action、父 Artifact 契约、根与祖先约束、整体进度和累计草稿没有形成清晰的统一提示。
- Artifact Validator 只负责可编码的 `type -> format -> schema` 校验。自然语言 `asserts`、阶段边界和跨章节一致性应由 Runner 与配置的 Reviewer 判断。
- Artifact Review 已有 Submission、不可变 digest、多轮 Round、Agent/Human Assignment、Comment、Vote、Runner 显式决策和单次推进能力，应直接复用。

## 整体目标

1. Schema 字段填写启动时先提供经过相关性裁剪的整体概览，填写期间持续提供足够但不过载的生产上下文，使 Agent 知道当前字段在完整 Artifact 中的位置和职责。
2. 每次字段上报后都更新同一份可恢复、可直接编辑的最终 Artifact 草稿，并向用户和 Agent 暴露稳定文件路径。
3. 全部字段完成后先进入 Runner 全局调整检查点；Runner 显式提交最终文件后，候选才进入父 Artifact 的统一接纳链路，配置 Review 时不得绕过正式门禁。
4. CLI、View 和 Run 记录清楚区分字段进度、确定性校验和 Artifact Review，不再让一个 `passed` 承担整体合格语义。
5. 保持现有 Memory YAML、Artifact Contract、Role Binding 和 Decision Policy 兼容，不要求迁移已有 Memory。

## 当前迭代范围

### 1. Schema 写作全局上下文

首次进入 Schema frame 时，系统必须先展示一次整体概览，包括：

- 父 Procedure Action 与父 Artifact 的目标和内容契约。
- 完整 Schema 结构、根约束、字段总数、预计填写顺序和当前起点。
- Schema 增量写作、持续草稿更新、最终全局调整和最终提交之间的关系。

进入具体字段后，当前 Schema 字段提示必须提供或明确链接到以下信息：

- 父 Procedure Action 的动作、断言和建议。
- 父 Artifact 的名称、type、format、Schema 和 final 等内容契约。
- 根 Schema、祖先 Schema 和当前 Schema 节点仍然生效的 `defines`、`asserts`、type 与 format，并能辨认约束来源。
- 当前字段在完整 Schema 树中的路径。
- 总体字段数量、已完成字段、当前字段、剩余字段和相邻字段名称。

默认 `run status` 输出应保持简洁，不在每个字段重复注入所有已写正文。完整结构、字段结果和累计草稿通过明确的 CLI 查询入口按需读取；首次整体概览在后续状态中保留可重复查询的入口。

Artifact 生产上下文必须按“是否影响当前内容生产”进行裁剪：

- 保留父 Action 的动作、断言、建议，父 Artifact 内容契约，生效的 Schema 约束，字段进度和受管草稿入口。
- 不注入 Review Policy、Reviewer/Role Binding、Permission、Assignment、Review/Round ID、Comment、Vote、Decision 以及其他仅影响后续评审的控制面信息。
- 不注入 Run 存储布局、内部 frame、digest 或调试元数据；稳定草稿路径等 Agent 实际操作所需的信息除外。
- 不整段复制与当前写作无关的 Run 历史或 Workspace 内容；需要时由 Agent 通过明确查询命令按需读取。
- 只有最终候选提交并实际进入 Artifact Review 后，Review 信息才在独立的评审上下文中展示，不得反向污染 Schema 字段提示和全局调整提示。

### 2. 稳定累计草稿与进度查询

- 第一个字段上报后，系统必须创建父 Artifact 的受管草稿文件；此后每个字段上报都重新组装并原位更新同一路径，而不是生成需要用户猜测的新文件。
- Schema 填写过程中，Runner 可以随时查看该累计草稿；尚未填写的字段应明确为空缺或未完成，不得伪装成已接纳 Artifact。
- `run status` 和专用查询命令必须直接返回草稿文件的绝对路径、当前进度和草稿状态，不要求 Agent 读取 Run JSON、理解 Run 目录布局或自行寻找文件。
- 草稿内容应来自 Run 中已持久化的字段 Event 和冻结 Schema；磁盘草稿丢失时应能重建，CLI 断开或进程重启后必须继续使用同一逻辑草稿。
- 查询必须区分字段级中间结果与父 Artifact 最终候选，并支持机器可读输出，供 ACP Reviewer、View 和后续工具复用。
- 草稿文件在 Runner 最终提交前是可编辑工作副本，不得提前写入父 Artifact 已接纳 Event，也不得触发正式 Artifact Review。

### 3. 最终全局调整与提交

- 最后一个 Schema 字段完成后，系统更新受管草稿、执行父 Artifact 的确定性 Validator，并进入“等待 Runner 全局调整”状态；此时不得写入父 Artifact 已接纳 Event、推进父步骤或启动后续接纳流程。
- 最后一次自动组装的父 Artifact 即使结构/契约校验失败，也应保留已通过字段级校验的最后一个字段和完整草稿，并把失败结果带入全局调整状态，不得回滚字段进度迫使 Runner 重填。
- 状态提示必须给出草稿文件绝对路径、结构/契约校验结果和最终提交命令，明确要求 Runner 阅读整份 Artifact，并允许其使用普通文件或文档编辑能力直接修改草稿。
- Runner 的直接编辑结果是最终候选的权威内容。本轮不要求把全局调整反向拆解并覆盖各字段 Event，但字段 Event、自动组装草稿和最终提交文件必须可追溯。
- Runner 显式提交草稿后，系统必须读取当时的文件内容并重新执行父 Artifact 确定性 Validator；不得复用最后一个字段完成时的旧校验结果或 digest。
- 全局调整提示只说明如何阅读、编辑和提交 Artifact，不描述提交后的 Review 参与者、权限、决策规则或操作流程。
- 最终候选必须经过与普通 `run report` 等价的接纳边界，不允许 Schema 路径自行写 Event 和推进父步骤。该全局调整检查点是作者提交动作，不是 Semantic Review，不创建 Vote 或 Decision Policy。

### 4. 统一父 Artifact 接纳与 Review 门禁

- Artifact 生产流程以 Runner 显式提交最终候选为终点；是否需要正式 Review 及如何 Review，不改变此前的 Schema 概览、字段填写、草稿更新和全局调整交互。
- 未配置 `review` 时，Runner 显式提交且 Validator 通过后接纳并推进父步骤。
- 配置 `review` 时，Runner 显式提交且 Validator 通过后创建 Artifact Review Submission 和 Round；Review 完成前不得写入已接受的父 Artifact Event、递增父 Procedure index或展开下一 Action。
- Review Submission 绑定最终组装候选的文件和不可变 digest，字段级 Artifact 不单独触发父 Artifact Review。
- Agent 与 Human Reviewer 沿用父 Artifact 的 Role Binding、Permission 和 Decision Policy，不引入 Schema 专用 Vote 规则。
- 正式 Review 开始后，Runner 继续使用现有显式 Vote 表达作者最终判断；不新增独立的“语义自审通过”Vote。
- Review 要求修改时，Runner 可直接编辑当前受管候选文件，并按现有多轮 Review 语义提交完整修订 Artifact 和 Revision Summary。旧 Round 与旧候选保留，但其 Vote 不得用于新候选。
- Review 通过后，只允许写入一个生效父 Artifact Event并推进一次父步骤；重复等待、重复投票或重复请求不得重复推进。

### 5. 状态与用户提示

- `run status` 必须明确当前处于 Schema 整体概览、字段填写、草稿更新、等待 Runner 全局调整、最终提交与校验、Artifact Review、等待 Runner 投票、等待修订或父步骤完成中的哪一阶段。
- Schema 概览、字段填写和全局调整状态只输出生产信息；Review 控制面信息仅在最终候选提交并进入 Review 后出现。
- 确定性校验结果使用“结构/契约校验”语义，明确它不代表自然语言断言和正式 Review 已通过。
- Review 状态继续展示 Review ID、Round、参与者进度和下一条可执行命令。
- View 至少能展示 Schema 字段进度、累计草稿入口、全局调整状态和父 Artifact 当前 Review 状态；不得在 Runner 最终提交或 Review 通过前把候选展示为已完成产物。
- 字段 Event、最终候选、Review Submission、最终接纳 Event 和父步骤推进之间必须可追溯。

## 后续范围

以下能力有价值，但不纳入本次独立迭代：

- 从累计草稿中选择一个或多个已完成字段进行结构化返修，再自动重新组装。
- 在 View 中建设完整 Schema 草稿编辑器、字段 diff 和跨轮次可视化对比。
- 自动压缩历史字段正文、生成模型摘要或建立长文档语义索引。
- 用模型自动判定自然语言 `asserts` 是否满足，或保证模型必然发现所有重复、越界和时序问题。
- 自动修复已经绕过 Review 并推进的历史 Run。

这些能力如需推进，应基于本轮统一接纳边界和累计草稿查询接口单独立项。

## 交付物

- Schema 写作上下文与累计进度/草稿查询能力。
- Schema 最终组装候选复用父 Artifact 统一接纳与 Review 门禁的实现。
- CLI、View 和 Run 投影中的状态及提示语调整。
- 覆盖无 Review、有 Review、Agent/Human unanimous、要求修改、多轮通过、重启恢复和幂等推进的自动化测试。
- 与用户可见行为一致的 Procedure、Schema、Review 等 System Memory 和 Skill 文档更新。
- 基于问题 Run 形态的最小复现 fixture 和端到端验证证据。

## 验收标准

### Schema 写作上下文

- [ ] 首次进入 Schema、开始第一个字段前，CLI 展示父 Action、父 Artifact 内容契约、完整 Schema 结构、字段顺序、总数和本次增量写作流程概览。
- [ ] 进入外部或内嵌 Schema 后，当前字段提示能说明父 Action、父 Artifact 契约、根/祖先/当前节点约束及各自来源。
- [ ] 当前字段提示包含字段路径、总体数量、已完成数量、剩余数量和相邻字段名称。
- [ ] 第一个字段上报后创建受管草稿文件；后续字段上报更新同一逻辑路径，自动化测试证明新字段内容会持续进入该文件。
- [ ] Agent 能通过明确 CLI 查询完整 Schema 进度、已完成字段、累计组装草稿及其绝对路径，无需读取 Run JSON 或猜测目录结构。
- [ ] 大型 Schema 的默认提示不会重复输出全部历史正文；自动化测试覆盖上下文裁剪与按需查询。
- [ ] Schema 整体概览、字段提示和全局调整提示不包含 Review Policy、参与者、Role Binding、Permission、Assignment、Review/Round ID、Comment、Vote 或 Decision；快照测试覆盖这些过滤规则。
- [ ] 最终候选实际进入 Review 后，Review 信息通过独立上下文正常展示，生产阶段的信息过滤不影响正式 Review 功能。
- [ ] 进程和 View 重启后，进度与累计草稿可从持久化 Run 恢复；草稿文件丢失时可重建。

### 最终全局调整

- [ ] 最后一个字段上报后，Run 停留在当前父 Action 并进入“等待 Runner 全局调整”；不会写入已接纳 Event、推进下一 Action 或提前创建正式 Review。
- [ ] 最后一次自动组装未通过父 Artifact Validator 时，最后一个字段 Event、累计草稿和失败诊断仍被保存，Runner 可以直接修订完整草稿；最终提交未通过校验时同样留在全局调整状态。
- [ ] CLI 明确返回受管草稿绝对路径、结构/契约校验结果和最终提交命令，并用自然语言要求 Runner 阅读整份 Artifact 后直接编辑该文件。
- [ ] 全局调整提示不解释提交后如何 Review，只聚焦完整 Artifact 的阅读、编辑和提交。
- [ ] Runner 修改草稿文件并显式提交后，系统读取最新文件内容、重新运行 Validator，并以最新内容和 digest 作为最终候选。
- [ ] 最终候选允许与字段 Event 的机械组装结果不同；Run 保留字段 Event、自动组装草稿和最终候选之间的追溯关系，本轮不要求反向改写字段 Event。
- [ ] 未配置 `review` 的 Schema Artifact 也必须经过该显式最终提交检查点；提交并校验通过后才接纳和推进。

### Review 门禁

- [ ] 使用 `object + markdown outline + external schema + review` fixture 完成全部字段后，Run 先停留在全局调整检查点；Runner 显式提交后才创建父 Artifact Review，下一 Procedure Action 仍不可执行。
- [ ] Review Submission 内容是最终组装文件，digest 对应该文件；字段级中间 Artifact 不创建父 Artifact Review。
- [ ] 父 Artifact 配置的 Agent 与 Human Reviewer 均生成可追溯 Assignment；Human 未提交时 Run 明确等待。
- [ ] Review 通过前，Run 中不存在该父步骤的已接受 Artifact Event，父 frame index 不变化。
- [ ] 任一有效决策票要求修改后，Runner 可提交完整修订文件和 Revision Summary，创建同一 Review 的新 Round；旧意见保留、旧 Vote 不复用。
- [ ] 全部决策条件满足后，只写入一个父 Artifact Event并只推进一次父步骤。
- [ ] 相同 Schema Artifact 未配置 `review` 时不创建 Review，并在 Runner 显式提交、确定性校验通过后推进。
- [ ] 普通非 Schema Artifact 的有 Review和无 Review路径行为保持不变。

### 状态、诊断与回归

- [ ] CLI 和 View 不使用无上下文的 `passed` 暗示字段填写、确定性校验和 Artifact Review 全部完成。
- [ ] `run status` 在每种阶段返回准确状态、候选或预览入口以及下一条命令。
- [ ] 问题 Run 对应回归 fixture 中，Proposal 未经产品、架构和 Human Reviewer 按 Policy 接受前，Design 不得开始。
- [ ] 自动化测试覆盖：无 Review、Agent+Human unanimous、要求修改后第二轮、Runner 显式 Vote、重复操作幂等、进程重启恢复。
- [ ] 真实长文档 Smoke 保存一次完整证据，证明 Reviewer 能读取最终组装 Artifact、Run 和 Workspace 后提出意见；不以特定模型单次必然发现某个语义问题作为代码验收标准。
- [ ] `npm run typecheck`、`npm test`、`npm run build` 和 `memsphere validate` 全部通过。

## 采用的项目 Statement

- `memsphere 代码仓库开发规范 / Procedure Run 与 Artifact`：Run、Schema 填写、Artifact 校验行为变化必须同步 Procedure、Schema、语法 Memory 和 Skill 说明。
- `memsphere 代码仓库开发规范 / Review`：Review 状态流转、Run 上下文或 View 操作变化必须同步 Review Memory。
- `memsphere 代码仓库开发规范 / System Memory 同步`：用户可见行为必须更新 reserved-memory 源和当前安装副本，并检查 Skill 冗余说明。
- `memsphere 代码仓库测试规范 / 单元测试`：行为修复必须有复现原问题的回归测试，并在定向测试后执行全量回归。
- `memsphere 代码仓库测试规范 / 针对性验证`：Schema 填写修改覆盖 run-store/run-command；Review 与 View 修改覆盖对应领域、API 和浏览器测试。
- `memsphere 代码仓库测试规范 / Memory Store 校验`：Memory 变更后执行 `memsphere validate`；自然语言语义另由实际 Run 与 Review 证据验收。

## 待确认项

当前没有阻塞需求确认的产品问题。以下属于下一步技术方案需要回答的设计问题：

- 如何抽取统一父 Artifact 接纳函数，使普通 report 与 Schema 最终组装共享事务、文件回滚、Review 和单次推进语义。
- 累计草稿查询复用 `run artifact show` 还是增加 Schema 专用命令，以及草稿绝对路径和整体概览在 API 投影中如何命名。
- 如何建立可测试的生产上下文投影或 View Model，使 Review 控制面字段不会被模板误带入 Schema 写作提示。
- Schema frame 完成但等待全局调整或 Review 未结束时，frame、受管草稿、最终候选和父步骤状态如何持久化，是否需要增加向前兼容的可选 Run 字段。
- Runner 最终提交命令复用 `run report --artifact-file` 还是提供语义更明确的 Schema 完成命令，同时避免 Agent 猜测下一步。
- View 的最低进度与草稿入口放在当前步骤区域还是 Artifact Review 区域。

## 不做事项

- 不实现由代码或固定规则判断自然语言 `asserts` 是否满足的 Semantic Validator。
- 不新增独立于 Artifact Review 的 Semantic Review、Vote 或 Decision Policy。
- 不强制所有 Schema Artifact 都进入正式 Artifact Review；是否启用正式 Review 仍由 Artifact 契约决定。Runner 的全局调整与显式提交是 Schema 写作收束动作，不等同于正式 Review。
- 不重新设计 Schema YAML、Artifact type/format/schema 或 Role Binding 语法。
- 不调整 ACP Provider、Agent 沙箱、Evidence View 或 Review 决策治理模型。
- 不自动把输入材料中的 Design、Test 或 Tasks 内容重新分类到正确阶段。

## 关联需求

- 父能力：`20260720-agent-semantic-artifact-validation`。
- 复用：`20260720-artifact-review-human-loop`、`20260720-artifact-review-agent-acp` 及现有 Artifact Review 状态机。
- 关联：`20260722-agent-review-runtime-hardening`；实现时只复用其 Agent 执行可靠性，不重复建设状态语义。
- 后续可靠性：`20260720-artifact-review-compatibility-hardening`。

## 技术与测试方案

### 1. 现状定位与设计边界

- 普通 Artifact 在 `src/run/store.ts` 的 `reportRunUnlocked` 中依次执行候选准备、Validator、`reportReviewedArtifact` 或直接写 Event/推进；Review 通过后由 `acceptArtifactReviewSubmission` 完成唯一一次接纳。
- Schema 的 `enterSchema` 会把编译后的字段步骤压入 `RunFrame`；每个字段仍通过普通 `reportRun` 形成 schema Event，但 `collapseCompletedFrames` 在最后一个字段后自行组装、写父 Event并推进，绕过普通接纳边界。
- `compileSchemaSteps/walkSchema` 只把当前节点的 `defines/asserts` 扁平写入 `RunStep.details`，没有结构化保存根与祖先来源；CLI `printRunState` 也会把字段步骤携带的 Control Plane 和权限说明当成生产提示输出。
- View 从 Run 快照渲染流程和 Event，Artifact Review 另有安全摘要投影；本轮继续保留流程图上已经存在的 Reviewer 角色展示，但新增的 Schema 写作投影只包含生产信息，不复制 Review 控制面。
- 当前可执行的 Schema 增量写作链路是带 Schema 的 Markdown 结构化 Artifact。本轮不借机扩展 JSON/YAML Schema 的交互式填写能力。

### 2. 向前兼容的 Run 状态

在 Run v3 增加可选的 `schemaDrafts`，按父 `stepId` 保存受管草稿元数据；不修改 Memory YAML，不提高 `syntax`，也不提高现有 `contractVersion: 3`：

```ts
type SchemaDraftState = {
  stepId: string;
  schemaName: string;
  status: "writing" | "awaiting_finalization" | "submitted" | "accepted";
  path: string;            // 相对 runsRoot，便于 Run 目录移动
  fileName: string;
  contentType: "text/markdown";
  completed: number;
  total: number;
  pendingRepeatControls?: number;
  assembledDigest?: string;
  submittedDigest?: string;
  validation?: ArtifactValidationResult;
  acceptedArtifactPath?: string;
  updatedAt: string;
};
```

- `RunFrame` 增加可选的结构化 `schemaContext`，保存字段路径和根/祖先/当前节点的生产约束来源；`RunStep.controlPlane` 仍可在内部用于鉴权，但不进入生产提示投影。
- 新字段全部为 optional，旧 v3 Run 和已完成 Run 可直接读取。旧的进行中 Schema Run 在下一次 `enter-schema`、字段 report 或查询时按冻结 Schema 与既有 Event 补建状态，无单独 migration。
- `schemaDrafts` 不复制 Review 状态。提交后是否待评审、待 Runner Vote 或待修订，继续以 `artifactReviews` 为唯一事实来源，避免两个状态机漂移。

### 3. Schema 生产上下文投影

增加一个纯生产语义的 `buildSchemaWritingContext(run, runsRoot)`，由 CLI 与 View 共用，输出：

- 父 Procedure/Action 名称、动作、有效 Procedure/Action asserts 和 suggests。
- 父 Artifact 的 name、type、format、Schema、final 等内容契约，但不含 `reviewPolicy`、Role Binding、Permission 或 Control Plane。
- 冻结 Schema 的紧凑树、字段顺序、当前路径，以及根/祖先/当前节点的 `defines/asserts/type/format` 来源。
- 已完成、当前、剩余字段；Repeat 尚未选择次数时单独显示待展开控制项，选择次数后再更新动态总量。
- 草稿状态、相对/绝对路径、最近结构校验结果；默认不内联全部历史字段正文。

`run enter-schema` 首次进入时打印完整概览；普通 `run status` 只打印当前字段、进度、相关约束和草稿入口。新增：

```bash
memsphere run schema show --run <run-id> [--output text|json]
```

该命令用于重复查看完整概览、字段进度和草稿路径。Schema 字段阶段不调用现有 `printPermissionGuidance`，也不显示 Review/Assignment/Vote 信息；鉴权仍在 `reportRunUnlocked` 内实际执行。

### 4. 稳定受管草稿生命周期

- 第一个字段成功 report 后，在 `<run>/artifacts/drafts/` 创建按父 `stepId` 唯一命名的 Markdown 草稿；后续字段更新同一路径。
- 草稿由冻结 Schema 与 `eventStartIndex` 之后的 schema Event 重建。未填写字段使用可识别的 `<!-- memsphere:pending field=... -->` 标记，View 同时以未完成列表呈现；字段填写或 optional skip 后替换/移除对应标记。
- 字段 Artifact 自身仍按现有规则保存，草稿只是派生工作副本，不计入 `run.events`，不带 `final`，也不作为 Review Submission。
- 草稿采用临时文件加 rename 原子替换。Run JSON 是字段进度的事实来源；进程在 Run 写入后、草稿替换前中断时，`run schema show`、View 查询或下一次 report 会从已持久化 Event 校验并修复草稿。
- `writing` 阶段每次字段 report 都可重建草稿；进入 `awaiting_finalization` 后不再自动覆盖 Runner 的直接编辑。仅当文件缺失时从字段 Event 恢复机械组装版本并明确提示恢复发生。

### 5. 最终全局调整状态

- 修改 `collapseCompletedFrames`：Schema frame 未完成时刷新草稿；最后一个字段完成时不 pop frame、不写父 Event，而是保存 `awaiting_finalization`、最新草稿和父 Artifact Validator 结果后停止收束。
- 父 Artifact 首次自动校验失败只作为全局调整诊断保存，不撤销已通过字段级校验的 Event。
- `printRunState` 检测已完成但仍在栈顶的 Schema frame，返回草稿绝对路径、结构校验结果和精确命令：

```bash
memsphere run report --run <run-id> --artifact-file <absolute-managed-draft-path>
```

- `reportRunUnlocked` 在普通 current-step 分支之前识别该状态，仅接受受管草稿文件作为最终输入；读取磁盘最新字节并重新运行父 Artifact Validator。失败时持久化最新诊断并停留在 `awaiting_finalization`，成功后才 pop Schema frame。
- Runner 直接编辑造成的内容变化以提交时 digest 为准，不反向改写字段 Event。`assembledDigest`、`submittedDigest` 和最终 Artifact path 保留机械组装、作者调整与接纳结果的追溯关系。

### 6. 统一接纳与正式 Review

- 从 `reportRunUnlocked` 抽取 `acceptPreparedArtifact`，统一处理“无 Review 直接接纳”和“有 Review 创建/续开 Round”；普通 Artifact 和 Schema 最终提交都调用该入口。
- 无 Review：构建正式父 Artifact 文件、写入一个父 Event、推进一次父 frame，并把草稿标为 `accepted`。
- 有 Review：先 pop 已完成 Schema frame，使父 Action 成为 current step，再调用现有 `reportReviewedArtifact` 把草稿复制为不可变 Submission；Review 通过前不写父 Event、不推进。
- Review Submission 继续存放在 `artifacts/reviews/...`，不得原位编辑。要求修改时 CLI 指向稳定受管草稿，Runner 编辑后用现有 `--revision-summary-file` 再 report；新 Round 复制新候选，旧 Submission/digest 保持不变。
- `acceptArtifactReviewSubmission` 接纳成功时关联并标记对应草稿为 `accepted`。现有 Run lock、重复 digest、Round 幂等和单次推进规则保持生效。

### 7. View 投影与交互

- `toViewRunPayload` 增加独立的 `schemaWriting` 摘要，由与 CLI 相同的生产上下文 builder 生成；不得把私有 `artifactReviews` 或 Control Plane 拼入该对象。
- 当前父 Action 下展示紧凑进度、当前字段、草稿状态、草稿绝对路径和可展开的累计内容；未填字段明确标记为待填写。
- `awaiting_finalization` 显示“等待全局调整”，保持父 Action 为当前步骤，不显示已完成产物；候选进入正式 Review 后再沿用现有 Artifact Review 侧栏。
- 本轮 View 只读，不增加网页内草稿编辑器；Runner 使用文件/文档编辑能力修改 CLI 返回的受管文件。

### 8. 失败处理与兼容行为

- 字段自身 Validator 失败：不写字段 Event、不更新草稿，沿用现有行为。
- 父 Artifact 自动组装校验失败：保存字段 Event、草稿和诊断，进入全局调整。
- Runner 最终提交校验失败：不 pop Schema frame、不创建 Review、不推进，更新诊断并允许继续编辑同一路径。
- 草稿文件被删除：从冻结 Schema 与持久化字段 Event 重建；受管路径越界、符号链接逃逸和非预期提交路径均拒绝。
- 无 Review、普通非 Schema Artifact、Repeat/optional 语义和历史 Review 数据保持兼容；本轮不修改 ACP Provider、Decision Policy 或 Memory syntax。

### 9. 自动化验证

`test/run-store.test.ts`：

- 概览/字段来源、Repeat 动态总量、optional skip 与旧 v3 进行中 Run 补建。
- 第一个字段创建草稿、多个字段保持同一路径并累积内容、丢失后恢复、重启后继续。
- 最后字段停在全局调整；父校验失败仍保存字段与草稿；直接编辑后按最新字节重新校验。
- 无 Review 显式提交后只接纳/推进一次。
- 有 Review 时显式提交才创建 Round；要求修改沿稳定草稿进入下一轮；通过后只写一个父 Event。
- 回归问题 Run：父 Artifact Review 接受前下一 Action 不可执行。

`test/run-command.test.ts`：

- `enter-schema` 整体概览、字段简要状态、`run schema show` text/json、绝对草稿路径和最终提交命令。
- 生产提示不含 Review Policy、参与者、Role Binding、Permission、Assignment、Review/Round ID、Comment、Vote、Decision，也不输出全部历史正文。
- 进入正式 Review 后，原有 Review summary、wait、vote 和 revision 命令保持可用。

`test/artifact-review-view.test.ts`、`test/view-browser.test.ts` 与必要的 Playwright 用例：

- 公共 payload 暴露 `schemaWriting` 而不泄漏私有 Review Store。
- View 展示字段进度、未完成项、稳定草稿和全局调整状态；Review 通过前不标记父 Artifact 完成。
- 正式 Review 开始后仍使用现有侧栏，生产投影与评审投影互不覆盖。

最终执行定向测试后运行：

```bash
npm run typecheck
npm test
npm run build
node dist/cli.js validate
```

再使用最小 fixture 和 `memsphere-harness-smoke` 各跑一次真实 Run，保存字段逐步更新、全局直接编辑、无 Review 接纳及有 Review 多轮门禁的命令与文件证据。

### 10. 文档与 System Memory

- 同步 `reserved-memory/concepts/memsphere-procedure.yaml`、`reserved-memory/concepts/memsphere-schema.yaml` 及 `.memsphere/memory` 安装副本，说明稳定草稿、全局调整和正式 Review 边界。
- 更新 `src/skills/memsphere/SKILL.md` 的 Schema Run 操作说明，要求始终执行 CLI 返回的 `run schema show`/最终 report 命令，不猜路径。
- 如 README/CLI 帮助中存在 Schema Run 命令清单，同步新增 `run schema show`；不修改 YAML 语法 Memory，因为本轮没有语法变化。

### 采用的设计与测试 Statement

- `memsphere 代码仓库开发规范 / Procedure Run 与 Artifact`：统一普通 report 与 Schema 最终提交的接纳边界，并同步 Run/Schema/Skill 行为。
- `memsphere 代码仓库开发规范 / Review`：复用既有 Review Store、Submission、Round 和单次推进，不建立第二套评审模型。
- `memsphere 代码仓库开发规范 / System Memory 同步`：reserved 源、安装副本和 Skill 同步修改。
- `memsphere 代码仓库测试规范 / 单元测试、针对性验证、Memory Store 校验`：以 run-store/run-command/View 回归为主，最后执行全量构建、测试与 Memory validate。

## 开发任务

1. 扩展可选 Run v3 `schemaDrafts`/字段约束来源模型及 Zod 读写兼容。
2. 实现 Schema 生产上下文、进度计算和 `run schema show`，过滤 Review 与控制面信息。
3. 实现稳定草稿的增量组装、原子更新、缺失恢复和路径安全检查。
4. 将 Schema frame 收束改为 `awaiting_finalization`，实现最新草稿显式提交和失败诊断持久化。
5. 抽取统一 Artifact 接纳函数，接通无 Review、正式 Review、多轮修订与幂等推进。
6. 增加 View `schemaWriting` 投影及进度、草稿、全局调整展示。
7. 补齐 store、command、View/API/browser 回归测试和最小 fixture。
8. 同步 Reserved/System Memory、安装副本、Skill 与 CLI 文档。
9. 执行定向、全量和真实 Run Smoke，整理实现摘要与验证证据进入后续验收步骤。

## 验收结果

### 自动化与本地验证

- `npm run typecheck`：通过。
- `npm test`：通过，276/276；覆盖稳定草稿、缺失恢复、父契约失败恢复、external Schema、多轮 Artifact Review、单次接纳推进、CLI、View API 与浏览器渲染。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过，Reserved/System Memory 安装副本满足当前语法和引用约束。
- `git diff --check`：通过。
- 新增 `test/fixtures/schema-artifact-composition-review/` 最小复现资产；第一轮正式决策要求修改后，Runner 编辑同一受管草稿并提交第二轮，Review 通过前父 Event 不存在，通过后父步骤只推进一次。

### 已知验证说明

- 首次全量并行执行时，既有 Artifact Review Playwright 用例等待 API 响应达到 30 秒超时；该用例单独复跑通过，随后最新代码再次全量执行 276/276 通过，归类为历史瞬时测试资源波动，不是本轮回归。
- 真实外部 ACP 长文档 Review Smoke 尚未在本初始验证中执行。自动化测试已验证 Review Submission、Round、修订和接纳边界；外部模型能否在单次运行中发现某个自然语言问题不作为代码通过条件，后续可作为人工/运行时证据补充。

### 提需方验收

- 2026-07-22，提需方基于需求契约、实际功能和验证结果确认验收通过。
- 端到端 Run `run-20260722-100515z-cc5d1901` 完成 30 个 Schema 节点的逐步撰写、全局草稿调整、父 Artifact 契约校验以及 Agent/Human Artifact Review，最终状态为 `done`。
- 本需求开发 Run `run-20260722-065730z-49b6ccee` 已退出验收修正循环，无阻塞交付的残留问题。
