---
id: 20260823-changeset-active-lifecycle
type: feature
created: 2026-08-23
completed_at: 2026-08-24T02:56:52Z
run_id: run-20260823-095730z-864292a6
---

# ChangeSet active 与正式完成语义统一

## 需求

将 ChangeSet 生命周期收敛为 active、completed、abandoned。Managed ChangeSet 在 `memory publish` 成功后 completed；Embedded ChangeSet 在普通 commit、push、创建 PR 后仍 active，只有当前候选内容进入本地 `master` 后才 completed。验证成功的 active ChangeSet 应能在正式集成前作为完整候选 Memory Store 启动 Procedure Run。

## 验收标准

- ChangeSet schema 只接受 active、completed、abandoned，不兼容 draft、published。
- Embedded base 或 HEAD 变化不自动完成旧 ChangeSet；当前 checkpoint 的候选提交成为 master 祖先，或 master 当前目标与 checkpoint 一致时才完成。
- checkpoint 更新后旧候选提交不得误完成新版候选；读取 reconciliation 不得无锁覆盖 Comment、claim、scope 或状态变更。
- CLI、View、README、Skill、Reserved 与 Installed System Memory 使用同一状态语义。
- 当前项目历史 ChangeSet 一次性校正并全部通过新 schema；`change-20260822-114047710z-d95203af` 在进入 master 前保持 active。
- `run start --change <id>` 同时支持 Managed 与 Embedded，只接受验证成功的 active ChangeSet，并冻结 change id、checkpoint digest 与 base revision；不传参数时维持 Embedded 当前 worktree、Managed published revision 的默认读取语义。
- 类型检查、构建、全量回归、Memory 校验与 Playwright CLI 实页验收通过。

## 技术与测试方案

- 以 `candidate_revision` 记录当前 checkpoint 的 Git 提交证据；checkpoint digest 变化时清除旧证据。
- reconciliation 仅在项目 mutation lock 内重新读取和按需写回，且 durable field 未变化时不更新时间。
- 临时 Git 仓库覆盖 linked worktree、commit、旧 candidate、checkpoint 前移、master merge、create/update/delete/rename 与 CAS 保持。
- View 实页核对 active/completed 列表、详情本地化和可操作/只读边界。
- 复用 ChangeSet preview 物化完整候选 Store，并以文件 Catalog 解析 Run 的根 Procedure、外部 Procedure 与 Schema；Run 持久化候选来源，不持有会被替换的临时目录。

## 当前验证结果

- 生命周期成果 Review `review-20260823-103538z-8a6e5a4b` 第 3 轮由研发、测试、架构师全部通过，阻塞、风险、建议均为 0；Runner 已批准。
- `run start --change` 的 Managed、Embedded、默认来源隔离、checkpoint 冻结、未验证拒绝与终态拒绝定向测试全部通过。
- `npm test` 全量通过；Windows-only 跨 shell 用例按平台条件跳过。
- `npm run typecheck`、`npm run build`、`memsphere validate`、`memory change validate`、`git diff --check` 均通过。
- 本次追加 Memory 文档的 Embedded ChangeSet 为 `change-20260823-144248698z-6b7ddd2f`，验证通过。
- Playwright CLI 实际页面验收通过。

## 验收结果

- 产品负责人 billtenor 在交付 Review `review-20260823-105822z-0cee5eac` 第 2 轮 `round-20260824-025359z-33d7ed72` 投票通过。
- Runner 核对新增候选 Run 能力、完整验证证据和修订摘要后批准交付。
- 当前需求已完成并按仓库交付规范归档。
