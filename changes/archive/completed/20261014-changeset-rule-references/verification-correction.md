# 初次验证中发现并修正的候选跳转问题

playwright-cli 初次检查在跳转后记录了候选摘要接口 400：尚未形成 checkpoint 的 View ChangeSet 详情原本可展示其基线候选，但带 change 参数的普通详情/摘要接口只接受 checkpoint。先前 `.memory-title` 存在断言可能命中导航瞬间的旧正文，不能独立证明目标成功加载。

未把初次结果视为最终通过。停止尚未完成的全量测试，保存日志为 evidence/full-tests-before-navigation-fix.txt；该次 exit 130 是本轮主动停止，不是全部测试通过。

按已确认验收 3 修正：没有 checkpoint 时复用同一 `withMemoryChangeDetailSnapshot()` 的完整候选；一次性候选摘要、全文与详情索引不写长期缓存。已有 checkpoint 仍复用原 preview 机制。UI 回归与 playwright-cli 均等待目标 canonical header 和实际规则正文，避免旧 DOM 瞬时状态误判。

修正后受影响测试 30/30，通过最终 typecheck/build；playwright-cli 的目标正文、展开、收起和跳转通过，没有此前 400。连续请求 12 次后的堆快照无保留临时 preview 路径。最终全量回归重新运行，结果记录在 verification-report.md。

范围未变：仍修复 ChangeSet 内既有命题引用/候选导航契约，不新增 syntax、数据格式、跨 Project 访问或发布操作。此前已上报的功能实现摘要是前一次冻结产物；本说明及验证报告补足之后发现的遗漏，成果评审材料以最终 Workspace 和本说明为准。
