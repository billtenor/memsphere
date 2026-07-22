# Review Experience Analysis

## Conclusion

Artifact Review 当前是“质量有效、体验偏重、收敛不足”的状态。

它适合发现关键质量问题，尤其是多身份、多轮次、重渲染、保存失败和并发 revision 相关的交互 bug。但在小型需求开发中，当前机制容易把每个边界风险都变成 blocking，并通过重新 report 新 round 的方式拉长流程。

## What Worked

- 多角色视角有价值。研发、测试、架构 reviewer 分别从实现路径、浏览器回归、状态边界发现了问题。
- Review comment 通常带有文件位置、行为路径和预期修复方向，能帮助快速定位。
- Runner 最终能够基于 Human 意图和验证结果做裁量。

## What Felt Awkward

- Advisory request changes 和 decision request changes 在视觉和心理上太接近。即使 policy 只要求 decision unanimous，Runner 仍会感到 advisory request changes 像硬阻塞。
- 缺少 severity，导致“真实数据丢失 bug”和“建议增加覆盖”都可能叫 blocking。
- 修复一个有效问题后，新实现又暴露一个更窄边界，流程自然继续开新 round；如果没有强收敛机制，小需求容易变成长流程。
- Agent 环境失败与正常 review 意见混在同一个 Review 轮次中，导致流程看起来像代码质量问题，实际只是运行环境问题。
- CLI 输出经常包含完整 artifact 和大量历史内容，不利于快速判断当前动作。
- Artifact 的语义不够完整。Reviewer 很容易把本轮 Review 理解成“联合审查需求契约和验收说明两个文本 artifact”，而不是审查完整实现交付。这样会出现“文档自洽，所以通过”的错觉，但实际上没有证明代码实现正确。
- Reviewer 不一定知道自己必须看代码。除非 Review 输入包中显式包含 Implementation artifact，并在 prompt 中要求引用 implementation/code evidence，否则 reviewer 可能不会主动读取 diff、关键源码路径或测试覆盖。

## Desired Product Behavior

### Reviewer Output

Reviewer 应明确区分：

- 这是不是违反已确认需求。
- 是否有可复现路径。
- 是否会造成数据丢失、身份串写、权限问题或验收失败。
- 如果不修，是否可以作为后续风险接受。
- 它是否审查了 Implementation artifact 或具体代码路径。

只有满足上述强条件的问题才应标为 blocking。

如果 reviewer 没有审查 Implementation artifact，它可以评价需求契约、验证材料和交付说明的文本质量，但不能声明“实现正确”。如果 Implementation artifact 缺失或信息不足，reviewer 应把结论限定为“实现证据不足”，而不是直接通过。

### Artifact Package

Artifact Review 的审查对象应是完整交付包，而不是若干文本片段。一个实现类需求的交付包至少应包含：

- Requirement artifact：本轮要满足的需求契约。
- Implementation artifact：代码变更文件、关键 diff 摘要、实现路径、行为影响范围。
- Validation artifact：测试命令、测试结果、手工验收证据和未验证项。
- Review disposition artifact：对 reviewer comments 的采纳、拒绝、后续处理和验证说明。

Implementation artifact 是 reviewer 判断“实现是否满足需求”的最低输入。如果只提供 Requirement 和 Validation，reviewer 最多能判断叙述是否完整，不能独立判断实现是否可信。

### Runner Decision

Runner 应能做以下裁量：

- 接受真实 blocking 并记录已修复。
- 将非核心问题转 follow-up。
- 拒绝范围外或未证明的 advisory 意见。
- 在当前 round 内记录 hotfix 和验证结果后 approve，而不是被迫开新 round。

### Human Intent

Human 的明确意见应在 Runner 决策区显著展示。例如：

- “验收通过”
- “不需要继续采纳 advisory”
- “直接通过”

这不代表 Human 覆盖工程质量，但应帮助 Runner 判断业务接受度和流程收敛时机。

### Environment Failures

Agent execution failures 应独立成一个 execution health 区域：

- `failed to start`
- `provider error`
- `listen EPERM`
- `timeout`

这些失败需要 retry，但不应默认计入 artifact quality blockers。

## Suggested Interaction Shape

Review 默认摘要：

```text
Decision: can approve after Runner vote
Human: approve
Runner: pending
Implementation artifact: present
Advisory:
- blocking: 0 unresolved
- risk: 1
- suggestion: 2
Agent execution failures: 0 active
Latest validation: npm test 271/271, validate passed
```

每条 advisory comment 展开后可标记：

```text
Disposition:
- accepted-fixed
- accepted-followup
- rejected-out-of-scope
- rejected-not-blocking
- rejected-invalid
```

Runner approve 时系统生成审计摘要：

```text
Runner approved.
Blocking comments:
- comment-a: accepted-fixed, verified by npm test
- comment-b: rejected-not-blocking, reason...
Environment failures:
- retried successfully
```

## Non-Goals For This Requirement

- 不要求让 Review 变得“宽松”或默认通过。
- 不要求删除 agent reviewers。
- 不要求把每条 reviewer 意见都自动分类得完全准确；允许 Runner 纠正。
- 不要求本需求解决所有 agent execution 环境稳定性，只要求呈现和流程上分离。
