---
id: 20261011-procedure-writing-quality
type: improvement
created: 2026-10-11
completed_at: 2026-10-12
run_id: run-20261011-112126z-e4ece6f4
---

# 流程记忆字段职责、去重与约束作用域

## 需求

解决 action 混写、四字段职责不清、跨字段语义重复、局部要求滥用为全局规则，以及 Agent 实际撰写表现不稳定的问题。理想态、当前范围、后续范围与关联需求详见 requirement-contract.md。具体解决方案尚未确认，前面未提交的改动作为待评估素材纳入。

## 验收标准

详见 requirement-contract.md：A 为一次真实复杂流程子 Agent 撰写，B 为一次预先记录全部问题考点的独立子 Agent review；二者均通过才认可有效。检查字段归属、语义去重、作用域、必要约束保留，以及 review 的全部考点命中与误报。

## 向前兼容

结论：不需要向前兼容。未发现适用 stable Tag checkpoint；保留既有有效 Memory 与 CLI/DSL 行为作为回归基线。

## 技术与测试方案

需求契约第二轮已由 Human 与 Runner 通过。详见 implementation-plan.md，第二轮将修改清单按文件和位置列明，并补足真实验收启动与隔离方式。实际修订验证保留为后续建议，本轮验收仍为已确认的 A/B 两项；第二轮方案候选已准备，第一轮架构 Agent 超时后已按 Human 授权重试完成，四方意见已收齐。第二轮方案已提交，等待 Human 架构席位与研发、架构、测试 Agent 评审。

## 开发任务

已按通过的方案完成，任务清单见 tasks.md；本轮根据 Human 实现评审修改意见进一步调整规范组织与引用。

## 验收结果

需求阶段第一轮 Human 投要求修改，提出真实复杂流程撰写和预埋考点 review 两项验收；产品 Agent 第一轮通过。第二轮 Human 通过，Runner 已接纳需求；产品 Agent 第二轮提出实际修订验证缺口，记录 accepted-followup 并纳入方案。实现及首次 A/B 验收随后均已完成，历史结果见第一轮验证报告。

Review：review-20261011-112248z-c1c20e2b。当前 Round：round-20261012-031343z-ce9c2f71。

方案第一轮 Human 要求明确修改清单，研发/测试要求补足验收隔离和保持已确认验收范围。第二轮修订摘要见 implementation-plan-revision-2.md。

方案 Review：review-20261012-032158z-0af2608f，当前为第二轮。

方案第二轮 Human、研发、架构、测试均通过，Runner 接纳。开发计划已上报，生产引导、验收工具和真实 A/B 验收已完成；最终回归 142 文件通过，等待实现与验证成果评审。详见 implementation-summary.md、verification-report.md 和 behavior-verification.md。

实现与初始验证报告均已上报，当前提交完整实现与验证成果评审，Human 参与架构席位。代码、Memory 与证据尚未提交/归档。

## 实现评审第二轮修改

Human 在实现评审第一轮正式投要求修改：语法规则与实体 Schema 移除撰写质量规范引用；中文名改为“流程记忆撰写规范”；字段职责、语义去重、约束作用域的规则和对应正反例分别归入章节。此意见覆盖原方案 M7 中保留结构文档引用的安排，以本轮 Human 授权为准。

继续复用 review-20261012-041726z-16c4662b 和当前 Run，保留首次实现与验收的冻结材料，第二轮另行保存最终版本真实 A/B 验收和回归证据。

最终第二轮 A/B 均 10/10 通过，全量 142 文件零失败。第二轮实现材料已上报，Round：round-20261012-051030z-7b820762；等待 Human 架构席位正式投票与后台 Agent 评审。最终报告见 verification-revision-2.md。

## 实现评审第三轮修改

第二轮 Human 正式要求修改：验收工具测试移出常规 CI；撰写和 review 均改为单份复杂 Procedure，不靠两份流程及调用关系提高复杂度。相关任务、问题样本和评分已按意见调整，保留旧证据；新输入重新冻结并启动真实 A/B 验收。详见 review-revision-3-summary.md。

第三轮修改与最终验收已完成，A/B 最终均 10/10；保留一次 A8 失败与随后业务任务澄清的记录。第三轮实现材料已上报至 round-20261012-053251z-a0bb5d6a，等待 Human 架构正式投票与三方 Agent 评审。详见 verification-revision-3.md。

## 第三轮评审意见与第四轮修改

Human 第三轮通过。研发要求按方案整轮重测，架构指出任务强化不能证明原输入下的生产引导质量；Runner 接纳两条阻塞意见并投要求修改。恢复首次单流程业务 task，补充生产规范的业务完整性检查，重新冻结并整轮执行 A/B；历史结果不删除或继续作为当前最终成绩。详见 review-revision-4-summary.md。

第四轮恢复原 task、增加生产业务完整性规范后整轮 A/B 均 10/10，全量 141 文件零失败。材料已上报至 round-20261012-054322z-825b081d，等待 Human 架构投票与研发、测试、架构 Agent 评审。最新验证报告为 verification-revision-4.md。

第四轮成果评审已由 Runner 接纳：Human、研发、架构通过；测试关于 Schema 缺失的意见经持久文件原始摘要与引用校验复核，以 rejected-invalid 处置。当前进入产品负责人交付验收，尚未归档/commit。

## 最终验收与交付

第四轮实现成果已接纳；产品负责人交付验收 Human 与产品 Agent 均通过，Runner 已接纳，无待处理阻塞。最终 A/B 10/10，全量 141 文件零失败，1166 用例通过、1 个既有平台跳过；全部旧失败及最新原始证据保留。按交付规范完成状态更新并归档，随后创建本轮 commit；PR 由 Human 决定。最终 Memory ChangeSet 为 change-20261012-040452784z-0c41dc69，passed，摘要 dd5ea3391ee801e98176c97007030cdc3c92503ad99bd8b9aaae46f1716d771b。
