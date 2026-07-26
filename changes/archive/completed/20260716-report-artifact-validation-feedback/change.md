---
id: 20260716-report-artifact-validation-feedback
type: feature
created: 2026-07-16
completed_at: 2026-07-18
run_id:
---

# Report 阶段 Artifact 校验反馈需求

## 问题

Agent 或 human 使用 `memsphere run report` 提交产物时，不能只凭“文件存在”或自然语言自检通过就推进流程。Artifact contract 已声明 type、format 和可选 Schema，report harness 必须执行这些机器契约。

典型错误是：Artifact 声明 object Markdown outline，Schema fields 要求字段成为标题，但提交文档只使用项目符号、键值列表或粗体标签。该内容即使语义合理，也不符合可执行结构契约。

## 行为

report 先读取输入快照，再依次执行：

```text
type validator -> format validator -> schema validator
```

任何阶段失败：

- 返回 failed/unsupported 和结构化 issues。
- CLI 在 stderr 输出稳定 code、Artifact path、field path 和修正提示。
- 不写受管 Artifact 文件。
- 不追加 event，不推进 step，不改变 status/update time。
- 允许修正后在原步骤重报。

全部通过后才提交文件和 Run JSON。validator 异常应转换为 engine issue，不得被当成通过。

## Outline 反馈

Markdown outline validator 必须基于 Markdown AST，而不是字符串包含判断。至少区分：

- expected_heading：字段没有成为 heading。
- invalid_parent：heading 存在，但不在 Schema 指定父标题下。
- repeat_count：Repeat 次数超出声明范围。

一次校验应覆盖全部可确定的结构错误，不只返回第一个缺失字段。字段路径使用稳定的层级路径；Repeat 路径包含轮次。

## 固定案例

`test/fixtures/artifact-format-validation/` 中每个目录包含 memory.yaml 与 artifact.md。测试统一把其中 Schema 作为以下 Artifact 契约执行：

```yaml
type: object
format:
  name: markdown
  layout: outline
schema: <fixture Schema>
```

九组案例覆盖列表项冒充标题、文档标题冒充字段、粗体标签、嵌套字段、合法内容但错误结构，以及 Repeat 缺失父标题和错误父级。详细预期见 `docs/artifact-format-validation-cases.md`。

## 端到端验收

1. 启动包含 inline/external Schema 的 v2 Run。
2. 提交格式错误的 Artifact，断言错误 code/path，并对比 Run JSON 和 artifacts 目录未变化。
3. 修正文档后重报，断言只产生一个成功 event。
4. 确认 event 保存 type、format、Schema snapshot、validation 和 final 元数据。
5. 在 View 中确认契约、结构化产物、校验通过状态和历史 v1 只读标识可见。

## 验收结果

- Run report 已按 type、format、schema 顺序校验，并在失败时保持 Run 和 artifacts 不变。
- CLI issue 包含稳定 code、Artifact path、field path 和修正提示；九组固定格式错误案例均已覆盖。
- View 已展示 v2 validation 元数据和 v1 只读状态。
- 2026-07-20 全量测试通过：202 passed，0 failed。
