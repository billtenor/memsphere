# 记忆市场

状态：doing

Memsphere Run：`run-20260826-041558z-2a3102b3`

## 目标

在 View 的 Memory 下增加“记忆市场”，展示随 npm 包发布的官方精选 Memory。市场内容默认不生效；用户点击导入或重新导入后，系统创建独立 ChangeSet，用户查看候选并自行发布或应用。

## 产品契约

- V1 只有 npm 包内官方精选内容，不接入远端、第三方、账号、评分或自动更新。
- 导入前不进入 Project Catalog 或 Run；导入后就是普通用户 Memory，可自由编辑、重命名和独立演进。
- 市场条目和 Project Memory 只按当前 `<kind>/<canonical-name>` 关联，不保存来源、市场 id 或版本。
- 状态仅为：未导入、导入中、已导入且无变更、已导入且有差异、名称冲突；一致性比较原始文件字节。“导入中”可跳转到对应 ChangeSet。
- 用户重命名后不再关联。市场条目改名等同旧条目下架、新条目新增；删除市场条目不影响用户 Memory。
- 同一 Project 的导入和重新导入持续追加到同一个 active 市场 ChangeSet，完成或废弃后才新建，不预先展示 diff。缺失的市场依赖随候选补入，Project 已有依赖不覆盖。
- 首批市场内容包含敏捷需求开发、bug 修复、代码分支评审与修复、需求管理流程，以及这些流程所需的通用规则、开发规范和测试规范依赖。
- 仓库专属开发规范和测试规范不进入记忆市场；市场流程只依赖吸收了可泛化实践的通用开发规范与通用测试规范。
- Managed 复用正常 ChangeSet publish；Embedded 仅允许 `market_import` ChangeSet 将校验后的隔离候选应用到当前 worktree，不 commit、push 或提前完成 ChangeSet。

## 实现范围

- reserved manifest v4 增加 `market_memory.install`，发布门禁校验路径、身份、冲突和可解析性。
- 市场读取、状态计算、依赖闭包和导入计划服务。
- 持久 `market_import` ChangeSet 及 Managed/Embedded 两种落地路径。
- View 的 Project/记忆市场入口、状态和导入操作。
- Memory、Skill、README、测试和敏捷流程验收记录同步更新。

## 非目标

- 自动升级、升级提醒、版本历史、来源追踪、语义 diff。
- 市场卸载、远程市场、第三方发布、搜索服务和个性化推荐。
