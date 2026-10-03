# 初始验证报告

Run：`run-20261003-055813z-2e69aa7e`。按已读取的 `memsphere-repository-testing-rules` 和已通过实施方案验证；完整测试在开发阶段已实际执行，当前步骤再次核验真实整理结果及最终 Memory，没有用历史项目测试替代本轮证据。

## 验证结果

| 范围 | 实际执行与结果 |
| --- | --- |
| 静态检查与构建 | `npm run typecheck` 通过；最终 `npm test` 的 pretest 执行 `npm run build`，五个系统模型、两个市场包的完整性门禁通过。 |
| 全量测试 | `npm test`：933 项，932 通过、0 失败、1 跳过，耗时约 44.7 秒。日志 `/tmp/memsphere-model-catalogs-final-tests.log`；结果摘要在 `evidence/test-summary.json`。 |
| 系统模型与初始化 | 持久定义及登记、稳定 ID、raw 字节、空读不写、配置/标记/记录无变化幂等、真实 Managed/Embedded CLI create、失败与并发修改保护、登记根迁移通过。 |
| Run 与归档 | 正常配置入口读取持久定义；切换登记根和 Project 隔离；current/archive 共用正确装配；归档恢复保持内容；未安装及损坏定义拒绝模型读取，内容 Store 仍读写原字节。 |
| 资产与市场 | 原始 JSON/清单、遗漏/重复/非法定义/路径及引用闭包、两个包、八项完整导入/重复/冲突/回滚、06→07 引用、04/05 可入库且业务 Runtime 限制保留。 |
| 正式发行物 | 从 npm tarball 独立创建 Managed/Embedded 并用新进程重开；HTTP 导入两个包；包内维护脚本 plan/apply/restore、重复操作、备份损坏和恢复冲突拒绝；完整原始登记 envelope 和定义字节恢复。 |
| 浏览器 | playwright-cli 实操隔离 View：内置模型真实 Store、八项预览、显式导入后已导入包计数 8，console Errors/Warnings 均 0。自动浏览器测试逐一读取八项信息、结构与原文；旧订单包回归通过。 |
| 迁移与恢复 | 13 项隔离恢复测试通过；移动中修改源、修改已移动原件、回滚时同模型新登记占用、损坏备份、重复恢复等都保留现场且诊断正确。独立 Agent 复跑两个原始反例，确认不会误报成功或制造重复登记。 |
| System Memory | `test/reserved-store.test.ts` 通过；framework/view 源和工作树副本字节一致；普通 `memsphere validate` 和最终 ChangeSet validate 均通过。 |

## 当前 Project 实际验收

初始化新增 5 项系统模型，19 项既有登记保持；操作前 40 个文件 SHA-256 全部未变。随后按固定八项计划先备份、隔离恢复演练，再移走 8 份定义和 8 份登记。当前步骤再次通过 Project Host 读取：5 项系统 + 11 项保留项目模型，八项示例未导入且只在市场供给，四个 raw Runtime 保留字节语义。

`evidence/relocation-verification.json` 核对 24 个非目标文件与 16 个备份文件的原字节。`evidence/relocation-receipt.json` 记录 `applied`、`rehearsalPassed=true`、持久备份路径和可直接执行的恢复命令。真实整理未触及其他 Project，未自动导入示例，也未覆盖非目标模型。

## 首轮失败、环境限制与修复

- 首轮全量 924 项中两个失败来自旧的单市场包按钮定位与旧 npm 白名单断言；已按两个市场包/新发行内容更新，最终全量通过。
- 独立代码审查发现并修复：成功前缺少 moved-original 最终复核、自动回滚未防同模型其他登记占用、系统登记可切换元模型 Store、初始化回滚覆盖外部新改动。均新增真实反例测试。
- 最早构建门禁过早 import 恢复服务，触发尚未复制的 prompt 模板依赖；改为检查编译服务文件存在，真实运行由 tarball 集成覆盖。最终 clean build 通过。
- 沙箱曾阻止子进程与本地 HTTP 监听，授权升级后同一隔离测试通过。playwright-cli 默认 Chrome 不存在，改用机器已有 Chromium 完成实操，没有安装或升级依赖。
- 最终唯一跳过项为 Windows PowerShell/CMD/Git Bash Agent Review shell 集成，因为当前运行环境是 Linux；没有已知历史失败冒充本轮失败或未处理的环境阻塞。

## 最终 Memory 证据

ChangeSet：`change-20261003-091636402z-a82cefa2`；最终内容 `valid=true`、issues 为空。
Checkpoint：`d0f039555c20f68294632d5f39c8b842f025528f2965d61e18f9497a87b8bafd`。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261003-091636402z-a82cefa2 。完整校验回执：`evidence/memory-validation.json`。

没有未解决的本轮阻塞问题。尚待流程规定的实现成果评审和产品交付验收；未提交 commit 或 PR。
