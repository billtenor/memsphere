# 实施与验证方案：Memsphere View Framework 标准化与原型生产力

## 方案结论

本迭代采用“框架统一管壳，Module 只管业务内容”的渐进式方案：不破坏 View Plugin API v1 和现有 `content.list` Mount；新增框架渲染的标准内容列表契约与公开 UI Primitives；把 Shell 的公共结构、Theme 的视觉 Token、Slot 的组合契约和 Feature 的领域正文分开。独立 Reference Module 只通过开发预览入口加载，不进入正式 `builtinModuleCatalog`，不改造 Memory、ChangeSet、Run 或 Settings 的业务设计。

参考 DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 的职责边界，主要对照：

- `packages/client/ui-layout/src/client/AppFrame.tsx`：应用壳负责页面分区和几何关系。
- `packages/client/ui-theme/README.md`：Theme 是公共视觉变量来源。
- `packages/client/ui-primitives/README.md`：Primitive 不读取领域数据、不参与 Slot 注册。
- `packages/client/ui-slots/README.md`：Slot 是带类型的组合协议，不承担视觉设计。
- `packages/client/modules/README.md`：Feature 只声明领域入口并实现领域内容。

只吸收职责分离思想；继续使用本仓库的原生 DOM/TypeScript，不引入 React、Cordis 或 DSH 的包结构与外观。

## 当前代码事实

- `src/view/shell/layout.ts` 已提供一级导航、二级导航、内容列表、Header、正文和 Overlay 的稳定 DOM 席位，但 `viewShellStyles` 同时包含基础规则、Prototype 覆盖和四栏覆盖，同一公共元素存在多轮定义。
- `src/view/view-sdk.ts` 已有 typed Slot、scope、descriptor/mount render mode、Router 和生命周期；一级导航、二级导航、Header 已经使用 descriptor，`content.list` 仍是任意 `ViewMount`。
- `src/view/view-runtime.ts` 负责 Slot 组合和 Shell descriptor 渲染；当前工作区已有未交付的 Theme v1 雏形，需要按本方案重审，不能直接视为完成。
- `src/module/builtin-catalog.ts` 只登记 Memory、Run、Settings；`scripts/build-view-assets.mjs` 只构建该目录中的正式内置 Module。Reference Module 因此可使用独立 manifest、构建和启动脚本，避免污染正式导航。
- 合并后的 master 在 `modules/org.memsphere.memory/adapter/view/index.ts` 中包含结构化 ChangeSet diff review。上一 Run 对 Memory 详情正文、专用预览配置和测试夹具的修改与该实现重叠，必须清除并保留 master 的产品行为。
- 当前 `src/view/style-contract.ts` 把规则硬编码到 `[data-mem-memory-detail]`，`scripts/build-view-assets.mjs` 也只校验 Memory detail stylesheet；它们需要改造成与领域无关的 Module 样式边界检查。

## 架构设计

### 1. Shell：只负责公共页面结构与几何

- 保持现有 Shell DOM 席位和稳定 URL，不要求正式 Module 重写。
- 将公共 Shell 样式按职责拆为可组合的内部样式常量（布局、公共控件状态、响应式），删除同一选择器的历史覆盖链；最终每个公共状态只有一个权威规则。
- Shell 继续决定栏宽、滚动容器、折叠、Overlay 层级和窄屏切换；Module 不获得也不需要 Shell 私有选择器。
- 一级导航、二级导航和 Header 继续由现有 descriptor 驱动，并改用同一批 Theme Token 与 Primitive 渲染函数。

### 2. Theme：公共视觉的唯一来源

- 重审并保留可用的 `src/view/theme.ts` 与 `ViewTheme` v1，补齐公共壳实际使用的语义 Token；公开变量统一使用 `--mem-view-*`。
- Shell、Primitives 和 Reference Module 都消费同一 Token；删除 Shell 中与 Token 重复的品牌色、公共字号、焦点环、圆角和状态色常量。
- 本轮仅交付当前 light mode 的完整实现与可扩展的 mode 字段，不扩大范围实现主题切换或完整 dark theme。
- Feature 可以定义业务正文局部布局变量，但不能重声明 `--mem-view-*`，也不能读取 Host 私有 `--view-*`。

### 3. View Primitives：公共交互零件

- 新增 Host 所有、领域无关的 DOM Primitive 实现，覆盖本轮实际需要的按钮、图标按钮、徽标、菜单项、标准列表项、加载和空状态。
- Primitive 的输入只包含 `TextRef`、`IconRef`、动作、状态和无障碍标签等通用描述，不依赖任何 Memory/Run 数据类型，也不注册 Slot。
- 在 View SDK 中加入带版本的 `ViewUi` 服务类型；版本协商与现有 Theme 同构：`ViewPlugin.uiVersion?: 1`，Plugin 显式 `inject: ["ui"]` 且 `uiVersion === 1` 时，`ViewPluginContext.ui?` 才存在。只声明其中一项或版本不匹配均在 Plugin 注册期失败；运行时负责注入真实实现，生命周期仍由现有 Host 管理。
- Shell 自身复用同一内部 Primitive 实现，确保公开区域和 Module 需要的通用控件不会产生两套行为。
- 搜索发现继续使用已有 `search.providers` Slot；Reference Module 的列表筛选入口由标准列表 descriptor/Primitive 提供。本轮不另造完整搜索框或查询状态框架，避免与现有全局搜索形成第二套能力。

### 4. Slot：在现有内容列表 Slot 上提供标准 Mount 工厂

- 保留现有 `slots.contentList`（`content.list`、single/page/mount）的类型、注册、挂载、更新、冲突和 dispose 语义，Memory/Run 不被迫迁移，也不新增会产生跨 Slot 竞态的第二个列表 Slot。
- `ViewUi` 新增 `contentList(options)`：接收领域无关的标准列表 descriptor/provider，描述分组、条目、图标、标题、辅助信息、徽标、选中态、动作/路由、筛选入口、loading 和 empty 状态，返回标准 `ViewMount`。Module 将该 Mount 注册到原有 `slots.contentList`；Primitive 工厂本身不注册或读取 Slot。
- descriptor/provider 在 `ctx.ui.contentList(...)` 调用时先做结构校验，实际 mount/update 时再次校验 provider 返回值；非法 descriptor 使当前 Mount 明确失败，不回退到另一个旧 Mount，也不静默渲染部分内容。重复列表注册继续由现有 `RuntimeSlotTransaction.register()`、`RuntimeSlotStore.prepare()` 和 `assertNoSlotConflict()` 在 Plugin 注册事务阶段拒绝，并沿用 `startViewHost()` 现有的实例级 rollback/diagnostics/健康实例隔离语义。
- 这样“标准列表”和“受控自定义逃生口”共享同一个 single Slot：常规 Module 用 `ctx.ui.contentList()`，确有异构诉求的 Module 直接提供自定义 `ViewMount`；两者不可能在两个 Slot 中同时生效。

### 5. Feature / Module：只负责领域与自由正文

- 正式业务 Module 本轮只允许为新增公共契约做必要的注册适配，不重设计领域正文。
- `page-content` 仍通过 `ViewMount` 完全自由布局；可以制作图表、画布、编辑器等特殊界面，只需局部作用域 CSS 并消费公共 Theme Token。
- 自动样式边界检查改为通用规则：禁止 Module 声明 `--mem-view-*`、读取 `--view-*`、使用 Shell 私有 `.view-shell-*`/`[data-view-slot]` 选择器、无作用域的高风险公共类和 `!important` 覆盖。Reference Module 必须通过该检查。

### 6. 独立 Reference Module 与正式 View 接入

- 新建独立 Reference Module（目录 `modules/org.memsphere.reference/`），包含真实 `module.json`、`adapter/view/index.ts` 和局部业务正文样式，并注册到 `builtinModuleCatalog`。
- 正式构建生成该 Module 的独立 bundle；`memsphere view` 与其他 Module 同源加载并提供 `/reference` 路由和一级导航。
- Demo 用声明数据注册一级导航、二级导航和 Header，并把 `ctx.ui.contentList()` 生成的标准 Mount 注册到现有 `content.list`；正文包含一块普通说明内容和一块非列表式自定义交互区域，用来验证壳一致、正文自由。
- 记录从空目录到可运行 Demo 的命令、文件、公开 API、必要业务 CSS、耗时/步骤和摩擦清单。若实际实现必须读取 Shell 私有源码、覆盖公共 CSS、重复公共交互或绕过公开 API，则先修框架，不以 workaround 作为最终交付。

## 开发任务与影响范围

1. **遗留清理与 master 回归基线**
   - 删除上一 Run 新增的 `modules/org.memsphere.memory/adapter/view/memory-detail-adapter.ts`、`modules/org.memsphere.memory/adapter/view/memory-detail-model.ts`、`modules/org.memsphere.memory/adapter/view/memory-detail-styles.ts`、`modules/org.memsphere.memory/adapter/view/memory-detail-view.ts`、`scripts/view-memory-preview.mts`、`test/fixtures/view-memory-preview/**`、`test/view-memory-preview.test.ts`。删除 Memory 专用的 `test/view-style-contract.test.ts` 内容，任务 4 在同一路径新建领域无关测试，并纳入 master/旧 Run/最终三方断言对照表。
   - 从 `src/commands/view.ts` 删除 `memoryDetailPreview` 配置/注入通道，从 `package.json` 删除 `view:preview:memory`；从 `scripts/build-view-assets.mjs` 显式删除顶部对 `memory-detail-styles.ts` 的 `readFile`/validator import 与 `scopedStyleTargets` 循环，随后按任务 4 接入通用校验。
   - 从 `src/view/locales/en.ts`、`src/view/locales/zh-CN.ts` 逐项删除上一 Run 新增的 22 个 `memory.detail.*`/`memory.createChange` 文案键；若新 Reference Module 需要文案，使用独立 `reference.*` 名称重新建立，禁止借壳保留。
   - `modules/org.memsphere.memory/adapter/view/index.ts` 逐 hunk 恢复到 master `2c2b1445`：删除四个 `memory-detail-*` import；删除 `MemoryConfig.memoryDetailPreview`；删除专用 `copyToClipboard`；删除仅为专用 Feature 添加的 `memory.recent` fallback；恢复 Plugin 的 `inject: ["slots", "router"]` 并移除 `themeVersion`/Theme 强制检查；删除 preview/production adapter 选择与 `createMemoryDetailView`；恢复两个详情路由使用原 `page.detail`；恢复 `registerPage()` 无 `detailOverride` 参数且始终注册原 `content.list`；删除 `createMemoryDetailFeatureOptions`；恢复 `memoryStyles` 注入且不设置 `data-mem-memory-detail`；删除旧 `renderMemoryDetail()` 中新增的 hero/pill/copy-reference DOM。上述恢复不得改动 master 已有的 structured ChangeSet diff review renderer、路由、请求或断言；若本迭代无需公共壳适配，该文件最终应与 `2c2b1445` 完全一致。
   - 将 `changes/active/20260902-view-memory-preview/` 作为已由 Human 废弃的旧需求记录处理：在 `change.md` 移除 active `status`、写入 `cancelled_at: 2026-09-02` 和取消原因，连同目录内全部 13 张 PNG 历史截图移动到 `changes/archive/cancelled/2026/20260902-view-memory-preview/`；归档目标若已存在则停止，不覆盖。
   - 对旧 Run 修改的六个既有测试文件执行下列逐项处置，并在最终清理记录中对照 `master` commit `2c2b1445`：
     - `test/builtin-memory-view.test.ts`：删除专用四态 Feature 测试和 `.mem-memory-detail-*` 替换断言；恢复 master 的 Memory 详情、list/detail surface、Header action 与 ChangeSet diff 断言。
     - `test/view-responsive.test.ts`：恢复 master 的 Memory alias/canonical reference、Schema 本地化、Statement/Procedure inline reference、Human ChangeSet selection、deep-link 和错误态断言；删除上一 Run 为专用 Feature 降级或替换的选择器/行为断言。新增的框架响应式能力另写领域无关测试，不复用 Memory 换皮断言。
     - `test/view-settings-browser.test.ts`：恢复 master 的 Memory Header 选择器断言，Reference Module 不改变跨 Project 行为。
     - `test/view-host.test.ts`：Theme asset 和注入/版本协商测试按新 Theme/UI 架构重写后保留；不得携带 Memory preview 配置。
     - `test/view-host-composition.test.ts`：Host-owned Theme root/portal 生命周期测试按新通用契约重写后保留，并补 UI 服务及跨 Slot 注册期回滚测试。
     - `test/view-sdk.test.ts`：Theme token/type 测试按最终公开契约重写后保留，补 `uiVersion`、`context.ui` 和标准列表 validator；不保留 Memory 专用断言。
   - 对旧 Run 修改的 `src/view/theme.ts`、`src/view/view-sdk.ts`、`src/view/view-runtime.ts`、六份中英文文档、两份 View Memory 和源 Skill 只按本方案的通用能力重写；任何 Memory Feature 叙述删除。
   - 不触碰 `.review-comment.md`、`.review-summary.md` 等与本迭代无关文件。

2. **Theme 与 Shell 收敛**
   - 影响 `src/view/theme.ts`、`src/view/shell/layout.ts`、`src/view/host.ts`、`src/view/view-runtime.ts`。
   - 补齐 Token、统一根节点注入、合并重复样式、保持现有四栏几何和响应式行为。

3. **SDK、UI 服务和标准列表契约**
   - 影响 `src/view/view-sdk.ts`，新增领域无关 Primitive 实现文件，并修改 `src/view/view-runtime.ts` 的 UI 服务注入、版本校验和错误隔离；标准列表通过 `ViewUi.contentList()` 返回现有 `ViewMount`，不修改 `RuntimeSlotStore` 的事务模型。
   - 对旧 API 做加法式扩展；更新 SDK 类型、UI descriptor/provider validator、diagnostics 与错误信息测试。现有 `RuntimeSlotTransaction.register()` 在 `#staged` 内检查、`RuntimeSlotStore.prepare()` 对已提交与 staged entries 检查、`startViewHost()` 在 route/slot commit 失败时回滚实例，继续作为唯一列表冲突路径。

4. **通用样式边界检查**
   - 重写 `src/view/style-contract.ts` 和 `scripts/build-view-assets.mjs` 的 Memory 专用逻辑，覆盖所有构建的 Module 与 Reference Module；在 `test/view-style-contract.test.ts` 原路径新建领域无关正反例测试，不保留旧 `[data-mem-memory-detail]` 断言。
   - 允许局部业务选择器与业务布局值，阻止公共壳覆盖和全局泄漏。

5. **Reference Module 与正式入口**
   - 新增 `modules/org.memsphere.reference/**` 并注册 builtin catalog；复跑命令为 `npm run build` 后执行 `node dist/cli.js view restart`，直接从正式 View 一级导航或 `/reference` 验收，不启动独立端口。
   - 生成可复现的搭建日志并列出公开 API 清单。

6. **文档与 System Memory 同步**
   - 更新中英文 View 设计、API 和 Module 开发指南，以“创建新 Module”为主路径，并给出最小复制示例。
   - 同步 `.memsphere/memory/concepts/memsphere-view.yaml` 与实际 reserved 源路径 `reserved-memory/system-memory/concepts/memsphere-view.yaml`，删除“Memory 原型即参考实现”的旧说法。本轮只更新现有实体，不新增/重命名/删除 System Memory；如实施中发生这些结构变化，必须同步 `reserved-memory/manifest.json`，否则 manifest 不做无意义改写。
   - 若 `src/skills/memsphere/SKILL.md` 的公开指导受影响，同步源 Skill；不手工修改生成副本。

7. **测试与证据**
   - 更新/新增 SDK、runtime、Shell、style contract、Reference Module、正式 Module 回归、响应式和浏览器测试。
   - 形成上一 Run 清理清单、Demo 搭建日志、桌面/窄屏证据和最终验证记录。

8. **交付记录与归档**
   - Human 产品验收通过后，在本迭代 `change.md` 写入验收结果、移除 active status、写入 `completed_at`，并将目录移动到 `changes/archive/completed/20260902-view-framework-standardization/`；目标存在时不得覆盖。
   - 若存在 Memory 差异，交付记录必须写明与最终内容匹配且通过校验的 ChangeSet ID、校验状态和 View 入口；不能用普通 `memsphere validate` 代替。

## 验证方案

### 自动化验证

- SDK/Slot：类型与 validator 覆盖合法标准列表、非法字段、重复 ID、route/action 冲突、provider 更新后返回非法值、同一 `content.list` 重复注册、服务/UI 版本不匹配和 dispose。非法标准 descriptor/provider 导致其 Mount 失败，不回退或部分渲染；不同 Module 的冲突继续按现有 single Slot 规则使后注册实例回滚、先注册健康实例保留。
- Runtime/Shell：验证标准 descriptor 渲染、旧 Mount 兼容、切路由后状态与清理、一级/二级/Header 现有行为、Module 故障隔离。
- Style contract：正反例覆盖 Token 重声明、Host 私有变量/选择器、`!important`、无作用域选择器和合法局部业务 CSS。
- Reference Module：从独立 manifest 构建并进入正式 builtin catalog，只使用公开 API 即可注册公共区域、可选上下文侧栏和自由正文。
- 正式回归：重点执行合并后 master 的 Memory/ChangeSet、Run、Settings、Host composition、响应式测试。以 commit `2c2b1445` 建立六个被旧 Run 修改测试文件的断言对照表：记录 master 的测试名、关键选择器/行为断言、最终状态和变更原因；断言删除只能逐条对应已删除的越界 Feature，其他断言数量和语义不得减少。最终验证记录附该表，避免以弱化断言掩盖回归。
- 仓库门禁：`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。
- Memory 变更：创建并执行对应 Memory ChangeSet 校验，运行 `memsphere memory change validate`，保证源 Memory、reserved copy 与公共文档一致。

### 浏览器实测

- 使用 `playwright-cli` 启动实际 Reference Module 预览，在桌面宽度与窄屏宽度完成导航、列表选择、Header 操作、自定义正文交互、键盘 Tab/Enter/Escape 路径。
- 检查公共区域无重叠、意外横向滚动或错误滚动容器；检查 hover/selected/focus/loading/empty/长文本状态以及 `prefers-reduced-motion`。
- 检查浏览器 console，无本轮新增错误；保留桌面与窄屏截图或等价证据。
- 抽查 Memory、ChangeSet、Run、Settings 的现有稳定 URL 和核心行为。

### 产品验收

- 最终交付前由 Human 产品负责人直接运行 Reference Module，并结合搭建日志判断“是否真的方便”。
- 验收重点不是 Demo 正文是否像 Memory，而是 Module 是否主要提交描述数据就完成一级/二级菜单、Header 和内容列表，且主要编码精力落在自由业务正文。
- 最终状态出现任何必须读取私有 Shell 源码、覆盖公共 CSS、重复公共交互或绕过公开 API 的必要步骤，即判定生产力验收失败并在本迭代内修正。

## 风险与控制

- **Shell 样式收敛引起视觉回归**：先保留 DOM 与 data attribute，只整理规则权威；用既有浏览器与响应式测试逐段锁定。
- **新标准列表破坏旧 Mount**：不新增第二个 Slot；`ViewUi.contentList()` 只生成符合旧契约的标准 `ViewMount`，不改变 `content.list` 类型、注册事务或生命周期。
- **UI 服务扩大 API v1**：使用显式服务注入与版本校验，未知服务继续失败；文档标明新增能力与兼容方式。
- **静态样式检查误伤自由正文**：只禁止公共壳侵入与全局泄漏，允许作用域内的业务布局和领域视觉；用正反样例校准。
- **Demo 偷用内部能力**：Demo 独立构建，源码静态检查禁止导入 `src/view/**`（公开 SDK 映射除外）或依赖 `.view-shell-*`/`[data-view-slot]`。
- **脏工作区误删用户内容**：只处理已确认属于上一 Run 的文件；无关未跟踪文件原样保留。

## 采用的 Statement 记忆

- `statements/memsphere-repository-development-rules`
  - 采用最小且直接的职责拆分，不引入新 UI 框架或无关抽象。
  - 用户可见行为和框架边界变更同步 System Memory、公共文档与源 Skill。
  - reserved Memory 与项目 Memory 保持同步；生成副本不手工修改。
  - Syntax 变化必须在技术方案中显式声明。
- `statements/memsphere-repository-testing-rules`
  - 交付门禁执行 typecheck、全量测试、build 与 `memsphere validate`。
  - Memory 差异执行 Memory ChangeSet 校验。
  - 前端交互必须用 Playwright CLI 实际操作，不只检查源码或 HTTP。
  - 修改 View 时执行相关浏览器、响应式和正式 Module 回归测试。
- `statements/memsphere-repository-delivery-rules`
  - 存在 Memory 差异时记录匹配最终内容并校验通过的 ChangeSet ID、状态和 View 入口。
  - Human 验收后更新本迭代 `change.md` 的完成信息，并从 `changes/active/` 归档至 `changes/archive/completed/`；归档前不宣称完整交付。
- 其他直接适用的设计/开发/测试 Statement：无。

# Syntax 关键字变更

本轮不新增、不修改任何 Memory YAML Syntax 关键字。新增内容仅属于 View SDK TypeScript API、运行时 Slot/服务契约和文档。

## 已确定决策与待决问题

- Reference Module 进入正式 View 的一级“原型”导航，并与其他 Module 共用 30000：已按产品验收反馈修订。
- 继续使用原生 DOM/TypeScript，仅学习 DSH 职责边界：已按需求评审确认。
- 正式业务 Module 只做壳契约必要的最小适配，不重设计业务正文：已按需求评审确认。
- 当前无阻塞性待决问题；实施中若需要改变上述范围，先更新需求契约并重新由 Human/Agent 产品负责人确认。
