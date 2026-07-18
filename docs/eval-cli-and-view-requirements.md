# Eval CLI、Procedure 协同与 View 展示需求

状态：Proposed

日期：2026-07-18

## 背景

memsphere 已经建设 `self-bootstrap-step0`、`self-bootstrap-step1` 和 `self-bootstrap-step2` 等 Agent Evaluation Suite，并通过以下脚本完成隔离环境准备和 Agent 执行：

- `evals/prepare-case.sh`
- `evals/prepare-cases.sh`
- `evals/run-cases.sh`
- `evals/run-codex-agent.sh`
- `evals/run-traex-agent.sh`

这套脚本验证了基本方向，但它把准备、运行和结果组织暴露成了较多实现概念：

- 一批 Case 先被准备为 Batch。
- 每个 Case 被准备成 Trial。
- 每个 Trial 下再产生 Agent Run。
- Agent 执行 Procedure 后，Trial 的 `.memsphere/runs` 中还会产生 Procedure Run。
- Batch、Trial 和 Agent Run 分别保存 metadata、status、logs 和 results，存在重复状态文件。

因此，人或父 Agent 为了理解一次批量评测，必须先理解临时目录中的多层 `runs/`、`baseline/`、`workspace/`、`home/` 和 `trial`。`/tmp` 中的随机目录同时承担执行环境、结果索引和调试入口，既不是稳定的产品模型，也不适合直接交给 View 展示。

实际使用方式比当前目录模型简单：评测通常以一批 Case 为单位发起，每个 Case 由一个上下文和工作区相互隔离的子 Agent 执行；父 Agent 按 Procedure 完成运行、判分、问题分析、human 确认、修复和部分 Case 复测；human 主要通过 View 观察结果，而不是操作复杂的 CLI。

因此，需要把 Eval 建设为 memsphere 的正式能力，但不能在 Eval CLI 中重新实现一套与 Procedure 重复的工作流系统。

## 相关需求

- `docs/self-bootstrap-artifact-validation-feedback-requirements.md` 定义 Artifact 独立验证、最小纠错反馈和同一子 Agent 修正闭环。本需求引用该专项能力，不重复其 validator 细节。
- `docs/self-bootstrap-evaluation-steps.md` 定义 self-bootstrap 各 Step 的认知顺序和 Case 建设原则。本需求不改变 Case 的考题语义。
- `docs/reserved-memory-self-bootstrap-design.md` 定义自举验收目标、干净上下文和 Memory 自举边界。
- `evals/README.md` 描述当前脚本和临时目录，是本需求实施前的现状，不作为长期产品契约。

## 核心问题

1. 当前没有稳定的 Eval 领域对象和持久化结果模型。
2. 一次完整评测与一次批量执行混在一起，修复后的部分 Case 复测无法自然表达。
3. Trial、Agent Run 和 Procedure Run 同时暴露，且多个目录都叫 `runs`。
4. CLI 面向脚本作者设计，尚未形成适合 Procedure Agent 使用的最小命令契约。
5. Agent 退出码、Procedure Run `done`、Harness 结果和语义判分没有清晰分层。
6. human 无法在 View 中统一查看评测进度、Case 产物、判分依据和修复历史。
7. 运行结果以 `/tmp` 路径为主要入口，无法稳定保留、关联和复查。

## 目标

1. 使用 Procedure Run 表达一次完整的“Agent 评测与协同修复”会话。
2. 使用 Batch 表达一次批量执行；Batch 中每个 Case 只对应一个独立子 Agent 执行。
3. Eval CLI 只提供批量执行和证据读取两项面向 Agent 的原子能力。
4. 由 Procedure 负责语义判分、问题归因、human 确认、修复决策和复测编排。
5. 将规范化评测证据持久化到当前 scope 的 `.memsphere/evals`，不以临时目录作为可信结果源。
6. 在 View 中按“评测会话 -> Batch -> Case”展示进度、证据、判断和修复历史。
7. 保持 Case 之间的 workspace、HOME、Memsphere scope 和 Agent 上下文相互隔离。
8. 允许 Artifact Harness 在同一个 Case Execution 内向同一子 Agent 反馈并重新验证，而不引入用户可见的 Attempt 层。

## 非目标

- 不在 Eval CLI 中提供完整的 judge、skip、retry、fix 或需求管理工作流。
- 不为 human 建设一组复杂的 Eval 管理命令；human 的主要入口是 View 和与 Procedure Agent 的对话。
- 第一阶段不允许 View 直接启动外部 Agent、修改 Case 或执行修复。
- 不自动理解任意自然语言评分标准并替代父 Agent 或 human 的语义判断。
- 不把 Procedure Run `done`、子 Agent 退出码为零或 Artifact 文件存在直接等同于 Eval `pass`。
- 不继续把 Trial、baseline 或多层 `runs/` 作为用户可见领域概念。
- 不导入已有 `/tmp/memsphere-eval-*` 历史结果，也不为当前脚本目录结构提供长期兼容层。
- 不在本需求中重新定义 Artifact validator 的全部语义和反馈协议。

## 设计原则

### Procedure 是控制面

一次完整评测必须从适用的 Procedure 开始。Procedure 决定：

- 运行哪个 Suite、使用哪个 Agent 和模型。
- 如何对 Case 进行语义判分和问题分类。
- 何时暂停并请求 human 确认。
- 哪些问题立即修复，哪些问题记录为后续开发需求。
- 哪些 Case 需要在修复后重新运行。
- 何时允许跳过，以及何时满足流程结束条件。

Eval CLI 不复制这些流程判断。

### Eval CLI 是执行面

Eval CLI 负责稳定完成代码才能可靠完成的事情：

- 解析和校验 Suite、Case 的机器可读配置。
- 创建相互隔离的执行环境。
- 调用不同 Agent adapter 并管理并发、超时和退出。
- 收集事件、最终回答、工作区产物、Procedure Run 和 token usage。
- 执行确定性的 Harness 检查。
- 持久化规范化证据并返回稳定的 Batch ID。

CLI 不决定语义上是否通过，也不替 human 作出跳过或延期决定。

### View 是 human 的观察面

View 从 Eval Store 和关联的 Procedure Run 读取数据，把执行事实、Harness 结果、Agent 判分和 human 决策合并展示。目录和文件路径只能作为调试信息，不能成为主要导航方式。

### 执行事实与评测结论分离

以下状态必须分别记录：

1. Batch 和 Case 是否完成了技术执行。
2. Harness 是否通过确定性检查。
3. 父 Agent 根据 `evaluation.md` 得出的语义判分。
4. human 对修复、跳过或延期的最终决策。

任意一层都不能覆盖或伪造另一层。一次失败后被 human 允许跳过时，原始 `fail` 仍应保留，并额外记录 `skipped` 决策。

### 临时环境与可信证据分离

`/tmp` 只用于运行中的隔离 workspace、HOME 和 Memsphere scope。运行完成后，CLI 把需要复查的内容规范化归档到 Eval Store。View 只依赖 Eval Store，不解析随机临时目录。

## 领域模型

### Evaluation Session

一次 Evaluation Session 对应一次“Agent 评测与协同修复”Procedure Run，是 human 在 View 中看到的完整评测过程。

Session 本身不另外创建一套工作流状态机。它以 Procedure Run 为控制记录，通过 Procedure Run ID 关联一个或多个 Batch。

### Evaluation Suite

Suite 是一组静态、可版本化的 Case 定义，例如 `self-bootstrap-step1`。Suite 保存在仓库的 `evals/` 目录并进入 Git。

### Evaluation Batch

Batch 是一次 `memsphere eval run` 调用产生的批量执行：

- 首次通常选择 Suite 的全部 Case。
- 修复后可以只选择受影响的 Case，形成下一个 Batch。
- Batch 固定记录 Suite 快照、Agent、模型、运行参数和父 Procedure Run。
- 已完成 Batch 的证据不可被后续复测覆盖。

### Case

Case 是 Suite 中的静态测试定义，包含任务、评分标准、fixture 和可执行 Harness 契约。

### Case Execution

Case Execution 是某个 Batch 内一个 Case 的执行记录：

- 一个 Case Execution 只启动一个独立子 Agent 会话。
- 同一 Batch 内不会为同一个 Case 建立多个 Attempt。
- Artifact validator 的多次反馈和修正是同一个 Case Execution 的 Validation Round。
- 修复后再次运行该 Case 时，进入新的 Batch，而不是覆盖旧 Case Execution。

### Evaluation Decision

Evaluation Decision 是 Procedure Agent 和 human 对 Case Execution 作出的判断，包括语义判分、问题分类、处理决策和理由。它通过关联 Procedure 的标准 Artifact 上报，不通过 Eval CLI 的专用判分命令写入。

### 关系

```text
Evaluation Session (Procedure Run)
  +-- Batch 1: 首次执行全部 Case
  |     +-- Case 001 Execution: 一个独立 Agent
  |     +-- Case 002 Execution: 一个独立 Agent
  |     +-- ...
  +-- Batch 2: 修复后执行部分 Case
        +-- Case 002 Execution: 一个新的独立 Agent
        +-- Case 006 Execution: 一个新的独立 Agent
```

## Suite 与 Case 定义

### 目录约定

```text
evals/
  <suite-id>/
    suite.yaml
    suite.md
    README.md
    cases/
      <case-id>/
        case.yaml
        task.md
        evaluation.md
        fixtures/
```

- `suite.yaml` 只保存 CLI 必须解析的机器配置，例如稳定 ID、Case 顺序、默认并发和超时。
- `suite.md` 保存 Suite 目的、能力覆盖和组级通过策略，供 Procedure Agent 和 human 阅读。
- `task.md` 是发送给被测 Agent 的最小任务。
- `evaluation.md` 是父 Agent 或 human 使用的语义评分标准，不得发送给被测 Agent。
- `case.yaml` 保存 CLI 和 Harness 必须解析的机器契约，例如任务文件、fixture、预期产物和确定性检查入口。
- `fixtures/` 保存该 Case 的初始工作区内容。

机器配置不得复制 `evaluation.md` 的全部语义，也不得把参考答案变成隐藏的确定性检查。只有需要代码解析、执行或验证的内容才进入 YAML。

### Suite 配置最低要求

`suite.yaml` 至少表达：

- 配置版本。
- Suite ID 和展示名称。
- 有序 Case ID 列表。
- 默认并发数。
- 单 Case 默认超时。

Agent 和模型不固化到 Suite；它们由当前 Procedure 根据本轮评测目标传入。

### Case 配置最低要求

`case.yaml` 至少表达：

- 配置版本。
- Case ID 和展示名称。
- `task.md`、`evaluation.md` 和 fixture 的相对路径。
- 预期工作区产物的路径规则。
- Memory 是否必须保持不变。
- 可执行 Harness 契约或 validator 入口。

路径必须解析在对应 Suite 或 Case 目录内，禁止通过 `..` 或符号链接越界读取任意文件。

## Eval CLI 需求

### 命令边界

Eval 命令组只提供两个面向 Agent 的子命令：

```bash
memsphere eval run <suite-id> \
  --run <procedure-run-id> \
  --agent <agent-id> \
  --model <model-id>

memsphere eval read <batch-id> [--case <case-id>]
```

允许 `run` 提供少量执行参数，例如重复的 `--case`、`--concurrency` 和 `--timeout`，但不得为上层流程决策增加 `judge`、`skip`、`retry`、`fix`、`approve` 等子命令。

### `memsphere eval run`

`run` 必须一次完成：

1. 读取当前 scope 配置并定位 `evals/<suite-id>`。
2. 校验 Suite、所选 Case 和机器配置。
3. 校验 `--run` 指向当前 scope 中可用的 Procedure Run。
4. 创建 Batch 记录并在启动子 Agent 前输出 Batch ID。
5. 为每个 Case 创建独立的临时 Memsphere scope、workspace 和 HOME。
6. 安装本轮需要的 Skill、Memory 和 fixture。
7. 按 Suite 默认值或参数限制并发执行；每个 Case 使用独立 Agent 会话。
8. 持续写入 Batch 和 Case Execution 状态，使 View 可以在运行中刷新。
9. 收集最终回答、events、stderr、token usage、工作区输出和子 Procedure Run。
10. 执行 Memory 完整性、产物路径和其他确定性 Harness 检查。
11. 如 validator 返回可修复错误且 adapter 支持续接，按专项需求在同一 Agent 会话中反馈并重新验证。
12. 将规范化证据原子写入 Eval Store，并输出本 Batch 的简要结果。

省略 `--case` 时运行 Suite 中的全部 Case；多次传入时只运行指定 Case：

```bash
memsphere eval run self-bootstrap-step1 \
  --run run-xxx \
  --agent traex \
  --model gemini-3-flash \
  --case 002-respect-suggestion-boundary \
  --case 006-request-missing-evidence
```

这次调用产生新的 Batch，用来表达部分复测，不修改首次 Batch。

### 同步与输出语义

- `run` 默认保持前台运行并持续输出简洁进度，不要求 Agent 先启动后台任务再轮询多个命令。
- Batch ID 必须在子 Agent 启动前写入 stderr 或结构化事件，方便 human 在 View 中立即定位。
- stdout 的最终输出必须是稳定的结构化摘要，至少包含 Batch ID、执行状态、各 Case Execution 状态、Harness 状态和证据引用。
- 某个 Case 的 Agent 退出异常或 Harness 失败时，只要 Batch 已完成收集，CLI 仍应返回一个完整 Batch 结果；不能因单个 Case 失败而丢失其他 Case 的证据。
- 命令非零退出码用于 Suite 无效、Batch 无法创建、Store 无法写入或执行器整体崩溃等基础设施错误，不能被解释为 Case 的语义判分。

### `memsphere eval read`

`read` 是 Agent 恢复上下文和判分时的稳定读取入口：

- 读取 Batch 时返回 Batch 配置、整体执行状态和全部 Case 摘要。
- 使用 `--case` 时返回该 Case 的任务引用、执行事实、Harness 结果、最终回答、产物清单、Validation Round 和子 Procedure Run 引用。
- 默认输出应简洁，不内联全部 events、stderr 或大文件内容。
- 详细证据通过稳定逻辑引用或受保护路径提供；Agent 明确读取时再加载。
- `read` 不提供全局 list。当前 Procedure 已经持有自己创建的 Batch ID，human 则通过 View 查看历史列表。

### 不提供的子命令

- 不提供 `eval list`：View 负责 human 浏览，Procedure Run 负责 Agent 追踪本次 Batch。
- 不提供 `eval status`：`run` 默认同步，`read` 可以读取运行中的当前状态。
- 不提供 `eval validate`：`run` 必须在执行前自动校验。
- 不提供 `eval retry`：部分 Case 复测仍调用 `run --case ...` 并创建新 Batch。
- 不提供 `eval judge` 或 `eval skip`：使用 Procedure Artifact 和 human 步骤表达。
- 不提供 `eval inspect`：由 `read` 的 Batch 和 Case 两种粒度覆盖。

## Procedure 协同需求

### Session 关联

`eval run` 必须接收父 Procedure Run ID，并将以下字段写入 Batch：

- `procedure_run_id`
- 发起时的 Procedure 逻辑引用和快照版本。
- 发起 Eval 的 Procedure step ID。
- 同一 Procedure Run 中的 Batch 顺序。

View 通过该关联把多个 Batch 组织成一次 Evaluation Session。Eval Store 不另外复制 Procedure 的流程状态。

### 标准判分 Artifact

“Agent 评测与协同修复流程”应使用稳定 Schema 上报批次判分，至少包含：

- Batch ID。
- Case ID。
- 语义判分：`pass` 或 `fail`。
- 问题分类：模型行为、Case 设计、产品能力、执行环境或其他。
- 判分理由。
- 证据引用。
- 建议处理方式。

评分必须遵循任务和 Memory 的约束边界，不能因参考答案过度收窄 Agent 的合理发挥。

### human 决策 Artifact

human 确认步骤应记录：

- 接受判分。
- 要求调整问题分析。
- 立即修复后复测。
- 记录需求并交由后续开发。
- 允许跳过。

允许跳过不会把原始 `fail` 改成 `pass`；View 应同时展示原始判分和 human 处理决定。

### 复测语义

Procedure 根据 human 确认结果选择 Case，再次调用 `eval run --case ...`。新的 Batch 与原 Batch 通过同一 Procedure Run 关联，View 展示从首次失败、修复到复测结果的时间线。

当最新一轮仍有未通过且未被 human 允许跳过的 Case 时，Procedure 不应结束。产品能力缺失且不能在本流程立即修复时，应创建独立需求文档，并由 human 决定本次是否跳过。

## 状态模型

### Batch 执行状态

- `created`：Batch 已持久化，尚未准备 Case。
- `preparing`：正在创建隔离环境。
- `running`：至少一个 Case Agent 正在执行。
- `collecting`：子 Agent 已结束，正在收集证据或运行 Harness。
- `completed`：全部 Case 的执行证据已收集完成。
- `error`：Batch 基础设施无法完成执行或持久化。

`completed` 只代表批量执行完成，不代表全部 Case 通过。

### Case Execution 状态

- `queued`
- `preparing`
- `running`
- `completed`
- `timed_out`
- `adapter_error`
- `cancelled`

Case Execution 状态描述子 Agent 生命周期，不描述语义正确性。

### Harness 状态

- `pending`
- `passed`
- `failed`
- `invalid`
- `unsupported`

`invalid` 用于隔离污染、Memory 被修改、读取被保护的参考答案等不能通过修改产物消除的问题。`unsupported` 表示当前 adapter 或 validator 无法执行已声明能力，不能静默当作通过。

### 语义判分与处理决定

语义判分由 Procedure Artifact 表达：

- `pending`
- `pass`
- `fail`

human 处理决定独立表达：

- `unresolved`
- `fix_and_rerun`
- `record_requirement`
- `skipped`
- `accepted`

View 必须并列展示这些状态，不能压缩成一个容易误解的 `status`。

## 隔离与执行环境

### 临时目录

CLI 可以在系统临时目录中创建如下内部结构：

```text
/tmp/memsphere-eval-runtime/<batch-id>/<case-id>/
  .memsphere/
  workspace/
  home/
```

- 被测 Agent 的 cwd 和允许直接访问范围是 `workspace/`。
- Case 专属 `.memsphere/` 位于 `workspace/` 的父目录，Agent 可以通过 CLI 的向上发现机制使用 Memory，但无需直接浏览 Store。
- `evaluation.md`、参考答案、validator 实现和父级结果目录不得位于被测 Agent 的允许读取范围。
- 每个 Case 拥有独立 `.memsphere/`、workspace、HOME 和 Agent 上下文，不共享前一个 Case 的 Procedure Run 或会话状态。
- 同一 Case 的 Validation Round 复用原 workspace 和原 Agent 会话。

### 临时环境保留

临时目录不是可信结果。运行结束后默认可以清理；调试参数可以要求保留失败 Case 的临时环境，但 View 和 `eval read` 不能依赖它继续存在。

### Agent Adapter

每个 adapter 只负责对应 Agent 的通用调用能力：

- 启动新会话。
- 在指定 cwd 和 HOME 下执行。
- 传入模型和任务。
- 流式保存事件和 stderr。
- 返回最终回答、退出状态和 token usage。
- 在支持时续接同一会话以处理 validator 反馈。

adapter 不包含某个 Suite、Case、Memory 或评分标准的专用逻辑。Codex、TraeX 和未来 Agent 必须通过统一接口返回规范化执行结果。

## Eval Store

### 配置与位置

当前 scope 配置增加可选 `evalsRoot`，默认值为 `.memsphere` 内的 `evals` 目录，与 `memoryRoot`、`runsRoot` 的解析方式一致：

```text
<scope>/.memsphere/evals/
```

Suite 源码仍位于项目的 `evals/`，进入 Git；Eval Store 是运行数据，默认不进入 Git。

### 持久化结构

```text
.memsphere/evals/
  batches/
    <batch-id>/
      batch.json
      definitions/
        suite.yaml
        suite.md
        cases/
      cases/
        <case-id>/
          result.json
          prompt.md
          final-answer.md
          events.jsonl
          stderr.log
          workspace-output/
          validations/
          procedure-runs/
```

- `batch.json` 是 Batch 配置、状态、父 Procedure Run 和 Case 索引的可信记录。
- `definitions/` 保存本轮所用 Suite、Case、任务、评分标准和配置的只读快照或等价内容寻址快照，保证后续修改源码后仍可复查当时标准。
- `result.json` 保存规范化 Case Execution、Harness、usage 和证据清单。
- `workspace-output/` 保存去除 `.git`、Skill 安装缓存和 HOME 数据后的工作区结果快照。
- `validations/` 保存每一轮 validator 结果、反馈和 Artifact diff。
- `procedure-runs/` 保存或引用被测 Agent 在 Case scope 中创建的 Procedure Run 证据。

Procedure Agent 的判分和 human 决策仍由父 Procedure Run Store 负责；Eval Batch 通过 `procedure_run_id` 关联，不复制两份可变结论。

### 一致性要求

- Batch ID 在创建时生成，后续不可变化。
- 状态和索引文件使用临时文件加原子替换，避免 View 读取半写入 JSON。
- 已完成 Case 的原始证据不可被后续 Batch 修改。
- 并发 Case 只写自己的目录；Batch 汇总由协调器串行或原子更新。
- 所有 Artifact 读取都必须验证路径仍位于对应 Batch 或 Case 根目录。
- 大文件和事件流应按需读取，Batch 列表接口不能内联全部内容。

## View 需求

### 一级入口

在当前 `Memory`、`Task` 之外增加 `Eval` 一级视图。第一阶段 Eval 页面只负责观察和导航，不直接启动 Agent 或修改评测定义。

### Evaluation Session 列表

列表按父 Procedure Run 聚合 Batch，至少展示：

- Procedure 名称和 Run ID。
- Suite。
- 最近使用的 Agent 和模型。
- 当前运行状态和 Case 进度。
- 最新语义判分的 pass、fail、pending 数量。
- human 已允许跳过的数量。
- Batch 数量。
- 开始时间、最近更新时间、总耗时和 token usage。

没有父 Procedure Run 或关联 Run 已损坏的 Batch 应显示为异常记录，不能导致整个 Eval 页面加载失败。

### Session 详情

Session 详情按时间展示：

- 首次全量 Batch。
- 判分与问题分析 Artifact。
- human 确认结果。
- 修复摘要或需求文档引用。
- 后续部分 Case 复测 Batch。
- Procedure 的最终评测摘要。

页面应突出“当前最新结论”，同时保留历史失败，不把复测通过显示成首次即通过。

### Batch 详情

Batch 详情以表格展示每个 Case：

- Case ID 和名称。
- Case Execution 状态。
- Harness 状态。
- 语义判分。
- human 处理决定。
- Agent、模型、耗时和 token usage。
- Artifact 数量和错误摘要。

运行中的 Batch 自动刷新或提供稳定刷新能力。单个 Case 数据损坏时，该行显示错误，其余 Case 仍可查看。

### Case 详情

Case 详情至少提供：

- 发送给被测 Agent 的任务。
- Suite 和 Case 定义版本。
- 最终回答。
- 工作区产物，Markdown 和表格尽量复用现有 View 渲染能力。
- Harness 检查及其来源。
- Validation Round、反馈内容和 Artifact diff。
- 父 Agent 的判分理由和证据引用。
- human 的处理决定。
- 子 Procedure Run 的步骤和 Artifact。
- events 和 stderr，默认折叠并按需加载。

原始临时目录、HOME 和内部配置只在调试区域显示；目录不存在时不影响归档证据展示。

### 数据接口

View 服务应从 Eval Store 暴露只读接口，至少支持：

- Session 列表。
- Session 详情及其 Batch 列表。
- Batch 详情。
- Case Execution 详情。
- 受保护的 Artifact 和日志读取。

接口返回领域对象，不直接返回服务器目录树。所有 ID 和 Artifact 路径必须进行解码和越界校验。

## 典型运行流程

```text
human 启动 Agent 评测与协同修复 Procedure
  -> Procedure Agent 选择 Suite、Agent 和模型
  -> memsphere eval run 批量运行全部 Case
  -> CLI 持久化 Batch，View 可实时观察
  -> Procedure Agent 使用 eval read 获取证据并独立判分
  -> Procedure Agent 通过 run report 上报结构化判分与问题分析
  -> human 确认修复、记录需求或允许跳过
  -> Procedure Agent 完成可立即处理的修复
  -> memsphere eval run --case ... 创建部分复测 Batch
  -> 最新 Case 均 pass 或得到 human 跳过许可
  -> Procedure 完成并上报最终摘要
```

## 失败与恢复

- 单个 Agent 超时或 adapter 失败时，Batch 继续收集其他 Case，失败 Case 保留完整错误证据。
- CLI 进程异常退出后，已落盘状态仍可被 `eval read` 和 View 读取；残留 `running` 状态应被识别为中断，而不是永久运行。
- Eval Store 写入失败时不得声称 Batch 完成。
- validator 不支持某项声明能力时记录 `unsupported`，不能自动通过。
- 父 Procedure Run 不存在、已损坏或无法读取时，Batch 保留执行证据并在 View 标记关联异常。
- Case 设计问题仍记录为本轮 `fail`；修正 Case 后通过新 Batch 复测。
- 产品能力缺失不要求评测 Procedure 立即开发，应记录需求并由 human 决定本轮是否跳过。

## 实现建议

### 模块边界

建议将 shell 编排重写为 TypeScript 领域模块：

```text
src/eval/
  types.ts
  suite.ts
  store.ts
  executor.ts
  evidence.ts
  harness.ts
  runners/
    codex.ts
    traex.ts
src/commands/eval.ts
```

- `suite.ts` 负责定义发现、解析、校验和快照。
- `store.ts` 负责 Batch、Case Execution 和证据持久化。
- `executor.ts` 负责并发、状态转换、超时和清理。
- `runners/` 隔离不同 Agent CLI 的调用差异。
- `harness.ts` 提供通用验证接口，并复用 Artifact 验证专项能力。
- `commands/eval.ts` 只做参数解析、调用领域服务和格式化输出。

View 在现有服务中增加 Eval Store API 和 `Eval` 页面，但不应把 Eval 逻辑堆进浏览器脚本；列表聚合、路径保护和证据读取应由服务端完成。

### 实施阶段

1. 定义 Suite、Case、Batch、Case Execution 和状态类型。
2. 建设 Eval Store、原子写入、定义快照和读取 API。
3. 实现 `memsphere eval run/read` 与统一 Agent adapter。
4. 迁移当前批量 shell 行为，使用 fake adapter 完成并发和失败恢复测试。
5. 接入 Artifact Harness、Validation Round 和同会话反馈。
6. 更新“Agent 评测与协同修复流程”的 Artifact 契约和 Batch 关联。
7. 增加 View 的 Session、Batch 和 Case 页面。
8. 迁移现有 self-bootstrap Suite 配置，删除不再使用的公开脚本和 Trial 文档。
9. 使用 Codex 和 TraeX 各完成一次真实端到端验收。

### 迁移边界

- 不兼容现有准备后再运行的两段式 shell 命令。
- 不迁移历史 `/tmp` Batch。
- 新 CLI 验收通过后，删除公开的 `prepare-case.sh`、`prepare-cases.sh` 和 `run-cases.sh`；必要的 adapter 能力进入 `src/eval/runners`。
- 现有 `task.md`、`evaluation.md`、fixture 和 Suite 说明继续保留，补充最小 `suite.yaml` 和 `case.yaml`。
- `evals/README.md` 更新为以 Procedure 和 `memsphere eval run/read` 为入口。

## 验收标准

### CLI 与批量执行

1. Agent 在一个 Procedure Run 中只需执行一次 `memsphere eval run <suite>`，即可运行 Suite 的全部 Case。
2. 一个包含至少六个 Case 的 Suite 能按配置并发执行，每个 Case 使用独立 Agent、workspace、HOME 和 Memsphere scope。
3. `run --case A --case B` 只执行指定 Case，并创建新的 Batch。
4. CLI 在启动子 Agent 前产生并持久化 Batch ID；运行中 View 可以读取进度。
5. 一个 Case 超时或退出异常不会终止其他 Case，也不会丢失已经收集的证据。
6. `eval read <batch>` 返回简洁 Batch 摘要，`eval read <batch> --case <case>` 返回该 Case 的完整证据索引。
7. Eval 命令组不提供 judge、skip、retry、fix、approve、list、status、validate 或 inspect 子命令。

### 隔离与证据

8. 每个 Case 的子 Agent 只能在自己的 workspace 中执行任务，并通过 CLI 使用父级 Case scope 中的 Memory。
9. 被测 Agent 无法在允许范围内读取 `evaluation.md`、参考答案、其他 Case 结果或 validator 实现。
10. Memory 执行前后哈希、最终回答、events、stderr、工作区输出、usage 和子 Procedure Run 均进入规范化证据。
11. 临时运行目录被删除后，`eval read` 和 View 仍可完整展示归档结果。
12. Suite 源码在 Batch 完成后发生修改，不影响 View 复查该 Batch 当时使用的任务和评分标准。
13. Artifact 路径和 API 参数无法越过对应 Batch 或 Case 根目录。

### 状态与 Procedure 协同

14. Case Agent 正常退出、Procedure Run `done`、Harness `passed` 和语义 `pass` 分别记录，不被合并成一个状态。
15. Procedure Agent 可以把 Batch 判分作为 Schema Artifact 上报，并在 View 中与对应 Batch 和 Case 关联。
16. human 允许跳过失败 Case 后，View 同时保留原始 `fail` 和 `skipped` 决策。
17. 修复后复测产生新 Batch，View 能展示首次失败、修复决定和后续通过的完整时间线。
18. 仍有最新 Case 未通过且未获跳过许可时，评测 Procedure 不会错误结束。
19. 产品能力缺失可以记录为独立需求并延期开发，不要求评测 Procedure 当场修复。

### Artifact Harness

20. Artifact 首次违反可确定约束时，validator 生成可追溯且不泄露参考答案的错误。
21. adapter 支持续接时，错误反馈给同一个子 Agent，并在原 workspace 修正后重新验证。
22. 每次 Validation Round 的反馈、结果、Artifact diff 和 token usage 均可在 Case 详情中查看。
23. 隔离污染、Memory 被修改或读取受保护答案时判为 `invalid`，不能通过后续 Artifact 修正洗掉。

### View

24. View 增加独立 `Eval` 入口，并按 Procedure Run 聚合多个 Batch。
25. Session 列表能展示 Suite、Agent、模型、运行状态、Batch 数量、Case 统计、耗时和 token usage。
26. Batch 详情能独立显示每个 Case 的执行、Harness、语义判分和 human 决策。
27. Case 详情能展示任务、最终回答、Artifact、Validation Round、事件、日志和子 Procedure Run。
28. 运行中的 Batch 可以刷新进度；单个损坏 Case 不影响其他 Session、Batch 和 Case 的展示。
29. View 第一阶段没有启动外部 Agent、编辑 Case 或直接执行修复的入口。

### 回归

30. 使用 fake adapter 覆盖并发、超时、adapter 失败、CLI 中断恢复、原子写入和路径越界测试。
31. 使用 self-bootstrap Step0、Step1 和 Step2 验证 Suite 迁移和批量结果展示。
32. Codex 和 TraeX 各至少完成一次“全量运行 -> 判分 -> human 确认 -> 部分复测 -> Procedure 完成”的真实验收。

## 待决问题

1. `suite.yaml` 和 `case.yaml` 的最终字段 schema，应在实现前结合 Artifact Harness 专项确定。
2. Procedure 判分 Artifact 和 human 决策 Artifact 是建设两个独立 Schema，还是合并为一个可增量填写的 Schema，需要结合 Run Artifact 的更新语义决定。
3. 失败 Case 的临时环境默认立即清理还是短期保留，需要结合磁盘成本和调试体验确定；无论如何不能影响可信证据读取。
4. 不同 Agent adapter 的 token usage 字段如何归一化，以及是否保存供应商返回的实际费用，需要单独定义稳定结构。
5. 父 Procedure Run 被归档后，Eval Session 在 View 中的默认可见性和归档入口需要与现有 Task 归档语义统一。
