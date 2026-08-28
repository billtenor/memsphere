---
id: 20260828-changeset-diff-review
status: todo
type: feature
created: 2026-08-28
run_id: run-20260828-044106z-2cd5b271
---

# ChangeSet 差异审阅

## 需求

在 ChangeSet 详情中提供面向验收的 Memory 差异视图，让产品负责人及其他 Human 能明确判断候选版本相对权威基线改了什么、删除了什么，以及哪些上下文保持现状，而不必靠人工对照完整内容。

当前 View 只展示纳入 ChangeSet 的候选 Memory 完整内容。即使 Memory 已通过版本管理，验收人仍无法快速识别增删改、重命名和未变化区段，也难以确认所看内容对应哪个基线及哪个已校验快照。这会直接阻碍 Memory 修改的有效 Review。

本需求会改变当前“ChangeSet 详情只展示候选内容、不展示 diff”的产品契约，因此后续开发不能只增加前端组件，还需要同步调整相关 System Memory、Reserved System Memory 与 memsphere Skill。

## 验收标准

- ChangeSet 详情默认提供“变更”视图，并保留可切换的“完整内容”视图；现有候选内容查看能力不丢失。
- 页面顶部按新增、修改、删除、重命名汇总 ChangeSet targets，汇总数量和每项操作类型与 ChangeSet 数据一致。
- 每个目标 Memory 的差异由服务端基于该 ChangeSet 的权威 `baseRevision` 与已校验 checkpoint 计算，不依赖浏览器状态、当前工作区或其他可变内容。
- 新增、修改、删除、重命名四类操作均有清晰且一致的视觉表达；没有实际内容差异时给出明确状态，不呈现误导性空白。
- 差异视图能区分新增行与删除行；未变化区段默认折叠并保留必要上下文，支持按区段展开和查看全部内容，使验收人既能聚焦改动，也能确认保持现状的上下文。
- 页面明确展示基线版本、checkpoint digest、校验状态，以及当前审阅快照是否因候选内容变化而过期；重新校验后展示与最新 checkpoint 一致。
- Managed 与 Embedded Project 提供一致的审阅能力：Managed 使用已发布 Store revision，Embedded 使用 Git base revision 作为权威基线。
- 现有 ChangeSet Comment 能力保留；差异视图与全文视图中的评论对象、删除行或基线专属行的评论语义，以及重新校验后的定位行为在开发设计中明确，并有自动化测试覆盖。
- 对无法解析但仍可按文本比较的内容提供文本差异；对完全无法读取、超大内容等场景安全降级，并向用户说明原因，不阻断其他 Memory 的审阅。
- 中文和英文界面均提供完整文案；键盘操作、颜色之外的增删标识、窄屏布局等基本可访问性和响应式体验通过验证。
- API/领域测试覆盖基线解析、checkpoint 一致性、四类操作、无差异和过期快照；浏览器测试覆盖模式切换、折叠展开、评论、异常降级及 Managed/Embedded 场景。
- 与本能力重叠的 Project System Memory、Reserved System Memory 和 `src/skills/memsphere/SKILL.md` 契约同步更新，并通过适用的完整回归。

## 范围

- ChangeSet 详情页的差异汇总、逐 Memory 差异审阅和完整内容切换。
- 服务端基于权威基线与已校验 checkpoint 生成或返回差异所需数据。
- 新增、修改、删除、重命名、无差异、不可解析和大内容场景。
- 未变化区段的上下文展示、折叠与展开。
- ChangeSet Comment 与差异审阅的兼容设计。
- Managed 与 Embedded Project 的一致体验。
- 中英文文案、自动化测试及产品契约 Memory/Skill 同步。

## 不做事项

- 不在 View 中增加原始 YAML 或 Memory 内容编辑能力。
- 不新增 Review、Round、Vote 等独立领域实体，也不改变现有 Human 决策职责。
- 首期不提供任意两个 Store 或完整 Store 之间的通用差异工具，仅审阅当前 ChangeSet targets。
- 不依赖第三方差异计算或托管服务。
- 不在 View 中文化 Run `run-20260827-140127z-439c5941` 中实施，也不混入其提交。

## 关联需求

- `20260818-changeset-effective-validation`：已完成，提供基于有效 Store 的 ChangeSet 校验基础。
- `20260822-changeset-experience-loop`：已完成，曾包含 changed-only/full Store 的体验目标，但当前产品契约后来收敛为 candidate-only/no-diff；本需求用于显式恢复并重新定义差异审阅能力。
- `20260823-changeset-active-lifecycle`：已完成，定义 ChangeSet active 生命周期和 checkpoint 变化行为。
- `20260826-memory-market`：进行中，涉及导入前不预展示 diff，场景不同，不构成重复。
- 重复需求：无。

## 技术与测试方案

待开发前补充。

## 开发任务

待开发前补充。

## 验收结果

尚未开始。
