# 模型树表：交付试用反馈修订

Run：`run-20261001-054855z-53c67dce`。本记录补充当前试用候选，不改写已冻结的交付 Submission，也不代替 Human 正式投票。

## 首次反馈与改动（历史，最新布局见后文）

- 去掉对象/数组的最外层容器行：对象直接列出字段，根数组从元素结构开始；内部对象/数组仍可逐级展开。标量根仍展示模型值的类型、枚举及说明。
- 使用相同的固定箭头占位和标签布局，对齐同层可展开字段、叶子字段及结构节点。
- 数组元素不是字段：增加“元素结构”标签、独立底色，必填仍显示 `—`。标量根增加“模型值”标签；第一列表头为“字段 / 结构”。
- 增加带末端转角和祖先延续的树状连线，展示全部展开后的归属；字段名使用等宽字体。全部收起仍保留顶层字段/元素结构，不变成空表。
- 根层整体规则单独提示，空对象显示未直接声明字段提示；原始定义始终完整保留，不伪造引用或组合条件的子字段。

正式模块和原型复用同一展示逻辑，各自使用作用域内的公共 Theme Token。没有修改模型文件、用户配置或 `src/data/api`；模型分域仍不属于本轮。

## 首次验证（历史）

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 受影响测试 31/31 通过，包含同层横向位置/基线测量、深层连线、数组结构标签、根数组、空对象、根规则、标量根、键盘焦点及原文复制；首次测试的延续线断言因用例没有对应分支失败，补齐有后续兄弟的嵌套用例后重新执行通过。
- 最终 `npm test`（含构建）827 项：826 通过、0 失败、1 项既有 Windows-only 在 Linux 条件跳过。
- playwright-cli 在真实用户 Project 中逐个选择八个已授权创建的用例，全部展开并测量各层标签位置；逐字核对原文，未修改数据。展开行数为 23、33、17、8、10、3、1、1，无 pageerror。390px 窄屏没有页面级横向溢出。
- 已查看截图：`assets/model-hierarchy-revision-desktop.png`、`assets/model-hierarchy-revision-array-elements.png`、`assets/model-hierarchy-revision-mobile.png`。移动端截图记录详情上部；表格内部横向滚动另由浏览器回归验证。
- System Memory 源与开发副本同步；Skill 的通用树表说明无需重复具体布局。Project validate 和 Memory ChangeSet validate 都通过，ChangeSet `change-20261001-065614910z-18de9f8c`，最新 digest：`dbc1e76e95dc8c5e4414959a965cae885b689d8a721acaab6e8683364bc3c26f`。

## 布局修订：方括号、加减号、紧凑布局与数组根（命名见后文）

Human 随后提供紧凑树表参考，要求结构节点只显示 `[元素结构]`，以方括号区分非字段，且倾向于用加减号和紧凑排版代替连线。Human 另明确选择恢复数组根的结构行，而非表格上方注明类型。

当时的布局候选：

- 数组元素仅显示 `[元素结构]`（英文 `[Item structure]`），不重复显示“数组元素”或旁边 Badge；节点类型仍在类型列。
- 对象根省略容器行；数组根恢复 `[模型值] — 数组`，其下再显示 `[元素结构]` 及子字段。数组根和元素都不是字段，必填为 `—`；数组根自己的说明和元素数量限制在该行展示。
- 展开按钮改为小方框 `+ / −`，继续支持整条字段名点击及键盘 Enter、焦点保持。保留固定宽度占位对齐叶子，固定每级缩进；移除连线及其祖先分支跟踪逻辑。
- 表格改为紧凑字号、较小纵向间距和按钮间距；表头不折行，四列信息与内部横向滚动不变。
- 正式模块与原型同步；模型文件、Store/API、用户配置均未改变。契约与 System Memory 已同步；Skill 的通用树表说明无需修改。

最新验证：typecheck、build、diff check 通过；受影响的树表/浏览器/样式/Reserved Store 合计 41/41 通过。更新的回归断言覆盖加减号与展开状态、紧凑短行高度、同层位置与基线、无重复结构标签、数组根与元素类型、数组根全部收起/恢复展开、中英文和原文复制。最终重新执行 `npm test`（含构建），827 项：826 通过、0 失败、1 项既有 Windows-only 跳过。

playwright-cli 在真实 Project 中检查基本类型、深层订单、数组根三组模型，实际测量标签对齐，展开/收起元素节点，确认数组根始终可辨识；无 pageerror。已查看最新截图 `assets/model-compact-element-structure.png` 和 `assets/model-compact-array-root.png`。此前截图保留历史，不代表当前连线仍存在。

Project validate 与最终 Memory ChangeSet validate 通过；源与开发副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed；最终 digest：`80d9352332c08127f30db75c6feb0085979f92f02c8236c569a9e90885997fb5`。View：`/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。

## 最新命名：根结构

Human 确认将 `[模型值]` 改为 `[根结构]`，英文为 `[Root structure]`。数组根和标量根统一使用该名称，类型继续在类型列展示；对象根仍省略，数组子节点仍为 `[元素结构]`。移除标量根旧的“模型值”标签，不改变展开行为或模型内容。

共享渲染器、浏览器回归测试、需求契约、System Memory 源与开发副本已同步。`npm run typecheck`、`npm run build` 通过；受影响测试 41/41 通过；重新执行 `npm test`，827 项：826 通过、0 失败、1 项既有 Windows-only 跳过。

playwright-cli 在真实 Project 中检查数组根与标量根名称、元素名称及数组根展开/收起，全部通过，无 pageerror。已查看截图 `assets/model-root-structure-name.png`。英文名称由隔离的浏览器回归用例验证，未修改用户语言配置。

Project validate 和 Memory ChangeSet validate 通过，源与开发副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed；本次 digest：`d58e23e67625cda50e24a87fdc534c63b6b7d8ded5a005f403432063feb72537`。此前验证及截图保留为历史记录。

## 最新修订：字典值结构

Human 确认字典应像数组一样展示值结构。共享树表新增 `[字典值结构]`（英文 `[Dictionary value structure]`）结构行，来自显式 `additionalProperties`；该行不是具体字段，不编造键名，必填为 `—`。值为对象或数组时继续逐级展开；普通已声明字段可以与动态值结构并列。正式模块与原型使用相同的结构行样式，不改数据层接口、Model Runtime 子集或序列化行为。

说明改为“键名可自定义，每个值都是文本”等可读表达；显式允许任意值时展示“任意值”，禁止额外字段时不给出虚构的值结构。默认未声明的开放属性不生成节点，模式匹配、引用及组合条件仍保留原文入口。模式匹配与普通字段共存时，额外值规则准确限定为未声明且未匹配规则的键。

同步更新需求契约、System Memory 源与开发副本，以及三条自建示例说明。示例通过 DataStore 更新，先检查完整定义没有其他用户修改；仅修改描述，不改变模型结构或其他模型。Skill 只描述通用树表，不重复具体节点规则，无需新增说明。

实际验证：

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 受影响命令：`node --import tsx --test test/model-prototype-tree.test.ts test/models-builtin-view-browser.test.ts test/view-style-contract.test.ts test/reserved-store.test.ts`，45/45 通过。受限沙盒内首次执行的浏览器测试文件进程失败，没有输出细项诊断；同一命令在允许启动浏览器和本地服务的执行环境重试通过，其间未修改代码。
- `npm test`（含构建）831 项：830 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过。新增回归覆盖字典嵌套、局部必填、普通字段与动态值并存、根字典、显式布尔定义、模式匹配边界、原文不变及双语。
- playwright-cli 在真实 Project 操作示例 04：文本/对象/数组三种字典值，全部展开 18 行，键盘展开及焦点保持、全部收起、嵌套值结构、原文及窄屏内部横向滚动均通过，无 pageerror。截图 `assets/model-dictionary-value-structure.png` 已实际查看；仅关闭本次验证的独立浏览器。
- Project validate、Memory ChangeSet validate 通过，源与开发副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed；最终 digest：`0b7fcebee8f09f9e757814b388db6e899b834eb3c07b4006b77de959731aedcc`；View：`/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。

上述结果仅记录当前试用候选，不覆盖先前冻结 Submission，也不把本次修改许可当作 Human 正式交付验收票。

## 最新修订：移除复制定义操作

Human 明确不需要“复制定义”，并指出整行按钮影响布局。正式页面与原型均移除复制按钮、剪贴板处理及其空状态占位；原型另移除已无用途的定义操作栏。模型信息后直接进入“模型结构 / 原始定义”切换区，不将复制操作迁到其他位置。原始定义仍可完整查看，树表行为不变；没有修改模型内容、配置或数据层 API。

README、Skill、需求契约、实现计划、System Memory 源与开发副本同步。

验证结果：

- typecheck、build、diff check 通过；受影响的树表、浏览器、样式和 Reserved Store 测试 46/46 通过。
- 全量 `npm test`（含构建）832 项：831 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过。
- playwright-cli 在真实 Project 检查正式页面与原型：复制按钮和空操作行不存在，模型信息后直接为切换区；原始定义鼠标及键盘切换正常，390px 窄屏无页面级横向溢出，无 pageerror。截图 `assets/model-without-copy-action.png` 已实际查看。
- Project validate 和 Memory ChangeSet validate 通过，源与开发副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed；最新 digest：`752891079a79c2e230c951578dec3fb77e13948a0a6a1f09417495862fd3a7f7`；View：`/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。

本记录属于当前候选修订，不覆盖冻结 Submission，不代替 Human 正式验收票；没有 stage、commit 或 push。

## 最新修订：动态字段与固定字段同层

Human 指出“字段”和“字段值结构”不应混用，确认字典的动态键应作为“动态字段”理解。正式模块与原型共享渲染器改用 `[动态字段]`（英文 `[Dynamic field]`）：表示名称由使用者指定的一类字段，与固定名称字段同层；类型列描述字段值类型，值为对象或数组时展开内部结构。方括号不是具体字段名，必填保持 `—`，不增加 `[字典字段]` 包装层。

同步共享节点 kind、两套样式、提示、单元/浏览器测试、需求契约、实施方案、用例说明及 System Memory 源与副本。Skill 的通用树表描述没有重复旧名称，无需修改。没有修改模型文件、用户配置、数据层 API、Runtime 或序列化语义；此前截图和验证保留为历史。

实际验证：typecheck、build、diff check 通过；受影响命令 `node --import tsx --test test/model-prototype-tree.test.ts test/models-builtin-view-browser.test.ts test/view-style-contract.test.ts test/reserved-store.test.ts` 46/46 通过。测试覆盖双语新名称、固定/动态字段同层、根字典、布尔模式边界、局部必填、嵌套数组和值展开及原文不变。

playwright-cli 在真实 Project 的第 04 个用例确认 groupName、version、[动态字段] 同层；键盘展开 productsBySku 后继续展开动态字段对象，batchesByDate 的数组内部结构及原文切换正常；390px 窄屏无页面级横向溢出。原型提示也同步，无 pageerror。截图 `assets/model-dynamic-field.png` 已实际查看，独立验证浏览器已关闭。

Project validate 与 Memory ChangeSet validate 通过，源与副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed；本次 digest：`26b793b31d815e23826476e1b52ac89494f550c0ced70d8d073f583f76485737`；View：`/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。命名修订的全量回归 832 项：831 通过、0 失败、1 项既有 Windows-only 跳过；后续按钮修订另行验证。本次是展示修订许可，不是 Human 正式交付验收票；冻结 Submission 不变，未 stage、commit、push。

## 最新修订：右侧文本操作与删除通用说明

Human 要求“全部展开 / 全部收起”改为右侧文本链接式按钮，并删除其下说明。正式模块与原型同步为表格右上方无边框、无底色的轻量文本按钮，悬停下划线、键盘焦点提示仍可见；保留原生 button 语义，不伪装页面跳转链接。共享渲染器删除通用说明及空占位，模型自身的整体规则和字段说明保留。

新增浏览器回归覆盖正式页面和原型的桌面/390px 窄屏右对齐、透明背景、无边框、无通用段落、Enter 展开、Space 收起及焦点保持。首次受影响执行 46/47 通过，新测试发现公共动作按钮短暂禁用会使同步展开操作丢失焦点；这两个操作改为树表内的原生同步按钮，未修改公共 UI/API。修正后 typecheck、build、受影响测试 47/47 通过，未弱化断言。

playwright-cli 在真实 Project 第 04 个混合模型和原型执行上述操作，动态字段与固定字段同层、对象/数组值展开、原文查看、窄屏及焦点均通过，无 pageerror；截图 `assets/model-text-actions.png` 已实际查看。没有修改用户的模型文件、配置或语言。独立验证浏览器已关闭。

需求契约、实施方案、System Memory 源与副本同步；Skill 通用树表说明不重复这些具体布局，无需改动。Project validate、Memory ChangeSet validate 通过；ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed，最新 digest：`7487a92e909bffac92041094fb07dcd12453ad3ca1da79d9b85c723cb3f0693a`，View：`/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。最终 `npm test`（含构建）833 项：832 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过；diff check 通过。冻结 Submission、正式投票和 Git 提交状态未改变。

## 最新修订：独立格式列

Human 要求增加对应 JSON Schema `format` 的“格式”列，并询问多类型的展示为何不一致。共享树表现在按“字段 / 结构、类型、格式、必填、说明”展示五列，正式页面和原型同步；格式直接保留当前 Schema 节点的原始字符串，未声明为 `—`。固定字段、数组元素、动态字段及标量根使用同一规则；自定义格式也作为文本展示，不从正则、内容编码、引用或组合分支推断格式，不增加校验、反序列化或类型转换行为。

多类型展示的现状是：直接读取 `type` 数组时显示多个类型，而 `anyOf / oneOf` 中的分支尚未展开，因此类型列仍显示“未指定”。这不是对组合定义含义的充分展示；组合分支可以有独立字段和条件，不能简单压成普通的类型并集。本次解释该差异，不擅自决定分支的产品展示方式，也不宣称已经修复此项。

新增浏览器回归验证标准/自定义格式、按文本安全展示、无格式与不推断分支格式、嵌套元素及动态字段、标量根、原文不变和窄屏；既有必填列断言及空对象 colspan 同步为五列，英文表头和原型也覆盖。typecheck、build 通过，受影响的树表、浏览器、样式和 Reserved Store 测试 48/48 通过。

playwright-cli 在真实 Project 第 04 个用例核对 date-time、uri、email 及未声明格式，执行键盘展开、原文切换、390px 窄屏滚动、数组根、离开模型页面的卸载及原型同步，无 pageerror。截图 `assets/model-format-column.png` 已实际查看；独立验证会话已关闭，未修改用户模型或配置。

需求契约、实施方案和 System Memory 源/副本同步；Skill 通用树表描述没有列名冗余，已检查无需修改。Project validate、Memory ChangeSet validate 通过，源与副本一致：`change-20261001-065614910z-18de9f8c`，validation passed，digest `9ded2ac1b34aa91283ffdcddb3f64fd54c5ef3040ddb9cb0223b84a431d16b5f`，View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。最终 `npm test`（含构建）834 项：833 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过；diff check 通过。原生 Windows/macOS 未实跑，沿用本轮已记录的风险。冻结 Submission、正式投票和 Git 提交状态未改变。

## 最新修订：联合类型摘要与独立分支

Human 确认 anyOf / oneOf 均可用 `A | B` 展示候选类型，组合规则保留区别，对象分支分别展开。本次修改共享 UI 渲染器和正式/原型两套样式，不修改 `src/data/api`、Runtime、Serializer 或用户模型文件。

- 没有显式本层 type 时，根据 anyOf / oneOf 展示候选摘要；`flexibleId` 为文本 | 整数，`payment` 为对象1 | 对象2。对象优先使用 title，未命名时编号；保留组合关键字和至少一个/恰好一个的含义。
- 每个分支是方括号结构行，独立保存 Schema、字段、局部 required、format 和展开状态，不合并对象字段、不继承父字段的必填状态。分支下支持嵌套对象、数组及联合；布尔 Schema 保留原义。const 在说明列显示固定值，帮助区分未命名对象分支。
- 显式本层 type 保留为类型限制，不将被该限制排除的分支类型误呈现为有效类型；同时出现 anyOf / oneOf 时保留两组标识。引用展示引用身份，不自动解析。allOf、条件、patternProperties 等未支持语义仍看原文，不宣称进行完整 Schema 类型推导或业务验证。

新增两项树结构测试及两项浏览器回归，更新根联合、格式和双语既有测试。实际 `npm run typecheck`、`npm run build` 通过；受影响命令 `node --import tsx --test test/model-prototype-tree.test.ts test/models-builtin-view-browser.test.ts test/view-style-contract.test.ts test/reserved-store.test.ts` 52/52 通过，涵盖独立字段、必填、唯一节点、命名、布尔/引用、数组元素/动态字段嵌套、多个组合组、显式 type 不扩大、分支格式、完整原文和窄屏。

playwright-cli 在真实 Project 第 05 个用例确认文本/对象候选、oneOf 标记、逐分支展开不泄露另一分支字段、局部必填、嵌套数组联合、键盘焦点、原文、390px 窄屏和卸载；原型原有树表回归正常，无 pageerror。截图 `assets/model-union-branches.png` 已实际查看，独立浏览器已关闭，未修改用户配置或模型。用户用例中旧的“查看原文”描述是模型原文，未擅自改写。

按 memsphere 仓库规范同步需求契约、实施方案、System Memory 源和开发副本；检查 Skill 通用树表说明，无具体联合规则冗余，无需改动。Project validate、最终 Memory ChangeSet validate 通过，源与副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed，digest `f1f6dfbe7c0809e99a17d88b0f160295c93edd97211919cd11b505e723bae844`，View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。最终 `npm test`（含构建）838 项：837 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过；diff check 通过，原生 Windows/macOS 未实跑。冻结 Submission、正式评审票及 Git 提交状态未改变。

## 最新修订：允许规则、枚举与组合标记

Human 要求 true / false 不再作为类型、枚举值移到格式列、分支统一编号，并将 anyOf / oneOf 标记前置及本地化。本次只修改共享展示、正式/原型样式与测试，没有修改模型文件、设置、数据层 API、Runtime 或校验语义。

- 布尔子模式的类型显示 `—`，说明分别为“允许任意值 / 不允许任何值”；真实 `type: boolean` 仍为布尔类型。模型定义根的支持范围不变：现有元模型只接受对象定义，直接以 true / false 为完整定义仍被拒绝，不因 UI 调整扩展 Runtime。
- enum 按显式类型显示文本枚举、数字枚举、整数枚举等；未声明 type 时仅称枚举。格式列自动从 enum 展示候选值，不依赖 description。有 format 时与候选值分行保留，说明保留作者原文，不进行数据转换；包含 HTML 字符的枚举值作为纯文本显示。
- anyOf / oneOf 的类型摘要前分别显示“任一匹配 / 唯一匹配”，英文为“Any match / Exactly one match”，仍区分至少一个与恰好一个的语义。展开后的分支统一为 `[类型1]`、`[类型2]`（`[Type 1]`、`[Type 2]`），title 作为补充名称；多组组合分别标识，局部字段与必填不合并。原始 JSON 中关键字不改写。
- if / then / else 不新增可视化解析，继续保留完整原文；已有原文提示不宣称解释了条件。用户模型 description 中的原始关键字和旧“查看原文”说明未擅自改写。

playwright-cli 已在真实 Project 第 05 个用例检查前置中文标记、编号、独立分支与局部必填、允许规则、无 description 的枚举候选、嵌套联合及原文；第 01、07、08 个用例核对字段和根枚举。键盘焦点、390px 窄屏、卸载与原型回归通过，无 pageerror，未修改用户数据。截图 `assets/model-display-rules.png` 已实际查看，独立验证浏览器已关闭。

同步需求契约、实施方案、System Memory 源与开发副本；Skill 只描述通用树表，无此处具体规则冗余，无需修改。`npm run typecheck`、`npm run build` 通过；受影响测试 54/54 通过，中英文前置顺序、分支编号、无描述枚举、format 与枚举共存、纯文本转义、窄屏及布尔子模式均有覆盖。新增测试起初误把布尔根当作既有支持能力，修正为明确验证拒绝边界，并按实际错误面板和文案校验，未修改 Runtime；最终重新执行全量 `npm test`（含构建）840 项：839 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过。原生 Windows/macOS 未实跑。

Project validate、Memory ChangeSet validate 与 diff check 通过，Memory 源与开发副本一致。ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed，digest `064343c089deca509bc0af332a0050f33d4c71d452bc27e0a3539a8421146127`，View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。冻结 Submission、正式评审票及 Git 提交状态保持不变。

## 最新修订：独立规则列与作者说明

Human 确认把“必填”列扩展为“规则”，省略可选标注；true 显示“无限制”，字段的 false 显示“不允许存在”。true 子模式不限制任何 JSON 值的类型或内容，字段是否必填仍由所属对象 required 决定。本次保持五列，不新增列或校验行为。

- 规则列独立展示必填、布尔子模式及现有生成的固定值、范围、组合、引用和原文提示，无规则时为 `—`。说明列只保留作者 description，没有时为 `—`，不再混入系统生成的限制；格式列的枚举候选和 format 不变。
- 结构节点不继承父字段的必填。必填与禁止存在同时出现时如实保留两项，不隐藏矛盾；非字段的 false 分支/元素仍显示“不允许任何值”，避免把失败分支解释成禁止整个字段。`type: boolean` 是正常布尔数据类型，不等于布尔 Schema。
- 正式页面与原型同步。规则和格式列留出 8em 基本内容宽度，允许规则内容按需换行，窄屏由表格内部滚动，不把短文案压成竖排碎行。中英文文案同步为 Rules、Required、Unrestricted、Must not be present 等，用户内容不翻译。

实际 playwright-cli 在真实 Project 第 05 个用例验证规则列、可选省略、作者说明原样、枚举回归、独立分支和局部必填、键盘焦点、原文、390px 窄屏、卸载与原型回归；没有修改模型或配置。截图 `assets/model-rules-column.png` 记录本次候选。新增浏览器回归覆盖有独立 description 的限制、true/false、必填加无限制、必填加禁止、真实 boolean 类型、纯文本转义和原文不变；已有规则断言按新列语义迁移，而非删除。

已同步需求契约、实施方案、System Memory 源与开发副本；检查 Skill 的通用树表说明，没有此处具体列语义冗余，无需改动。最终 typecheck、build、受影响测试 55/55、Project validate、Memory ChangeSet validate、diff check 均通过；全量 `npm test`（含构建）841 项：840 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过，原生 Windows/macOS 未实跑。第一次受影响测试因动态字段父行的规则组合断言仍只期待必填而失败，修正为验证完整规则后重新执行通过；截图发现列宽过窄，补上 8em 最小宽度及回归，再重建并实际验证。最新截图已实际查看，验证浏览器已关闭，未修改用户数据。

ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed，digest `a7e7c4cd39143001da639dce34b8aaa1026c4b741638a880193f4ead58646943`，View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。冻结 Submission、正式评审票和 Git 提交状态不变。

## 最新修订：组合方式仅在规则列展示

Human 指出 anyOf / oneOf 已在规则列表达，无需在类型列重复。本次移除类型列的“任一匹配 / 唯一匹配”标记及正式/原型的未用样式，类型列仍保留“文本 | 整数”“类型1 | 类型2”等候选摘要；规则列继续区分至少满足一个与恰好满足一个分支，并支持中英文。分支编号、title、独立展开、局部必填和多组合分组均保留，不改模型文件、API、Runtime 或校验行为。

同步需求契约、实施方案、最新交付摘要及 System Memory 源与开发副本；Skill 只写通用树表说明，没有具体标记位置冗余，无需改动。已有中英文浏览器集成断言改为验证精确候选摘要、组合规则及重复标记不存在，仍保留展开和原文断言。最终 typecheck、build、受影响测试 55/55、全量 npm test（含构建）841 项（840 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过）、Project validate、Memory ChangeSet validate 和 diff check 通过，原生 Windows/macOS 未实跑。

playwright-cli 在真实 Project 第 05 个用例验证类型列仅候选、规则列组合区别、独立展开与局部必填、原文、键盘焦点、390px 窄屏、卸载及原型回归，无 pageerror；没有修改用户模型与配置。截图 `assets/model-union-rules-only.png` 已实际查看，独立浏览器已关闭，当前 View 已重启加载新展示。ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed，digest `e68154b0515b71e52933526e6d83e4a62e287db9885c3122836f2d1a70f798d7`，View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。冻结 Submission、正式票及 Git 状态不变。

## 最新修订：本地引用结果直接展示

Human 确认引用目标应直接呈现在现有树表。共享渲染器支持同一份定义内的本地引用、连续引用、JSON Pointer 转义、URI 片段编码及根绝对 $id 标识的同文档引用：字段显示目标类型，展开后直接展示目标字段，不添加引用结果包装层；数组元素、动态字段和联合分支使用同一逻辑。格式与枚举来自目标定义，规则列保留引用链。引用字段的必填仍来自原父对象，目标内部字段按目标 required 展示。引用节点作者 title/description 优先作为显示注解，没有时使用目标注解；不合并 Draft-07 $ref 同层的校验关键字、不修改原文和 Runtime。

递归结构保留实际类型及引用来源，显示可继续展开；手动展开有限一层，全部展开永不越过递归边界。目标缺失、非法片段/目标、纯别名循环、跨模型引用和嵌套 $id 作用域明确提示无法解析，不伪造子字段，其他字段仍正常显示。不联网加载、不增加跨模型身份映射或修改数据层 API，跨模型自动解析另行讨论。

实际验证：

- typecheck、build、diff check 通过。受影响的树表、真实 View 浏览器、样式与 Reserved Store 测试 62/62 通过。新增 4 条树表测试、3 条浏览器测试，另强化既有联合与英文断言，覆盖引用链、转义、真假子模式、原文不变、局部必填、枚举/格式、失效隔离及有限递归。新增用例最初错误使用 button 定位 segmented radio，并错误假定原型能读任意真实项目模型；修正为真实控件与正式界面验证，原型继续用已有独立示例回归，不改其示例/数据来源。
- 全量 npm test（含构建）848 项：847 通过、0 失败、1 项既有 Windows-only 在 Linux 条件跳过。原生 Windows/macOS 未实跑。
- playwright-cli 在真实 Project 第 06 个用例检查 budget 引用字段与枚举、递归树手动下一层、重复全部展开有限、全部收起、键盘焦点、跨模型未解析提示、逐字原文、390px 窄屏、卸载和原型回归。最终操作无 pageerror 或 console error。构建期间旧 View 资源快照短暂失效，构建完成后重启并完整复验通过。截图 assets/model-local-references.png 已实际查看；没有修改用户模型或配置。
- 需求契约、实施方案、用例说明、最新交付摘要及 System Memory 源/开发副本同步。检查 Skill 的通用树表说明，没有具体引用解析的冗余，无需改动；没有新增或移动 Memory，manifest 不变。
- Project validate、Memory ChangeSet validate 通过，源/副本一致。变更校验第一次因沙盒不能写运行目录锁而失败，以同一命令在允许执行环境重试通过。ChangeSet change-20261001-065614910z-18de9f8c，validation passed，digest 7d2212250be29768a5c91a35ea56c36635c60fd34e7e9f53c25f2f58c48b9a24，View /projects/memsphere/changes/change-20261001-065614910z-18de9f8c。

本次是当前试用候选的展示修订，冻结 Submission、正式票、stage/commit/push 状态未改变。

## 删除自动说明提示

Human 要求删除表格上方“整体定义：if / then / else：详见原始定义”等自动说明。共享渲染器取消根层汇总段落及占位，删除未支持关键字、位置数组的自动阅读原文提示，以及动态字段的“值结构见下方”提示；空对象保留简短空状态。原型和正式模块同步清除废弃样式。作者的模型/字段 description、必填、范围、固定值、联合匹配规则、引用来源和无法解析诊断保留；原始 JSON 不变。

验证：typecheck、build、受影响测试 63/63、全量 npm test（含构建）849 项（848 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过）、Project validate 与 diff check 通过。新增浏览器回归覆盖提示不存在、作者描述与实际规则保留、联合展开及原文逐字不变；首次新增测试因为作者描述同时出现在列表和详情中而定位不唯一，修正为精确详情节点后，受影响套件及全量重跑通过。原生 Windows/macOS 未实跑。

playwright-cli 在真实 Project 第 05 个用例验证根提示和规则列原文提示不存在、组合/布尔/枚举规则及作者描述仍在、原始定义保留条件结构、键盘焦点、展开收起、390px 窄屏、卸载与原型回归；无 pageerror / console error。截图 `assets/model-no-generated-hints.png` 已实际查看，专用浏览器已关闭。View 已重启加载最终构建，没有修改用户模型或配置。

按 memsphere 规范同步需求契约、实施方案、最新交付摘要及 System Memory 源与开发副本；Skill 通用树表说明没有本次删除文案的冗余，无需修改。Memory ChangeSet `change-20261001-065614910z-18de9f8c`，active、validation passed，最终 digest `b23b1f1cacf71bc56ead5f9c246762c1758af09ffc3c09e0821ef3886be76c53`；View `/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`。第一次变更校验与全量构建并行时 dist/cli.js 暂未生成，构建完成后使用相同命令重试通过。冻结 Submission、正式票和 Git 提交状态不变。

## 模型 Slot 检查（实现前）

Human 要求模型模块与记忆/运行一样提供可替换展示 Slot。当前模型 Module 已注册公共 Shell 的导航、列表、头部与 main.view，但没有独立的 page presentation / definition renderer portable cells；SDK、全局可配置 cell 清单、Host 按模块选择展示候选的逻辑也尚未接入模型。建议按现有机制补模型页面展示和模型定义渲染两层，保留内置回退和业务 API/Route 所有权。此处只记录检查与建议，尚未修改公共接口，不宣称扩展已可用；接口方案待 Human 确认。

## 模型 Slot 补齐

Human 确认后，模型模块接入两个 portable cells：`org.memsphere.models.page.presentation@1:page` 和 `org.memsphere.models.definition.renderer@1:definition`。设置提供“模型模块 / 整体页面”和“模型模块 / 定义正文”，中英文标签同步；扩展选择、显式系统默认、失败回退、卸载及全局样式复用既有机制。

页面扩展通过 `presentation.modelsPage()` 获取冻结的模型列表、定义、刷新和导航服务；定义正文接收冻结的模型、structure/source 视图及 `defaultRender()`，可以包装内置树表或自行渲染。正文切换保留展开状态；模型列表独立加载，不依赖默认详情页 mount。模型数据、存储配置、Route/API 所有权及数据层接口不变。

验证结果：

- typecheck、build、受影响 10 套件 108/108、追加配置与文档回归 5/5、全量 npm test（含构建）858 项（857 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过）通过。新增七项真实浏览器测试覆盖正文/整体页面替换、冻结数据、项目隔离、独立列表、失败回退、显式默认及双语设置；SDK、配置和文档测试同步。原生 Windows/macOS 未实跑。
- playwright-cli 在当前 Project 验证 SDK 注册、默认树表/原文、键盘、窄屏和卸载。实际 Home 设置沿用令牌门禁，未读取凭据或修改用户配置；在隔离 on-disk Home 的真实 View 验证自定义正文、扩展全局样式、原文切换与树状态、双入口与所选贡献、键盘、窄屏、卸载，最终 pageerror/console error 为 0。截图 `assets/model-definition-slot-extension.png`、`assets/model-slots-settings.png` 已实际查看。临时浏览器和服务器已关闭，仅清理自有测试目录；当前 View 已重启加载最终构建。
- 修正新增卸载测试只等待 URL 的时序问题，改为等待实际卸载；文档断言区分 SDK 导出名称和版本化 cell。全量回归中的旧 20 项目录断言更新为 22 项，并保留全部选择、配置及回退检查；新增两个位置后原下拉位置不再处于底部，测试显式定位底部后仍验证向上展开。临时实测包误写样式 `path`，按既有 Manifest 改为 `file` 后完整复验通过，没有为临时脚本更改产品协议。
- 按 memsphere 规范同步需求契约、实施方案、六份双语扩展文档、System Memory 源及开发副本、Skill。Project validate、Memory ChangeSet validate、源/副本一致性和 diff check 通过。ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed，digest `c085756a7ddfb91552e7532ff98d695f7f074ecef61129b8c2e9dabe03a7d4ab`。

本次批准实施不等于正式交付票。冻结 Submission、Review 和 stage/commit/push 状态保持不变。

## 流程状态

2026-10-02，Human 第 1 轮正式要求修改后，完整候选 `delivery-report-round-2.md` 和 `delivery-revision-summary.md` 通过同一 Run/Review 重报进入第 2 轮 `round-20261001-162723z-692ecef0`。Human 随后明确“我投通过”，受托提交 approve（0 条 Comment）；产品 Agent 在新轮次独立检查并通过，Runner 正式接纳。新轮次不复用旧票，验收结果见 `acceptance.md`。需求已按交付规范记录完成时间并归档；Git commit 的精确 SHA 以 Run 后续步骤产物为准，是否创建 PR 等待 Human 决定。

用户入口：[模型](http://localhost:53583/projects/memsphere/models)。当前 View 已加载工作区构建，刷新即可看到新展示。
