# 实现与验证汇总

## 采用的开发规范 Statement

- `statements/memsphere-repository-development-rules`：控制设计复杂度；同步 reserved/project System Memory 与 Skill；未新增 Memory DSL 关键字。
- `statements/memsphere-repository-testing-rules`：先跑受影响测试，再跑全量；执行真实 Playwright 交互、`memsphere validate` 和 Memory ChangeSet 校验。
- `statements/memsphere-repository-delivery-rules`：Human 验收前保持 active，验收后才写 `completed_at` 并移动到 completed archive。
- `statements/memsphere-repository-requirement-rules`：需求契约中保留独立向前兼容结论。

## 需求映射

| 需求 | 实现证据 |
| --- | --- |
| Shell 管公共几何 | `src/view/shell/layout.ts` 收敛为单一规则源；一级/二级导航、列表栏、Header、正文、Overlay 及桌面/窄屏布局由 Host 管理 |
| Theme 管公共视觉 | `src/view/theme.ts` 提供 46 个 Theme v1 Token；Host 根、Mount 和 portal 使用同一 Theme；详见 `theme-token-audit.md` |
| Primitives 管通用交互 | `src/view/ui-primitives.ts` 提供 button、confirmButton、iconButton、badge、emptyState、contentList；runtime Header action 复用公共按钮行为 |
| Slot 管组合 | 14 个 typed Slot 包含新增的 `side.panel`；标准列表返回普通 `ViewMount` 并注册到原 `content.list`，未新增重复列表 Slot |
| Module 只管领域 | Reference 只用公开 SDK；正文关系画布自由实现，样式限定在 Feature root |
| 不改造 Memory 做演示 | Memory Module 与 `origin/master` 一致；旧 Run 已 cancelled 并完整归档，详见 `legacy-cleanup-record.md` |
| 原型可快速复跑 | 构建并重启正式 View 后，从一级菜单“原型”进入真实独立 Module；详见 `reference-module-build-log.md` |

## 关键实现

- SDK：新增版本化 `ui` service、`uiVersion: 1`、标准内容列表 descriptor/provider 与运行时 validator；Theme Token 从 35 项补齐到 46 项。
- Runtime/Host：为声明了 `ui`/Theme v1 的 Plugin 注入 Host-owned service；增加对称版本校验、生命周期清理和运行时依赖；Reference 与其他 builtin Module 由正式 View 同源加载。
- UI：标准列表支持层级 Header、section、item、icon、title、meta、badge、selected、route/action、filter、loading、empty；按钮支持 default/primary/danger/disabled/icon 与标准确认弹窗；筛选更新保留稳定 input 和 IME/焦点。
- 上下文侧栏：`side.panel` 默认隐藏，Host 自动生成 Header 入口并统一负责宽度、关闭、焦点返回与窄屏覆盖布局；Module 只挂载内容。
- Shell：删除历史基础版与 Prototype 覆盖链；公共视觉改用 Theme Token；窄屏采用二级菜单、列表、正文纵向排列与底部一级菜单，页面无横向溢出。
- 门禁：通用 Module style contract 禁止公共 Token 重定义、Host 私有变量/选择器、Slot DOM 依赖、`!important` 及门禁不可检查的样式注入形式；build 对 builtin、Reference、Shell 与 UI 样式执行。
- 正式演示：Reference 独立 bundle 进入 builtin catalog，公开 `/reference` 路由与一级导航；通用 development asset 映射仍仅能由服务端 options 显式开启。

## 修改文件清单

- 公共实现：`src/view/theme.ts`、`src/view/ui-primitives.ts`、`src/view/view-sdk.ts`、`src/view/view-runtime.ts`、`src/view/host.ts`、`src/view/shell/layout.ts`、`src/view/style-contract.ts`、`src/commands/view.ts`。
- Reference：`modules/org.memsphere.reference/module.json`、`modules/org.memsphere.reference/adapter/view/index.ts`、`src/module/builtin-catalog.ts`。
- Build/Test：`scripts/build-view-assets.mjs`、`test/view-sdk.test.ts`、`test/view-host.test.ts`、`test/view-host-composition.test.ts`、`test/view-responsive.test.ts`、`test/view-style-contract.test.ts`。
- 中文文档：`docs/view-plugin-design.md`、`docs/view-plugin-api.md`、`docs/view-plugin-guide.md`、`docs/view-slots.md`。
- 英文文档：`docs/view-plugin-design.en.md`、`docs/view-plugin-api.en.md`、`docs/view-plugin-guide.en.md`、`docs/view-slots.en.md`。
- Memory/Skill：`.memsphere/memory/concepts/memsphere-view.yaml`、`reserved-memory/system-memory/concepts/memsphere-view.yaml`、`src/skills/memsphere/SKILL.md`；未新增/重命名/删除 System Memory，故不改 manifest。
- 交付记录：当前目录下的需求契约、三版实施方案、开发计划、Token 审计、旧 Run 清理记录、搭建日志、本汇总及两张验收截图。
- 废弃记录：`changes/archive/cancelled/2026/20260902-view-memory-preview/`（cancelled change + 13 张原始截图）。

用户原有的 `.review-comment.md`、`.review-summary.md` 未读取为实现输入、未修改、未纳入交付清单。master merge 前的安全备份 `stash@{0}` 保留，未删除。

## 兼容性

- View Plugin API 仍为 v1；Theme/UI 是显式可选注入，旧 Plugin 不声明即可保持现状。
- 原有 13 个 Slot、Route、任意自定义 `content.list` Mount 继续可用；新增 `side.panel` 为可选能力。
- Memory、ChangeSet、Run、Settings 的领域 renderer 和稳定 Route 未迁移、未重设计。
- Reference 进入 builtin catalog，作为框架标准壳的真实演示 Module；正式服务器测试证明其 asset、导航与路由可用。
- 本迭代无 stable Git tag 所要求的正式向前兼容责任，但仍以上述回归作为交付约束。

## 自动化验证

- `npm run typecheck`：通过。
- `npm run build`：通过，包含 builtin/Reference 样式门禁。
- SDK/style contract：通过；覆盖通用 Action validator 与不可检查 CSS 注入反例。
- ViewHost/Settings 浏览器定向回归：19/19 通过；覆盖标准列表逐字符输入保持焦点、真实 Reference、多 Route、非法 provider 更新、dispose、390px Settings 和无溢出。
- `npm test`：修订后真实退出码 0；518 项中 517 pass / 0 fail / 1 skip。初次上报误判截断输出，Reviewer 发现的 1 个稳定失败已修复，详见 `initial-validation-report.md`。
- `memsphere validate`：通过，验证范围为当前 Project Store。
- `git diff --check`：通过。

## Memory ChangeSet

- ChangeSet：`change-20260902-115404752z-b3696ed4`
- `memsphere memory change validate --format json`：`valid: true`，issues 为空。
- Store：embedded；base revision：`2c2b1445f87d0b074f2835e99e7c4327fd8dd427`。
- View：在正式 View 中打开相对路由 `/projects/memsphere/changes/change-20260902-115404752z-b3696ed4`

## 真实浏览器证据

- Reference route：在正式 View 中打开 `/reference`。
- 1600×1000：四栏公共壳正常，截图 `reference-desktop-1600x1000.png`。
- 390×844：纵向公共区 + 底部一级菜单；`scrollWidth = clientWidth = 390`，截图 `reference-narrow-390x844.png`。
- 自定义按钮：计数从 2 更新为 3。
- 筛选：无结果时显示标准 empty；桌面和窄屏均使用 `keyboard.type("研究")` 逐字符输入，焦点保持、值完整、仅保留 1 个目标条目。
- 窄屏 Settings：54×48px；document overflow 为 0；project popover 可点击。
- 路由：点击条目更新为 `/reference?item=notes`，selected 随 Route 更新。
- Header action 尺寸：窄屏 36×34，仅视觉隐藏文字，accessible name 保留。
- Console：0 error，0 warning。
- 最新 1900×936 复验：名称统一为“原型 / 组件参考”；主按钮 Hover 保持深色和白色图标；disabled 为低对比度、`not-allowed` 且无 Hover；确认弹窗打开、取消默认焦点、Escape 关闭与焦点返回均通过；侧栏默认隐藏、展开宽 300px；截图 `reference-components-confirm-final-1900x936.png`。
- reduced motion：标准 loading animation 在 `prefers-reduced-motion: reduce` 下关闭。
- 既有 browser regression 覆盖 Tab/Enter/Escape、焦点恢复、disabled、异步 action、Route/back、Mount dispose 和窄屏 overflow。

## 已知限制 / 后续项

- 当前只提供本迭代所需的原生 DOM Primitive，不建设完整组件展厅或第三方主题体系。
- 历史业务 Module 的正文排版仍由各自 Feature 管理；本迭代没有把领域页面强制迁移成统一模板。
- Reference 当前作为 builtin 演示 Module 提供正式一级导航；后续用户 Module 发现/安装仍未接线。
- 尚待 Human 产品负责人对运行中的 Reference 页面和搭建摩擦记录进行产品验收；验收通过前不归档当前 Change。
