---
id: 20260831-view-secondary-navigation-slot
status: todo
type: feature
created: 2026-08-31
run_id: run-20260831-134454z-5c48f73d
---

# View 统一二级导航 Slot

## 需求

为 Memsphere View 增加统一的页面级二级导航 Slot，建议命名为 `navigation.secondary`。Memory、Run、Settings 以及未来用户 Module 只声明二级导航项，由 Host 统一负责布局、样式、选中态、响应式和键盘交互，解决各 Module 二级菜单视觉与行为不一致的问题。

该 Slot 只承载页面级导航。页面内部的筛选器、局部 Tab、折叠控件和其他业务交互继续由各 Module 自己管理，不进入 Shell。

本需求独立记录，不纳入当前 View 整体界面重构 Run，也不在本次迭代中开发。

## 验收标准

- View SDK 和 Slot Catalog 提供稳定的 `navigation.secondary` Token，并在中英文长期文档中定义其用途、组合方式和边界。
- Host 在统一位置渲染当前页面适用的二级导航，Memory、Run、Settings 不再分别维护不同样式的页面级二级菜单。
- Module 可以声明导航项的文案、图标、顺序、目标 Route 和激活条件，但不能直接修改 Host 的二级导航容器。
- 二级导航的选中态由 Router/RouteActivation 驱动，刷新、深链、前进和后退后保持正确。
- 桌面与移动端具有统一且可操作的布局；支持键盘导航、可见焦点和适当的可访问性语义。
- 页面内部筛选、局部 Tab 和折叠控件不被误迁入 `navigation.secondary`。
- 单个 Module 的二级导航注册或渲染失败不影响 Shell 和其他 Module，并产生可诊断的局部错误。
- SDK、Runtime、Host 及 Memory、Run、Settings 的单元、组合与浏览器回归测试通过。

## 范围

- `navigation.secondary` 的 SDK Token、Descriptor、注册校验与 Runtime 组合。
- Host 的统一二级导航容器及桌面、移动端样式。
- Memory、Run、Settings 现有页面级二级菜单迁移。
- Router 激活、故障隔离、双语文档和自动化测试。

## 不做事项

- 不把页面内部筛选器、局部 Tab、折叠控件或业务操作迁入 Shell。
- 不在本需求中重新设计 Memory、Run、Settings 的页面主体。
- 不实现用户 Module 的安装、发现、权限或动态组合机制。
- 不纳入当前 View 整体界面重构 Run。

## 关联需求

- `20260830-builtin-module-split`：已完成，建立 builtin Module、ViewHost、Router 和现有根 Slot 的基础。
- 当前 View 整体界面重构 Run：本需求由三个 builtin Module 的二级菜单样式不一致而产生，但独立排期和实施。
- 重复需求：无。

## 技术与测试方案

待开发前补充。

## 开发任务

待开发前补充。

## 验收结果

尚未开始。
