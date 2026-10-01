---
id: 20260902-view-memory-preview
type: feature
created: 2026-09-02
run_id: run-20260902-014155z-02fbe1cd
cancelled_at: 2026-09-02
---

# 真实 Shell Memory 详情原型闭环

## 取消说明

Human 产品负责人已废弃本 Run：该实现为演示框架能力直接改造 Memory Module，混淆了公共壳与业务正文的职责。后续由 `20260902-view-framework-standardization` 以独立 Reference Module 和通用 View Framework 能力替代；本目录仅保留历史过程与截图证据。

## 需求

让 Agent 在真实 View Shell、Loader、Slot、Router、Theme 与 Mount 生命周期中使用固定 fixture 开发 Memory 详情，并让同一 Feature View 通过 adapter 切换进入 production。

## 当前范围

- Theme v1 公共契约和 Mount/Portal 注入。
- 固定 Memory preview 命令与 success/loading/empty/retry 状态。
- 单条 Procedure Memory 详情 Feature View。
- zh-CN/en、样式隔离、生命周期、ChangeSet 草稿兼容和浏览器验证。

## 验收与证据

- 架构参考：本地 `deepseek-ai/deepseek-harness` commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`；采用副作用可逆、单一真实组合、Host→model→adapter→Slot→presentation 和真实 Loader 组合测试原则，不复制 Cordis/runtime 或品牌实现。
- Theme v1：35 个公开 Token；Plugin/Mount 共用同一实例 facade；element/portal root 在 mount 前安装 Token，rollback/unmount 时清理。
- Feature：正式与 preview 共用 `createMemoryDetailView`；只替换 production/fixture adapter。Memory detail route 不再在背后挂载旧 list/detail Application，因此没有双 renderer 或重复 detail 请求。
- 正式语义：Procedure 使用 `MemoryDetailModel` 驱动的“定义/目标/约束/流程”四卡片 reference presentation；定义与流程全宽，目标/约束在 1280/1600 双列、1080 单列。Concept/Schema/Statement 保留 scoped 的既有只读结构化内容，避免类型信息回归。类型标签均按 `model.kind` 本地化；标题区只有“复制引用”，不暴露创建 ChangeSet 或字段评论入口；旧 ChangeSet 页面能力不变。
- 状态边界：loading/empty/retry-error 始终保留标题/reference；retry 恢复后聚焦标题；clipboard fallback 只在当前 Mount element 内临时挂载并在 `finally` 清理。
- Loading 几何：使用与成功态同构的四区 grid skeleton，定义/流程全宽、目标/约束桌面双列，1080 单列；保持 `aria-busy` 且 skeleton 无交互控件。
- Preview：`npm run view:preview:memory` 输出 fixture `memory-detail-reference-v1` 和 success/loading/empty/retry 四个固定深链；英文使用 `MEMSPHERE_VIEW_PREVIEW_LANGUAGE=en`。
- ChangeSet：`?change=` 始终绕过 fixture；effective 与 raw fallback 都携带同一 change id，并展示 Store/校验上下文。
- 样式：新 Feature 不再注入旧 `memoryStyles`；所有 detail selector 都限定在 `[data-mem-memory-detail]` 下且只消费 `--mem-view-*`。build-time style contract 拒绝公共 Token 重声明、任意非公开变量、Host 私有变量和未以 Feature 根开头的 selector。
- 浏览器：真实 Playwright Chromium 在 ViewHost/builtin Loader 中完成四态、重试焦点、zh-CN/en 和 1080/1280/1600 viewport 操作；最终控制台 0 error、0 warning。Playwright CLI 因环境固定 Chrome 路径缺失无法启动，已由同版本项目运行时完成等价检查。
- 自动门禁：`npm test` 共 512 tests，511 passed、0 failed、1 platform skip；`npm run typecheck`、`npm run build` 均 exit 0。新增真实 Feature 四态 DOM/ARIA/Mount 测试，以及详情页不存在创建 ChangeSet/字段评论控制的负向浏览器回归。
- Memory 门禁：`memsphere validate` 通过；Embedded ChangeSet `change-20260902-033418609z-9c84c7d2` 校验通过，内容摘要 `c2f560eec05bdb2060b100b65efdc56a7d4fba670b00f9cad68a27fc8b5604e5`。
- 产品截图：同目录 `success-*`、`retry-error-*`、`retry-recovered-*` 共九张，并新增 `loading-*` 三张；覆盖 1600×1000、1280×800、1080×800。
- Review 修订：第一轮完成 kind、同一 Feature 与状态/Mount 边界迁移；第二轮移除全量 legacy CSS 注入并增加 style-tag 与 selector/变量门禁；第三轮移除越界的创建 ChangeSet/字段评论入口；第四轮让 Procedure 成功态改用冻结的四卡片专属 presentation；第五轮让 loading 保留同构四区骨架。最终重新跑完整回归并刷新十二张截图。

未完成 Agent 工程/测试/架构验收和 human 产品验收前保持 doing，不归档。
