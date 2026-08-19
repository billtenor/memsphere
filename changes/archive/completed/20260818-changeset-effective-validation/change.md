---
id: 20260818-changeset-effective-validation
type: feature
created: 2026-08-18
completed_at: 2026-08-18
run_id: run-20260818-090723z-15986f13
---

# ChangeSet 有效 Store 专用校验

## 需求

Managed ChangeSet candidate 是只包含目标文件的稀疏补丁，不能直接作为完整 Memory Root 交给 `memsphere validate --memory-root`。本需求新增 `memsphere memory change validate <change-id>`，把 candidate 叠加到当前正式 Store 后调用唯一的完整 Store validator，并让 publish 复用同一有效 Store 校验核心。

## 范围

- ChangeSet target CAS、临时有效 Store 构造、完整校验与诊断路径映射。
- text/json CLI 输出、失败退出码与只读无副作用保证。
- publish 共享核心并保持锁内重验、正式 Store 二次校验、commit 与回滚。
- sparse candidate、跨正式 Store 引用、create/update/delete/rename、非法 YAML、悬空引用、重名、缺失文件和 CAS 冲突测试。
- README、Framework 与 Procedure 构建 System Memory 同步。

## 向前兼容

结论：需要向前兼容。

保留现有 `memsphere validate`、`validate --memory-root`、ChangeSet JSON/candidate 布局、`memory publish --change`、CAS 和原子发布行为；本轮仅新增专用入口并抽取共享内部核心，不需要数据迁移。

## 验收结果

- 需求契约与实施方案均通过全 Agent 角色评审。
- 功能实现通过研发、测试 Agent 的正确 worktree 代码检查与定向复跑；架构 Agent 基于主 checkout 旧代码提出的阻塞意见经 Agent Activity workspaceRoot 证据确认无效并正式驳回。
- 定向测试：memory-changeset 2/2、memory-cli 8/8、reserved-store 3/3。
- 隔离全量测试：339/339。
- typecheck、build、两类 Memory validate、CLI help、diff check 和 System Memory 副本一致性全部通过。
- 当前共享 worktree 的全量失败来自进入分支前已有的 View 设置并行改动；本轮通过隔离副本完成全量门禁，交付/提交必须继续排除这些文件。

## 交付内容

- 分支：`codex/changeset-effective-validation`。
- 核心：`src/memory/changeset.ts`。
- CLI：`src/commands/memory.ts`、`src/cli.ts`。
- 测试：`test/memory-changeset.test.ts`、`test/memory-cli.test.ts`。
- 文档与 System Memory：README、两份 Framework、两份 Procedure 构建流程。

## 后续范围与残留问题

- 不包含 View UI 的 ChangeSet 校验入口或 Overlay Provider 重构。
- 预检与之后 publish 之间的并发变化由 publish 锁内重验处理。
- 若创建 commit，只允许选择性暂存本需求文件，不得纳入既有 View 设置改动。
