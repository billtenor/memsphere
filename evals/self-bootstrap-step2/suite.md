# memsphere 自举验收 Step 2：Schema

## 目的

验证一个上下文干净的 Agent 能否依靠统一 `memsphere` Skill 和标准 Store 中的 Memory，独立发现、理解并应用顶层 Schema，生成或检查符合结构与呈现格式的产物。

Step 0 中的 Agent 已经接触过 Concept 内嵌的匿名 Schema。Step 2 进一步验证 Schema 作为独立 Memory 时的发现、选择和完整应用能力。

## Case

1. `001-create-outline-release-record`

   根据 object + Markdown outline Schema 创建发布记录，验证第一层字段是否成为 Markdown 标题。

2. `002-create-nested-incident-review`

   根据嵌套 outline Schema 创建故障复盘，验证父子字段是否形成正确的标题层级。

3. `003-create-table-device-inventory`

   根据 array + Markdown table Schema 创建设备盘点表，验证 item object 的字段是否成为表格列、数组元素是否各占一行。

4. `004-apply-schema-asserts`

   在实现 outline 结构的同时应用 Schema 自身的内容约束。

5. `005-request-missing-schema-field`

   面对缺少必需字段信息的任务，先向用户询问，不猜测或创建不完整实例。

6. `006-select-correct-schema`

   在单次记录和汇总表两份相近 Schema 中，根据任务目标选择汇总表。

7. `007-expand-repeat-field-group`

   根据两组业务输入展开包含多个字段的 Repeat body，验证重复字段组整体展开、实例隔离和前后固定字段顺序。

8. `008-handle-repeat-limit-conflict`

   当用户要求保留的实例数量超过 Repeat 上限且无法无损取舍时，指出冲突并请求用户调整。

## 能力覆盖

| Case | 主要能力 | 关键失败信号 |
| --- | --- | --- |
| 001 | 简单 outline | 字段没有成为标题 |
| 002 | 嵌套 outline | 父子字段被展平成同级结构 |
| 003 | table 和列表元素 | 没有使用表格，或多项没有逐行表达 |
| 004 | Schema asserts | 只满足结构，忽略内容约束 |
| 005 | 缺失信息处理 | 猜测、占位或创建不完整实例 |
| 006 | Schema 发现与选择 | 选择单次记录或自行发明结构 |
| 007 | Repeat 字段组展开 | 分别集中同类字段、合并实例，或重复前后固定字段 |
| 008 | Repeat 上限冲突 | 静默截断、合并实例，或创建超过上限的产物 |

## 通过策略

整个 Step 2 同时满足以下条件时通过：

- 所有 case 的执行上下文均未受污染。
- Agent 实际读取了目标顶层 Schema。
- 产物同时满足目标 Schema 的 format、fields 和 asserts。
- 需要用户补充信息的 case 正确暂停，没有创建不完整产物。
- Repeat 正常输入按完整 body 展开，数量冲突不会通过截断或合并输入规避。
- Agent 没有修改任何 Memory。
- 评分没有把 Schema 未约束的表达方式收窄为唯一参考答案。

详细标准保存在各 case 的 `evaluation.md` 中。

## 暂不覆盖

第一批 Step 2 不单独测试 `array<string>` 等基本类型数组的最终呈现方式。基本类型数组使用项目符号、表格还是其他形式尚无独立呈现契约。

本批次通过 `type: array`、Markdown table 和 `item` object 验证表格型数组结构。基本类型数组的呈现规则明确后，再补充对应 case。
