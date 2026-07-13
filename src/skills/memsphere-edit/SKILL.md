---
name: memsphere-edit
description: Create or edit memsphere YAML memory entities safely. Use when changing !procedure, !concept, !statement, or !schema files in a memsphere memory store.
---

# memsphere Memory Editing

Use this skill when creating or modifying memsphere memory YAML files.

## Roots

`~/.memsphere/config.json` contains:

```json
{
  "memoryRoot": "/absolute/or/home-expanded/memory/path",
  "reviewsRoot": "/absolute/or/home-expanded/reviews/path"
}
```

Only `memoryRoot` contains memory entities:

- `procedures/`
- `concepts/`
- `statements/`
- `schemas/`

`reviewsRoot` contains review request YAML files, not memory entities.

## Entity Tags

The root YAML node must use a YAML tag. Do not add a separate `type` field.

- `!procedure` for procedural workflows
- `!concept` for domain concepts
- `!statement` for asserted facts or rules
- `!schema` for document/data shape descriptions

## Common Fields

Top-level memory entities have:

- `names`: non-empty string array. The first name is the canonical primary name.
- `defines`: array of strings, nested `!statement` nodes, or nested `!schema` nodes.

Prefer arrays for semantic text. Do not collapse meaningful requirements into a single large paragraph.

Use a string for a concise natural-language definition. Use an embedded `!statement` when the definition needs assertions, and an embedded `!schema` when it needs explicit structure. Embedded Statement and Schema values may omit `names` and `defines`; their type and meaningful fields carry the anonymous structure.

```yaml
defines:
  - 一段简洁的自然语言定义。
  - !statement
    asserts:
      - 必须满足的命题。
  - !schema
    format: outline
    fields:
      - 简写字段名
      - !schema
        names: [详细字段]
        asserts:
          - 详细字段不能为空。
```

## !procedure

Allowed fields:

- `names`
- `defines`
- `goals`: string array
- `flow`: array of structured steps or tagged control/call nodes

Supported flow tags:

- `!action`
- `!artifact`
- `!if`
- `!while`
- `!call`

Runnable flow syntax:

```yaml
flow:
  - !action
    action: 判断用户输入是否包含明确变更诉求。
    actor: agent
    artifact: !artifact
      name: 用户输入是否包含明确变更诉求
      format: boolean
  - !if
    condition: !action
      action: 判断是否需要补充背景。
      artifact: !artifact
        name: 是否需要补充背景
        format: boolean
    then:
      - !action
        action: 补充背景信息。
        actor: human
        artifact: !artifact
          name: 背景信息
          format: markdown
    elseif: !if
      condition: !action
        action: 判断是否需要补充约束。
        artifact: !artifact
          name: 是否需要补充约束
          format: boolean
      then:
        - !action
          action: 补充约束信息。
          artifact: !artifact
            name: 约束信息
            format: markdown
    else:
      - !action
        action: 确认当前信息足够。
        artifact: !artifact
          name: 信息足够确认
          format: string
  - !while
    condition: !action
      action: 判断是否仍有观察点需要补充。
      artifact: !artifact
        name: 是否仍有观察点需要补充
        format: boolean
    do:
      - !action
        action: 补充一个观察点。
        artifact: !artifact
          name: 观察点
          format: string
  - !call
    target: another-procedure-name
```

Rules:

- Every action must be tagged `!action` and include `action` and an `artifact: !artifact` value. Untagged mappings are invalid.
- `actor` is optional and defaults to `agent`.
- Use `actor: agent` when the agent can perform the action directly from available context.
- Use `actor: human` when a person must make a judgment, provide missing information, approve something, or perform external work. The agent will ask the human for the artifact and then report it.
- `artifact.name` is a human-readable deliverable name. Prefer natural language over variable-style names.
- `artifact.format` is one of `string`, `number`, `boolean`, `markdown`, `json`, `yaml`, or `schema`.
- `artifact.schema` is required only when `artifact.format` is `schema`.
- `!if.condition` and `!while.condition` are also steps and must report a boolean artifact.
- `!if.condition` and `!if.then` are required. `!if.elseif` is an optional single nested `!if`, so additional branches are represented recursively. There is no `!elseif` tag and `elseif` is not a list.
- Only the root `!if` in an elseif chain may have the optional `else` field.
- `!if.then`, `!if.else`, and `!while.do` contain non-empty nested flow arrays.
- `!call` only includes `target`; it does not include `artifact` or `format` because the called procedure defines its own artifacts.

Keep procedure steps actionable and ordered. Use `!call` when a step delegates to another named memory.

## !concept

Allowed fields:

- `names`
- `defines`
- `extends`: optional string array

Use concepts for stable vocabulary and domain abstractions.

Concepts may use embedded Statement and Schema values in `defines` when prose alone is insufficient.

## !statement

Allowed fields:

- `names`
- `defines`
- `asserts`: string array

Use statements for rules, constraints, or facts that should be evaluated as assertions. A top-level Statement requires `names`; an embedded Statement may be anonymous but still requires at least one assertion.

## !schema

Allowed fields:

- `names`
- `format`: optional, one of `outline`, `table`; missing means `outline`
- `defines`
- `asserts`: optional string array
- `element_types`: optional non-empty array of registered type names
- `fields`: optional array of strings or nested `!schema` nodes

`format` only controls the final presentation of a Schema. `outline` renders nested fields as a heading hierarchy. `table` renders first-level fields as columns. Do not use format to describe cardinality, structural level, or purpose.

Use `element_types` to express `List<T>`. Each entry is one allowed element type. For example, `element_types: [string]` means `List<string>`, while `element_types: [string, Statement, Schema]` means `List<string | Statement | Schema>`. Registered element types are `string`, `number`, `boolean`, `Concept`, `Statement`, `Schema`, `Procedure`, `Action`, `Artifact`, `If`, `While`, and `Call`. Duplicate element types are invalid.

Use `fields` for collaborator-fillable or structurally meaningful child fields. A string field is the shortest form and only names the field. Use a nested `!schema` when a field needs definitions, assertions, item types, or child fields. A Schema used as a field must have a non-empty `names` value.

A table must declare `format: table`, `element_types: [Schema]`, and at least one field. Its fields are the table columns:

```yaml
!schema
names: [requirements]
format: table
element_types:
  - Schema
fields:
  - id
  - description
  - status
```

Anonymous embedded Schemas in `defines` may omit `names`, but must contain meaningful structure such as `format`, `asserts`, `element_types`, or `fields`. Old Schema formats `section`, `field`, `list`, and `template` are invalid and must be upgraded rather than accepted as compatibility syntax.

## Type Rules

- Primitive authoring types are `string`, `number`, and `boolean`.
- Built-in struct types are Concept, Statement, Schema, Procedure, Action, Artifact, If, While, and Call, represented by their lowercase YAML tags.
- `List<T>` is the only generic extension currently supported; it is not a third type category.
- A YAML mapping that represents a memory structure must carry its known tag. Field names express relationships; tags express value types. For example, write `artifact: !artifact`, not a bare `!artifact` without the `artifact` field.
- Old untagged action/artifact mappings, `int`, elseif arrays, scalar `!call`, `!elseif`, and `!else` are invalid and must be upgraded rather than accepted as compatibility syntax.

## Editing Rules

- Preserve the canonical first `names` entry unless the user explicitly requests a rename.
- Keep numbering/name style consistent inside a schema family.
- Do not introduce unsupported fields.
- Do not remove content unless it is redundant, obsolete, or explicitly requested.
- Keep YAML tags intact.
- Prefer precise, small edits over broad rewrites.
- After editing, run `memsphere validate`.
