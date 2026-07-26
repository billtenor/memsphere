---
id: 20260722-artifact-review-draft-conflict-recovery
type: feature
created: 2026-07-22
completed_at: 2026-07-22
run_id: run-20260722-083210z-45c9a6ce
---

# Artifact Review 草稿冲突恢复体验

## 需求

Artifact Review 中，用户在 View 里添加或编辑评论时，偶尔会遇到 `revision conflict; your text is still in this page` 弹窗。该冲突来自 Review Round 的乐观锁保护：前端保存草稿时携带 `expectedRevision`，后端发现 Round 已被其他保存、提交、Agent Reviewer 或轮询后的状态变化更新后，返回 `409` 防止覆盖新数据。

当前体验存在两个问题：

- 冲突以浏览器 `alert` 形式突然打断用户，且没有自动恢复路径。
- 报错后前端可能重新渲染 Review 面板，整体评论输入框等尚未进入前端状态的文本存在丢失风险，“your text is still in this page” 并不总是可靠。

本需求要求把 Artifact Review 草稿保存改造成可恢复、不中断、不丢文本的交互：用户写评论时即使发生并发更新，也应保留本地输入，自动拉取最新 Round，合并本地草稿并重试保存；只有无法自动恢复时才在右侧面板内提示，而不是弹窗。

## 范围

- 仅处理 Artifact Review 的 Human Draft 保存体验，包括：
  - 锚定评论新增。
  - 整体评论新增。
  - 草稿评论编辑。
  - 草稿评论删除。
  - Vote 选择。
- `409 ArtifactReviewConflictError` 不再冒泡到 `runButtonAction` 的浏览器 `alert`。
- 前端在用户点击保存前或保存过程中，必须先把本地 draft 变更纳入可恢复状态；任何网络错误、409、重渲染或轮询都不得清除用户刚输入的文本。
- 409 后自动读取最新 Review Round Context，并把本地未保存草稿合并到最新服务端 Draft，再使用最新 revision 重试保存。
- 自动重试仍失败时，在 Artifact Review 面板内显示非阻塞 warning，保留本地 draft，并允许用户再次保存或手动刷新。
- 轮询、身份切换、Review 抽屉开关和 Submit 操作不得覆盖正在编辑或待恢复的本地草稿。

## 不做事项

- 不取消后端 `expectedRevision` 乐观锁。
- 不把 Round revision 拆成 per-assignment revision；本轮先在前端做自动 rebase 与重试。
- 不改变正式 Submit 后不可编辑的规则。
- 不改变普通 Memory/Task Review 的评论模型。
- 不实现多人实时协同编辑、冲突 diff 或手动合并 UI。

## 验收标准

- 当另一个 Assignment、Agent Reviewer 或同一 Round 的其他操作先更新 revision 后，用户继续添加 Artifact Review 评论不会弹出浏览器 alert。
- 发生 409 时，View 自动刷新最新 Round Context，保留本地新增/编辑/删除的 draft comment 和本地 vote，并用最新 revision 重试保存。
- 自动恢复成功后，右侧评论列表显示用户刚添加或编辑的内容；刷新页面后内容仍存在于服务端草稿中。
- 自动恢复失败时，用户输入仍显示在页面中；右侧面板内出现可理解的 warning，不阻塞继续编辑，不清空 textarea。
- 整体评论输入框在保存失败、409、轮询和 `renderAll()` 后不丢失用户刚输入的文字。
- 锚定评论保存成功后仍滚动回对应 comment；发生 409 自动恢复后也保持相同定位体验。
- 删除草稿评论遇到 409 时，最新服务端 Draft 会被正确合并，已删除项不会因为刷新最新上下文而重新出现。
- Vote 选择遇到 409 时，自动恢复后保留用户最后一次选择。
- Submit Review 遇到 stale revision 时不提交旧草稿；如果本地草稿可自动保存，则先恢复保存，再允许用户重新确认 Submit。
- 自动化测试覆盖至少一个 stale revision 场景，并验证不会调用 alert、不会丢失本地 textarea 文本、最终服务端 Draft 包含用户输入。

## 技术与测试方案

### 前端状态

- 在 `src/view/browser.ts` 中引入 Artifact Review 本地草稿缓冲，按 `reviewId + roundId + identityId` 维度保存：
  - 服务端基线 draft 与 revision。
  - 本地 pending draft。
  - 本地 dirty 操作信息，区分新增、编辑、删除和 vote 变更。
  - 正在保存、冲突恢复中、恢复失败等 UI 状态。
- 评论输入框不再只依赖临时 DOM textarea。整体评论和 inline editor 的文本在用户输入期间进入本地状态，避免 `renderAll()` 后丢失。
- `hasOpenInlineEditor` 和轮询同步逻辑继续避免覆盖正在编辑的 DOM，同时还要识别本地 pending draft。

### 保存与冲突恢复

- 把 `saveArtifactReviewDraft` 改为可恢复保存：
  1. 使用当前 Context revision 尝试保存本地 pending draft。
  2. 如果成功，更新服务端基线、清除 dirty 状态和 warning。
  3. 如果返回 409，调用受保护 GET API 读取最新 Context。
  4. 将本地 dirty 操作重新应用到最新服务端 draft。
  5. 使用最新 revision 自动重试一次。
  6. 如果仍失败，保留 pending draft，在右侧面板显示 warning，不 throw 到 alert。
- 合并规则：
  - 本地新增 comment 追加到最新 draft；id 保持稳定，避免重试产生重复评论。
  - 本地编辑 comment 覆盖同 id 的 body 与 anchor。
  - 本地删除 comment 从最新 draft 中移除。
  - 服务端新增的其他 comment 保留。
  - vote 若本地 dirty，则使用本地最后一次选择；否则使用服务端最新 vote。
- 保存函数返回结构化结果，例如 `{ ok, recovered, conflict }`，调用方根据结果决定是否关闭 editor 和滚动定位。
- 对 Submit Review，若存在 pending/dirty draft，应先完成保存；保存成功后再弹确认并提交，避免拿旧 revision 直接 submit。

### UI 反馈

- 删除 `revision conflict` alert 路径；冲突和恢复状态显示在 Artifact Review 面板中。
- 保存中、自动同步中、恢复失败三类状态使用短文案：
  - `正在保存评审草稿`
  - `评审轮次已更新，正在同步你的草稿`
  - `评审轮次又被更新了，你的草稿已保留，请稍后重试`
- Warning 不覆盖评论列表，不清空编辑器，不禁用继续输入。

### 后端与 API

- 保持现有后端乐观锁和 `ArtifactReviewConflictError` 响应结构。
- 如前端需要更精确恢复，可在 409 响应继续返回 `actualRevision`；本需求不要求后端返回完整 Context。
- 不改变 Review 持久化格式。

### 测试

- 增加 browser 静态/单元测试，确保 409 分支不 `throw new Error(...revision conflict...)` 到 `runButtonAction`。
- 增加 API/Store 测试，继续确认 stale revision 返回 409，防止误删乐观锁。
- 增加 Playwright 或等价无头浏览器测试：
  - 打开 Artifact Review 页面，开始输入整体评论。
  - 测试中通过 API 模拟另一身份先保存 draft，使前端 revision 过期。
  - 点击添加评论，断言没有 `dialog`/`alert`，textarea 文本不丢。
  - 等待自动恢复，断言右侧评论列表和服务端 draft 都包含该文本。
- 增加删除与 vote 的合并回归测试，覆盖 409 后不会复活已删除 draft comment，且 vote 保留用户最后选择。

## 开发任务

- [x] 设计 Artifact Review 本地草稿缓冲结构和 dirty 操作模型。
- [x] 改造新增、编辑、删除、vote 选择的前端调用，先写入本地 pending draft。
- [x] 实现 409 自动读取最新 Context、合并 pending draft、重试保存。
- [x] 改造 Submit Review，使其先保存 pending draft，再进入确认和提交。
- [x] 把冲突提示从浏览器 alert 改为 Review 面板内非阻塞状态。
- [x] 补齐整体评论输入框和 inline editor 的文本保留逻辑。
- [x] 增加 stale revision 自动恢复、无 alert、无文本丢失、删除和 vote 合并的自动化测试。
- [x] 执行 `npm test`、`npm run build`、`node dist/cli.js validate`，并用 View 做人工验收。

## 验收结果

已完成本轮实现与自动化验收。关键验证结果：

- `node --import ./node_modules/tsx/dist/loader.mjs test/artifact-review-browser.test.ts`：通过，1/1。该真实浏览器用例通过 API 制造 stale revision，覆盖添加整体评论、vote 选择和删除 draft comment 的 409 自动恢复；同时断言没有浏览器 dialog/alert，恢复后服务端 draft 保留用户输入和最终选择。
- `node --import ./node_modules/tsx/dist/loader.mjs test/view-browser.test.ts`：通过，46/46。
- `npm run typecheck`：通过。
- `npm test`：通过，271/271。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过。
