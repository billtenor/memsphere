# Memsphere 类型系统设计草案

状态：已实现（结构类型层）

创建日期：2026-07-12

## 背景

Memsphere 中的记忆不一定能只靠自然语言准确解释。一个概念可能还需要通过命题说明哪些内容应当成立，并通过图式描述自身的结构。

当前实现将 `defines` 限定为 `string[]`。YAML 解析器已经能够识别 `defines` 中嵌套的 YAML tag，但结构校验会将带 tag 的对象拒绝，并报告 `Expected string, received object`。

本文提出一套小型的内置类型系统，用于支持带 tag 的嵌套结构和递归校验。该类型系统不支持用户任意定义新的结构体类型。

## 核心模型

Memsphere 中的类型只分为两类：

```text
Type = Primitive | Struct
```

在这两类类型之上，memsphere 支持 `List<T>` 泛型扩展。List 不是第三类类型，而是接收一个元素类型并产生列表类型的泛型类型构造器。

### 基本类型

Memsphere 支持三种基本类型：

```text
string
number
boolean
```

`markdown`、`yaml` 和 `json` 是内容格式或序列化格式，不是额外的基本类型。

Artifact 的数值格式统一使用 `number`。旧 `int` 不再兼容，存量 YAML 通过一次性迁移升级。

### List 泛型扩展

当前类型系统只支持一种泛型扩展：`List<T>`。YAML sequence 表示 List 值，具体字段决定其元素类型 `T`。

例如：

```text
names   = List<string>
asserts = List<string>
fields  = List<string | Schema>
flow    = List<Action | If | While | Call>
```

List 可以作用于基本类型、结构体类型或它们的联合，例如 `List<string>`、`List<string | Schema>` 和 `List<Action | If | While | Call>`。当前不支持 Map、Tuple 或用户自定义泛型。

### 内置结构体类型

结构体类型由 memsphere 预先注册，并通过 YAML tag 标记。用户不能声明任意的新结构体类型。

记忆结构体类型及其 YAML tag：

```text
Concept   -> !concept
Statement -> !statement
Schema    -> !schema
Procedure -> !procedure
```

Procedure flow 结构体类型及其 YAML tag：

```text
Action -> !action
If    -> !if
While -> !while
Call  -> !call
```

Procedure 产物结构体类型及其 YAML tag：

```text
Artifact -> !artifact
```

类型名用于类型定义和校验规则，YAML tag 只负责表示该类型在 YAML 中的写法。每个类型都有一套 validator 已知的固定字段结构，未注册的 tag 属于非法类型。

## 预置类型总览

以下类型和泛型扩展构成当前提案中的完整用户编写类型集合：

| 类别 | 类型 | YAML 写法或说明 |
| --- | --- | --- |
| 基本类型 | `string` | YAML string |
| 基本类型 | `number` | YAML number |
| 基本类型 | `boolean` | YAML boolean |
| 记忆结构体 | `Concept` | `!concept` |
| 记忆结构体 | `Statement` | `!statement` |
| 记忆结构体 | `Schema` | `!schema` |
| 记忆结构体 | `Procedure` | `!procedure` |
| Flow 结构体 | `Action` | `!action` |
| Flow 结构体 | `If` | `!if` |
| Flow 结构体 | `While` | `!while` |
| Flow 结构体 | `Call` | `!call` |
| 产物结构体 | `Artifact` | `!artifact`，作为 `Action.artifact` 的值 |
| 泛型扩展 | `List<T>` | YAML sequence；当前唯一支持的泛型扩展 |

`DefinitionPart` 是一个联合类型别名，用于描述字段允许的类型集合，不是用户能够单独实例化的新结构体类型。Procedure flow 直接使用真实类型联合，不额外引入 `FlowNode` 类型。

## 带 Tag 的嵌套结构

当一个结构化值出现在异构列表或嵌套位置时，必须携带已注册的 YAML tag。Validator 不应根据任意字段组合猜测对象类型。

例如，`defines` 是由多种定义片段组成的列表：

```text
DefinitionPart = string | Statement | Schema
defines = List<DefinitionPart>
```

示例：

```yaml
!concept
names:
  - Concept
  - 概念
defines:
  - 用于沉淀稳定词汇和领域抽象的记忆实体。

  - !statement
    asserts:
      - 一份 Concept 应当围绕一个稳定词汇或领域抽象建立定义。

  - !schema
    format: outline
    fields:
      - !schema
        names:
          - names
        element_types:
          - string
        defines:
          - Concept 的规范名称与别名。
```

字符串、匿名 Statement（写作 `!statement`）和匿名 Schema（写作 `!schema`）是定义同一个父实体的三种表达方式，不需要额外引入 `facets` 字段。

`defines` 不接受 `!concept`，Concept 之间的关系使用 `extends` 表达。`defines` 也不接受 `!procedure`，可执行流程通过 Procedure flow 和 `!call` 组合。

## 顶层实体与匿名结构

顶层记忆文档必须具有非空 `names`，以便被索引、引用、导入和 review。

嵌套在其他记忆中的带 tag 结构属于匿名结构。它的 `names` 和 `defines` 可以省略或为空，由 YAML tag 及其在父节点中的位置确定身份。

匿名结构仍然必须包含有意义的类型专属内容：

- 匿名 Statement 必须至少包含一条 assertion。
- 匿名 Schema 必须至少包含 `format`、`asserts`、`element_types` 或 `fields` 等有效结构信息。
- 匿名结构不进入全局记忆名称索引。

## 字段放置规则

父字段决定其中允许出现的子节点类型：

```text
defines = List<string | Statement | Schema>
fields  = List<string | Schema>
element_types   = List<TypeReference>
flow    = List<Action | If | While | Call>
```

`Schema.fields` 中的字符串表示只有字段名的最简字段；需要定义、断言、元素类型或子字段时，使用带 `!schema` tag 的详细字段。作为 field 使用的 Schema 必须具有非空 `names`。

`Schema.element_types` 表达 `List<T>` 的元素类型联合。TypeReference 可以引用已注册的基本类型或结构体类型。例如 `element_types: [string]` 表示 `List<string>`，`element_types: [string, Statement, Schema]` 表示 `List<string | Statement | Schema>`。

Procedure flow 节点只能出现在 flow 中：

- `!action`、`!if`、`!while` 和 `!call` 不能出现在 `defines` 或 `fields` 中。
- `!statement` 和 `!schema` 不能作为 Procedure flow 节点，除非未来标准明确增加这种能力。

`Procedure.asserts` 是可选的非空 `List<string>`，用于声明选择和执行整个流程时持续生效的全局约束。`Action.asserts` 只约束所属步骤，不能替代 Procedure 级断言。

## 递归 If 与 Elseif

`condition`、`then`、`elseif` 和 `else` 都是 If 的字段。`elseif` 不是 List，也不对应独立的 ElseIf 类型；它的字段类型仍然是 If。

```text
If {
  condition: Action
  then: List<Action | If | While | Call>
  elseif?: If
  else?: List<Action | If | While | Call>
}
```

YAML 中通过 `elseif: !if` 递归构造条件链：

```yaml
- !if
  condition: !action
    action: 判断条件 A。
    artifact: !artifact
      name: 条件 A
      format: boolean
  then:
    - !action
      action: 执行 A。
      artifact: !artifact
        name: A 结果
        format: string
  elseif: !if
    condition: !action
      action: 判断条件 B。
      artifact: !artifact
        name: 条件 B
        format: boolean
    then:
      - !action
        action: 执行 B。
        artifact: !artifact
          name: B 结果
          format: string
    elseif: !if
      condition: !action
        action: 判断条件 C。
        artifact: !artifact
          name: 条件 C
          format: boolean
      then:
        - !action
          action: 执行 C。
          artifact: !artifact
            name: C 结果
            format: string
  else:
    - !action
      action: 执行默认逻辑。
      artifact: !artifact
        name: 默认结果
        format: string
```

执行时从根 If 开始依次检查 condition。某个 condition 为 true 时执行对应 then 并结束；全部 condition 都为 false 时执行根 If 的 else。

为避免 fallback 语义歧义，`else` 只允许出现在整条 If 链的根节点。作为 `elseif` 值嵌套的 If 只能包含 `condition`、`then` 和下一个 `elseif`。

View 可以把递归结构展平显示成 `if / elseif / elseif / else`，不必按 YAML 嵌套层级呈现。

## 字段关系与结构体类型

字段名和 YAML tag 承担不同职责：字段名说明一个值在父结构中的关系，YAML tag 说明这个值的类型。两者不能互相替代。

Action 的 `artifact` 字段要求一个 Artifact 值，因此规范写法是：

```yaml
flow:
  - !action
    action: 判断输入是否完整。
    actor: agent
    artifact: !artifact
      name: 输入是否完整
      format: boolean
```

其中：

- `artifact` 表示该值是 Action 的产物字段。
- `!artifact` 表示该字段值使用 Artifact 结构体校验。

不能省略字段名，直接把 `!artifact` 写成 Action mapping 中的成员，因为 YAML tag 不能代替 mapping key，解析器也无法判断该值与 Action 的关系。

Artifact 的结构为：

```text
Artifact {
  name: string
  format: string
  schema?: string
}
```

当 `format` 为 `schema` 时，`schema` 字段必须存在，并引用一个 Schema。

无 tag action、无 tag artifact、`int`、elseif 数组、标量 `!call`、`!elseif` 和 `!else` 均为非法语法。Validator 不提供运行时兼容入口；存量内容必须升级后再使用。

## 格式与类型的区别

Artifact format 和 Schema format 不属于新的基本类型或结构体类型。

Artifact format 示例：

```text
markdown = 以 Markdown 表达的 string 内容
yaml     = 以 YAML 序列化的 string 内容
json     = 以 JSON 序列化的字符串或结构化内容
schema   = 受某个 !schema 记忆约束的值
```

Schema format 只描述最终呈现形态：`outline` 将嵌套 fields 呈现为多级标题，`table` 将 fields 呈现为列。省略 format 时默认使用 `outline`。旧 `section`、`field`、`list` 和 `template` 不再兼容；结构层级由 fields 表达，列表类型由 element_types 表达。

## 校验模型

Validator 应递归执行以下步骤：

1. 解析 YAML，并保留所有已注册的 YAML tag。
2. 根据 tag 确定结构体类型。
3. 校验该结构体的固定字段和基本类型值。
4. 根据父字段规则校验列表中的每个元素。
5. 根据上下文校验顶层实体或匿名结构的要求。
6. 拒绝未知 tag，以及异构位置中没有类型标记的结构化值。
7. 在独立的语义校验阶段解析具名引用，并校验引用目标的记忆类型。

需要进行类型检查的引用包括：

```text
extends         -> Concept
Call.target     -> Procedure
Artifact.schema -> Schema
```

## 实现状态

当前结构类型层已经完成：

- YAML parser 保留并识别所有内置结构 tag。
- Memory AST 和 validator 按父字段递归校验联合类型、匿名结构和固定字段。
- Procedure run harness 支持 Action、Artifact、递归 If、While、Call 和 Schema 字段简写。
- View 能呈现混合 `defines`、字符串 Schema field，并将递归 If 展平显示。
- 存量 memory、reserved memory、skills 和测试示例已升级到新语法。
- 旧语法通过负向测试明确拒绝，不保留运行时兼容分支。

具名引用是否存在、引用环等跨实体规则属于后续语义校验层，不由本文已经实现的结构类型 validator 负责。

## 非目标

本文不计划引入：

- 用户自定义结构体类型。
- 对异构列表中的无 tag 对象进行类型推断。
- 允许所有结构体出现在任意字段中。
- 一套通用编程语言级别的完整类型系统。

目标模型应保持克制：类型只有基本类型和结构体类型两类，并在其上提供当前唯一的泛型扩展 `List<T>`。
