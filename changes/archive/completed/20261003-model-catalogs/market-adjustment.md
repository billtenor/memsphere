# 交付验收补充：移除独立订单市场包

日期：2026-10-03。Run：`run-20261003-055813z-2e69aa7e`。

Human 要求“订单示例就去掉了吧”，并在询问已导入内容如何删除后，明确选择“暂不扩展，先移除市场订单包”。本记录补充首轮冻结交付报告，不改写历史 Submission，也不代替 Human 的正式交付投票。

## 最终范围

- 市场仅提供 `memsphere.examples`「示例模型」，包含完整用例 01–08；订单模型仍为用例 02。
- 从发行清单移除 `memsphere.examples.orders`。市场不再列出该包，新的导入请求返回包不存在。
- 已导入的订单模型依靠 Project 自己的定义和登记读取，继续保留；不修改现有 Project 数据，不新增卸载功能。
- 旧订单导入候选仍按固定包 ID、唯一 ModelRef 和登记数量识别并清理；未知候选继续拒绝，已发布记录不由候选清理移除。
- 同步 README、Skill、framework System Memory 源与当前工作树副本，以及当前需求范围。历史整理基线、备份和恢复契约不变。

## 验证

`npm run typecheck`、`npm run build` 与 `memsphere validate --format json` 已通过。资产及市场模块测试通过；浏览器、正式 tarball、View 设置 API 与 Reserved Store 的受影响集成测试 26/26 通过。独立只读审查确认下架不影响已发布导入读取，旧候选识别范围未扩大。最终 `npm test`（包含 clean build）共 937 项，936 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过；完整回归日志 `/tmp/memsphere-market-adjustment-full.log`，摘要见 `evidence/market-adjustment-tests.json`。

Memory ChangeSet：`change-20261003-091636402z-a82cefa2`，`valid=true`，issues 为空。
Checkpoint：`5d3be81216981d1f9d269c10841c6b260b1ec44cb7578f85fdc9959c3f191b50`。
回执：`evidence/market-adjustment-memory-validation.json`。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261003-091636402z-a82cefa2 。

## 运行中 View 核验

已使用本工作树最终构建重启既有 View，访问地址和端口保持原配置。实际 GET `model-init-check` 与 `memsphere` 的模型市场接口都只返回 `memsphere.examples`，完整包含 01–08，用例 02 仍在。`model-init-check` 中 Human 已导入的八项模型全部可用，五项系统模型全部可用；`memsphere` 原有五项系统与十一项项目模型仍可用。这里只读取模型，没有向真实 Project 导入、删除或清理内容。回执：`evidence/market-adjustment-live-view.json`。
