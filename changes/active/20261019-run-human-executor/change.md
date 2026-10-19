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

显示修复阶段（5b5743a）本地验收及产品、研发、测试评审通过，等待提需方确认；保持 accepting，不提前归档。CI 性能扩展后的最终结果记录在关联 Run 与 PR。

- 定向浏览器与样式测试：16/16 通过。
- `npm run typecheck`：通过。
- `npm test`：146/146 文件通过；1212 项通过、1 项跳过、0 失败，362.95 秒。pretest 包含 `npm run build`，已通过。
- `node dist/cli.js validate`、`git diff --check`：通过。
- playwright-cli：桌面和 390px 窄屏实测通过；Human 和当前步骤提示共存，无横向溢出。窄屏中正文宽度 258px / 头部 326px，避免 metadata 挤窄正文。
- 无 Memory 差异，不创建空 ChangeSet；此修复恢复已有 actor 展示语义，不修改执行、数据或快照。
- 未执行项：本地未运行 macOS/Windows；由后续 PR CI 验证。当前用户运行中的 View 尚未部署此分支。


## CI 性能扩展

用户在本轮明确要求继续处理 CI 性能。首次 Windows Project Lifecycle 的 11 个测试文件全部通过，但作业清理触及五分钟时限；针对性重跑也超时。主分支最近两次运行已有总预算失败。

下载的 Windows 耗时证据显示：`project-upgrade.test.ts` 单文件 247.40 秒，整个项目套件 247.40 秒；`project-command.test.ts` 153.95 秒，其余文件较短。文件级调度无法拆分升级文件，存在串行长尾。

将升级用例按 Managed 升级、Embedded 升级、目标路由/Skill 升级拆为三个独立文件，提取原有隔离 fixture。AST 对比确认全部 11 个 test 调用的正文和断言逐字保留；未删用例或降低断言。Windows 项目套件使用三个文件级进程；保持五分钟门禁。Windows Review/Shell UI 的测试阶段为 207.51 秒、完整作业 281 秒，亦接近总预算；其最长文件仅 105.38 秒，因此同样改为三个文件级进程，缩短整体排队。调度权重按原分组耗时分配，Windows 依据本次实际耗时，其他平台按原文件权重比例估算，后续以 CI 数据核验。

- 拆分后升级测试：11/11 通过（28.72 秒，Linux 本地三个进程）。
- 跨平台测试归属与调度测试：通过，确保每个平台没有丢失或重复测试。
- CI 性能扩展后的完整回归与线上 CI 结果记录在关联 Run 与 PR，不以旧提交结果代替。

## 向前兼容

结论：不需要向前兼容。本轮恢复既有 actor 展示，并调整测试文件与 CI 调度；不改变 DSL、运行数据、命令或快照契约。
