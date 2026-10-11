# 当前迭代需求契约

## 整体目标与背景

用户指出 Memory 和 ChangeSet 中的 Procedure 步骤显示产物却遗漏执行者。既定要求是只隐藏 Agent，Human 必须展示。2026-10-11 用户要求将此修复纳入敏捷需求流程，自己不参与评审角色，全部角色由 Agent 承担。

## 当前迭代范围

在官方 Memory/ChangeSet renderer 的步骤标题中显示 `actor: human` 的执行者 Human。`actor: agent` 和省略 actor 的步骤维持不展示执行者。普通 Action、嵌套 Action、If/While 的 condition Action 遵循相同规则；Call 没有 Action actor，不增加执行者。保留既有 Artifact 和 Reviewer 显示。

ChangeSet 的完整内容与 Diff 都遵循以上规则。Human 标记拥有准确的 actor 字段锚点，可在该字段添加 Comment；执行者变化不归入 Artifact 的差异分组。修复代码、回归测试、System Memory 源与项目副本，以及可审阅验收记录一同交付。

## 后续范围

具名执行者、多人执行、Run/CLI 执行语义或布局重构不属于本轮；无新增 DSL 字段。本流程后续创建本轮 commit。当前请求未要求发布、部署或创建 PR；PR 是否创建按流程的最终决策步骤处理。

## 交付物

代码与自动化回归测试；同步的 System Memory；需求契约、实施与验证方案、开发计划、实现摘要、验证报告、Agent 验收与交付记录；最终 Memory ChangeSet 校验证据；本轮 commit 记录。

## 验收标准

1. Memory 普通与嵌套 Action 中，human 显示“执行者: Human”（英文“Executor: Human”），agent 与省略 actor 不显示该标记。
2. If/While 条件的 human 同样展示，actor 锚点使用 `.condition.actor`；普通 Action 使用 `.actor`。
3. ChangeSet Full content 能展示 Human；Diff 中的 Agent→Human 与 Human→Agent 变化可被辨认，完整内容中的 Agent 始终不显示执行者。
4. 执行者 Comment 绑定准确的 Memory reference 和 actor anchor，Artifact 标签与 Reviewer 摘要保持原有显示和评论定位。
5. 桌面和窄屏无新增水平溢出，展开/收起仍可正常操作。
6. 自动化测试覆盖本次风险；适用浏览器集成测试、reserved-store、typecheck、build、全量 npm test、Memory Store 与 Memory ChangeSet 校验通过。
7. Source 与当前项目的 System Memory 副本一致；校验证据匹配最终 Memory 内容。所有 Review Slot 都绑定 Agent，Human 不承担评审角色。

## 向前兼容

结论：不需要向前兼容。当前本地仓库没有名称包含 stable 的 Tag；本轮恢复现有 `actor: human | agent` 的展示契约，不增加或迁移数据字段，不改变现有 Memory、Run 或 Review 数据格式。

## 采用的 Statement

从 Run `run-20261011-112708z-81640985` 的冻结快照读取并采用：`memsphere-repository-requirement-rules`（契约与向前兼容）、`memsphere-repository-development-rules`（适量复杂度及 System Memory 同步）、`memsphere-repository-testing-rules`（真实验证与变更校验）、`memsphere-repository-delivery-rules`（交付记录、归档）。

## 已有工作与待确认项

上一轮已有候选实现及验证；它们作为待审候选，不作为已取得本流程批准的证据。所有角色由产品 traex1、研发 traex2、测试 traex3、架构 traex4 承担。无待 Human 评审的事项；Agent Reviewer 可指出候选缺陷，Runner 按正式 Review 结果修复。
