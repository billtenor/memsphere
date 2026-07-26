---
id: 20260725-prompt-rationalization
type: feature
created: 2026-07-25
completed_at: 2026-07-25
run_id: run-20260725-043350z-26afa4f8
---

# Runner 与 ACP Prompt 职责收敛

## 需求

重新梳理 Memsphere 面向 Runner、ACP Reviewer 和 Human 操作者的文本输出边界，使每个 CLI 场景只组合职责匹配的 Prompt，并让模板能够被独立阅读、审查和验证。

实施过程中经 Human 确认纳入以下范围扩展：

- `!schema` 增加可选且非空的 `suggests`，与 `asserts` 分别表达建议性和强制性字段约束。
- Schema 写作 Prompt 分别展示步骤断言、步骤建议、填写断言和填写建议。
- Advisory Comment severity 只表达意见严重程度，不产生决策权。
- `run review vote` 使用独立投票回执，不重复 `run review wait` 已展示的完整汇总。

## 交付

- Prompt registry 增加 audience 与 purpose 元数据。
- Runner CLI 使用场景组合器渲染 current step、receipt、summary、next action 和 completed。
- ACP Reviewer Prompt 精简为可信契约、前序 Artifact 索引、按需命令和提交要求。
- `enter-schema` 输出 Schema Overview 与当前字段 Prompt。
- `!schema.suggests` 贯通 AST、解析、Run 快照、View、双语 Prompt、System Memory 和 Skill。
- Review Comment severity 与 Decision Policy 的边界按 Human 确认语义收敛。

## 验证

- 针对性测试：Prompt renderer、Run output、Run command、Run Store、Memory Schema 和 Reserved Store 通过。
- `npm run typecheck`：通过。
- `npm test`：333/333 通过。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过。
- `git diff --check`：通过。
- 真实多步骤 Schema Run 验证步骤级与字段级断言、建议及继承展示通过。

## 验收

- Artifact Review 第四轮全部 Reviewer 通过，无阻塞意见。
- Human 完成复验并确认验收通过。

## 后续范围

- 本轮不继续扩展其他 Memory YAML syntax。
- Prompt 内容和场景组合后续按独立需求继续优化。

## 残留问题

- 工作区根目录存在来源不明的未跟踪空文件 `...`，与本需求无关，未纳入交付或擅自删除。
