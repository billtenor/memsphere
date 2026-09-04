# 当前迭代需求契约：View 通用控件标准化与业务迁移

## 整体目标

在已交付的 View Framework 公共壳、Theme、UI v1、Slot 和 Reference Module 基础上，把 Memory、ChangeSet、Run 与 Artifact Review 中重复出现且不包含领域语义的控件沉淀为公开、带类型、可复用的框架能力。后续 Module 开发者或 Agent 应能直接组合标准控件快速完成菜单、列表、状态与常规交互，并把自由开发集中在 `main.view` 内的领域内容。

产品边界保持为：Shell 管公共布局，Theme 管共享视觉，UI Primitives 管跨 Module 的通用状态和交互，Slot 管组合关系，Feature/Module 只管领域数据、领域行为与自由正文。Reference Module 是真实 View 内的组件参考和原型，不为演示而改造 Memory、Run 或 Settings。

Human 产品负责人 billtenor 与产品 Agent 共同评审需求和交付物；评审采用全票通过。Human 负责最终产品验收。

## 采用的 Memory 与仓库规则

- `concepts/memsphere-view`：采用其五层职责边界、十四个根 Slot、公开 Theme/UI 版本协商、Module 样式隔离、Reference Module 原型边界、稳定 URL、国际化和故障隔离要求。
- `statements/memsphere-repository-requirement-rules`：采用需求记录、当前/后续范围拆分、验收标准和“向前兼容”显式结论规则。
- `procedures/memsphere-agile-requirement-development`：采用需求契约、实施方案、开发、验证、技术验收、产品验收、提交和由 Human 决定 PR 的门禁顺序。
- 其他直接适用的 Statement：无。

## 当前迭代范围

本次 Run 只交付以下一个可独立验收的能力集合：扩展 View Framework 通用控件并迁移 Memsphere 自有 Module 中命中的重复实现。

1. 扩展公开、带类型的 UI API，并为适用控件定义一致的状态、生命周期、键盘与焦点行为：
   - 语义 Badge：default、info、success、warning、danger，可选系统图标。
   - State/Feedback：loading、empty、error、success、read-only，支持标题、描述和可选操作。
   - Tabs / Segmented Control：选中、悬停、焦点、禁用和键盘切换。
   - Disclosure / Accordion：展开状态、标题、元数据、图标与内容挂载。
   - Form Field：文本输入、搜索、文本域、复选框，以及标签、帮助、错误、必填、只读和禁用状态。
   - Select / Combobox：触发器、选项、选中、键盘导航、焦点与关闭行为。
   - Progress：数值/总量、标签以及确定与不确定进度。
   - Content List 增强：语义状态、Badge、尾部操作、次级信息和可展开内容；保留上上级/上级标题信息的一致层级。
   - Card / Section：只标准化公共容器、标题区和操作区，不规定业务正文结构。
   - Confirmation：普通与危险确认、异步忙碌/失败反馈和焦点恢复，替代原生 `confirm()`。
2. Theme 为这些控件提供公开 Token，覆盖排版、颜色、尺寸、间距、圆角、边框、焦点、禁用、悬停和动效。深色按钮的文字与图标颜色保持一致，悬停态保持可读；禁用态与浅色普通按钮有清楚差异。
3. Reference Module 在正式 `/reference` 页面展示本期全部公共控件及适用状态，包含默认、选中、悬停、焦点、禁用、加载、空、错误、成功、只读、展开和确认示例；标题和层级文案使用同一数据来源，避免一级导航、列表栏和 Header 文案漂移。
4. 迁移 Memory、ChangeSet、Run 与 Artifact Review 中命中上述公共能力的控件，至少消除现存原生 `confirm()`，并迁移可直接对应的 Badge、状态反馈、Tabs、Disclosure、表单、选择器、进度、列表行和公共容器。业务语义、数据协议和自由正文不改变。
5. 为公共 API、Theme Token、职责边界和迁移方式补充文档与最小示例；为纳入范围的控件补充单元、契约、交互和无障碍断言，并用真实浏览器验证桌面与窄屏。

最终 API 形状、文件拆分和迁移批次属于实施方案评审内容，但不得删减上述产品能力；若调查发现某项无法在本 Run 内独立安全交付，必须先更新本契约并重新经过产品负责人评审。

## 明确不做

- 不统一或重设计 Memory 的 Statement、Procedure、Schema 正文结构。
- 不把 ChangeSet 的增删改语义、Diff 排列或评论锚点模型收进公共控件。
- 不把 Run 的步骤树、分支、循环、当前步骤语义或 Artifact 关系收进框架。
- 不统一 Artifact 领域 Renderer，不改变 Review 的投票、轮次、权限或后端协议。
- 不引入 React、Vue、Web Components、Tailwind 或其他新前端技术栈。
- 不要求第三方 Module 在本期完成迁移，也不为演示能力修改 Memory、Run 或 Settings 的产品结构。
- 不修改已验收的 `20260902-view-framework-standardization` 需求结论。

## 后续范围

- 根据真实第三方 Module 使用反馈扩展新的通用控件或 UI v2；每项另立需求。
- 第三方 Module 的批量迁移、废弃旧 API 的时间表和跨大版本兼容策略；另立需求。
- Memory、Run、ChangeSet、Artifact Review 的领域体验重设计；分别另立需求。
- 更完整的组件文档站、视觉回归平台或新的前端技术栈；另立需求。

## 交付物

- 扩展后的 View SDK 类型、UI Primitives 实现、Theme Token 与样式边界门禁。
- Reference Module 完整组件参考页，保留在正式 View 和代码仓库中。
- Memory、ChangeSet、Run 与 Artifact Review 的迁移实现，以及重复 CSS/交互删除清单。
- 公共组件/API/Token 文档、职责边界说明、最小示例和迁移映射。
- 自动化测试、真实浏览器证据、控制台检查结果、未迁移项与原因。
- 敏捷需求交付报告和产品验收记录。

## 验收标准

1. Module 仅使用公开 SDK、Theme Token 和系统图标即可创建上述通用控件，不访问 Shell 私有 DOM/CSS，也不复制 Memory 或 Run 的实现。
2. 每个纳入控件都有公开类型、明确状态模型、可访问名称和可清理生命周期；交互控件支持必要键盘行为、可见焦点和 ARIA，弹层关闭后焦点返回触发点。
3. 颜色、排版、间距、边框、圆角、焦点、悬停、禁用和动效来自公开 Theme Token。主要/危险按钮的图标随文字使用前景色；主要按钮悬停不退化为低对比浅底；禁用态无需点击即可辨认。
4. 异步操作有一致的忙碌、成功和失败反馈，并防止重复提交；普通和危险确认不再依赖浏览器原生 `confirm()`。
5. 标准内容列表可一致表达上上级/上级标题、搜索、分组、选中项、次级信息、Badge、尾部操作、加载与空/错状态；业务 Module 仍能对复杂内容使用自定义 Mount。
6. Reference 页面可观察全部纳入控件及关键状态，示例可操作，一级导航、列表栏和 Header 对同一页面的命名一致；关系画布等自由正文继续证明 Module 可完全自定义 `main.view`。
7. Memory、ChangeSet、Run 与 Artifact Review 中可直接命中的重复控件完成迁移，同类控件的尺寸、状态、键盘行为与反馈一致；迁移部分不再保留相互覆盖的重复公共 CSS。
8. Memory、ChangeSet、Run、Artifact Review、Settings 与 Reference 的稳定 URL、核心操作、国际化、单记录故障隔离、桌面和窄屏行为无回归。
9. 自动化验证覆盖类型/API 契约、主要状态、键盘/焦点、确认、异步防重和样式边界；项目相关测试与全量回归通过。任何失败都区分本轮问题、历史问题和环境阻塞。
10. Human 产品负责人可在真实 View 内逐项验收组件清单、迁移映射、桌面/窄屏页面和交互证据，并作最终通过或退回决定。

## 向前兼容

结论：不需要向前兼容。

仓库当前不存在名称包含 `stable` 的 Tag，因此没有适用于本需求的稳定 Tag 检查点，也没有需要保留的稳定历史实现边界。现有 `ViewUi.version = 1`、Theme v1、Slot v1、稳定 URL、已启用 Module 和用户数据仍属于本期必须满足的当前版本兼容约束：优先以向后兼容方式扩展 v1，不静默破坏现有描述符；确需不兼容变更时必须新增版本并保留清晰的能力协商与失败行为。

## 待确认项

- 产品范围、职责边界和验收标准：由 Human 产品负责人和产品 Agent 在本步骤共同确认。
- UI API 的具体描述符结构、复用粒度、迁移顺序、测试矩阵和风险控制：由研发、架构和测试角色在下一步实施与验证方案中共同确认。
- 除以上流程门禁外，无需在开发前额外确认的产品决策。
