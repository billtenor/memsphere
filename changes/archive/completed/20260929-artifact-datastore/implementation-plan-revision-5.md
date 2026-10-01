# 实施与验证方案第五轮修订摘要

- 接受第四轮 JSONL 映射意见：活动日志 Payload 固定 application/x-ndjson，两个日志 Store 使用内部 contentTypeExtensions 映射 .acp.jsonl；保留文件名和原字节，不新增用户配置入口，不修改公共 API 或通用默认映射。加入实际 Factory 的 create/append/get 与归档恢复回归。
- 不采纳改写 flow[1] 旧冻结 Submission 的操作建议：流程要求更新需求并重新确认，现行 change.md 与候选完整基线已更新且 Human 已明确确认；原 Submission 保持不可变，原待决项不再作为当前施工依据，不重复征求同义确认。
- 第 8 章集中整理完整当前需求基线、交付物、验收矩阵、后续范围和确认记录，不改变已确认选择；D8 等决策保留。
- 本次仍为方案修订，尚未施工或执行本轮接入验证。
