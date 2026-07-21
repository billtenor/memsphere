---
name: memsphere
description: Use memsphere to discover, read, interpret, and apply project Memory, or to route Memory creation, editing, review, and Procedure execution through installed workflows. Trigger when the user explicitly asks to use memsphere, refers to Memory, Concept, Statement, Schema, Procedure, or asks for work that should follow memories installed in the current project.
---

# Memsphere

memsphere 定义了一套维护记忆、检索记忆和遵循记忆的框架。通过 memsphere CLI，可以在执行任务时读取当前工程积累的知识和流程，并按照这些历史经验完成任务。

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

list 结果中的 `names` 是规范名称和别名，`defines` 是简要定义。list 只用于发现候选，不能替代 read；确定候选后，必须完整读取 Memory，或按 Node 读取完成任务所需的内容。

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
memsphere memory read Memory
memsphere memory read Concept
memsphere memory read Statement
memsphere memory read Procedure
memsphere memory read Schema
```

如果命令提示当前工程尚未初始化，告知用户需要执行 `memsphere init`，等待用户完成初始化后再重试。

## Memsphere 记忆语法规则

memsphere 使用带 YAML tag 的 mapping 描述一份 Memory。根节点的 tag 表示 Memory 类型：

```yaml
!concept
syntax: memsphere-20260721-stable
names:
  - 示例概念
  - 示例别名
defines:
  - 对这个概念的定义。
```

- `!concept`、`!statement`、`!procedure`、`!schema` 分别表示四种 Memory。
- 顶层 Memory 使用 `syntax` 声明不可变的语法版本；当前稳定版本是 `memsphere-20260721-stable`。省略时固定按历史起点 `start` 解释，不得按最新版猜测。
- `names` 的第一项是规范名称，其余项是别名。
- 原本允许 `names` 的节点也允许写单个 `name`，其解析结果等价于 `names: [name]`；二者不能同时出现。
- `defines` 用于定义这份 Memory；其中的全部成员共同生效。
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
- array Schema 不允许直接声明 `fields`。对象元素应在 `item` 或 `items` 的 `type: object` Schema 中声明 `fields`；省略 `item/items` 时只校验数组容器。
- 不要使用已删除的 `element_types`；旧版字符串 `items` 必须迁移为带 `!schema` tag 的 `item/items`。
- `asserts` 和 `suggests` 是自然语言契约，不会被代码 validator 猜测执行。

Procedure 和 Artifact 可以声明 Artifact Review 控制平面字段。`role_bindings` 把 `.memsphere/config.json` 中的 Role 绑定到 Identity；`permission_grants` 只在当前 Artifact 临时追加 Role 被允许授予的 Permission：

```yaml
!procedure
syntax: memsphere-20260721-stable
name: 受控交付流程
role_bindings:
  reviewer: review_agent
goals:
  - 交付受控产物。
flow:
  - !action
    action: 生成受控产物。
    artifact: !artifact
      name: 受控产物
      review: artifact_acceptance.unanimous
      role_bindings:
        reviewer: [human_reviewer, review_agent]
      permission_grants:
        runner: [artifact.submit]
```

- `!procedure.role_bindings` 是默认绑定；调用方 Procedure、被调用 Procedure、当前 Artifact 依次覆盖同名 Role，未声明 Role 继续继承。
- `!artifact.role_bindings` 只覆盖当前 Artifact；`!artifact.permission_grants` 只能使用目标 Role 的 `grantable_permissions`，且只对当前 Artifact 生效。
- `runner` 是当前 Run 执行上下文隐式承担的保留 Role，不得显式绑定 Identity。
- `!action` 不允许直接声明 `role_bindings` 或 `permission_grants`，两个字段必须写在其 `artifact` 中。
- Runner 在 `run report` 前应阅读 CLI 输出的权限说明；成功或拒绝结果中的权限、来源和自然语言说明均来自 Run 启动时保存的控制平面快照。
- `!artifact.review` 如出现必须引用内置 Decision Policy。确定性校验通过后，Run 会返回稳定的 `review_id` 和 `memsphere run review wait --review <review_id>`；Review 通过前当前 Action 不推进。全部评审意见收齐后，如 CLI 提示等待 Runner 投票，必须先阅读全部意见，再显式执行 `memsphere run review vote`。

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

如果没有适用的专用 Procedure，读取并执行 `通用流程`。只有当前工程连通用流程也没有时，才告知用户缺少可执行流程，并由用户决定是否建设或安装 Procedure。

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
memsphere run start "<Procedure 名称>"
```

命令会返回 Run ID 和第一个待执行步骤。后续命令都使用这个 Run ID，不要再次启动同一个流程。

#### 理解当前步骤

每次启动或上报后，CLI 都会返回当前步骤的提示：

- `Procedure Asserts` 是当前调用链中全部 Procedure 必须持续满足的全局约束。
- `Actor` 表示当前步骤由 agent 还是 human 执行。
- `Do` 或 `Ask human to do` 表示当前步骤需要完成的事情。
- `Asserts` 是当前步骤必须满足的要求。
- `Suggests` 是执行时可以参考的建议。
- `Details` 是理解和执行当前步骤所需的补充上下文。
      - `Artifact` 表示当前步骤需要产出的内容、业务类型、编码格式和可选 Schema。
- `Then` 给出完成当前步骤后应执行的下一条 memsphere 命令。

启用控制平面的步骤还会在 `Then` 前显示 `Control Plane` 和 `Permission Guidance`（中文环境显示“权限说明”）。执行者必须先理解当前 Artifact 下的有效 Permission、临时 Grant 和来源，再执行 `run report`；不得把 Memsphere Permission 误解为任意操作系统文件、进程或网络权限。

只执行当前返回的步骤，不提前执行尚未返回的后续步骤。

#### 上报步骤产物

完成当前步骤后，检查产物是否满足 `Procedure Asserts`、步骤提示、`Asserts` 和 `Artifact` 格式，然后执行 CLI 在 `Then` 中给出的命令。

普通产物通常使用 `memsphere run report` 上报。内容较短时直接上报：

```bash
memsphere run report --run <Run ID> --artifact "<产物内容>"
```

产物已经写入文件时，上报文件：

```bash
memsphere run report --run <Run ID> --artifact-file <文件路径>
```

如果 report 触发 Artifact Review，执行 CLI 返回的等待命令，不要继续执行后续步骤：

```bash
memsphere run review wait --review <Review ID>
```

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

带 Schema 的 Markdown 结构化产物可以按照 CLI 提示进入 Schema 填写流程。不要自己猜测下一条命令，以当前 CLI 输出的 `Then` 为准。

当 Schema Run 到达 `!repeat` 控制步骤时，CLI 不要求 Artifact，而会提示一次提交总重复次数：

```bash
memsphere run repeat <count> --run <Run ID>
```

次数必须满足当前步骤显示的 min/max。提交后，Run 会按轮次展开完整 body，再继续逐项产出普通字段 Artifact。

上报成功后，CLI 会返回下一个待执行步骤；继续执行和上报，直到显示 `done`。

#### 人机协同

当 `Actor` 为 `human` 时，暂停 Agent 执行，把 `Ask human to do`、相关要求和产物格式清楚地告知用户，并等待用户提供结果。不要代替用户完成 human 步骤，也不要在用户回复前继续推进。

收到用户结果后，将它作为当前步骤产物按 `Then` 命令上报，再继续处理 CLI 返回的新步骤。Run 显示 `done` 时，向用户汇报流程完成情况和最终产物。

旧 Memory 若未声明 `syntax`，先执行 `memsphere migrate syntax --check`；若仍使用 `format: boolean/string/number/schema`，执行 `memsphere migrate artifact-contract-v2 --check`；若使用 `element_types`、字符串形式的旧 `items`、array 直接声明 `fields`，或旧式 Schema `format: outline/table`，再执行 `memsphere migrate schema-contract-v2 --check`。未经 human 明确确认，不对真实 Memory Store 执行 `--write`。旧语法不能启动新 Run，v1 running Run 不得跨版本继续，done Run 与 Review snapshot 仅只读展示。
