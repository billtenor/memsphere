---
id: 20260720-artifact-review-evidence-view
status: completed
type: feature
created: 2026-07-20
completed_at: 2026-07-22T22:44:01+08:00
run_id: run-20260722-115058z-a792e041
---

# Artifact Review Evidence View

## 需求

为 Human 用户提供一个位于现有 Run View 内的 Artifact Review 浮窗，用于完整查看和操作一次 Review。浮窗按 Review/Round 还原每轮不可变 Artifact Submission、Reviewer Assignment、Comment、Vote、Round Result、Runner Vote 与 Revision Summary，让用户无需在当前窄侧栏中拼接多轮上下文。

本需求只建设基于现有 Artifact Review 持久化数据的基础 Review View，不采集 Workspace 文件变化，不实现文件 diff，也不引入已取消的扩展决策治理能力。

## 整体目标

- Human 可以从当前 Run 的评审入口打开浮窗，在一个稳定界面中理解 Review 从首轮到当前或最终轮的完整演进。
- 每个 Round 明确对应当时的不可变 Artifact Submission、参与者意见、Vote、Result 和进入下一轮前的 Revision Summary。
- Human 可以在当前 Assignment 中继续完成 Artifact Comment、Vote 和 Submit；历史 Round 始终只读。
- Comment 只属于 Artifact Review，不与 Memory Review 或 Workspace 文件评论混合。

## 当前迭代范围

### 1. 浮窗与入口

- Run 中存在 Artifact Review 时，保留清晰的状态、轮次和 Reviewer 进度入口；点击后在当前 View 页面上打开大尺寸浮窗，不跳转到新页面。
- 桌面端浮窗覆盖主要视口并保留关闭入口；宽屏允许 Artifact 与评审信息并排查看。窄屏和移动端使用接近全屏的浮窗及稳定的“产物/评审”切换，不允许内容或操作重叠。
- 关闭浮窗后恢复原 Run 页面、滚动位置和当前节点；再次打开时恢复最近选择的 Round 和有效 Human Identity。

### 2. Review Header 与 Round 导航

- Header 使用现有领域名称 `Review`，不新增 Session 概念；展示 Artifact 名称、Review 状态、Decision Policy、当前轮、所选轮、Reviewer 提交进度和 Runner 投票状态。
- Round 导航按时间顺序展示每轮状态与最终结果，默认打开当前轮；历史轮明确标识只读。
- 每个 Round 读取其绑定的 Submission，不使用当前 Workspace 或当前 Run Event 重建旧内容。
- Revision Summary 显示在前一轮与新一轮之间，明确它是 Runner 对本轮修改的声明，不把它解释为系统验证事实。

### 3. Artifact 与 Review 内容

- Artifact 区复用现有 Renderer 展示所选 Round 的完整 Submission；本期不提供相邻版本 diff 或 Workspace diff。
- Review 区按 Assignment 展示 Role Name、Identity、Human/Agent 类型、决策票或建议票、运行/提交状态、正式 Vote、正式 Comment 和提交时间。
- Round Result 展示决策票统计、建议票数量和自然语言结论；Runner Vote 与其他决策票放在同一结果语义中展示，但标明 Runner 身份。
- 当前 Agent Assignment 可查看运行、失败与 Retry 状态；Human 不得代替 Agent Comment 或 Vote。
- 只有当前 Round 中当前 Human Identity 的 Assignment 可以编辑。草稿不计入进度，Submit 后不可修改；切换 Identity 时保留各自草稿，历史 Round 不显示编辑控件。
- Human/Agent Reviewer Assignment 的 Vote 沿用 `approve`、`request_changes`、`abstain`。选择 `request_changes` 或 `abstain` 时必须提供原因；弃权票正常进入现有策略计算，不伪装为失败或未提交。Runner Vote 保持现有 `approve`、`request_changes` 语义，不在本需求中扩展 Runner 弃权。

### 4. Artifact Comment 定位

- Artifact Review Comment 只允许评论当前 Round 的 Artifact Submission，不允许锚定 Memory、Review 配置或 Workspace 文件。独立的 Memory Review 功能保持原有行为，不在本需求中删除。
- 支持两类 Comment：
  - 整体 Comment：绑定完整 Submission。
  - 定位 Comment：绑定 Submission 中由现有 Artifact Renderer 暴露的稳定内容位置。
- Comment Anchor 至少保存 Submission 标识、Submission digest、Renderer target、可选位置和上下文片段。服务端验证 Anchor 属于当前 Submission，禁止把旧轮 Anchor 写入新轮。
- 点击定位 Comment 时切换到对应 Round 和 Submission，再定位到 Artifact 内容。目标因 Renderer 变化无法精确定位时，仍显示原始稳定引用和保存的上下文片段，不静默丢失 Comment。
- Comment 不跨 Round 自动迁移或重新锚定；Reviewer 需要在新 Submission 上重新确认问题是否仍然存在。

### 5. 读取与权限

- 浮窗只读取 Run 中已持久化的 Review、Submission、Round、Assignment、Comment、Vote、Result、Revision Summary 和脱敏控制平面信息。
- 继续沿用现有 `identity_id + review_id + review_round_id` 服务端鉴权、私有 Human Draft、revision 冲突和 Agent Assignment 隔离规则。
- API 不返回 Runner 凭据、Agent 私有凭据或未授权 Identity 的私有草稿。

## 后续范围

- Workspace Snapshot、两次 Submission 之间的文件变化、文本行级 diff、重命名识别及二进制文件证据。
- Artifact 相邻版本的结构化或文本 diff。
- Challenge、Override、扩展 Decision Policy 和其他已取消治理需求中的实体。
- 跨 Run Review 搜索、统计和外部 Code Review 平台同步。
- 旧 `kind: task` Review 的迁移或废弃。

## 不做事项

- 不依赖 Git，不读取 Git status，也不实现 Git diff。
- 不扫描、保存或展示 Workspace 文件变化；因此本期不增加路径排除、敏感文件识别、文件大小限制或 Snapshot 失败状态。
- 不允许 Artifact Review Comment 锚定 Memory 或 Workspace 文件。
- 不在浏览器端重新计算或推断 Decision Policy 结果。
- 不为旧 Artifact Review Run 增加迁移或兼容投影；本期以当前持久化模型生成的新 Review 为验收对象。
- 不改变独立 Memory Review 的存储和操作语义。

## 交付物

- Run View 中可打开、关闭并恢复上下文的 Artifact Review 浮窗。
- Review Header、Round 导航、Artifact Submission、Assignment/Comment/Vote/Result 和 Revision Summary 的完整展示。
- 当前 Human Assignment 的 Artifact Comment、Vote、Submit，以及 Agent 失败状态与 Retry 操作。
- 仅面向 Artifact Submission 的稳定 Comment Anchor 与服务端校验。
- 覆盖多轮、多人、Agent/Human 混合、历史只读、弃权原因、定位失效和桌面/移动布局的自动化测试。
- 与用户可见行为一致的 System Memory、Skill 和必要文档更新。

## 验收标准

- 从当前 Run 的评审入口打开浮窗后，可以从第一轮到最终轮完整还原每轮 Submission、Assignment、正式 Comment、Vote、Round Result、Runner Vote 和 Revision Summary。
- Review Header 使用 Review/Round 领域名称，准确展示 Artifact、Policy、状态、当前/所选 Round、参与进度和 Runner 状态，不出现 Session 或已取消的治理实体。
- 选择任一历史 Round 时展示该轮持久化 Submission 和正式意见；历史轮不可编辑，当前轮的未提交草稿不会因切换 Round、Identity 或普通轮询丢失。
- 当前 Human 可在浮窗中添加整体或定位 Artifact Comment、选择 Vote 并 Submit；草稿不计入进度，正式提交后不可修改。
- Human/Agent Reviewer Assignment 的 `request_changes` 和 `abstain` 都必须有可见原因；`abstain` 作为正式 Vote 被保存并按当前 Decision Policy 结算。Runner 的 `request_changes` 继续要求 Vote Comment。
- Artifact Review Comment 不能锚定 Memory 或 Workspace 文件；定位 Comment 始终绑定创建时的 Submission digest，不能提交到其他 Round。
- 点击定位 Comment 会打开对应 Round 并定位 Artifact；无法精确定位时仍展示稳定引用和上下文片段。
- Agent/Human 混合 Review 中，Role Name、Identity、Assignment 类型、状态、Vote 和 Comment 不混淆；Human 不能代替 Agent 操作，Agent 失败可按现有权限 Retry。
- 桌面宽屏支持 Artifact 与 Review 并排，移动端可稳定切换；长 Artifact、多 Reviewer 和多轮历史下无内容重叠、越界或不可操作控件。
- 浮窗 API 继续隔离私有草稿和敏感控制平面数据，过期 revision 返回冲突且不覆盖本地编辑内容。
- 现有无 Review Run、Artifact Review CLI/状态机、Memory View/Review 和旧 Task Review 回归通过。

## 采用的项目 Statement

- `Memory 访问规则`：已使用规范名称读取适用 Memory，并依据完整内容而不是 list 摘要执行。
- `memsphere 代码仓库开发规范 / Review`：修改 Review 数据模型、Comment 定位和 View 操作时同步检查并更新 `memsphere-review`。
- `memsphere 代码仓库开发规范 / System Memory 同步`：用户可见行为变化需更新 Reserved Memory、当前安装副本和 Skill 冗余说明。
- `memsphere 代码仓库测试规范`：实施阶段补充 Review 领域、API、View Browser 与 Playwright 针对性测试，并执行完整项目门禁。

## 待确认项

无。当前迭代明确不包含 Workspace Evidence、Artifact diff、扩展治理和历史 Run 兼容。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 前置：已实现的 `20260720-artifact-review-human-loop` 与 `20260720-artifact-review-agent-acp` 能力。
- 已取消且不再作为前置：`20260720-artifact-review-decision-governance`。
- 后续：`20260720-artifact-review-compatibility-hardening`。

## 技术与测试方案

### 1. 采用的 Statement 与实现边界

- `memsphere 代码仓库开发规范 / Review`：Comment 定位、Review 投影和 View 操作变化同步更新 `memsphere-review`，并保持独立 Memory Review 语义不变。
- `memsphere 代码仓库开发规范 / System Memory 同步`：更新 Reserved Memory 源文件，通过 `memsphere init` 刷新当前安装副本，并检查 `src/skills/memsphere/SKILL.md` 的冗余说明。
- `memsphere 代码仓库测试规范 / 单元测试、针对性验证、System 与 Reserved Memory`：先执行 Review Store、View API、Browser/Playwright 针对性测试，再执行完整项目门禁。
- 本次复用现有 `ArtifactReview`、`ArtifactReviewSubmission`、`ArtifactReviewRound`、`ArtifactReviewAssignment` 和控制平面鉴权，不建设第二套 Review Store，也不改变 Decision Policy 的结算逻辑。
- Artifact Review 使用新的大浮窗；现有右侧 Review 抽屉继续服务独立 Memory Review，不再承载 Artifact Review 的多轮主交互。

### 2. Review 数据模型与持久化约束

扩展 `ArtifactReviewAnchor`，使定位 Comment 明确属于一个不可变 Submission：

```ts
type ArtifactReviewAnchor = {
  submissionId: string;
  sourceHash: string;
  target: string;
  location?: string;
  context?: string;
};
```

- 不带 `anchor` 的 Comment 是整体 Submission Comment；带 `anchor` 的 Comment 是定位 Comment。
- `submissionId` 与 `sourceHash` 必须同时匹配当前 Round 的 Submission；服务端统一校验 Human Draft API 和 Agent Review Bridge，禁止跨 Round 写入旧 Anchor。
- `target` 是 Renderer 暴露的稳定目标，`location` 是目标内的可选细分位置，`context` 是创建 Comment 时截取的短文本，仅用于定位失败后的证据展示。
- Comment、Vote、Submitted Opinion、Round Result 和 Revision Summary 继续只写入对应 Review/Round；历史 Round 不做重新锚定或内容迁移。
- Human/Agent Reviewer Assignment 选择 `request_changes` 或 `abstain` 时必须提供可见原因。Human 以至少一条 Comment 为原因；Agent 可使用 Comment 或提交 Summary。Runner 保持现有 `approve`、`request_changes` 取值，并在 `request_changes` 时继续要求 Vote Comment；本需求不扩展 Runner 弃权。
- API 不暴露运行中的 Agent Draft。Agent 运行状态、Attempt 和失败原因可以展示，只有正式提交的 Agent Comment、Summary 和 Vote 进入 Review Evidence。

### 3. Run 公共投影与 Review API

当前 `/api/runs` 只返回当前未通过的 `artifactReview` 摘要，Review 通过并推进 Run 后入口会消失。调整为：

- Run 公共投影新增脱敏的 `artifactReviewSummaries`，按 Review 返回 `reviewId`、`stepId`、Artifact 名称、Policy、状态、当前/最终 Round、Round 数量、参与者 Role Name、提交进度和 Runner 状态。
- 摘要不包含 Submission 内容、Comment、Vote 明细、私有 Draft、Control Plane 凭据或 Agent 私有运行数据；原始 `run.artifactReviews` 仍不直接返回浏览器。
- 每个产生过 Artifact Review 的步骤都可依据 `stepId` 找到独立 Review 入口；当前未通过 Review 仍可在工具栏显示进度入口，已完成 Review 从对应 Artifact/步骤入口重新打开。
- 继续使用 `GET /api/artifact-reviews/:review_id/rounds/:round_id?identity_id=...` 读取证据，但响应只水合所选 Round 的不可变 Submission，并返回该 Review 的脱敏 Round 导航与正式评审证据。
- 服务端继续通过 `identity_id + review_id + round_id` 执行 `artifact.read` 和 Assignment 归属校验。仅返回所选 Human Identity 自己的当前 Draft；其他 Identity 只返回正式 Submitted Opinion。
- PATCH Draft、POST Submit、Agent Retry 保留现有 revision 乐观锁；409 响应携带服务端 revision，View 保留本地未提交文本并提示刷新，不以轮询结果覆盖编辑内容。

### 4. Artifact Renderer 与定位 Comment

- 抽取可复用的 Artifact Submission Renderer，使 Run 正文和 Review 浮窗使用同一套 Markdown/plain/file 内容展示，不复制格式判断与文件水合逻辑。
- Renderer 在 Review 模式下为可评论内容生成只依赖不可变 Submission 内容的稳定 target：Markdown 使用顶层渲染块顺序和块类型，plain/file 文本至少提供整块 target；后续结构化 Renderer 可以按字段路径扩展。
- 浏览器创建定位 Comment 时自动写入当前 `submissionId`、digest、target、location 和经过长度限制的文本 context，不要求 Human 手工理解 Anchor。
- 点击 Comment 时先切换到它的 Round 并加载对应 Submission，再查询 Renderer target、滚动并短暂高亮。目标不存在时 Comment 卡片显示 target/location 和 context，明确提示“定位失效”，但不删除或伪装定位成功。
- 现有 Memory Review 的 `data-anchor`、snapshot hash 和定位代码保持独立；Artifact Review 不再复用 Memory/Task Review 的 subject、snapshot 或 Workspace 路径。

### 5. 大浮窗交互与状态管理

- 在 `browserHtml` 中新增常驻 `<dialog>` 容器，Artifact Review 入口调用 `showModal()`；提交确认继续使用独立的小确认 Dialog。
- Header 展示 Artifact、Review 状态、Policy、当前 Round、所选 Round、提交进度和 Runner Vote 状态，并提供关闭按钮。
- 左侧为所选 Round 的 Artifact Submission，右侧为 Identity、Assignment 进度、正式 Comment/Vote、Round Result、Runner Vote 和编辑区；宽屏中间分隔线支持鼠标、触摸和键盘调整，宽度写入 `localStorage`。
- Round 导航按顺序列出每轮状态。Revision Summary 放在前一轮与新一轮之间，并标注为 Runner 声明。历史 Round 全部只读；当前 Round 只有当前 Human Assignment 可编辑。
- Identity 选择展示 Role Name，Identity Name 作为次级信息；Human 不得选择 Agent Assignment 代为操作。Agent Assignment 仅展示运行、提交、失败和 Retry 状态。
- 移动端 Dialog 接近全屏，使用“产物/评审”分段控件切换主面板；固定尺寸、滚动容器和断点规则保证长 Artifact、多 Reviewer 与长 Comment 不重叠。
- 按 Review 保存最近的 Identity、Round、移动端面板和桌面分栏宽度。关闭浮窗不重绘 Run 正文，原页面滚动位置和当前节点自然保留。
- 4 秒轮询继续获取 Run/Review 状态；浮窗存在输入焦点、打开的选择菜单或未提交文本时只更新内存状态并延迟重绘，避免吞掉草稿和关闭菜单。

### 6. 结果展示与权限语义

- Round Result 只根据 Store 已持久化的 `round.status`、`round.result` 和 `round.votes` 做展示格式化，不在浏览器重新执行 Policy。
- 决策票、建议票和 Runner 票分别说明作用，最终结论使用自然语言表达；`abstain` 是已提交 Vote，不显示成失败或未提交。
- Role Name、Identity、Human/Agent、decision/advisory、Assignment 状态、Vote 和提交时间使用独立字段渲染，不从显示文本反推权限。
- Retry 继续调用现有窄 API 和权限检查；View 不获取或展示 Provider 凭据、环境变量、ACP 私有会话内容及 Runner 凭据。

### 7. System Memory 与 Skill 同步

- 更新 `reserved-memory/procedures/memsphere-review.yaml`，明确 Artifact Review Comment 仅绑定不可变 Artifact Submission，且不属于独立 Memory Review 的处理对象。
- 检查并按需更新 `reserved-memory/concepts/memsphere-procedure.yaml` 与 `reserved-memory/statements/memsphere-yaml-syntax-rules.yaml` 中 Artifact Review 的用户可见行为说明。
- 更新 `src/skills/memsphere/SKILL.md` 中 Artifact Review 等待、Human View 操作和历史证据说明。
- 执行 `memsphere init` 刷新 `.memsphere/memory` 安装副本；若没有新增或删除 System Memory，不修改 manifest 条目。

### 8. 验证方案

#### Review Store 与领域测试

- 整体 Comment 与合法定位 Comment 可保存；错误 `submissionId`、错误 digest、空 target 和跨 Round Anchor 被拒绝。
- Human/Agent Reviewer Assignment 的 `request_changes` 与 `abstain` 原因门禁生效；Runner 仍只接受 `approve`、`request_changes`，且 `request_changes` 必须有 Vote Comment。
- 多轮 Submission、Revision Summary、Submitted Opinion、Round Result 和最终 Outcome 保持不可变关联，现有 Policy 结算结果不回归。

#### View API 测试

- `/api/runs` 同时提供进行中与已完成 Review 的脱敏摘要，且不泄露 Submission 内容、私有 Draft、凭据或原始 Control Plane。
- 按 `review_id + round_id + identity_id` 读取准确历史 Submission；未分配 Identity 被拒绝，其他 Human Draft 不可见，Agent 运行 Draft 不可见。
- 当前 Draft 保存、Submit、409 revision 冲突、Agent Retry 和 Review 通过后的历史读取均有覆盖。

#### Browser 与 Playwright 测试

- 桌面端打开/关闭浮窗、拖动/键盘调整分栏、切换 Identity/Round、恢复选择和原 Run 滚动位置。
- 创建整体 Comment 与 Markdown 定位 Comment，提交 Vote；点击历史定位 Comment 会切换 Round 并高亮，目标缺失时展示 context fallback。
- 两轮 Human/Agent 混合 Review 展示正式意见、Agent 失败与 Retry、Runner Vote、Revision Summary 和自然语言 Result；历史轮不可编辑。
- `request_changes`、`abstain` 原因门禁、私有 Draft 隔离、轮询时文本/菜单不丢失。
- 移动端“产物/评审”切换、长 Artifact、长 Comment、多 Reviewer 和多轮导航无重叠、溢出或不可达控件。
- Review 通过并推进 Run 后，仍可从对应步骤重新打开完整证据；无 Review Run、Memory View/Review 和旧 Task Review 回归通过。

#### 交付门禁

依次执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`node dist/cli.js init` 和 `node dist/cli.js validate`，记录实际结果。使用 Playwright 桌面与移动截图复核浮窗首屏、分栏、长内容和定位高亮。

## 开发任务

1. [x] 在 `src/artifact-review.ts` 和 `src/run/store.ts` 扩展 Anchor 的 `submissionId/context` 契约；统一校验 Human/Agent Comment 所属 Submission，并补齐 Reviewer Assignment 的 `request_changes/abstain` 原因门禁，保持 Runner Vote 现有语义。
2. [x] 更新 Run State Zod schema、View 请求解析和 Agent Review Bridge 输入；让浏览器与 Agent 共用同一 Anchor 规范，拒绝空 target、错误 digest 和跨 Round Anchor。
3. [x] 在 Store/CLI 相关测试中增加回归，覆盖整体与定位 Comment、三种 Assignment Vote、Runner Vote、跨轮失败和既有 Policy 结算。
4. [x] 在 `src/commands/view.ts` 增加所有进行中/已完成 Review 的脱敏 `artifactReviewSummaries`，保留原始 `artifactReviews` 私有；按所选 Round 水合 Submission，并从 Evidence 响应移除运行中 Agent Draft。
5. [x] 扩展 `test/artifact-review-view.test.ts`，覆盖完成后仍可读取、Identity 鉴权、Human Draft 隔离、Agent Draft 隐藏、历史 Submission 准确性、409 冲突和敏感字段不泄露。
6. [x] 在 `src/view/browser.ts` 复用 Artifact Submission Renderer；为 Markdown 顶层块与 plain/file 整体内容生成稳定 target、context excerpt、定位高亮和失效 fallback。
7. [x] 新增 Artifact Review 大 Dialog 和独立状态：Review 入口、Header、Round 导航、Revision Summary、Identity、Assignment、正式意见、Vote、Result、Runner 与 Agent Retry；Artifact Review 不再占用 Memory Review 右侧抽屉。
8. [x] 实现桌面双栏及可拖动/键盘调整分隔线、移动端“产物/评审”分段切换、按 Review 持久化选择、关闭后恢复 Run 上下文，以及轮询期间草稿和菜单保护。
9. [x] 更新 `test/view-browser.test.ts` 静态行为断言，并重构 `test/artifact-review-browser.test.ts` 端到端测试，结合 Store/API 测试覆盖双轮 Review、整体/定位 Comment、历史只读、弃权原因、定位失效、Agent Retry 和 Review 完成后重开。
10. [x] 增加 Playwright 桌面与移动视觉/布局断言，检查 Dialog 开关、分栏调整、移动面板和长内容不存在重叠、溢出或不可达控件。
11. [x] 更新 `reserved-memory/procedures/memsphere-review.yaml`、相关 Procedure/YAML System Memory 和 `src/skills/memsphere/SKILL.md`；执行 `node dist/cli.js init` 刷新本需求涉及的 `.memsphere/memory` 安装副本。
12. [x] 依次执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`node dist/cli.js validate`，记录结果并只修复本需求引入的失败。

## 验收结果

实现、流程评审与提需方验收均已完成，验收结论为通过。

- `npm test`：277/277 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过。
- Playwright 双轮 Artifact Review E2E：通过；覆盖定位 Comment、历史轮次、完成后重开、桌面分栏、菜单轮询保护和移动端“产物/评审”切换。
- 桌面与 390x844 移动端截图已人工复核，未发现弹窗内容重叠、越界或不可达控件。
- 提需方于 2026-07-22 确认验收通过；后续范围保持为 Workspace/Artifact diff、扩展治理及跨 Run Review 能力。
- 本轮未发现阻塞交付的残留问题。
