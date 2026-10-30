# 开发计划

依据：已通过技术方案 artifact-25394f2b-f485-46f5-a4cb-9b0ed2f31eb2。Human、研发、架构和测试第六轮均投通过，Runner 已批准。无阻塞意见；四项风险和四条建议保留在该轮评审记录。

1. 施工前门禁：Human 确认 change.md 的“需求范围修订汇总”及新增验收标准。确认前只准备计划，不修改产品实现。Run 不另起。
2. 配置与身份：runner_agents schema、draft/保存链路、安装/queue 能力检测、设置界面；统一 adapter、身份变量和 queue 绝对路径。检测失败不得回退另一个接收会话。
3. 会话状态：修改 CommandState 与 Store，用直接拼接 ID、无 ID Continue、显式 enter、reads 按会话归属；所有回执和帮助同步替换，按 graph 入口矩阵控制副作用。
4. daemon 与 View：Home 单例、受认证控制端点、服务意图文件、启停命令、View 接管及期望状态恢复。进程内 View 请求错误隔离与关闭释放测试；严重进程故障按已批准任务恢复边界处理。
5. DaemonTask：Home 模型与 Store、review-wait 处理器、单一 status、取消原因、任务去重与 queued 恢复、固定轮次即时渲染、queue 失败查询与显式 retry；不持久化正文。
6. 评审派发：沿用现有 ACP worker，前台一次补派、daemon 认领恢复补派，assignment 级启动互斥；轮询不派发。wait 按配置选择同步/异步，保持共有权限/渲染逻辑；按 Human 最新指令删除 --sync。
7. 第六轮风险落实：控制握手增加协议版本（首期 v1），不兼容时拒绝登记并提示 daemon restart，不静默读写不兼容记录；模型记录按当前 schema 校验，未知类型/非法记录隔离报告，不自动迁移或删除。旧 running 的 execution_interrupted 固定 stage=recovery。首期历史保留无自动清理，记录增长风险。
8. 验证：增加队列绝对路径与 daemon PATH 不同测试；登记时身份/能力无效无任务/daemon/queue 测试；协议不兼容、View handler 抛错仍可处理任务、error.stage fixture；加所有已批准方案中的模块/CLI/daemon/浏览器和 Windows smoke 边界。
9. 同步产品资源：reserved-memory 源与当前 Project 副本、manifest、Skill/文档；对最终差异运行 Store 和变更级校验。
10. 先受影响测试再完整回归：typecheck、npm test、build、memsphere validate、memory change validate；真实 Agent 双端验证，记录尚未验证或环境阻塞项。
11. 正式实现验收、交付报告、commit/PR、全部适用 CI、Human 合入与结果确认，再清理本轮本地分支；沿用既定流程和授权边界。

上述风险采用最小可验证边界；若实际实现需要改变拓扑、兼容范围、命令行为或新增 Memory syntax 关键字，回到方案确认，不由施工自行扩展。


## Human 最新交付补充（2026-10-29）

在当前 acceptance Step 重审修订后的需求、完整方案及实现，之后再进入产品交付评审。本次交付额外包含 `changes/active/20261029-graph-run-backtracking/change.md`，仅交付需求概述，不实施回溯能力。正式提交与PR清单需包含它，最终由Human合入master；不得误纳入既有未跟踪graph Procedure或临时node_modules链接。


修订4：按Human限定，仅移除ValueStore单记录可独立承担的调用方锁；新增跨进程同/异会话和CAS冲突测试，更新方案、盘点和新候选。其他跨记录/跨资源问题暂不改造；原始证据和逐轮验收材料留Run，不进入Git提交清单。
