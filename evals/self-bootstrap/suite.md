# memsphere 自举验收集合

## 目的

验证一个上下文干净的子 agent 能否依靠统一 `memsphere` Skill 和 `memsphere init` 安装到标准 Store 的 Memory，正确发现、理解并使用测试提供的业务 Memory，而不依赖仓库文档、实现代码、参考答案或旧的 memsphere skills。

## 当前 case

1. `001-create-bookkeeping-entry`

   子 agent 使用 memsphere 技能读取 fixture 提供的“记账”Concept 记忆，并创建 Markdown 记账实例。通过实例检查其能否综合理解 `defines` 中的字符串定义、匿名 Statement 和匿名 Schema。

2. `002-request-missing-bookkeeping-data`

   子 agent 面对缺少金额的记账请求，不得猜测或创建实例，应准确请求补充缺失信息。

3. `003-reject-invalid-bookkeeping-entry`

   子 agent 面对实际支付金额为零的请求，应识别 Statement 冲突并拒绝创建记账实例。

4. `004-create-outline-meeting-note`

   子 agent 根据 `format: outline` 的 Schema 创建使用 Markdown 多级标题组织的会议记录。

5. `005-create-table-expense-list`

   子 agent 根据 `format: table` 的 Schema 将多笔费用创建为 Markdown 表格。

6. `006-select-correct-memory`

   子 agent 面对“记账”和“报销申请”两份相关 Memory，根据任务目标和别名选择正确 Memory。

## 当前执行策略

- 先为 case 准备一份与 agent 无关的基线工程，通过 `memsphere init` 安装预置 Memory，并安装统一 `memsphere` Skill。
- 每次 agent 运行都从基线复制独立工作区，并使用独立的临时 `HOME`；运行结果不能写回基线。
- 每个 runner 只负责一种 agent 的启动和证据采集；新增其他 agent 时不修改 case 和基线准备逻辑。
- 每次运行都启动一个上下文干净、临时的子 agent。
- 只安装统一 `memsphere` Skill，不安装 `memsphere-edit`、`memsphere-review` 或 `memsphere-run`。
- 保留共享提示词，以及每次运行各自的事件日志、最终答案和最终工作区。
- 读取临时工程根目录以外的任何文件都视为验收污染。

## 能力覆盖

| Case | 主要验收能力 | 预置知识或路由来源 |
| --- | --- | --- |
| 001 | 完整读取并联合解释文本、Statement、Schema；进行可追溯推断；遵守路径 | Memory 解读与应用规则、Schema、统一 Skill |
| 002 | 识别必填信息缺失，只请求真正缺失项，不创建占位产物 | Memory 解读与应用规则、基于 Memory 完成任务流程、统一 Skill |
| 003 | 识别输入与断言冲突，指出约束并拒绝创建 | Statement、Memory 解读与应用规则、基于 Memory 完成任务流程 |
| 004 | 将 outline 精确实现为 Markdown 标题层级 | Schema、统一 Skill |
| 005 | 将 table 精确实现为 Markdown 表格列和逐项行 | Schema、统一 Skill |
| 006 | 使用名称和别名发现候选，并按用户目标选择而不是按局部事实选择 | Memory 访问规则、基于 Memory 完成任务流程、统一 Skill |

## 通过策略

同时满足以下条件时，当前验收集合通过：

- 验收过程没有受到污染；
- 子 agent 实际读取了当前任务所需的目标 Memory；
- 各 case 的产物或拒绝行为符合 Memory 中的定义、约束和结构；
- 子 agent 没有修改任何 Memory；
- 答案没有引入冲突的 memsphere 语义。

详细评分标准保存在每个 case 的 `evaluation.md` 中。

## 验收模式

- `full_skill`：使用当前完整的统一 `memsphere` Skill 运行；这是当前基线准备脚本安装的模式。
- `bootstrap_kernel`：移除冗余的快速理解摘要，验收纯 Memory 自举。
- `journey`：让同一个干净子 agent 按顺序完成一组 case。
- `isolated`：每个 case 都启动一个新的干净子 agent。

第一版实现 `full_skill + isolated`；其他组合后续补充。
