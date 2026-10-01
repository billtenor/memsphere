# Project 模型存储与模型界面：交付报告（第 2 轮）

Run：`run-20261001-054855z-53c67dce`。分支：`codex/project-models`。基线：`9766bdb6a85c42610a08fed1945a1e06303c5e98`。

本报告完整替代第 1 轮交付候选，包含 Human 试用确认的树表修订和模型展示 Slots。第 1 轮不可变 Submission、意见和投票保留，不将旧通过票视为已评审这些新增调整。当前是重新提交产品验收，不是宣称交付完成。

## 交付内容

### 模型定义存储与项目配置

- 每个 Project 通过现有 filesystem DataStore 存储 JSON Schema Draft-07 定义，绑定元模型 `json-schema/draft-07`，StoreId 为 `models/json-schema/draft-07`。默认目录是 Registry 登记的 Project 根目录下 `models/json-schema/draft-07`；模型 ID 是 `sales/order.json` 这类包含扩展名的相对路径。
- 一份定义保存为可读 JSON 文件，不增加封套、编码、索引或存储格式迁移。模型定义和展示原文共用一次字节快照，保留原文件空白、BOM、CRLF。
- 独立 Draft-07 元模型扩展完成引导；模型加载及 Runtime 准备复用 DataManager、JSON Serializer 和现有业务 Factory。可浏览的合法定义不等于现有 Runtime 支持完整 JSON Schema 语义。
- 项目设置提供 `modelsDirectory`，支持默认、相对及绝对目录，明确显示解析基准和生效位置。相对目录按 Project root 解析，不按工作目录或 Git worktree 解析；切换只改变使用位置，不搬文件。保存确认、校验、放弃和刷新生效复用既有配置机制。
- 正式只读列表及定义 API 隔离 Project；完整读取分页，单项坏定义保留错误项而不阻断其他模型。目录 I/O 错误明确暴露。列表包括持久化定义和四个真实内置 raw 业务模型，不混入元模型或原型演示模型。

### 正式模型界面与试用修订

“模型”与记忆、运行并列，采用现有 Shell、ContentList、Theme/UI；详情不提供 Project 模型存储设置入口。支持 ID/名称筛选、刷新、选中 URL、空/错误状态、重试、双语、窄屏及卸载清理。

当前树表是字段 / 结构、类型、格式、规则、说明五列：

- 对象根省略冗余容器行，直接展示字段；数组或标量根保留 `[根结构]` 和真实根类型。内部对象、数组和嵌套结构保留。
- 固定缩进、同宽按钮占位、小方框 `+ / −` 和紧凑行距，不画连线。同层字段对齐；数组元素用 `[元素结构]`，与实际字段区分。
- 显式 `additionalProperties` 以 `[动态字段]` 与固定字段同层展示，表示名称可自定义的一类字段；类型描述其值类型，对象/数组值可继续展开，不伪造固定字段名或必填。
- 格式列独立展示 `format` 以及从 `enum` 提取的候选值；枚举按显式类型显示文本枚举、整数枚举等，不依赖作者 description，不做隐式数据转换。
- 规则列展示相对所属对象的必填和实际限制，不显示可选。true 子模式类型为 `—`、规则为“无限制”；false 字段为“不允许存在”，非字段 false 子模式为“不允许任何值”。真实布尔数据类型不受影响。矛盾规则如实保留，说明列只显示作者 description。
- anyOf/oneOf 的类型是候选摘要，展开为 `[类型1]`、`[类型2]`，各分支独立展开且不合并字段/必填。匹配区别只在规则列展示本地化的“至少满足一个分支 / 恰好满足一个分支”。
- 同文档本地引用直接展示目标类型、字段、格式及枚举，并保留引用来源。支持引用链、JSON Pointer 转义/片段编码和同文档绝对 `$id`；递归只手动逐层展开，全部展开不越过递归边界。缺失、非法、纯别名循环、跨模型及嵌套 `$id` 作用域明确提示边界，不联网、不伪造结果，不合并 Draft-07 `$ref` 同层校验关键字。
- 取消复制定义按钮、空占位行、通用操作说明、整体定义摘要和自动“详见原始定义”提示。“全部展开 / 全部收起”是右侧文本按钮，保留键盘和焦点。原始定义独立完整展示，切换后保留树展开状态；if/then/else 不新增可视化解释。

共享展示用于正式模块和独立原型；展示能力不改变数据层反射接口、业务 Runtime 或校验语义。此前按 Human 请求创建的覆盖类型/嵌套试用模型保留在当前 Project，实际内容及清单见 `use-case-models.md`；它们不是系统自动安装的内置定义。

### 模型展示扩展

补齐与记忆/运行一致的两个 portable cells：

| 可替换位置 | Cell |
| --- | --- |
| 模型详情整体页面 | `org.memsphere.models.page.presentation@1:page` |
| 模型结构或原始定义正文 | `org.memsphere.models.definition.renderer@1:definition` |

全局“设置 → 界面与主题”提供两层独立选择，复用候选、显式系统默认、失败回退和扩展样式机制，中英文目录同步。当前可配置目录共 22 项。

页面扩展通过官方 `presentation.modelsPage()` 读取冻结的列表/定义、刷新和导航；业务 API、路由及存储仍由框架管理。正文扩展接收冻结模型、structure/source 和 `defaultRender()`，既可保留内置展示并包装样式，也可自行渲染。两种视图缓存各自正文，内置列表不依赖默认详情页启动；项目隔离和卸载生命周期受回归保护。

## 本轮修订与代码路径

Human 第 1 轮正式要求：汇总试用后的树表和 Slots，替换旧交付材料并重报。本报告和 `delivery-revision-summary.md` 已落实该意见。

- 存储/元模型/配置：`src/project/models.ts`、`src/data/extensions/json-schema-metamodel/index.ts`、`src/project/model.ts`、`src/config.ts`、`src/config-management.ts`、`src/commands/view.ts`。
- 正式界面/共享树表/原型：`modules/org.memsphere.models/adapter/view/`、`modules/shared/model-definition.ts`、`modules/org.memsphere.model-prototype/adapter/view/`。
- Slots 公共契约与装配：`src/view/view-sdk.ts`、`src/view/package-config.ts`、`src/view/view-runtime.ts`；配置入口与双语在 Settings Module 和 `src/view/locales/`。
- 自动化：元模型、Project 模型、View API、树表及真实浏览器测试；新增 `test/models-view-slots-browser.test.ts`，加强 SDK、Package 配置/浏览器和双语文档回归。完整新增/修改文件分类见 `implementation-summary.md`，试用逐项处置、截图与验证历史见 `ui-hierarchy-revision.md`。
- README、数据实现文档、六份双语 View 扩展文档、System Memory 源与两个开发副本、Skill 同步。未新增/移动 Memory 身份，manifest 不变。

没有修改 `src/data/api`、Run 状态或 Run 文件布局，没有新增模型写 API、网页编辑器或模型 CLI。既有 `.vscode/`、`review-summary.md` 不属于本轮，`.playwright-cli/` 日志也不纳入交付。尚未 stage、commit、push 或归档需求。

## 实际验证与执行范围

试用后的每次代码修订均实际执行受影响回归及完整测试，不拿第 1 轮结果代替新代码验证。Slots 最终受影响组为 10 套件 108/108，追加配置/文档组 5/5；全量 npm test（含构建）858 项：857 通过、0 失败、1 项既有 Windows-only 在 Linux 条件跳过。typecheck、build、diff check、Project validate 与最终 Memory ChangeSet validate 通过。2026-10-02 重报前再次执行的结果记录在本报告补充验证节；未修改实现代码。

playwright-cli 已实际操作当前正式 Project 的树表、用例联合/枚举/规则、本地引用/递归、原始定义、键盘、390px 窄屏、展开收起及卸载。Slots 在当前 Project 核对 SDK 注册和默认展示，在隔离 on-disk Home 的真实 ViewHost/Modules 验证自定义正文、全局样式、原文切换、展开状态、配置双入口与所选贡献和卸载，最终 pageerror/console error 为 0，截图已查看。实际 Home Settings 受既有操作令牌保护，未读取令牌或改用户配置，配置操作由隔离 Home 验证。临时会话及服务器已关闭。

最新截图：`assets/model-no-generated-hints.png`、`assets/model-local-references.png`、`assets/model-definition-slot-extension.png`、`assets/model-slots-settings.png`；早期截图及数字是历史记录，不代表当前候选。

测试修正没有降低标准：异步卸载等待实际清理而非只等 URL；新配置目录断言由 20 改为 22；下拉向上展开测试明确把控件定位到底部并保留几何断言。早期验证脚本定位错误、临时扩展 Manifest 字段错误及构建期间 CLI 暂不可用均已按实际协议修正或原命令重试，未增加产品兼容分支或跳过测试。原生 Windows/macOS 未实跑，不能把 Linux 的成功说成三平台验证。

### 2026-10-02 重报前复核

| 实际执行 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，exit 0。 |
| `npm test`（含 pretest 构建，允许真实浏览器/HTTP/子进程的宿主环境） | 858 项，857 通过、0 失败、1 项既有 Windows-only 跳过，exit 0。 |
| `node dist/cli.js validate` | Project Store 校验通过。 |
| `node dist/cli.js memory change validate change-20261001-065614910z-18de9f8c` | passed，digest 与下文最终证据一致。 |
| `git diff --check`、两份 System Memory 的源/副本 `cmp` | 通过。 |

本次只修订评审文档和提交票，没有新增实现修改。第一次在沙盒内运行全量测试，26 个文件级套件失败；直接复现模型 Slots 集成套件得到 `listen EPERM: operation not permitted 127.0.0.1`，属于受限执行环境，不能将其隐藏为成功。同一 `npm test` 在允许 HTTP/浏览器/子进程的宿主环境完整重跑得到上述通过结果，不删测试、不改断言。构建重建 dist 时并行的第一次 Project validate 暂找不到 CLI，构建后使用同一命令重试通过。日志：`/tmp/memsphere-model-review-final-test.log`（受限）、`/tmp/memsphere-model-review-sandbox-diagnostic.log`（EPERM 复现）、`/tmp/memsphere-model-review-final-test-host.log`（最终完整通过）。原生 Windows/macOS 仍未执行；本次不把此前实际浏览器操作冒充当天重新执行。

## 评审与验收结论

需求/原型和技术方案已确认。实现 Review `review-20261001-071900z-a1fe7c7d` 两轮，最终 `round-20261001-072543z-6ed381b7` 三位实际 ACP Reviewer 均提交，Runner 正式通过；测试、架构通过，研发要求 `$id` URI 别名映射。Runner 依已批准方案“不新增别名解析器”记录 rejected-out-of-scope，并补实际反例测试，不能称三方一致通过。

以上实现评审发生于后续试用修订之前，不声称这些旧票已经审查新树表或 Slots。其后调整是 Human 已确认的同一迭代展示修订，并有新增回归、全量测试和实测证据；本轮产品 Reviewer 应审查本报告、修订摘要、实际工作区及验证，而不是照搬旧结论。

交付 Review `review-20261001-073226z-3ba4727a` 第 1 轮：产品 Agent 通过，Human 要求修改，已按授权正式提交 1 条意见。本报告用于同一 Review 第 2 轮，等待重新评审与 Human 正式验收；不复用旧通过票，不代投下一轮。验收通过后按交付规范记录完成时间、归档需求，再进入 commit；是否创建 PR 由 Human 决定。

## Memory 最终证据

- ChangeSet：`change-20261001-065614910z-18de9f8c`，active、validation passed。
- Base：`9766bdb6a85c42610a08fed1945a1e06303c5e98`。
- Content Digest：`c085756a7ddfb91552e7532ff98d695f7f074ecef61129b8c2e9dabe03a7d4ab`。
- View：[Memory 候选](http://localhost:53583/projects/memsphere/changes/change-20261001-065614910z-18de9f8c)。源/开发副本一致；重报前针对最终内容重新校验，普通 validate 不替代变更级门禁。

## 后续范围与残余问题

模型分域留待本轮结束后讨论，不新增分域字段。本轮不包括网页创建/编辑、数据值实例管理、Run 状态建模、完整 JSON Schema Runtime、跨模型展示自动加载、URI 别名/网络解析、索引、迁移或云存储。文件系统列表仍扫描目录，不承诺超大目录索引性能。原生 Windows/macOS 未验证风险继续保留，需后续跨平台 CI 或实机冒烟；当前无已知范围内阻塞实现问题，最终产品验收尚未完成。

试用：[正式模型](http://localhost:53583/projects/memsphere/models)、[项目模型存储](http://localhost:53583/projects/memsphere/settings/models)、[界面与主题](http://localhost:53583/projects/memsphere/settings/appearance)。设置沿用既有权限门禁。
