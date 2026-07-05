---
name: vibe-mem-run
description: Execute vibe-mem procedures through the run harness. Use when an agent must follow a procedure step by step, report artifacts with vibe-mem run, and only continue after the CLI returns the next step.
---

# vibe-mem Run Harness

Use this skill when executing a vibe-mem procedure.

## Rules

- Always start with `vibe-mem run start <procedure-name>`.
- Only perform the step returned by the latest `vibe-mem run` command.
- Do not execute undisclosed future steps.
- Every step must produce the requested artifact.
- After producing a non-schema artifact, report it with `vibe-mem run report --run <id> --artifact <value>`.
- If the artifact is large or multiline, write it to a file and use `--artifact-file <path>`.
- If the returned artifact format is `schema`, call `vibe-mem run enter-schema <schema-name> --run <id>` and follow the schema field steps depth-first.
- Continue until the CLI prints `done`.

## Procedure Step Shape

Runnable procedure flow steps must be structured. Plain steps use `action`, `artifact`, and `format`:

```yaml
flow:
  - action: 判断用户输入是否包含明确变更诉求。
    artifact:
      name: 用户输入是否包含明确变更诉求
      format: boolean
  - action: 撰写 proposal。
    artifact:
      name: OpenSpec Proposal
      format: schema
      schema: craa-spec-driven-proposal
```

Fields:

- `action`: what to do now.
- `artifact.name`: required human-readable artifact name.
- `artifact.format`: artifact format: `string`, `int`, `boolean`, `markdown`, `json`, `yaml`, or `schema`.
- `artifact.schema`: schema memory name, required only when `artifact.format` is `schema`.

Conditions are also runnable steps. They must report boolean artifacts:

```yaml
flow:
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
    else:
      - action: 确认当前信息足够。
        artifact:
          name: 信息足够确认
          format: string
  - !while
    condition:
      action: 判断是否还需要继续补充观察点。
      artifact:
        name: 是否还需要继续补充观察点
        format: boolean
    do:
      - action: 补充一个观察点。
        artifact:
          name: 观察点
          format: string
  - !call
    target: another-procedure-name
```

For `!if`, report the condition artifact; the harness chooses `then`, `elseif`, or `else`.
For `!while`, report the condition artifact; `true` enters `do` and returns to the condition, `false` exits.
For `!call`, do not report anything for the call itself. The harness automatically enters the target procedure, whose internal steps define their own artifacts.

String flow steps and legacy control syntax are not runnable by the MVP harness.

## CLI Loop

Start:

```bash
vibe-mem run start craa-spec-driven-propose
```

Report:

```bash
vibe-mem run report --run run-... --artifact "true"
```

Enter schema artifact:

```bash
vibe-mem run enter-schema craa-spec-driven-proposal --run run-...
```

Status:

```bash
vibe-mem run status --run run-...
```

The CLI output is intentionally minimal. Treat the `Do:` section as the only current instruction.
