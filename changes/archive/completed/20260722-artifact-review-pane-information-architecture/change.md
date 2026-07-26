---
id: 20260722-artifact-review-pane-information-architecture
status: completed
type: feature
created: 2026-07-22
completed_at: 2026-07-23T15:13:09+08:00
run_id: run-20260722-154905z-860bf92f
---

# Artifact Review 右侧交互区信息架构重构

## 需求

Artifact Review 大浮窗已经能够展示 Artifact、多轮 Review、参与者、Comment、Vote、Revision Summary 和 Evidence Package，也支持 Human 操作与 Agent 状态查看。但右侧交互区仍主要按实现组件堆叠内容，没有形成稳定的信息架构。

当前界面把 Artifact 与轮次选择、Identity、票型、整体状态、参与进度、本轮汇总、修改摘要、证据包、私有草稿、正式意见和 Submit 分散在少量视觉容器中。同一个 Human Assignment 的操作被只读信息隔开，草稿与正式证据缺少清晰边界，用户难以快速判断“当前评审什么、我需要做什么、其他人进行到哪里、依据是什么、最终发生了什么”。

本需求重新梳理右侧区域。主干新增 Agent Activity 并把候选 Artifact 与前序证据正文统一迁到左侧“评审材料”后，右侧按用户任务划分为四个稳定、同级的版块。

### 采用规范

- `memsphere 代码仓库开发规范 / Review`：View 中 Review 操作变化需要同步检查并更新 `memsphere-review`。
- `memsphere 代码仓库开发规范 / System Memory 同步`：若本轮形成新的用户可见 Review 行为，需要同步 Reserved Memory、当前安装副本及相关 Skill 说明。
- `memsphere 代码仓库测试规范 / System 与 Reserved Memory`：修改 Reserved Memory、manifest 或安装行为时，必须运行 `test/reserved-store.test.ts`。
- `memsphere 代码仓库测试规范 / 单元测试、针对性验证`：修改 Review 与 View 行为时，先运行受影响的 Review/View/Playwright 测试，再执行 `npm run typecheck`、全量 `npm test`、`npm run build` 和 `memsphere validate`；记录本轮实际命令、结果和未执行项，不以历史结果代替本轮验证。
- 当前尚未进入实现；以上规范先作为交付和验收约束冻结，具体测试文件与命令在技术与测试方案中基于代码调查细化。

### 1. 评审范围

用于回答“我现在评审什么”，包含：

- 有 Review 的 Artifact 选择器。
- 当前选择的轮次及轮次状态。
- 本轮开始时间与结束时间；进行中时明确显示“进行中”。
- 当前 Submission 的只读标识，以及当前轮或历史轮标识。
- Review Policy 作为次要信息展示，不展开实现细节。

Artifact 名称、Review ID、状态和轮次等已经在浮窗 Header 展示的信息不得在版块内机械重复。Header 负责全局识别，本版块负责切换和确认评审范围。

### 2. 我的评审

用于回答“当前身份要做什么”，是当前轮唯一的操作版块。属于同一 Assignment 的操作必须放在同一个有明确边界的面板中，包含：

- 评审身份选择器，主显示 Role Name，Identity Name 作为次级信息。
- 当前 Assignment 是决策票还是建议票；Identity Selector 只提供 Human Assignment，不把 Agent 伪装成可操作身份。
- Human 的投票选择、整体 Comment 输入、严重级别选择、已保存但未提交的草稿 Comment、删除草稿 Comment 和“提交评审”。
- “评审意见”和“投票”分别使用明确小标题、辅助说明和视觉分隔；意见组先承载正文、严重级别、添加意见和草稿列表，投票组随后承载通过/修改/弃权三个互斥立场。
- “提交评审”使用独立操作区，并在提交前显示当前 Vote 与草稿意见数量，说明提交的是整份评审而非单条 Comment。
- Vote 按钮与“添加意见/删除”不得使用相同层级或容易混淆的分组方式。
- 定位 Comment 的创建入口仍位于左侧 Artifact 内容旁；创建后进入本版块的草稿 Comment 列表。
- Agent 不进入 Human Identity Selector；Agent 的运行状态、失败摘要、Retry 和 Activity 统一由“参与进度”承载。
- 已提交 Assignment 只显示“已提交”、Vote 和正式意见跳转，不继续显示可编辑控件；完整 Summary 与 Comment 仅在“评审记录”展示。
- 历史轮次不展示可执行操作，以明确的“历史轮次，只读”状态替代空白或禁用控件堆叠。
- 评审身份只控制本版块的 Assignment、草稿与操作权限，不控制左侧评审材料或其他三个右侧版块的公共内容。
- 当前 Review 没有 Human Assignment 时，本版块显示“无需评审”，不展示空身份选择器或不可用的提交操作。

Submit 必须与 Vote 和 Comment 编辑器处于同一个视觉面板，不得再单独放置在另一个标题栏中。

### 3. 参与进度

用于回答“还有谁参与、进行到哪里”，包含：

- 全部参与 Role；Role Name 为主信息，Human/Agent 与建议票/决策票为次级信息。
- 每个参与者的等待启动、运行中、草稿、已提交、失败等状态，以及已提交 Vote 的简要结果。
- Agent 参与者保留最近活动、查看详情、attempt 选择、增量时间线、失败摘要和合法 Retry；Activity 默认折叠并原位展开。
- Runner 作为参与者按同一语义展示，不额外制造一套特殊列表。
- 已提交参与者可以作为锚点跳转到“评审记录”中该参与者最新的正式意见；尚未提交时不提供无效跳转。
- 整体提交进度、决策票统计、未处置 blocking 意见和环境失败等聚合状态，使用面向用户的中文或英文自然语言表达，不直接拼接内部字段名。

本版块只展示状态和导航，不包含 Identity 切换、Vote 编辑、Comment 输入或 Submit 操作。

### 4. 评审记录

用于回答“这一轮发生了什么、结论是什么”，包含：

- 本轮汇总置于版块顶部，使用自然语言说明当前状态、决策票结果、建议票数量以及是否等待 Runner。
- 修改摘要及其对应 Submission、Round 关系。
- 已正式提交的 Assignment Opinion 与 Runner Vote，严格按实际提交时间倒序排列；每项先显示时间，再显示 Role、Vote、Summary 和 Comment。
- Comment 的严重级别、定位入口与处置状态。
- 历史轮次展示其不可变的完整记录，不混入当前轮草稿。

私有草稿不属于评审记录；只有正式 Submit 后的内容才能进入本版块。

### 整体顺序与响应式行为

右栏默认顺序固定为：

1. 评审范围
2. 我的评审
3. 参与进度
4. 评审记录

完成态必须形成四个肉眼可区分的同级面板，而不是继续复用当前只有 Controls 与 Comments 两个泛化区域的布局。每个面板都必须有始终可见的标题、独立边框和内边距：

```text
Artifact Review Header
├── 评审范围      Artifact / Round / Policy / 时间
├── 我的评审      Identity / Vote / Comment / Severity / Submit
├── 参与进度      各 Role 状态 / Agent Activity / Opinion 锚点
└── 评审记录      本轮汇总 / Revision Summary / 正式意见时间线
```

当前无可执行 Human Assignment、查看历史轮次或 Review 已结束时，“我的评审”可以收敛为只读状态，但其余版块顺序保持稳定，避免页面结构随状态大幅跳动。

候选 Artifact 与 requirement、implementation、validation 等前序证据统一由左侧“评审材料”选择器展示。右侧不得重复 Candidate 或 Evidence 正文；左侧切换材料不得清空右侧草稿。

桌面端各版块为同级独立面板，不嵌套卡片，右栏整体纵向滚动。移动端沿用“产物/评审”分段视图，评审页按同一顺序单列展示。版块标题、控件和长文本不得重叠或横向溢出。

## 范围

- 重构 Artifact Review 大浮窗右侧区域，不修改独立 Memory Review 侧栏。
- 按四个有可见标题和独立边框的版块重新归组现有 Artifact Review 信息和操作。
- 保留主干新增的 Agent Activity，并将其稳定归入对应 Agent 的参与进度行。
- 统一当前轮、历史轮、Human、Agent、已提交和失败状态下的版块行为。
- 补齐中文和英文标题、状态与操作文案。
- 修复严重级别选择器的菜单定位、尺寸和中英文选项显示。
- 保留现有 Artifact、Review、Round、Assignment、Comment、Vote 和 Evidence 数据模型与 API 语义。
- 保留现有分栏拖动、移动端“产物/评审”切换、关闭后恢复原位置、草稿冲突恢复、权限隔离和历史轮次读取行为。
- Artifact Review 浮窗打开期间锁定背景页面；backdrop 上的滚轮、触控或键盘滚动，以及浮窗滚动区到达边界后的继续滚动，都不得传递到底层页面。
- 更新 Artifact Review Browser 与 Playwright 自动化测试。
- 按适用规范检查并更新 `memsphere-review` 等 System Memory；若只是视觉归组且不改变用户语义，应在技术方案中记录无需更新的理由。

## 不做事项

- 不展示 Agent 实时会话、思考过程或原始终端画面。
- 不建设 Workspace diff、Git diff 或代码文件变化可视化。
- 不允许用户自定义版块顺序，不实现折叠偏好跨设备同步。
- 不修改 Decision Policy、Role、Permission 或 Review Store 数据模型。
- 不重做左侧 Artifact Renderer 和 Comment Anchor 协议。
- 不调整独立 Memory Review 的创建、Comment 或 Submit 交互。

## 验收标准

- Human 在当前轮选择身份后，能在一个独立面板内完成 Vote、Comment、严重级别选择和 Submit，操作链路中间不穿插汇总、摘要或证据包。
- “我的评审”中的“评审意见、投票、提交评审”三个操作区按操作顺序排列，并有明确标题、说明和视觉分隔；首次用户能区分 Comment、立场选择与最终提交。
- 提交区显示当前 Vote 与草稿意见数量；“添加意见”不会被误认为提交整份评审。
- 右栏可清楚辨识“评审范围、我的评审、参与进度、评审记录”四个有标题和独立边框的同级版块，各版块只承载约定内容。
- 私有草稿只出现在“我的评审”，正式意见只出现在“评审记录”，两者不会重复或混淆。
- 未选择身份或当前 Review 只有 Agent Assignment 时，评审材料、评审范围、参与进度和评审记录仍完整显示；选择身份前后这些公共内容保持一致。
- 本轮汇总位于“评审记录”顶部，正式意见按时间倒序；Runner 最后投票时显示在最前。
- 历史轮次只读且不出现可误操作的 Vote、Comment 或 Submit 控件。
- Agent Assignment 不出现 Human 操作控件；失败时可在“参与进度”查看失败摘要并 Retry。
- 参与进度中的已提交 Role 可以定位到对应正式意见。
- Candidate 与前序 Evidence 仅在左侧材料区展示，右侧不重复正文；材料切换不丢失草稿。
- Agent Activity 继续在对应参与者行按 attempt 展开，增量轮询、历史记录和阅读位置不回归。
- 严重级别菜单稳定锚定在触发控件下方，内部枚举不与用户文案混排。
- 中文界面不混入未翻译的整体状态摘要；英文界面使用对应英文文案。
- 桌面与移动端均无内容重叠、不可达操作或横向页面溢出。
- 浮窗打开时底层页面不可滚动；鼠标位于 backdrop 或浮窗内部滚动区已到边界时继续滚动，页面位置保持不变，关闭后仍恢复到打开前的位置。
- 已有分栏拖动、移动端切换、关闭后恢复位置、定位 Comment、草稿保留、409 自动恢复、身份权限隔离和历史轮次行为不回归。
- 自动化测试覆盖版块归属、状态分支、时间倒序、参与者锚点和响应式布局。

## 已确认项

- 前序证据与 Candidate 正文统一位于左侧材料区；右侧不再建立重复的“评审依据”面板。
- Agent Activity、状态、失败摘要与 Retry 保持在对应参与者行，不进入 Human Identity Selector。
- “我的评审”第一版不 sticky。
- Review 已结束后保留当前 Human Assignment 的紧凑只读状态，完整正式内容只在“评审记录”展示。

## 关联需求

- 强关联且已完成：`20260720-artifact-review-evidence-view`。该需求建立了大浮窗、历史证据和左右分栏，本需求在其基础上重构右侧信息架构。
- 强关联：`20260720-artifact-review-human-loop`。该需求定义 Human Identity、Comment、Vote、Submit 和多轮交互，本需求不改变其业务语义。
- 相关且已完成：`20260722-artifact-review-draft-conflict-recovery`。本需求必须保持其本地草稿与 409 自动恢复行为。
- 相关：`20260720-artifact-review-agent-acp`。Agent Assignment 状态、Activity、失败摘要和 Retry 需要进入“参与进度”版块。
- 重复需求：无。

## 技术与测试方案

### 实现结构

- 右栏建立“评审范围、我的评审、参与进度、评审记录”四个带标题和独立边框的同级 Panel。
- Header 只保留全局识别与关闭；Artifact/Round 选择、Policy 和轮次时间进入“评审范围”。
- Identity、票型、Vote、Comment、Severity、Draft 和 Submit 统一进入“我的评审”。已提交时只保留紧凑状态和正式记录跳转，完整正式内容只在“评审记录”展示。
- “我的评审”内部以 fieldset/语义分组或等价结构按“评审意见、投票、提交评审”拆分，不使用嵌套 Panel；提交区展示 Vote 与草稿计数。
- 聚合状态、参与者列表、Agent 失败摘要、Retry 与主干新增的 Agent Activity 进入“参与进度”。
- Candidate 与 Evidence 正文继续由左侧材料选择器统一展示，右侧不重复内容。
- 本轮汇总、Revision Summary、正式 Opinion、Runner Vote 和 disposition 进入“评审记录”，按实际提交时间倒序。

### 代码影响

- `src/commands/view.ts`：增加历史 Round disposition 只读投影，不改变 Store、Policy、Agent Activity API 或写接口。
- `src/view/browser.ts`：建立四个有标题的挂载区，将全局 append helper 改为明确目标容器，保留左侧材料选择、Agent Activity 增量轮询与阅读位置、草稿恢复、身份隔离、分栏、移动端和关闭位置恢复。
- 模态打开状态同时锁定文档根节点与 `body` 的滚动，并在左右独立滚动面板阻断 overscroll chaining；关闭时复用既有位置恢复逻辑。
- `reserved-memory/procedures/memsphere-review.yaml` 与当前安装副本：同步用户可见 Review View 语义；检查 Skill 后若 CLI 语义未变则不修改。

### 验证

- 更新 `test/artifact-review-view.test.ts`、`test/view-browser.test.ts` 和 `test/artifact-review-browser.test.ts`。
- 针对性验证 Disposition 脱敏投影、四版块归属与边框、Human/Agent/历史状态、Agent Activity、时间倒序、锚点和响应式布局。
- 验证右侧不重复 Candidate Artifact，以及 Severity 菜单的定位、尺寸和 locale 文案。
- 继续回归草稿隔离、409 恢复、定位 Comment、分栏、菜单、背景滚动锁定、滚动边界隔离、关闭位置恢复和移动端无溢出。
- 修改 Reserved Memory 后单独运行 `npx tsx --test test/reserved-store.test.ts`。
- 最后执行 `npm run typecheck`、全量 `npm test`、`npm run build`、当前 worktree 的 `memsphere init` 与 `memsphere validate`，记录本轮实际结果。

## 开发任务

1. 补充历史 disposition 投影及 View API 测试。
2. 建立四个带标题和独立边框的右栏 Panel，迁移 Header 元数据。
3. 实现“我的评审”的 Human、已提交和历史轮次状态，并按评审意见、投票、提交评审的顺序拆分三个操作区。
4. 修复 Severity 选择器的菜单定位、尺寸与中英文显示。
5. 迁移参与进度、自然语言摘要、Agent Activity、失败摘要、Retry 与 Opinion 导航。
6. 迁移本轮汇总、Revision Summary、正式 Opinion 与 disposition。
7. 更新 System Memory 并刷新安装副本。
8. 更新 API、Browser、Agent Activity 与 Playwright 测试并完成项目门禁。

## 验收结果

- Artifact Review 右栏已按“评审范围、我的评审、参与进度、评审记录”重构为四个稳定、同级面板。
- 评审身份只影响“我的评审”；无 Human Assignment 时明确显示“无需评审”，公共材料、范围、进度和记录保持一致。
- Human 操作按“评审意见、投票、提交评审”组织，正式意见、轮次汇总、时间顺序和参与者导航均按冻结契约展示。
- Artifact Review 浮窗打开期间已锁定背景页面滚动，并阻断浮窗滚动边界向背景传播；关闭后恢复打开前的位置。
- 针对性 Review/View/Playwright/Reserved Store 测试通过，共 70 项。
- `npm run typecheck`、`npm test`（295/295）、`npm run build`、`node dist/cli.js validate` 和 `git diff --check` 均通过。
- Agent Review 最终轮无阻塞意见，Human 于 2026-07-23 确认验收通过。
