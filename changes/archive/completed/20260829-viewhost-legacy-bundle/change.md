---
id: 20260829-viewhost-legacy-bundle
type: feature
created: 2026-08-29
run_id: run-20260829-100411z-ccacdf41
completed_at: 2026-08-29
---

# ViewHost 与单一 Legacy Bundle

## 需求

建立最小 ViewHost，并把当前完整 View 机械迁移到一个独立加载的唯一 ES Module Bundle。当前迭代只改变装载边界，保持既有页面、API、语言、Project 切换和交互行为，不提前实现 Manifest、Slot、多模块发现或第三方 View 安装。

## 范围

- Host 只负责挂载根节点、启动配置、动态加载、状态与错误诊断。
- 当前完整 View 的 HTML、CSS 和 JavaScript 进入唯一 `legacy-view.js`，只暴露 `mount(options)`。
- 页面路由返回 Host，Bundle 由独立静态路由提供。
- 构建与 npm 包必须包含 Bundle，运行时定位不得依赖 cwd。
- Bundle 缺失、导入失败、缺少入口和挂载失败必须显示可观察诊断。
- View 保持无服务端 Session 状态，可通过重启升级。

## 不做事项

- 不引入 React、Vite 或 Cordis。
- 不实现 Manifest、Slot Tree、多 Bundle、用户模块安装或热更新。
- 不重构数据层、API 或现有业务界面。

## 验收标准

- Host 页面不再内嵌旧业务 UI，现有 View 只位于唯一 Bundle。
- Bundle 以 ES Module 独立加载，且只有一个 `mount(options)` 入口。
- 既有主要 View 行为与视觉布局保持兼容。
- 四类 Bundle 故障均有真实浏览器自动化契约。
- typecheck、build、全量测试、Memsphere validate、npm pack 和仓库外 cwd 启动均通过。

## 实现

- 新增 `src/view/host.ts` 与 `scripts/build-view-assets.mjs`。
- 从旧 View 模板生成 `dist/view/legacy-view.js`，并保留旧顶层函数的可观察兼容性。
- View 服务新增 `/assets/legacy-view.js`，使用 `import.meta.url` 定位构建产物。
- 成功挂载时移除 loading 布局；失败时恢复 Host 诊断布局。
- 新增 Host/Bundle 成功与失败路径浏览器测试，并调整语言切换兼容断言。

## 验收结果

- 敏捷开发 Run `run-20260829-100411z-ccacdf41` 完成需求、实现、验证和三轮实现验收；最终产品交付报告通过。
- `npm run typecheck`、`npm run build`、`memsphere validate`、`git diff --check` 均通过。
- `npm test` 共 506 个场景：505 通过、0 失败、1 个既有 Windows 专用场景跳过。
- `npm pack --dry-run --json` 通过，包清单包含 `dist/view/host.js` 与 `dist/view/legacy-view.js`。
- 从 `/tmp` 启动构建后的 CLI 成功；`playwright-cli` 验证 Memory 页面加载、Host ready 和“运行”路由交互。
- 后续 Manifest、Slot、多模块发现、用户 View 安装和旧字符串测试迁移作为独立迭代处理。
