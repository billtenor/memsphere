# 实现与验证成果第四轮验收材料

本轮接纳研发和架构第三轮的证据阻塞意见：不强化已存在的业务要求来让测试通过，也不拼接不同输入下的 A/B 结果。当前版本与证据详见 review-revision-4-summary.md、verification-revision-4.md。

## 可审查的修正

1. A task 恢复首次独立业务描述的原冻结文本，逐字节与 evidence/revision-3/A-failed-attempt-1/task.md 相同。隐藏评分不变，公开任务仍无版本迭代细节。
2. `reserved-memory/system-memory/statements/memsphere-procedure-writing-rules.yaml` 与 Project 副本新增“业务完整性”章节：逐项核对触发条件、必要输入、处理路径和完成条件，不把分别表达的执行、验证、审批状态合并，所有失败路径与退出前提均需落实。它是通用生产引导，未写入验收业务的具体答案。原职责/去重/作用域 10 条规则保留，当前有效强制规则为 11 条，根部仅概览。
3. A/B 使用同一最终规范摘要、完整冻结后分别启动新 Project 和新 Agent，整轮真实重测。此前失败、任务强化结果和被替代执行记录全部保留，不作为本轮成绩。

前序已确认修改继续保留：中文名“流程记忆撰写规范”，语法/实体 Schema 不引用撰写质量规则，Skill/撰写/评审入口读取完整统一规范；手动工具移出常规 CI；两个案例各仅一份复杂 Procedure。

## 本轮真实与自动验证

A/B 本轮首次整轮执行均 10/10。A 单份 Procedure 有 3 个 while、2 个 if、无 call，执行与对账状态分开，任一失败改进并重新批准，同轮两者成功才交付。B 找全全部 10 个预埋点，无正确保留项误报，另 3 条有效意见已独立核查。

evidence/revision-4/ 提供冻结输入、结束基线核对、A-output/、B-review.md、behavior-grading.json、两次原始事件/模型配置/隔离探针/CLI smoke。请独立检查任务恢复、规范读取、逐项评分与旧记录，不只引用汇总。

本轮 npm test 全量 141 文件零失败；用例数量与平台跳过见 regression-summary.json。相关 Reserved/Memory 3 个测试文件、typecheck、build、Store、Memory 变更级校验和差异格式检查通过；原始日志保留。不把旧的 142 文件或旧输入成绩作为当前结果。

当前最终 ChangeSet：change-20261012-040452784z-0c41dc69，passed，摘要 dd5ea3391ee801e98176c97007030cdc3c92503ad99bd8b9aaae46f1716d771b。View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

本轮仍仅 A/B 两项门槛，不新增实际修订门槛。结论限定于本轮冻结案例、当前模型和 Linux 环境；没有执行被撰写业务、跨模型评测或历史批量治理，不宣称所有 Agent 每次稳定正确。请区分亲自检查/复跑与仅引用的证据，临时 node_modules 链接不纳入提交。
