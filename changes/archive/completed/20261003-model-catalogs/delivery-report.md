# 敏捷需求开发交付报告

Run：`run-20261003-055813z-2e69aa7e`。工作树：`${WORKSPACE_ROOT}`，分支 `codex/model-catalogs`。采用已读取的仓库交付规范；本报告提交产品负责人最终验收，验收通过后继续 commit 和需求归档，PR 由流程后续 Human 步骤决定。

## 已交付功能

- 原始模型 JSON 放在仓库根目录 `reserved-models/`：五个内置模型位于 `system-models/`，八个示例位于 `market-models/examples/`，由同一个 `manifest.json` 管理。旧订单包与新示例包复用用例 02 的文件。正式 npm 包包含完整目录与恢复脚本。
- `memsphere project create` 为 Managed、Embedded Project 自动持久化五个内置模型的定义与登记。既有项目通过 `project models initialize` 显式补装；相同内容重复执行无改写，读取不自动安装。系统 ModelRef 保持不变，登记显示真实持久化 Store。
- 模型市场保留订单包 `memsphere.examples.orders`，新增完整的 `memsphere.examples` 示例包。01–08 显式导入后位于“已导入的包”；原始 JSON 和 06→07 引用保留。04、05 可以导入与浏览，现有 Runtime 不支持的特性仍明确拒绝。
- Run 模型查询读取所选 Project 的持久定义，配置变化正确更新当前及归档装配，原始内容字节语义不变。
- 双语 README、Skill、System Memory 源及当前工作树副本已同步；需求方案已经包含完整 `reserved-models` 设计。

## 当前 Project 整理结果

实际为 memsphere Project 安装 5 项内置模型，原有 40 个文件的字节保持不变。随后明确整理八个示例的 8 份定义和 8 份登记：全部已移出当前有效模型范围，只由市场供给，没有自动导入。保留的 11 个无关项目模型和 5 个系统模型均可读取；24 个非目标原文件经 SHA-256 核对未变。

移出前保存了完整原始定义与登记 envelope，并在隔离目录执行同一恢复实现，回执记录 `rehearsalPassed=true`。持久备份默认长期保留：

`${MEMSPHERE_HOME}/projects/memsphere/backups/model-registration/20261003-model-catalogs/696aed90-7f2b-4c97-93ee-081659a3be56`

`evidence/relocation-receipt.json` 包含完整恢复命令；恢复遇到损坏或新内容冲突拒绝覆盖。计划、初始化回执、独立文件核验和最终模型清单均保存在 `evidence/`。

## 验证与评审

最终 `npm test`：**933 项，932 通过、0 失败、1 跳过**。typecheck、clean build、资产门禁、正式 tarball 独立创建/导入/迁移恢复、CLI/HTTP、Run/归档、浏览器及 Reserved Store 测试均通过。playwright-cli 实际检查持久 Store 展示、八项预览和导入后包归属，浏览器无错误或警告。

研发、测试、架构分别检查实际工作树并独立复跑验证，均投通过，无阻塞、风险或建议 Comment；Runner 已通过实现成果 Review `review-20261003-092937z-1a30d87f` 的第 1 轮。完整结论见 `evidence/implementation-review.json`。

本轮发现的并发改动和回滚反例均已修复并回归。初轮两个旧测试断言失败已修正；沙箱限制通过授权升级执行隔离测试解决。当前没有已知未解决的功能阻塞。

## 最终 Memory 校验

ChangeSet：`change-20261003-091636402z-a82cefa2`，**valid=true**，issues 为空。
Checkpoint：`d0f039555c20f68294632d5f39c8b842f025528f2965d61e18f9497a87b8bafd`。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261003-091636402z-a82cefa2 。

普通 `memsphere validate` 同样通过；framework/view 的源与 worktree 副本逐字节一致。报告前检查未发现新的 Memory 差异；证据与最终内容匹配。

## 后续范围与残留边界

唯一跳过项为 Linux 环境中的 Windows PowerShell/CMD/Git Bash 专用测试，尚未在 Windows 实机复跑。远程市场、通用模型升级/卸载、自动清理所有旧 Project、模型编辑界面与完整 Draft-07 Runtime 支持均不在本轮范围。

产品交付验收待 Human 与产品 Agent 完成。本轮尚未 commit 或创建 PR；需求目录保持 active，验收通过后按已批准流程完成收尾。
