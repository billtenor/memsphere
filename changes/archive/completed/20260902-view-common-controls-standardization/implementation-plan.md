# 实施与验证方案：View 通用控件标准化与业务迁移

## 1. 方案结论

在现有 `ViewUi.version = 1` 上做向后兼容的增量扩展，不新增框架层、不引入第三方组件库，也不改变 Slot v1、Theme v1 和现有 Module 路由。公共组件继续由 `src/view/ui-primitives.ts` 生成真实 DOM，样式只消费公开 `--mem-view-*` Theme Token；Module 只传入描述数据、当前状态和业务回调。

本期一次完成需求契约确认的 11 类公共能力，并以 Reference Module 全量展示、Memory/ChangeSet/Run/Artifact Review/Shell 真实迁移作为可用性证明。领域正文和领域状态机继续留在各 Module。

## 2. 调查依据与采用项

### 采用的 Memory

- `concepts/memsphere-view`：采用 Shell/Theme/UI Primitives/Slot/Feature 五层边界、十四个根 Slot、Theme/UI v1 能力协商、Module 样式隔离、Reference Module 原型边界、稳定 URL、i18n、故障隔离和 Overlay 归属要求。
- `statements/memsphere-repository-development-rules`：采用避免过度设计、用户可见能力同步 System Memory、Review/View 行为变更同步概念与 skill 的要求。
- `statements/memsphere-repository-testing-rules`：采用最低风险层级测试、前端交互必须使用 Playwright、禁止固定等待、先相关测试后全量回归，以及 Memory 差异双重校验要求。
- `statements/memsphere-repository-delivery-rules`：采用完成后更新验收结果、归档需求目录和记录最终 Memory ChangeSet 证据的要求。
- 其他直接适用 Statement：无。

### 当前实现证据

- `src/view/view-sdk.ts` 已公开 UI v1，但目前只有 Content List、Button、Confirm Button、Icon Button、单一样式 Badge 和 Empty State。
- `src/view/ui-primitives.ts` 已具备统一 DOM 工厂、异步按钮防重复提交、确认弹窗和 Content List Mount，可原位扩展，不需要建立第二套组件运行时。
- `src/view/theme.ts` 和 `src/view/style-contract.ts` 已提供公开 Token、Theme root 安装和 Module/Shell 样式边界门禁。
- `modules/org.memsphere.reference/adapter/view/index.ts` 已使用正式 Loader、Router、Slot、Theme 和 UI，但只展示现有少量组件。
- Memory 与 Run Plugin 当前只注入 `slots/router`，各自维护按钮、Tabs、搜索、Badge、进度、折叠、卡片、错误/空状态和大量视觉常量。
- 生产代码现有 6 处原生 `confirm()`：Memory/ChangeSet 3 处、Run 2 处、Shell Project 切换 1 处；Run 的 Artifact Review 另有自制确认 Dialog。
- Artifact Review 的领域内容由 Run Module 生成并注册到 Host `overlay` Slot；Host 只负责 Overlay 容器、背景投影、关闭、焦点和响应式。因此 Artifact Review 的公共控件由 Run Module 通过 `ctx.ui` 创建，不把领域内容移入 Shell。

## 3. 公共 API 与实现方式

### 3.1 兼容策略

- 保持 `ViewUi.version = 1`，保留现有方法签名和行为；新增方法、可选字段和 overload，不删除或重解释现有字段。
- `badge(label)`、`emptyState(empty)`、现有 `button/confirmButton/iconButton/contentList` 继续可用；新能力以描述符重载或新方法加入。
- 公共描述符只接收 `TextRef`、`IconRef`、标量状态、`ActionDescriptor`、受控回调和必要的 `HTMLElement/ViewMount` 内容，不接收 HTML 字符串，不暴露 Shell 私有选择器。
- 所有异步 Action 统一设置 `disabled + aria-busy`，执行完成或失败后恢复；错误通过组件内 `role=alert` 状态展示，不把未处理 Promise 留给浏览器。
- DOM 组件销毁时撤销 document/window listener、AbortController、计时器和嵌套 Mount；需要外部生命周期的工厂返回可挂载 `ViewMount`，简单组件返回 HTMLElement。

### 3.2 公开类型和方法

在 `src/view/view-sdk.ts` 增加以下最小语义模型，并在同文件提供严格 validator：

- `UiTone = default | info | success | warning | danger`。
- `UiSize = sm | md`，只开放实际需要的两档，避免 Module 自定义像素。
- `BadgeDescriptor { label, tone?, icon? }`；`ui.badge(TextRef | BadgeDescriptor)`。
- `FeedbackDescriptor { state: loading | empty | error | success | read-only, title, description?, action?, icon? }`；`ui.feedback()`，现有 `emptyState()` 内部复用它。
- `TabsDescriptor` 与 `SegmentedControlDescriptor`：`label`、`items`、`selectedId`。Tabs item 使用与现有导航相同的 `route | action` 判别联合；路由型 item 由 Host Router 导航，Module 每次根据当前 URL 重算 `selectedId`，因此 Run 状态 Tabs 刷新和深链后不会丢失选中态。动作型 item 调用 Module action。Tabs 本身只管理 tablist/tab、roving tabindex 与激活，不接管领域面板 Mount；可选 `panelId` 只用于输出 `aria-controls`，对应 `role=tabpanel` 的元素、显隐和生命周期由 Module 负责。Artifact Review 的 mobile pane 因此保留领域布局，只用动作型 Tabs 切换 pane。Segmented Control 使用 radiogroup/radio 和受控 `onSelect`，两者均支持方向键、Home/End、Enter/Space。
- `DisclosureDescriptor { title, description?, meta?, icon?, expanded?, disabled?, content, onToggle? }`；`ui.disclosure()` 管理 `aria-expanded/controls` 和内容显隐。
- `FieldDescriptor` 公共字段壳：`label`、`description?`、`error?`、`required?`、`disabled?`、`readOnly?`。`TextFieldDescriptor/SearchFieldDescriptor/TextareaFieldDescriptor` 在此基础上显式包含 `value: string`、`placeholder?: TextRef` 和 `onInput(value)`；`CheckboxFieldDescriptor` 显式包含 `checked: boolean`、可选 `indeterminate?` 和 `onChange(checked)`。所有字段都按描述符受控：Module 更新值后重新渲染或 update，组件不得私自把 DOM 临时值当成业务真值；工厂返回包含 root/control 的稳定句柄。
- `SelectDescriptor` 与 `ComboboxDescriptor`：标签、选项、当前值、禁用项、选择/输入回调；`ui.select()` 使用原生 select，`ui.combobox()` 只在需要过滤和弹出列表时使用 ARIA combobox/listbox，统一 Escape、方向键、Enter、外部点击关闭和焦点恢复。
- `ProgressDescriptor { label, value?, max?, description?, state? }`；`ui.progress()`，有 value 时渲染确定进度，无 value 时渲染不确定进度并遵守 reduced-motion。
- `CardDescriptor/SectionDescriptor { title?, description?, icon?, tone?, actions?, content }`；`ui.card()` 与 `ui.section()` 只负责容器、标题和操作区，正文 DOM/Mount 仍由 Module 提供。
- `ConfirmationDescriptor` 增加可选辅助文案/危险语义所需字段；确认流程支持 pending、错误、取消、Escape、焦点圈闭和关闭后焦点恢复。保留 `confirmButton()`；它只在异步 action 成功后关闭，失败时保留 Dialog、展示 `role=alert` 并允许重试。新增 `ui.confirm(confirmation): Promise<boolean>`：确认解析为 `true`，取消按钮、Escape、X 或其他非确认关闭统一解析为 `false`，不 reject；Shell/Module 根据结果决定是否执行业务动作，取消时恢复触发元素焦点和原选择。
- `ActionDescriptor` 只增加必要的可选可访问状态，不引入通用状态机；异步 busy 由框架自动管理。

系统图标契约同时收紧：从 `system-icon.ts` 导出规范 `SystemIconName`/集合并由所有 UI validator 复用，`IconRef.kind=system` 的未知名称直接校验失败，不再静默回退为 `stack`。本期补齐真实需要的 `check`、`dots-three`、`trash`、`sidebar-simple`，并把现有 `warning` 调用迁移为规范 `warning-circle`；别名只保留已明确声明且有测试的兼容名称。系统图标统一采用 mask/currentColor，包含 Header success action；不再依赖 SVG fill 加权分支，资产图标仍保持原图。

### 3.3 Content List 增强

扩展 `ContentListItemDescriptor` 的可选字段：

- `description`：与现有 `meta` 分开表达第二、第三行信息。
- `badges`：支持多个 `BadgeDescriptor`；现有单一 `badge` 保留。
- `trailingActions`：标准尾部操作；点击不触发行导航。
- `disabled`：统一不可操作语义。
- `expanded`、`toggle`、`details`：可选展开状态、动作和领域内容 Mount；只标准化展开容器，不解释详情业务。

列表 Header 继续使用现有 `header.eyebrow + header.title` 表达“上级分类 + 当前菜单”，不再发明第三套层级字段。Reference 使用“原型 / 组件参考”，Memory 使用“记忆 / 当前项目”等真实示例验证标题层级。列表继续允许复杂领域使用自定义 Mount，不强迫 Statement/Procedure 正文进入 Content List。

列表分组继续复用现有 `ContentListDescriptor.sections`，迁移时不得新增另一套 group 字段或分组组件；搜索、分组、选中项与新增的尾部/展开能力由同一个 Content List 状态模型表达。

`ContentListDescriptor.state` 扩展为 `ready | loading | error`；`error` 必须携带标准 `FeedbackDescriptor`（含可选 retry action），由 Content List 在自身容器内渲染，不能用空列表冒充失败。现有 `empty` 保持向后兼容，`ready` 且所有 section 无 item 时显示 empty；loading、error、empty 三态互斥。

### 3.4 Theme 与样式

- 在 `ViewThemeToken` 只补齐组件确实需要、可跨 Module 稳定复用的语义颜色：info/success/warning 及 soft/on-color；不为每个控件建立专属像素 Token。
- 现有排版、空间、圆角、阴影、动效 Token 继续复用；组件差异通过 `data-tone/data-state/data-size` 表达。
- 公共组件 CSS 从 `ui-primitives.ts` 拆为可审阅的 `src/view/ui-primitives/styles.ts`，实现按 button/feedback/navigation/form/content/container 分文件；最终由一个公开样式字符串聚合，避免多轮覆盖。
- 系统图标默认使用 CSS mask/currentColor（或等价的单色 current-color 渲染），使主要/危险按钮的图标始终跟随文字前景色；资产图标保留原图，不强制染色。
- 主按钮 hover 始终保持深色背景与 `onAccent` 前景；禁用态同时使用降低对比、禁用光标和 `aria-disabled/disabled`，与普通浅色按钮有可见差异。
- 扩展 `validateShellThemeStyles` 和 Module scope 门禁，防止本轮迁移重新引入公共视觉常量、Shell 私有选择器或 `!important`。

## 4. 真实业务迁移边界

### 4.1 Shell

- `src/view/host.ts` 的 Project 切换未保存确认改为公共 Confirmation；事件流由同步 `confirm()` 改为阻止原 change、异步确认后再导航，取消时恢复原选择和焦点。
- Shell 只使用框架内部创建的 UI 实例，不把 Shell DOM 暴露给 Module。
- 完成后生产代码 `rg 'confirm\\(' src modules` 必须为 0；测试 fixture 如需字符串样本必须显式排除并说明。

### 4.2 Memory 与 ChangeSet

- Plugin 增加 `theme/ui` 注入和 `themeVersion/uiVersion = 1`，把 `ctx.ui` 传入当前应用对象。
- 将通用按钮、三处确认、搜索/文本域/复选框、状态 Badge、加载/空/错误、进度、Source/Diff Segmented Control、Memory Section Disclosure、公共 Panel/Card 逐批替换为 UI v1。
- Disclosure 只迁移无 ChangeSet 评论锚点语义的简单折叠区（例如 rule-reference）；带 `data-anchor`、`data-diff-group`、标题 pill 和 `plusButton` 的 Memory/ChangeSet `nodeSection` 继续由 Memory Renderer 管理。本期不为公共 Disclosure 增加任意 data attribute 或自定义 header DOM 后门，避免把评论锚点模型收入公共控件。
- 对象列表优先迁移到增强 Content List；与 related ChangeSet、reviewed 状态和尾部操作有关的内容使用 `badges/trailingActions/details`。无法由公共描述符表达的领域节点与 Diff 正文继续由 Memory Renderer 负责。
- ChangeSet 的确认硬编码中文迁入 zh-CN/en 资源；其他固定文案遵守现有 i18n lint。
- 删除仅服务于已迁移控件的 `.memory-btn/.memory-source-tab/.memory-search/.memory-list-*` 等重复 CSS。`.memory-pill` 中纯状态项（校验、只读、成功/失败等）迁移为 Badge；承载 artifact type/format、Memory kind 或 `data-anchor` 的领域 meta pill 保留，并改用更明确的领域 class。Statement/Procedure/Schema/Diff/Comment anchor 的领域样式保留。

### 4.3 Run 与 Artifact Review

- Run Plugin 增加 `theme/ui` 注入和版本声明，把 UI 传入 RunApplication。
- Run 列表 Header、状态 Tabs、列表行、尾部归档/废弃操作、加载/空/错误重试、状态 Badge、进度、详情公共 Card/Section、bindings Disclosure、表单字段和 chooser 迁移到公共组件。
- 两处 Run 原生确认和 Artifact Review 自制提交确认迁移到公共 Confirmation。
- Artifact Review 仍由 Run Module 创建领域内容并注册到 Host Overlay；其中按钮、Badge、进度、选择器、文本域、反馈状态和公共 Card 使用 `ctx.ui`。Review 的 Submission、Round、Comment、Vote、Material、锚点、分栏拖动和业务状态机保持在 Run Module。
- 删除被公共组件替代的 `.run-btn/.run-status-tab/.artifact-review-select*` 和公共卡片/表单视觉。`.run-pill` 中 run/review 状态迁移为 Badge；step kind、policyId、material type/format 与锚点类领域 meta pill 保留并重命名为领域 class。步骤树、Artifact Renderer、评论锚点和 Overlay 内领域布局样式保留。

### 4.4 Reference Module

- `/reference` 使用同一份页面命名模型生成 navigation.primary、navigation.secondary、Content List Header 与 Header breadcrumb/title，杜绝标题漂移。
- 页面按“动作与确认、状态与反馈、选择与导航、表单、进度、列表、容器与折叠、Overlay/Side Panel”分组展示全部组件。
- 对适用组件提供默认、选中、hover/focus 可操作入口、禁用、loading、empty、error、success、read-only、warning/danger、展开/收起和异步失败/重试状态。
- Content List 明确展示“原型 / 组件参考”的上级分类与当前菜单标题、长文本、多个 Badge、尾部操作和展开详情。
- 关系画布继续完全由 Reference Module 自定义，证明公共组件不会限制 `main.view` 的领域内容。

## 5. 影响文件

主要修改：

- `src/view/view-sdk.ts`：类型、公开方法、validator、Theme Token。
- `src/view/ui-primitives.ts` 及新增的 `src/view/ui-primitives/*`：组件实现、样式和生命周期。
- `src/view/theme.ts`、`src/view/style-contract.ts`：Token 值与样式门禁。
- `src/view/host.ts`、必要时 `src/view/view-runtime.ts`：Shell Confirmation 接线，不改变 Slot 语义。
- `modules/org.memsphere.reference/adapter/view/index.ts`：完整参考页。
- `modules/org.memsphere.memory/adapter/view/index.ts`：Memory/ChangeSet 迁移。
- `modules/org.memsphere.run/adapter/view/index.ts`、`run-detail.ts`、`run-styles.ts`：Run/Artifact Review 迁移。
- `src/view/locales/zh-CN.ts`、`en.ts` 及 Module locale：新增固定文案和硬编码清理。
- `docs/view-plugin-api*.md`、`view-plugin-guide*.md`、`view-plugin-design*.md`：API、边界、示例和迁移说明。
- `.memsphere/memory/concepts/memsphere-view.yaml` 与 `reserved-memory/system-memory/concepts/memsphere-view.yaml`：同步用户/Agent 可见能力；如 skill 的冗余说明受影响则同步 `src/skills/memsphere/SKILL.md`。
- 相关 `test/view-*.test.ts`、builtin Memory/Run、Artifact Review 和浏览器测试。

## 6. 开发任务与提交顺序

1. 固化 UI v1 新描述符、validator、Token 和组件状态测试。
2. 实现 Button/Badge/Feedback/Confirmation 及统一异步 Action 基础。
3. 实现 Tabs/Segmented、Disclosure、受控 Form、Select/Combobox、Progress、Card/Section；以 Artifact Review 现有 chooser 为对照完成迁移和行为等价验证，交付后不得同时保留公共 Combobox 与 `.artifact-review-select*` 两套实现。
4. 增强 Content List 的尾部操作、多 Badge、禁用和展开 Mount 生命周期。
5. 扩建 Reference Module，先用公开 API 覆盖所有组件与状态；在业务迁移前以它验证 API 是否足够。
6. 迁移 Shell 的确认和 Memory/ChangeSet 公共控件，删除对应重复 CSS，保持领域 Renderer 不动。
7. 迁移 Run/Artifact Review 公共控件，删除对应重复 CSS，保持 Review 领域模型和 Overlay 布局不动。
8. 更新中英文文档、System Memory 和必要 skill 说明，执行静态边界与 i18n 门禁。
9. 运行分层自动化和真实浏览器验收，整理组件清单、迁移映射、删除项、残留领域实现和证据。

每个任务先运行受影响测试；若公共 API 无法表达已确认能力，先更新本方案并重新评审，不在施工中私自扩大类型模型。

## 7. 验证方案

### 7.1 自动化测试

- SDK/validator：扩展 `test/view-sdk.test.ts`，验证合法描述符、未知字段、重复 id、无效 tone/value、受控字段缺失 `value/checked`、非法系统图标名、Route/HTML 伪造和向后兼容调用。
- Primitive 单元/模块测试：验证异步按钮 busy/恢复/错误、防双击，Badge/Feedback 状态，Tabs/Segmented 键盘，Disclosure aria，Field 错误关联，Progress 语义，Confirmation 取消/失败/焦点恢复，Content List nested Mount 清理。Combobox 单独覆盖 `aria-expanded/controls`、`aria-activedescendant` 或 roving tabindex、过滤后选项与激活项同步、方向键、Home/End、PageUp/PageDown、Enter、Escape、外部点击关闭、焦点返回和选择后触发值更新。
- Theme/样式门禁：扩展 `test/view-style-contract.test.ts` 和 Primitive 测试，验证新增 Token 完整映射、无私有视觉变量、无字面公共样式、系统图标使用 currentColor/mask 等可继承前景方案、主要按钮 hover 继续使用深色 Token、禁用控件同时具有 `disabled/aria-disabled` 和区别于普通浅色按钮的视觉状态。
- Host/Slot：运行并扩展 `test/view-host*.test.ts`、`view-shell-layout.test.ts`、`view-project-switch.test.ts`，验证异步切换确认和取消恢复，不改变十四个 Slot。
- Reference：扩展 `test/view-browser.test.ts`、`view-responsive.test.ts`，检查全部组件、标题单一来源、Side Panel/Overlay、桌面/窄屏和无控制台错误。
- 业务迁移：扩展 `test/builtin-memory-view.test.ts`、`builtin-run-view.test.ts`、`artifact-review-view.test.ts`、`artifact-review-browser.test.ts`，验证核心操作和领域行为不变、公共 class/ARIA 生效、旧重复 class 与原生 confirm 消失。现有依赖 Playwright `dialog` 事件和 `dialogs=[confirm,prompt]` 的断言改为分别验证框架 Confirmation DOM 与仍保留的原生 prompt；本期保留用于自由文本/操作者选择的 3 处 `prompt()` 和仅作即时通知的 3 处 `alert()`，因为需求契约只收敛 confirm，后续另行评估输入 Dialog/Toast，验收不得误报为遗漏。
- i18n/文档/Memory：运行 `test/view-locales.test.ts`、`view-docs.test.ts`、`skill-command.test.ts`、`reserved-store.test.ts` 及 Memory 相关校验。
- 异步浏览器测试只等待可观察状态并设置超时，不使用固定 sleep 判断结果。

### 7.2 真实浏览器验收

按测试规则使用 `playwright-cli` 操作真实 View：

- 桌面宽屏：Reference 全组件、Content List 层级、Side Panel 压缩正文、Dialog/Drawer、Memory/ChangeSet、Run、Artifact Review，以及 Settings 页面无回归。
- 窄屏：列表与正文切换、Side Panel/Overlay 覆盖、Form/Combobox/Confirmation 不溢出。
- 键盘：Tab/Shift+Tab、方向键、Home/End、Enter/Space、Escape；检查可见焦点、aria 状态与焦点恢复。
- 状态：主/危险按钮 hover 和图标颜色、禁用辨识、异步 busy/失败、loading/empty/error/success/read-only、Progress、展开/收起。
- 确认：Memory、ChangeSet、Run、Artifact Review、Project 切换的确认与取消；取消不产生业务副作用，失败留在弹窗并可重试。
- 稳定 URL：分别复制并重新打开 Memory、ChangeSet、Run、Artifact Review 深链，刷新后仍回到同一对象、Review Round/Material 和选中状态。
- 控制台：无本轮新增 error、unhandled rejection 或无障碍相关运行诊断。

截图和操作记录放入需求目录的 `evidence/`，并在交付报告按组件和迁移页面建立索引。

### 7.3 最终门禁命令

- 先运行全部受影响测试文件。
- `npm run typecheck`
- `npm test`
- `npm run build`
- `memsphere validate`
- 因本轮更新 System Memory：`memsphere memory change validate [change-id]`，记录 ChangeSet ID、通过状态和 `/projects/memsphere/changes/<change-id>`。
- `rg -n 'confirm\\(' src modules` 确认生产代码无原生调用。
- `playwright-cli` 完成上述真实浏览器检查。

任何门禁失败都不得声称交付完成；必须区分本轮回归、历史失败和环境阻塞。

## 8. 风险与控制

- **范围过大**：按“公共 API → Reference → Memory → Run”批次推进，每批先由真实页面证明；不扩展领域 Renderer。
- **UI v1 兼容性**：只增不删，既有调用保留回归测试；发现必须破坏时停止并另提 UI v2 方案。
- **重渲染和焦点竞态**：组件以稳定 root 更新，异步结果使用 epoch/AbortController；测试等待稳定可观察状态。
- **Content List 过度抽象**：只增加跨 Module 的尾部操作、Badge 和展开容器；业务正文仍使用 Mount，自定义复杂列表仍被允许。
- **迁移造成视觉漂移**：先在 Reference 固化状态，再逐页截图对照；公共视觉常量只存在一处。
- **Overlay 职责越界**：Host 只管容器，Run Module 只在分配的 Mount 内消费 UI，不访问 Host 私有 DOM。

# Syntax 关键字变更

无。本期不修改 Memsphere YAML syntax，也不新增任何 syntax 关键字。

## 9. 待决问题

无产品范围待决项。具体 DOM 文件拆分可在不改变公开 API、职责边界和验收标准的前提下由研发实现；任何范围变化必须回到需求契约重新评审。
