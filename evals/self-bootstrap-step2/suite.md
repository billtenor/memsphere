# memsphere 自举验收 Step 2：Schema

## 目的

验证一个上下文干净的 Agent 能否依靠统一 `memsphere` Skill 和标准 Store 中的 Memory，独立发现、理解并应用顶层 Schema，生成或检查符合结构与呈现格式的产物。

Step 0 中的 Agent 已经接触过 Concept 内嵌的匿名 Schema。Step 2 进一步验证 Schema 作为独立 Memory 时的发现、选择和完整应用能力。

## Case

1. `001-create-outline-release-record`

   根据简单的 outline Schema 创建发布记录，验证第一层字段是否成为 Markdown 标题。

2. `002-create-nested-incident-review`

   根据嵌套 outline Schema 创建故障复盘，验证父子字段是否形成正确的标题层级。

3. `003-create-table-device-inventory`

   根据 table Schema 创建设备盘点表，验证字段是否成为表格列、列表元素是否各占一行。

4. `004-apply-schema-asserts`

   在实现 outline 结构的同时应用 Schema 自身的内容约束。

5. `005-request-missing-schema-field`

   面对缺少必需字段信息的任务，先向用户询问，不猜测或创建不完整实例。

6. `006-select-correct-schema`

   在单次记录和汇总表两份相近 Schema 中，根据任务目标选择汇总表。

## 能力覆盖

| Case | 主要能力 | 关键失败信号 |
| --- | --- | --- |
| 001 | 简单 outline | 字段没有成为标题 |
| 002 | 嵌套 outline | 父子字段被展平成同级结构 |
| 003 | table 和列表元素 | 没有使用表格，或多项没有逐行表达 |
| 004 | Schema asserts | 只满足结构，忽略内容约束 |
| 005 | 缺失信息处理 | 猜测、占位或创建不完整实例 |
| 006 | Schema 发现与选择 | 选择单次记录或自行发明结构 |

## 通过策略

整个 Step 2 同时满足以下条件时通过：

- 所有 case 的执行上下文均未受污染。
- Agent 实际读取了目标顶层 Schema。
- 产物同时满足目标 Schema 的 format、fields 和 asserts。
- 需要用户补充信息的 case 正确暂停，没有创建不完整产物。
- Agent 没有修改任何 Memory。
- 评分没有把 Schema 未约束的表达方式收窄为唯一参考答案。

详细标准保存在各 case 的 `evaluation.md` 中。

## 暂不覆盖

第一批 Step 2 不单独测试 `List<string>` 等基本类型列表的最终呈现方式。当前 `element_types` 已定义列表元素类型，但基本类型列表使用项目符号、表格还是其他形式尚无独立呈现契约。

本批次通过 table Schema 的 `element_types: [Schema]` 验证列表型结构。基本类型列表的呈现规则明确后，再补充对应 case。
