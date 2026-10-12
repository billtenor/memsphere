# 实现评审第四轮验证报告

## 结论与最终输入

恢复 A 首次独立业务任务的冻结文本，在新增业务完整性规范后整轮重测，A/B 均 10/10 通过。本轮不拼接旧成绩、不用任务强化代替生产改进。

A 的 task 与 evidence/revision-3/A-failed-attempt-1/task.md 逐字节一致；评分保持不变。新增的生产规范要求核对触发条件、必要输入、处理路径和退出前提，区别业务分别表达的执行、验证、审批状态。A/B 都使用同一最终规范摘要，独立 Project 和无历史上下文的新 Agent；没有收到旧失败点或评分答案。整轮基线、任务/评分/Skill/规范摘要启动前冻结，结束后全部基线文件均未修改，见 evidence/revision-4/frozen-inputs.json 和 baseline-check.json。

## 实际行为检查

- A：10/10。唯一业务 Procedure 有 3 个 while、2 个 if、无 call，1 个复用方案 Schema。证据不足时 Human 补充；高风险 Human 缓解意见；每轮演练前当前版本 Human 审批，否决后意见、修订、再审；执行成功和对账通过分别表达，任一失败都改进，下一轮重新批准，同一轮两者成功才交付。风险内容和报告内容规范位于对应字段，格式/必填契约没有在 action/asserts/suggests 重述，全局仅指定工单边界。
- B：10 个考点全部命中，无正确保留项误报。10 条 review 意见中 7 条具体覆盖原 10 个考点，另 3 条有效意见指出执行失败路径、Human 意见输入、方案契约和版本衔接问题；正确边界、字段语义、非强制建议和控制流保留。

具体候选、原 review、逐项映射、额外问题核查见 evidence/revision-4/A-output/、B-review.md 和 behavior-grading.json；原始事件、模型配置、最终答复、独立 namespace 探针与 CLI smoke 见 A-attempt-1/、B-attempt-1/。实际输出及 B 样本从正确隔离 Project 重新进行 Store 校验通过，A 子 Agent 执行 ChangeSet 校验通过。没有执行业务流程或发布候选，不将临时内部记录 Run 的生命周期作为行为通过依据。

## 生产和自动验证

新增章节后，原 10 条强制规则保持有效投影且新增 1 条业务完整性规则；根部无散落 asserts。源文件与安装副本一致。相关 Reserved/Memory 测试 3 个文件通过，build、typecheck、Store、Memory 变更级校验通过，git diff --check 通过。

手动验收工具仍不在常规 CI：test 目录没有其测试文件；公开任务只描述业务，两个案例各只有一份业务 Procedure。手动工具和测试分组检查沿用第三轮通过结果，相关实现本轮未改。

本轮 npm test 全量：141 文件零失败，1166 用例通过、1 个既有 Windows 专用用例在 Linux 跳过。原始日志和统计见 evidence/revision-4/full-tests.log 与 regression-summary.json；没有用历史全量数字代替当前结果。

## 当前最终 Memory 证据

ChangeSet：change-20261012-040452784z-0c41dc69；passed；内容摘要 dd5ea3391ee801e98176c97007030cdc3c92503ad99bd8b9aaae46f1716d771b。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

## 历史失败与限制

第三轮旧措辞试验被替代；首次独立业务 task 的 A8 失败；之后任务强化得到的 A 通过不能证明原输入的引导质量，且未整轮重测。研发/架构指出这两个问题后，Runner 接纳并要求修改；原始失败、强化后的结果、评审意见均保留，第三轮报告只作历史。本轮恢复原 task、修正生产规范并完整重新执行 A/B，才作为当前验收依据。

本轮是单次实际行为验证，不证明任意模型或每次写作都稳定正确；未做跨模型/平台、历史批量治理或业务运行验证。实际修订仍是后续建议，不增加第三个门槛。

## 第四轮测试意见核查

测试提出方案 Schema 未保留，但本轮 A-output 在提交前已有 Procedure 与 Schema 两份原始文件，并无旧验证子流程。Runner 亲自核对源字节及字段规范，仅用持久证据构造合法四类目录、完成 Store/引用校验，A2/A3/A5/A10 评分不变。文件来源和 SHA256 见 A-output-manifest.json，校验见 persisted-A-store-validation.log。首次直接把平铺输出目录作为 Memory Root 失败是缺少四类目录的组织问题；按原内容构造四类目录后通过，未改变或补写候选内容。该缺失意见按 rejected-invalid 处置，不改已有评分或生产规范。
