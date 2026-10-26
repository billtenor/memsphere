---
name: memsphere
description: 发现并应用项目 Memory；按任务运行适用的 Procedure 或自由探索 Run；管理 Memory 变更及 Memsphere 资源。当用户要求使用 Memsphere，或当前项目有相关 Memory 时使用。
---

# Memsphere

使用当前 Workspace 的 Primary Project 和已安装的 `memsphere` CLI。Concept 解释含义，Statement 表达事实与规则，Procedure 组织可复用流程，Schema 定义结构。不熟悉的命令先查看 `memsphere <命令组> --help`；具体业务规则按任务读取适用 Memory。

## 发现并使用 Memory

- 已知名称或 `<kind>/<canonical-name>` 时直接 `memsphere memory read <reference>`；否则用 `memsphere memory list --kind <kind>` 及必要的 `--query` 发现候选，再读取正文。需要完整目录时沿 `nextCursor` 翻页；列表摘要不能代替正文。
- 按用户目标选 Memory。使用定义或约束前读取适用的 Concept、Statement、Schema；长文可用 `memory list <reference>` 和 `memory read <reference> --node <node_ref>` 定位，局部结果的 `context` 与 `fragment` 要一起理解。候选含义有歧义时询问用户。未绑定项目时先 `project list`，请用户确定目标，再 `project bind <name>` 或用全局 `--project`；Mounted Project 只读。
- 访问细则见 `memsphere-memory-access-rules`。App 或外部 CLI 任务先读取 `memsphere-app` 和 `memsphere-app-usage-rules`。模型、数据、View、升级等任务按需读取相关 Memory 与命令 Help。

## 选择执行入口

1. 当前任务已有 Run 时，先 `memsphere run status --run <id>`，继续同一个 Run；后续讨论、修订和 Review 不另起 Run。只要求发现或读取 Memory 时，直接用 `memory list/read` 回答。
2. 用 `memsphere memory list --kind procedures` 发现候选，并读取正文判断是否适合本任务。用户明确指定可用 Procedure 时执行它。历史通用任务流程不能仅凭“可处理任意任务”就自动成为兜底；同名流程若已被用户改为适用的专用流程，仍可选用。不要只按名称排除候选。
3. 有适用 Procedure 时，`memsphere run start <procedure-name> --name <task-name>`；已验证的本地流程文件可用 `--file <path>`。没有适用 Procedure 时，先按下段完成必要的目标与语义对齐，再用 `memsphere run start --name <task-name> --output json` 启动自由探索。

自由探索先确认目标、范围、期望交付与完成标准；用户已说清的直接沿用，只追问会影响执行的缺失项。随后对齐核心术语、领域对象和约束：先发现并读取适用 Concept、Statement、Schema，向用户说明采用的含义；无对应 Memory 时说明本次工作定义。会改变执行方向的歧义先解决，再做依赖该选择的工作。

## 自由探索 Run

启动回执给出 Run ID 与 `contextId`。跨 Shell 继续使用同一 ID；`memsphere continue <contextId> --help` 列出可继续生产的操作，原生 `memsphere run` 命令也可用。查询和读取使用原生命令，`run status --run <id>` 可恢复状态；Continue 当前只支持自由探索的生产操作。

**Artifact（产物）**是一份围绕明确目的组织、可独立阅读或使用，且值得供后续引用、评审、修订或交付保留的结果。可以是阶段性版本，但这一版应说明结果、依据和适用边界，而非标题或占位符。同一用途下紧密相关的内容可合并；需要分别引用、评审或演进时再拆分。文件数和对话次数不决定产物数。

当可用的一版将用于具体评审、后续任务输入、交接或交付时上报。上报前应能说清它的实际用途，以及为什么需要独立保留。普通进度、临时想法、确认、原始工具输出和小改动留在对话或工作文件中；不按消息数、时间间隔或保存次数机械上报。也不要因尚未最终定稿而漏报有明确用途的阶段结果。用户明确要求留存时遵从。已报结果只有在更新后的完整版本需要使用时才修订；单条反馈或小改动本身不要求重报。

- 引用的原始材料用 `run external add` 登记；由它形成的分析用 Artifact，并声明真实依赖。用 `run report --run <id> --name <name> --artifact-file <file> --content-type <mime>` 上报完整文本；`--artifact`、`--artifact-file` 与结构化 `--file` 互斥。`--depends-on artifact:<id>|external:<id>|tag:<name>` 和 `--tag` 可重复，标签依赖在提交时固定为具体对象。修订用 `--revised-from <old-id>` 提交完整新版本并取得新 ID；省略依赖会继承旧集合，显式依赖会替换它。
- 按需用 `run artifact show`、`run external show` 和 `run outputs list` 阅读。显示的短正文可能只是预览；用 `--out <file>` 导出完整原文。不为登记依赖而重复读取。自由探索的 `run review create/list/show` 是轻量反馈，不是 Procedure 的正式 Review 门禁。
- 结束前核对当前成果根。`run outputs update --add/--remove` 调整成果选择，不删除历史产物；`run finish --run <id>` 使用当前成果，也可用 `--artifact <id>` 显式选择。只有 Human 决定停止时才 `run abandon`。终态 Run 可用 `archive run` 收存、`archive list runs` 查找、`archive restore run` 恢复展示；恢复不会重新开放生产。
- `report` 报错若已给出保存的 Artifact 或 Step ID，先查状态和产物再重试，不能假定重报会去重。终态只读。具体参数以 `run/continue --help` 为准。

## Procedure Run

Procedure Run 遵循冻结的步骤与产物契约。读取选定流程及相关 Memory，启动后执行当前步骤、用 `run report` 上报所需 Artifact，并按每次回执的 `Then` 持续推进直到完成；子流程沿用同一个 Run。ChangeSet Run 的相关 Memory 用 `memory read/list --run <id>` 从冻结快照读取。Schema 填写、可选跳过和循环按 CLI 当前提示执行。

正式 Artifact Review 是流程门禁：上报后执行返回的 `run review wait`，阅读意见、按需修订，并在提示时作 Runner 投票。Agent 评审意见是建议；Human 步骤仍由对应 Human 完成。步骤之间自主推进；只有必需的 Human 输入、授权或真正阻塞的等待才暂停，恢复时继续原 Run。

## Memory 变更与资源边界

本轮只要创建、编辑、移动、重命名或删除任何 Memory，评审、提交或交付前都必须对最终内容执行 `memsphere memory change validate [change-id]`，记录 ChangeSet ID、通过状态和 View 入口；后续再改则重新校验。`memsphere validate` 只校验 Store，不能代替变更级校验。没有 Memory 差异不建空 ChangeSet。遵守适用的开发、测试和交付 Statement。

`project upgrade` 更新随包的 System Memory 与模型资源，`project repair` 只处理 System Memory，`skill upgrade` 更新本 Skill；升级前确认实际 Project 和 CLI 安装来源。Managed Memory 写入走受控 ChangeSet，Embedded 写入当前 Git worktree，Mounted Project 只读。App 安装、启停及外部工具绑定遵循 `memsphere-app-usage-rules`，不执行未知的绑定程序。其他操作查看 `memsphere model/data/view/project --help` 和适用 Memory。
