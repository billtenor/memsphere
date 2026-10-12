# 第三轮实施与验证方案修订摘要

第二轮 Human 明确投要求修改，要求系统记忆升级使用专用 ChangeSet，Embedded 使用独立分支/worktree、单独 commit，并引导用户配合；三位 Agent 均通过，架构另建议补测旧 Run。全部意见接受。

- 替换整体工作树证据设计：System 升级 targets 独立，原用户差异与协作记录保持不变。
- 明确持久 intent=system_upgrade、范围/基线/worktree 元数据及专用创建/显式校验；普通捕获排除该记录，解决同仓库同 HEAD 不同分支复用问题。增加 --change 显式安全重试。不改所有普通记录的身份规则。
- Skill 引导独立分支/worktree；CLI 准备和校验，Agent 审阅后只提交 System 目标形成独立 commit，再按授权进行集成。说明准备、commit、合入及 ChangeSet 完成的区别。
- 增加同 HEAD 并存、用户差异/协作保护、专用范围违规、单独 commit 与完成生命周期的 Git 集成验证。
- 接受架构风险意见：run-model-artifact 回归及升级后 fingerprint 变化拒绝旧 Run 继续、恢复原目标或新建 Run 的说明。

此为 Human 授权的方案交付方式细化，项目升级仍一次处理系统记忆与系统模型/登记；CLI 自身不自动 commit/push/merge。尚未施工。
