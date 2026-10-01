# 真实业务页面公共组件迁移矩阵

## 结论

本轮公共组件不再只由 Reference Module 演示。Memory、ChangeSet、Run 与 Artifact Review 已直接消费 `ViewUi v1`；只有领域数据结构和无法跨 Module 复用的正文布局继续留在 Feature 内。

| 公共能力 | Memory / ChangeSet | Run / Artifact Review | 保留的领域实现 |
| --- | --- | --- | --- |
| Content List | 当前项目、最近使用、记忆市场、记忆变更、ChangeSet 目标列表均由 `ui.contentList` 渲染 | Run 运行中/已完成/已废弃列表由 `ui.contentList` 渲染 | Memory 实体正文、Run 步骤树不是“对象列表”，不塞入 Content List |
| List Header / Search / Empty / Error | 列表上级名、标题、刷新、筛选、空态和加载失败使用 Content List 描述符 | Run 标题、刷新、空态使用 Content List 描述符 | 无重复列表 Header、搜索框或错误卡 CSS |
| List Row / Badge / Trailing Action / Expand | Memory/ChangeSet 状态、关联变更数量、关联 ChangeSet 展开使用标准行、Badge、Toggle 和 details Mount | Run 状态信息和归档/废弃尾部操作使用标准行与公共确认 | 关联项内容仍由 Memory 组装，但容器与交互由 Content List 管理 |
| Button / Icon Button / Confirmation | 创建变更、导入、评审、归档、废弃、评论操作使用公共按钮与确认 | Run 操作、Artifact Review 操作、归档和废弃使用公共按钮与确认 | 自由文本身份选择仍保留原生 prompt，未冒充 Confirmation |
| Form Fields / Select / Combobox | 隐藏系统记忆使用 Checkbox Field；新增和编辑意见使用 Textarea Field | Binding 参与人和跳过评审使用 Checkbox Field；Artifact Review 意见使用 Textarea Field；材料、身份等选择使用 Select/Combobox | 业务校验和提交协议仍由各 Module 负责 |
| Progress / Feedback | ChangeSet 已查看进度使用 Progress；详情空态、错误和重试使用 Feedback | Run 详情空态/错误使用 Feedback | 进度数据计算和重试请求仍属领域逻辑 |
| Disclosure | 关联 ChangeSet 使用 Content List 的标准展开能力 | Run 运行时评审绑定使用 `ui.disclosure` | Memory 规则树、Run 执行树的层级折叠保留领域结构 |
| Card / Section | ChangeSet 正文继续保留领域差异容器 | Run 元信息使用 `ui.card` | Memory Renderer、diff、评论锚点、Run step/artifact tree、Artifact Review 双栏几何保留自定义 |
| Tabs / Segmented | ChangeSet 差异/完整内容使用 Segmented | Artifact Review 视图选择使用 Tabs/Segmented | 切换后的领域内容由 Module 渲染 |

## 防回退门禁

- `test/view-style-contract.test.ts` 强制真实 Memory 与 Run 源码调用 `ui.contentList`。
- 同一门禁禁止恢复 `.memory-button { ... }`、`.run-card { ... }` 等已退休列表 CSS。
- Run Binding 必须出现 `ui.disclosure` 和 `ui.checkboxField`。
- builtin 与响应式浏览器测试直接定位 `.mem-view-content-list`、`.mem-view-list-item`、`.mem-view-progress`、`.mem-view-disclosure` 等公共 DOM，而不是旧 Feature 私有 class。

## 明确保留项

- Memory Statement / Procedure / Schema Renderer 与 ChangeSet diff 语义。
- 评论锚点、行内差异定位和 ChangeSet 评审状态机。
- Run 执行步骤树、Schema writing、Artifact 渲染和 Artifact Review 双栏布局。
- 上述内容的结构跨领域不可复用，继续由 Module 自由实现；它们内部直接命中的按钮、字段、Badge、折叠和反馈仍优先消费公开 primitive。
