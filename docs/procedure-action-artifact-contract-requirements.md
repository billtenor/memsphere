# Procedure Action 与 Artifact 契约增强需求

状态：Proposed

日期：2026-07-15

## 背景

在建设“Agent 测试任务建设流程”时，Procedure 的部分精确约束只能写在 `defines`、Action 文本或 Artifact 名称里，无法落到它们真正约束的执行节点上。

当前主要存在两个直接问题：

1. Action 不支持 `asserts`，步骤级完成条件只能混入 `action` 文本，或者集中写到 Procedure 的 `defines` 中。
2. Artifact 的 `schema` 只支持引用外部 Schema Memory，不支持内嵌匿名 `!schema`。只被一个 Procedure 使用的交付结构因此也要建立独立 Schema Memory，或错误地写进 Procedure 的 `defines`。

这会造成规则离执行点过远、Procedure 定义与交付结构混杂、Run 时约束展示不完整，也使流程 review 难以准确定位规则所属步骤。

## 当前实现确认

当前代码中的真实类型为：

```ts
type ActionNode = {
  tag: "!action";
  action: string;
  actor?: "agent" | "human";
  artifact: ArtifactNode;
};

type ArtifactNode = {
  tag: "!artifact";
  name: string;
  format: ArtifactFormat;
  schema?: string;
};
```

对应限制：

- `src/memory/schema.ts` 对 Action 和 Artifact 使用严格对象校验，额外字段会被拒绝。
- `artifact.schema` 当前由 `nonEmptyString.optional()` 校验。
- `artifact.format: schema` 时必须填写外部 Schema 名称；其他 format 不允许出现 `schema`。
- `src/run/store.ts` 编译 Action 时只保留 instruction、actor、artifact name、format 和 schema name。
- Run、View、Review snapshot 和 Schema 引用收集都假设 Artifact Schema 是外部名称。

因此，Action `asserts` 和内嵌 Artifact Schema 都不是只修改 YAML parser 即可完成的功能，还需要同步修改 Run 编译、持久化、CLI、View 和引用收集。

## 目标

1. 允许在每个 Action 上声明步骤级断言，使执行要求靠近被约束的步骤。
2. 允许 Artifact 通过外部名称引用 Schema，或直接内嵌匿名 Schema。
3. 允许明确标记最终交付 Artifact，使 Run 和 View 能区分中间产物与最终输出。
4. 保证 Action 断言和 Artifact Schema 在 Run 生命周期内稳定、可查看、可审计。
5. 保留外部 Schema Memory 的复用价值，不把所有 Schema 都改成内嵌结构。

## 非目标

- 本需求不引入任意用户自定义结构体类型。
- 本需求不实现自然语言断言的自动语义判定。
- 本需求不在本轮设计 Action 之间的显式数据依赖语法。
- 本需求不在本轮改变 `!call` 的输入输出映射。
- 本需求不改变 Schema 的 `outline`、`table` 呈现语义。

## 需求一：Action 支持 asserts

### 建议语法

```yaml
- !action
  action: 对当前 case 执行静态自洽性审计。
  actor: agent
  asserts:
    - evaluation.md 中的每项要求都能追溯到 task.md、fixture 或测试组规则。
    - 不得启动被测子 agent。
    - 审计发现的问题必须在当前步骤结束前修复或明确记录。
  artifact: !artifact
    name: 当前 case 自洽性审计结果
    format: markdown
```

### 类型建议

```ts
type ActionNode = {
  tag: "!action";
  action: string;
  actor?: StepActor;
  asserts?: string[];
  artifact: ArtifactNode;
};
```

### 校验规则

- `asserts` 为可选字段。
- 出现时必须是非空字符串数组，且至少包含一项。
- 普通 Action、`!if.condition` 和 `!while.condition` 中的 Action 均允许使用。
- 不要求所有 Action 强制填写；对关键判断、写文件、校验和最终交付步骤应在 authoring guidance 中推荐填写。
- `asserts` 表达步骤完成时必须成立的条件，不用于描述非强制建议。

### 运行时语义

- Procedure 编译为 RunStep 时必须保留 Action asserts，不能只在源 YAML 中存在。
- `memsphere run next` 应在当前步骤说明中展示 asserts。
- View 应在 Action 详情中紧邻步骤展示 asserts。
- Review snapshot 应保留 asserts，使 review 能准确评论步骤约束。
- parser 和 runtime 只保证断言被携带与展示，不声称自动理解其自然语言语义。

## 需求二：Artifact 支持内嵌 Schema

### 建议语法

Artifact Schema 支持两种写法。

复用外部 Schema Memory：

```yaml
artifact: !artifact
  name: 需求文档
  format: schema
  schema: 需求文档结构
```

使用当前 Artifact 私有的内嵌 Schema：

```yaml
artifact: !artifact
  name: Agent 测试任务建设摘要
  format: schema
  final: true
  schema: !schema
    format: outline
    fields:
      - 最终 case 清单
      - 文件位置
      - 静态校验结果
      - 自洽性结论
      - 未运行说明
      - 后续运行命令
```

### 类型建议

```ts
type ArtifactNode = {
  tag: "!artifact";
  name: string;
  format: ArtifactFormat;
  schema?: string | SchemaNode;
  final?: boolean;
};
```

### 校验规则

- `format: schema` 时 `schema` 必填。
- `schema` 可以是非空字符串，表示外部 Schema Memory 的名称或别名。
- `schema` 可以是带 `!schema` tag 的内嵌 SchemaNode。
- `format` 不是 `schema` 时禁止填写 `schema`。
- 内嵌 Schema 是匿名结构，允许省略 `names` 和 `defines`，但必须包含 `format`、`asserts`、`element_types` 或 `fields` 中至少一个有意义字段。
- 内嵌 Schema 使用与其他匿名 Schema 相同的字段、类型和 format 校验规则。
- 内嵌 Schema 不进入 Memory Catalog，不参与全局名称冲突检查，也不能被其他 Memory 按名称引用。
- 需要跨多个 Procedure 复用、独立发现或独立 review 的结构仍应建立顶层 Schema Memory。

### Run 语义

- 启动 Run 时必须把内嵌 Schema 随 Run plan 一起快照，后续 Procedure 文件变化不能改变已经启动的 Run。
- 外部 Schema 继续按照现有名称解析和 Schema frame 机制执行。
- 当前步骤使用内嵌 Schema 时，CLI 应允许进入“当前 Artifact 的 Schema”，不要求用户提供不存在的 Schema 名称。
- 建议扩展命令为：

```bash
memsphere run enter-schema --run <run-id>
```

- 当当前 Artifact 引用外部 Schema 时，现有命令仍可使用：

```bash
memsphere run enter-schema <schema-name> --run <run-id>
```

- 内嵌 Schema frame 应使用由 Procedure 名称、step id 和 artifact name 生成的内部稳定标识，不得伪造全局 Schema 名称。
- 内嵌 Schema 生成的最终 Artifact 仍使用现有 `.schema.md` 存储与字段上报机制。

### View 与 Review 语义

- View 对外部 Schema 显示可跳转的 Schema 名称。
- View 对内嵌 Schema 显示“inline schema”，并允许在当前 Action 下展开结构，不生成无效 Catalog 链接。
- Review 引用收集遇到内嵌 Schema 时不应增加外部 Schema 引用，但 snapshot 必须保留内嵌结构。
- Run 详情应能显示内嵌 Schema 的 format、fields 和 asserts。

## 需求三：区分最终 Artifact 与中间 Artifact

当前每个 Action 都必须产出 Artifact，但系统无法判断哪些是过程证据，哪些是 Procedure 的最终交付物。只增加内嵌 Schema 能描述结构，仍不能解决最终输出识别问题。

建议为 Artifact 增加：

```yaml
final: true
```

规则：

- `final` 可选，默认 `false`。
- `final` 是 Artifact 契约元数据，不是 `artifact.format: boolean` 的执行产物，不受 Boolean 控制约束限制。
- 一个 Procedure 可以有多个 final Artifact，例如不同分支形成不同交付物。
- final Artifact 仍由所属 Action 产生，不在 Procedure `defines` 中重复声明。
- Run 完成时应汇总本次实际执行路径上已经上报的 final Artifacts。
- View 应将最终交付物与中间产物分区展示。
- 未执行分支中的 final Artifact 不计入本次 Run 输出。
- 初期不强制每个 Procedure 必须声明 final Artifact，但 validator 可以对完全没有 final Artifact 的 Procedure 给出 authoring warning。

## 需求四：落实 Boolean 控制约束

当前普通 Action 仍然可以声明：

```yaml
artifact: !artifact
  format: boolean
```

但这个布尔值不会自动控制流程。此前已经在 `docs/procedure-boolean-control-constraint.md` 中记录了该问题。

本轮修改 Action schema 时应同时落实：

- `!if.condition` 和 `!while.condition` 的 Artifact 必须为 boolean，保持现有规则。
- 普通 flow Action 的 Artifact 不允许为 boolean。
- 如未来确实需要持久化布尔事实，应将其作为结构化 Schema 的字段，而不是孤立控制 Artifact。
- validator 错误必须包含准确 flow 路径。

该规则与 Action asserts 相互配合：判断标准写在 condition Action 的 asserts 中，判断结果通过 boolean Artifact 直接驱动 `!if` 或 `!while`。

## 进一步发现但暂不纳入本轮

### Action 输入依赖仍然隐式

Action 只能通过自然语言猜测应消费哪些前序 Artifact，没有 `inputs` 或 Artifact reference。流程较长时容易出现同名产物、引用错误和隐含数据依赖。

后续应单独设计：

- Artifact 的稳定局部标识。
- Action `inputs` 或 `uses` 引用语法。
- 分支、循环和子流程作用域。
- View 中的数据依赖展示。

在稳定标识设计完成前，不建议只靠 Artifact name 实现引用。

### Call 没有输出契约

`!call` 当前只有 `target`，调用者无法声明使用被调用 Procedure 的哪个 final Artifact，也无法把输出映射给后续 Action。

该问题应在 final Artifact 和显式依赖机制稳定后继续设计，避免提前形成第二套输出模型。

### 自然语言断言无法自动证明

Action asserts 可以显著改善提示、执行和 review 精度，但系统无法仅靠 parser 判断“断言是否真的成立”。后续可考虑由 Schema 校验、工具结果或 evaluator 提供机器可判定证据；本轮不应把“展示断言”宣传为“自动验证断言”。

## 对现有 Procedure 的迁移建议

功能实现后，应优先升级复杂 Procedure：

1. 将散落在 `defines` 中、实际只约束某一步的规则移动到对应 Action asserts。
2. 将只被一个 Artifact 使用的交付结构移动到 `artifact.schema: !schema`。
3. 保留真正描述 Procedure 整体含义、边界和适用场景的 defines。
4. 将最终交付步骤的 Artifact 标记为 `final: true`。
5. 将普通 boolean Action 改造成 `!if.condition` 或 `!while.condition`。
6. 不为了内嵌而内嵌：跨流程复用的 Schema 继续保持为顶层 Memory。

“Agent 测试任务建设流程”可作为首个迁移样例：

- 各静态校验、审计和文件写入步骤使用 Action asserts。
- 最后一步的“Agent 测试任务建设摘要”改为 `format: schema`。
- 建设摘要的结构以内嵌 Schema 描述，并标记 `final: true`。
- Procedure defines 只保留流程总体定义和跨步骤规则。

## 实现影响范围

至少需要检查和修改：

- `src/memory/ast.ts`
- `src/memory/schema.ts`
- `src/run/store.ts`
- `src/commands/run.ts`
- `src/commands/view.ts`
- `src/view/browser.ts`
- `src/skills/memsphere/SKILL.md`
- Reserved Memory 中的 Action、Artifact、Procedure 和 Schema 定义
- Memory schema、Run store、View browser、review snapshot 相关测试

## 验收标准

### Parser 与 validator

- Action 可以解析合法 asserts，并拒绝空数组、空字符串和错误类型。
- condition Action 可以携带 asserts。
- Artifact 可以解析外部 Schema 名称和内嵌 Schema。
- 非 schema format 携带 schema 时校验失败。
- schema format 缺少 schema 时校验失败。
- 无实际结构的匿名内嵌 Schema 校验失败。
- 普通 Action 产出 boolean 时校验失败，condition Action 产出非 boolean 时校验失败。
- 现有合法外部 Schema 引用仍然可以通过校验。

### Run

- Run plan 和 active step 保留并展示 Action asserts。
- 外部 Schema Artifact 继续按现有流程执行。
- 内嵌 Schema Artifact 可以进入 Schema frame、逐字段上报并生成最终文件。
- Procedure 源文件在 Run 启动后发生变化，不影响已快照的内嵌 Schema。
- Run 完成时能准确汇总实际执行路径上的 final Artifacts。

### View 与 Review

- View 能展示步骤 asserts。
- View 能区分外部 Schema 与 inline schema。
- View 能单独展示最终交付 Artifacts。
- Review snapshot 保留 Action asserts 和内嵌 Schema。
- 内嵌 Schema 不产生错误的外部 Memory 引用。

### 文档与真实样例

- Skill 文档包含 Action asserts、外部 Schema Artifact、内嵌 Schema Artifact 和 final Artifact 的合法示例。
- 至少迁移一份真实 Procedure，并通过 `memsphere validate` 和完整 Run 测试。
- 所有旧的普通 boolean Action 在启用硬校验前完成迁移。

## 建议实施顺序

1. 扩展 AST 与 Zod schema，补齐 parser/validator 测试。
2. 将 Action asserts 和 inline Schema 编译进 Run plan 快照。
3. 扩展 Schema frame 进入方式和 Artifact 持久化。
4. 增加 final Artifact 汇总。
5. 更新 View、Review snapshot 和引用收集。
6. 更新 Skills 与 Reserved Memory。
7. 迁移真实 Procedure，落实 Boolean 控制约束。
8. 执行全量测试和端到端 Run 验收。
