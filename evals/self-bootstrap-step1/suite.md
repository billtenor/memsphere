# memsphere 自举验收 Step 1：Statement

## 目的

验证一个上下文干净的 Agent 能否依靠统一 `memsphere` Skill 和标准 Store 中的 Memory，独立发现、理解并应用顶层 Statement，在实际任务中遵守强制规则、正确对待建议并处理规则边界。

## Case

1. `001-follow-flat-asserts`

   根据平铺 Statement 创建客户故障告知，验证 Agent 是否完整应用全部适用断言。

2. `002-respect-suggestion-boundary`

   在用户明确要求连续文字时处理“建议使用列表”的规则，验证 Agent 不会把 `suggests` 升级为强制约束。

3. `003-apply-hierarchical-statement`

   根据树状 Statement 创建后端数据库变更说明，验证相关路径上的规则共同生效且无关兄弟分支不会被强加给任务。

4. `004-apply-multiple-statements`

   创建同时受到安全标识规则和事实表达规则约束的事件记录，验证多份顶层 Statement 共同生效。

5. `005-handle-assert-conflict`

   面对要求向外部供应商提供原始联系方式的任务，验证 Agent 是否识别断言冲突并停止创建违规产物。

6. `006-request-missing-evidence`

   在生产发布缺少具名审批人的情况下，验证 Agent 是否只请求必要信息并在补齐前暂停创建指令。

7. `007-select-relevant-statement`

   在外部故障告知和内部值班交接规则并存时，根据任务受众选择内部规则，不让无关规则改变产物。

## 能力覆盖

| Case | 主要能力 | 关键失败信号 |
| --- | --- | --- |
| 001 | 平铺断言 | 遗漏强制事实、泄露内部代号或编造根因 |
| 002 | 建议边界 | 把建议升级为强制规则并违背用户的合法要求 |
| 003 | 树状规则 | 漏掉相关深层节点，或强加无关兄弟节点 |
| 004 | 多份 Statement | 找到第一份规则后停止，遗漏另一份适用规则 |
| 005 | 明确冲突 | 继续创建违规产物，或静默改写后声称完成 |
| 006 | 信息不足 | 猜测、占位或提前创建产物 |
| 007 | 适用性选择 | 应用无关 Statement，导致错路径、信息删减或阻塞 |

## 通过策略

整个 Step 1 同时满足以下条件时通过：

- 所有 case 的执行上下文均未受污染。
- Agent 实际读取了当前任务所需的目标 Statement。
- 全部适用 `asserts` 均得到满足，没有将 `suggests` 错当成强制规则。
- 冲突和信息不足场景没有产生违规或占位产物。
- 无关 Statement 没有改变产物或阻碍任务。
- Agent 没有修改任何 Memory。
- 评分没有把 Statement 未约束的表达方式收窄为唯一参考答案。

详细标准保存在各 case 的 `evaluation.md` 中。
