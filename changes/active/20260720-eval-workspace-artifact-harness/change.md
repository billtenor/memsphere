---
id: 20260720-eval-workspace-artifact-harness
status: todo
type: feature
created: 2026-07-20
run_id:
---

# Eval Workspace Artifact Harness 需求

## 需求管理摘要

现有 eval 脚本能够创建隔离 workspace，但尚未实现期望 Artifact 声明、Validation Round、向同一 Agent 反馈并续接修正以及完整证据持久化，因此当前状态为 todo。

## 背景

Memsphere 已支持在 `memsphere run report` 时依据 Artifact 的 type、format 和 Schema 校验上报内容。但 Agent Evaluation Case 的最终业务产物通常由子 Agent 直接写入隔离 workspace，而子 Agent 执行的通用 Procedure 只向 Run 上报一段自然语言完成摘要。

因此，Procedure Run 的 Artifact 校验通过，不代表 Case 要求的 workspace Artifact 已正确生成。`self-bootstrap-step0/001-create-bookkeeping-entry` 的实测中，Case 要求 `artifacts/bookkeeping.md`，子 Agent 却创建了 `bookkeeping/2026-07-15-lunch-with-colleague.yaml`；Run 上报的 string 摘要仍通过校验，Harness 没有在执行期间发现路径和格式错误。

现有相关能力：

- `changes/archive/completed/20260716-report-artifact-validation-feedback/change.md` 定义 `run report` 阶段的 Artifact validator 和结构化 issues。
- `changes/active/20260718-eval-cli-and-view/change.md` 定义 Eval Case、Case Execution、机器 Harness 契约和 Validation Round。
- 本需求负责把已有 Artifact validator 接入 Eval workspace 产物验收，不重新实现一套格式校验器。

## 问题

1. Eval Case 没有稳定声明 workspace 中预期 Artifact 的机器契约。
2. Harness 未检查目标文件是否存在、是否位于指定路径，以及内容是否满足 type、format 和 Schema。
3. 子 Agent 创建错误产物后只能在父 Agent 人工判分时被发现，无法在同一执行中获得可操作的校验反馈。
4. Procedure Run Artifact 与 Eval workspace Artifact 容易被误认为同一层契约。
5. 缺少可持久化的 Validation Round 证据，无法区分首次错误与修正后的最终结果。

## 目标

1. Case 能以机器可读方式声明一个或多个预期 workspace Artifact。
2. Harness 使用现有 Artifact validator 校验实际文件的存在性、路径、type、format 和 Schema。
3. 可修复错误以最小结构化信息反馈给同一子 Agent，并在同一 Case Execution 中重新校验。
4. 保存每轮输入快照、issues 和结果，同时只把最终通过的产物作为 Case 的有效 Artifact。
5. 父 Agent 继续负责自然语言约束和业务语义判分；机器 Harness 不把参考答案固化成唯一答案。

## 非目标

- 不在本需求中开发新的 type、format 或 Schema validator。
- 不让 Harness 判断自然语言 `asserts` 是否满足。
- 不用 workspace Artifact 校验替代父 Agent 的语义评分或 human 决策。
- 不要求业务 Procedure 把 Case 隐藏的验收契约暴露给子 Agent。
- 不修改本轮已有评测结果，也不把修正后的结果覆盖首次失败证据。

## 期望能力

### Case Artifact 契约

Case 机器配置应能为每个预期产物声明：

- 稳定 Artifact ID。
- workspace 相对路径；必须禁止绝对路径、`..` 越界和符号链接逃逸。
- `required`；首期至少支持必需产物。
- Artifact `type`。
- Artifact `format`，包括 Markdown layout。
- inline Schema 或当前 Case 可访问的 Schema 引用。

契约只描述可由代码验证的要求。业务值、合理推断和自然语言质量继续保留在 `evaluation.md`。

### 校验时机

子 Agent 首次声称任务完成后，Harness 必须：

1. 在隔离 workspace 内解析声明路径。
2. 检查必需文件是否存在且是允许读取的普通文件。
3. 读取不可变快照，并按 `type -> format -> schema` 顺序调用现有 validator。
4. 保存本轮状态和全部可确定 issues。
5. 校验通过后再结束 Case Execution；失败时进入反馈流程。

### 最小反馈

反馈只包含帮助修正产物所需的信息：

- Artifact ID 和期望相对路径。
- 稳定 issue code。
- 字段或结构路径。
- 简短的 expected/actual 与修正提示。

不得向子 Agent展示 `evaluation.md`、参考答案、隐藏业务断言或其他 Case 内容。路径错误应说明期望路径；格式错误应返回 validator issue，不直接给出完整正确产物。

### 同一 Agent 修正

- Adapter 支持续接时，必须在同一 Agent 会话和同一 workspace 中反馈并允许修正。
- 修正后重新执行完整 Artifact 校验，不只检查上一轮失败项。
- Validation Round 设明确上限；达到上限仍失败时结束为 Harness fail，不无限循环。
- Adapter 不支持续接时，保留失败证据并结束 Case Execution，不以新 Agent 冒充同一轮修正。

### 证据与状态

每个 Validation Round 至少保存：

- round 序号和时间。
- 被校验文件的相对路径、大小和内容摘要。
- Artifact contract 快照。
- validator 状态和结构化 issues。
- 是否向子 Agent反馈，以及对应 Agent 事件引用。

Case Execution 应分别展示 Agent 退出状态、Harness 状态和后续语义判分。Harness fail 不能自动写成语义 fail，但父 Agent 判分时必须能读取该事实。

## 范围

### 本期范围

- 单文件 workspace Artifact。
- 必需文件的缺失和路径错误。
- 已有 type、format、Schema validator 的复用。
- 同一 Agent 会话中的有限轮次反馈与重验。
- Eval Store 持久化和 `memsphere eval read` 可读的 Validation Round 摘要。

### 后续范围

- 多文件集合、目录和通配路径。
- 自然语言 asserts 的 Agent Reviewer 校验。
- 可选 Artifact、互斥 Artifact 和跨文件约束。
- View 中的产物差异对比和人工重放。

## 验收标准

1. Case 要求 `artifacts/bookkeeping.md` 而 workspace 不存在该文件时，Harness 返回稳定的 missing Artifact issue。
2. 子 Agent 把同一内容写到其他路径时，期望路径仍判 missing；不得因发现相似文件而自动通过。
3. 目标声明为 Markdown outline、实际为 YAML 或 Markdown 列表时，复用现有 validator 返回对应 format/schema issues。
4. Harness 把最小 issues 反馈给同一 Agent；Agent 修正后，第二轮重新校验并通过。
5. 两轮 contract、文件快照和校验结果都被保存，首次失败不被覆盖。
6. 子 Agent 在任何反馈中都不能看到 `evaluation.md`、参考答案或隐藏语义评分要求。
7. Memory 完整性检查继续独立执行，Artifact 修正不得修改 fixture Memory。
8. 不支持会话续接或超过轮次上限时，Case Execution 以可诊断的 Harness fail 结束，并保留完整证据。
9. 004、005、006 等已有合法产物可以一次通过，不因接入 Harness 发生回归。
10. 单元测试、CLI 集成测试和至少一个真实 Agent Eval 回归覆盖缺失路径、错误格式、修正成功和最终失败四类场景。
