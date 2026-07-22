# Review Run Evidence

## Evidence Source

本证据来自当前 worktree 中的实际 Run：

- Run JSON: `<run-root>/run-20260722-083210z-45c9a6ce/run-20260722-083210z-45c9a6ce.json`
- Final implementation material: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material.md`
- Final submitted review artifact: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/reviews/review-20260722-091628z-a1339ddf/submission-20260722-101831z-dd3379f7/artifact.md`
- R5 summary: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r5-summary.md`
- R6 summary: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r6-summary.md`
- R7 summary: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r7-summary.md`
- R8 summary: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r8-summary.md`
- R9 hotfix summary: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r9-summary.md`

## Observed Review Rounds

本次 Run 中，“实现与验证验收材料”的 Artifact Review 为：

- Review id: `review-20260722-091628z-a1339ddf`
- Round count: 7
- Final status: `passed`

按 run JSON 统计：

| Round | Round id | Result | Evidence summary |
| --- | --- | --- | --- |
| 1 | `round-20260722-091628z-944c39cb` | changes requested | 初始实现验收材料被要求补真实浏览器 stale revision 测试和清理范围外 Memory syntax diff。 |
| 2 | `round-20260722-093601z-9a7473f4` | changes requested | 发现 warning 局部显示、scope diff、inline 按钮恢复等问题。 |
| 3 | `round-20260722-094717z-bc1b7ef7` | changes requested | 发现失败后重试重复 comment、Cancel/替换 pending 生命周期问题。 |
| 4 | `round-20260722-100136z-3a42ebe3` | changes requested | 多个 agent 首次尝试出现 `listen EPERM`；复核后发现保存成功路径可能把 composer textarea 锁为 disabled。 |
| 5 | `round-20260722-100744z-ea3f3094` | changes requested | 发现普通保存失败路径也可能锁 composer；发现 inline 保存前 Refresh/重渲染会丢失输入。 |
| 6 | `round-20260722-101413z-3bc2f5d9` | changes requested | 多个 agent 首次尝试出现 `listen EPERM`；复核后发现 inline 未保存草稿跨 reviewer identity 恢复。 |
| 7 | `round-20260722-101831z-ba43014e` | passed | Traex 2/3 approve；Traex 4 发现普通 Memory/Task Review 泄漏风险，Runner 热修后 approve。 |

## Evidence For "Review Can Find Real Bugs"

Review 确实发现了多个真实问题，并且其中多项已被采纳修复：

- R5 修复了保存成功和 409 恢复成功后 composer textarea 可能 disabled 的问题。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r5-summary.md`
- R6 修复了普通保存失败路径也可能 disabled composer 的问题。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r6-summary.md`
- R7 修复了 inline 新增评论在点击 Add 前，Refresh/重渲染会丢输入的问题。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r7-summary.md`
- R8 修复了 inline 未保存文本跨 reviewer identity 恢复、可能保存到错误 assignment 的问题。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r8-summary.md`
- R9 热修了 Artifact Review inline 草稿恢复状态泄漏到普通 Memory/Task Review 的问题。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material-r9-summary.md`

这些问题大多是用户输入丢失、身份串写或普通 Review 行为污染，属于真实阻塞，而不是纯风格建议。

## Evidence For "收敛体验差"

- 最终实现验收材料经历了 7 轮 review，其中前 6 轮均为 `changes_requested`。
- 多轮包含 agent session 环境失败，错误形态为 `listen EPERM: operation not permitted ... bridge.sock`。
  - Evidence: `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material.md`
  - 该文件的环境说明记录了本地服务类测试在普通命令沙箱会因监听 `127.0.0.1` 或 socket 报 `listen EPERM`，需沙箱外重跑。
- Human 多次表达可以接受并希望收敛，但流程仍持续进入新的 rounds，直到 Runner 显式裁量通过。
- 最后一轮中 Traex 4 的意见有效，但修复很小；Runner 在当前 round 热修后 approve。该动作说明“有效问题热修并验证后直接接受”是必要路径。

## Evidence For ACP Dispatch Failure Root Cause

在 `run-20260722-105244z-b43a1863` 上报首份需求契约后，Traex 1 的首次 Agent Assignment 在读取 Artifact 前失败：

- Failure code: `agent_session_failed`
- Failure message: `listen EPERM: operation not permitted /tmp/memsphere-review-27-f712c7951a2e/bridge.sock`
- 从端口 `30003` 的沙箱外 View 服务调用 Retry API 后，第 2 次 attempt 能正常启动并提交 `approve`。

代码链路证据：

- `src/commands/run.ts` 的 `runReportCommand` 在 report 后立即调用 `dispatchArtifactReviewAgents`。
- `src/acp/dispatcher.ts` 从当前 CLI 进程派发 detached worker，因此 worker 继承调用环境限制。
- `src/acp/review-worker.ts` 在启动 ACP provider 前调用 `createAgentReviewBridge`。
- `src/acp/review-bridge.ts` 使用 Node `net.createServer()`，并监听 `/tmp/memsphere-review-*/bridge.sock`。

在相同受限命令环境执行只包含 `net.createServer().listen(<temporary unix socket>)` 的最小 Node 程序，也稳定返回：

```text
EPERM: listen EPERM: operation not permitted /tmp/memsphere-listen-proof-*/bridge.sock
```

这证明失败与 Artifact 内容、Reviewer prompt 和 Traex provider 无关，直接原因是 Review bridge 隐式要求调用方具备 socket-listen 权限。基于当前高速迭代阶段的产品取舍，本轮决定彻底下线 Review bridge，不建设独立 dispatcher；ACP 子 agent 改为直接执行当前版本 Memsphere CLI。修复验收必须覆盖从 `run report` 入口到 Agent 直接 CLI submit 的完整路径，不能只依赖沙箱外 View Retry。

## Final Validation Evidence

最终验证结果记录在：

- `<run-root>/run-20260722-083210z-45c9a6ce/artifacts/implementation-validation-review-material.md`

其中包含：

- `node --import ./node_modules/tsx/dist/loader.mjs test/view-browser.test.ts`：通过，46/46。
- `node --import ./node_modules/tsx/dist/loader.mjs test/artifact-review-browser.test.ts`：通过，1/1。
- `npm run typecheck`：通过。
- `npm test`：通过，271/271。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过。

这些证据说明最终通过并不是忽略质量，而是在完成修复和验证后由 Runner 收敛。
