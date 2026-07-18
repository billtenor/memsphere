# Artifact 格式校验 Case 说明

本文逐项说明每份 Artifact 错在哪里，以及 harness 回归时至少应观察到什么校验结果。测试方应在 `test/fixtures/artifact-format-validation/` 下准备输入，每个目录只包含 `memory.yaml` 和 `artifact.md`；所有判断只能来自这两个文件。

## 回归判定规则

所有 case 都应返回：

```yaml
status: failed
correctable: true
```

回归测试应稳定检查错误码、Artifact 相对路径、字段或字段路径，以及实际结构与要求结构之间的差异。错误消息的完整中文措辞不要求逐字一致。

validator 可以逐字段返回多条错误，也可以合并同类字段，但必须覆盖本文列出的全部错误字段和字段路径。

| 错误码 | 含义 |
| --- | --- |
| `schema.format.outline.expected_heading` | Schema 要求字段成为 Markdown 标题，但 Artifact 中缺少对应标题，或字段只在列表、键值、粗体标签、表格等非标题节点中出现。 |
| `schema.format.outline.invalid_parent` | 字段本身是标题，但没有位于 Schema 指定的父标题之下。 |

## Case 001：字段全部是列表项

Case：`001-bookkeeping`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：匿名 Schema 声明 `format: outline`，但日期、类型、金额、分类和备注全部使用 `- 字段: 值` 列表项表达。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 日期、类型、金额、分类、备注 | 字段当前是列表项，outline 要求它们成为 Markdown 标题。 |

金额、日期、类型、分类和备注内容均满足 Memory，不应额外报告 `schema_assert_violation`。

## Case 002：文档标题不能代替字段标题

Case：`002-bookkeeping-with-title`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：Artifact 有 `# 记账记录` 标题，但日期、类型、金额、分类和备注仍全部是列表项。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 日期、类型、金额、分类、备注 | 字段只出现在列表项中；顶层“记账记录”标题不能替代字段标题。 |

字段值本身符合 Memory，不应额外报告内容断言错误。

## Case 003：相同错误结构下的正文变体

Case：`003-bookkeeping-text-variant`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：存在顶层标题，但五个字段仍使用列表项。该输入与 Case 002 的正文措辞不同。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 日期、类型、金额、分类、备注 | 字段当前是列表项，必须改成 Markdown 标题。 |

validator 不应因备注措辞变化而产生不同的格式结论或追加错误。

## Case 004：粗体标签不是字段标题

Case：`004-meeting-note`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：会议主题、日期、结论和待办使用 `- **字段**: 值` 表达。粗体文本位于列表项中，不是 Markdown heading 节点。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 会议主题、日期、结论、待办 | 字段当前是粗体列表标签，outline 要求字段本身使用 Markdown 标题。 |

顶层 `# 会议记录` 合法，但不能替代四个字段标题。日期和待办内容已满足 Memory，不应报告内容断言错误。

## Case 005：报销字段是列表项

Case：`005-reimbursement`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：发生日期、费用内容、金额、业务用途和凭证编号均写成列表项。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 发生日期、费用内容、金额、业务用途、凭证编号 | 字段当前是列表项，目标 Schema 要求 Markdown 标题。 |

日期、金额和凭证内容满足 Memory，本 case 只应因 Artifact 格式失败。

## Case 006：发布记录字段是列表项

Case：`006-release-record`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：版本、发布日期、变更内容和发布结果均以列表项表达；变更内容又包含两个子列表项。Schema 要求第一层字段成为标题，字段正文仍可使用列表。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 版本、发布日期、变更内容、发布结果 | 四个字段缺少 Markdown 标题；“变更内容”下的正文列表不是错误。 |

发布日期、发布结果和两项变更内容满足 Memory，不应报告内容断言错误。

## Case 007：嵌套字段没有形成子标题

Case：`007-incident-review`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：“基本信息”和“影响”是父标题，但发生时间、恢复时间、受影响服务和用户影响都写成列表项，没有形成更深一级的子标题。“根因”和“改进项”标题合法。

| 错误码 | 字段路径 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 基本信息 / 发生时间 | “发生时间”是列表项，必须是“基本信息”下的子标题。 |
| `schema.format.outline.expected_heading` | 基本信息 / 恢复时间 | “恢复时间”是列表项，必须是“基本信息”下的子标题。 |
| `schema.format.outline.expected_heading` | 影响 / 受影响服务 | “受影响服务”是列表项，必须是“影响”下的子标题。 |
| `schema.format.outline.expected_heading` | 影响 / 用户影响 | “用户影响”是列表项，必须是“影响”下的子标题。 |

validator 不应把合法的父标题、“根因”或“改进项”误报为缺失。

## Case 008：内容断言通过，但结构失败

Case：`008-release-check`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：版本、数据库迁移检查、接口冒烟检查和回滚版本均写成列表项，而不是标题。

| 错误码 | 字段 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 版本、数据库迁移检查、接口冒烟检查、回滚版本 | 四个字段当前是列表项，outline 要求 Markdown 标题。 |

两个版本号格式正确，两项检查值也严格为“通过”。不得报告 `schema_assert_violation`。

## Case 009：Repeat 每轮缺少核验项父标题

Case：`009-release-change-verification`

- Memory：`memory.yaml`
- Artifact：`artifact.md`
- 错误：Repeat body 每轮依次要求一个“变更项”和一个同级“核验项”。Artifact 创建了两个“变更项”，却没有“核验项”；核验方式和核验结果标题被直接放在对应“变更项”下面。

| 错误码 | 字段或路径 | 消息应说明 |
| --- | --- | --- |
| `schema.format.outline.expected_heading` | 第 1、2 轮的核验项 | 每轮都缺少“核验项”标题，期望 2 次，实际 0 次。 |
| `schema.format.outline.invalid_parent` | 第 1、2 轮的核验项 / 核验方式 | “核验方式”当前父标题是对应“变更项”，期望父标题是对应“核验项”。 |
| `schema.format.outline.invalid_parent` | 第 1、2 轮的核验项 / 核验结果 | “核验结果”当前父标题是对应“变更项”，期望父标题是对应“核验项”。 |

发布版本、两组业务事实、核验结果和发布结论满足 Memory。validator 不应把内容判错，也不应要求第三轮。

## 完整回归通过条件

1. 九个 case 全部稳定返回 `failed` 和 `correctable: true`。
2. 每个 case 的错误覆盖本文列出的全部字段或字段路径。
3. 文档标题、粗体标签或同名列表项不能冒充字段标题。
4. 嵌套 Schema 能检查父子标题层级。
5. Repeat 能检查每轮完整 body、标题次数和字段父级。
6. 已满足的内容 asserts、合法正文列表和不同正文措辞不会产生无来源错误。
