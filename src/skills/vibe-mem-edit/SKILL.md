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
- `flow`: array of strings or tagged control/call nodes

Supported flow tags:

- `!call target-memory-name`
- `!if`
- `!elseif`
- `!else`
- `!while`

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
