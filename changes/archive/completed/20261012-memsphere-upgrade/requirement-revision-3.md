# 第三轮需求契约修订摘要

第二轮 Human 与产品 Agent 均投要求修改；Human 已明确授权将刚刚讨论的三类升级和 skill upgrade 一并整理到需求契约并提交新一轮评审。两项意见均接受。

1. 明确三类升级：项目运行资源走 `memsphere project upgrade`；Skill 走新增 `memsphere skill upgrade`；CLI 按 npm 安装或本地源码连接的实际来源升级。View 重启和旧格式迁移是有条件的配套步骤。
2. 新增 `skill upgrade` 的功能契约和验收：相同目标参数下等价于 `skill init --force`，默认、`--global`、`--directory` 沿用 init 的选择与校验规则，内置覆盖语义，保留首次安装入口及其他 Skill。
3. 要求三类升级及自然语言使用入口明确落实到 Skill。Agent 识别升级范围、安装来源和目标，组织所需步骤并核对完整结果；整体升级先更新 CLI 资源来源，不自动扩展到全部项目。
4. 接受产品 Agent 的测试门禁意见：明确采用 `statements/memsphere-repository-testing-rules`，验收写入 typecheck、全量 npm test、build、Store validate，以及有 Memory 差异时最终变更级校验与 ChangeSet 证据。

统一项目命令范围仍为系统记忆＋系统模型/登记；现有单项命令行为保留。当前只修订需求文档，尚未修改实现、Skill 或 Memory。提交第三轮需求评审，后续方案仍由架构、研发、测试评审。
