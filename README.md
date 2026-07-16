memsphere
========

`memsphere` is a TypeScript CLI for managing local, YAML-backed memory entities for AI runtimes.

The first MVP focuses only on domain entity abstraction and local persistence:

- `!procedure`
- `!concept`
- `!statement`
- `!schema`

The current MVP uses directory scopes before richer scope modeling exists.

## Install

```bash
npm install
npm run build
```

During development, run the CLI with:

```bash
npm run dev -- <command>
```

After building:

```bash
node dist/cli.js <command>
```

## Commands

```bash
memsphere init
memsphere init --global
memsphere init --folder ./some-folder
memsphere validate
memsphere memory list
memsphere memory list --kind concepts --query Memory
memsphere memory list --output json
memsphere memory read concepts/Memory
memsphere memory read 记忆 --kind concepts
memsphere memory read Memory --output json
memsphere view
```

`memory list` discovers memories through stable logical references rather than file paths. YAML and JSON list items include `names`, prose `defines`, and counts of folded structured definitions as compact discovery metadata, analogous to a Skill's name and description; `--output text` remains compact. `memory read` accepts a logical reference, canonical name, or alias and returns the complete tagged memsphere YAML by default.

`view` starts a local read-only memory browser:

```bash
memsphere view
```

The browser renders schemas as progressive disclosure sections. `format: table` schemas render their child `fields` as table columns. Procedures render `flow` as readable steps, with visual blocks for `!action`, `!if`, `!while`, and `!call`. Recursive `elseif: !if` values are displayed as a flat if/elseif/else chain.

`init` defaults to the current git repository scope. It creates `.memsphere/` in the git root:

```text
<git-root>/.memsphere/config.json
<git-root>/.memsphere/memory/
  procedures/
  concepts/
  statements/
  schemas/
<git-root>/.memsphere/reviews/
<git-root>/.memsphere/runs/
<git-root>/.memsphere/archives/
```

Use `memsphere init --global` for `~/.memsphere`, or `memsphere init --folder <path>` for `<path>/.memsphere`.

At runtime, `memsphere` starts at the current directory and walks upward looking for `.memsphere/config.json`. If none is found, it tries the global `~/.memsphere/config.json`.

The config file stores roots relative to the `.memsphere` directory by default:

```json
{
  "memoryRoot": "memory",
  "reviewsRoot": "reviews",
  "runsRoot": "runs",
  "archiveRoot": "archives"
}
```

Set `archiveRoot` to an absolute path when multiple scopes should share archived runs and reviews.

## YAML DSL

Entity type is represented by the YAML document root tag. There is no `type` field.

The authoring type system has three primitive types (`string`, `number`, and `boolean`), fixed tagged struct types, and the `List<T>` generic extension. Mappings that represent memory structures must carry their registered YAML tag; the validator does not infer a struct type from its fields.

`defines` has type `List<string | Statement | Schema>`. Use strings for concise definitions, embedded `!statement` values for assertions, and embedded `!schema` values for explicit structure. Embedded Statement and Schema values may be anonymous.

### Procedure

```yaml
!procedure
names:
  - DiagnoseBug
  - DebugIssue
defines:
  - 从异常现象中定位最可能的根因，并给出可验证的修复方向。
asserts:
  - 诊断结论必须由可核查的证据支持。
goals:
  - 找到最可能的根因。
flow:
  - !action
    action: 确认用户观察到的异常现象和问题边界。
    actor: human
    artifact: !artifact
      name: 问题边界
      format: markdown
  - !if
    condition: !action
      action: 判断问题是否可以稳定复现。
      artifact: !artifact
        name: 问题是否可以稳定复现
        format: boolean
    then:
      - !action
        action: 阅读错误日志、失败测试或异常堆栈。
        artifact: !artifact
          name: 错误证据
          format: markdown
    elseif: !if
      condition: !action
        action: 判断是否还缺少复现信息。
        artifact: !artifact
          name: 是否缺少复现信息
          format: boolean
      then:
        - !action
          action: 收集缺失的复现信息。
          artifact: !artifact
            name: 补充复现信息
            format: markdown
    else:
      - !action
        action: 记录当前无法复现。
        artifact: !artifact
          name: 无法复现说明
          format: string
  - !call
    target: SummarizeFix
```

Procedure `asserts` are global constraints that remain active throughout the Run. Action `asserts` apply only to their own step. `flow` has type `List<Action | If | While | Call>`. An Action always contains `artifact: !artifact`. If and While conditions are Actions whose artifact format is `boolean`. `elseif` is an optional single nested `!if`, not a list, and only the root If in a chain may contain `else`.

### Concept

```yaml
!concept
names:
  - Customer
  - Buyer
extends:
  - Account
defines:
  - 已完成企业实名认证，并且至少有一次成功交易记录的 B 端客户。
  - !statement
    asserts:
      - 一个 Customer 必须属于一个 Account。
```

### Statement

```yaml
!statement
names:
  - CustomerTenantRule
defines:
  - 这是一组关于 Customer 和 Tenant 关系的命题。
asserts:
  - 一个 Customer 必须且只能属于一个 Tenant。
suggests:
  - Customer 的展示名称应优先使用经过人工确认的名称。
```

`asserts` 表达可判断的事实、规则或约束。`suggests` 表达非强制的建议或优先性指导；它可省略，省略时解析为一个空列表。

### Schema

```yaml
!schema
names:
  - Requirements Document
  - 需求文档
format: outline
defines:
  - 用于收敛用户场景、需求边界、原型引用和业务验收口径的文档图式。
asserts:
  - 不负责工程 capability 划分，也不展开详细技术方案。
fields:
  - 摘要
  - !schema
    names:
      - 需求概述
    defines:
      - 描述需求来源、目标用户、核心问题和成功标准。
    fields:
      - !schema
        names:
          - 背景
        defines:
          - 说明需求来源、业务背景和为什么现在需要解决。
```

`Schema.fields` has type `List<string | Schema>`. A string is the shortest field form and only supplies the field name. A nested `!schema` supplies richer descriptions, assertions, item types, or child fields, and must have a non-empty `names` value when used in `fields`.

`Schema.element_types` describes `List<T>`. Its non-empty entries are the allowed element types. For example, `element_types: [string]` means `List<string>` and `element_types: [string, Statement, Schema]` means `List<string | Statement | Schema>`.

`!schema` may include an optional presentation `format`. Missing format means `outline`.

Supported formats:

```yaml
format: outline
format: table
```

`outline` renders nested fields as a heading hierarchy. `table` renders fields as columns and must explicitly describe a list of Schema rows:

```yaml
!schema
names:
  - 需求清单
format: table
element_types:
  - Schema
fields:
  - ID
  - 需求描述
```

The removed formats `section`, `field`, `list`, and `template` are invalid. Structural level is expressed by `fields`, list cardinality by `element_types`, and Schema itself already serves as the template.

## Persistence Rules

Each file contains exactly one memory entity. File names should use the entity's primary name.

```text
procedures/DiagnoseBug.yaml
concepts/Customer.yaml
statements/CustomerTenantRule.yaml
schemas/RequirementsDocument.yaml
```

The directory determines the expected root tag:

```text
procedures/ -> !procedure
concepts/ -> !concept
statements/ -> !statement
schemas/ -> !schema
```
