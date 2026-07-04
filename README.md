vibe-mem
========

`vibe-mem` is a TypeScript CLI for managing local, YAML-backed memory entities for AI runtimes.

The first MVP focuses only on domain entity abstraction and local persistence:

- `!procedure`
- `!concept`
- `!statement`
- `!schema`

Scopes are intentionally out of scope for this version.

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
vibe-mem init
vibe-mem validate
vibe-mem list
vibe-mem view
vibe-mem list procedures
vibe-mem list concepts
vibe-mem list statements
vibe-mem list schemas
```

`view` starts a local read-only memory browser:

```bash
vibe-mem view
```

The browser renders schemas as progressive disclosure sections. `format: table` schemas render their child `fields` as table columns. Procedures render `flow` as readable steps, with visual blocks for `!if`, `!elseif`, `!else`, `!while`, and `!call`.

`init` creates:

```text
~/.vibe-mem/config.json
~/.vibe-mem/memory/
  procedures/
  concepts/
  statements/
  schemas/
```

The config file stores the memory root:

```json
{
  "memoryRoot": "~/.vibe-mem/memory"
}
```

## YAML DSL

Entity type is represented by the YAML document root tag. There is no `type` field.

Semantic-bearing fields are arrays. Each item should be one independently reviewable memory unit.

### Procedure

```yaml
!procedure
names:
  - DiagnoseBug
  - DebugIssue
defines:
  - 从异常现象中定位最可能的根因，并给出可验证的修复方向。
goals:
  - 找到最可能的根因。
flow:
  - 确认用户观察到的异常现象和问题边界。
  - 建立最小可复现路径。
```

`flow` may also contain tagged control steps from the memory DSL. The first version parses and validates them as structured flow items, without interpreting execution semantics:

```yaml
flow:
  - 确认用户观察到的异常现象和问题边界。
  - !if
    问题可以稳定复现:
      - 阅读错误日志、失败测试或异常堆栈。
  - !call SummarizeFix
```

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
```

### Schema

```yaml
!schema
names:
  - Requirements Document
  - 需求文档
defines:
  - 用于收敛用户场景、需求边界、原型引用和业务验收口径的文档图式。
asserts:
  - 不负责工程 capability 划分，也不展开详细技术方案。
fields:
  - !schema
    names:
      - 需求概述
    format: section
    defines:
      - 描述需求来源、目标用户、核心问题和成功标准。
    fields:
      - !schema
        names:
          - 背景
        defines:
          - 说明需求来源、业务背景和为什么现在需要解决。
```

`!schema` may include an optional `format` field. `format` describes how the schema should be organized when rendered or written; it does not replace semantic fields such as `defines`, `asserts`, or `fields`.

Supported formats:

```yaml
format: section
format: field
format: table
format: list
format: template
```

Tables are represented by setting `format: table` on the schema that is itself table-shaped; table columns are nested `fields`:

```yaml
!schema
names:
  - 需求清单
format: table
fields:
  - !schema
    names:
      - ID
  - !schema
    names:
      - 需求描述
```

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
