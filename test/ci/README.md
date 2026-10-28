# CI 基础设施测试

本目录集中验证仓库的 CI 机制：

- `ci-workflow.test.ts`：执行矩阵、测试覆盖和工作流配置。
- `test-plan.test.ts`：递归发现、测试归类与调度。
- `full-health.test.ts`：完整回归证据与合并门禁。
- `ci-change-guard.test.ts`：CI 修改保护、授权提示与可信工作流。

`npm test` 和 CI 计划使用同一份递归发现逻辑，包含本目录。测试仍按既有套件和平台矩阵执行，目录整理不减少覆盖。运行日志和结果文件以相对 `test/` 的路径标识测试，避免嵌套目录中的同名文件混淆。

本目录整体受 CI change guard 保护；新增 CI 基础设施测试也会自动纳入保护。
