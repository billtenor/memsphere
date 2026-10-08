# 实施与验证方案

依据已接受的 requirement-contract.md；需求 #95，Run run-20261008-064617z-ca3c75d4。

## 代码现状与采用规范

`src/cli.ts` 的 run report 选项由 `src/commands/run.ts` 转交 `reportRun`。`src/run/store.ts` 持久化 stepExecutionId、准备和校验候选、保存 Review Submission；无 Review 时直接接受，Review 通过时从不可变快照重新读取并检查 digest，再调用业务写入。`src/project/model-artifact.ts` 在 Project 锁内校验 Store/模型指纹及完整值，通过 ValueStore.upsert 原子整条替换，当前 ID 固定为 Run 与执行 UUID 的组合。

采用已完整读取的 memsphere-repository-development-rules、testing-rules、requirement-rules、delivery-rules，以及 CONTRIBUTING.md、changes/README.md。阅读 memsphere-procedure、procedure-schema、schema-schema、yaml-syntax-rules；新增能力同步源 Memory 与本项目副本及 Skill，最终变更级校验。

# Syntax 关键字变更

无。本轮允许新增的 YAML syntax 关键字集合为空。仅新增 CLI `--data-id` 和内部 Run 可选元数据，不增加 Artifact DSL 字段，不修改 schema 的字段定义。

## 实现方式

1. CLI 增加 `--data-id <id>`；ReportOptions 与 reportRun input 增加 `dataId?: string`。非模型步骤、Repeat 或 Schema finalization 上显式指定时优先拒绝。在任何步骤执行身份分配、目标冻结与业务写入之前，显式 ID 先独立校验类型为 string 且 `id.trim().length > 0`，拒绝空字符串和全空白（仅用于判断，不修剪实际 ID）；然后复用 filesystem portable filename validator，同时校验 ID 和 `${id}.json`，不编码 ID。现有 validator 不拒绝空字符串，故必须有此前置校验。非法值测试断言 Run 不推进、目标未冻结、业务 Store 无写入。
2. RunStep 增加可选 `modelDataId`，strict 持久化 schema 同步；只属于步骤执行，不进入 Procedure template。cloneStep 清除 modelDataId，与清除 stepExecutionId 一致，保证新循环/Call 不继承上次目标。
3. 对格式及模型校验通过的首个候选，确定 `input.dataId ?? step.modelDataId ?? generatedId`。存在已冻结目标时，参数不同则拒绝。冻结目标并 writeRun 成功后才进入 Review/业务写入；上报校验失败允许重新选择，因为尚无合法候选和业务写入。既有 stepExecutionId 分配行为保持。
4. 旧 pending Review 若无 modelDataId，则已有 Submission 对应目标只能是旧生成 ID；禁止通过重试或修订改写成新显式 ID。以活动 Review 或已有冻结 ID 识别目标已固定；本次候选 `modelTarget` 可选对象保存 storeId、modelRef、fingerprint、dataId、stepExecutionId。构造候选快照时统一附加，包括 default ID。
5. processModelArtifact commit input 增加可选 dataId，用显式值优先、旧生成规则兜底。无 Review 接受传当前步骤冻结目标；Review 接受传 Submission 的冻结 modelTarget，核对它与步骤身份、目标和指纹一致，避免接受时跟随可变步骤目标。旧 Submission 不带 modelTarget 时按旧生成规则接受，不迁移。
6. 接受回执 modelData 仍包含 dataId；Submission 的 modelTarget 与 modelData 是候选目标和写入结果，均为可选字段，同步 commands/run.ts 的 artifactForDisplay 与 acp/review-session.ts 的 expandArtifact 字段筛选，使 artifact show/review API 保留候选 modelTarget 及接受 modelData。扩展 ACP contract 和 Run Prompt 的 modelTarget.dataId，在中英文 Prompt 明确展示所选 ID；Review contract 优先从当前 Submission 读取目标。CLI report receipt 显示 modelData.dataId（实际写入后）或候选 modelTarget.dataId（待评审时），避免正文内注入元数据。
7. 不新增并发协议：无条件整条 upsert、最后成功写入覆盖、无 expected-revision。Project 锁/记录锁沿用，不改通用 data upsert。业务写入后 Run 保存失败重报相同 ID，允许 revision 增长。

## 影响范围和任务

修改 CLI、commands/run、run/store、project/model-artifact、ACP/Run Prompt 类型/schema/templates/receipt；在 run-model-artifact 增加模块测试，并为真实 CLI 参数转发增加集成测试。
更新 docs/model-artifact.md/en.md、src/skills/memsphere/SKILL.md；检查并同步 reserved-memory 下 framework、run、procedure、procedure-schema、schema-schema 和 yaml-syntax-rules 对应语义，本项目 .memsphere/memory 副本同步。还必须检查 memsphere-artifact-review、memsphere-tutorial-chapter-03 和 memsphere-tutorial-chapter-03-review-experience，明确记录无需更新的依据，若发现涉及目标身份语义则更新源及副本并通过 reserved-store 与 Memory 校验。已完整读取三者：教程的产物是普通 Markdown 角色对照记录，不绑定业务 Store、不涉及模型值或业务 ID；Review Concept 描述通用 Submission/Slot/Assignment，不定义模型目标字段，因此预计无需修改其 DSL 或教学步骤，但实现完成后再次核对以防遗漏。无新增/删除 Memory，因此 manifest 不需要变更。
changes 文档记录计划、测试、验收及 ChangeSet 证据。

## 验证方式

现有源码构建和 test/run-model-artifact.test.ts 基线执行通过（本轮实际运行）；后续证据以修改后的验证为准。

- 模块测试：两个步骤、两个 Run 同 ID 整条替换（删除旧可选字段）；原快照保持；显式/default ID 目标冻结，修订省略/同 ID 可行、不同 ID 拒绝；候选及 ACP contract 暴露 ID；接受只写 Submission 的目标。
- 失败测试：非法路径/空值/Windows reserved/NFC/扩展名长度；非模型/Schema/控制步骤误用；格式及模型失败不冻结目标；写入失败与写后保存失败重试；目标变化阻止接受。无业务写入或不推进通过 Store 查询和 readRun 断言。
- 回归：旧 Run/Review 去掉新增字段后继续读取、修订和接受；现有循环/Call 不同默认 ID 保持；新执行 clone 清除目标。CLI 集成实际运行 `node dist/cli.js ... run report --data-id`（独立临时 MEMSPHERE_HOME/Project）并检查数据/回执/失败行为。
- 先执行受影响 run-model-artifact、run-store、run-command、review-store、prompt-renderer、reserved-store 等实际测试；再运行 npm run typecheck、npm test（包含 build）、npm run build、memsphere validate、memsphere memory change validate。所有命令记录日志及结果；环境失败单独记录，不冒充通过。

## 兼容、风险与待决问题

无 stable Tag，因此不需要向前兼容；默认 ID 和旧可选字段读取作为已确认回归要求，不变更 Run contractVersion。非法或不同 ID 在写入前拒绝，冻结保存失败不得进入业务 upsert。无条件覆盖的并发语义可能覆盖别人更新，按已确认范围明确文档化，后续可考虑 CAS。无需要 human 补充的必要信息。
