# 开发计划：View 通用控件标准化与业务迁移

## 执行原则

- 严格保持 Shell/Theme/UI Primitives/Slot/Feature 五层边界，领域 Renderer、评论锚点、Review 状态机和 Overlay 领域布局不进入公共组件。
- 按“公共契约 → 公共实现 → Reference 证明 → Shell/Memory/Run 迁移 → 文档与 Memory → 全量验证”顺序交付；每项完成后先运行对应测试，再开始下一项。
- `ViewUi.version`、Theme v1、Slot v1 和现有路由保持兼容；发现必须改范围或破坏兼容时停止施工并回到方案评审。
- 迁移到公共按钮或 Confirmation 的异步操作统一使用组件内 `role=alert` 反馈；只保留与本期公共控件无关的即时通知型原生 alert，并在测试中明确区分。

## Task List

### T1 — 固化 SDK 契约、严格校验与 Theme Token

- 在 `src/view/view-sdk.ts` 增加 11 类能力的描述符、句柄与 `ViewUi` 方法；保留现有方法签名。
- 抽取 Tabs/列表可复用的 `route | action` 判别联合，不建立第三套相互矛盾的激活模型。
- 表单显式受控：文本类含 `value/placeholder/onInput`，Checkbox 含 `checked/indeterminate/onChange`；句柄提供最小 `update()` 面。
- Content List 增加 error + retry，按 state 建立判别联合：ready 才要求 empty，loading/error 不要求无意义 empty 占位。
- 增加 info/success/warning/danger 语义 Token 和严格 validator。

完成定义：`test/view-sdk.test.ts` 覆盖合法/非法描述符、重复 id、未知字段、route/action、受控值、Content List 状态和向后兼容；相关 typecheck 通过。

### T2 — 原子补齐系统图标资产并收紧图标契约

- 先补齐 `check/dots-three/trash/sidebar-simple` 四个系统图标资产并修正 Reference 的四处错误渲染。
- 同一提交中导出规范 `SystemIconName`/集合、把 Memory/Run 的 `warning` 改为 `warning-circle`，再启用未知名称拒绝；任何中间状态都不能让 Reference 因严格 validator 崩溃。
- 系统图标改为 mask/currentColor，移除 Header 的 fill 分支；资产图标保持原图。

完成定义：静态测试扫描 `src` 与 `modules` 中所有字面量 system icon name，保证全部存在于规范集合；主/危险/Header success 图标随前景色；Header/导航图标截图确认视觉权重未回退。

### T3 — 实现 Action、Badge、Feedback 与 Confirmation 基础

- 实现统一按钮 tone/size/disabled/busy/error、防重复提交和生命周期。
- 实现 Badge、Feedback 的 loading/empty/error/success/read-only 状态。
- 实现 `confirmButton()` 与 `ui.confirm(): Promise<boolean>`，覆盖确认、取消、X、Escape、焦点圈闭/恢复、pending、失败留窗和重试。
- 固化主按钮 hover 深色、on-color 图标、禁用态与浅色按钮可辨。

完成定义：Primitive、style-contract 与 Host 单元测试通过；异步失败没有 unhandled rejection；视觉状态有自动化断言。

### T4 — 实现导航、表单、选择、进度和容器组件

- 实现 Tabs、Segmented、Disclosure、Text/Search/Textarea/Checkbox Field、Select、Combobox、Progress、Card、Section。
- Tabs 映射固定为：Run 状态 Tabs 使用 route item 并由 `?status=` 推导 selectedId；Memory Source/Diff Segmented 使用 action + Module 受控状态；Artifact Review mobile pane 使用 action tab，tabpanel DOM/显隐归 Run Module。
- 文本字段 `update()` 保持同一 control 节点，只更新 value/error/disabled/readOnly 等属性；composition 期间不重建节点、不覆盖未完成输入，结构变化才允许重挂载。
- Combobox 以现有 Artifact Review chooser 为行为基线，完成后删除旧 chooser 实现。

完成定义：键盘、ARIA、焦点、Mount 清理和 Combobox 完整交互测试通过；Playwright 验证中文 IME 连续输入不丢字、不跳焦点。

### T5 — 增强 Content List

- 增加 description、多 Badge、trailingActions、disabled、expanded/toggle/details 及 nested Mount 清理。
- 继续复用 sections 分组和 header eyebrow/title；尾部操作不触发行导航。
- 实现 loading、empty、error + retry 互斥展示。

完成定义：搜索、分组、选中、长文本、尾部操作、展开详情和三态测试通过；无第三套分组或标题层级字段。

### T6 — 扩建 Reference Module 作为正式组件样板

- 用同一页面命名模型统一一级/二级菜单、Content List Header 和 Page Header 文案。
- 按动作与确认、状态与反馈、选择与导航、表单、进度、列表、容器与折叠、Overlay/Side Panel 展示全部组件和主要状态。
- 保留关系画布为完全自定义的 Module 正文；Side Panel 默认隐藏并通过 Header action 展开。

完成定义：`/reference` 桌面/窄屏可操作，无非法图标、无控制台错误；Reference 浏览器与响应式测试通过。

### T7 — 迁移 Shell、Memory 与 ChangeSet

- Shell Project 切换使用 `ui.confirm()`；取消恢复选择和焦点，确认后导航。
- Memory Plugin 注入 theme/ui；迁移按钮、三处确认、受控字段、状态 Badge、Feedback、进度、Segmented、简单 Disclosure、Card/Panel 和可表达的 Content List。
- 迁移操作的错误路径改为组件内 `role=alert`；带评论锚点的 nodeSection、领域 meta pill、Diff/正文 Renderer 保留。
- 删除只服务于已迁移控件的重复 CSS，并清理确认文案 i18n。

完成定义：Host、Project switch、builtin Memory、ChangeSet 和浏览器测试通过；Memory/ChangeSet 核心行为与稳定 URL 无回归。

### T8 — 迁移 Run 与 Artifact Review

- Run Plugin 注入 theme/ui；迁移列表 Header、路由状态 Tabs、列表行、归档/废弃、Feedback、Badge、Progress、Card/Section、bindings Disclosure 和表单。
- Artifact Review 保持 Run Module + Host Overlay 边界，迁移按钮、Badge、进度、chooser、文本域、反馈和提交 Confirmation。
- 迁移到公共组件的失败路径使用内联 `role=alert`，不再通过 `#withButton`/run-detail 原生 alert；仅无关联公共控件的即时通知可保留并登记。
- 删除 `.run-btn/.run-status-tab/.artifact-review-select*` 等重复实现，保留步骤树、Renderer、评论锚点、分栏和领域 meta pill。

完成定义：builtin Run、Artifact Review 单元/浏览器测试通过；归档/废弃/提交的取消、失败、重试和深链状态正确。

### T9 — 同步文档、System Memory 与 Skill

- 更新中英文 View Plugin API/Guide/Design 文档，给出描述符、边界和迁移示例。
- 同步 `.memsphere/memory/concepts/memsphere-view.yaml` 与 `reserved-memory/system-memory/concepts/memsphere-view.yaml`；仅在冗余说明受影响时同步 `src/skills/memsphere/SKILL.md`。
- 执行 i18n、文档、reserved-store、skill 与 Memory 相关测试。

完成定义：用户和 Agent 可见契约与真实 API 一致；Memory 差异执行 `memsphere memory change validate` 并记录 ChangeSet ID、通过状态和稳定 View URL。

### T10 — 全量自动化与真实浏览器验收

- 运行全部受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。
- 执行 `rg -n 'confirm\\(' src modules`，生产代码必须清零；分别断言框架 Dialog 与明确保留的 prompt/alert。
- 使用真实 View 完成 Reference、Settings、Memory、ChangeSet、Run、Artifact Review 的桌面/窄屏、键盘、状态、确认、Side Panel/Overlay 和稳定深链验收。
- 截图及操作证据放入 `evidence/`，形成按组件和迁移页面索引的交付报告。

完成定义：所有门禁通过、无新增控制台错误或未处理 Promise；失败必须修复或明确为环境/历史阻塞，不能带失败进入产品验收。

## 依赖与里程碑

- M1 公共底座：T1 → T2 → T3 → T4 → T5。
- M2 原型可验：M1 → T6；先让产品负责人在 `/reference` 看见完整公共能力。
- M3 真实迁移：M2 → T7 → T8；真实页面验证 API，不修改领域边界。
- M4 可交付：M3 → T9 → T10；完成 Memory 双重校验后再进入产品验收。
