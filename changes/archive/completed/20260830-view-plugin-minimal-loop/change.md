---
id: 20260830-view-plugin-minimal-loop
type: feature
created: 2026-08-30
run_id: run-20260830-031753z-884ef949
completed_at: 2026-08-30T04:23:39Z
---

# View Plugin 最小闭环

## 需求

把现有 ViewHost 直接调用 Legacy Bundle `mount()` 的链路，演进为 ViewHost 加载内置 View Plugin、调用 `apply(ctx, config)`、由 Plugin 向 `main.view` 注册页面 Mount 的最小闭环。现有产品功能和界面行为保持不变。

## 范围

- 实现浏览器安全的 View SDK 基座和 Host 专属 Plugin Runtime。
- 实现 View Plugin 默认入口、Slot Token、Slot Registry、注册事务、生命周期和故障诊断。
- 当前产品链路只激活 `main.view`，但 Slot Registry 不包含 Legacy 专用分支。
- Legacy Bundle 改为内置 View Plugin，继续承载现有完整界面。
- ViewHost 通过 import map 让 Host Runtime 与 Plugin 使用同一份 `@memsphere/view-sdk`。
- 保持现有 View API、URL、国际化、Project 切换、功能和布局兼容。

## 不做事项

- 不迁移 Navigation、Header、Home、Footer、Account 或 Overlay Slot。
- 不实现 Module Manifest、Module 发现、用户 Module 安装或多 Bundle 组合。
- 不实现 Router、View API、I18n、Theme、Logger 的完整插件服务。
- 不重构现有业务界面、数据层或持久化。
- 不实现插件热更新、第三方权限或沙箱。

## 向前兼容

结论：不需要向前兼容。

仓库当前没有名称包含 `stable` 的 Git Tag，不存在稳定 checkpoint 兼容责任。当前分支的产品功能仍必须保持 nodiff；只允许改变内部装载和组装方式。

## 验收标准

- Host 只接受 Bundle 的合法 `default` View Plugin，不再直接调用顶层 `mount()`。
- 内置 Plugin 通过通用 `main.view` Token 和 Registry 挂载现有完整 View。
- Plugin、Slot 注册和 Mount 具有明确资源归属、失败回滚和正常清理。
- Bundle、Plugin、API 版本、apply、Slot 注册、main View 选择和 Mount 的相关失败均有独立诊断测试。
- 既有主要 View 行为与稳定 URL 保持兼容。
- 受影响测试、真实浏览器操作、typecheck、全量测试、build、Memsphere validate、npm pack 和仓库外 cwd 启动全部通过。

## 验收结果

已通过研发、测试、架构师三方技术验收及 Agent 产品负责人最终验收。

- View Plugin 最小闭环、通用 `main.view` 注册链路和 Legacy View 内置 Plugin 已完成。
- Plugin 失败回滚、反序清理、清理错误隔离及 Legacy 全局事件、定时器、延迟 selector listener 的资源归属已验证。
- SDK/Host 针对性测试 22/22 通过。
- 全量测试 524 项：523 通过、0 失败、1 个既有 Windows 专用场景跳过。
- typecheck、build、`git diff --check`、Memsphere validate、npm pack 均通过。
