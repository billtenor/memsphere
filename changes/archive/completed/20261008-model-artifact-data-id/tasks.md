# 开发计划

依据已通过第三轮评审的实施与验证方案，按以下顺序执行：

1. 新增 CLI/API dataId，冻结步骤 modelDataId，持久化 Submission modelTarget；接受核对快照目标，克隆步骤清除执行级目标。
2. 补齐 artifact show/review 元数据、ACP 和 Run 中英文提示以及上报回执。
3. 增加稳定业务对象、Review 冻结、非法 ID、非模型误用、失败重试与旧记录回归测试及真实 CLI 参数测试。
4. 同步中英文文档、System Memory 源/本项目副本、Skill；检查 Review Concept 和教程并记录依据。
5. 执行受影响测试、typecheck、全量 npm test、build、Store validate 与最终 Memory ChangeSet validate；记录失败并修复。
6. 按 Run 顺序上报实现摘要、初始验证报告、实现验收材料，处理各角色正式评审，交付归档与 commit。

不新增 YAML syntax 关键字；不扩大为 CAS、patch 或跨 Store 事务。
