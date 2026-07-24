---
id: 20260720-agent-semantic-artifact-validation
type: feature
created: 2026-07-20
run_id: run-20260720-155634z-7f1b7846
cancelled_at: 2026-07-25
---

# Artifact Review Epic

## 需求管理摘要

当前代码只实现了确定性的 Artifact type、format 和 schema validator，尚未实现 Artifact Review Loop、Agent Reviewer、Identity/Role/Permission、Decision Policy、申辩、完整 View 和最终决策链路，因此当前状态为 todo。

本需求已经拆分为六个可独立验收、严格串行推进的子 Change。本文件保留总体目标、领域约束和历史设计基线，不再作为一次开发迭代直接实施；具体范围和验收以当前阶段的子 Change 为准。

## 串行子需求

1. [`20260720-artifact-review-control-plane`](../../../completed/20260720-artifact-review-control-plane/change.md)：已完成；配置与 Role Binding、解析鉴权、脱敏快照。
2. [`20260720-artifact-review-human-loop`](../../../completed/20260720-artifact-review-human-loop/change.md)：已完成；Human-only Review Loop、`review wait` 和多轮修改闭环。
3. [`20260720-artifact-review-agent-acp`](../../../completed/20260720-artifact-review-agent-acp/change.md)：已完成；ACP Agent Reviewer、专用 CLI 和混合审阅。
4. [`20260720-artifact-review-decision-governance`](../20260720-artifact-review-decision-governance/change.md)：已取消；Decision Policy、Challenge、Decision、Override 和完整权限治理。
5. [`20260720-artifact-review-evidence-view`](../../../completed/20260720-artifact-review-evidence-view/change.md)：已完成；多轮 Review Evidence View。
6. [`20260720-artifact-review-compatibility-hardening`](../20260720-artifact-review-compatibility-hardening/change.md)：已取消；原 syntax/data migration、旧 Task Review 退役和全局可靠性收口需求。

后一个子 Change 只有在前一个完成开发、验证并达到可接受状态后才进入开发。六个子 Change 全部满足验收标准后，才对本 Epic 做整体验收并进入 accepting。

## 需求

建设由 `run report` 自动触发的 Artifact Review 核心能力，让重要 Artifact 通过 Human/Agent 多轮审阅、投票、修改和决策后再推进 Run；同时具备完整控制平面、ACP Reviewer、Human View、Review Evidence、Workspace 变化证据、迁移和可靠性保障。具体实施边界以六个串行子 Change 为准。

## 背景

Artifact Contract v2 已通过代码 Validator 校验 `type -> format -> schema`，解决可确定执行的类型、编码和结构规则。`asserts` 与 `suggests` 仍是自然语言契约，代码无法可靠判断 Artifact 是否满足其语义。

需要在 `memsphere run report` 中引入独立 Reviewer，对 Artifact 进行语义检查并提供有依据的改进建议。Reviewer 可以是 Agent 或 human，也可以同时存在多个。

## 总体设计基线

### 整体目标

在现有确定性 Artifact Validator 之后增加独立语义审阅，使 Run 只有在 Artifact 满足适用 asserts 且通过授权决策后才接受产物并推进，同时允许具名 Agent 或 human 以 executor、reviewer 身份参与协作。

### 采用的 Statement

- 当前 Memory Store 中没有与 Agent 调用、语义审阅、身份权限或 Artifact 验收直接相关的 Statement，本迭代按无额外仓库规范继续。
- `Memory 访问规则`、`Memory 撰写规则`、`Memory 解读与应用规则`只约束 Memory 操作，不作为本功能需求约束。

### 当前迭代范围

- 保留现有 `type -> format -> schema` 确定性校验，并在其通过后执行语义审阅。
- 引入 Identity、Permission、Role、Role Binding 和 Decision Policy，分别回答“是谁、允许做什么、承担什么职责、职责在何处生效、决策如何形成”；详细规则见“领域模型变更”。
- 本地 Agent 统一通过 ACP 调用；memsphere 实现 ACP Client，不实现 Agent 私有 CLI 的 `CommandRunner`。Agent 未原生支持 ACP 时由外部 Adapter 提供兼容。
- 支持一个或多个具名 Agent Reviewer，并允许 human Identity 承担 executor、reviewer 或决策者。
- 审阅 Action asserts、对应 Schema asserts，以及最终交付时适用的 Procedure asserts；suggests 和无断言来源的改进意见始终非阻塞。
- Reviewer 返回逐条、可校验、可追溯的结构化结论；`violated` 和 `unknown` 不得自动通过。
- 支持修改后重新提交、executor 申辩、授权决策和显式 override；override 不能绕过确定性 Validator。
- 保存失败 attempt、Reviewer 评价、申辩、决策、权限依据和 Agent 执行元数据，并在 CLI 与 View 中展示。

### 后续范围

- 远程 ACP transport、A2A 和跨服务 Agent 调用。
- majority、quorum、加权评价等更多 Decision Policy 聚合规则。
- 将 Decision Policy 用于发布放行、策略变更等 Artifact 验收之外的决策场景。
- 用户自定义 Role、组织级策略继承和通用资源权限系统。
- Reviewer 执行测试、访问网络或使用可变工作区的受控证据采集。
- 跨 Run 语义结果缓存、成本预算、Reviewer 质量评测和自动选择。

### 交付物

- 更新后的需求与配置说明。
- Identity、Permission、Role、Role Binding 和 Decision Policy 的领域模型及持久化快照。
- 本地 ACP Client、Agent 启动配置和结构化 Reviewer 执行接口。
- 接入语义审阅与决策的 `memsphere run report` 流程。
- 申辩、决策、override 和失败 attempt 的 CLI 能力。
- 展示 Reviewer、评价、证据、决策与权限来源的 View。
- 覆盖通过、拒绝、unknown、超时、非法输出、无权限、多 Reviewer 和重报的自动化测试。

### 验收标准

- 未通过代码 Validator 的 Artifact 不会启动 Reviewer，也不会写入 Run。
- 本地 Agent Reviewer 仅通过 ACP 启动和通信；核心代码不解析 Agent 私有终端输出。
- 每条适用 assert 都具有 `satisfied`、`violated` 或 `unknown` 结论及证据；泛化偏好不能阻塞提交。
- 不满足 Decision Policy 的 Artifact 不会推进 Run；合法决策通过后只生成一次受理 Event。
- 无权限 Identity 无法评价、申辩、决定、override 或修改 Policy。
- 多 Reviewer 严格按 Run 启动时快照的 Decision Policy 合成，执行中的配置变化不影响当前 Run。
- 失败 attempt 可供修正和审计，但不会污染已接受 Artifact；相同输入不得无意义重复调用 Reviewer。
- CLI 与 View 能完整还原执行者、Reviewer、评价、申辩、决策和权限依据。

### 待确认项

- Agent 启动信息、模型选择与凭据分别放在项目配置还是用户配置中。
- human Reviewer 的首期交互由现有 Run 步骤承载，还是增加独立 Review 待办。
- 失败 attempt 的默认保留期限及 Artifact 敏感内容清理策略。

以上待确认项在实施方案阶段确定，不改变本轮功能范围。

## 目标

- 在 Artifact 被 Run 接受前检查适用的自然语言 asserts。
- 将 suggests 和额外质量建议作为非阻塞反馈。
- 支持多个具名 Agent 或 human 承担执行和审阅职责。
- 将授权资格与决策规则分开配置。
- 保留评价、申辩、决定和覆盖操作的完整证据。

## 非目标

- 不使用 Agent 代替现有 type、format 和 schema Validator。
- 不允许任何语义决策绕过确定性代码校验。
- 不把特定 Agent、模型或供应商写死在 Procedure 中。

## 校验链路

```text
memsphere run report
  -> prepare Artifact
  -> 代码校验：type -> format -> schema
  -> 语义审阅：asserts -> improvements
  -> 权限检查与结果决策
  -> commit Artifact 并推进 Run
```

代码校验失败时不得启动 Reviewer。语义审阅未通过或无法判断时，Run 保留在当前步骤；只有代码校验和语义决策均通过后，Artifact 才能成为 Run Event。

代码校验与语义审阅在实现中必须保持独立。现有 Artifact Validator 继续负责确定性契约；语义审阅使用单独的 Semantic Review Plan 和执行接口。

## 领域模型变更

### 为什么需要五个对象

当前 Run 只区分 `actor: agent | human`，它能表达执行方式，却不能表达具名执行者、多人协作、权限依据和决策归属。新增模型把以下问题分开：

| 问题 | 领域对象 |
| --- | --- |
| Alice、Rod、human 分别是谁？ | Identity |
| 读取、提交、评价、决定分别允许做什么？ | Permission |
| executor、reviewer 各自包含哪些 Permission？ | Role |
| 哪个 Identity 在当前作用域承担哪个 Role？ | Role Binding |
| 一项决策需要哪些输入、如何形成结论、由谁决定？ | Decision Policy |

前四个对象构成简化 RBAC：Role 是 Permission 集合，Role Binding 在作用域内把 Role 授予 Identity。授权不是独立领域对象，而是根据这三者计算出的结果。Decision Policy 只编排决策，不授予 Permission。

```text
Identity --Role Binding(scope)--> Role --contains--> Permission

Decision Policy --requires--> Assessment
                --resolves--> Decision
                --selects--> authorized decider
```

这些对象属于控制面。一次实际决策产生的 Decision Attempt、Assessment、Challenge 和 Decision 属于运行证据，只引用控制面快照。

### Identity：是谁

Identity 表示可被稳定引用和审计的具体主体，例如 `human`、`alice` 或 `rod`。

- `kind: human` 表示通过 CLI 或 View 参与的人。
- `kind: agent` 表示通过 ACP 调用的 Agent，并引用 ACP Agent、模型和启动配置。
- Identity 只描述主体，不声明其在某个 Run 中是 executor 还是 reviewer，也不直接携带业务权限。
- Identity ID 在其配置作用域内唯一且稳定；显示名称、模型或 Agent 版本变化不能改变历史审计中的主体引用。
- Agent 的凭据不进入 Run；Run 只快照非敏感身份信息和实际执行元数据。

### Permission：允许做什么

Permission 是不可再拆的操作能力。首期使用固定 Permission 集合：

| Permission | 含义 |
| --- | --- |
| `artifact.read` | 读取被授权的 Artifact 和审阅上下文。 |
| `artifact.write` | 创建或修改候选 Artifact。 |
| `artifact.submit` | 提交候选 Artifact 进入校验。 |
| `decision.assess` | 为一项决策提交评价和非阻塞建议。 |
| `decision.challenge` | 针对评价提交申辩与证据。 |
| `decision.decide` | 根据评价与申辩作出决定。 |
| `decision.override` | 在 Policy 无法正常满足时作出例外决定。 |
| `run.assign_roles` | 创建或修改当前 Run 的 Role Binding。 |
| `run.manage_policy` | 修改当前 Run 的 Role 或 Decision Policy。 |
| `run.cancel` | 终止当前 Run。 |

Permission 只表达资格，不指定本次操作由谁执行。`decision.override` 只能覆盖语义决策，任何 Identity 都不能借此绕过 type、format 或 schema Validator。

首期 Permission 的强制边界是 memsphere 管理的 Artifact、Run、审阅数据和通过 ACP 暴露给 Agent 的能力，不宣称接管操作系统中的任意文件或进程权限。需要更强隔离时仍由 workspace、HOME 和进程沙箱保证。

### Role：承担什么职责

首期固定两个 Role 名称，不支持任意自定义 Role：

- `executor`：执行 Action、产出并提交 Artifact，必要时提交申辩。
- `reviewer`：依据 asserts 和 suggests 独立评价 Artifact。

Role 是 Permission 集合，不限定 Identity kind。human 和 Agent 均可承担任一 Role。内置最小权限如下：

| Role | 最小 Permission |
| --- | --- |
| `executor` | `artifact.read`、`artifact.write`、`artifact.submit`、`decision.challenge` |
| `reviewer` | `artifact.read`、`decision.assess` |

`decision.decide`、`decision.override`、角色分配和策略管理不属于最小权限。受信任的 Run 配置可以把这些 Permission 加入 `executor` 或 `reviewer` Role，但不能直接授予 Identity。需要指定某个 Identity 决策时，先将其绑定到具备权限的 Role，再由 Decision Policy 选择该 Identity。

### Role Binding：在什么范围承担职责

Role Binding 把一个 Identity 与一个 Role 关联到明确作用域，并使该 Identity 在作用域内获得 Role 的 Permission。首期支持 Run 默认绑定和 Action 覆盖绑定：

- Run Role Binding 为整个 Run 提供默认 executor 和 reviewer。
- Action Role Binding 可以覆盖当前 Action 的 executor 或 reviewer，用于 human Action、指定专家审阅等场景。
- 每个当前 Action 必须解析出且只能解析出一个 executor，可以解析出多个 reviewer。
- 同一 Identity 可以拥有多个 Role Binding，但默认不得评价自己在同一 Action 中提交的 Artifact；Decision Policy 显式允许时除外。

Procedure 的 `actor: agent | human` 继续表达 executor 的种类约束。解析后的 executor Identity kind 必须与其一致；`actor` 不再被视为具体参与者。

### 授权计算

一次操作被允许，当且仅当：

1. Identity 在目标作用域存在匹配的 Role Binding。
2. 被绑定 Role 包含目标 Permission。
3. 操作满足资源状态等确定性前置条件。

默认拒绝。Role 或 Role Binding 变化时创建新修订；已有运行证据继续引用旧修订。只有拥有 `run.assign_roles` 或 `run.manage_policy` 的 Identity 才能修改对应配置。

### Decision Policy：决策如何形成

Decision Policy 是通用决策规则，不局限于 Review。它描述：

- `kind`：决策类型；首期只实现 `artifact_acceptance`。
- `assessments`：需要哪些 Role 或 Identity 提交多少份 Assessment。
- `resolution`：如何把合法 Assessment 合成为自动结论；首期支持单份和 `unanimous`。
- `exceptions`：`violated`、`unknown`、超时和非法输出如何处理。
- `decider`：无法自动形成结论时，由哪个 Role 或 Identity 决定；最终必须解析为唯一 Identity。
- `allow_self_assessment`：是否允许 executor 评价自己的 Artifact，默认 `false`。

Decision Policy 不授予 Permission。Identity 只有同时具备目标 Permission，并被当前 Decision Policy 选中，才可以提交 Assessment 或普通 Decision；需要绕过未满足的决策条件时，还必须具备 `decision.override`。Policy 点名某个 Identity 不能绕过授权检查。

语义 Review 是 `artifact_acceptance` 决策的一种 Assessment 来源。未来发布放行、策略变更等场景可以定义其他 `kind`，复用同一决策模型而不复用 Artifact 审阅细节。

### 配置示例

以下 YAML 只用于说明对象关系，最终配置位置和字段在实施方案中确定：

```yaml
identities:
  - id: human
    kind: human
  - id: alice
    kind: agent
    acp_agent: codex
    model: gpt-5.4
  - id: rod
    kind: agent
    acp_agent: gemini-cli
    model: gemini-3-flash

roles:
  executor:
    permissions:
      - artifact.read
      - artifact.write
      - artifact.submit
      - decision.challenge
      - decision.decide
  reviewer:
    permissions:
      - artifact.read
      - decision.assess

bindings:
  - identity: alice
    role: executor
    scope: run
  - identity: rod
    role: reviewer
    scope: run
  - identity: human
    role: reviewer
    scope: run

decision_policy:
  kind: artifact_acceptance
  assessments:
    role: reviewer
    identities: [rod]
    required: 1
  resolution: unanimous
  allow_self_assessment: false
  decider:
    role: executor
```

这个配置表示 Alice 负责执行、Rod 负责审阅。`executor` Role 包含 `decision.decide`，因此 Alice 具备决策资格，并被 Decision Policy 选为 decider。human 虽绑定了 `reviewer`，但未被当前 Policy 选中，不会收到此次 Assessment 任务。

### 生命周期与快照

1. Run 启动时解析 Identity、Role、默认 Role Binding 和 Decision Policy，并写入 Run 快照。
2. 进入 Action 时应用 Action Role Binding 覆盖，解析 executor、Reviewer 和 decider。
3. 每次提交 Assessment、Challenge 或 Decision 前执行授权检查和 Policy 选择检查。
4. Reviewer 产生结构化 Assessment，Decision Policy 聚合为通过、拒绝或待决定。
5. decider 根据 Assessment 与 Challenge 产生 Decision；override 单独记录权限依据和原因。
6. Role、Role Binding 或 Policy 经授权修改时创建新修订；已有 attempt 保留旧修订，后续 attempt 使用新修订。

Run 必须保存每次操作命中的 Role Binding、Role、Permission、Policy 修订和 Identity，保证 View 能回答“谁基于什么权限作出了什么决定”。

### 领域不变量

- 一个 Action 恰好有一个 executor；Reviewer 数量由 Decision Policy 决定。
- 未绑定到当前作用域的 Identity 没有 Role Permission，不能参与受控操作。
- Decision Policy 指定 decider 不等于授予 `decision.decide`。
- decider 必须解析为唯一 Identity；指向多人 Role 时必须进一步指定 Identity。
- executor 与 reviewer 默认不能是同一 Identity。
- 确定性 Validator 失败时，不创建语义审阅或裁决。
- 配置修改不改写既有 attempt 的身份、权限和 Policy 证据。

## Agent 调用

memsphere 作为 ACP Client 按需启动本地 ACP Agent 子进程，通过 JSON-RPC over stdio 创建 Session、提交审阅任务、接收事件和结构化结果，并处理权限请求、超时与关闭。

```text
SemanticReviewService
  -> ACP Client
     -> 原生 ACP Agent
     -> 外部 ACP Adapter -> Agent SDK 或私有 CLI
```

- memsphere 只依赖 ACP，不针对 Codex、Claude、Gemini、TraeX 等 Agent 实现私有调用协议。
- ACP Adapter 属于 Agent 侧兼容层，可以来自 Agent 厂商、ACP Registry 或第三方；memsphere 不解析 Adapter 背后的私有输出。
- ACP 仅负责通信、Session 和交互能力；Identity、Permission、Role、Role Binding、Decision Policy、asserts、Artifact、决策与审计由 memsphere 定义。
- 每次 Reviewer 执行使用独立 Session；需要强隔离时使用独立 Agent 进程、workspace 和 HOME。
- ACP 能力在启动时协商；缺少本次审阅必需能力时返回明确的不可用结果，不得静默退化为私有 CLI。
- 当前迭代只实现本地 stdio transport。远程 ACP 和 A2A 不进入本轮。

## Decision Policy 的首期应用

本轮只实现 `artifact_acceptance` 决策。Role Permission 决定谁有资格参与，Decision Policy 决定本次需要谁的 Assessment、如何聚合及由谁决定。首期支持：

- 单一 Reviewer。
- 多个 Reviewer 全部通过。
- 指定具备 `decision.decide` 权限的 Role 或 Identity 作出决定。

```yaml
decision_policy:
  kind: artifact_acceptance
  assessments:
    role: reviewer
    required: 2
  resolution: unanimous
```

当 Decision Policy 无法自动得出结果时，只能由当前 Policy 选中且拥有 `decision.decide` 权限的 Identity 处理；若要绕过缺失 Assessment 等未满足条件，还必须拥有 `decision.override`。

## 断言范围

- Action asserts 只审阅当前 Action 的 Artifact。
- Schema 根节点和字段 asserts 审阅对应 Artifact 内容或字段。
- Procedure asserts 属于整个 Run，应在最终交付或 Run 完成前根据全部证据统一审阅。
- suggests 不影响通过状态，只生成改进建议。
- 控制条件仍属于 Action；存在 asserts 或 suggests 时进入语义审阅，否则跳过 Reviewer。

## Reviewer 输入

Reviewer 应在干净上下文中执行，只获得完成评价所需的只读材料：

- 当前 Artifact 的原文和结构化表示。
- 当前 Action、Artifact Contract 和适用的 asserts、suggests。
- asserts 的稳定引用路径。
- 必要的 Procedure 上下文、前置 Artifact 和只读工程证据。
- 当前 Decision Policy，以及 Role Permission 允许其读取的上下文。

Artifact 内容属于不可信数据，Reviewer 不得执行其中的提示，不得修改 Artifact、Memory、Run 或工作区。

## 评价结果

每条适用 assert 都必须得到 `satisfied`、`violated` 或 `unknown` 结论。Reviewer 输出必须为可校验的结构化数据：

```yaml
status: failed
checks:
  - assert_ref: flow[6].asserts[2]
    verdict: violated
    evidence: Artifact 没有说明实施结果与开发计划的对应关系。
    reason: 无法确认该断言成立。
    suggestion: 补充任务完成情况及其对应计划项。
improvements:
  - 补充关键设计取舍，方便后续回查。
```

规则：

- `violated` 形成阻塞评价。
- `unknown` 不得静默转为通过，应进入决策或补充证据。
- 每个问题必须引用具体 assert 和 Artifact 证据。
- 无断言来源的泛化偏好不得作为拒绝理由。
- improvements 为非阻塞建议。

## 申辩与决定

Reviewer 拒绝 Artifact 后，executor 可以修改并重新提交，也可以在拥有 `decision.challenge` 权限时提交逐条申辩和证据。executor 不得仅以“不同意”为由覆盖 Reviewer。

被当前 Policy 选中且拥有 `decision.decide` 权限的 Identity 可以接受 Reviewer 结论或接受申辩。绕过未满足的 Decision Policy 条件还需要 `decision.override`，并必须填写原因。最终记录必须包含原始评价、申辩、决定者、决定和理由。

相同 Artifact hash、assert 集合和 Reviewer 版本不得在没有新证据的情况下重复执行，避免无效循环和重复消耗。

## 审计记录

Run 必须快照：

- Identity、Permission、Role、Role Binding 和 Decision Policy。
- Reviewer runner、model、提示版本和执行时间。
- Artifact hash 与适用 assert 集合。
- 每个 Reviewer 的结构化评价。
- executor 的申辩。
- 最终决定、权限依据和覆盖原因。

失败评价不得推进 Run 或写入已接受 Artifact。是否在独立 attempts 区域保存失败候选和评价，需要在实现设计中确定。

## 开放问题

- Agent runner 配置位于用户级、项目级还是两级组合。
- Agent 超时、不可用、无合法输出时如何降级。
- 多 Reviewer 除 unanimous 外是否需要 quorum 或 majority。
- Reviewer 可以读取哪些工作区证据，是否允许执行只读测试。
- 失败候选与评价是否持久化，以及在 View 中如何展示。
- Procedure 或 Action 是否需要声明 Decision Policy，还是只在 Run 启动时绑定。

## 验收标准

- 未通过代码 Validator 的 Artifact 不会启动语义 Reviewer。
- 适用 asserts 全部具有可追溯的语义结论。
- 无权限 Identity 不能评价、申辩、决定、覆盖或修改 Policy。
- 多 Reviewer 的结果严格按照快照的 Decision Policy 合成。
- 拒绝和 unknown 不会推进 Run；合法决定通过后只产生一次 Artifact Event。
- View 可以查看身份、角色、权限依据、评价、申辩和最终决定。

## 技术与测试方案

由六个串行子 Change 在各自开发前补充。本 Epic 只维护跨阶段不变量和最终端到端验收，不重复维护实现方案。

## 开发任务

按“串行子需求”顺序逐项开发；当前六个子 Change 均为 todo，尚未开始。

## 验收结果

尚未开始。六个子 Change 全部完成并通过回归后，再记录本 Epic 的整体验收结果。

## 取消记录

- 取消日期：2026-07-25。
- 取消原因：本文件在需求澄清后被拆分为多个可独立验收的子 Change，本身不再作为开发迭代执行，继续保留在 active 会与子需求重复追踪。
- 已交付的控制平面、Human Review、ACP Agent Reviewer 和 Evidence View 分别由对应子 Change 记录并归档；Decision Governance 已由提需方明确取消。
- 尚需推进的兼容、运行时与 Eval 能力由当前独立 Change 继续管理，不以本 Epic 的旧 Identity/Role、Challenge/Override 或 Workspace diff 契约约束后续实现。
- 关联 Run `run-20260720-155634z-7f1b7846` 已完成并归档；该 Run 完成的是需求拆分和设计梳理，不代表原始大范围 Epic 整体交付。
