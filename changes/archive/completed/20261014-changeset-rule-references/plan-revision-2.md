# 方案第二轮修订

接纳研发与架构的两项阻塞：ChangeSet detail 的一次性 previewRoot 不写长期 ViewMemoryCache 索引；无效引用隔离到单个成员，保留同字段的合法投影。接纳研发风险建议：候选/基线各自共享 snapshot-scoped RuleLookup，缓存每个目标的读取 Promise，而非每个目标重新读取全部 Statement。增加混合有效/无效引用和缓存生命周期验证。需求范围及最终 Human 验收安排不变。
