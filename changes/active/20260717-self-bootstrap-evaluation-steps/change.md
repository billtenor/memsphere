---
id: 20260717-self-bootstrap-evaluation-steps
status: accepting
type: feature
created: 2026-07-17
run_id:
---

# memsphere 自举评测步骤规划

## 需求管理摘要

Step 0、Step 1 和 Step 2 的 Suite 与 Case 已经完成建设并具备运行条件；尚需完成真实 Agent 全量评测并整理验收结论，因此当前状态为 accepting。

## 背景

self-bootstrap 评测用于验证一个没有 memsphere 先验知识的 Agent，能否通过 memsphere Skill、CLI 和当前工程已安装的 Memory，逐步学会读取、理解、应用和编写 Memory。

评测不应一开始就要求 Agent 完成完整的 Memory 编写或 Procedure 执行。不同记忆类型承担不同职责，Agent 对它们的理解也存在自然的认知顺序。评测集应把这些能力拆成连续步骤，使每一步失败时都能判断具体缺少哪类知识或能力。

## 使用 Step 而不是 Level

评测目录统一使用 `step`，不使用 `level`。

`level` 容易让人理解为 Agent 或模型之间的能力等级；`step` 表示自举过程中的学习顺序。不同 Step 之间是认知依赖关系，不用于给 Agent 划分等级。

建议使用平级目录：

```text
evals/
  self-bootstrap-step0/
  self-bootstrap-step1/
  self-bootstrap-step2/
  self-bootstrap-step3/
  ...
```

Step 之外的评测维度独立记录，不进入目录的步骤编号：

- Skill 模式：完整 Skill 或 bootstrap kernel。
- Agent 运行器：Codex、TraeX 或其他 Agent。
- 模型：具体供应商和模型版本。
- 执行方式：独立 case 或连续学习旅程。

同一组 Step case 应当能够在不同运行器、模型和 Skill 模式下重复执行。

## Step 路线

### Step 0：读取、理解并应用 Concept

当前已经建设的六个 case 归入 `self-bootstrap-step0`。

这些 case 的主要知识入口都是领域 Concept。Agent 需要从 Concept 的 `defines` 中理解概念定义，并把纯文本定义、匿名 `!statement` 约束和匿名 `!schema` 结构共同应用到实际任务中。

因此，Step 0 已经间接接触了 Statement 和 Schema 的语义，但它尚未证明 Agent 能够：

- 独立发现一份顶层 Statement 或 Schema Memory。
- 理解顶层 Statement 或 Schema 在任务中的职责。
- 在多份候选 Memory 中选择适用的 Statement 或 Schema。

Step 0 的目标是验证 Agent 能否先通过 Concept 认识一个领域对象，并据此创建实例、补充信息或拒绝不合法输入。

### Step 1：读取、理解并应用 Statement

Step 1 使用顶层 Statement Memory 作为主要知识来源，验证 Agent 能否发现适用规则，理解规则强度，并在实际任务中正确执行。

建议首批建设六个相互独立的 case：

1. **遵守强制规则**：产物必须满足 Statement 中的全部适用 `asserts`。
2. **理解建议边界**：正确理解 `suggests` 是建议；Agent 可以合理发挥，只要没有违反强制约束。
3. **同时应用多条规则**：任务同时命中多份 Statement 时，全部适用规则共同生效。
4. **处理规则冲突**：用户要求与 `asserts` 冲突时，指出冲突并停止产生违规产物。
5. **处理信息不足**：缺少满足 `asserts` 所需的信息时，向用户询问，而不是猜测或省略必需内容。
6. **选择适用规则**：存在多份候选 Statement 时，只应用与当前任务相关的规则，不把无关规则强加给任务。

每个 case 只突出一个主要能力。题目使用自然语言描述真实任务，不直接告诉 Agent：

- 应读取哪份 Statement。
- Statement 的文件路径或逻辑引用。
- `asserts`、`suggests` 等内部字段名称。
- 预期答案的字段和值。

### Step 2：读取、理解并应用 Schema

Step 2 验证 Agent 能否发现独立的 Schema Memory，并根据 Schema 生成或检查结构化产物。首批 case 已覆盖：

- 使用 `outline` format 生成多级标题文档。
- 使用 `table` format 生成表格或列表型文档。
- 同时满足字段类型、必填性和嵌套结构。
- 面对缺失字段时询问用户。
- 在多个候选 Schema 中选择与交付物匹配的 Schema。
- 根据实际内容整体展开 `!repeat.body`，并在重复数量超出 `limit` 时停止创建违规产物。
- 不把 Schema 示例误当成唯一允许的内容模板。

### Step 3：选择并执行 Procedure

Step 3 验证 Agent 能否从 Procedure 开始完成任务，而不只是读取静态知识。计划至少覆盖：

- 发现与任务匹配的专用 Procedure。
- 没有专用 Procedure 时选择通用流程。
- 使用 `memsphere run start` 启动一次 Run。
- 只执行 CLI 当前返回的步骤。
- 正确上报普通 Artifact 和文件 Artifact。
- Schema Artifact 到达 Repeat 控制步骤时，按照 CLI 提示选择合法重复次数并完整填写每轮 body。
- 在 human 步骤暂停，取得用户输入后继续执行到 `done`。

### 后续步骤：独立编写 Memory

只有在 Agent 已经分别证明能够消费 Concept、Statement、Schema 和 Procedure 后，才开始验证 Memory 编写能力。

后续步骤可继续拆分为：

- 创建基础 Concept、Statement 和 Schema。
- 创建包含匿名嵌套实体的复合 Memory。
- 创建包含 Action、Artifact、If、While 和 Call 的 Procedure。
- 修复非法 Memory YAML。
- 编辑和 Review 已有 Memory。
- 验证系统托管 Memory 的保护边界。

具体编号在前述消费型步骤建设完成后再确定，避免过早固化尚未验证的路线。

## Step 1 统一判定原则

Step 1 的评分应以 Statement 表达的约束边界为准，而不是要求 Agent 复现唯一标准答案。

- 违反适用 `asserts` 时判定失败。
- 未遵循 `suggests` 不能单独判定失败。
- Agent 的补充、质疑或表达方式只要不违反规则，就不应受到惩罚。
- 用户要求与规则冲突时，正确说明冲突并停止执行，可以判定通过。
- 信息不足时，正确提出必要问题并等待用户，不应因为没有生成最终产物而判定失败。
- 应用无关 Statement 并因此改变产物或阻碍任务，应判定为规则选择失败。
- 多条适用 Statement 中遗漏任意强制约束，应判定为规则应用失败。

## 通用 Case 设计原则

所有 Step 延续以下原则：

1. 使用真实任务检验理解，不把复述概念作为主要考题。
2. 提示词尽可能少，不泄露 Memory 名称、字段、路径、命令或答案结构。
3. 一个 case 主要检验一个能力，降低失败原因分析难度。
4. 每个 case 使用独立的干净工作区、HOME 和对话上下文。
5. Agent 通过 memsphere CLI 发现和读取 Memory，不依赖直接浏览 `.memsphere` 文件。
6. Harness 独立检查产物、命令事件、Run 状态和 Memory 完整性。
7. Memory 定义的是约束边界，不是限制 Agent 自由发挥的标准答案模板。

## 当前建设状态

1. 现有六个 Concept case 已调整为 `evals/self-bootstrap-step0`，case 语义和评分标准保持不变。
2. `evals/self-bootstrap-step2` 已建设八个 Schema case，覆盖简单 outline、嵌套 outline、table、Schema asserts、缺失字段、候选 Schema 选择、Repeat 字段组展开和 Repeat 上限冲突。
3. `evals/self-bootstrap-step1` 已建设七个 Statement case，覆盖平铺断言、建议边界、递归 `sections`、多份 Statement、规则冲突、信息不足和适用规则选择。
4. Step 0、Step 1 和 Step 2 均已具备运行条件；后续分别运行并根据评测结果迭代 Memory、Skill、case 或产品能力。
