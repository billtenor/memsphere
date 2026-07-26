---
id: 20260712-memsphere-type-system
type: feature
created: 2026-07-12
completed_at: 2026-07-12
run_id:
---

# memsphere 类型系统

## Memory AST

Memory 根节点由 YAML tag 区分：Concept、Statement、Schema 和 Procedure。`defines` 可以包含 string、Statement 或 Schema。Procedure flow 可以包含 Action、If、While 和 Call。

Schema 负责当前值的局部契约与结构：可选 type/format、fields、嵌套 Schema 和 Repeat。

## Artifact AST

Artifact 是 Procedure Action 的交付契约：

```ts
type ArtifactNode = {
  tag: "!artifact";
  name: string;
  type: string;
  format: {
    name: string;
    options: Readonly<Record<string, unknown>>;
  };
  schema?: string | SchemaNode;
  final?: boolean;
};
```

源 YAML 可以省略 format，内部始终规范化为 plain。复杂格式参数统一放在 FormatSpec 中，避免以后新增图像、音视频格式时继续向 Artifact 根节点堆叠字段。

## 内置类型与格式

| type | plain | markdown | json | yaml |
| --- | --- | --- | --- | --- |
| boolean | 是 | 否 | 否 | 否 |
| number | 是 | 否 | 否 | 否 |
| string | 是 | 是，无 layout | 否 | 否 |
| object | 否 | outline + Schema | 是 | 是 |
| array | 否 | table + Schema | 是 | 是 |

type 与 format 使用开放字符串，内置 parser 只对已知组合做静态约束；Run contract compiler 通过 Registry 解析全部 target，没有 validator 时拒绝启动。

## Schema 类型

`fields` 的成员可以是字段名、带名称的嵌套 Schema 或 Repeat。字段全部必填，额外字段允许存在。字符串简写的 type 固定为 string，format 继承所在 Schema 的表达介质。

Schema type 不继承父层：显式 type 优先；省略 type 时，有 fields 推断为 object，没有 fields 推断为 string。array、number 和 boolean 因此必须显式声明。Schema format 省略时继承父 Schema，根 Schema 继承 Artifact；显式 format 覆盖继承值。Markdown layout 只在类型兼容时继承：object 保留 outline、array 保留 table，标量字段只继承 markdown name 并移除 layout。根 Schema 的推断 type 和有效 format 必须与 Artifact 根契约一致。

Artifact 根值仍遵循上表的内置组合。Schema 子字段位于父级 JSON/YAML/Markdown 表达中，因此标量字段可以继承 json、yaml 或无 layout 的 markdown；这表示字段所在的编码上下文，不是放宽 Artifact 根格式。

array Schema 使用 `item` 指向唯一元素 Schema，或使用 `items` 保存至少两个候选 Schema 形成联合元素契约。每个元素按完整 type、format、schema 链路递归校验；`items` 按候选匹配，不表达 tuple。`item/items` 互斥并要求显式 `type: array`。array 不直接声明 fields；对象行的 fields 属于 item/items 中的 object Schema。省略 item/items 时只校验数组容器。旧 `element_types` 与字符串 items 由迁移器转换。

Repeat 的 body 是一组 string/Schema 字段，limit 可以声明 min/max。Repeat 仅用于 object Markdown outline；不允许嵌套。

## 运行时表示

Format decoder 把原始 bytes 转成判别联合：

```ts
type ArtifactRepresentation =
  | { kind: "plain"; value: unknown }
  | { kind: "json" | "yaml"; value: unknown }
  | { kind: "markdown"; value: unknown; ast: MarkdownDocument };
```

plain boolean/number 解码为真实值。JSON/YAML 保留结构化值。Markdown string 保留文本；outline 产生 object 语义并校验 heading tree；table 解码为对象数组并校验表头和行结构。递归执行器先编译每层有效契约，再从结构化值或 Markdown heading subtree 派生局部 Candidate，逐层执行 type、format、schema validator。

## 扩展

Validator 实现只提供 validate。Registration 声明 id、version、stage 和 target，Registry 负责注册、冲突检查、静态路由和 ValidationPlan。外部 TypeScript 代码可以通过包导出注册 validator；本阶段不提供动态 npm 包发现、加载和沙箱。

所有可写 Run 只使用 v2 AST。v1 Memory 通过迁移器升级，v1 Run/Review 仅通过只读 adapter 展示。

## 验收结果

- 已实现 Memory、Artifact、Schema、Flow 和 Repeat 的类型结构及递归校验。
- parser、serializer、Run 和 View 均已接入当前类型模型。
- 对应实现可追溯至 `6b9a0db` 及后续 Artifact Contract v2、Schema Repeat 提交。
- 2026-07-20 全量测试通过：202 passed，0 failed。
