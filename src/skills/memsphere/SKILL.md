---
name: memsphere
description: Use memsphere to discover, read, interpret, and apply project Memory, or to route Memory creation, editing, review, and Procedure execution through installed workflows. Trigger when the user explicitly asks to use memsphere, refers to Memory, Concept, Statement, Schema, Procedure, or asks for work that should follow memories installed in the current project.
---

# Memsphere

memsphere 定义了一套维护记忆、检索记忆和遵循记忆的框架。通过 memsphere CLI，可以读取当前 Workspace 的 Primary 与 Mounted Project 中积累的知识和流程，并按照这些历史经验完成任务。

Memsphere Home 的 `config.json` 中，`language` 控制面向 Agent 的工作语言，支持 `zh-CN` 和 `en`，省略时固定为 `zh-CN`。Run 启动后会冻结该语言，因此修改配置只影响后续创建的 Run。

## Memsphere 如何组织记忆

memsphere 将 Memory 分为四类：

- Concept（概念）：解释一个概念或词汇是什么。
- Statement（陈述）：表达可被核查的事实、规则、约束和建议。
- Procedure（流程）：描述一个任务从开始到结束的执行流程。
- Schema（图式）：定义一种内容结构和呈现格式。

四类 Memory 可以相互配合。例如，一份 Procedure 负责安排步骤，步骤中涉及的概念由 Concept 解释，必须满足的规则由 Statement 表达，交付物结构由 Schema 定义。

## Memsphere 如何读取记忆

已知 Memory 的名称或逻辑引用时，直接读取：

```bash
memsphere memory read "<名称/逻辑引用>"
```

不知道 Memory 的名称或逻辑引用时，使用 list 命令查看当前工程中的 Memory：

```bash
memsphere memory list
```

使用 `--kind` 按类型筛选。可用类型为 `concepts`、`statements`、`procedures` 和 `schemas`：

```bash
memsphere memory list --kind procedures
```

list 结果中的 `names` 首项是 canonical name，其余项是别名，`defines` 是简要定义。显式逻辑引用固定使用 `<kind>/<canonical-name>`，其中 canonical name 是 1–120 字符的小写 ASCII kebab-case；别名只能作为不带 kind 的 selector。Memory 文件路径只是 Provider 存储细节，不能代替逻辑引用。list 只用于发现候选，不能替代 read；确定候选后，必须完整读取 Memory，或按 Node 读取完成任务所需的内容。

当一份 Statement、Schema 或 Procedure 较长时，可以先列出它的直接子 Node：

```bash
memsphere memory list "<名称/逻辑引用>"
```

结果中的 `node_ref` 是 CLI 生成的节点引用。不同 Node 会同时显示其主引用来源，例如 Action 的 `artifact`、If/While 的 `condition_artifact` 和 Call 的 `target`。需要继续查看下一层时，把 `node_ref` 原样传给 `--node`：

```bash
memsphere memory list "<名称/逻辑引用>" --node "<node_ref>"
```

确定目标 Node 后，只读取该 Node 及理解它所需的根级和祖先上下文：

```bash
memsphere memory read "<名称/逻辑引用>" --node "<node_ref>"
```

不要自行猜测或拼接 `node_ref`。Concept 直接完整读取，不提供内部 Node。局部读取结果中，`context` 与 `fragment` 必须一起理解和应用；它们不是一份可单独校验的完整 Memory。任务涉及多个 Node 或范围不明确时，继续读取相关 Node，必要时读取完整 Memory。

描述 memsphere 本身的概念、陈述、流程和图式，也使用 Memory 管理。不理解 memsphere 时，可以从以下 Memory 开始读取：

```bash
memsphere memory read memsphere-memory
memsphere memory read memsphere-concept
memsphere memory read memsphere-statement
memsphere memory read memsphere-procedure
memsphere memory read memsphere-schema
```

如果命令提示当前 Workspace 未绑定 Primary Project，告知用户使用 `memsphere project list` 查看 Project，并执行 `memsphere project bind <project-name>`；只需临时访问一个 Project 时使用全局 `--project <project-name>`，不得自行猜测目标。

如果现有 Managed 或 Embedded Project 缺少 System Memory，或需要恢复、升级当前 memsphere 版本内置的 System Memory，使用 `memsphere project repair [project-name]`。目标选择顺序是显式名称、全局 `--project`、当前 Primary Project。Managed repair 内部生成受控 ChangeSet、校验完整有效 Memory 并自动发布；无差异时不创建 ChangeSet 或 Revision，ChangeSet 创建后的失败保留为带 failure 诊断的只读 `abandoned` 记录并清理 Workspace candidate。Embedded repair 使用当前 Git worktree 的有效 Memory Root，拒绝覆盖计划目标上的未提交修改，先校验完整候选 Store，再只写入可由 Git 审阅的 System Memory 差异，不 commit、push 或使用 Managed publish；linked worktree 中不会修改主 worktree。manifest v3 声明的废弃 System Memory 默认清理，但必须同时匹配历史路径和 canonical identity；路径被用户 Memory 复用时 repair 会在写入前失败。Mounted Project 仍是只读来源，也没有 `reinitialize` 别名。

列表同时包含 Primary 与 Mounted Project 时，使用返回的 `project_name` 和 Revision 判断来源。跨 Project 出现同名 Memory 时必须使用 `--project` 明确选择；Mounted Project 在组合上下文中严格只读。

Embedded Project 的配置使用 Git 主 worktree 绝对 `repository_path` 和仓库相对 `memory_path`。View 固定读取主 worktree；普通 CLI 根据当前命令所在 worktree 重映射 Memory Root，并拒绝其他仓库。使用 `memsphere memory edit <reference>` 时，Managed Project 编辑 CLI 返回的 ChangeSet Candidate；Embedded Project 编辑 CLI 返回的当前 worktree YAML 路径。当前分支缺少 Memory Root 时不得回退读取主 worktree。

## Memsphere 如何校验尚未发布的 Memory

Managed Project 先用 `memsphere memory edit` 创建稀疏候选；Embedded Project 直接修改当前 Git worktree 中的 Memory。两者统一执行：

```bash
memsphere memory change validate [change-id]
```

Managed 省略 id 时当前 Workspace 必须恰有一个 active ChangeSet。Embedded 的标准路径直接运行无额外选择参数的命令，并按 Project、Git common repository 与 base revision 创建或复用逻辑 CLI ChangeSet；linked worktree 路径不参与身份判断。命令只保存一份稀疏、内容寻址的当前验证内容，再次 validate 原子替换它，不生成供选择或回滚的多份快照。ChangeSet 生命周期只有 active、completed、abandoned：普通 commit、push 或创建 PR 后仍为 active，候选提交合入 `master` 后才自动成为 completed；Managed publish 后直接成为 completed。输出的稳定 View 入口为 `/projects/<project>/changes/<change-id>`。普通 `memsphere validate` 只校验正式 Store，不创建 Embedded ChangeSet。

View 顶层只展示 Memory 与 Task。Memory 详情的“修改”经简单确认后总是创建一个新的持久、未绑定 ChangeSet；用户不能直接编辑 YAML，只能在 ChangeSet 中加入已有 Memory，并通过结构位置旁的 `+` 逐条提交 Comment。Comment 直接绑定 ChangeSet，状态为 pending、processing、completed，不存在独立 Memory Review、ChangeSet Review、Submit Review、Round 或 Vote。Human Actor 和稳定 Browser user UUID 只用于归因，不构成认证。ChangeSet 详情仅展示纳入范围的候选 Memory，不展示 diff 或完整 Store；active 可添加 Memory、提交 Comment 或确认废弃，completed、abandoned 只读。

Human 在 Agent 对话中提供 ChangeSet id 后，Agent 在当前 worktree 执行 `memsphere memory change claim <change-id>`。已有 claim 时默认停止；只有 human 明确要求接手才使用 `--force`。claim 把 pending Comment 置为 processing，并将中央候选准备到当前 worktree/Workspace；已有本地 Memory 修改只警告，最终由目标级 CAS 阻止静默覆盖。合理 Comment 修改后必须执行 `memsphere memory change validate <change-id>`，再用 `memsphere memory change finish <change-id> --comment <id> --reason fixed` 完成；不合理 Comment 保持内容不变并用 `--reason rejected`，判断说明只在对话中反馈。finish 释放 claim。没有实际差异且所有 Comment 已完成时使用 `memsphere memory change complete <change-id>`。Embedded View ChangeSet 显式绑定新 HEAD 时，仅在 scoped target digest 未变化时允许安全前移，否则报 edit conflict。

Managed 最终使用 `memsphere memory publish --change <change-id>` 发布并完成 ChangeSet；Embedded 仍使用普通 Git commit、push 与合入流程，只有候选内容进入 `master` 后 ChangeSet 才完成。ChangeSet candidate 与当前验证内容都不是完整 Memory Root，不得传给 `memsphere validate --memory-root`。

## Memsphere 记忆语法规则

memsphere 使用带 YAML tag 的 mapping 描述一份 Memory。根节点的 tag 表示 Memory 类型：

```yaml
!concept
syntax: memsphere-20260721-stable
names:
  - example-concept
  - 示例概念
defines:
  - 对这个概念的定义。
```

- `!concept`、`!statement`、`!procedure`、`!schema` 分别表示四种 Memory。
- 顶层 Memory 使用 `syntax` 声明不可变的语法版本；当前稳定版本是 `memsphere-20260721-stable`。省略时固定按历史起点 `start` 解释，不得按最新版猜测。
- 顶层 `names` 的第一项是 canonical name，必须是 1–120 字符的小写 ASCII kebab-case；其余项是别名，可以使用 Unicode 和内部空格，但不得包含首尾空白、控制字符或 `/`。嵌套节点名称不受顶层命名规则限制。
- 显式 `<kind>/<name>`、`!ref target`、Procedure `!call target`、Concept `extends` 和 Artifact 的外部 `schema` 必须使用目标 canonical name，不接受 alias；普通 rename 不自动移动 File Provider 中的 Memory 文件。
- 原本允许 `names` 的节点也允许写单个 `name`，其解析结果等价于 `names: [name]`；二者不能同时出现。
- `defines` 用于定义这份 Memory；其中的全部成员共同生效。
- `defines` 可以包含 `!ref` 外部 Memory 引用；`target` 必须是 `concepts/<canonical-name>`、`statements/<canonical-name>` 或 `schemas/<canonical-name>` 形式的逻辑引用，不接受普通名称或 alias。
- 不同类型还拥有自己的字段。编写或解释某种 Memory 前，读取对应的 Concept Memory 了解完整语义和字段规则。

Procedure 中每个 `!action` 的 `!artifact` 使用 `type -> format -> schema` 三层机器契约：

```yaml
artifact: !artifact
  name: 发布记录
  type: object
  format:
    name: markdown
    layout: outline
  schema: !schema
    fields: [版本, 发布日期, 结果]
  final: true
```

- `type` 省略时默认为 `string`；`boolean`、`number`、`object`、`array` 必须显式声明。
- `format` 省略时默认为 `plain`；简单格式可写 `markdown`、`json` 或 `yaml`，格式参数使用带 `name` 的对象。
- `layout` 属于 markdown format：object 使用 outline，array 使用 table。
- Schema 的 `type` 不继承：显式声明优先，省略时有 `fields` 推断为 `object`、无 `fields` 推断为 `string`。Schema 的 `format` 省略时继承父 Schema 或根 Artifact；Markdown `layout` 只由兼容的 object outline 或 array table 节点保留，标量字段不继承 layout。
- array Schema 使用 `item: !schema` 表示唯一元素契约，或使用至少两个 `!schema` 组成的 `items` 表示联合元素契约；每个元素必须满足至少一个候选。二者互斥且要求显式 `type: array`。
- `schema`、Schema `fields`、`item` 和 `items` 中可以使用 `!ref` 引用外部 Schema Memory；这些位置的 `target` 必须指向 `schemas/...`，运行和校验时会按目标 Schema 展开。
- `fields` 中的具名 `!schema` 字段可以声明 `optional: true`；缺失时自动校验放行，存在时仍完整校验。字符串简写字段和未声明 optional 的字段仍为必填。
- `!schema` 可以分别声明 `asserts` 与 `suggests`：前者表达必须满足的内容约束，后者表达不影响结构合法性的书写建议；Schema 写作 Prompt 会汇总根到当前字段的两类约束并分开展示。
- array Schema 不允许直接声明 `fields`。对象元素应在 `item` 或 `items` 的 `type: object` Schema 中声明 `fields`；省略 `item/items` 时只校验数组容器。
- 不要使用已删除的 `element_types`；旧版字符串 `items` 必须迁移为带 `!schema` tag 的 `item/items`。
- `asserts` 和 `suggests` 是自然语言契约，不会被代码 validator 猜测执行。

Artifact 可以使用 `review` 声明当前 Procedure 内的 Review Slot。Procedure 不引用 Project `config.json` 中的 Actor，也不选择 Decision Policy：

```yaml
!procedure
syntax: memsphere-20260721-stable
name: 受控交付流程
goals:
  - 交付受控产物。
flow:
  - !action
    action: 生成受控产物。
    artifact: !artifact
      name: 受控产物
      review: [产品, 资深架构]
```

- `review` 是不重复的非空 Slot 名称数组。Slot 只表达 Procedure 本地评审视角，不是 Actor id。
- 当前 Project `config.json` 的 `control_plane.actors` 定义可参与 Review 的 Human 或 Agent Actor；Runner 权限由 `control_plane.runner` 定义。
- Memsphere Home `config.json` 的 `acp_providers` 定义与内置类型同名的 ACP Provider 配置。首批固定支持 `traex`、`qwen`、`kimi`、`codex`；CLI command 和 ACP 入口由类型固定，配置维护非托管 args、非敏感 env 和启动/空闲/总运行超时。配置中心可自动检测可执行文件路径和版本，但 Provider 自己负责安装、认证和模型账户配置。
- Agent Actor 只配置 ACP Provider 实例 id `provider` 和可选 `model`；工作目录、托管安全参数与 Prompt version 由 Memsphere 管理。旧的 Actor 内 `command`、`args`、`env`、`cwd`、Prompt version 和 timeout 字段不兼容，也不会被自动迁移。
- 原生 Windows 要求 Windows Node.js 与 Git for Windows；用户和 Agent CLI 支持 Windows PowerShell 5.1、PowerShell 7、CMD、Git for Windows 随附的 Git Bash。WSL 按独立 Linux 环境处理，MSYS2/Cygwin 不在当前支持范围。Provider 的安装检测与 Windows 支持等级分别展示。
- `memsphere run start` 必须通过 `--name` 指定本次 Run 的非空名称，并会先列出所有 Review scope、Slot、可用 Actor 和内置 Decision Policy。把预检示例保存并调整后，使用相同的 `--name` 和 `--review-config <path>` 启动。
- Review 配置必须为每个 scope 选择 Policy，并为每个 Slot 绑定 Actor 或显式 `skip`；一个 Actor 绑定多个 Slot 时只产生一个 Assignment 和 Vote。
- Permission 只在 Runner/Actor 的 `permissions` 中配置；Run Review 配置不追加临时权限。Memory YAML 不允许 `role_bindings` 或 `permission_grants`。
- `runner` 是当前 Run 执行上下文，不需要 Slot Binding。
- Human 完成前序流程后若不再参与后续 Review，Runner 可以执行 `memsphere run binding show --run <run_id>` 查看 Run 冻结的 Actor、当前 Slot Binding、影响 scope 和历史，再执行 `memsphere run binding update --run <run_id> --slot <procedure::slot> --actor <actor_id>` 换绑；多个 Actor 重复传 `--actor`，未来不需要该 Slot 时使用 `--skip`。只能选择 Run 启动时已经冻结的 Actor；更新只影响尚未创建的 Review，已经创建的 Review、Round、Assignment 和后续修订轮次保持原 Binding。
- Runner 在 `run report` 前应阅读 CLI 输出的权限说明；成功或拒绝结果中的权限、来源和自然语言说明均来自 Run 启动时保存的控制平面快照。
- 确定性校验通过后，Run 会返回稳定的 `review_id` 和 `memsphere run review wait --review <review_id>`；Review 通过前当前 Action 不推进。Review Submission 自动冻结当前候选之前已经上报的全部 Artifact，Reviewer 根据当前 Artifact 与要求按需追溯。全部评审意见收齐后，如 CLI 提示等待 Runner 投票，应先阅读摘要和 blocking 意见，再显式执行 `memsphere run review vote`。Runner 拥有最终决定权；建议意见和 blocking 严重级别不会形成额外否决权。需要留下审计记录时，可在投票前使用 `memsphere run review resolve` 记录意见的接受、延期或驳回原因。
- 绑定到当前 Slot 的 Agent Actor 会由 Memsphere 通过 ACP 自动启动。初始 Prompt 会给出精炼的 Review contract 和前序 Artifact 索引；Agent Reviewer 在当前 Workspace/worktree 中使用 PATH 注入的受限 `memsphere-review` 会话命令，命令自动绑定当前 Run 与 Assignment；ChangeSet Run 的 `memory list/read` 还会自动绑定该 Run 的冻结 Memory 快照。Reviewer 直接通过 Store 操作自己的 Assignment，不创建或监听 Review bridge/socket，也不依赖某一种 shell 的环境变量语法。`run review comment` 必须声明 severity；短意见使用 `--body`，多行 Markdown 使用 `--body-file`，历史 `--body-stdin` 仍兼容。提交摘要可使用 `--summary-file`。普通 ACP 文本回复不构成 Comment 或 Vote。Agent 失败时可用 `memsphere run review retry --review <id> --assignment <actor-or-assignment-id>` 显式重试。
- Human 使用 View 中的大尺寸 Artifact Review 浮窗操作本人 Assignment：按 Round 查看当时的不可变 Submission、正式 Comment、Vote、Result 与 Revision Summary，在当前轮添加整体或定位 Comment、选择 Vote 并 Submit。历史 Round 只读，完成后的 Review 仍可从对应 Run 步骤重新打开。
- Artifact Review Comment 只绑定当前 Artifact Submission；定位 Comment 保存 Submission、digest、Renderer target 和短上下文，不评论 Memory 或 Workspace 文件，也不会自动迁移到下一轮。Memory 修改意见只作为 ChangeSet Comment 存储和处理，与 Artifact Review 完全独立。
- 调试 Agent 启动时，可设置 `debug.agent_review: true` 禁止后台真实派发，再显式执行 `memsphere run try-run --run <run_id>` 生成 `launch.json` 和 `prompt.md`。该命令不 claim Assignment、不启动 ACP，也不修改 Run；View 轮询不会自动生成调试文件。

### 维护当前配置

View 是 Memsphere Home 级单一服务，可从 Project 选择器切换当前展示内容。Memory、ChangeSet、Run、设置与 Artifact Review 的主要界面都有稳定 URL，可复制到另一窗口直接重开；ChangeSet 从 Memory 列表的“修改中”标记进入，不占用顶层菜单；Artifact Review 的 Round 与 Material 由查询参数定位，临时身份、草稿和布局不写入 URL。配置中心通过左侧分组导航直接进入 Memsphere 或当前 Project 设置，右侧只展示当前配置内容：全局设置维护语言、View 服务和 ACP Provider，Project 设置展示 Store 并维护 Control Plane 与 Actor。两个 Scope 分别保存草稿、Revision、校验结果和确认 diff，保存时只原子写入各自配置文件；切换 Project 不清除全局草稿，放弃未保存的 Project 草稿前必须确认。全局 ACP Provider 被任一已注册 Project 的 Actor 引用时不能重置或删除。磁盘 View 配置与运行配置不一致时，需要手动执行：

```bash
memsphere view restart
```

Runner 与 Human/Agent Actor 在参与者列表中维护。Permission 必须来自系统 Catalog，并统一保存在 `permissions`。`debug`、Secret、配置回滚和 View 远程启停不属于配置中心。

当 Artifact 使用 `type: object`、`format.name: markdown` 和 `layout: outline` 时，Schema 的 `fields` 可以使用 mapping 形式的 `!repeat`，把非空 `body` 中的一组字符串或 `!schema` 字段整体重复。`limit.min/max` 如出现必须是非负整数且 `min <= max`。首版不允许 Repeat 嵌套，也不允许把 Repeat 放在 table、defines、flow 或其他位置：

```yaml
fields:
  - 背景
  - !repeat
    limit: { min: 1, max: 3 }
    body:
      - !schema
        names: [决策]
        fields: [结论, 负责人]
  - 总结
```

## Memsphere 如何遵循记忆

### 永远从流程记忆开始

需要使用 memsphere 遵循记忆完成任务时，必须先从当前工程中选择适用的 Procedure。Procedure 负责组织相关 Memory 的引用、每个步骤的产物约束、完整执行过程和过程产物记录，是遵循记忆的统一入口。

```bash
memsphere memory list --kind procedures
```

根据 `names`、`defines` 和用户目标选择候选，并读取执行任务所需的 Procedure 内容。创建、编辑、review Memory 等操作也必须从相应的 Procedure 开始。

如果没有适用的专用 Procedure，读取并执行 `memsphere-general-task-execution`。只有当前工程连该流程也没有时，才告知用户缺少可执行流程，并由用户决定是否建设或安装 Procedure。

### 按需加载概念、陈述和图式

选定 Procedure 并开始执行后，根据 Procedure 中的引用和当前步骤按需读取相关 Memory：

- 任务涉及明确的核心领域对象或交付物名称时，先检索同名或相关 Concept；不得因模型自认为理解而跳过，命中后必须完整读取。
- 需要确认事实、规则、约束或建议时，读取 Statement。
- 需要创建或检查结构化产物时，读取 Schema。

读取到的定义和规则应共同生效，并与当前步骤的产物约束一起执行。信息不足时向用户补充询问；用户输入与规则冲突时说明冲突；完成步骤后检查产物是否满足已读取的定义、规则、结构和 Procedure 约束。

读取较长的 Statement、Schema 或 Procedure 时，可以按 Node 定位，但不得只看 Node 列表摘要。局部读取必须同时应用返回的 `context` 和 `fragment`，并覆盖当前任务涉及的全部相关 Node。

### 使用 memsphere 框架遵循流程记忆

memsphere 使用 Run 记录和控制一次 Procedure 的执行过程，保证 Agent 每次只处理当前步骤，并在取得步骤产物后继续推进。

#### 启动流程

读取执行所需的 Procedure 内容后，使用它的名称启动一次 Run：

```bash
memsphere run start "<Procedure 名称>" --name "<本次 Run 名称>"
```

需要直接运行尚未安装到当前 Primary Project Memory Store 的 Procedure YAML 时，可以指定文件路径：

```bash
memsphere run start --file "<Procedure YAML 路径>" --name "<本次 Run 名称>"
```

Procedure 名称参数与 `--file` 必须二选一；两种方式都必须通过 `--name` 指定本次 Run 的名称。文件中的根 Procedure 会在启动时写入 Run 快照；外部 `!call` 和外部 Schema 从 Run 启动时冻结的 Project Memory Revision 解析。

需要在正式集成或 Managed publish 前试运行已经验证的 active ChangeSet 时，使用：

```bash
memsphere run start "<Procedure 名称>" --change <change-id> --name "<本次 Run 名称>"
```

该入口从 ChangeSet 的 base revision 与当前 checkpoint 物化四类完整候选 Memory，并把不可变快照、ChangeSet id、checkpoint digest 和 base revision 冻结进 Run。执行这个 Run 时，使用同一个 Run ID 发现和读取其 Memory 快照：

```bash
memsphere memory list --run <Run ID>
memsphere memory read "<名称/逻辑引用>" --run <Run ID>
```

Concept、Statement、Schema 和 Procedure 都必须从该入口读取，不能混用当前工作树或后来 checkpoint 的版本。ChangeSet 后续修改不影响已经启动的 Run；需要测试新 checkpoint 时启动新的 Run。`--change` 不得与 `--file` 同时使用，也不接受未验证、验证失败、completed 或 abandoned 的 ChangeSet。不传 `--change` 时，Embedded 读取当前 worktree，Managed 读取 `published_revision`。

命令会返回 Run ID 和第一个待执行步骤。后续命令都使用这个 Run ID，不要再次启动同一个流程。

#### 理解当前步骤

启动、状态查询或流程推进后，CLI 会按当前场景返回当前步骤、Review 下一步或完成状态：

- `Procedure Asserts` 是当前调用链中全部 Procedure 必须持续满足的全局约束。
- `Do` 表示当前 Agent 步骤需要完成的事情；Agent 步骤不重复展示执行者。
- `Ask human to do` 表示当前步骤需要 Human 操作，Agent 必须暂停并等待 Human 提供结果。
- `Asserts` 是当前步骤必须满足的要求。
- `Suggests` 是执行时可以参考的建议。
- `Details` 是理解和执行当前步骤所需的补充上下文。
      - `Artifact` 表示当前步骤需要产出的内容、业务类型、编码格式和可选 Schema。
- `Then` 给出完成当前步骤后应执行的下一条 memsphere 命令。

正常的当前步骤提示不展开权限清单。权限不足时，CLI 只说明被拒绝的操作、所需权限和处理方式；不得把 Memsphere Permission 误解为任意操作系统文件、进程或网络权限。

只执行当前返回的步骤，不提前执行尚未返回的后续步骤。

#### 上报步骤产物

完成当前步骤后，检查产物是否满足 `Procedure Asserts`、步骤提示、`Asserts` 和 `Artifact` 格式，然后执行 CLI 在 `Then` 中给出的命令。

Agent 执行任何 `memsphere run report` 命令时，必须请求宿主在沙盒外执行。如果 CLI 拒绝受限环境中的 Report，使用完全相同的命令申请提升或非沙盒执行权限后重试；不要修改参数规避检查。

普通产物通常使用 `memsphere run report` 上报。内容较短时直接上报：

```bash
memsphere run report --run <Run ID> --artifact "<产物内容>"
```

产物已经写入文件时，上报文件：

```bash
memsphere run report --run <Run ID> --artifact-file <文件路径>
```

report 成功后会先返回本次 Run 与 Artifact 的上报回执。如果触发 Artifact Review，回执还包含稳定的 Review 标识，并紧接着返回等待命令；不要继续执行后续步骤：

```bash
memsphere run review wait --review <Review ID>
```

wait 如果显示 Agent Reviewer 失败，当前轮次仍未决，Runner 不得绕过或自行代投。把 View 中显示的 Provider、Attempt 和错误信息告知 human，等待 human 在 View 中执行重试，然后继续使用同一个 `review_id` 等待。

如果 wait 返回 `awaiting_runner_vote`，当前执行本 Run 的 Agent 就是 Runner；先阅读全部参与者的 Comment 和 Vote，再由自己明确决定接纳或修改。接纳才会推进 Run：

```bash
memsphere run review vote --review <Review ID> --round <Review Round ID> --vote approve
```

要求修改时必须说明理由，随后修改 Artifact 并进入下一轮：

```bash
memsphere run review vote --review <Review ID> --round <Review Round ID> --vote request_changes --comment "<修改要求>"
```

Review 要求修改时，先修改 Artifact，再把本轮修改摘要写入文件并原子重报：

```bash
memsphere run report --run <Run ID> --artifact-file <文件路径> --revision-summary-file <摘要文件路径>
```

带 Schema 的 Markdown 结构化产物可以按照 CLI 提示进入 Schema 填写流程。进入后先阅读整体概览，再逐个上报字段；需要重新查看完整结构、字段状态、约束来源和累计草稿路径时执行：

```bash
memsphere run schema show --run <Run ID>
```

字段提示只提供产出当前内容所需的父 Action、父 Artifact 契约、Schema 约束与进度，不包含后续 Review 的参与者、权限或决策信息。每个字段 report 后，Run 会原位更新同一份受管草稿；不得把字段 Event 或中途草稿当作已经接纳的父 Artifact。

当 Schema Run 到达 `!repeat` 控制步骤时，CLI 不要求 Artifact，而会提示一次提交总重复次数：

```bash
memsphere run repeat <count> --run <Run ID>
```

次数必须满足当前步骤显示的 min/max。提交后，Run 会按轮次展开完整 body，再继续逐项产出普通字段 Artifact。

当 Schema Run 到达可选字段步骤时，CLI 会提示可以跳过该字段：

```bash
memsphere run skip --run <Run ID>
```

只能跳过当前可选字段；必填字段不得 skip。跳过后 Run 会记录 skipped 事件，最终组装的结构化 Artifact 中省略该字段内容。

全部字段完成后，Run 不会自动推进，而会返回 `Schema Finalization`、结构与契约校验结果、受管草稿的绝对路径和精确提交命令。Runner 必须阅读完整草稿，可直接编辑该文件，然后严格执行返回的命令显式提交同一文件：

```bash
memsphere run report --run <Run ID> --artifact-file <受管草稿绝对路径>
```

提交时会读取文件最新内容并重新校验。失败时继续留在全局调整状态，修订同一文件后重试；成功后由 Run 按父 Artifact 契约决定直接接纳还是进入 Artifact Review。Runner 不需要也不应自行判断何时发起 Review，只继续执行每次 CLI 返回的 `Then`。

未触发 Review 的上报回执后会继续显示下一个待执行步骤或 Run 完成状态。完整 Review 汇总由 `run review wait` 返回；`run review vote` 只确认投票结果并给出推进后的下一动作，不重复刚刚展示的意见。不应从 report 回执推断评审结果。继续执行和上报，直到 CLI 明确显示完成。

#### 废弃运行中的 Run

只有 Human 可以主动决定废弃仍在运行的 Run。Agent 不得因为步骤失败、Reviewer 失败、超时、无进展或自身判断而自动废弃；只有收到 Human 对目标 Run 的明确废弃指示后，才可以代为执行：

```bash
memsphere run abandon --run <Run ID> [--reason "<可选原因>"]
```

需要保留多行原因时使用 `--reason-file <文件路径>`；若要把已冻结的 Human Actor 记录为发起者，可附加 `--actor <Human Actor ID>`。命令把 Run 从 `running` 转为独立的 `abandoned` 终态，记录时间、Human 发起信息和停止位置，保留已有 Artifact、Schema 草稿及 Review 证据，取消未完成的 Review/Assignment/Attempt，并尽力停止 Reviewer Worker。重复废弃是幂等读取；done Run 不得废弃。

废弃后 Run 只读且不可恢复执行，不能继续 report、schema、binding 或 Review 写入。废弃不会自动归档；Human 若还希望隐藏该 Run，必须再单独点击或执行归档。只有 `done` 或 `abandoned` Run 可以归档，恢复后仍保持归档前的终态。

#### 人机协同

当 `Actor` 为 `human` 时，暂停 Agent 执行，把 `Ask human to do`、相关要求和产物格式清楚地告知用户，并等待用户提供结果。不要代替用户完成 human 步骤，也不要在用户回复前继续推进。

收到用户结果后，将它作为当前步骤产物按 `Then` 命令上报，再继续处理 CLI 返回的新步骤。CLI 明确返回 Run 完成状态时，向用户汇报流程完成情况和最终产物。

旧 Memory 若未声明 `syntax`，先执行 `memsphere migrate syntax --check`；若仍使用 `format: boolean/string/number/schema`，执行 `memsphere migrate artifact-contract-v2 --check`；若使用 `element_types`、字符串形式的旧 `items`、array 直接声明 `fields`，或旧式 Schema `format: outline/table`，再执行 `memsphere migrate schema-contract-v2 --check`。`--write` 只允许 Embedded Store；Managed Store 必须把迁移结果作为 ChangeSet 候选正常 Publish。未经 human 明确确认，不对真实 Memory Store 执行迁移。旧语法不能启动新 Run，v1 running Run 不得跨版本继续，done/abandoned Run 与 Review snapshot 仅只读展示。
