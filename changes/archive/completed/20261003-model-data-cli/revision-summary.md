# 第二轮需求契约修订摘要

Run：`run-20261003-090655z-f1e492f6`。
Review：`review-20261003-091025z-c55e8931`。
上一轮：`round-20261003-091025z-440fe761`。
修订日期：2026-10-04（Asia/Shanghai）。
代码依据：master #84，`2b7400b0d3bff6670982ebcd0a02f023a6859e34`。

## 修订来源

Human billtenor 在第一轮正式投 request_changes，要求采用合入 master 后的 CLI 设计更新，修改后重新发起 Review。Runner 按该明确指示代提交 1 条 blocking Comment。产品 Agent 第一轮投 approve；第一轮最终为 changes_requested。原 Run 冻结上下文、Submission、Vote 和角色绑定保留不变。

## 意见落实

| 修改要求 | 修订结果 |
| --- | --- |
| 适配系统模型持久化 | 明确四类定义 Store；已安装 system 的 source 来自持久化原文，origin 与 storage 分开；新建 project 的 .json 规则不套用于既有无后缀 system/raw ModelRef |
| 系统模型展示信息可编辑 | update 允许 set/unset name、description、tags；定义、身份、元模型、store_id、storage、package、package_name 及删除受保护；混用合法和受保护参数整体拒绝 |
| 定义有效性与 Runtime 分离 | create、定义 update、validate 默认 definition，显式 runtime 才增加编译检查；元数据单独修改默认不编译；未检查/支持/不支持分别表达；check-data 隐含 Runtime，拒绝显式 definition 冲突组合 |
| 引用检查不依赖 Runtime 子集 | 用独立 Schema 引用收集覆盖高级 Schema 位置及 fragment，排除普通示例数据的伪 `$ref`；保留合法跨包 Project 引用，不机械复用市场包闭包限制 |
| 保持定义演化保护的一致性 | definition 模式对反向依赖只强制定义与引用有效性；runtime 模式再编译受影响模型；有传递反向依赖绑定业务 Store 时也拒绝定义变化，避免绕过已有实例保护 |
| 初始化和损坏边界 | 新 Project 自动安装，旧 Project 显式 initialize；未安装时不产生虚拟系统行；已安装损坏不 bundle fallback、不自动修复；普通定义损坏可隔离，关键登记模型损坏可令 Catalog 整体失败；定义字节未变时重复初始化保留展示字段，外部修改定义字节后初始化报冲突并保留原文 |
| 系统写入防绕过与回归 | 增加所选登记目录下 system/definitions、system/registrations 和两类保留 Store ID 保护；验收矩阵补充稳定 ID/原文、元数据初始化保留、损坏分层、完整引用、八例市场及 Run raw 回归 |

## 保持的迭代边界

命令仍为 model、data、data store 三组；业务数据 CRUD、JSON Pointer/Patch、最小 Store 管理、跨 CLI 进程条件写及值/Payload 区分保持。模型市场 CLI、模型/Store 迁移、通用查询与批量事务仍后置。八例市场目录用于验证，不增加市场命令。

## 本轮核对与状态

已按合入后的代码、系统模型/市场测试及当前 memsphere-framework Memory 核对修订内容，并检查命令表、字段约束和验收矩阵一致性。当前仅修订需求及评审记录，没有实施业务代码、修改 Memory 或执行实现测试，不创建空 ChangeSet。修订后的完整需求契约提交同一 Review 的第二轮，等待产品 Agent 与 Human 的新 Vote。
