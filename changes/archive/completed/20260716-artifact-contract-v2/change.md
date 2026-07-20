---
id: 20260716-artifact-contract-v2
type: feature
created: 2026-07-16
completed_at: 2026-07-18
run_id:
---

# Procedure Action Artifact Contract v2 需求

## 目标

Procedure 的每个 Action 通过 Artifact 声明可执行交付契约。契约按固定顺序拆成三层：

```text
type -> format -> schema
```

- type 判断解码后的业务值类型。
- format 负责原始输入的编码和格式专属参数。
- schema 可选，负责字段、嵌套结构、元素类型和 Repeat 约束。
- asserts、suggests、defines 保持自然语言语义，不由代码 validator 猜测执行。

## Artifact 结构

```yaml
artifact: !artifact
  name: 发布记录
  type: object
  format:
    name: markdown
    layout: outline
  schema: !schema
    fields: [版本, 发布日期, 发布结果]
  final: true
```

`name` 必填。`type` 省略时默认 string，其他 type 必须显式声明。`format` 完全省略时默认 plain；`format: {}`、null 或对象缺少 name 都非法。Schema 可以是外部名称或内嵌 `!schema`。

内置 type：

```text
boolean | number | string | object | array
```

内置 format：

```text
plain | markdown | json | yaml
```

公共模型允许非空字符串扩展，但没有注册对应 validator 的 target 必须在 Run 启动前返回 unsupported。

## 内置组合

| type | format | 约束 |
| --- | --- | --- |
| boolean | plain | 解码为 boolean，仅允许 If/While condition 使用。 |
| number | plain | 解码为有限 number。 |
| string | plain | 普通字符串。 |
| string | markdown | 非结构化 Markdown，不允许 layout。 |
| object | json/yaml | Schema 可选。 |
| array | json/yaml | Schema 可选。 |
| object | markdown | 必须 layout: outline 且提供 Schema。 |
| array | markdown | 必须 layout: table 且提供 Schema。 |

layout 是 Markdown format 的 option，不属于 Schema。object/array 省略 format 后会得到 plain，并因组合不支持而失败，系统不得按内容猜测格式。

## Schema

Schema v2 删除 `element_types`，并使用 Schema 形式的 `item/items` 取代旧字符串成员类型。它可以声明：

- fields：全部为必填结构字段，额外字段允许存在。
- type：不继承父层；显式声明优先，省略时有 fields 推断 object、无 fields 推断 string。
- format：显式声明优先，省略时继承父层；Markdown layout 只保留给兼容的 object outline 或 array table 节点，标量字段不继承 layout。
- 嵌套 Schema：约束对象子字段。
- item：约束 array 的唯一元素结构；每个元素都必须满足该 Schema。
- items：至少两个候选 Schema 组成的联合元素约束；每个元素至少满足一个候选，不表达 tuple。
- Repeat：只允许 object + markdown + layout: outline 使用。

`item/items` 互斥并要求所在 Schema 显式声明 `type: array`。array 不允许直接声明 fields；对象元素的 fields 位于 item/items 的 object Schema 中。省略 item/items 时只校验容器。

Markdown outline 的字段必须是 heading 节点并符合父子层级；列表项、粗体标签和键值文本不能冒充标题。Markdown table 的 item object 第一层字段必须成为列名，每一行解码为一个对象。

## Validator

三层 validator 使用相同最小接口：

```ts
export interface ArtifactValidator {
  validate(request: ArtifactValidationRequest):
    ArtifactValidationResult | Promise<ArtifactValidationResult>;
}
```

id、version、stage 和 target 属于 Registration。Registry 使用 `Map<stage, Map<target, registrations[]>>` 注册和直接查找，不遍历 validator，也不调用 supports。Run 编译时保存由 type、format、可选 schema 三层组成的 ValidationPlan。

Result 的 status 为 passed、failed 或 unsupported。Issue 必须包含稳定 code、stage、validator id、Artifact path、可选 contract/field path、actual、expected 和可操作 message。

## Report

`memsphere run report` 必须按 prepare、validate、commit 执行：

1. 一次性读取 inline 字符串或文件 bytes。
2. format decoder 产生判别联合 representation。
3. 依次执行 type、format、schema ValidationPlan。
4. 仅在全部通过后写入受管 Artifact、event、step 和 Run JSON。

校验失败必须零写入，允许用户在同一步修正后重报。成功 event 保存规范化 type、format、Schema snapshot、ValidationPlan 对应的结果和 final 元数据。

外部 Schema 在 Run 启动时快照，后续 Memory 修改不能改变正在执行的契约。`enter-schema` 是结构化 Markdown 的填写辅助流程，结束时必须组装真实 Markdown 并走同一 ValidationPlan，禁止写入 `schema:<name>` 占位内容绕过校验。

## 历史与迁移

v2 不兼容旧 `format: boolean/number/string/schema` 和 `Schema.format`。提供：

```bash
memsphere migrate artifact-contract-v2 --check
memsphere migrate artifact-contract-v2 --write
```

迁移由 config 定位目录，不依赖 Git。running v1 Run 必须阻断；done/archived v1 Run 和 Review snapshot 保持只读且不改写。新 Run 和 Review 只写 v2。

## 验收

- parser/serializer 覆盖默认 plain、简写、展开形式和非法 option。
- boolean、number、string、object、array type validator 有正反例。
- plain、Markdown、JSON、YAML format 有解码和失败诊断。
- JSON/YAML nested fields、array 容器、item/items 单契约与联合契约、Markdown outline/table、Repeat 有测试。
- `test/fixtures/artifact-format-validation/` 九组结构错误全部稳定失败。
- report 失败前后 Run JSON 和 artifacts 目录字节级不变，修正后只产生一次成功 event。
- View 展示 type、format、layout、Schema、final、validation 和 v1 只读状态。

## 验收结果

- Artifact Contract 已按 `type -> format -> schema` 实现，内置类型、格式和递归 Schema 校验已接入 Run report。
- v1 迁移器、只读兼容、View 展示和九组格式错误 fixture 均有自动化覆盖。
- 主要实现提交包括 `ab30755`、`85e4c6f` 和 `5ff96d0`。
- 2026-07-20 全量测试通过：202 passed，0 failed。
