# Memsphere View Slot List

简体中文 | [English](./view-slots.en.md)

本文列出当前 `@memsphere/view-sdk` 已公开并由 ViewHost 接线的根 Slot。新增可用 Slot 时直接补充本表，不维护阶段编号。开发入口见 [View Plugin Guide](./view-plugin-guide.md)，架构边界见 [View Plugin Design](./view-plugin-design.md)，精确类型见 [View Plugin API](./view-plugin-api.md)。

## 设计原则

- Slot 按产品语义命名，不按视觉坐标命名。
- Slot 由 ViewHost 声明契约和组合方式；Module 只能注册符合契约的 Entry。
- Descriptor 只包含可校验的数据，由 Shell 统一渲染；复杂页面通过 Mount 管理 Host 分配的容器。
- Slot 不保存权威业务状态。View 重启后必须能从 URL 和持久数据恢复。

## Slot List

| Slot | 组合方式 | 渲染方式 | 作用域 | 当前用途 |
| --- | --- | --- | --- | --- |
| `navigation.primary` | `list` | Descriptor | Shell | Memory、Run 等统一主导航；按 `order` 稳定排序。 |
| `header.title` | `single` | Descriptor | Page | 当前路由的标题、辅助说明和可选面包屑。 |
| `header.actions` | `list` | Descriptor | Page | 当前路由的标准操作；可以为空。 |
| `main.view` | `keyed` | Mount | Page | 按当前 Route key 选择并挂载页面主体。 |

四个 Token 都由 SDK 导出并带稳定 `name@version`、kind、scope、render 与运行时 validator。当前三个 builtin Module 均通过这些 Token 接入同一个 Slot Tree。

## 当前结构

```text
ViewHost Shell
├── navigation.primary
├── header.title
├── header.actions
└── main.view
    ├── org.memsphere.memory
    ├── org.memsphere.run
    └── org.memsphere.settings
```

`navigation.primary`、`header.title` 和 `header.actions` 接收标准 Descriptor，Module 不能注入任意 HTML。`main.view` 接收 `ViewMount`；Host 创建 `element` 与 `portal`，Module 只管理这些容器并在卸载时返回 disposer。

Header Entry 使用 Route Activation，只在对应页面激活。`main.view` 的 key 来自同一个 Route Token，因此 URL、导航、Header 和页面挂载使用同一身份。

## Core 固定区域

以下界面当前由 Shell 固定管理，不是公开 Slot：

- 品牌标识和 Project selector；
- 登录/账户状态；
- footer 中的设置入口和服务状态；
- Shell 布局、基础主题和故障诊断；
- Artifact Review 等 Module 内部 portal 浮层。

Home、`overlay`、`sidebar.footer`、`header.account`、自定义子 Slot 等概念尚未由当前 SDK 导出，也不属于当前 Slot List。出现明确扩展需求并完成契约与实现后再加入。

## 组合、故障与重启

- Entry id、key 或 Route 冲突会使后提交的 Module 实例事务失败，不静默覆盖。
- 一个 Module 的 import、`apply()`、注册或 Mount 失败只产生该实例的局部诊断；Shell 和其他健康 Module 保持可用。
- 切换路由先卸载旧 Mount，再挂载新页面；Project 切换和 `pagehide` 会反序清理实例资源。
- View 不支持 Plugin 热替换。Module 更新后重启 View，并从稳定 URL 重新组装。
