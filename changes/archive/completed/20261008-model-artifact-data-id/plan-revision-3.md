接受架构 Agent 阻塞意见：显式 ID 在执行身份分配、目标冻结和业务写入之前独立校验 string 且 trim().length > 0，再校验 ID 与 ID.json 的 portable filename；测试明确证明无推进、无冻结、无业务写入。并明确 artifactForDisplay/expandArtifact 输出新增元数据，防止现有字段筛选丢失。范围与验收标准不变。
