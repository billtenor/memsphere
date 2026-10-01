# Reference Module 从零搭建记录

## 目标与结果

从新的目录 `modules/org.memsphere.reference/` 搭建一个进入 builtin catalog 的真实 View Plugin。它与其他 Module 通过同一个正式 ViewHost、Loader、Router、Slot、Theme 和 UI v1 启动；一级菜单、二级菜单、Header 和内容列表均由声明数据生成，Module 只为关系画布和计数器编写业务 DOM/CSS。

复跑命令：

```bash
npm run build
node dist/cli.js view restart
```

入口与正式 View 共用同一个服务；启动本地 View 后通过稳定相对路由 `/reference` 访问。

## 从空目录到运行的步骤

1. 新建 `module.json`，声明 Module id、版本和 `/reference` Route。
2. 新建 `adapter/view/index.ts`，只从 `@memsphere/view-sdk` 导入公开类型、`defineViewPlugin` 和 `slots`。
3. 声明 `inject: ["slots", "router", "theme", "ui"]`、`themeVersion: 1`、`uiVersion: 1`。
4. 通过 descriptor 注册 `navigation.primary`、`navigation.secondary`、`header.title`、`header.actions` 和默认隐藏的 `side.panel`。
5. 通过 `ctx.ui.contentList(provider)` 生成带层级 Header 的标准列表 Mount，再注册到原有 `content.list`。
6. 在 `main.view` 内实现关系画布、自定义计数交互；CSS 全部限定在 `[data-reference-module]`，视觉值消费 `--mem-view-*`。
7. 构建并重启正式 View；构建脚本编译独立 Module bundle，catalog 向 Host 提供 asset、boot instance 与 `/reference` 路由。

## 使用的公开 API

- `defineViewPlugin()`
- `ctx.router.register()`、Route `activation` / `to()`
- `slots.navigationPrimary`
- `slots.navigationSecondary`
- `slots.headerTitle`
- `slots.headerActions`
- `slots.contentList`
- `slots.sidePanel`
- `slots.mainView`
- `ctx.ui.contentList()`
- `ctx.ui.button()`
- `ctx.ui.confirmButton()`
- `ctx.theme` 与 `--mem-view-*` CSS variables

## 业务代码与公共壳代码的分界

- 公共壳接入：Route 和 5 个 descriptor/Mount 注册；不创建导航、Header 或列表行 DOM，不复制这些区域的 CSS。
- 业务正文：说明区、关系画布、两个节点、连线、Inspector 和计数器。
- Module 局部 CSS：仅关系画布布局、节点位置、连线和正文响应式；公共字体、颜色、间距、圆角、阴影和按钮来自 Theme/UI。

## 搭建摩擦

| 检查项 | 次数 | 结果 |
| --- | ---: | --- |
| 为搭建 Module 读取 Shell 私有源码 | 0 | 不需要 |
| 依赖 `.view-shell-*` / `[data-view-slot]` / `--view-*` | 0 | 静态门禁通过 |
| 覆盖公共 CSS 或使用 `!important` | 0 | 静态门禁通过 |
| 重写菜单、Header、列表公共交互 | 0 | 全部由 Host/UI 生成 |
| 绕过正式 Loader/Router/Slot | 0 | 与其他 builtin Module 走同一组合链路 |
| 必要 workaround | 0 | 无 |

本轮从 Reference 源码成形到完成首次真实浏览器交互约 25 分钟（按预览/浏览器日志时间估算）；其间发现并修正的是框架自身的 Header 图标和窄屏 Shell 问题，不是 Module 侧 workaround。该时间包含框架调试，不作为纯粹新 Module 的独立性能基准。

## 覆盖的演示状态

- 列表：默认、selected、badge、filter、empty、长文本截断。
- Header：统一的“原型 / 组件参考”层级、标题、副标题、异步安全 action。
- 按钮：default、primary、icon、disabled、danger 和标准确认弹窗；深色按钮 Hover 与图标颜色一致。
- 上下文侧栏：默认隐藏，从 Header 按钮展开；宽度、关闭、焦点返回和窄屏行为由 Shell 管理。
- 正文：非列表/文档模板的关系画布和独立按钮交互。
- 响应式：1600×1000 四栏；390×844 纵向组合与底部一级菜单。
- 正式接入：默认 `memsphere view` 有 4 个 builtin instance，Reference asset、导航与 `/reference` 路由可用。
