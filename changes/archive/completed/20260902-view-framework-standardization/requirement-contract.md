# 当前迭代需求契约：Memsphere View Framework 标准化与原型生产力

## 整体目标

把 Memsphere 已有的“可注册插件”能力推进为“可高效生产一致前端”的 View Framework：框架统一负责公共页面壳、视觉规范、通用交互零件和组合契约；Module 只负责领域数据、领域行为和 `page-content` 内的自由业务界面。

本迭代参考本地 DeepSeek Harness（commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`）的职责分离思想，但不照搬 React、Cordis、包结构或视觉外观。采用的核心边界是：Shell 管页面分区与尺寸，Theme 管共享视觉变量，Primitives 管跨 Module 通用交互，Slot 管可验证的组合关系，Feature/Module 管领域内容。

## 问题陈述与调查结论

- 当前 View SDK 已有 typed Slot、Router 和插件生命周期，具备继续演进的基础。
- 一级菜单、二级菜单和 Header 已由 Shell 渲染，但 Shell 样式仍集中在大型内联样式中，存在历史基础样式与后续覆盖叠加，公共视觉缺少单一权威来源。
- `content.list` 当前接收任意 `ViewMount`，因此列表容器由框架提供、列表行和常见状态却由各 Module 重复实现，Agent 必须进入业务 Module 猜测 CSS。
- 公共按钮、菜单项、列表行、徽标、空状态等尚未形成稳定的 View UI Kit 公共契约。
- 前一 Run 为证明原型效果直接改造了 Memory 详情页，混淆了框架能力和业务页面设计；该 Run 已废弃，本迭代必须移除这类越界实现。

## 当前迭代范围

### 1. 明确并实现五层职责边界

- **Shell**：统一管理一级菜单、二级菜单、内容列表栏、Header、正文区和 Overlay 的位置、尺寸、滚动、折叠及响应式行为。
- **Theme**：成为共享颜色、字体、字号、行高、间距、圆角、阴影、动效和焦点样式的唯一公共来源；Feature 不再定义第二套全局主题。
- **View Primitives / UI Kit**：提供适合当前无框架 DOM 技术栈的公共组件或渲染器，至少覆盖导航项、内容列表项、按钮、图标按钮、徽标、搜索/筛选入口和空状态中本迭代实际需要的形态。
- **Slot**：保留并完善 typed composition contract，明确每个公共 Slot 的 kind、scope、value、所有者、组合方式和卸载行为；Slot 不承担视觉设计。
- **Feature / Module**：提供领域数据、行为和业务正文；可以在 `page-content` 内自由布局，不依赖 Shell 私有 DOM 或 CSS。

### 2. 标准化四类高频公共区域

- 一级菜单：Module 只提交语义描述，Shell 统一渲染默认、悬停、选中、徽标、焦点和窄屏行为。
- 二级菜单：Shell 统一容器、标题、菜单项、底部区域和响应式行为，Module 只提交结构和动作。
- Header：Shell 统一标题、副标题、操作区、截断、焦点与小屏排列，Module 不覆盖 Header CSS。
- 内容列表：新增框架拥有的标准列表契约与列表行 Primitive，覆盖标题、辅助信息、图标、徽标、选中、加载、空状态和长文本；保留受控的自定义内容逃生口，避免强迫所有领域列表同构。

### 3. 清理样式权威边界

- 整理 Shell 样式，使同一公共元素不存在多轮相互覆盖的定义。
- 建立语义化 Theme Token；公共组件和参考 Module 不写重复的字号、品牌色和公共状态色。
- 增加可自动检查的样式契约，阻止 Module 依赖 Shell 私有选择器、定义全局主题或通过高优先级覆盖修改公共壳。
- 组件特有布局样式可以与组件共置；业务正文可以拥有自己的局部样式。

### 4. 提供独立参考 Module

- 从一个新的 Module 开始实际搭建独立、可运行的 Demo/Reference Module，不把静态截图、测试 Fixture 或对现有 Memory Module 的换皮当作 Demo 交付。
- Demo 使用公开 SDK、Theme Token、Primitives 和 Slot 契约组合一级菜单、二级菜单、Header、标准内容列表与自由正文。
- Demo 默认不污染正式产品导航；通过明确的开发/预览入口启用。
- Demo 正文刻意包含一种标准内容和一种自定义内容，用来证明“公共壳一致、业务正文自由”。
- 记录真实搭建过程：从空 Module 到可运行页面所需的步骤、命令、文件、公开 API、必要 CSS、遇到的阻塞与绕行；产品负责人据此验收框架是否真正降低原型搭建成本。

### 5. 处理上一 Run 遗留改动

- 开发前逐项审查当前工作区差异，撤销上一 Run 对 Memory 详情正文、Memory 路由和专用预览夹具的越界改造。
- 可能通用的 Theme、SDK、文档和测试代码不得直接视为可交付成果，必须按本契约重新审查后保留、重写或删除。
- 不覆盖、删除或提交用户与本迭代无关的工作区文件。

### 6. 文档与 Agent 使用体验

- 公共 API 文档以“搭建一个新 Module 页面”为主路径，说明五层职责、可用 Slot、Primitives、Theme Token、自由正文边界和禁止事项。
- 提供最小可复制示例，使 Agent 不阅读 Shell 内部源码即可完成页面组合。
- 中英文公共文档及相关 Memsphere View Memory 保持一致。

## 后续范围

- 系统性迁移所有历史 Module 的业务正文排版与领域组件。
- 建设完整组件展厅、可视化主题编辑器或第三方主题市场。
- 引入 React、Vue、Web Components、Tailwind 或其他新 UI 技术栈。
- 对 Memory、ChangeSet、Run、Settings 的领域交互进行产品重设计。
- 将所有奇特业务内容抽象为统一卡片或页面模板。
- 完整复刻 DeepSeek Harness 的外观、组件数量或包组织。

## 交付物

1. 单一职责清晰的 Shell 与 Theme 实现。
2. 稳定、带类型和运行时校验的公共 Slot 与 View UI Kit API。
3. 四类公共区域的标准渲染与响应式行为。
4. 从新 Module 实际搭建完成的独立 Reference Module、预览入口和搭建过程记录；不能用 Fixture、截图或改造 Memory Module替代。
5. 上一 Run 越界 Memory 页面改动的清理结果。
6. 中英文设计说明、API 文档、Module 开发指南及同步的 Memsphere View Memory。
7. 单元、契约、集成、响应式、可访问性与浏览器视觉验证证据。

## 验收标准

### A. Agent 原型生产力

- Agent 仅阅读公开文档和 Reference Module，不阅读 `src/view/shell/**` 私有实现，即可创建一个新 Module。
- 新 Module 能通过描述数据快速获得统一的一级菜单、二级菜单、Header 和内容列表；不需要复制公共 CSS，也不需要猜测 Shell DOM。
- 新 Module 的 `page-content` 能实现与列表/文档模板不同的自定义业务布局，不被框架强制成统一卡片。
- 实际 Demo 搭建过程有完整记录，能够区分业务正文开发与公共壳接入成本，并列出所有不得不读取私有源码、覆盖公共 CSS、重复实现公共交互或绕过公开 API 的情况；出现此类必要绕行即视为原型生产力验收不通过。
- Human 产品负责人通过运行中的 Demo 和搭建记录验收“是否方便”：一级/二级菜单、Header、内容列表应主要由声明数据完成，Agent 的主要编码精力应落在自由业务正文，而不是壳层 CSS 调试。

### B. 视觉与交互一致性

- 公共区域的字体、颜色、间距、圆角、选中、悬停、焦点、空状态和加载状态来自 Theme 与 Primitives 的单一实现。
- 桌面和窄屏下，菜单、Header、列表和正文区无重叠、横向意外溢出或错误滚动容器。
- 键盘可达控件有可见焦点；仅悬停出现的操作仍存在键盘可用路径；减少动效偏好得到尊重。

### C. 架构边界

- Shell 私有选择器与内部 DOM 不属于公共 API，并有测试或静态契约阻止 Reference Module 依赖它们。
- Theme 是共享视觉变量唯一权威来源；Reference Module 与新 Primitives 不硬编码可由语义 Token 表达的公共颜色和字号。
- Slot 的 kind、scope、组合和 dispose 行为具有类型检查与运行时失败测试。
- Primitives 不读取领域数据，不依赖某个业务 Module，也不负责 Slot 注册。

### D. 现有产品回归

- Memory、ChangeSet、Run、Settings 的现有稳定 URL 可正常打开，路由与核心行为不退化。
- 不为本次演示改造 Memory 详情正文；若现有 Module 因公共壳契约需要最小适配，改动仅限壳层注册/描述数据，不改变领域呈现和业务语义。
- View 插件加载、卸载、路由切换和响应式测试通过；浏览器控制台无本轮新增错误。

### E. 可审查证据

- 提供 Reference Module 的桌面与窄屏截图或等价浏览器证据。
- 提供“只使用公共 API”的源代码检查结果。
- 提供从空 Module 到运行 Demo 的搭建日志、所用公开 API 清单、壳层接入步骤和框架摩擦清单，供产品负责人验收搭建便捷性。
- 提供上一 Run 越界代码已删除或被新契约合理吸收的逐项说明。
- 全量相关测试、构建和 Memory ChangeSet 校验结果可追溯；环境原因未执行的项目必须单独列出。

## 兼容性要求

- 现有 View Plugin API v1、已注册 Slot 的现有合法用法和正式路由默认保持可用；若内容列表引入更强的新契约，应优先采用新增/渐进迁移或明确的兼容适配，不能静默改变旧插件语义。
- 当前迭代不得要求业务 Module 全量重写，也不得把 Reference Module 作为生产业务依赖。
- 中英文文档、内置 System Memory 和对外导出保持同步。

## 向前兼容

**结论：不需要向前兼容。**

仓库当前未发现名称包含 `stable` 的 Git Tag，因此依据 `memsphere-repository-requirement-rules`，不存在需要承担正式向前兼容责任的稳定 checkpoint。尽管如此，本迭代仍把当前 View Plugin API v1 和现有正式 Module 行为作为明确的回归约束，除非后续由 Human 产品负责人确认破坏性变更。

## 采用的 Statement 记忆

- `statements/memsphere-repository-requirement-rules`
  - 已设置独立“向前兼容”章节。
  - 已明确兼容结论、稳定 Tag 调查结果及本迭代回归约束。
- 其他与需求和验收直接相关的 Statement：无。

## 待确认项

1. Reference Module 默认不出现在正式产品导航，仅由开发预览入口启用；是否接受。
2. 本迭代沿用当前原生 DOM/TypeScript 技术栈，只学习 DSH 的职责边界，不引入 React/Cordis；是否接受。
3. 现有业务 Module 只做公共壳契约所必需的最小适配，业务正文视觉统一留到后续迭代；是否接受。
