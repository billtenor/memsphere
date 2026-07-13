# Procedure Boolean Control Constraint

Status: proposed

Created on: 2026-07-08

## Background

While reviewing `dialogic-procedure-construction.yaml`, several procedure steps produced boolean artifacts as ordinary flow steps, but the result was not directly consumed by an adjacent `!if` or `!while`.

Examples of the problematic shape:

```yaml
flow:
  - !action
    action: 判断 human 是否认可 procedure 边界草稿。
    actor: human
    artifact: !artifact
      name: procedure 边界是否认可
      format: boolean
  - !while
    condition: !action
      action: 判断 procedure 边界是否仍需调整。
      artifact: !artifact
        name: procedure 边界是否仍需调整
        format: boolean
```

The first boolean artifact is logically a control decision, but it does not drive control flow. The next control node asks a similar question again. This creates duplicated judgment, weakens flow rigor, and makes procedure execution harder to reason about.

## Proposed Rule

In procedure memories, boolean artifacts should normally appear only as the condition artifact of `!if.condition` or `!while.condition`.

A plain flow step with `artifact.format: boolean` should be treated as suspicious, and eventually invalid, unless there is an explicit supported reason for allowing it.

Preferred shape:

```yaml
flow:
  - !while
    condition: !action
      action: 判断 procedure 边界草稿是否仍需调整。
      actor: human
      artifact: !artifact
        name: procedure 边界是否仍需调整
        format: boolean
    do:
      - !action
        action: 说明需要调整的边界、名称、目标或非适用场景。
        actor: human
        artifact: !artifact
          name: procedure 边界调整意见
          format: markdown
```

## Rationale

- A boolean answer represents a branch or loop decision, not a durable work artifact.
- If a boolean is produced but not consumed, the procedure has implicit control flow that is not encoded in the DSL.
- Binding booleans to `!if` and `!while` makes the flow easier to run, review, render, and validate.
- It prevents repeated questions such as "是否认可" followed by "是否仍需调整" when one condition is enough.

## Suggested Validation Behavior

Add validation that reports a warning or error when a plain procedure step has:

```yaml
artifact: !artifact
  format: boolean
```

but the step is not inside:

- `!if.condition`
- `!while.condition`

Initial implementation could be a warning to avoid breaking existing memories immediately. Later it can become a hard validation error after legacy memories are migrated.

## Possible Exceptions

Avoid exceptions at first. If a future use case needs a durable boolean artifact, require an explicit schema or field that explains why the boolean is a recorded fact rather than a control decision.

Potential exception candidates:

- A diagnostic result meant to be recorded for later reporting.
- A checklist field in a schema-like artifact.
- A boolean fact in a `!statement` or structured report, outside procedure control flow.

These should not weaken the default procedure rule: control decisions belong in control nodes.

## Implementation Notes

Relevant code:

- `src/memory/schema.ts`: defines the procedure flow node schema.
- `src/validation.ts`: validates memory files and reports issues.
- `src/run/store.ts`: compiles runnable procedure steps and already treats `!if.condition` and `!while.condition` as control-specific steps.

Possible implementation approaches:

1. Add a post-parse procedure flow traversal in validation.
2. Track whether each step is in a condition context.
3. If a plain runnable step has `artifact.format === "boolean"` outside a condition context, report an issue.
4. Include the flow path in the issue, such as `flow[5].artifact.format`.

## Migration Guidance

When a plain boolean step is found:

- If it asks whether to continue, adjust, approve, or retry, convert it into a `!while.condition`.
- If it asks whether one of two branches applies, convert it into a `!if.condition`.
- If the next control node repeats the same judgment, delete the plain boolean step and keep only the control node.
- If the boolean should be preserved as a record, consider changing the artifact to `markdown` and require a short explanation instead of a bare true/false.
