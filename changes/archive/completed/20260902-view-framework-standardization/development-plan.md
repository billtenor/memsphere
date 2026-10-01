# 开发计划：Memsphere View Framework 标准化与原型生产力

当前进度（2026-09-02）：Task 1–9 已完成并通过验证；Task 10 等待 Human 产品验收后执行归档。下列复选框保留为最初获批计划快照，实际完成证据见 `implementation-and-verification.md`。

## 执行原则

- 基线固定为 master `2c2b1445`；先清理上一 Run 对 Memory 的越界修改，再建设通用框架。
- 每个任务完成后运行对应的最小验证，阶段结束运行相关测试；不把所有问题留到最后。
- 不修改 `.review-comment.md`、`.review-summary.md` 或其他无关工作区内容。
- 不新增第二个内容列表 Slot；标准列表由 `ViewUi.contentList()` 生成并注册到既有 `content.list`。
- Reference Module 只在显式开发预览中加载，正式 `memsphere view` 仍只有 builtin catalog 中的 Module。

## Task 1：建立交付记录并清理废弃 Run

依赖：无。

- [ ] 创建 `changes/active/20260902-view-framework-standardization/change.md`，登记 `status: doing`、类型、日期、当前 Run、需求契约和实施方案。
- [ ] 把 `changes/active/20260902-view-memory-preview/change.md` 改为 cancelled 记录，写入 `cancelled_at: 2026-09-02` 和“职责越界、由当前框架迭代替代”的原因。
- [ ] 将旧 Change 目录及全部 13 张 PNG 移到 `changes/archive/cancelled/2026/20260902-view-memory-preview/`；移动前确认目标不存在。
- [ ] 删除四个 `modules/org.memsphere.memory/adapter/view/memory-detail-*.ts`、Memory preview script/fixture/test。
- [ ] 将 Memory `index.ts`、相关 locale 和六个既有测试文件按实施方案逐 hunk 恢复到 master 行为；只删除重复的 `memory.recent` 键行，保留 master 最近使用功能。
- [ ] 清除 `src/commands/view.ts` 的 `memoryDetailPreview` 通道、旧 package script 和 build script 的 Memory stylesheet import/循环。
- [ ] 产出 `legacy-cleanup-record.md`，列出每个文件、hunk、文案键和测试断言的处置；用 `rg` 证明 `memory.detail.*`、`memoryDetailPreview`、`mem-memory-detail` 无遗留引用。

完成标准：Memory/ChangeSet 行为与 `2c2b1445` 一致；`view-locales` 双语键集合一致；相关 Memory、ViewHost、响应式测试通过。

## Task 2：建立 Theme 差距表与单一 Token 来源

依赖：Task 1。

- [ ] 扫描 `src/view/shell/layout.ts` 的私有 `--view-*`、硬编码颜色/字号/圆角/阴影/焦点值，生成 `theme-token-audit.md`。
- [ ] 对每个值明确三选一：映射已有 `--mem-view-*`、新增语义 Token、保留为 Shell 几何；记录理由和消费者。
- [ ] 重审 `src/view/theme.ts` 与 SDK Theme v1 类型，建立完整 light token 表和 CSS variable 映射。
- [ ] Shell 与 Host 根节点消费公共 Token；删除可由 Token 表达的私有视觉变量和公共硬编码值，几何变量（栏宽等）继续由 Shell 私有管理。
- [ ] 增加 Shell Theme 门禁：公共区域不得残留可 Token 化的颜色、字号和公共状态值；Theme 键与 CSS variable 映射完全一致。

完成标准：审计表每项有决策；Theme 是公共视觉唯一来源；Shell 同一元素无多轮覆盖链；Theme/Host 测试通过。

## Task 3：实现 View UI Primitives 与版本化服务

依赖：Task 2。

- [ ] 在 SDK 定义 `ViewUi`、`uiVersion?: 1`、可选 `ViewPluginContext.ui?` 和领域无关 descriptor/provider 类型。
- [ ] 在 runtime 增加 `ui` 支持、同构版本校验和 Host-owned 实例注入；只声明 inject 或 version 均注册失败。
- [ ] 实现按钮、图标按钮、徽标、菜单项、标准列表项、筛选入口、loading 和 empty Primitive；Primitive 不读取领域数据或注册 Slot。
- [ ] 让 Shell 的一级/二级导航与 Header 复用 Primitive 的公共交互/状态实现，保留现有 descriptor API。
- [ ] 覆盖键盘、焦点、disabled、异步 action、reduced motion、长文本和 dispose 行为。

完成标准：Module 只通过公开 SDK 获得 UI 服务；Shell 与公开 Primitive 共享视觉/交互来源；版本与生命周期测试通过。

## Task 4：实现标准内容列表 Mount

依赖：Task 3。

- [ ] 实现 `ctx.ui.contentList(descriptorOrProvider): ViewMount`，支持 section、item、icon、title、meta、badge、selected、route/action、filter、loading、empty。
- [ ] 调用时与 mount/update 时分别校验 descriptor/provider；非法值明确失败，不回退、不部分渲染。
- [ ] 将生成的 Mount 注册到原有 `slots.contentList`，复用 `RuntimeSlotTransaction`/`RuntimeSlotStore` 的 single Slot 冲突、实例回滚、diagnostics 和 dispose。
- [ ] 测试同 Module/不同 Module 重复注册、provider 更新、路由切换、旧自定义 Mount 兼容和空列表让位语义。

完成标准：常规列表无需 Module 自写公共 CSS；旧 Memory/Run 自定义 Mount 仍可用且语义不变。

## Task 5：通用 Module 样式边界门禁

依赖：Task 2、Task 3。

- [ ] 将 `src/view/style-contract.ts` 改为领域无关校验器。
- [ ] 禁止 Module 声明 `--mem-view-*`、读取 `--view-*`、依赖 `.view-shell-*`/`[data-view-slot]`、使用无作用域高风险类或 `!important` 覆盖壳层。
- [ ] 允许 Feature 根作用域内的业务布局、图表/画布等领域样式和公共 Token 消费。
- [ ] 在 `test/view-style-contract.test.ts` 原路径新建正反例；build script 对正式 Module 与 Reference Module 统一执行。

完成标准：Reference Module 和正式 Module 均通过；每条禁令至少一条失败测试，每类合法自由正文至少一条通过测试。

## Task 6：将 Reference 接入正式 View

依赖：Task 3、Task 4、Task 5。

- [x] 将 Reference 注册为第四个 builtin Module，并由正式构建生成独立 bundle。
- [x] 正式 View 提供 Reference asset、`/reference` Route、boot instance 与一级导航入口。
- [x] 保留通用 development options 的安全精确映射测试，但 Reference 验收不再依赖该入口。
- [x] 使用 `npm run build` 与 `node dist/cli.js view restart` 复跑，在正式 View host/port 内验收。

完成标准：Reference 与其他 Module 真实通过 Loader/importmap 启动，并直接出现在正式 `memsphere view`。

## Task 7：从空目录搭建独立 Reference Module

依赖：Task 6。

- [x] 创建 `modules/org.memsphere.reference/module.json` 与 `adapter/view/index.ts`，只导入 `@memsphere/view-sdk`。
- [ ] 用 descriptor 注册一级导航、二级导航、Header；用 `ctx.ui.contentList()` 注册标准列表。
- [ ] 正文实现一个普通说明区和一个非模板化自定义交互区，只写 Feature 局部 CSS并消费公共 Token。
- [ ] 覆盖 loading、empty、selected、badge、filter、长文本及至少一个 Header action。
- [ ] 记录 `reference-module-build-log.md`：从空 Module 到运行所需命令、文件、公开 API、业务 CSS、步骤与耗时/摩擦；必要 workaround 数必须为 0。

完成标准：源码无 Shell 私有导入/选择器/覆盖；产品负责人能用一条命令复跑并直观看到“壳标准、正文自由”。

## Task 8：文档与 Memory 同步

依赖：Task 3、Task 4、Task 7。

- [ ] 更新 `docs/view-plugin-design{,.en}.md`、`docs/view-plugin-api{,.en}.md`、`docs/view-plugin-guide{,.en}.md`。
- [ ] 更新 `docs/view-slots.md`、`docs/view-slots.en.md`，明确 `content.list` 的标准 UI Mount、自定义 Mount 与无列表让位语义。
- [ ] 文档主路径从创建新 Module 出发，给出五层边界、最小复制示例、Theme/UI/Slot 公开 API 和禁止事项。
- [ ] 同步 `.memsphere/memory/concepts/memsphere-view.yaml` 与 `reserved-memory/system-memory/concepts/memsphere-view.yaml`；删除 Memory 原型即参考实现的旧说法。
- [ ] 检查是否有 System Memory 新增/重命名/删除；只有发生结构变化时同步 `reserved-memory/manifest.json`。
- [ ] 按实际公共指导变化同步 `src/skills/memsphere/SKILL.md`，不手改生成副本。

完成标准：Agent 仅阅读公开文档和 Reference Module 即可搭建页面；中英文、项目 Memory、reserved Memory 一致。

## Task 9：全量验证与可审查证据

依赖：Task 1–8。

- [ ] 形成六个旧 Run 修改测试文件与 master `2c2b1445` 的断言对照表；删除项仅对应被删除越界 Feature。
- [ ] 执行 `npm run typecheck`、全部相关 View/SDK/Module/browser 测试、`npm test`、`npm run build`、`memsphere validate`。
- [ ] 存在 Memory 差异时创建/更新对应 ChangeSet，执行 `memsphere memory change validate <change-id>`，记录 ID、状态与 View 入口。
- [x] 用 Playwright 在正式 View 的 Reference 页面完成桌面和窄屏导航、列表、筛选、Header action、自定义正文、Tab/Enter/Escape、reduced-motion 和 console 检查。
- [ ] 抽查 Memory、ChangeSet、Run、Settings 稳定 URL；保存桌面/窄屏截图或等价证据。
- [ ] 汇总 `implementation-and-verification.md`：任务对照、清理记录、Token 审计、测试结果、浏览器证据、已知限制和搭建摩擦。

完成标准：所有门禁通过、无阻塞问题，才能进入 Human 产品验收。

## Task 10：Human 产品验收与交付归档

依赖：Task 9。

- [x] 重启实际 Memsphere View，把同端口 Reference URL、复跑命令、搭建日志和验收重点交给 Human 产品负责人。
- [ ] Human 验收一级/二级菜单、Header、内容列表主要由声明数据完成，正文保持自由，必要 workaround 为 0。
- [ ] 对验收意见进行修订并重跑相关验证；Human 明确通过前不宣称完成。
- [ ] 在 `change.md` 记录验收结果、ChangeSet 证据与 `completed_at`，移除 active status。
- [ ] 将当前需求目录安全移动到 `changes/archive/completed/20260902-view-framework-standardization/`；目标已存在则停止。

完成标准：Human 验收通过，交付记录完整，需求已归档。

## 关键路径

`旧 Run 清理 → Theme 审计/收敛 → UI 服务 → 标准列表 → 样式门禁 → 预览管线 → Reference Module → 文档/Memory → 全量验证 → Human 验收与归档`
