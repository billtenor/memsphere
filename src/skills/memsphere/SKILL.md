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

list 结果中的 `names` 是规范名称和别名，`defines` 是简要定义。确定候选后，完整读取 Memory，或按 Node 读取完成任务所需的内容。

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
names:
  - 示例概念
  - 示例别名
defines:
  - 对这个概念的定义。
```

- `!concept`、`!statement`、`!procedure`、`!schema` 分别表示四种 Memory。
- `names` 的第一项是规范名称，其余项是别名。
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

- `type` 必填，内置值为 `boolean`、`number`、`string`、`object`、`array`。
- `format` 省略时默认为 `plain`；简单格式可写 `markdown`、`json` 或 `yaml`，格式参数使用带 `name` 的对象。
- `layout` 属于 markdown format：object 使用 outline，array 使用 table。
- Schema 只描述 fields、element_types 和 Repeat，不再拥有 format。
- `asserts` 和 `suggests` 是自然语言契约，不会被代码 validator 猜测执行。

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

- 遇到需要理解的术语或领域对象时，读取 Concept。
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

旧 Memory 若仍使用 `format: boolean/string/number/schema` 或 `Schema.format`，先执行 `memsphere migrate artifact-contract-v2 --check`。未经 human 明确确认，不对真实 Memory Store 执行 `--write`。v1 running Run 不得跨版本继续，done Run 与 Review snapshot 仅只读展示。
