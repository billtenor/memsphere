# Run 中途废弃能力交付报告

## 交付内容

- 新增独立 Run 终态 `abandoned`，仅允许 Human 对 running Run 主动发起；记录时间、可选 Human Actor、原因与停止步骤。
- 废弃转换在 Run 写锁内完成并支持幂等；保留 Artifact、Schema 草稿及 Review 证据，取消未完成 Review、Round、Assignment 和 Attempt，并尽力终止运行中的 Agent Worker。
- 统一限制废弃后的 Run、Schema、Binding 和 Artifact Review 推进写入；dispatcher 不再为非 running Run 派发 Agent，迟到写入被拒绝。
- CLI 新增 `memsphere run abandon`；View 点击废弃后仅展示一次确认弹窗，不要求填写原因，并提供 abandoned 分组和只读证据展示。废弃不自动归档，用户仍需另行点击归档。
- done 与 abandoned Run 均可归档，恢复后保持原终态；running Run 仍不可归档。
- 双语 Prompt、README、Skill、System Memory 和当前 Project Memory 已同步；修复废弃 Schema 草稿仍展示最终提交命令的问题，并修正 `archive run` 帮助文案。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- 合并最新 master 并完成本轮交互修订后，`npm test`：412 total / 411 passed / 0 failed / 1 Windows-only skipped。
- Project Memory 与 reserved Memory 校验：通过。
- Embedded ChangeSet `change-20260822-032730960z-632ae5cb`：通过。
- `git diff --check`：通过。
- Playwright CLI 真实浏览器验收：通过。确认 running Run 可由 Human 二次确认后废弃；废弃后保留在 abandoned 分组；未接纳 Schema 草稿内容保留且标记只读；页面不再展示 `memsphere run report`；归档仍是独立操作。

## 验收结论

- 实现与验证产物经过三轮联合评审；第一轮补齐状态机、并发、Review/Agent Worker 和 Schema 边界测试，第二轮修正废弃 Schema 草稿的提交入口，第三轮研发、测试、架构三方全部通过。
- Runner 已处理全部 advisory 意见并通过：Windows 实机验证接受为后续项；CLI 帮助文案建议已修复并验证。
- 当前实现满足已确认需求契约，可以进入需求负责人 billtenor 的最终 Human 验收。

## 兼容性影响

- 既有 running/done Run、Review、Archive 数据无需迁移并继续可读。
- 新字段均采用兼容缺省；旧版 v1 Run 继续只读且不能废弃。
- 正常完成、Review、归档和恢复路径保持原行为；仅新增 abandoned 终态及对应 cancelled 子状态。

## 残留问题与后续范围

- 当前环境不是 Windows，未在真实 Windows 主机端到端验证 `taskkill.exe /T /F` 终止 reviewer worker 进程树；后续应在 Windows CI 或真实主机补测。该风险不影响 abandoned 终态落盘：终止失败只返回 warning，不回滚终态，迟到写入仍会被拒绝。
- MVP 不提供恢复执行、硬删除或 failed 状态；这些均不属于本次交付范围。
- 在 billtenor 完成最终验收前，需求保持 active/doing；验收通过后再按仓库规范写入完成时间并迁移至 `changes/archive/completed/`。
