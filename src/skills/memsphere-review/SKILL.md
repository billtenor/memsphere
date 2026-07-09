---
name: memsphere-review
description: Apply memsphere review YAML comments to memory files. Use when given a review file from reviewsRoot and asked to update !procedure, !concept, !statement, or !schema memories.
---

# memsphere Apply Review

Use this skill when applying a memsphere review YAML file to memory files.

Also use the `memsphere-edit` skill for memory YAML structure and editing rules.

## Review Files

Review files live under `reviewsRoot`, not under `memoryRoot`. Each review file records the `memoryRoot` it applies to.

Shape:

```yaml
id: review-20260704-120000z-12345678
title: Review 2026/7/4 20:00:00
status: submitted
createdAt: "2026-07-04T12:00:00.000Z"
updatedAt: "2026-07-04T12:03:00.000Z"
submittedAt: "2026-07-04T12:03:00.000Z"
memoryRoot: ~/.memsphere/memory
comments:
  - id: comment-id
    memoryId: schemas/example
    memoryName: example
    kind: schemas
    target: defines[1]
    location:
      anchor: defines[1]
      line: 3
      hash: 4f9a2c10
    snapshot: "Text visible when the comment was made."
    body: "What should change."
    createdAt: "2026-07-04T12:01:00.000Z"
```

## Field Meanings

Top-level fields:

- `id`: stable review file id. It normally matches the file name without `.yaml`.
- `title`: human-facing review title shown in the browser.
- `status`: review lifecycle state. See Status below.
- `createdAt`, `updatedAt`, `submittedAt`, `doneAt`: ISO timestamps maintained by the UI or agent.
- `memoryRoot`: absolute path of the memory store this review applies to.
- `comments`: ordered list of review comments.
- `agent.summary`: optional short note written by the applying agent after work is complete.

Comment fields:

- `id`: stable comment id. Preserve it when editing the review file.
- `memoryId`: browser id for the target memory, usually `<kind>/<primary-name>`.
- `memoryName`: primary name of the target memory entity.
- `kind`: target memory directory: `procedures`, `concepts`, `statements`, or `schemas`.
- `target`: human-readable structural target, using YAML field names such as `defines[1]`, `asserts[2]`, or `flow[3]`.
- `location.anchor`: machine-readable structural anchor used by the browser to reattach inline comments.
- `location.line`: logical line number in the browser's structured reading view. Use for orientation only; do not treat it as a YAML source line.
- `location.hash`: hash of the original rendered text at the anchor. If the current rendered text hash differs, the browser treats the comment as outdated.
- `snapshot`: rendered text visible when the reviewer created the comment. Use this to understand the original context.
- `body`: the reviewer's requested change or concern.
- `createdAt`: ISO timestamp for when the comment was created.

Use `target`, `location`, and `snapshot` for context, but make edits by reading the current memory YAML. Do not blindly patch by line number.

## Status

- `draft`: reviewer is still editing comments.
- `submitted`: ready for an agent to apply.
- `processing`: agent has started applying it.
- `done`: memory edits and validation are complete.

Do not apply `draft` reviews unless the user explicitly asks.

## Required Status Updates

The agent must update the review YAML file itself. Status changes are part of the work, not optional reporting.

Before editing memory files, if the review is `submitted`, immediately write:

```yaml
status: processing
updatedAt: "<current ISO timestamp>"
```

After memory edits and `memsphere validate` pass, write:

```yaml
status: done
doneAt: "<current ISO timestamp>"
updatedAt: "<current ISO timestamp>"
agent:
  summary: "<short summary of applied changes and validation result>"
```

If validation fails or the work cannot be completed safely, do not set `status: done`. Keep or set `status: processing`, update `updatedAt`, and write an `agent.summary` explaining the blocker or failure.

The final response must state the review file path and final review status.

## Workflow

1. Read the review YAML file.
2. Apply the Required Status Updates protocol: if status is `submitted`, update the review file to `processing` before editing memory files.
3. Group comments by `kind` and `memoryName`.
4. Read the referenced memory files from `memoryRoot`.
5. Use `target`, `location.anchor`, `snapshot`, and `body` to understand each requested change.
6. Treat comments with stale anchors cautiously: if the current content no longer matches `snapshot` or `location.hash`, use the review body as advisory context and avoid blind positional edits.
7. Edit memory YAML files directly.
8. Preserve unrelated content.
9. Run `memsphere validate`.
10. If validation passes, update the review file to `done` using the Required Status Updates protocol.
11. Report changed files, what changed, and validation result.

## Safety

- Never edit review comments as a substitute for editing memory.
- Do not mark a review `done` if validation fails.
- Do not claim review completion unless the review YAML status has actually been updated.
- If a comment is ambiguous or outdated and cannot be safely applied, leave memory unchanged for that comment and explain why.
