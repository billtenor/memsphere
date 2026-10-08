# 开发计划

依据已通过第三轮评审的实施与验证方案，按以下顺序执行：

1. 新增 CLI/API dataId，冻结步骤 modelDataId，持久化 Submission modelTarget；接受核对快照目标，克隆步骤清除执行级目标。
2. 补齐 artifact show/review 元数据、ACP 和 Run 中英文提示以及上报回执。
3. 增加稳定业务对象、Review 冻结、非法 ID、非模型误用、失败重试与旧记录回归测试及真实 CLI 参数测试。
4. 同步中英文文档、System Memory 源/本项目副本、Skill；检查 Review Concept 和教程并记录依据。
5. 执行受影响测试、typecheck、全量 npm test、build、Store validate 与最终 Memory ChangeSet validate；记录失败并修复。
6. 按 Run 顺序上报实现摘要、初始验证报告、实现验收材料，处理各角色正式评审，交付归档与 commit。

不新增 YAML syntax 关键字；不扩大为 CAS、patch 或跨 Store 事务。


## 发布前入口调整（Human 已确认）

最终入口改为 `run report --write-options '{"data_id":"task-123"}'`，移除尚未发布的 `--data-id`。仅接收内联 JSON 对象，当前只接受可选字符串 `data_id`；非对象、无效 JSON、未知字段（含 `expected_revision`）及非法 ID 拒绝。空对象表示未指定 ID，但仍只能用于绑定业务 Store 的普通模型 Artifact。Run API 同步改为 `writeOptions?: { data_id?: string }`，不保留新的顶层 dataId 输入。此前冻结目标、验收后写入、默认生成 ID、快照独立与无条件整条 upsert 语义不变。文件引用、YAML、CAS 与其他写入策略不在本次范围。

本调整经用户在当前对话确认；此前评审与 commit 是旧入口的历史证据，不能作为新入口验收结论。当前 Run 保持 Human PR 决策位置，不修改其不可变历史；新入口需要补充角色审查和验证证据后才能交付。
