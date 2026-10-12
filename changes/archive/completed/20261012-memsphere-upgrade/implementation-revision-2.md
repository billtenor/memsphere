# 实施与验证方案第二轮修订摘要

第一轮 Human、架构 Agent、测试 Agent 通过；研发 Agent 提出一条阻塞与一条风险。Runner 判断两项意见有效并要求修改，本轮均接受。

1. System 登记 value 属于发行资源：按当前 manifest 同步名称、说明、包/包名称、标签、身份与绑定，包括删除已不再存在的可选字段。保留 envelope 的 UUID/id、创建时间及来源；仅实际变更递增 revision/updatedAt。普通/市场登记的管理属性继续保留。补充定义相同而仅登记元数据变化的首次升级与二次幂等、文本/JSON 和身份保护测试。
2. Embedded 返回的 ChangeSet 是整体工作树证据：输出明确 evidenceScope、target 数量与可能含升级前用户差异；System 计数独立来自升级计划。普通 CLI active 记录可安全复用；带用户协作信息或 View/导入意图、多个匹配记录时，升级入口在 Memory 写入/捕获前拒绝，并在锁内复核，不接管或改写用户协作状态。补充合法用户 diff、active 记录及 Comment/claim/scope 的保护测试，无系统差异不捕获。

仅修订方案与验证场景，未施工，不扩大三类升级的需求范围。
