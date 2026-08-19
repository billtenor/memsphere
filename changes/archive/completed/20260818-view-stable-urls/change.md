---
id: 20260818-view-stable-urls
type: feature
created: 2026-08-18
completed_at: 2026-08-18
run_id: run-20260818-103225z-a75dc347
---

# View 稳定 URL 与可重开页面

## 需求

Memsphere View 当前把 Memory、Task、Settings、Memory Review 和 Artifact Review 的页面选择只保存在运行时状态或浏览器存储中。用户点击菜单和实体后地址栏不变化，无法复制 URL 在另一个页面直接打开相同业务界面，也不能可靠使用浏览器前进和后退。

本轮为具有独立业务语义的页面和实体建立稳定 URL、直达恢复和 history 导航。详细需求契约、评审与过程产物记录在关联 Run 中。

## 当前范围

- `/memories` 与 `/memories/<kind>/<name>`。
- `/tasks`、`/tasks/<run-id>` 与 Artifact Review 深链。
- 单层 `/settings/<module>`，公开 module 无歧义映射到 global/project Scope。
- `/memory-reviews/<review-id>`。
- 页面 URL 的初始恢复、点击同步、前进/后退和明确的未找到状态。
- 服务端页面 fallback 及自动化测试。

## 后续范围

- Reserved Memory、跨 Project、筛选条件和 Agent activity 深链。
- 每个内容节点的显式复制链接按钮。
- Memory 重命名后的永久 UUID 或重定向。

## 向前兼容

结论：需要向前兼容。

根路径 `/`、现有 localStorage 选择以及 `/api/**` 行为继续可用。显式 URL 优先于 localStorage；没有显式实体时保留既有回退行为。Settings 授权、数据模型和保存生命周期不变。

## 技术与测试方案

- 浏览器脚本增加 route parser/builder、初始恢复、统一 URL 同步和 `popstate`。
- View 服务仅对契约页面路径返回 SPA HTML，未知页面和 `/api/**` 保持原 404 语义。
- Settings 使用公开 module 到内部 scope/module 的固定映射。
- 增加服务端、脚本和 Playwright 成功/边界/history 测试。
- 交付前运行针对性测试、`npm run typecheck`、`npm test`、`npm run build` 和 `memsphere validate`。

## 开发任务

- [x] 页面路由 fallback。
- [x] 浏览器双向 URL 同步。
- [x] Memory、Task、Settings 和两类 Review 深链。
- [x] 明确未找到和可选 query 回退。
- [x] System Memory 一致性检查。
- [x] 自动化测试与完整验证。

## 验收标准

- 复制规范 URL 到新页面能恢复对应业务界面。
- 菜单和实体导航更新地址栏且不整页刷新。
- 前进/后退正确恢复，不形成历史循环。
- Artifact Review 恢复 review/round/material，身份不进入 URL。
- 无效实体不静默回退首项；未知页面路径不被 SPA fallback 吞掉。
- 既有 API、Settings 权限和持久化结构不变。

## 验收结果

- 已完成 Memory、Task、Settings、Memory Review 和 Artifact Review 的稳定 URL、直达恢复与浏览器 history；Artifact Review 支持 Round/Material 查询参数，身份、草稿、布局和 Project 上下文不进入 URL。
- 已验证默认隐藏系统 Memory 时，显式 Memory 深链仍展示目标内容；无效实体显示 Not found，未知页面与未知 API 保持 404。
- 针对性浏览器测试、Reserved Store 回归、`npm run typecheck`、347 项全量测试、`npm run build`、工作树 Memory 校验和 Project 校验均通过。
- 过程与代理验收记录关联 Run `run-20260818-103225z-a75dc347`；首轮实现验收发现并修复系统 Memory 深链过滤问题后进入复验。
- Reserved Memory、跨 Project URL、筛选条件、内容节点复制按钮和重命名重定向仍按“后续范围”处理，不属于本轮未完成项。
