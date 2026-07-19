# memsphere 类型系统

## Memory AST

Memory 根节点由 YAML tag 区分：Concept、Statement、Schema 和 Procedure。`defines` 可以包含 string、Statement 或 Schema。Procedure flow 可以包含 Action、If、While 和 Call。

Schema 负责结构：fields、element_types、嵌套 Schema 和 Repeat。Schema 不负责实例编码或呈现格式。

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

`fields` 的成员可以是字段名、带名称的嵌套 Schema 或 Repeat。字段全部必填，额外字段允许存在。`element_types` 表达列表允许的元素类型。

Repeat 的 body 是一组 string/Schema 字段，limit 可以声明 min/max。Repeat 仅用于 object Markdown outline；不允许嵌套。

## 运行时表示

Format decoder 把原始 bytes 转成判别联合：

```ts
type ArtifactRepresentation =
  | { kind: "plain"; value: unknown }
  | { kind: "json" | "yaml"; value: unknown }
  | { kind: "markdown"; value: unknown; ast: MarkdownDocument };
```

plain boolean/number 解码为真实值。JSON/YAML 保留结构化值。Markdown string 保留文本；outline 产生 object 语义并校验 heading tree；table 解码为对象数组并校验表头和行结构。

## 扩展

Validator 实现只提供 validate。Registration 声明 id、version、stage 和 target，Registry 负责注册、冲突检查、静态路由和 ValidationPlan。外部 TypeScript 代码可以通过包导出注册 validator；本阶段不提供动态 npm 包发现、加载和沙箱。

所有可写 Run 只使用 v2 AST。v1 Memory 通过迁移器升级，v1 Run/Review 仅通过只读 adapter 展示。
