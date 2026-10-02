---
id: 20261001-project-models
type: feature
created: 2026-10-01
completed_at: 2026-10-02
run_id: run-20261001-054855z-53c67dce
---

# Project 模型存储与模型界面

## 需求

在每个 Project 中管理模型定义：使用现有 filesystem DataStore 保存 JSON Schema 定义，在项目设置中配置存储目录，并通过与“记忆”“运行”并列的“模型”模块浏览定义。

模型定义是元模型 `json-schema/draft-07` 的 Data；只需要按 model_id 加载，不需要按定义内部的具体字段检索模型。复用现有 DataStore、DataManager、扩展、ViewHost、公共 UI 和项目设置体系。

Human 只以产品负责人身份参与需求、产品原型和交付验收；产品 Agent 同时参与产品评审。研发、架构、测试评审分别由现有 Agent Actor 承担。技术方案中的产品范围、可见行为或交互变化仍需产品确认。

## 当前迭代范围

1. 为 Project 装配 JSON Schema 模型定义 DataStore，复用 `memsphere/filesystem`，StoreId 暂定 `models/json-schema/draft-07`，绑定元模型 `json-schema/draft-07`。
2. 项目设置增加“模型存储”目录配置，默认值为 `models/json-schema/draft-07`。相对路径以 Registry 已登记的 Project 根目录为基准，即 `ResolvedProject.paths.root`；绝对路径直接使用。不是当前工作目录、Git 仓库目录或 Memory 目录。宿主解析为绝对路径后交给 Factory。
3. 一份定义对应一个可直接阅读的 JSON 文件；不增加外层记录、私有编码或独立索引文件。模型 ID 遵循当前 filesystem 实现，即包含 `.json` 的可移植相对路径，如 `sales/order.json`。
4. 模型来源与 Store 绑定接入 Project 的模型加载；按 model_id 得到 Model，并能为当前 JSON Schema 扩展支持的模型准备 Runtime。补齐所需的元模型引导能力，具体实现交由技术方案确定。
5. 每个 Project 提供“模型”模块，列出该 Project 已定义的模型；浏览完整定义、模型 ID、定义标准及可用的名称/说明。列表不依赖某个 Runtime 是否已经被创建。
6. 产品设计阶段先提供真实 View Shell 内可运行的独立 Module 原型，复用导航、内容列表、Theme 与 UI；产品负责人确认契约及原型后再开展正式功能开发。
7. 默认以紧凑树形表格展示模型结构，包含字段 / 结构、类型、格式、规则、说明五列；格式展示当前节点的 JSON Schema `format` 及 `enum` 可选值，两者均未声明时为 `—`，不推断格式或新增校验；最外层对象容器不占行，对象直接显示字段；数组根恢复 `[根结构] — 数组` 结构行，其下展示 `[元素结构]` 及元素内部结构，不能把元素的对象类型当作模型根类型。内部对象与数组逐级展开，固定缩进与小方框 `+ / −` 按钮表达层级，不显示连线；叶子保留同宽按钮占位，同层字段名对齐。数组元素用不同于字段的结构行样式和 `[元素结构]` 名称表示，方括号标识其不是实际字段，不再重复显示“数组元素”及旁边标签。原始 JSON 在单独的“原始定义”视图中完整展示，不提供独立的复制定义按钮。只读浏览是本轮正式界面的范围。
8. 配套中英文固定文案、桌面/窄屏适配、错误与空状态；按仓库规则同步正式能力的文档、System Memory 和 Skill。
9. anyOf / oneOf 的候选类型使用 `A | B` 摘要，组合方式仅在规则列显示“至少满足一个分支 / 恰好满足一个分支”，随界面语言切换；类型列不重复展示组合标记。展开分支统一为 `[类型1]`、`[类型2]`，title 作为补充名称；父行对象候选优先使用名称，未命名时显示类型1、类型2。分支分别展开，字段和必填不合并。保留本层显式 type、分支格式及嵌套结构，不修改模型文件、数据层 Runtime 或校验行为。
10. true / false Schema 的类型显示 `—`，允许规则显示在规则列，true 为“无限制”，false 字段为“不允许存在”，非字段子模式为“不允许任何值”。必填独立展示，可选省略，无其他规则为 `—`，矛盾的必填与禁止仍同时呈现；说明列仅展示 description，系统生成的实际限制在规则列，不生成整体定义摘要或详见原始定义等阅读提示；枚举按显式类型显示文本枚举、数字枚举、整数枚举等，候选值自动从 enum 提取并展示在格式列，不依赖 description。有 format 时与候选值一并保留。if / then / else 不新增可视化解析。

## 产品设计

以下设计随契约一起评审，不代表正式功能已经实现或验收：

- 主导航名称为“模型”，对象列表与详情沿用公共 Shell 的布局。详情默认使用可逐级展开的树形表格，支持全部展开/收起；规则列的必填相对于所属对象，数组根与数组元素不标注必填，但保留自身规则。对象根容器不占行，数组根恢复 `[根结构] — 数组` 行，标量根使用同一个 `[根结构]` 名称并保留类型；不生成对象根整体规则说明段落，其他根的实际规则在其规则列展示，空对象显示未直接声明字段的提示。原始定义作为辅助视图，不建设图形编辑器。
- “全部模型”包含持久化 JSON Schema 业务模型以及当前 Project 装配的内置 raw 业务模型，内置模型标识为只读来源。系统元模型作为定义标准信息展示，不混入业务模型列表。
- 模型存储配置正式位于项目设置，不在模型详情右上角提供整个 Project 的模型存储配置入口。原型中仅保留独立的“存储设置预览”以确认交互，不修改正式 Settings 或真实配置；此预览导航不作为正式模型模块的配置入口。
- 更改存储目录只切换使用位置，不自动迁移已有模型文件；页面说明该行为。
- 模型列表和原始定义属于只读浏览；模型创建和编辑通过调用既有 DataStore 接口或直接维护定义目录中的文件完成。本轮不新增网页编辑、上传或模型管理 CLI。

### 本地引用展示（Human 确认的试用修订）

同一份定义内的引用直接展示目标类型并展开目标字段，包含连续引用、数组元素、动态字段、联合分支及递归结构。规则列保留来源；引用字段的必填属于原父对象，目标内部字段使用目标 required。目标 format/enum/description 可直接阅读，引用节点自己撰写的 title/description 优先作为展示注解，不合并同层校验关键字，不改原文或 Runtime。递归边界只允许手动继续展开，全部展开不无限递归。缺失、非法、纯别名循环、跨模型引用及嵌套 $id 作用域明确显示未解析原因，不访问网络、不伪造字段；跨模型自动加载另行讨论。

### 模型目录规则

- Project 根目录沿用现有 Registry 的 `projects[projectName].root`，由 Project Resolver 得到 `paths.root`，不增加一个新的“数据根目录”配置。标准创建的 Project 位于 `<Memsphere Home>/projects/<projectName>`；若登记的是其他位置，使用实际登记位置。
- 已有 Project 未设置模型目录时，解析为 `<Project root>/models/json-schema/draft-07`。目录尚不存在时列表为空，后续存储写入可按现有 filesystem 实现创建目录，不要求用户修改已有配置才能打开模型页面。
- 相对配置值如 `custom-models` 解析为 `<Project root>/custom-models`；绝对配置值不再拼接 Project 根目录。项目设置同时显示配置值、相对路径基准和解析后的绝对路径。
- 保存后重载沿用该 Project 的配置值重新解析，不受命令启动位置或切换 Git worktree 影响。变更目录只切换位置，不搬运原目录文件；不增加自动迁移或历史回退。
- 各 Project 独立保存目录配置，默认目录自然隔离。用户显式配置相同物理目录时会共享其中的文件；框架不自动复制数据或为显式目录追加隐藏的 Project 子目录。

当前候选原型入口为 `/projects/memsphere/model-prototype`，配置预览为 `/projects/memsphere/model-prototype/storage`。样例包含订单定义、运行状态定义、项目内置 raw 模型与单个失败项；运行状态只是界面示例，不代表本轮迁移 Run 状态。界面明确标注示例数据，配置保存只影响原型会话。

本地体验：[模型原型](http://127.0.0.1:30000/projects/memsphere/model-prototype)、[模型存储配置预览](http://127.0.0.1:30000/projects/memsphere/model-prototype/storage)。正式功能尚未实现，原型不会写入真实模型或配置。

### 原型验证记录（历史，复制功能已按后续反馈移除）

2026-10-01，在正式 ViewHost 的 `model-product` 隔离浏览器会话中使用 playwright-cli 检查：

- 桌面 1440×1000：四个样例、完整 JSON、复制内容一致、按 ID/名称筛选、选中后 URL 重开、内置 raw 定义、单个失败隔离、未知模型提示。
- 空列表、加载态、列表失败、重试与刷新；配置必填校验、会话保存、放弃修改恢复预览值。
- 导航到 Memory 后原型正文卸载，返回可再次挂载；检查期间无 console error/pageerror。
- 窄屏 390×844：页面宽度与视口均为 390，无页面级横向溢出；键盘 Enter 可激活复制定义。
- 原型 Module 英文的列表、定义、复制与目录校验：仅在隔离浏览器响应中注入该 Module 的 `locale=en`，检查后移除拦截。没有修改 Home 语言；此项不作为正式 Home 语言切换的验收。
- `npm run typecheck`、`npm run build` 通过；受影响的 Module/View 路由/样式/语言测试 22/22 通过；`memsphere validate` 与 `git diff --check` 通过。

截图已查看，保存于本需求的 `assets/model-desktop.png`、`assets/model-storage.png`、`assets/model-mobile.png`、`assets/model-mobile-definition.png`、`assets/model-english.png`。正式功能的完整回归与 Memory 同步尚未执行，保留在后续实施/交付阶段。

### 树形表格原型修订

Human 指出原始 JSON 不适合面向人的模型阅读，确认树形表格方向并要求修改原型。本地候选已更新当前范围与验收标准；第 1 轮冻结的 Submission 未改变，不能把本次修改原型的指示视为 Human 正式投票。

- 默认显示对象根和第一层字段，按箭头或字段名逐级展开；保留独立的数组元素节点，所有层级共用四列表头。
- 支持全部展开/收起，收起父级时隐藏整个子树，再打开保留子级展开状态；键盘 Enter 可操作，操作后焦点保留。
- 根节点及数组元素不标注必填，子字段按所属对象的 required 展示“必填”，省略“可选”；无其他规则为 `—`。description 在说明列原样展示，系统生成的范围、固定值、组合与引用提示在规则列；枚举候选在格式列，不猜测业务解释。
- “模型结构 / 原始定义”切换保留树的展开状态，复制始终得到完整原始定义；raw 模型说明其不声明成员字段，不伪造字段结构。
- 正式 ViewHost 实际验证桌面 1440×1000 与窄屏 390×844，表格内部可横向滚动、类型不折行、规则按内容换行、页面无横向溢出；无 console error/pageerror。
- 英文树形界面与原始定义切换通过隔离浏览器的 Module 语言注入验证，拦截已移除，真实 Home 配置未改。
- `npm run typecheck`、`npm run build`、`git diff --check` 通过；新增 5 项树结构测试，受影响测试合计 27/27 通过。新版截图为 `assets/model-tree-desktop.png`、`assets/model-tree-mobile.png`、`assets/model-tree-english.png`。

第 1 轮冻结的 Submission 保留不变。Human 于上述原型调整后明确表示“同意，请继续流程”，Runner 已提交其通过票（0 条 Comment）。产品 Agent 提出了目录基准不明确的意见；Runner 采纳该意见并要求修订，将本节原型调整及明确的目录规则一起纳入下一轮 Submission。

Human 随后确认展示细节可后续调整、不阻碍原型，并要求取消详情页右上角的“模型存储”入口。本地原型已移除该 Header Action；模型详情不再暴露 Project 级配置入口。正式配置仍统一归入项目设置，原型的独立设置预览仅用于产品评审。

该入口调整已在真实 View 中确认：四个样例详情和窄屏均无“模型存储”按钮，刷新和独立预览导航正常，无 pageerror。`typecheck`、`build`、27 项受影响测试与 `git diff --check` 通过；当前截图为 `assets/model-without-storage-action.png`。

## 后续范围

### 交付试用中的展示修订

Human 试用覆盖类型及嵌套的用例后，要求去掉冗余最外层对象、修正同层字段对齐、区分数组元素结构与实际字段，并强化全部展开时的归属关系。以上反馈已纳入当前范围与产品设计；不修改模型文件、存储或数据层公共接口。此前原型验证记录与已冻结的评审提交保留当时内容。这些试用反馈不作为 Human 的正式验收通过票。

Human 随后确认用 `[元素结构]` 替代重复的名称与标签，并提供无连线的紧凑树表参考。当前候选改为固定缩进、小方框加减号及紧凑行距，取消首次修订中的连线；四列信息、原始定义及展开状态/键盘行为不变。

Human 指出数组根不能丢失数组类型，并明确选择“恢复数组根的结构行”，不采用表格上方说明。当前候选仅省略对象根容器，恢复数组根的 `[根结构] — 数组` 行；其下的元素结构与内部字段逐层展开。

Human 确认字典也应展示值类型，并在混合固定字段的用例中进一步明确：显式 `additionalProperties` 用 `[动态字段]` 行表示名称可自定义的一类字段，与固定名称字段同层展示，不伪造具体名称，不标注必填。类型列描述字段值类型；值为对象或数组时继续展开内部结构。字典说明使用“键名可自定义，每个值都是文本”等可读文案；复杂的模式匹配与引用仍查看原始定义。该反馈仅完善只读树表，不改变模型内容语义、数据层接口或 Runtime 的支持范围。

Human 明确不需要“复制定义”功能，并指出按钮占满一行不合理。正式模块与原型均取消按钮、剪贴板处理和无内容的状态占位；元信息之后直接进入模型结构/原始定义切换，不迁移复制动作到其他位置。保留完整原始定义阅读及已有树表交互。

Human 要求“全部展开 / 全部收起”改为右侧轻量文本按钮，并删除其下通用说明段落。正式页面与原型同步，仍保留按钮的键盘操作和焦点提示，不做页面跳转；模型整体规则与字段说明不属于被删除的通用提示。

数据值实例的查询与管理、Run 状态接入 Model/ValueStore、模型网页创建与编辑、可视化建模编辑器、字段检索/索引、云存储接入、模型历史版本/迁移、跨 Store 一致性协议均不属于本轮。Human 随后提出的模型分域组织明确留待本轮完成后再讨论，当前不增加分域字段或界面。

## 模型展示扩展：已确认补充

Human 确认模型模块补齐与记忆、运行一致的两层 Slot：`org.memsphere.models.page.presentation@1:page` 替换详情页整体展示，`org.memsphere.models.definition.renderer@1:definition` 替换结构或原文正文。沿用全局界面与主题配置、候选选择、官方默认及失败回退；不改变路由、存储结构或数据层 API。页面扩展通过官方 presentation 服务读取模型摘要与定义、刷新和导航，不接管模型加载。验收覆盖两层独立替换、内置列表独立加载、失败回退、显式默认选择、Project 隔离、卸载及中英文设置入口。

## 待确认项

无待确认的产品问题。Human 已对第 2 轮契约提交通过票；当前迭代范围与上述产品设计按该票确认。技术方案中的实现选择由研发、架构和测试 Agent 评审，若引起范围、可见行为或交互变化，仍须先取得产品负责人确认。

产品 Agent 指出的本章节缺失与残留候选措辞已在本地契约补齐。该修正仅明确现有通过票的确认状态，不增加或改变产品范围；第 2 轮冻结 Submission 不变，Runner 通过正式意见处置记录关联本修正。

## 交付物

- 可在正式 View 体验的产品原型及桌面/窄屏截图、产品评审结论。
- 当前需求契约、实施与验证方案、开发计划及对应 Run 产物。
- 模型定义 Store 与 Project 装配、目录配置、模型列表/详情和配套测试、文档及 Memory。
- 实际验证记录、三方实现评审、产品交付验收及本轮 commit 结果。

## 验收标准

1. 已有 Project 未配置新增字段时使用 `<Registry 登记的 Project root>/models/json-schema/draft-07`；不存在的目录显示空列表。两个 Project 的默认目录、保存的配置及模型展示独立；显式指向同一目录时按用户配置共享文件，不宣称仍有物理隔离。
2. 在配置目录中放入 `sales/order.json` 后，刷新能发现该模型并按同一 model_id 加载；完整定义与原文件一致，无封套或编码转换。
3. 模型 ID 使用 `/` 分隔并包含后缀；沿用现有跨 Linux、Windows、macOS 的 filesystem 约束，不使用平台相关路径作为逻辑 ID。
4. 通过 DataManager 加载上述受支持模型并获取对应 Runtime，能够反射访问符合定义的订单值；不要求先使用业务实例才可列出模型。
5. 项目设置能够查看、修改、校验和保存模型存储目录，并显示 Project 根目录基准及解析后的绝对路径。相对路径按 `paths.root` 解析，绝对路径直接使用；保存、重新加载、从不同命令目录或同仓库不同 worktree 使用时结果一致。切换目录后使用新目录，原目录内容保留，不自动搬运。
6. 模型列表展示当前 Project 的完整定义目录，支持按 ID/显示名称做列表筛选；不按定义内部字段查询。详情默认展示树形字段表，对象/数组逐级展开、层级列对齐、数组元素独立显示，原始定义视图保留完整内容；没有复制定义按钮或为该动作保留的占位行。
7. 无模型、列表加载失败、模型缺失、单个无效定义有明确反馈；单个定义错误不妨碍查看其他有效模型，不静默隐藏坏定义。
8. 原型在真实 ViewHost 中运行；桌面/窄屏、筛选/选中/空状态、原始定义查看、设置草稿/校验/放弃、语言及卸载清理均有实际操作证据。最终界面也通过 playwright-cli 实际操作验收。
9. 受影响测试和完整回归通过，执行 typecheck、build、Project validate；有 Memory 差异时对最终内容执行 change validate 并记录 ID、状态和 View 入口。
10. 产品负责人确认需求和原型，研发/架构/测试三位 Agent 对方案和实现完成正式评审，最终由产品负责人验收。

## 向前兼容

结论：不需要向前兼容。

本轮新增模型定义目录与配置，当前没有需要迁移的旧模型存储格式；不建设历史模型格式兼容或迁移分支。仓库当前没有名称含 stable 的 Tag，不将任意旧提交声明为稳定 checkpoint。

已有 Project 配置省略新增可选配置时使用默认值，既有 Memory、Run、Review 与 Settings 正常工作属于本轮回归保护。既有 Run 状态、内容存储及记录不因本轮改造发生迁移。

## 采用的规范与关联需求

- `statements/memsphere-repository-requirement-rules`：范围、独立向前兼容结论与稳定 checkpoint 口径。
- `statements/memsphere-repository-development-rules`：避免过度设计、正式能力的 System Memory/Skill 同步。
- `statements/memsphere-repository-testing-rules`：适用层级的测试、全量回归、真实浏览器操作、Memory 双重校验。
- `statements/memsphere-repository-delivery-rules`：验收后更新 change 状态、归档及完整交付证据。
- `concepts/memsphere-view` 与 `docs/view-plugin-guide.md`、`docs/view-ui-primitives.md`：独立 Module 原型、公共壳/UI/Theme 边界、国际化与真实 Shell 验证。
- 关联已完成需求：`20260929-artifact-datastore`；PR #80 已合并，本轮使用独立分支 `codex/project-models`，基线 `9766bdb6a85c42610a08fed1945a1e06303c5e98`。
- 未发现同目标的重复 active 需求。

## 技术与测试方案

产品原型以独立 `org.memsphere.model-prototype` Module 接入正式 View。[实施与验证方案](implementation-plan.md) 已基于实际代码编写并提交三方技术评审：`review-20261001-063839z-02dbd43d`，第 1 轮 `round-20261001-063839z-93f1d5ca`。正式功能施工在方案通过后开始。

## 开发任务

- [x] 启动敏捷 Run，按角色绑定产品与技术评审。
- [x] 调查现有存储、装配、项目配置和 View 原型能力，形成需求契约候选。
- [x] 完成可体验产品原型及实际交互检查。
- [x] 提交需求契约与原型产品评审。
- [x] 确认需求契约和原型。
- [x] 完成技术方案与三方方案评审。
- [x] 实现正式功能及配套测试/文档/Memory。
- [x] 完成验证、三方实现评审、产品验收与需求归档；Git commit 的精确结果由 Run 后续产物记录。

## 验收结果

2026-10-02，交付 Review `review-20261001-073226z-3ba4727a` 第 2 轮 `round-20261001-162723z-692ecef0`，Human 明确“我投通过”，Runner 已受托提交 approve（0 条 Comment），产品 Agent 也在本轮提交 approve。Runner 阅读两方意见及实际验证后正式通过，产品交付验收完成，当前步骤进入 Git commit。第 2 轮完整材料见 `delivery-report-round-2.md`，最终测试 858 项：857 通过、0 失败、1 项既有 Windows-only 在 Linux 条件跳过；typecheck、build、Project validate、Memory ChangeSet validate 通过。Memory `change-20261001-065614910z-18de9f8c`，digest `c085756a7ddfb91552e7532ff98d695f7f074ecef61129b8c2e9dabe03a7d4ab`。验收与归档证据见 `acceptance.md`。

实现两轮三方评审由 Runner 接纳；研发关于 URI→文件别名映射的建议按已批准“不新增别名解析器”范围拒绝，不称三方一致通过，处置见 `implementation-review-dispositions.md`。试用修订已纳入第 2 轮新交付材料，不复用第 1 轮产品票。原生 Windows/macOS 风险保留；分域等后续范围不加入本轮。上述产品原型阶段记录保留其当时语境。

需求与原型使用本 Run 的产品评审 `review-20261001-060304z-b58d03f5`。第 1 轮 `round-20261001-060304z-4827c57d` 已记录 Human 通过，Runner 根据产品 Agent 意见要求修改；第 2 轮 `round-20261001-063310z-628b147f` 已记录 Human 通过（0 条 Comment），产品 Agent 的待确认项文字意见已处置，Runner 通过并推进技术方案阶段。第 2 轮提交前 `build`、27 项受影响测试及 `git diff --check` 通过；原型目录帮助文案同步明确为登记的 Project 根目录。这是产品设计确认，不代表正式功能已实现或交付验收通过。
