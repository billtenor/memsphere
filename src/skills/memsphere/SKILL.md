---
name: memsphere
description: 发现并应用项目 Memory，运行 Procedure 或自由探索，编辑与发布 Memory，管理 App、模型、数据与 View，升级 Memsphere CLI、Project 资源和 Skill。用户要求使用 Memsphere，或任务需要遵循项目 Memory 时使用。
---

# Memsphere

Memsphere 是运行在通用 Agent 之上的个性化软件运行环境，以 Memory、个性化 CLI、数据和界面组织可持续演化的软件资产。Memory 是理解业务语义和进入软件的入口：Concept 解释概念，Statement 表达事实与规则，Procedure 组织流程，Schema 定义内容结构。App 组合这些资产，Project 也可保留独立 Memory。需要产品定位时读取 `memsphere-framework` 和 `memsphere-personalized-software`。

## 使用命令

CLI 需要 Node.js 22+；原生 Windows 还需 Git for Windows，支持 PowerShell 5.1/7、CMD 和随附 Git Bash，WSL 作为独立 Linux 环境。

使用实际安装的 `memsphere`，操作前按需查看 `memsphere <命令组> --help`。Help 用于核对语法和参数；以下任务顺序、发布边界与完成条件仍需遵循。调用各类命令时，统一注意：

- 列表查询：结果有 `nextCursor` 时，沿同一筛选条件继续翻页；需要完整列表时，直到没有下一页才结束，不能把第一页当作全部。
- 文件输入：只有参数明确支持时，`-` 才表示从 stdin 读取，不能把这一约定套用到所有文件参数。

## 进入项目

### 确定 Project 与资源边界

未绑定时先 `memsphere project list`，由已有上下文或用户确定目标，再 `project bind <name>`；临时目标用全局 `--project <name>`。

创建 Managed Project 用 `project create <name> --bind`；在已有 Git 仓库内创建 Embedded Project 用 `project create <name> --embedded <memory-path> --bind`。已有目录的登记、克隆与只读挂载分别查 `project register/clone/mount --help`，不猜 Project 或扩大到全部项目。

Managed Memory 通过受控 ChangeSet 修改。Embedded CLI 使用当前 Git worktree 的 Memory Root，View 读取主 worktree；当前分支缺 Memory Root 时不回退到主 worktree。Mounted Project 只读。

### 发现并读取 Memory

已知名称时用 `memsphere memory read <reference>`；否则 `memsphere memory list --kind <concepts|statements|procedures|schemas> --query <text>` 发现候选，再读取正文。列表摘要不能代替正文。

显式逻辑引用使用 `<kind>/<canonical-name>`，canonical name 是小写 ASCII kebab-case；别名可作为不带 kind 的 selector，文件路径不是逻辑引用。

长 Statement、Schema、Procedure 可先 `memory list <reference>` 获取子节点，再把 CLI 返回的 `node_ref` 原样传给 `memory list/read <reference> --node <node_ref>`。局部读取的 `context` 与 `fragment` 一起应用，不猜节点引用；Concept 完整读取。

规则引用需要展开时用 `memory read <reference> --effective`。访问细则读取 `memsphere-memory-access-rules`。

## 执行任务

### 选择执行入口

1. 当前任务已有 Run 时，先 `memsphere run status --run <id>`，继续同一个 Run；讨论、修订、Review 与子流程调用不另起 Run。只要求发现或读取 Memory 时，直接用 `memory list/read` 回答。
2. 用 `memsphere memory list --kind procedures` 发现候选并读取正文，判断任务适用性。用户明确指定可用 Procedure 时执行它。历史通用流程不能仅凭“可处理任意任务”自动兜底；同名流程若已被用户改为适用的专用流程，仍可选用，不只按名称排除。
3. 有适用 Procedure 时，`memsphere run start <procedure-name> --name <task-name>`；已验证的本地流程文件可用 `--file <path>`。没有适用 Procedure 时，完成必要的目标与语义对齐，再 `memsphere run start --name <task-name> --output json` 启动自由探索。

自由探索先确认目标、范围、期望交付与完成标准，用户已明确的信息直接沿用；只追问影响执行的缺失项。随后对齐核心术语、领域对象与约束：发现并读取适用 Concept、Statement、Schema，说明采用的含义；无对应 Memory 时说明本次工作定义。会改变执行方向的歧义先解决，再做依赖该选择的工作。

### 自由探索：保留和交付成果

启动回执给出 Run ID；开启 Runner 身份并识别到当前 Agent 会话时自动绑定，`memsphere continue --help` 列出可用操作。Continue 无独立 ID，跨 CLI 进程按 Agent 类型与 session ID 定位；身份未开启、会话缺失或冲突时拒绝 Continue，使用原生 run 命令。可用 `run enter --run R` 或 graph 的 `run step enter --run R --step S` 显式切换上下文。

**Artifact（产物）**是一份围绕明确目的组织、可独立阅读或使用，且值得供后续引用、评审、修订或交付保留的结果。它可以是阶段版本，但这一版应表达结果、依据与适用边界，不能只有标题或占位符。同一用途下紧密相关的内容合并，需要分别引用、评审或演进时再拆分；文件数、消息数和保存次数不决定产物数。

当可用的一版将用于具体评审、后续任务输入、交接或交付时上报，应能说清实际用途及独立保留的必要性。普通进度、临时想法、确认、原始工具输出和小改动留在对话或工作文件中；有明确用途的阶段结果也不必等最终定稿。用户明确要求留存时遵从。已报结果只有在更新后的完整版本需要使用时才修订；单条反馈或小改本身不要求重报。实现结果应固定具体 commit、diff 或文件版本，并说明验证情况。

```bash
memsphere run report --run <id> --name <name> --artifact-file <file> --content-type text/markdown
memsphere run artifact show --run <id> --artifact <artifact-id> --out <file>
memsphere run outputs list --run <id>
```

- 原始外部材料用 `run external add` 登记；由它形成的分析用 Artifact，声明真实依赖。`--depends-on artifact:<id>|external:<id>|tag:<name>` 与 `--tag` 可重复，标签依赖提交时固定为具体对象。正文可能只是短预览，完整阅读用 artifact/external show 的 `--out`，不为登记依赖重复读取材料。导出的是原始正文，不能把命令回执当成材料内容。
- `--artifact`、`--artifact-file` 与结构化 `--file` 互斥。结构化 JSON 只接收 name、content/contentRef、dependencies、tags、revisedFrom、revisedSummary。

  content 为 `{model:{definedBy,definition},payload:{contentType,content}}`，definition 是 JSON 字符串；普通文本模型可用 `{definedBy:"raw.json",definition:"{}"}`。contentRef 用 `{storeId,dataId,sha256}` 固定引用，dependencies 是 `{kind:"artifact"|"external",id}` 数组，tags 是字符串数组。不填写系统身份，不把 Procedure 的 write-options/revision-summary 用于自由探索。
- 修订用 `--revised-from <old-id>` 提交完整版本并取得新 ID；省略依赖继承旧集合，显式依赖替换它，结构化空数组可清空依赖。
- `run review create/list/show` 记录轻量反馈，不构成正式 Procedure Review 门禁。反馈本身不自动成为新版本。
- 产出或上报 Artifact 不代表自由探索 Run 完成。向用户交付当前成果并说明 Run 保持开放，等待用户检查；用户未明确确认结束前，不执行 finish。Agent 自认为目标已达成、测试通过、用户沉默或对局部结果表示认可，都不能代替对当前成果和结束 Run 的明确确认。
- 用户提出反馈时，继续同一个 Run，按需记录轻量 Review、补充探索或以 revisedFrom 提交完整修订版，再交用户检查。等待人工确认可以结束当前回复，但 Run 保持 running，不能自动 finish 或 abandon。
- 结束前核对成果集合；`run outputs update --add <id> --remove <id>` 调整当前成果根，不删除历史。只有用户明确确认当前成果并同意结束，才执行 `run finish --run <id> --authorization <用户确认依据>`；默认采用当前成果，可用 `--artifact <id>` 显式选择。确认必须针对最终待交付版本，确认后又修订的成果需重新确认；用户已明确说“确认结束”等且目标无歧义时直接执行，不重复追问。Human 也可在 View 中检查成果后点击“结束运行”并确认。

已保存 Artifact/Step 后报错，先查状态和产物再重试，不假设重报会去重。

### Procedure：按步骤执行

启动前读取选定 Procedure 及适用 Memory。名称与 `--file` 二选一，均需 `--name`。试运行已验证 active ChangeSet 的 Procedure 用 `run start <procedure> --change <id> --name <name>`，不能与 `--file` 混用；其 Concept、Statement、Schema、Procedure 都用 `memory list/read --run <run-id>` 从冻结候选读取。后续候选变更不影响已启动 Run。

Procedure 有 Review Slot 时，首次启动会预检所有 scope、Slot、Actor 和 Policy。保存并调整返回的配置，再以同名和 `--review-config <file>` 启动；每个 Slot 绑定 Actor 或显式 skip，每个 scope 选择 Policy。全部 skip 时可无 Control Plane，否则需 Project 的 `control_plane`。Slot 是流程内评审视角，Actor 是参与者，Runner 是当前执行者；权限来自冻结配置，不能在 Review 配置中临时增加。

执行当前 `Do`、规则和 Artifact 契约，按每次回执的 `Then` 持续推进，不提前执行未返回步骤。`Ask human to do` 必须等待相应 Human 完成，再把其结果作为当前产物上报。

只有需要 Human 完成步骤、提供必要信息/授权或处理无法自行恢复的事项时，才可以结束当前回复并暂停。可自行修复的错误、字段边界和 Runner 自己待投票均不是暂停理由。Agent Review 尚未返回时应持续等待，结果返回后继续流程；等待本身就是当前有效动作，不要求持续产出工作。暂停时说明 Run ID、停止位置、等待对象和恢复方式，恢复同一 Run，不跳过门禁或自动废弃。

flow 普通步骤用 `run report --run <id> --artifact <text>` 或 `--artifact-file <path>`。Artifact 声明了业务 `store`/`model` 时，按“在 Procedure 中写入业务数据”处理绑定与写入。

执行权限被拒绝时，按宿主权限机制用同一命令申请所需访问，不改参数规避检查或直写 Run 存储。

#### graph：固定 Step 执行

新 Procedure 可声明 `syntax: memsphere-20261027-stable`、`mode: graph` 和 `actions`；省略 mode 仍为 flow。先按正常 Procedure 入口读取并启动，不向启动命令传结构化业务 input；由入口 Action 准备业务材料。

依赖满足时 Memsphere 立即创建 pending Step。只有一个可执行 Step 时自动 enter；多个时先读返回的概述列表，再执行 `memsphere run step enter --run R --step S`。enter 首次将该实例转为 running，重复 enter 复用同一实例、开始时间和 Continue 上下文；`run step show --run R --step S` 只读。

进入后只完成当前 Step。使用返回的 `memsphere continue report --artifact-file <file>` 上报，原生入口必须显式带 `--run R --step S`。会话状态固定 Project、Run、Step；不会随工作进度改绑到后继实例。评审时按提示执行 `continue review wait`，阅读全部正式意见后执行 `continue review vote --vote approve` 或附修改理由的 request_changes；Agent Reviewer 失败时遵守下文显式 retry 规则，可使用 `continue review retry --assignment <actor>`。意见处置使用 `continue review resolve --comment <id> --disposition <value> --note <text>`（accepted-fixed 另需验证摘要）；取得本人明确授权后可使用 `continue review submit-for-human --assignment <actor> --vote <value> --comments-file <file> --authorization-note <text>`。这些入口自动固定当前 Run/Step/轮次，不允许传参改绑，沿用原生命令全部权限与受托审计。

要求修改后在同一 Step 提交新 Artifact，必须附 `--revision-summary` 或 `--revision-summary-file`；保留旧候选与轮次。完成该 Step 后才返回新的可执行 Step 列表。跨 Step 并发由宿主 Agent 框架组织，不要求 Memsphere 调度 Agent。Human Action 必须先等待 Human 实际完成，Runner 再向同一 Step 提交，不能把 Human Review 的投票当成生产结果。

collect Action 由命令自动完成，Agent 不执行 enter/report；结果是按 Step 创建序固定的具体 Artifact 引用数组，空数组保留，无额外聚合 Artifact 或 Review。普通依赖只传本次正式采用的产物；when 使用 JSONata 且严格返回 boolean，不提供全局业务 State。原始 MIME 解码、现有模型校验或求值失败应按错误修复，不能当作 false 跳过。

`run status --run R` 可恢复未完成写入并推进；`run show`、`step show`、列表和 View 详情只读。使用 `memory list/read --run R` 阅读固定 Memory 快照。全部 Step 完成且没有未齐 Join 后通过 `run finish --run R` 结束；归档恢复只改变历史可见性。已有上下文模型须按提示显式 `project models initialize` 升级，旧 flow 不迁移。graph 与自由探索共用模型 Store，但自由探索仍在 report 完整成果时才创建 Step。


#### flow：填写 Schema 并完成收尾

按提示 `run enter-schema` 进入填写，`run schema show --run <id>` 查看结构和进度；逐项 report。遇到 repeat 用 `run repeat <count> --run <id>` 提交满足约束的总次数；只有当前可选字段可 `run skip --run <id>`。中间字段产物不等于父 Artifact 已接纳。

全部字段完成后仍需 Schema Finalization：

```bash
memsphere run artifact export --run <id> --step '<CLI 返回的步骤引用>' --file <local-copy>
memsphere run report --run <id> --artifact-file <local-copy>
```

检查并编辑完整本地副本后再 report；失败留在调整状态，成功后由冻结契约决定接纳或 Review。export 目标在托管 Run 存储之外，默认不覆盖本地文件；不直接修改托管草稿。

#### 推进正式 Review

- report 返回正式 `review_id` 后执行 `run review wait --review <id>`。评审未决不执行后续 Action。Agent Reviewer 通过 ACP 自动派发，必须用受限 `memsphere-review` 会话命令提交意见和 Vote；普通文本回复不是正式投票。
- `review wait` 先判断当前结果是否可返回；可返回时直接输出完整结果，否则按当前 Runner 配置选择异步或同步，不使用 `--sync`。异步开启后，只复用 queued/running 活动任务；历史终态记录保留，新的必要等待创建新任务。登记成功后可以结束当前回合直到 queue 通知唤醒。通知格式固定为 `[Memsphere 自动消息]`、`请执行命令以继续：`、显式定位 Project/Review 的 wait 命令三行，不携带结果，也不是 Human 指令、授权或投票；执行该命令读取当前正式结果并继续同一个 Run，旧通知不得覆盖当前会话绑定。任务状态用原生 `run review wait status --review R` 查询，failed 可用 `retry --review R --round ROUND` 显式重试发送，可能重复投递；通知发送失败不再自动发送第二条。身份模式 wait/status 不进入后继 Step，按工具响应的原生 enter 命令继续。同步 `review wait` 会阻塞等待结果；宿主返回运行中句柄时，使用宿主等待工具继续等待同一调用，不重复启动 wait 或额外轮询状态。等待期间不得为填充时间自行增加自查、测试、文档、重构、重复读取材料或预先修订已提交产物。收到正式结果、明确失败或用户新指令后再采取相应行动；当前轮次要求的 Human 投票仍按下文收集。
- Agent Assignment 首次失败时，Runner 用 `run review retry --review <id> --assignment <id>` 重试一次并继续 wait；再次失败时报告 Provider/Attempt/错误，取得 Human 对继续重试的授权后再执行。调试启动可按需使用 `debug.agent_review` 与 `run try-run`，后者只生成启动材料，不执行 Reviewer 或认领 Assignment。
- 同步和异步 `review wait` 只等待 Agent：全部 Agent 提交或任一 Agent 失败即返回/通知；没有 Agent 时立即返回，Human 草稿和投票不影响等待。Agent 等待就绪不表示整体评审通过；Human 的最终验收门禁单独保留。
- Agent 意见收齐后，阅读、处置全部 Agent 意见，由 Runner 按提示显式 `run review vote --review <id> --round <id> --vote approve`，或 `--vote request_changes --comment <reason>`，无需等待 Human。整体状态可以仍为 pending。Runner 要求修改时直接进入修订，不要求 Human 先为旧候选补票；修正后用完整 Artifact 和 `--revision-summary-file <file>` 原子重报。建议票不能替代 Runner 决定，也不扩大 Human 授权或豁免适用规则；处置用 `run review resolve`。
- Agent 处理完成且 Runner 确认候选后，再向相应 Human 收集“通过 / 要求修改 / 弃权”；通过意见可选，要求修改需意见，弃权需原因。Human 自主提前提交的票仍按原候选保存，不提前结束 Agent 等待，不迁移到修订候选。普通讨论和问题不是正式投票。明确的执行性投票在目标、所需意见均清楚且 CLI 已给出当前 Review/Round 代提交语境时，就是代提交授权，不再问同义确认。
- 代提交前核对当前 Run/Round/Assignment 与 Human Draft 无冲突；意见写为严格 JSON array（无意见用 `[]`），使用返回的 `run review submit-for-human`，提供 `--comments-file` 与 `--authorization-note-file`。不覆盖 Human 草稿或已有票；成功后继续 wait，并在需要时另投 Runner 票。具体参数查该命令 Help。
- 后续轮次需换参与者时，先 `run binding show --run <id>`，再 `run binding update --run <id> --slot <procedure::slot> --actor <id>` 或 `--skip`。只选 Run 已冻结 Actor；不改当前/历史轮次。正式 Artifact 意见绑定当时 Submission；Memory 修改意见另走 ChangeSet。

### 废弃与归档

只有 Human 明确决定停止时才 `run abandon --run <id> --reason <text>`（多行用 `--reason-file`）。终态只读，不能恢复执行；done/abandoned 可 `archive run <id>`，用 `archive list runs` 查找、`archive restore run <id>` 恢复展示，归档与废弃分别决定。缺 Memory manifest 导致无法读取或归档时，按“修复历史 Run 的 Memory 清单”处理。

## 修改 Memory

### 编写内容

编写前读取 `memsphere-memory`、对应 `memsphere-concept/statement/procedure/schema` 与 `memsphere-yaml-syntax-rules`。Concept 编写或评审还需读取 `memsphere-concept-writing-rules`，以消除理解歧义为内容取舍标准。Procedure 编写或评审还需完整读取 `memsphere-procedure-writing-rules`，明确字段职责、规则作用域与语义去重。

```yaml
!concept
syntax: memsphere-20261027-stable
names: [example-concept, 示例概念]
defines:
  - 说明概念的含义与边界。
```

- 顶层和嵌套区块使用对应 YAML tag；syntax 声明不可变版本，省略按历史 start 解释。canonical name 为 1–120 字符小写 ASCII kebab-case，别名不用作显式跨 Memory 引用。defines 只写非空文字；`!ref`、`!call` 等按对应类型使用 canonical 逻辑引用，Statement 的 asserts/suggests 引用不改变强制程度。
- flow Procedure Artifact 使用 `type → format → schema`：type 缺省 string，format 缺省 plain；object/array/boolean/number 须显式 type。Schema 类型不从父级继承，有 fields 可推断 object，否则 string；format 可继承，markdown layout 仅在兼容的 object outline / array table 节点保留。数组用 item 或带 tag 的 items 联合，不能直接 fields；具名字段可 optional。outline 的 !repeat 按语法规则使用，不嵌套。自然语言 asserts/suggests 不会被 validator 猜测执行。

### 编辑、校验与发布

创建或编辑 Memory 先读取对应 Concept、Schema 和写作规则，再 `memsphere memory edit <reference>`：已有内容可用名称或 canonical 引用；创建新 Memory 必须用尚不存在的 `<kind>/<canonical-name>`，命令会生成对应类型模板。Managed 返回 ChangeSet candidate 路径，Embedded 返回当前 worktree 路径，按回执编辑；Managed 不直改已发布 Store。

Managed 删除/改名使用 `memory delete <references...>`、`memory rename <reference> <new-canonical-name>`，需要时用 `--change <id>` 追加同一候选；改 canonical 不自动移动物理文件。当前这两个命令不支持 Embedded：在其有效 worktree 中审阅并删除文件或修改 YAML 的 names，必要的文件移动走正常 Git 操作，然后统一变更级校验与集成。Mounted 不可写。

本轮只要创建、编辑、移动、重命名或删除任何 Memory，评审、提交或交付前都必须对最终内容执行 `memsphere memory change validate [change-id]`，记录 ChangeSet ID、校验状态和 View 入口；后续再改则重新校验。`memsphere validate` 只校验 Store，不能代替变更级校验。没有 Memory 差异不建空 ChangeSet，稀疏 candidate/checkpoint 不是完整 Memory Root，不能拿它调用 `validate --memory-root`。

Managed 通过校验后 `memory publish --change <id>` 发布并完成 ChangeSet；远端推送和上游同步按需用 `memory push`、`memory sync` 及对应 publish，冲突按回执处理，不强推。Embedded 普通变更走所在仓库的 commit/PR/集成流程；commit、push、PR 不等于 completed，进入 master 后才完成。专用系统升级按“升级与维护”执行。

### 处理 ChangeSet 修改意见

Human 可在 View 的 ChangeSet 中添加 Memory 与 Comment；这些是修改意见，不是 Artifact Review 的 Round/Vote。接手其 ID 时先读 `memsphere-changeset-comment-processing`，在当前 Workspace `memory change claim <id>`。已有 claim 时不抢占，只有 Human 明确要求接手才用 `--force`。逐条判断，合理则改候选并 `memory change validate <id>`；不合理则保留原内容并说明理由。

`memory change finish <id> --comment <全部 processing Comment ID...> --reason fixed` 要求当前候选校验通过，并一次完成全部 processing 意见、释放 claim；全部拒绝时使用 rejected，不伪造内容变更。当前 CLI 对整个批次只接受一个 reason，不能分批逐条 finish；若同时有 fixed/rejected 两类结论，保留现场、说明该限制并请 Human 决定，不伪造统一结论或手改状态。无实际差异且意见均完成时可 `memory change complete <id>`；存在实际修改时按 Store 类型发布或集成，不能把 finish 当作发布完成。

### 从记忆市场导入

View 的记忆市场提供精选 Memory 的显式导入；未导入内容不在 Project Catalog 或 Run 内。Memory 导入先形成 `market_import` ChangeSet，检查候选、校验后发布。Embedded 的 market_import/app_install 可用 `memory publish --change <id>` 把候选应用到当前 worktree，之后仍需 Git 集成；该命令不 commit 或 push。导入后的 Memory 可自由修改、重命名并独立演进，不会随系统升级自动覆盖；重新导入须检查差异。

## 安装和使用 App 与外部 CLI

先读 `memsphere-app` 与 `memsphere-app-usage-rules`。可信本地发行目录含 app.json 及声明资产，使用 `memsphere --project <name> app install <directory> [--config <file>]` → `app check <id>` → `app enable <id>`；`app show <id>` 提供 Agent 命令与 Human 界面入口。View 组合变化后按提示重启。

App 自带工具描述自动登记，独立工具用 `cli register <descriptor-file>`；程序按作者说明独立安装，再 `cli bind <id> --binding <file> [--app <id>]` 配置本机入口、固定参数和工作目录。用 `cli list/show` 读取结构化调用信息后直接执行工具；`cli check` 仅执行声明探测，不猜协议。envFrom 引用环境变量名，凭据不写清单。

App disable 保留 Memory 阅读、数据与历史，但拒绝新流程涉及停用 App。Managed 安装走 ChangeSet，Embedded 应用当前 worktree，不自动 Git 提交；未完成安装的 Memory 被隐藏，按原发行目录重试。Mounted 来源只读；当前没有 App 升级、卸载或已有 Memory 自动认领。

## 管理模型与业务数据

模型定义是原始 JSON，登记另存名称、说明、包、标签与定义位置；模型和元模型 ID 使用 `.json` 后缀，例如 `sales/order.json`。系统模型定义及登记只读，普通 CRUD 不覆盖它们。

模型、数据及登记的相对路径以 Registry 中的 Project 根为基准，Embedded worktree 不隔离这些共享资源。业务数据 Store 与模型、登记、Memory、Run 存储分开。

下面示例使用 `--output json` 获取机器可读回执。

```bash
memsphere model list --output json
memsphere model read sales/order.json --part all --output json
memsphere model create sales/order.json --definition-file order.json --name 订单
memsphere model validate sales/order.json --definition-file candidate.json --check runtime
memsphere data store create orders --model sales/order.json --kind value --factory memsphere/filesystem-json --config-file store.json
memsphere data create order-001 --store orders --value-file order-value.json
memsphere data read order-001 --store orders --output json
```

- model update 修改定义或登记，`--unset` 移除允许的登记字段；delete 可先 dry-run。创建/更新同时要求定义合法和 Runtime 支持，不把只读 definition 诊断当准入豁免。不支持跨模型引用，本模型内部引用可用；unavailable 模型先读诊断，不删规则让它勉强通过。
- `config.json.dataStores` 显式登记业务 Store 与模型；支持 `value + memsphere/filesystem-json` 和 `data + memsphere/filesystem`。配置文件例如 `{"directory":"data/orders"}`，相对 Project 根解析；目录不得与管理资源、其他业务 Store 或 Embedded 各 worktree Memory 重叠，不复用保留 Store ID。
- ValueStore 的 update/delete 可用 `--expected-revision` 条件写；遇到冲突重新读取并判断，不盲目重试。`data edit --patch-file` 使用 JSON Patch，在副本校验后条件保存；`data read --path` 使用 JSONPath，结果为匹配数组。`data upsert` 整条写入，不支持条件 revision 或 patch。
- DataStore 保存原始 Payload，支持文件/MIME 校验和导出，不支持条件写、edit 或对二进制做 JSON 路径查询。`data export --out <file>` 的文件目标须不存在，`--out -` 只输出原始正文，不是 JSON 回执；`data store remove` 只解绑，不删除记录或 revision 历史。重新绑定非空目录需通过格式与模型兼容检查。
- 模型写入中断时按诊断重试原写命令以恢复一致状态；外部改动冲突保留新内容，不以 initialize 代替所有恢复。业务 Store 的 revision 与 Run 历史快照分别管理。

### 从模型市场导入

View 的模型市场提供精选模型的显式导入；未导入模型不在 Project Catalog 或 Run 内。导入必须整体满足当前 Runtime，不删规则或部分导入绕过拒绝。

### 在 Procedure 中写入业务数据

普通 Action 的 Artifact 可用 `store` 绑定业务 JSON ValueStore，`model` 可从 Store 推导且须一致，不能同时声明 schema。Run 冻结目标和模型指纹。格式、模型及 Review 通过后才整条 upsert 业务记录，写入成功后才推进，历史 Artifact 快照独立保留。

稳定业务 ID 用 `run report --write-options '{"data_id":"<id>"}'`，仅支持内联 JSON 对象；首个合法候选冻结 ID，后续重试和修订沿用。写入不做字段合并或 revision 条件检查；接受后状态保存失败按 CLI 指示重试同一步，不另建业务对象。

## 配置运行环境与 View

每个 Memsphere Home 运行统一 daemon，用 `daemon start/status/stop/restart` 管理。View 用 `view start/status/restart/stop` 管理，启停意图持久化，daemon 重启恢复；停止 View 不影响异步任务。首次启动 daemon 不开启 View；未安装 OS 自启动服务。Home 配置中的 Runner Agent 可探测 Codex/Traex，分别开启身份和异步执行，缺省关闭。Project 选择器切换展示目标。

Home config.json 的 language 支持 zh-CN/en，缺省 zh-CN，同时影响 Agent 工作语言和固定 UI 文案；Run 冻结启动时工作语言，配置保存后的新页面使用新 UI 语言。

配置中心分 Home 与当前 Project：Home 维护语言、View 服务、ACP Provider、主题/界面组合；Project 维护 Store、Control Plane、Runner 和 Human/Agent Actor。按 scope 审阅 diff 后保存；host/port 或界面组合变化需重启 View，语言保存后下一次加载生效。Actor 权限使用 Catalog，Memsphere Permission 不等于操作系统或网络授权。

Agent Actor 指向 Home ACP Provider 实例和可选 model，Provider 当前支持 traex/qwen/kimi/codex；安装、认证和账户由 Provider 自己负责。Human Actor 不配置 system_prompt。Provider 的非托管参数、非敏感环境变量及 timeout 在 Home 配置，工作目录与托管安全参数由运行时管理。

### 安装和开发界面扩展

安装可信 View Package 时，在“设置 → 界面与主题”登记绝对路径、选择 Theme/Slot，保存后 `view restart` 应用；配置是 Home 全局的。

开发扩展先读 `memsphere-view` 并查仓库 View SDK/Reference Module：独立 Module 管领域内容，Shell/Theme/UI/Slot 管公共层；使用公开 theme/ui 服务需声明对应 version，样式使用公开 `--mem-view-*` Token，不依赖 Host 私有 DOM/CSS。可复用 `ctx.ui.contentList()`、`ctx.ui.modelDefinition()` 与 portable renderer，不复制内部实现。

交付在真实 Shell 检查桌面/窄屏、键盘、状态、console 与卸载清理；具体 Slot 和样式约束查 Concept 与 SDK。

## 升级与维护

### 升级 CLI、Skill 和 Project

先确定升级范围、实际 CLI 路径/版本/安装来源、Skill 位置与目标 Project；沿用已知选择，只询问缺失项。单个项目请求不扩大到全部项目。整体升级顺序是 CLI 及随包资源 → 选定 Skill → 目标 Project → 按需要重启 View；逐类报告实际完成情况。

| 对象 | 操作与完成判断 |
|---|---|
| CLI 程序 | 先核对实际 `memsphere` 路径、链接目标与 `memsphere --version`。npm 全局安装用 `npm install -g memsphere@latest`；项目依赖按原包管理方式更新。源码链接在真实源码仓库按约定同步已发布分支，安装变化的依赖并 `npm run build`，保留用户改动，不强行 reset。完成后重新核对执行路径、版本与 Help，不能只更新不在 PATH 的副本。 |
| Agent Skill | `memsphere skill upgrade` 默认写当前目录的 `.agents/skills/memsphere/SKILL.md`；全局安装用 `--global`（用户 Home 的 `.agents/skills`），自定义位置用 `--directory <skills-root>`，两者互斥。按已识别的实际位置选参数；命令等价于同位置 `skill init --force`，首次安装仍用 init。检查目标文件及内容，不把项目资源升级当成 Skill 已更新。 |
| Project 运行资源 | `memsphere project upgrade [name] --output json` 更新当前 CLI 随包的 System Memory 与系统模型/登记。目标优先显式 name、全局 --project、当前 Primary；保留用户 Memory、普通模型、数据与登记 UUID。检查各阶段、ChangeSet 和集成状态；repair/models initialize 的单项成功不能代替整体升级。 |

`project repair [name]` 只恢复/更新 System Memory，Managed 受控校验发布，Embedded 只写当前 worktree 的可审阅差异；不提交 Git。

`project models initialize` 用于系统模型安装与已支持的旧模型身份转换，不改写普通模型原文。系统废弃预置只在历史路径、canonical identity 与已知原版摘要均匹配时删除，自定义内容发生冲突应保留并按诊断处理。

Managed 系统升级使用专用 ChangeSet，校验后发布，无差异不创建空记录。Embedded 系统升级按以下路径完成：

1. 保留原工作区，在目标仓库从 `refs/heads/master` 建独立升级分支和 linked worktree；未绑定时用显式项目名。缺 master 时说明当前限制，不擅自创建或改名集成分支。模型与登记仍是 Project 共享状态。
2. 在升级 worktree 执行 `project upgrade <name> --output json`，检查各阶段、专用 ChangeSet ID、校验与 View 入口。失败须说明已完成部分，修正后在同 worktree 用 `project upgrade <name> --change <id>` 重试；仅重新校验可用 `memory change validate <id>`。不通过 claim、添加无关范围或手动 complete 操作专用升级记录。
3. 审阅差异与 index，按已有授权只提交本次升级目标，记录分支、worktree、ChangeSet 和 commit；无变化不空提交。按仓库流程提交 PR、合入 master，未授权的合入由 Human 决定；冲突解决后重新验证最终 Memory。
4. `integrationStatus=pending` 表示准备/校验及模型阶段成功，committed 表示已提交，integrated 才表示已集成。创建 PR 不代表主分支完成升级；专用 ChangeSet 在内容匹配且进入 master 后才 completed。

升级不自动迁移冻结 Run/Review。若模型或 Store 指纹变化使旧 Run 拒绝继续，说明恢复原目标或重新发起的选择。市场资源独立更新；最后根据实际版本和进程决定 `memsphere view restart` 是否必要。

### 迁移旧 Memory

旧格式先分别 `migrate syntax --check`、`migrate artifact-contract-v2 --check`、`migrate schema-contract-v2 --check` 诊断实际需要的迁移。真实 Store 写迁移需 Human 明确确认；`--write` 只用于 Embedded，Managed 通过候选和正常 publish。迁移不是每次升级必做步骤；旧 running Run 不跨契约版本续跑，历史终态与 Review snapshot 保持只读。

### 修复历史 Run 的 Memory 清单

旧 Run 因缺 Memory manifest 无法读取/归档时，按诊断先检查 `scripts/backfill-run-memory-manifest.mjs --run-file <json>`，明确需要修复的记录才加 `--write`，不批量改历史。已有 Worker 未确认退出或归档失败时，先处理诊断再重试。
