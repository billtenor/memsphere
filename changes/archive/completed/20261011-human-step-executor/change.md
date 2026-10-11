---
created_at: 2026-10-11
completed_at: 2026-10-11
---

# Memory 与 ChangeSet 显示 Human 步骤执行者

Memory 和 ChangeSet 共用的 Procedure renderer 仅渲染产物，遗漏了步骤的 Human 执行者。恢复既定规则：actor 为 human 时显示执行者 Human；agent 或省略 actor 时不重复展示。If/While 的 condition Action 遵循相同规则。

执行者拥有独立的 actor 字段锚点，ChangeSet 中支持差异展示及就地评论，不把执行者归入 Artifact 字段。System Memory 源文件与当前 Project 副本同步记录该规则；现有 Skill 的 Agent 步骤说明仍一致，无需更改。

2026-10-11 已按用户要求完成正式敏捷流程的需求/方案确认、实现验收与产品交付评审，所有评审角色均为 Agent。

## 验收

- `node --import tsx --test test/builtin-memory-view.test.ts test/reserved-store.test.ts`：最终 16/16 通过（浏览器 6 项、reserved-store 10 项），覆盖 Memory/ChangeSet、中英文、普通/嵌套/condition、agent/default/Call、双向 actor Diff 与评论定位。
- `node --import tsx --test test/reserved-store.test.ts`：10/10 通过。
- `npm run typecheck`：通过。
- `npm run build`：对最终代码与 Memory 再次构建，通过。
- playwright-cli：真实 30000 端口 View Shell 实测 Human 标记、展开/收起、390px 窄屏无水平溢出、ChangeSet Full/Diff 与执行者评论入口，通过。临时验收 ChangeSet 已废弃，0 Comment。
- `memsphere validate`：通过。
- `memsphere memory change validate`：通过，ChangeSet `change-20261011-070405378z-c1dc8736`，digest `f9eec90090f2ec26735eac736d8f7b1a9f2b50ec01765b34428a1cf9141b8f00`。
- Memory View：`http://0.0.0.0:30000/projects/memsphere/changes/change-20261011-070405378z-c1dc8736`。
- `npm test`：141 个文件全部通过；1168 项通过、1 项跳过、0 失败（294.75s）。其 pretest 已完成 `npm run build`。

首次沙箱内浏览器测试因 Chromium 系统调用被阻止而失败；获准在沙箱外运行后，受影响测试通过。全量回归也在沙箱外执行。

## 向前兼容

结论：不需要向前兼容。没有本地 stable Tag；本轮恢复既有 actor 展示，不新增 DSL 或持久化字段。

## 正式敏捷流程验收

Run `run-20261011-112708z-81640985`，四个角色全部绑定 Agent。实现 Review 中研发、测试、架构均 approve，无 Comment；产品交付 Review approve，仅建议对齐此记录中的最终测试计数，现已修正为受影响 16/16、全量 1168 passed、1 skipped、0 failed。默认流程选择意见依据用户明确指定敏捷流程的指令正式处置，原始意见/Runner 决策保留在 Review 和 workflow-authorization.md。

产品交付 Review `review-20261011-114409z-492104ae` approve，建议已 accepted-fixed，Runner 已 approve。归档与当前迭代 commit 按流程完成，commit SHA 和最终 Run 状态记录在 Run 的后续产物中，避免在 commit 内容中自引用自身 SHA。

## 后续页面验收

用户查看部署页面后要求执行者与产物使用相同样式。执行者标签和值复用产物的样式类，统一字体、颜色、间距并移除冒号；两项信息组合排列，保留独立 actor 评论锚点。用户确认页面符合预期，并明确要求提交 PR。

样式调整后 `npm run build`、6 项 `test/builtin-memory-view.test.ts` 页面回归、`git diff --check` 通过。playwright-cli 在部署后的实际 View 页面核对两组标签和值的颜色、字号、字重、行高、背景及边框，均一致。前述全量测试和 Agent Review 是样式调整前的实现验收证据；后续样式版本未重复全量测试，原 verification-evidence.json 的源文件哈希保留为该轮历史证据。
