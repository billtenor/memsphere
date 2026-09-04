---
id: 20260902-view-common-controls-standardization
status: completed
type: feature
created: 2026-09-02
run_id: run-20260903-025445z-b904527d
completed_at: 2026-09-04T03:59:56Z
---

# Memsphere View 通用控件标准化与业务迁移

## 需求

### 背景与目标

`20260902-view-framework-standardization` 已建立 Shell、Theme、基础 UI Primitives、Slot 和独立 Reference Module 的公共边界。对当前 Memory、ChangeSet、Run 与 Artifact Review 页面进一步盘点后发现，这些 Memsphere 自有 Module 仍分别实现了大量相似控件，包括状态标签、Tabs、折叠区、表单、选择器、进度、列表尾部操作、卡片和确认交互。

本需求把这些高频、跨领域、可稳定定义的控件沉淀为 View Framework 公共能力，并用 Memory 与 Run 的真实页面验证公共能力可以被业务 Module 直接采用。目标是让后续 Agent 搭建功能页面时优先组合标准控件，只把开发精力投入领域数据、领域行为和自由正文，同时保持 Memsphere 各功能的视觉、交互、响应式和无障碍行为一致。

Human 与 Agent 共同承担产品负责人角色；Human 负责最终产品验收。

### 当前范围

1. 扩展 View Framework 公共控件，候选能力包括：
   - 语义状态徽标：普通、信息、成功、警告、危险及可选图标。
   - 提示状态：加载、空、错误、成功、只读，支持描述和可选操作。
   - Tabs / Segmented Control：统一选中、悬停、焦点、键盘切换及禁用状态。
   - Disclosure / Accordion：统一展开状态、标题、元数据、图标和内容挂载。
   - 表单字段：文本输入、搜索、文本域、复选框及其标签、帮助、错误、必填和禁用状态。
   - Select / Combobox：统一触发器、选项、选中、键盘操作、焦点和关闭行为。
   - Progress：支持数值、总量、标签和确定/不确定进度。
   - Content List 增强：列表行语义状态、徽标、尾部操作、次级信息及可展开内容。
   - Card / Section：只统一公共容器的几何、视觉和操作区，不规定业务正文结构。
   - 确认交互：统一危险和普通确认，替代浏览器原生 `confirm()` 及 Module 自制确认框。
2. Reference Module 展示本需求最终提供的公共控件、主要变体和关键交互状态，作为 Agent 可复制的参考实现。
3. 在不改变领域语义的前提下，迁移 Memory、ChangeSet、Run 与 Artifact Review 中命中公共能力的现有控件；消除被迁移部分的重复 CSS 和重复交互实现。
4. 补充公共 API、Theme Token、使用边界、迁移方式和最小示例文档。
5. 通过自动化测试和真实浏览器验证桌面、窄屏、键盘、焦点、加载、空、错误、禁用和确认等状态。

### 不做事项

- 不统一或重设计 Memory 的 Statement、Procedure、Schema 正文结构。
- 不把 ChangeSet 的增删改语义、Diff 排列和评论锚点模型收进公共控件。
- 不把 Run 的步骤树、分支、循环、当前步骤语义和 Artifact 关系收进框架。
- 不统一 Artifact 的领域 Renderer，也不改变 Review 的投票规则、轮次策略、权限或后端协议。
- 不引入 React、Vue、Web Components、Tailwind 或新的前端技术栈。
- 不要求第三方 Module 一次性迁移；兼容策略在实施方案形成前确定。
- 不修改 `20260902-view-framework-standardization` 已确认的需求契约、实现范围或验收结论。

### 关联需求

- 强关联前置需求：`20260902-view-framework-standardization`。本需求复用其 Shell、Theme、Primitives、Slot 和 Reference Module 基础，在其验收与交付边界之外独立推进。
- 历史关联需求：`20260902-view-memory-preview`（已取消）。本需求延续其纠偏结论：框架标准化公共控件，不把演示原型硬编码进 Memory Module。
- 完全重复需求：无。

## 验收标准

### 公共能力

- 上述候选能力必须在实施方案阶段逐项确认；最终纳入范围的每个控件都有公开、带类型的 API，具有明确状态模型、生命周期和可访问名称，不要求 Module 访问 Shell 私有 DOM 或私有 CSS。
- 公共控件的颜色、排版、间距、圆角、边框、焦点、禁用和动效使用公开 Theme Token，不在不同 Module 中复制公共视觉常量。
- Tabs、Disclosure、Combobox、确认框等交互控件支持键盘操作、可见焦点和必要的 ARIA 语义；弹出层关闭后焦点返回合理位置。
- 异步操作具有一致的忙碌、成功和失败反馈，连续点击不会造成重复提交。

### Reference Module

- Reference 页面能直接观察最终纳入范围的所有标准控件，以及默认、选中、悬停、焦点、禁用、加载、空、错误和危险等适用状态。
- 每个示例只使用公开 SDK、Theme 和系统图标，不依赖 Shell 私有选择器，也不复制 Memory 或 Run 的领域实现。
- Agent 仅阅读公开文档和 Reference Module，即可在新 Module 中复用这些控件，无须进入 Memory、Run 或 Shell 源码寻找样式。

### Memory 与 Run 迁移

- Memory、ChangeSet、Run 和 Artifact Review 中最终确认命中的公共控件完成迁移；同类控件在不同页面具有一致的尺寸、状态、键盘行为和反馈。
- Memory 与 Run 不再使用浏览器原生 `confirm()` 或各自维护同类确认弹窗。
- 已迁移控件不再保留与公共实现重复或相互覆盖的 Module CSS；领域布局和领域语义保持在各 Module 内。
- Memory、ChangeSet、Run、Artifact Review、Settings 和 Reference 的稳定 URL、核心操作及响应式行为没有回归。

### 验证证据

- 公共组件具有单元测试、API/契约测试、交互测试和无障碍相关断言。
- 使用真实浏览器完成桌面与窄屏检查，并覆盖键盘导航、焦点恢复、禁用、加载、空、错误、选择、展开和确认流程；控制台无本轮新增错误。
- 完成项目相关测试与全量回归；失败必须区分本轮问题、历史问题和环境阻塞。
- 提供控件清单、公共 API 清单、迁移映射、删除的重复实现、浏览器证据和未迁移项，供 Human 产品负责人逐项验收。

## 技术与测试方案

待开发前补充。方案应先基于现有 `ViewUi`、Theme、Content List、Reference Module，以及 Memory、Run 的真实重复实现确定最终控件范围、API、兼容策略和分批迁移顺序；不得把本需求中的候选清单直接视为已确认的技术设计。

## 开发任务

尚未开始。待需求契约和实施与验证方案确认后生成开发计划。

## 验收结果

2026-09-04 产品验收通过。Human 产品负责人完成最终页面复验，并在 Artifact Review 第 3 轮明确投票通过；Agent 产品负责人独立核验后投票通过，Runner 最终决定通过。交付范围、完整验证结果、Memory ChangeSet 证据、后续范围与残留问题见 `delivery-report.md`。
