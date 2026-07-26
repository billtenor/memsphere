---
id: 20260717-schema-repeat
type: feature
created: 2026-07-17
completed_at: 2026-07-18
run_id:
---

# Schema `!repeat` 动态字段语法需求

## 背景

Memsphere 当前使用 `Schema.fields` 描述一组有序字段。每个成员都是字符串或 `!schema`，其数量在 YAML 中固定，因此只能表达静态字段列表。

部分文档结构包含数量由实际内容决定、但每一项具有相同 Schema 的字段组。例如技术设计文档的“关键决策”部分可能包含决策 1、决策 2、决策 3 等任意数量的决策，每个决策都需要填写结论、问题描述、备选方案和选择理由。

如果预先在 Schema 中写死若干“决策”字段，会产生以下问题：

- Schema 无法准确表达实际决策数量。
- 数量不足时需要临时突破 Schema，数量过多时会留下空字段。
- 相同的子 Schema 需要重复书写。
- 动态字段与前后的固定字段无法通过现有类型明确组合。

本需求为 `Schema.fields` 增加 `!repeat` 结构控制节点，用于在固定字段列表中声明一个可按需重复的字段组。

## 目标

1. 支持在 `Schema.fields` 中声明数量动态的字段组。
2. 支持固定字段与动态字段按原有顺序混合。
3. 允许为重复次数声明可选的最小值和最大值硬约束。
4. 保持 `!repeat` 与 `!schema` 的职责分离：前者只控制重复，后者继续描述字段内容与呈现方式。
5. 保证现有不包含 `!repeat` 的 Schema YAML 完全兼容。

## 非目标

- 不引入用户自定义泛型或任意集合类型。
- 不为重复实例增加标题模板、变量插值或表达式语法。
- 不在 `!repeat` 上增加 `names`、`format`、`defines`、`asserts`、`element_types` 或 `fields`。
- 不使用自然语言自动推导 `limit`；未声明限制时由执行者根据内容决定实际重复次数。
- 本轮不支持 `!repeat` 直接嵌套另一个 `!repeat`。
- 本轮不定义 `format: table` 的动态列或动态行语义。

## 核心类型

`Schema.fields` 从原来的静态字段联合扩展为：

```text
SchemaField = string | Schema | Repeat

Repeat {
  limit?: RepeatLimit
  body: List<string | Schema>
}

RepeatLimit {
  min?: number
  max?: number
}
```

`Repeat` 是 Schema 字段列表中的结构控制节点，不是 Memory 类型，也不是 Schema 类型。它不进入 Memory Catalog，不能作为顶层 Memory，也不能被名称引用。

从文法角度看，`!repeat` 表达对 `body` 整体的重复量词：

```text
无 limit                 body*
limit.min = 1           body+
min = 1, max = 5        body{1,5}
```

## YAML 语法

### 无数量约束

`limit` 可以省略，`body` 必填：

```yaml
- !repeat
  body:
    - !schema
      names:
        - 决策
      fields:
        - !schema
          names:
            - 结论
        - !schema
          names:
            - 问题描述
        - !schema
          names:
            - 备选方案
        - !schema
          names:
            - 选择理由
```

省略 `limit` 表示允许重复零次或任意多次。

### 有数量约束

`limit` 使用 `min` 和 `max` 描述整个 `body` 的重复次数：

```yaml
- !repeat
  limit:
    min: 1
    max: 5
  body:
    - !schema
      names:
        - 决策
      fields:
        - !schema
          names:
            - 结论
        - !schema
          names:
            - 问题描述
```

`limit` 只表示结构上的硬限制。“建议包含 3 至 5 项”之类的软性写作要求仍应写入所属 `!schema` 的 `asserts`。

### 固定字段与动态字段混合

`!repeat` 与普通字段都是 `fields` 的成员，因此它们的相对顺序具有语义：

```yaml
!schema
names:
  - 技术设计文档
format: outline
fields:
  - !schema
    names:
      - 设计摘要

  - !schema
    names:
      - 关键决策
    asserts:
      - 应覆盖方案中所有必须拍板的关键技术选择。
    fields:
      - !repeat
        limit:
          min: 1
        body:
          - !schema
            names:
              - 决策
            fields:
              - !schema
                names:
                  - 结论
              - !schema
                names:
                  - 问题描述
              - !schema
                names:
                  - 备选方案
              - !schema
                names:
                  - 选择理由
              - !schema
                names:
                  - 影响与代价
              - !schema
                names:
                  - 待确认项

  - !schema
    names:
      - 方案总览
```

该 Schema 的结构顺序为：一个固定的“设计摘要”、一个或多个动态“决策”、一个固定的“方案总览”。每个“决策”实例都完整复用其内部字段结构。

### 重复字段组

`body` 可以包含多个字段。此时重复单位是整个 `body`，而不是分别重复其中每个成员：

```yaml
- !repeat
  limit:
    min: 1
    max: 3
  body:
    - !schema
      names:
        - 输入
    - !schema
      names:
        - 输出
```

其结构语义是重复 `(输入, 输出)` 这一有序字段组一至三次。

## 字段与校验规则

### `!repeat`

- `!repeat` 必须写成带 tag 的 YAML mapping。
- 只允许 `limit` 和 `body` 两个字段。
- `body` 必填，必须是非空 YAML sequence。
- `body` 成员使用现有静态 Schema field 语法，只允许非空字符串或带 `!schema` tag 的 Schema。
- `body` 成员顺序必须保留。
- `!repeat` 只允许直接出现在 `Schema.fields` 中。
- 第一版禁止在 `body` 中继续出现 `!repeat`。
- `!repeat` 不能出现在 `defines`、`sections`、Procedure `flow` 或其他不接受 Schema field 的位置。
- `!repeat` 不能直接作为 `format: table` Schema 的字段；动态表格行列语义需要另行设计。

### `limit`

- `limit` 可选；出现时必须是 mapping。
- `limit` 只允许 `min` 和 `max`。
- `min`、`max` 出现时必须是大于或等于 0 的整数。
- `limit` 出现时，`min` 和 `max` 至少填写一个。
- 只填写 `min` 时，最大次数不受限制。
- 只填写 `max` 时，最小次数默认为 0。
- 同时填写时必须满足 `min <= max`。
- 精确重复 N 次通过 `min: N` 与 `max: N` 表达。
- 不引入 `unbounded`、`*` 或 `null` 等特殊上限值；省略 `max` 即表示不设上限。
- `limit` 约束的是整个 `body` 的展开次数，不是 `body` 的成员数，也不是生成内容的字符长度。

## 展开与实例语义

- 执行者根据实际内容决定 `!repeat` 的展开次数，并且必须满足 `limit`。
- 每次迭代按顺序完整执行或填写一次 `body`。
- 不同迭代是不同实例，不能共享填写结果。
- 内部 `!schema.names` 描述重复模板的字段名称，不需要为每个实例在 YAML 中预先生成“决策 1”“决策 2”等名称。
- Run、View 或其他消费者需要区分实例时，应使用从 1 开始的迭代序号形成稳定路径，例如 `关键决策.决策[1].结论`。
- `!repeat` 自身不生成标题、字段值或 Artifact；实际内容全部由 `body` 中的字段产生。

## 与现有类型系统的关系

- `!repeat` 是 `Schema.fields` 的结构控制节点，不是 `List<T>` 泛型，也不应加入 `Schema.element_types` 的可选类型集合。
- `element_types` 继续描述 Schema 所表示内容的元素类型，不描述 Schema 作者使用了哪些控制节点。
- 当 `fields` 包含 `!repeat` 时，其中的 `body` 仍按现有 Schema field 规则递归校验。
- Serializer、Run snapshot、Review snapshot 和 View 必须保留 `!repeat` 的 tag、`limit` 与 `body`，不能在解析后丢失控制结构。

## 非法语法示例

### 直接使用 sequence

`!repeat` 统一使用 mapping 形式。以下早期简写不再支持：

```yaml
- !repeat
  - !schema
    names:
      - 决策
```

### 缺少 body

```yaml
- !repeat
  limit:
    min: 1
```

### 空 limit

```yaml
- !repeat
  limit: {}
  body:
    - !schema
      names:
        - 决策
```

### 非法范围

```yaml
- !repeat
  limit:
    min: 5
    max: 1
  body:
    - !schema
      names:
        - 决策
```

### 在 Repeat 上放置 Schema 字段

```yaml
- !repeat
  names:
    - 决策
  format: outline
  body:
    - !schema
      names:
        - 决策
```

`names` 和 `format` 必须属于 `body` 中的 `!schema`，不能属于 `!repeat`。

## 实现影响范围

至少需要检查和修改：

- YAML custom tag 注册与 tagged mapping 解析。
- Memory AST 中的 `SchemaField` 联合类型。
- Schema 的递归结构校验与错误路径。
- YAML serializer 与 round-trip 测试。
- Schema Run 的展开、迭代路径和 `limit` 执行。
- View 对 `!repeat`、`limit` 和 `body` 的展示。
- Run snapshot、Review snapshot 与 Schema 引用遍历。
- Reserved Memory 中对 Schema 类型和字段规则的定义。
- Memory authoring skill 与 README 中的 Schema 语法说明。

## 兼容性与迁移

- 现有 `Schema.fields` 中的字符串与 `!schema` 写法保持不变。
- `!repeat` 是新增的可选语法；旧 Schema 不需要迁移。
- 不接受直接 tagged sequence 的 `!repeat` 历史形态，避免长期维护两套等价语法。
- 已经通过手工复制多个同构字段模拟动态列表的 Schema，可以在功能实现后按需迁移为 `!repeat`。

## 验收标准

### Parser 与 validator

- 能解析只有 `body` 的合法 `!repeat`。
- 能解析同时包含 `limit` 和 `body` 的合法 `!repeat`。
- 能在同一 `fields` 中按顺序解析固定字段、`!repeat` 和后续固定字段。
- 能解析包含多个字段的 `body`，并将整个 `body` 识别为重复单位。
- 能拒绝 sequence 形态的 `!repeat`、缺失或为空的 `body`、空 `limit`、负数、小数以及 `min > max`。
- 能拒绝 `!repeat` 的未知字段，以及错误位置中的 `!repeat`。
- 能拒绝第一版不支持的嵌套 `!repeat` 和 table 直接字段中的 `!repeat`。
- 校验错误包含准确路径，例如 `fields[2].limit.min` 或 `fields[2].body[1]`。

### 序列化与读取

- 合法 YAML 经过 parse/serialize round trip 后保留 `!repeat` tag、字段顺序、`limit` 和 `body`。
- Memory read、View、Review snapshot 和 Run snapshot 不丢失 `!repeat`。

### 执行语义

- 省略 `limit` 时允许零次或任意多次展开。
- 只声明 `min` 时，执行者不能在达到最小次数前结束重复。
- 声明 `max` 时，执行者不能创建超过最大次数的实例。
- 每次迭代完整处理一次 `body`，并以稳定序号区分不同实例。
- `!repeat` 前后的固定字段只执行或填写一次，且顺序不变。

### 文档

- README 和 Memory authoring skill 说明 `!repeat` 的合法位置、`limit` 默认值与 `body` 整体重复语义。
- 至少提供一个“关键决策”完整示例，以及固定字段和动态字段混合的示例。

## 验收结果

- 已实现 `!repeat` AST、YAML parser、validator、serializer、Memory navigation、Run 展开和 View 展示。
- limit、非法位置、禁止嵌套、稳定实例路径及 `memsphere run repeat` 均有自动化测试。
- 主要实现提交为 `9b3db5a`。
- 2026-07-20 全量测试通过：202 passed，0 failed。
