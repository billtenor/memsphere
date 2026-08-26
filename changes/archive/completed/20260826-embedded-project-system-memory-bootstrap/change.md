---
id: 20260826-embedded-project-system-memory-bootstrap
type: bugfix
created: 2026-08-26
completed_at: 2026-08-26
run_id: run-20260826-035014z-9b9ea7db
---

# Embedded Project 创建时自动安装 System Memory

## 需求

修复 Embedded Project 创建完成后没有 System Memory、必须由用户额外执行 `memsphere project repair` 的问题。创建 Managed 或 Embedded Project 后都应立即具备 manifest 声明的当前版本 System Memory。

## 验收标准

- `project create --embedded` 返回时，Memory Root 已包含 manifest install 全集。
- Embedded bootstrap 只写当前 worktree，不自动 stage、commit 或 push。
- 安装冲突或完整 Store 校验失败时，撤销 Project 注册、Workspace binding 和 Project 元数据，不覆盖用户 Memory，不留下部分安装。
- 现有 Embedded repair、Managed bootstrap 和 linked worktree 行为保持通过。
- 类型检查、全量测试、构建、Memory 校验和 Reserved/System Memory 一致性检查通过。

## 技术与测试方案

- 让 Project create 按 Store 类型执行 bootstrap；Embedded create 与显式 repair 复用同一段已选中 Project 的 prepare、校验、CAS、写入和回滚逻辑。
- 更新 Embedded 创建测试，直接断言 create 后的 manifest install 全集和空 Git index。
- 新增安装路径 identity 冲突的创建失败回滚测试，并调整既有 repair fixture 为先创建健康 Project、再构造损坏状态。
- 同步中英文 README、内置 Skill、Framework System Memory 和第一章教程。

## 开发任务

- [x] 接通 Embedded create bootstrap。
- [x] 复用 repair 安全同步与锁语义。
- [x] 补充成功与冲突回滚回归测试。
- [x] 更新受影响的 repair fixture。
- [x] 同步文档、Skill、Reserved Memory 和当前 Project Memory。

## 验收结果

- Bug Fix Run `run-20260826-035014z-9b9ea7db` 已完成；需求、研发、测试最终评审均通过，无 blocking、risk 或 suggestion。
- `node --import tsx test/project-command.test.ts`：17/17 通过。
- `node --import tsx test/reserved-store.test.ts`：5/5 通过。
- `npm run typecheck`、`npm run build`、`npm test`、`memsphere validate`、`git diff --check` 全部通过。
- Reserved Memory 与当前 Project Memory 的两份修改副本一致。
- 未执行额外手工测试；自动化已覆盖实际创建编排、文件结果、Git index、冲突回滚和 linked worktree。
