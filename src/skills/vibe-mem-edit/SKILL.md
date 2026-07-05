---
name: vibe-mem-edit
description: Create or edit vibe-mem YAML memory entities safely. Use when changing !procedure, !concept, !statement, or !schema files in a vibe-mem memory store.
---

# vibe-mem Memory Editing

Use this skill when creating or modifying vibe-mem memory YAML files.

## Roots

`~/.vibe-mem/config.json` contains:

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

All memory entities have:

- `names`: non-empty string array. The first name is the canonical primary name.
- `defines`: string array. Use concise descriptions only.

Prefer arrays for semantic text. Do not collapse meaningful requirements into a single large paragraph.

## !procedure

Allowed fields:

- `names`
- `defines`
- `goals`: string array
- `flow`: array of structured steps or tagged control/call nodes

Supported flow tags:

- `!if`
- `!while`
- `!call`

Runnable flow syntax:

```yaml
flow:
  - action: 判断用户输入是否包含明确变更诉求。
    artifact:
      name: 用户输入是否包含明确变更诉求
      format: boolean
  - !if
    condition:
      action: 判断是否需要补充背景。
      artifact:
        name: 是否需要补充背景
        format: boolean
    then:
      - action: 补充背景信息。
        artifact:
          name: 背景信息
          format: markdown
    elseif:
      - condition:
          action: 判断是否需要补充约束。
          artifact:
            name: 是否需要补充约束
            format: boolean
        then:
          - action: 补充约束信息。
            artifact:
              name: 约束信息
              format: markdown
    else:
      - action: 确认当前信息足够。
        artifact:
          name: 信息足够确认
          format: string
  - !while
    condition:
      action: 判断是否仍有观察点需要补充。
      artifact:
        name: 是否仍有观察点需要补充
        format: boolean
    do:
      - action: 补充一个观察点。
        artifact:
          name: 观察点
          format: string
  - !call
    target: another-procedure-name
```

Rules:

- A plain step must include `action` and an `artifact` object.
- `artifact.name` is a human-readable deliverable name. Prefer natural language over variable-style names.
- `artifact.format` is one of `string`, `int`, `boolean`, `markdown`, `json`, `yaml`, or `schema`.
- `artifact.schema` is required only when `artifact.format` is `schema`.
- `!if.condition` and `!while.condition` are also steps and must report a boolean artifact.
- `!if.then`, each `!if.elseif[].then`, and `!while.do` contain nested flow steps.
- `!if.else` is optional and contains nested flow steps.
- `!call` only includes `target`; it does not include `artifact` or `format` because the called procedure defines its own artifacts.

Keep procedure steps actionable and ordered. Use `!call` when a step delegates to another named memory.

## !concept

Allowed fields:

- `names`
- `defines`
- `extends`: optional string array

Use concepts for stable vocabulary and domain abstractions.

## !statement

Allowed fields:

- `names`
- `defines`
- `asserts`: string array

Use statements for rules, constraints, or facts that should be evaluated as assertions.

## !schema

Allowed fields:

- `names`
- `format`: optional, one of `section`, `field`, `table`, `list`, `template`
- `defines`
- `asserts`: optional string array
- `fields`: optional array of nested `!schema` nodes

Use `defines` only for concise field or section descriptions. Put writing requirements, validation rules, and expected content constraints in `asserts`.

Use `fields` for collaborator-fillable or structurally meaningful child fields. If a schema represents a table, set `format: table` and put columns in `fields`.

Nested `fields` are full schema nodes and may also have their own `asserts`, `format`, and nested `fields`.

## Editing Rules

- Preserve the canonical first `names` entry unless the user explicitly requests a rename.
- Keep numbering/name style consistent inside a schema family.
- Do not introduce unsupported fields.
- Do not remove content unless it is redundant, obsolete, or explicitly requested.
- Keep YAML tags intact.
- Prefer precise, small edits over broad rewrites.
- After editing, run `vibe-mem validate`.
