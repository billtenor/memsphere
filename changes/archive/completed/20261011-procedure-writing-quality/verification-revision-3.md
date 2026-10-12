# 实现评审第三轮验证报告

## 修改与证据口径

本轮按 Human 正式要求修改：验收工具不进入常规 CI；撰写与 review 各涉及一份复杂业务 Procedure。公开 task 直接描述业务，不叙述版本合并或拆分历史。生产 Memory、Skill 和 CLI 未改动。

证据保存在 `evidence/revision-3/`，先前两轮材料保留为历史。初次启动的任务因暴露版本迭代措辞被替代，`A-superseded-attempt-1/`、`B-superseded-attempt-1/` 保存原始执行，不用于最终通过结论。

## 手动工具检查与 CI

- `evals/procedure-writing-quality/runtime-policy.test.mjs` 手动检查代理继承、会话隔离、namespace 顺序与拒绝根目录挂载：3 项通过。
- 测试分组／调度相关测试：2 项通过。
- 常规 all 和 runtime-core 测试收集清单均不包含该工具测试，all 现为 141 个文件。真实 Agent runner 没有接入 npm test、test:ci 或 CI workflow。
- B 的合并样本只有一份 Procedure、没有 call；从独立 Project 校验引用与语法通过。
- `git diff --check` 通过。

本轮只调整 eval 材料、手动测试路径和说明，未重复无关全量回归。上一轮最终生产实现全量为 142 文件零失败、1169 用例通过和 1 个既有平台跳过；本轮不把该历史数字称为新运行的全量结果。

## 真实 review

B 首次独立 review：10/10 命中，无正确保留项误报。13 条意见中 8 条覆盖原 10 个考点，其余 5 条有效补充问题已独立核查。完整 review、逐项映射、额外问题判断、原始 Agent 事件、完整读取规范记录及 namespace 探针分别见 B-review.md、B-grading.json 和 B-final-attempt-1/。

B 的通用任务记录 Run 因试验环境不允许提权，停在对齐认知待上报；完整 review 已交付。未宣称内部 Run 完成，不以该生命周期状态作为产物行为验收依据。

## 真实撰写与一次失败

去除版本迭代措辞后的首次 A 判 9/10：A8 未能保证演练执行失败但对账仍可通过时，也进入修改和重新批准路径。首次输出、原始事件及失败评分见 A-failed-output/、A-failed-attempt-1/、A-first-grading.json，没有隐去或计作通过。

为消除任务中“演练失败”与“对账未通过”的理解歧义，公开 task 明确原业务要求：任一失败都需修改、重新批准，只有演练执行成功且对账验证通过才能交付。隐藏评分和生产规范保持不变。新 Project、新 Agent 只读取调整后的独立业务任务及规范，没有收到历史输出、隐藏考点或定向纠错。最终输入冻结在 A-business-clarified-frozen-inputs.json；B 的已冻结输入未改。

最终 A 通过 10/10：一份业务 Procedure、2 份复用 Schema，含 4 个 while、2 个 if、无 call。执行成功与对账通过分别声明 boolean，任一失败都进入分析、修订、Human 重新批准路径；两者同轮成功才退出至最终报告。完整候选、原始事件、最终答复、隔离与 CLI smoke、逐项评分见 A-final-output/、A-final-attempt-2/、A-final-grading.json。最终全部基线文件不变，规范读取有原始事件支持。

两项真实验收最终通过；一次失败与任务澄清清楚披露，不称第一次 A 输出全部通过，也不把业务澄清带来的结果变化单独归因于规范质量。

## Memory 证据与适用范围

生产 Memory 自第二轮校验后未修改。ChangeSet：`change-20261012-040452784z-0c41dc69`；校验 passed；摘要 `a530351e06c775a17b40d9cc5ef21ab25bcc77717a97a656345edb60b370a614`。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

验证限定于本轮公开任务、当前 gpt-6.1-sol medium 与 Linux 隔离配置。未执行被撰写的业务流程、跨模型评测或历史批量治理；业务任务澄清对结果有影响，不宣称首次输出稳定全部通过或所有 Agent 均能保证正确。
