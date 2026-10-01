---
id: 20260830-builtin-module-split
type: feature
created: 2026-08-30
run_id: run-20260830-055840z-d9e000b0
completed_at: 2026-08-30T13:21:43Z
---

# 拆分内置 Builtin Modules

## 需求

在不切换新前端界面、不改变既有产品功能与稳定 URL 的前提下，移除单体 Legacy View，把 Memory、Run、Settings 拆成三个真实独立的 builtin Module，并由 Stable Shell、ViewHost 和共享组合 Runtime 统一装配。

## 范围

- 三个 builtin Module 分别拥有独立 Manifest、源码目录和浏览器 ESM Bundle。
- ViewHost 通过固定 Catalog、统一 Manifest 校验、Router 和四个根 Slot 装配 Module。
- Runtime 提供共享 Route/Slot Registry、实例事务、失败回滚、反序清理和局部故障隔离。
- 保留 Memory、Market、ChangeSet、Run、Artifact Review、Settings、Project 切换、深链、刷新和浏览器历史行为。
- 删除 `src/view/browser.ts`、Legacy Bundle 生成链和 Legacy Plugin 身份。
- 同步中英文架构、Plugin API、Plugin Design、开发指南和 Slot List 的当前实现状态。

## 不做事项

- 不引入新前端框架或新主页。
- 不实现用户 Module 发现/安装、Project 动态组合、Home/overlay/自定义子 Slot、热更新或沙箱。
- 不迁移后端 Domain、Application 或 Persistence 数据层。

## 技术与测试方案

- Module Manifest 在动态加载前校验 schema、SemVer、SDK 范围和包内入口路径。
- 三个 Module 使用同一公开 View SDK，Loader 不按业务身份建立专用分支。
- builtin 保留 URL 仅由 Host Catalog 授权；普通 Plugin 继续受实例路由边界约束。
- 使用 SDK、Manifest、Host Composition、故障隔离、三个 builtin Module 和真实浏览器回归覆盖边界。
- 以 typecheck、全量测试、干净 build、真实 npm pack、仓库外安装启动和 Linux/macOS/Windows CI 作为发布门槛。

## 开发任务

- 建立 Manifest、Builtin Catalog、独立构建与 npm 包边界。
- 实现四个根 Slot、Router、多实例组合 Runtime 和 Stable Shell。
- 迁移 Memory、Run、Settings 及各自状态、样式、资源清理和浏览器行为。
- 移除 Legacy 运行链，迁移测试并同步双语文档。
- 恢复 Artifact Review 非透明浮窗与原有信息结构，修复跨平台布局、构建和路径问题。

## 验收结果

已通过研发、测试、架构师三方技术验收及 Agent 产品负责人验收。

- 本地 `npm test`：485 项，484 通过、0 失败、1 个 Windows 条件跳过。
- `npm run typecheck`、干净 `npm run build`、`git diff --check` 和 `memsphere validate` 通过。
- 真实 npm tarball 已在仓库外临时目录安装并启动；Host、SDK、Runtime、三个 Module Bundle 和稳定深链均可访问，Legacy asset 返回 404。
- Playwright 实际验证 Memory、Market、Run、Artifact Review、Settings、后退、刷新和 Project 切换。
- PR [#58](https://github.com/billtenor/memsphere/pull/58) 当前 revision `39dee48` 的 Ubuntu、macOS、Windows、Windows packaged CLI shells 与 Gitleaks CI 全部通过。
- 本轮没有 Memory 差异，不需要创建或校验 Memory ChangeSet。
