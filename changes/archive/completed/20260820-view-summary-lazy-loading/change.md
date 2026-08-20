---
id: 20260820-view-summary-lazy-loading
type: performance
created: 2026-08-20
completed_at: 2026-08-20
run_id: run-20260820-141503z-bb189808
---

# View 全域摘要与详情懒加载

## 需求

Memory、Run、Review 数量和内容增大后，View 刷新会同时读取、解析、传输并渲染三类完整数据，导致首屏耗时和响应体积随数据量快速增长。

View 应按当前路由先加载可渲染列表的最小摘要，仅在选择实体、打开 Review 抽屉或 Artifact Review 时读取完整详情；Settings 不加载无关业务集合。

## 交付

- Memory、Review、Run 增加兼容旧接口的 summary/detail API；旧完整集合 API 保留。
- Memory summary 分块扫描 YAML 头部名称元数据，不解析完整 Memory AST。
- Memory Review 使用带源文件 size/mtime 指纹的 `summary.json` 派生缓存；旧数据首次回退解析后自动回填。
- Run summary 只解析列表和评审进度所需字段，不 hydrate Artifact、读取正文或渲染 Markdown。
- View 改为 route-aware 首屏加载，维护三类详情缓存；Task 轮询只请求 summary，无变化时不重绘。
- Artifact Review context 使用带 `runId` 的直接 API 精确读取 active 或 archived Run。
- 增加 Project generation、Memory Review subject 和详情成员守卫，避免跨 Project、同 Project Memory 切换及 in-flight detail 响应污染当前页面。
- 当前归档只读 Run 作为 transient detail 跨 active summary 刷新保留，但不进入 active Task 导航和计数，保证归档 Artifact Review 深链稳定。

## 验证

- `npm run typecheck`：通过。
- 关键定向测试：Review store/browser 63/63、归档 Artifact Review 与相关浏览器断言 65/65、Project/Memory/Review 竞态浏览器回归通过。
- `npm test`：387 项，386 通过、0 失败、1 项 Windows 平台条件跳过。
- `npm run build`：通过。
- `node dist/cli.js validate`：通过。
- `git diff --check`：通过。
- 真实项目三次 summary API 基准均低于 500 ms / 620 KB：Memory 7,771 bytes（156.8/84.4/75.7 ms），Review 10,877 bytes（89.3/6.2/4.3 ms），Run 25,887 bytes（381.3/361.4/306.8 ms）。

## 验收结果

- 需求、方案、开发计划及实现验收均通过敏捷 Run `run-20260820-141503z-bb189808` 的多角色评审。
- 系统架构师兼项目负责人完成最终决策；研发、测试与架构师在实现验收第六轮全部通过，阻塞、风险和建议均为 0。
- 前序评审发现的 Memory/Review 完整解析、Review source、跨 Project/Memory 竞态、in-flight Review detail 和归档 Artifact Review 轮询稳定性问题均已修复并补回归测试。

## 后续范围

- 当 Run 文件数量继续增长时，为 Run summary 建设持久 sidecar 或 locator index，消除每次请求仍需读取并 JSON.parse 全部 active Run 状态文件的 O(n) 成本。
- 旧 Artifact Review 兼容 API 仍按 review id 扫描 Run；View 已迁移 direct runId API，其他调用方可后续迁移。

## 残留问题

- 当前范围内无阻塞残留。
- Run summary 的逐文件 JSON.parse 和旧兼容 Artifact Review API 的扫描成本属于已确认的后续性能范围。

## PR 复审修订

- 修复 Windows CRLF checkout 下源码边界断言失败，测试先统一换行符再检查实现边界。
- Review summary sidecar 写入改为 best-effort，派生缓存失败不再让已经持久化的 canonical Review mutation 返回失败。
- Review summary 只复用 `updatedAt` 一致的 detail cache，避免其他页面或 Agent 更新后被旧详情覆盖。
- 归档当前 Run 后保存下一条选择并立即加载详情，不再永久停留在 summary loading 状态。
- page load generation 贯穿异步 route application，并使新导航失效旧 Artifact Review context 请求，避免延迟 history 请求覆盖最新页面。
- 新增 sidecar 写失败、外部 Review 更新、归档后下一 Task 详情和快速 history 导航竞态回归；定向测试 13/13、全量测试 388 项 0 失败、typecheck、build、validate 与 diff check 均通过。
