# 实现与验证成果第三轮验收材料

本轮响应 Human 第二轮正式 request_changes 及随后的任务措辞补充意见。请评审当前最终工作区和本轮验证材料，不以历史验收成绩代替当前输入的结果。

## 本轮实际改动

- `evals/procedure-writing-quality/runtime-policy.test.mjs`：原 test 目录工具测试移到 evals，手动运行。README 给出启动前检查命令；常规 npm test、test:ci 和 CI workflow 均不启动模型，测试收集列表确认不包含此工具测试。
- `cases/001-complex-writing/task.md`、`evaluation.md`：仅撰写一份复杂业务 Procedure，演练后逐项对账并据本轮结果重试；公开 task 直接描述业务，不暴露版本合并过程。证据补齐、风险分支、Human 版本批准和失败修改再批保留。A9 同步检查单 Procedure 内部验证，不要求子流程与 call。
- `cases/002-seeded-review/task.md`、`evaluation.md`、`fixtures/memories/procedures/release-candidate.yaml`：仅 review 一份复杂 Procedure；验证步骤合并于演练循环，原验证 Procedure 文件删除，共享证据 Statement 仍保留为规范引用。全部 10 个预埋问题和正确保留项保留。
- 生产 Memory、Skill、安装逻辑与 CLI 未变。历史方案和前两轮评审快照保留；本轮 Human 意见覆盖原验收用子流程提高复杂度的安排。

详细响应见 review-revision-3-summary.md，完整结果及限制见 verification-revision-3.md。

## 验收证据与失败披露

最终 A 和 B 均 10/10 通过。A 一份 Procedure 含 4 个 while、2 个 if，无 call；B 完整 review 命中全部 10 个考点，无正确项误报，并提出 5 个有效补充问题。

公开任务修正前的两次执行标为 superseded。独立业务描述的首次 A 为 9/10，A8 未保证演练执行失败但对账可通过时也修改再批；原输出、评分、事件均保留。随后把原“演练失败须修改再批准”要求明确为执行失败或验证未通过均重试，评分和生产规范未变；新 Project、新 Agent 没有历史输出或定向纠错，最终 A 10/10。请特别检查这一任务澄清的影响，不能把它称作第一次输出全部通过或单独归因于生产规范。

证据入口为 `evidence/revision-3/`：最终冻结输入、A-first-grading.json、A-final-grading.json、B-grading.json、A-final-output/、B-review.md，各 attempt 的原始事件／模型配置／隔离探针／CLI smoke。B 通用任务内部 Run 未上报，但完整 review 交付，未宣称该 Run 完成。没有新增第三个验收门槛。

手动工具 3 项、测试分组 2 项通过；常规 all/runtime-core 收集验证通过，all 当前 141 文件；样本及实际候选 Store 校验、差异格式检查通过。本轮仅修改 eval 与手动工具路径，没有重复无关全量回归；前轮生产实现全量结果仅作为历史背景。

## 最终 Memory 与审查范围

ChangeSet `change-20261012-040452784z-0c41dc69`；passed；摘要 `a530351e06c775a17b40d9cc5ef21ab25bcc77717a97a656345edb60b370a614`。生产 Memory 自该校验后未修改，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

请独立核查业务要求是否完整、字段职责与去重、最小作用域、单流程复杂度、全部考点映射与误报，以及 CI 是否只收集普通产品测试。区分亲自检查、复跑和仅引用的证据；本次结论限定于当前冻结案例与模型环境，不宣称跨模型稳定性。临时 node_modules 依赖链接不作为提交内容。
