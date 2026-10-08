# 当前迭代需求契约

需求来源：https://github.com/billtenor/memsphere/issues/95 。Run：run-20261008-064617z-ca3c75d4。

## 整体目标

模型 Artifact 上报可选择稳定业务对象 ID，使不同步骤、循环和 Run 更新同一 Store 中的同一完整模型值，并继续保留独立、不可变的运行历史。

## 当前迭代范围

采用 `memsphere run report --write-options '{"data_id":"<id>"}'`，只适用于绑定业务 Store 的普通模型 Artifact。省略时保持 `${runId}--${stepExecutionId}`。
ID 使用现有 filesystem JSON ValueStore 记录 ID 规则；非法 ID、非模型产物使用此选项必须明确拒绝且不推进、不写业务数据。
首次通过格式及模型校验的候选在任何业务写入前持久化所选目标到当前步骤执行；失败重试和评审修订省略参数时继承该 ID，显式指定相同 ID 可重试，指定不同 ID 必须拒绝。默认生成的 ID 同样冻结，不能在评审修订时改成显式 ID。
候选 Submission 保存业务 ID，评审材料可读取该目标，接受只写被评审目标，接受回执记录 ID、执行身份、digest 和 revision。不同步骤和 Run 可以选择相同 ID。
首版为无条件原子整条 upsert，最后一次成功写入覆盖当前值；不做字段合并。保持模型校验、接受后才写入、失败不推进、模型及 Store 指纹校验。跨 Store 事务不在范围内。

## 后续范围

可选 expected-revision、CAS 冲突检测、DSL ID 插值或值字段提取均后续考虑。本轮不新增 YAML syntax 关键字。

## 交付物

CLI/API、Run 步骤与 Submission 元数据及接受路径、失败与边界测试、中英文模型 Artifact 文档、相关 System Memory 源及当前项目副本、Skill 冗余说明、需求与流程验证记录。

## 验收标准

1. 不传 ID 的新 Run 仍使用执行身份生成 ID；循环、Call、新 Run 的默认身份行为不变。
2. 两个步骤与两个 Run 指定同一 ID 时更新一条记录，整条替换；接受事件各自记录该 ID，而执行身份与历史快照独立。
3. 评审前业务 Store 不写入，候选包含目标 ID；修订保留目标，变更目标被拒绝；通过后写入最新已评审值。
4. 校验失败、非法 ID、非模型产物误用、Store 写入失败或目标指纹变化不推进且不错误写入。业务写入后 Run 保存失败，重试仍用原 ID，可增加 revision。
5. 旧 Run/Submission 没有新增可选字段时仍能读取并按原生成规则接受；历史快照不从业务 Store 读取。
6. CLI 实际调用覆盖显式 ID 上报和非法参数拒绝；受影响自动化测试、typecheck、全量 npm test、build、memsphere validate 与最终 Memory ChangeSet 校验通过。
7. 文档明确无条件覆盖并发语义、目标冻结时机、参数继承和后续冲突检测范围。

## 向前兼容

结论：不需要向前兼容。当前仓库 `git tag --list '*stable*'` 返回空，无适用 stable Tag checkpoint，因此不建立历史版本兼容责任。Issue 明确要求的默认生成行为、旧 Run 和 Submission 可读可接受作为本轮功能回归要求：新增持久化字段可选，不引入迁移，按上述 1、5、6 项验收。

## 采用规范

通过 memory read 读取 memsphere-repository-requirement-rules、memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules；采用显式兼容决策、避免过度设计、System Memory/Skill 同步、实际边界测试、全量回归、变更级 Memory 校验和交付归档要求。另采用 CONTRIBUTING.md 与 changes/README.md。

## 待确认项

无必要外部信息待补。Issue 将输入形态和冲突策略交由维护者设计，以上采用可选 CLI ID、首版无条件覆盖并明确文档化的方案，交由产品 Agent Review 审核。


## 发布前入口调整（Human 已确认）

最终入口改为 `run report --write-options '{"data_id":"task-123"}'`，移除尚未发布的 `--data-id`。仅接收内联 JSON 对象，当前只接受可选字符串 `data_id`；非对象、无效 JSON、未知字段（含 `expected_revision`）及非法 ID 拒绝。空对象表示未指定 ID，但仍只能用于绑定业务 Store 的普通模型 Artifact。Run API 同步改为 `writeOptions?: { data_id?: string }`，不保留新的顶层 dataId 输入。此前冻结目标、验收后写入、默认生成 ID、快照独立与无条件整条 upsert 语义不变。文件引用、YAML、CAS 与其他写入策略不在本次范围。

本调整经用户在当前对话确认；此前评审与 commit 是旧入口的历史证据，不能作为新入口验收结论。当前 Run 保持 Human PR 决策位置，不修改其不可变历史；新入口需要补充角色审查和验证证据后才能交付。
