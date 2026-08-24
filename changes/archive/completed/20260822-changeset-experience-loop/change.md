---
id: 20260822-changeset-experience-loop
type: feature
created: 2026-08-21
completed_at: 2026-08-22
run_id: run-20260821-061508z-4a056071
---

# ChangeSet 体验闭环优化

## 需求

完善 Embedded ChangeSet 从本地 Memory 修改、重复校验、Changes 浏览、基于 ChangeSet 创建 Review 到代码合入后进入下一轮的完整体验：同一逻辑变更和 base revision 复用同一 ChangeSet，base 变化后再创建新 ChangeSet；ChangeSet 成为 View 一等入口，并复用统一 Review/Comment 生命周期。

## 验收标准

- Embedded ChangeSet 按 Project、Git common repository 与 base revision 自动复用，当前验证内容只有一份；base revision 变化时完成旧 ChangeSet。
- View 提供 Changes 列表、详情和 Review 稳定路由，可查看 changed-only/full Store、诊断、目标操作计数和当前 Review 状态。
- ChangeSet Review 使用不可变 snapshot、digest/base 绑定和统一 Comment/Review 生命周期；无效 ChangeSet、同 digest 重复 Review和并发重复创建均被阻止。
- Human 与 Agent 使用同一 Review/Comment 机制，CLI 和 Memory/Skill 文档引导 Embedded 修改执行 `memsphere memory change validate`。
- 类型检查、构建、Memory 校验、专项测试、全量回归和实际浏览器验证通过。

## 技术与测试方案

- 在既有 ChangeSet、Review Store、View API 和浏览器状态模型上扩展 `changeset` source，不引入第二套 Review 或版本系统。
- ChangeSet Review snapshot 由服务端从当前 checkpoint 构造；同 ChangeSet 创建流程使用跨进程文件锁串行化读取、去重、snapshot 和写入。
- 以 Embedded 临时 Git worktree 集成测试覆盖复用、divergent draft、invalid guard、不可变 snapshot、空评论提交、状态派生、digest 回退、done 去重、UI 即时同步和并发双 POST。

## 开发任务

- 实现 Embedded ChangeSet 同 base 复用、base 变化完成、单 checkpoint 和冲突拒绝。
- 建设 Changes 导航、列表、详情、稳定 URL、Store 切换和诊断展示。
- 扩展 Review Store、API、浏览器交互、snapshot、manifest、stale 和唯一性规则。
- 同步 Project/Reserved Memory、Memsphere Skill、README 与 CLI 提示。
- 补齐专项、全量和真实浏览器回归。

## 验收结果

- 敏捷 Run 的需求契约、实施与验证方案、开发计划、功能实现和最终验收均完成多角色评审。
- 最终实现验收 Review `review-20260821-175816z-434b2979` 第 6 轮由项目负责人、研发、测试和架构师全部投票通过；阻塞意见为 0。
- 前序轮次发现的 invalid Review gate、divergent draft、空评论提交、状态派生、digest 唯一性、UI 即时同步、done 重复创建和并发 check-then-create 问题均已修复并增加回归。
- `npm test`：402 项，401 passed、0 failed、1 个 Windows-only skip。
- `npm run typecheck`、`npm run build`、`memsphere validate`、`git diff --check` 均通过。
- ChangeSet 专项 2/2、View browser 68/68、Memory CLI 9/9 通过；Playwright CLI 实际浏览 Changes 列表、详情、稳定 URL、Store 切换和 Review 抽屉通过。

## 后续范围

- 后续可统一或规定 ChangeSet mutation lock 与 Review snapshot creation lock 的锁序，进一步收敛 `memory change validate` 与 Review 创建同时发生时的边界；该项不阻塞本次验收。

## 残留问题

- 当前范围无阻塞残留。
- Linux 环境未执行 Windows-only PowerShell/CMD/Git Bash 跨 shell 测试，该用例按平台条件跳过。
