---
id: 20260720-artifact-review-decision-governance
type: feature
created: 2026-07-20
run_id: run-20260720-155250z-6abf85a5
cancelled_at: 2026-07-22
---

# Artifact Review Decision Policy 与治理

## 需求

在 Human/Agent Reviewer 均可参与 Review 后，完整启用 Decision Policy 和控制平面治理。Policy 决定所有 Assignment 结束后如何汇总 Vote，以及超时、自审、Challenge、Decision 和 Override 如何影响 Review；Identity、Role Binding 和 Permission 决定谁有资格执行操作。

本需求是父 Epic 的第 4 个串行子需求，目标是让 Review 决策可配置、可授权、可挑战、可审计。

## 范围

- 完整实现 `artifact_acceptance` Decision Policy：
  - Reviewer、Decider、Review Manager Role。
  - `all_assigned` Round 完成条件。
  - `any`、`unanimous`、`min_approvals` 汇总。
  - `request_changes`、`abstain`、缺席、超时、Agent 失败和非法输出语义。
  - `allow_self_assessment`，默认 false。
- Round 等待所有已分配 Reviewer 进入终态后再计算，不因提前达到票数而丢弃意见。
- 运行时逐操作执行 Identity -> Role Binding -> Role -> Permission -> Policy 选择检查，至少覆盖 artifact read/write/submit、decision assess/challenge/decide/override、run read/assign_roles/manage_policy/cancel。
- 新增 Agent CLI：
  - `run review challenge --review --body-file`
  - `run review decide --challenge --outcome --reason-file`
  - `run review override --review --outcome --reason-file`
- Human 在 View 中完成等价的 Challenge 裁决、Decision 和 Override；正常 Reviewer 仍只使用 Comment/Vote/Submit。
- Challenge 引用 Round/Vote/Comment和证据，Review 重新进入待决；`review wait` 可继续等待同一 Review 的裁决结果。
- Decision 支持维持原结果、要求新一轮、接受 Artifact 或取消 Session 等定稿结果；每种结果对 Action 和 wait 输出有唯一语义。
- Override 需要独立权限和必填理由，只能覆盖 Review 决策，不能绕过确定性 Artifact Validation。
- 每个 Round 固化脱敏 Identity、Permission、Role、Role Binding、Policy revision 和授权依据；后续配置变化不影响已有决策。
- View/CLI 可解释 Policy 计算、授权来源、拒绝原因和全部治理事件。

## 不做事项

- 不新增远程 Agent 协议或改变 ACP Reviewer 执行。
- 不实现加权、quorum、Reviewer 分组、组织级继承等高级策略。
- 不采集 Workspace Snapshot 或实现完整历史 diff View。
- 不废弃旧 Task Review，不迁移历史 Review 数据。
- Override 不允许修复或掩盖 type/format/schema Validation 失败。

## 验收标准

- any、unanimous、min approvals 在全部 Assignment 终态后按配置产生唯一 Round Result；提前达标不会短路其他 Reviewer。
- request_changes、abstain、超时和失败的行为完全由合法 Policy 决定，任何未定义/非法组合在 validate 阶段失败。
- Executor 自审默认被拒绝；显式允许且同时拥有 assess Permission 时才能建立并提交 Assignment。
- submit、assess、challenge、decide、override、assign role、manage policy、cancel 均有允许/拒绝矩阵；越权操作不改变状态并留下审计。
- Challenge 必须有权限、理由和目标引用；Action 在唯一授权 Decision 前不会推进。
- Decision 只接受当前 Binding 中具备 decide Permission 且被 Policy 选中的唯一 Identity；结果与 `review wait` 行为一致。
- Override 需要独立 Permission 和理由，追加保存且不修改原 Vote、Round Result 或 Challenge；确定性 Validation 失败无法 Override。
- config/Memory 在 Run/Round 后变化不影响既有快照和结果；CLI/View 可展示脱敏 revision、Binding 来源和授权依据。
- 并发 Challenge/Decision/Override、重复命令和服务重启不会产生两个生效决策或重复推进。
- Human/Agent 混合 Review、Human-only Loop、ACP 故障和无 Review Run 回归通过。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 前置：`20260720-artifact-review-agent-acp` 及其前置子需求。
- 后续：`20260720-artifact-review-evidence-view`。

## 技术与测试方案

待开发前补充。

## 开发任务

尚未开始。

## 验收结果

尚未开始。

## 取消记录

2026-07-22，需求方确认当前决策系统已能满足现阶段需要，并认为本需求存在过度设计，因此明确请求取消。本需求尚未进入开发，不做实现验收。
