---
id: 20261019-run-human-executor
status: accepting
type: bugfix
created: 2026-10-19
run_id: run-20261019-055937z-2a5c530e
---

# Run 展示 Human 执行者

Run 详情未展示步骤中已有的 `actor: human`，导致用户无法识别人负责的步骤；Memory 详情已正确展示。无重复需求，关联已完成的 `20261011-human-step-executor`（Memory/ChangeSet 的 Human 标记展示）。

## 验收标准

- Run 流程图的 human Action、if/while 条件及嵌套步骤显示“执行者 Human”/“Executor Human”。
- 当前、已完成和未开始的步骤均展示标记；保留当前步骤提示与产物契约。
- agent、默认执行者和 call 不显示 Human 标记。
- 中英文、桌面与 390px 窄屏可见且无页面横向溢出。

## 技术与测试方案

数据层及系统记忆已保留 actor，缺口位于 Run 的 decorateHead。追加独立于 Artifact 的执行者展示，并保留当前步骤标记。仅使用模块内可折行布局，不改变执行或快照语义。

在 builtin-run-view 浏览器集成测试新增中英文用例覆盖上述标准；修复前两例均因缺少执行者元素失败。交付前运行相关浏览器/样式测试、typecheck、build、memsphere validate 及全量 npm test，并使用 playwright-cli 检查页面。

## 开发任务

- [x] 定位根因并复现失败。
- [x] 修复 Run 步骤头部及布局。
- [x] 完成测试与验证。

## 验收结果

本地验收通过，最终验证评审中产品、研发、测试均通过，等待提需方确认；保持 accepting，不提前归档。

- 定向浏览器与样式测试：16/16 通过。
- `npm run typecheck`：通过。
- `npm test`：146/146 文件通过；1212 项通过、1 项跳过、0 失败，362.95 秒。pretest 包含 `npm run build`，已通过。
- `node dist/cli.js validate`、`git diff --check`：通过。
- playwright-cli：桌面和 390px 窄屏实测通过；Human 和当前步骤提示共存，无横向溢出。窄屏中正文宽度 258px / 头部 326px，避免 metadata 挤窄正文。
- 无 Memory 差异，不创建空 ChangeSet；此修复恢复已有 actor 展示语义，不修改执行、数据或快照。
- 未执行项：本地未运行 macOS/Windows；由后续 PR CI 验证。当前用户运行中的 View 尚未部署此分支。
