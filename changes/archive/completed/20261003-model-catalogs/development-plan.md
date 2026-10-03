# 开发计划

Run：`run-20261003-055813z-2e69aa7e`。依据：需求契约第 3 轮、实施方案第 2 轮及 Runner 已记录的评审处置。各任务必须在本轮交付前完成。

| 编号 | 任务与责任 | 交付及验收 |
| --- | --- | --- |
| T1 | 资产与市场：market_examples_survey | 原始 JSON、manifest、无 IO 登记契约、统一资产加载器、完整 schema 引用工具、两包目录与导入；源字节、合法高级定义、引用闭包、旧订单身份、失败与重复导入测试。 |
| T2 | 系统持久化：builtin_survey | 私有系统定义 Store、完整 system 子树安装、登记自举及三来源读取、Project Host、create/initialize 与幂等回滚；覆盖无虚拟模型、只读发现、5项落库、冲突、损坏、自定义目录/迁移和真实 CLI 创建。 |
| T3 | 示例整理与恢复：catalog_contract_check | 专用 plan/apply/restore 服务及脚本、固定八项基线、持久完整备份、隔离恢复演练、引用/变化预检、回滚回执和保留策略；只在隔离 fixture 测试，Agent 不自行操作真实 Project。 |
| T4 | Run 装配、打包与集成：Runner | config → prepareRunData → current/archive 路径与配置缓存，npm 白名单/构建门禁/tarball 恢复测试，模块接口整合及回归修复。 |
| T5 | 文档与 Memory：Runner | README/Skill、reserved-memory 源与当前 worktree 副本同步；记录适用规范、Memory ChangeSet 和本轮验证证据。 |
| T6 | 完整验证与真实整理：Runner | 受影响测试、typecheck、全量测试、build、Memory双校验、适用浏览器实操；满足前置条件后显式补装当前 Project 系统模型并整理八项示例，保留备份及回执。 |

## 并行接口与写入边界

T1 先提供纯登记契约、清单加载与引用检查接口，通知 T2/T3；T2/T3 可以同时完成各自独立文件。T1 不修改 `model-registration.ts`、`models.ts`、`commands/project.ts`；T2 不修改 T1 的清单/市场/引用文件；T3 不修改真实数据或其他模块。Runner 负责 `config.ts`、`run-data.ts`、归档调用、package/build、Memory、跨模块问题及最终验证。调整共享接口先沟通，避免互相覆盖。

## Run 装配任务细化

本节落实实施方案评审 comment-20261003-090742z-c8803583，不改变方案行为：

1. `src/config.ts/readProjectExecutionConfig` 从解析后的 `context.primary` 构造 `{root, modelsDirectory, modelRegistration}`，传给 `prepareRunData`。
2. `src/project/run-data.ts` 在同步装配接口中接受可选 ProjectModelInput，内容 Store 保留既有字节读写；同一 manager 的模型/Runtime 查询惰性读取实际 Project Model Host，失败不缓存为成功。独立模式限定为无 Project 配置的内容 Store 调用，不向项目列表注入虚拟模型。
3. hosts 以规范 runsRoot 与 archiveRoot 定位 current/archive 两个键，二者共享一个 manager；复用还须匹配规范 Project Root、模型目录及完整登记存储配置 fingerprint。显式配置改变时同时替换两键，其他 Project 独立。
4. `src/archive/store.ts/transferRun` 及相关调用点不得用仅包含 roots 的输入覆盖已准备的 Project 装配；独立归档入口如需模型查询，传播明确的 Project 输入或从对应根配置读取，同样不隐式初始化。manager 注入分支保留。
5. 扩展 `run-data-access`、`archive-run-data` 与配置入口测试：正常 `readConfig` 使用自定义登记根的持久 raw 定义；当前和归档访问共享正确身份；归档不降级；Project 隔离；同根模型配置改变不复用旧 manager；原 bytes 行为和显式 Runtime 反射能力保留。

## 发布、恢复与验证任务细化

- `package.json.files` 明确包含 `reserved-models` 与 `scripts/relocate-example-models.mjs`；脚本服务和历史基线只依赖包内 dist/资产。build 检查脚本及目录完整性。
- 解包 tarball 测试真实 Managed/Embedded create、两包目录/八项导入，以及包内脚本 plan/apply/restore；验证原文字节、完整登记 ID/revision/时间戳、重复恢复和损坏/冲突拒绝，不读取源码 checkout。
- 当前 Project 操作前先验证八项原始定义及登记基线、市场发行源、所有保留模型引用和存储配置；备份位于已排除的持久 backups 目录，先从备份在隔离目标演练同一恢复实现。任一步未通过均不移出真实数据。
- 当前 Project 操作由 Runner 显式执行并保存日志，其他 Agent 仅使用隔离 fixture。最终只保留系统模型和无关项目/已导入模型，八项示例只在市场供给中出现。
- 先跑受影响测试，再运行仓库要求的 typecheck、全量测试、build、memsphere validate；最终 Memory 差异必须进行 change validate 并记录可核对证据。前端交互变化使用 playwright-cli 实操。

## 流程门槛

开发完成后按 Run 依次提交实现摘要、实际初始验证、实现与验证成果评审及交付报告。只有提需方通过交付验收后才执行流程中的 commit/归档；PR 由后续 Human 步骤决定。当前仅完成计划，未声称实现或测试通过。
