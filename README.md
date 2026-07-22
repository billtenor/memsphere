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
memsphere memory list "Repository rules"
memsphere memory list "Repository rules" --node "statement:Testing"
memsphere memory read concepts/Memory
memsphere memory read 记忆 --kind concepts
memsphere memory read Memory --output json
memsphere memory read "Repository rules" --node "statement:Testing"
memsphere view start
memsphere view status
memsphere run start <procedure-name>
memsphere run start --file ./path/to/procedure.yaml
memsphere migrate syntax --check
memsphere migrate artifact-contract-v2 --check
```

`memory list` discovers memories through stable logical references rather than file paths. YAML and JSON list items include `names`, prose `defines`, and counts of folded structured definitions as compact discovery metadata, analogous to a Skill's name and description; `--output text` remains compact. Given a Memory reference, `memory list` returns its direct child Nodes, copyable `node_ref` values, and each Node's actual reference source, such as an Action `artifact`, an If/While `condition_artifact`, or a Call `target`. Pass a `node_ref` back through `--node` to continue listing or to read that fragment with the root and ancestor context required to interpret it. Without `--node`, `memory read` continues to return the complete tagged memsphere YAML.

`view start` starts the local memory browser as a managed background service using the configured host and port:

```bash
memsphere view start
memsphere view stop
memsphere view restart
memsphere view status
```

The browser renders schemas as progressive disclosure sections. Artifact contracts using Markdown `layout: table` render Schema `fields` as table columns. Procedures render `flow` as readable steps, with visual blocks for `!action`, `!if`, `!while`, and `!call`. Recursive `elseif: !if` values are displayed as a flat if/elseif/else chain.

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
  "archiveRoot": "archives",
  "view": {
    "host": "127.0.0.1",
    "port": 30000
  },
  "control_plane": {
    "identities": {
      "human_reviewer": {
        "kind": "human",
        "name": "Human Reviewer"
      },
      "review_agent": {
        "kind": "agent",
        "name": "Review Agent",
        "agent": {
          "provider": "traex",
          "command": "traex",
          "args": ["acp", "serve"],
          "cwd": ".",
          "model": "review-model",
          "prompt_version": "artifact-review-v1",
          "startup_timeout_ms": 60000,
          "idle_timeout_ms": 120000,
          "max_runtime_ms": null
        }
      }
    },
    "roles": {
      "runner": {
        "name": "Runner",
        "permissions": ["artifact.read", "artifact.write", "artifact.submit"]
      },
      "reviewer": {
        "name": "Reviewer",
        "permissions": ["artifact.read", "decision.assess"],
        "grantable_permissions": ["decision.challenge"],
        "system_prompt": "Review the Artifact independently."
      }
    }
  }
}
```

Set `archiveRoot` to an absolute path when multiple scopes should share archived runs and reviews.

`control_plane` is optional. When present, it defines Identity and Role records; the `runner` Role is required and is carried implicitly by the current Run executor. Permission and Decision Policy catalogs are built into memsphere and cannot be redefined in config. Agent identities currently support the built-in `traex` ACP provider plus `command`, `args`, optional workspace-relative `cwd`, `model`, `prompt_version`, `startup_timeout_ms`, `idle_timeout_ms`, and `max_runtime_ms`. Startup timeout covers process and ACP Session initialization. Idle timeout resets whenever ACP reports progress or invokes a client capability. Maximum runtime is an absolute ceiling; omitting `max_runtime_ms` or setting it to `null` means no ceiling. Legacy `timeout_ms` remains readable as `max_runtime_ms` but cannot be combined with it. Credentials, arbitrary environment variables, API keys, and secrets are not control-plane fields: the configured ACP Agent uses its own existing login and provider configuration.

Memsphere owns the Agent Reviewer's safety arguments. The Traex Provider always launches `acp serve` with a read-only sandbox and no interactive approval fallback; do not put sandbox, approval-bypass, or another subcommand in `args`. An explicit `model` is forwarded by the Provider, and `cwd` must remain inside the current workspace.

### Bundled memory installation

`reserved-memory/manifest.json` classifies the memories bundled with the npm package. Paths in
`system_memory.install` are required runtime memories: every `memsphere init` copies them into the configured
Memory Store and overwrites files at the same paths. Paths in `system_memory.remove` are deleted from the Memory
Store during init so renamed or retired system memories do not remain installed.

Bundled YAML files not listed in `system_memory.install` are copied to `.memsphere/reserved-memory/`. They remain
inactive until the user imports them from View. Re-running `init` preserves the existing config, refreshes system
memories, and rebuilds this reserved-memory staging directory. Changing configured root paths still requires
`--force`.

## YAML DSL

Entity type is represented by the YAML document root tag. There is no `type` field.

Every top-level Memory declares its immutable YAML syntax version with `syntax`. The current stable version is `memsphere-20260721-stable`. An omitted value is always interpreted as `start`, the unversioned migration origin, rather than whichever version happens to be current:

```yaml
!concept
syntax: memsphere-20260721-stable
name: Customer
defines:
  - A party that receives a product or service.
```

Check or upgrade a Memory Store through the registered migration path:

```bash
memsphere migrate syntax --check
memsphere migrate syntax --write
```

The authoring type system has three primitive types (`string`, `number`, and `boolean`), fixed tagged struct types, and the `List<T>` generic extension. Mappings that represent memory structures must carry their registered YAML tag; the validator does not infer a struct type from its fields.

`defines` has type `List<string | Statement | Schema>`. Use strings for concise definitions, embedded `!statement` values for assertions, and embedded `!schema` values for explicit structure. Embedded Statement and Schema values may be anonymous.

### Procedure

```yaml
!procedure
syntax: memsphere-20260721-stable
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
        type: boolean
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
          type: boolean
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
  - !call
    target: SummarizeFix
```

Procedure `asserts` are global constraints that remain active throughout the Run. Action `asserts` apply only to their own step. `flow` has type `List<Action | If | While | Call>`. An Action always contains `artifact: !artifact`. If and While conditions are Actions whose Artifact type is `boolean`. `elseif` is an optional single nested `!if`, not a list, and only the root If in a chain may contain `else`.

### Artifact Contract

Every Artifact uses the executable contract `type -> format -> schema`:

```yaml
artifact: !artifact
  name: 发布记录
  type: object
  format:
    name: markdown
    layout: outline
  schema: !schema
    fields: [版本, 发布日期, 结果]
  review: artifact_acceptance.unanimous
  final: true
```

Built-in types are `boolean`, `number`, `string`, `object`, and `array`. Omitted `type` defaults to `string`; every other type must be explicit. `format` is optional and defaults to `plain`; scalar formats can use `format: markdown`, `format: json`, or `format: yaml`. Format-specific options use the object form. `layout` belongs to Markdown: object Markdown requires `outline`, and array Markdown requires `table`.

Schema is optional for JSON/YAML object and array Artifacts, and required for structured Markdown. `asserts` and `suggests` remain natural-language contracts; executable report validation is performed by the registered type, format, and Schema validators.

`review` is an optional Decision Policy id. When present, a validated report creates a persistent Artifact Review instead of immediately advancing the Run. Human reviewers work in View. Agent reviewers are dispatched in the background through ACP stdio and receive a read-only workspace session. Their Session-bound CLI separates navigation from detail: `run show` lists Run steps and Artifact summaries, `run step show` expands one step, `run artifact show --assignment` loads the candidate, `run artifact contract show --assignment` loads the complete frozen Review contract, and `run review assignment show/comment/submit` manages only the current Assignment. The initial Prompt includes a concise human-readable Review contract so the Agent immediately knows the Action, assertions, suggestions, Artifact metadata, and Schema summary. Memsphere injects a temporary `MEMSPHERE_CLI` launcher for the same installation that started the worker; it uses the installed CLI in normal use and the current build during development, without requiring a global command or a user-configured launcher path. Agent natural-language output never counts as a Vote.

The Runner waits with `memsphere run review wait --review <review_id>`. Agent startup, protocol, timeout, CLI-handshake, or missing-submit failures block the round and are shown in View with an explicit Retry action. After every Assignment is submitted, a Runner with `decision.decide` must explicitly vote with `memsphere run review vote --review <review_id> --round <review_round_id> --vote approve|request_changes`; requesting changes also requires `--comment` or `--comment-file`. A rejected round is revised with the original artifact option plus `--revision-summary-file <path>`. The built-in `artifact_acceptance.unanimous` policy waits for every assignment and counts only votes authorized by `decision.decide`; assess-only votes remain advisory.

For local Agent launch inspection, set `debug.agent_review` to `true`. This is a safety gate: background dispatch remains disabled, but no files are generated automatically. Run `memsphere run try-run --run <run_id>` explicitly to create each queued Agent Assignment's `launch.json` and `prompt.md` under `.memsphere/debug/agent-review/` without claiming the Assignment or starting an ACP process.

Adding `review` is a compatible extension of `memsphere-20260721-stable`: existing Memories that omit it retain their prior interpretation and require no migration. Syntax advances only when a change forces existing Memory YAML to be rewritten; such incompatible releases must provide an explicit migration path.

Artifact Contract v2 is a breaking change from the former overloaded `format` model. Before upgrading an existing Memory Store, run the read-only check and resolve every reported blocker:

```bash
memsphere migrate artifact-contract-v2 --check
memsphere migrate artifact-contract-v2 --write
```

The migration command is config-driven and does not depend on Git. Running v1 Runs are blocked; completed v1 Runs and Review snapshots remain available as read-only evidence.

Any Memory or nested node that accepts `names` also accepts `name` as a single-value shorthand. `name: Customer` is normalized to `names: [Customer]`; the two fields are mutually exclusive. Artifact `name` remains the deliverable name and is not this shorthand.

### Concept

```yaml
!concept
syntax: memsphere-20260721-stable
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
syntax: memsphere-20260721-stable
names:
  - RepositoryDevelopmentRules
defines:
  - 代码仓库开发活动需要遵循的统一规范。
asserts:
  - 所有变更必须经过 review。
sections:
  - !statement
    names:
      - 测试规范
    asserts:
      - 修改核心逻辑时必须补充对应测试。
    suggests:
      - 优先编写范围明确的测试。
  - !statement
    names:
      - 代码组织
    sections:
      - !statement
        names:
          - 模块边界
        asserts:
          - 跨模块访问必须通过公开接口。
```

`asserts` 表达可判断的事实、规则或约束，`suggests` 表达非强制的建议或优先性指导，`sections` 使用有名称的内嵌 `!statement` 递归组织同一领域中的规则。三个字段都可以省略，但每个 Statement 节点必须至少包含其中一个；字段如出现则必须是非空数组。一个节点可以同时包含规则和子章节。树状层级只负责组织，读取整份 Statement 后，其中与当前任务相关的全部规则共同生效。

### Schema

```yaml
!schema
syntax: memsphere-20260721-stable
names:
  - Requirements Document
  - 需求文档
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

`Schema.fields` has type `List<string | Schema | Repeat>`. A string is the shortest field form and always has type `string`; its format follows the containing Schema context. A nested `!schema` supplies richer descriptions, assertions, an explicit value contract, or child fields, and must have a non-empty `names` value when used in `fields`.

Schema can declare the same optional `type` and `format` vocabulary as Artifact, but resolves them independently. Type never inherits: an omitted type is inferred as `object` when the Schema has fields, otherwise as `string`. Format inherits from the parent Schema or owning Artifact unless explicitly overridden. Markdown `layout` is retained only by compatible structural nodes (`object + outline` or `array + table`); scalar fields inherit Markdown without a layout. The root Schema's inferred type and effective format must match the owning Artifact.

When consumed by an object Markdown Artifact with `layout: outline`, a Schema may use a mapping `!repeat` field to repeat a non-empty group of fields:

```yaml
!schema
syntax: memsphere-20260721-stable
names: [关键决策记录]
fields:
  - 背景
  - !repeat
    limit:
      min: 1
      max: 3
    body:
      - !schema
        names: [决策]
        fields:
          - 结论
          - 理由
      - 负责人
  - 总结
```

`body` has type `List<string | Schema>` and repeats as one group, producing stable Run paths such as `关键决策记录.决策[2].结论` and `关键决策记录.负责人[2]`. `limit` is optional; its `min` and `max` values are optional non-negative integers, at least one must be present when `limit` exists, and `min` cannot exceed `max`. Repeat is not allowed in table Schemas, `defines`, Procedure `flow`, or another Repeat body.

When a Schema Run reaches Repeat, choose the total count once. This control action creates no Artifact:

```bash
memsphere run repeat 2 --run <run-id>
```

For an array Schema, `item: !schema` defines one element contract and `items` defines a union of at least two candidate contracts. Every array element must satisfy `item`, or at least one `items` candidate. `item` and `items` are mutually exclusive and require an explicit `type: array`; omitting both validates only the array container. Array Schemas do not declare `fields` directly. Structured rows put `fields` under an object `item/items` Schema. The old `element_types` field and string-valued legacy `items` syntax require migration.

A nested Schema can override the inherited representation. This example validates a Markdown table only inside the `需求清单` heading subtree:

```yaml
artifact: !artifact
  name: 需求文档
  type: object
  format:
    name: markdown
    layout: outline
  schema: !schema
    fields:
      - 摘要
      - !schema
        names: [需求清单]
        type: array
        format:
          name: markdown
          layout: table
        item: !schema
          type: object
          fields: [ID, 需求描述]
```

Before upgrading memories that use `element_types`, string-valued legacy `items`, direct `array + fields`, or legacy Schema `format: outline/table`, run:

```bash
memsphere migrate schema-contract-v2 --check
memsphere migrate schema-contract-v2 --write
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
