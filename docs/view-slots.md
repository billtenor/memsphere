# Memsphere View Slot List

简体中文 | [English](./view-slots.en.md)

本文定义 Memsphere View 的 Slot Catalog。它是 View Host、内置 Module 与用户 Module 之间的界面组合基线，只描述公开及 Core 保留 Slot 的语义、所有权和贡献约束。第一次开发扩展请阅读 [Memsphere View Plugin Guide](./view-plugin-guide.md)，架构边界见 [Memsphere View Plugin Design](./view-plugin-design.md)，精确 TypeScript 接口见 [Memsphere View Plugin API](./view-plugin-api.md)。

## 设计原则

- Slot 按产品语义命名，不按“左上角”“第二行”等视觉坐标命名。
- Slot 由所有者声明位置、输入契约、组合顺序和降级方式，贡献方不能修改 Slot 外部结构。
- 官方 Module 与用户 Module 使用相同的公开贡献机制；Core 专属内容通过权限约束表达，不另建一套私有协议。
- 导航、Header 和主页聚合区优先接收标准描述数据，由 View Host 统一渲染；Module 不直接向这些区域注入任意 HTML。
- `main.view` 和 `overlay` 可以挂载 Module 自己的界面，但必须遵守 View SDK 的挂载、卸载、主题和故障边界。
- Slot 内容不保存权威业务状态。View 重启后，界面必须能从 Project 组合和持久数据重新构建。

## Slot List

| Slot | 所有者 | 允许贡献者 | 组合方式 | 产品语义 |
| --- | --- | --- | --- | --- |
| `header.title` | View Host | 当前激活的内置或用户 Module | 单一内容 | 当前页面的标题、辅助说明和可选面包屑。切换页面时随激活 View 更新。 |
| `header.actions` | View Host | 当前激活的内置或用户 Module | 有序列表 | 与当前页面直接相关的搜索、创建等操作。没有明确高频操作时可以为空。 |
| `header.account` | View Host | 仅 Memsphere Core | 单一内容 | 当前 Human 身份、登录状态与账户菜单。Module 可以读取授权后的身份上下文，但不能替换该区域。 |
| `navigation.primary` | View Host | Memsphere Core、已启用的内置及用户 Module | 有序列表 | 产品的统一主导航。Home、Memory、Run 与用户 Module View 在同一层级展示，不按代码来源分组。 |
| `sidebar.footer` | View Host | Memsphere Core、已启用的 Module | 有序列表 | 低频操作和持续状态。条目分为 `action` 与 `status` 两种标准类型；设置和核心服务状态由 Core 提供且不能被删除或替换。 |
| `home.attention` | Home View | 内置及用户 Module | 聚合列表 | 正在等待 Human 介入的事项，例如评审、确认、失败处理。事项完成后应从该区域消失。 |
| `home.continue` | Home View | Memsphere Core、内置及用户 Module | 聚合列表 | 最近访问或尚未完成工作的快捷入口，不表达必须处理的压力。与 `home.attention` 重复时优先在后者展示。 |
| `home.modules` | Home View | Module Composition Runtime | 聚合列表 | 当前 Project 已启用 Module 的入口与摘要。由运行时根据 Project 组合生成，不使用“软件”作为界面概念。 |
| `main.view` | View Host | 内置及用户 Module | 按路由 key 选择 | 页面主体。可以注册多个 View，但一次只挂载当前路由选中的一个；Module 可以在自己的 View 内继续声明子 Slot。 |
| `overlay` | View Host | Memsphere Core、内置及用户 Module | 按浮层 key 选择 | 抽屉、对话框和评审浮窗等临时交互。可以注册多个浮层，但控制器同一时刻只激活一个；View Host 负责遮罩、焦点、关闭行为和故障隔离。 |

当前 Catalog 定义 10 个长期 Slot。新增 Slot 时直接更新本列表。

## 当前实现状态

当前 SDK 与 ViewHost 已接线 `navigation.primary`、`header.title`、`header.actions` 和 `main.view`，三个 builtin Module 均通过这四个 Slot 接入同一个 Slot Tree。

`header.account`、`sidebar.footer`、三个 Home Slot 与 `overlay` 的产品语义和所有权已经确定，但尚未接线。当前 Shell 暂时固定管理账户状态、Footer 设置与服务状态；Artifact Review 暂时使用 Run Module 自己的 portal 浮层。实现进度只记录在本节，不删除或缩减上面的长期 Catalog。

## Slot 结构

```text
View Host
├── header.title
├── header.actions
├── header.account
├── navigation.primary
├── sidebar.footer
├── Home View
│   ├── home.attention
│   ├── home.continue
│   └── home.modules
├── main.view
└── overlay
```

`Home View` 是 Memsphere 提供的内置 View。它拥有三个主页 Slot，但与其他 Module View 一样通过 `main.view` 进入产品 Shell。

## 标准描述与自定义界面

以下 Slot 只接收标准描述，由 View Host 或 Home View 统一渲染：

- `header.title`
- `header.actions`
- `header.account`
- `navigation.primary`
- `sidebar.footer`
- `home.attention`
- `home.continue`
- `home.modules`

标准描述至少应包含稳定标识、展示文本、目标或回调、来源 Module 实例和可用状态。不同 Slot 可以在 View SDK 中补充各自字段，例如待处理事项的紧急程度和状态、导航项的图标和路由、Footer 条目的 `action/status` 类型。

`main.view` 与 `overlay` 是按 key 选择的界面挂载 Slot。Module 可以独立编译自己的浏览器 Bundle，并通过框架无关的 View SDK 挂载界面；它不能要求与 Memsphere 联合编译。

## 组合与权限

### 当前页面上下文

`header.title` 和 `header.actions` 只接收当前激活 View 的贡献。页面离开后，对应贡献随页面卸载，不保留为全局操作。

`navigation.primary`、`sidebar.footer` 和三个 Home Slot 根据当前 Project 的 Module 组合生成。切换 Project 时允许 View 整体重启并重新组装。

### 统一导航

Memory、Run 与用户个性化 View 在产品体验上属于同一个导航体系。它们可以分别来自内置 Module 和用户 Module，但界面不使用分隔线制造两套产品的感觉。来源差异只在诊断、管理或开发信息中呈现。

### Core 保留内容

以下内容虽然位于 Slot 中，但由 Core 保留控制权：

- `header.account` 的全部内容；
- `sidebar.footer` 中的 Memsphere 设置与核心服务状态；
- `navigation.primary` 中保证 View 可恢复和诊断的稳定入口。

Module 不能覆盖相同稳定标识，也不能通过排序把 Core 保留内容挤出可见区域。

## 当前不设置 Slot 的区域

以下区域暂时由 Memsphere Core 固定管理，不开放扩展：

- Memsphere 品牌标识；
- Project 切换器；
- 主页引导标题，例如“今天有什么需要处理？”；
- Shell 的整体布局、主题基础与故障诊断界面。

只有出现明确扩展需求时才增加新的语义 Slot，不为假设需求预留空 Slot。

## 故障与重启

- 单个贡献项不合法时，只忽略该项并记录 Module、实例和 Slot，不阻断其他内容。
- `main.view` 或 `overlay` 渲染失败时，由 View Host 的故障边界替换为可诊断的错误界面。
- Slot 稳定标识冲突必须明确报错，不采用静默覆盖。
- View 不要求插件热更新。Module 更新后可以重启 View，并从当前 URL、Project 组合和持久数据恢复。
