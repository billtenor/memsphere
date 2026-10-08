---
id: 20261008-model-artifact-data-id
type: feature
created: 2026-10-08
completed_at: 2026-10-08
run_id: run-20261008-064617z-ca3c75d4
---

# 模型 Artifact 显式业务 ID

需求：https://github.com/billtenor/memsphere/issues/95 。

## 需求与验收标准

详见 requirement-contract.md：可选 `run report --write-options`，默认执行身份不变，跨步骤和 Run 整条 upsert 稳定业务对象；评审、重试冻结目标，快照保持独立。

## 向前兼容

结论：不需要向前兼容。无适用 stable Tag，不建立历史兼容责任；Issue 要求的默认生成 ID 与旧 Run 读取/接受行为作为本轮回归要求，新增字段可选。

## 技术与测试方案

方案已通过第三轮研发、架构和测试 Agent 评审，详见 implementation-plan.md。

## 开发任务

详见 tasks.md。

## 验收结果

实现完成；最终全量 npm test 141 文件 / 1164 tests 零失败，typecheck/build/Store 与 ChangeSet 校验通过。研发、测试、架构 Agent 实现验收与产品 Agent 交付验收均通过，Runner 已接纳；需求已完成。证据见 verification-report.md 和 verification-evidence.json。

Memory ChangeSet：change-20261008-071155715z-ff7c51a9，passed；View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-071155715z-ff7c51a9 。


## 发布前入口调整（Human 已确认）

最终入口改为 `run report --write-options '{"data_id":"task-123"}'`，移除尚未发布的 `--data-id`。仅接收内联 JSON 对象，当前只接受可选字符串 `data_id`；非对象、无效 JSON、未知字段（含 `expected_revision`）及非法 ID 拒绝。空对象表示未指定 ID，但仍只能用于绑定业务 Store 的普通模型 Artifact。Run API 同步改为 `writeOptions?: { data_id?: string }`，不保留新的顶层 dataId 输入。此前冻结目标、验收后写入、默认生成 ID、快照独立与无条件整条 upsert 语义不变。文件引用、YAML、CAS 与其他写入策略不在本次范围。

本调整经用户在当前对话确认；此前评审与 commit 是旧入口的历史证据，不能作为新入口验收结论。当前 Run 保持 Human PR 决策位置，不修改其不可变历史；新入口需要补充角色审查和验证证据后才能交付。

最终入口调整已完成：模型测试37/37、全量141文件/1167 tests零失败；产品/研发/测试/架构补充角色审查均approve，Runner接纳。最终证据见 options-delivery-report.md 与 options-review-evidence.json；原Run仍等待Human PR决策。
