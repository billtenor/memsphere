---
id: 20260818-view-settings-scope
status: in_progress
type: feature
created: 2026-08-18
run_id: run-20260818-083235z-a7f9a6e1
---

# View Project 切换与双 Scope 配置中心

## 需求

View 侧栏当前把 Project 选择框复用为搜索框样式，并和文字“设置”挤在同一行，导致选择框过高、窄宽度下设置文字竖排。配置中心同时把 Memsphere Home 全局配置和当前 Project 配置放在同一组导航、草稿、Revision 与保存生命周期中，配置归属不清晰，也容易在 Project 切换时覆盖或误写草稿。

本次迭代重新设计侧栏头部和配置中心：

- 品牌与设置入口独立成行，使用固定尺寸按钮；进入设置后按钮切换为返回入口。Project 标签与紧凑自定义选择器独立成行。
- 配置中心在左侧同时提供可折叠的 `Memsphere` 与 `Project · <name>` 两组导航；每个入口直接打开对应配置，右侧只展示内容，不提供会反向改变左侧菜单的 Scope 控件。
- Memsphere Scope 管理语言、View 服务与全局 ACP Provider；Project Scope 管理存储概览和参与者 Control Plane。
- 两个 Scope 具有独立读取、草稿、校验、Revision、diff、确认和保存状态。
- Project 切换不会丢失全局草稿；存在 Project 脏草稿时必须明确确认后才能放弃并切换。
- 删除全局 ACP Provider 前扫描所有有效 Project；任一 Actor 仍引用时拒绝删除并显示引用位置。
- 无当前 Project 时仍可使用 Memsphere 全局设置，Project Scope 显示明确空状态。

## 验收标准

1. 桌面、窄侧栏和 390px 移动视口下，品牌、齿轮、Project 标签与选择框不重叠、不竖排、不产生横向溢出；长 Project 名不撑破容器。
2. 设置按钮可进入并退出配置中心；设置态不显示 Memory/Task 导航。设置按钮和 Project 选择器具有可访问名称、可见焦点和键盘操作能力。
3. 左侧配置导航以有明确视觉边界的可折叠分组同时显示两个 Scope：Memsphere 为概览/常规/View/Provider，Project 为概览/参与者；右侧不再显示 Scope 切换器。只读存储路径并入 Project 概览，且不显示保存操作。
4. 全局与 Project 分别使用自己的 Draft、Revision、Validation、Diff、Confirmation 和 Save；保存一方不会写入另一方文件。
5. 切换 Scope 保留双方草稿；切换 Project 保留全局草稿并重新加载目标 Project 数据。
6. Project 草稿为脏时，切换 Project 必须确认放弃；取消后保持原 Project 和原草稿。
7. 全局 Provider 被当前或其他注册 Project 引用时，前端禁止删除且服务端校验/保存均拒绝。
8. Settings Token、同源 JSON 校验和隐藏 Debug 不泄露行为保持不变。
9. 无当前 Project 时，全局 Settings API 与界面仍可用，Project 设置给出不可编辑空状态。
10. 当前全局/Project 配置文件、Registry 和 View 状态文件无需迁移，现有数据可继续使用。
11. 保留 Memory、当前 Project Memory 和 Skill 同步描述双 Scope 与 Provider 引用约束。
12. 定向测试、`npm run typecheck`、`npm test`、`npm run build` 和 `memsphere validate` 全部通过，并提交测试摘要与真实 View 供提需方验收。

## 范围

- `src/config-management.ts` 的全局/Project 配置读写边界。
- `src/commands/view.ts` 的 Settings API、鉴权复用与跨 Project Provider 校验。
- `src/view/browser.ts` 的侧栏头部、双 Scope 设置状态和切换交互。
- 对应单元、HTTP 与 Playwright 测试。
- `memsphere-framework` 保留/Project Memory、Skill 与需求记录同步。

## 不做事项

- Project create/register/bind/mount 等生命周期管理 UI。
- Project Store 模式转换、路径编辑、配置历史或配置回滚。
- Secret 管理、View 远程启停或保存后自动重启。
- 跨 Project 聚合首页、跨 Project Memory 引用或完整移动端导航重构。
- 对旧组合式 View 内部 Settings API 提供兼容层。

## 兼容策略

保留现有全局 `config.json`、Project `config.json`、Registry 和 View 服务状态格式，不需要数据迁移。新版 View 前后端同步切换到分 Scope API；该 API 尚未作为公共接口发布，因此不保留旧组合端点。

## 关联需求

- 直接依赖：`changes/archive/completed/20260817-native-project-memory-lifecycle/change.md`，本需求基于其 Home 级 View、Project Registry 和全局/Project 配置归属。
- 重复需求：无。

## 技术与测试方案

已通过 `run-20260818-083235z-a7f9a6e1` 的两轮方案评审。实现拆分全局与 Project Config Document/API/前端状态，跨 Project Provider 引用由 Registry 扫描提供最终一致性保护；测试覆盖独立 Revision/写入、Token/Origin、无 Project、草稿隔离、切换确认、响应式布局和 Memory 一致性。

## 开发任务

见同一 Run 的“开发计划”产物。

## 验收结果

开发中。
