# 初始验证报告

## 适用规范

已读取并应用 `memsphere-repository-testing-rules`。采用分层验证：定向测试优先、全量回归、构建与类型检查、Memory 双根校验、浏览器真实交互；未把环境限制误判为实现失败。

## 首次与修复后验证

1. 初次 `npm run typecheck` 因 `node_modules` 尚未安装而报 `tsc: not found`，属于环境前置缺失；执行锁定依赖安装后继续。
2. 首次类型检查定位到三个错误导入（CLI / Run / View 的 `abandonRun` 导入位置），修正后通过。
3. 首次在受限沙盒运行 Agent Review / View 测试出现子进程与本地监听 `EPERM`，属于环境限制；以完全相同测试在沙盒外复跑后通过。
4. 定向测试发现 Unix 进程组终止若无差别用于普通 ACP 子进程会影响宿主进程；实现调整为仅 detached Reviewer Worker / View 使用进程组终止，普通 ACP 子进程仍只终止自身，复测通过。

## 最终结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：410 total，409 passed，0 failed，1 skipped（Windows PowerShell/CMD/Git Bash 专属用例，在 Linux 上按设计跳过）。
- `test/run-store.test.ts`：覆盖 Human 终态元数据、幂等废弃、当前步骤消失、迟到 report 拒绝。
- `test/run-store.test.ts`：另覆盖 done/readOnly/v1 与非法 Actor/超长原因拒绝、Schema 草稿保留且禁止 finalization、abandon 与 report/Human Review submit 的锁竞争、废弃后 Human Review 写入拒绝。
- `test/agent-review.test.ts`：覆盖 running Review/Assignment/Attempt 取消、终止失败 warning 且不回滚、停止派发，以及废弃后 Agent comment/submit/fail/session/retry 写入拒绝。
- `test/archive-store.test.ts`：覆盖 abandoned 归档/恢复保持终态、running 归档拒绝。
- `test/run-output.test.ts`、`test/run-command.test.ts`：覆盖双语终态输出与无下一步动作。
- `test/run-abandonment-view.test.ts`：覆盖 View API 废弃后仍处于活动 Task 列表，单独归档后才移除。
- 最终 View 定向测试：68/68 通过。
- `memsphere validate`：当前 Project Memory 通过。
- `node dist/cli.js validate --memory-root reserved-memory`：reserved System Memory 通过。
- Embedded ChangeSet `change-20260822-032730960z-632ae5cb`：校验通过。
- `git diff --check`：通过。

## 验收标准检查

- [x] 独立 `abandoned` 终态，仅从 running 进入。
- [x] 记录时间、Human 发起信息、停止步骤与可选原因。
- [x] 废弃后 Run/Schema/Binding/Review 写入均拒绝。
- [x] 未完成 Review 与 Worker 收口，迟到写入拒绝。
- [x] done/abandoned 可归档，running 不可归档，恢复保持原终态。
- [x] View 独立展示 abandoned，不自动归档。
- [x] 既有 v2/v3 running/done 数据无需迁移并继续可读。

## 未执行项与风险

- 未在真实 Windows 主机执行 `taskkill.exe /T /F` 端到端测试；现有 Windows 专属测试在 Linux 跳过，Windows 分支由既有抽象与单元覆盖保持。
- View/CLI 当前没有独立登录身份系统，“只有 Human 主动决定”通过显式确认、可选 Human Actor 审计字段和 Skill/Memory 行为约束落实；这与已确认 MVP 方案一致。
