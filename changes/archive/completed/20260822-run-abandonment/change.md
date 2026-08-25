---
id: 20260822-run-abandonment
type: feature
created: 2026-08-22
completed_at: 2026-08-24T07:15:13Z
run_id: run-20260822-025720z-c4a82827
---

# Run 中途废弃能力

## 需求

为尚未完成的 Run 增加由 Human 主动发起的 `abandoned` 终态。废弃保留已有 Artifact、Schema 草稿与 Review 证据，停止未完成 Reviewer，并使 Run 后续只读。废弃与归档保持独立，用户需要另行归档。

## 验收标准

- 仅允许 `running -> abandoned`，不得把废弃伪装成 `done`。
- 记录废弃时间、Human 发起者、停止步骤与可选原因。
- 废弃后所有 Run/Schema/Review 推进写入均被拒绝。
- 未完成 Review/Assignment/Attempt 取消；Agent Worker 尽力停止，迟到写入拒绝。
- done/abandoned 可归档，running 不可归档；恢复后仍保持原终态。
- View 显示独立“已废弃”分组，不自动归档。
- 既有 running/done Run、Review 和 Archive 数据无需迁移并继续可读。

## 向前兼容

结论：需要向前兼容。

保持既有 Run/Review/Archive 持久化数据、CLI、View API 和正常完成/归档路径可用。新增字段采用兼容缺省；历史数据不要求重建。

## 技术与测试方案

以关联 Run 中已通过的“当前迭代需求契约”和“实施与验证方案”为准。核心包括统一 running 守卫、写锁内原子废弃、锁外 Worker process-tree termination、双语 Prompt、View/API、Archive 与 System Memory/Skill 同步。

## 开发任务

- [x] Run/Review 状态模型与统一写守卫
- [x] 原子废弃与 Agent Worker 收口
- [x] CLI/Prompt、Archive、View/API
- [x] System Memory、Skill 与当前 Project Memory 同步
- [x] 针对性测试、Playwright 和全量验证

## 验收结果

已完成：

- 新增 `running -> abandoned` 原子状态转换，记录 Human 发起信息、时间、原因和停止步骤；重复废弃幂等，done/v1/只读 Run 拒绝。
- 废弃时保留既有 Artifact、Schema 草稿和 Review 证据，取消未完成 Review、Assignment 与 Attempt；锁外尽力终止独立 Agent Worker 进程组，迟到写入由统一 running 守卫拒绝。
- CLI 新增 `memsphere run abandon`；View 点击废弃后仅提示“废弃后将不能继续执行”，确认即执行，不要求填写原因；独立 abandoned 分组与只读状态已实现。废弃不自动归档，done/abandoned 均可另行归档并恢复原终态。
- 双语 Prompt、README、System Memory、Skill 和当前 Project Memory 已同步；同时修正开发规范中对已移除 `memsphere-review` Memory 的陈旧引用。
- 合并最新 master 并完成提需方 UX 修订后验证通过：`npm run typecheck`、`npm run build`、`npm test`（412 total、411 passed、0 failed、1 Windows-only skipped）、Project 与 reserved-memory 的 `memsphere validate`、Embedded ChangeSet validate，以及真实 Playwright CLI 废弃确认与独立归档流程。
- 研发、测试、架构师对实现与验证成果评审通过；产品负责人 billtenor 在交付 Review `review-20260822-041451z-6cfbf5d2` 第 1 轮投票通过，Runner 随后批准。
- 实现提交及验收修订已推送至 `codex/run-abandonment`，GitHub PR：[23](https://github.com/billtenor/memsphere/pull/23)。
- 当前需求已完成并按仓库交付规范归档。
