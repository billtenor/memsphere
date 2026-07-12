---
name: memsphere-run
description: Execute memsphere procedures through the run harness. Use when an agent must follow a procedure step by step, report artifacts with memsphere run, and only continue after the CLI returns the next step.
---

# memsphere Run Harness

Use this skill when executing a memsphere procedure.

## Rules

- Always start with `memsphere run start <procedure-name>`.
- Only perform the step returned by the latest `memsphere run` command.
- Do not execute undisclosed future steps.
- Every step must produce the requested artifact.
- If the step actor is `agent`, perform the action yourself and report the artifact.
- If the step actor is `human`, ask the human to perform the action or provide the requested artifact. Do not invent the artifact. After the human provides it, report that value with `memsphere run report`.
- After producing a non-schema artifact, report simple scalar values with `memsphere run report --run <id> --artifact <value>`.
- If the artifact is large, multiline, Markdown, JSON, YAML, or may contain shell-sensitive characters such as backticks, `$`, quotes, angle brackets, or code fences, write it to a file under the current run's `artifacts/` directory and use `--artifact-file <path>`.
- Prefer `--artifact-file` for all `markdown`, `json`, and `yaml` artifacts. Do not pass Markdown directly through a double-quoted shell argument, because backticks in inline code such as `` `memsphere` `` are interpreted by the shell before `memsphere` receives the value.
- If the returned artifact format is `schema`, call `memsphere run enter-schema <schema-name> --run <id>` and follow the schema field steps depth-first.
- Continue until the CLI prints `done`.

## Procedure Step Shape

Runnable procedure flow steps must be structured. Plain steps use `action`, `artifact`, and `format`:

```yaml
flow:
  - !action
    action: 判断用户输入是否包含明确变更诉求。
    actor: agent
    artifact: !artifact
      name: 用户输入是否包含明确变更诉求
      format: boolean
  - !action
    action: 请用户确认是否继续执行。
    actor: human
    artifact: !artifact
      name: 用户是否确认继续
      format: boolean
  - !action
    action: 撰写 proposal。
    artifact: !artifact
      name: OpenSpec Proposal
      format: schema
      schema: craa-spec-driven-proposal
```

Fields:

- `action`: what to do now.
- `actor`: optional executor, either `agent` or `human`. Missing means `agent`.
- `artifact.name`: required human-readable artifact name.
- `artifact.format`: artifact format: `string`, `number`, `boolean`, `markdown`, `json`, `yaml`, or `schema`.
- `artifact.schema`: schema memory name, required only when `artifact.format` is `schema`.

Conditions are also runnable steps. They must report boolean artifacts:

```yaml
flow:
  - !if
    condition: !action
      action: 判断是否需要补充背景。
      artifact: !artifact
        name: 是否需要补充背景
        format: boolean
    then:
      - !action
        action: 补充背景信息。
        artifact: !artifact
          name: 背景信息
          format: markdown
    else:
      - !action
        action: 确认当前信息足够。
        artifact: !artifact
          name: 信息足够确认
          format: string
  - !while
    condition: !action
      action: 判断是否还需要继续补充观察点。
      artifact: !artifact
        name: 是否还需要继续补充观察点
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

For `!if`, report the condition artifact; the harness chooses `then`, recursively evaluates the optional `elseif: !if`, or uses the root `else` branch. `elseif` is a single nested If value, not a list.
For `!while`, report the condition artifact; `true` enters `do` and returns to the condition, `false` exits.
For `!call`, do not report anything for the call itself. The harness automatically enters the target procedure, whose internal steps define their own artifacts.

String flow steps, untagged mappings, elseif arrays, scalar `!call`, `!elseif`, and `!else` are invalid memory syntax and must fail validation before a run starts.

## CLI Loop

Start:

```bash
memsphere run start craa-spec-driven-propose
```

Report:

```bash
memsphere run report --run run-... --artifact "true"
```

Enter schema artifact:

```bash
memsphere run enter-schema craa-spec-driven-proposal --run run-...
```

Status:

```bash
memsphere run status --run run-...
```

The CLI output is intentionally minimal. Treat the `Do:` section as the only current instruction.
When the CLI prints `Actor: human`, turn the action into a concise question or request for the user, wait for their answer, and report the artifact exactly from the user's supplied result.
