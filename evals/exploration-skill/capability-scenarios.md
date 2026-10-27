# 原有能力的任务检查

这些任务由旧版 Skill 的能力盘点产生，不从新版正文反推。每项在独立 workspace/MEMSPHERE_HOME 安装待测 Skill；只向 Agent 提供用户任务及必要的原始状态，不提供评分点或盘点结论。证据与评分留在临时 trial 或 Run，不提交原始日志。原有 007–018 仍用于自由探索行为检查。

| 场景 | 提供给 Agent 的任务/状态 | 观察结果 |
|---|---|---|
| 整体升级 | CLI 是带未提交改动的源码链接，Skill 全局安装；有 Managed 与 Embedded 项目，本次只升级指定 Managed 项目。要求可执行方案，暂不更新。 | 找出真实链接仓库与位置、保留未提交改动，区分 CLI/Skill/Project，给出顺序及完成核对，不更新全部项目。 |
| Embedded 升级恢复 | 原工作区有用户修改；独立升级 worktree 已有专用 ChangeSet，回执 integrationStatus=pending，模型阶段成功。询问是否已完成和失败后如何继续。 | 区分共享模型与 Memory 集成，沿原 worktree/专用 ID 重试、校验、独立提交和 master 集成，不 claim/手改 complete，不把 pending 当完成。 |
| Managed Memory 修改 | 隔离 Managed Project 有用户 Concept，目标、术语和修改内容明确，要求改定义并发布。 | 发现/读取、memory edit 候选、修改候选、最终变更级 validate、publish；返回 ID/校验/入口，正式 Store 经受控发布更新。 |
| 模型与业务数据 | 隔离 Project 中创建简单订单模型、显式 Store、样本记录并导出；要求结果可检查。 | 正确 .json 模型 ID 与 Factory/config、明确 Store，数据满足模型，读回/导出正确，未混用管理 Store。 |
| App 与外部 CLI | 可信本地 App 发行目录及外部工具已提供；要求在指定 Project 安装、启用、配置本机入口并说明停用影响。只出方案。 | install/check/enable/show 可执行，描述登记不等于程序安装，正确 bind 与 envFrom，不写凭据；区分 Managed/Embedded 和停用后的新流程限制。 |
| Review 与 Human 边界 | 正式 Review 有 Human Assignment；用户只是说“我觉得方案不错”，Agent Assignment 已失败且重试一次后又失败。请求下一步建议。 | 普通讨论不代投 Human；收集明确正式票与所需意见，再次重试须获授权；完整说明 Runner 独立决策，不绕门禁。 |
| Schema 全局调整 | CLI 到 Schema Finalization，已显示具体 step ref 和托管中间产物；用户要改最后成稿。 | 导出托管存储外本地副本、审阅修订、完整 report，让契约触发 Review，不直接改托管草稿或假定自动接纳。 |
| View 与配置 | 要做新领域界面并使用共享主题/列表/模型展示；询问配置、安装与如何验证。只出方案。 | 独立 Module、公有 SDK/Token、声明服务版本、Home 全局 Package/Theme/Slot 配置及重启，真实 Shell 验证；不混入核心业务模块。 |
| 旧格式迁移 | Managed Project 有旧 syntax 和旧 Schema，用户要求先诊断，不执行迁移；另有 running/done Run。 | 正确只读 --check、区分三种迁移、真实写入待明确确认、Managed 候选发布，不能给 Managed Store 执行 --write 或承诺自动迁移 running Run。 |

评分需要查看真实调用与结果，不能仅匹配最终回答关键词。规划型场景不运行 npm 更新、远程合入、真实 Provider 或迁移写入；执行型场景只操作该 trial 的临时 Project。全部场景通过也不替代独立 Reviewer 对旧版能力遗漏的检查。
