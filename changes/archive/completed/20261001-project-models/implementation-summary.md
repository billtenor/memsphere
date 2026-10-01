# 功能实现摘要

本文件主体记录初次实现。试用后的树表、引用展示和 Slots 完整最新成果见 [交付报告第 2 轮](delivery-report-round-2.md)，逐项改动与验证历史见 [反馈修订](ui-hierarchy-revision.md)；旧测试数和评审状态仅属于当时版本。

Run：`run-20261001-054855z-53c67dce`；分支 `codex/project-models`；基线 `9766bdb6a85c42610a08fed1945a1e06303c5e98`。本轮实现对应产品第 2 轮已确认契约及三方已通过技术方案；尚未产品交付验收、stage、commit 或 push。

## 需求映射与关键路径

| 需求 | 实现与主要 diff |
| --- | --- |
| 可阅读 JSON 文件存储模型 | 新增 `src/project/models.ts`：通过现有 filesystem DataStore 装配 `models/json-schema/draft-07`，绑定同名元模型；ModelId 为含 `.json` 的相对路径。完整遍历分页，不新增封套、索引或编码。 |
| 元模型与业务 Runtime | 新增原子 `json-schema-metamodel` 扩展，target.model 匹配 Draft-07，引导不递归加载自身。复用 JSON Serializer 和 object 反射，保留全部 JSON 关键字，只反射声明的元信息字段。用本地 Draft-07 元模式校验，不拉取远端资源；业务 Runtime 仍使用现有 Factory 和类型边界。 |
| Project 目录配置 | Project schema、执行 config、配置 Draft 读写/归一化/校验/diff/CAS、新解析路径同步 `modelsDirectory`。默认目录按 Registry Project root 解析；绝对配置不拼接隐藏路径。设置页面显示基准和当前生效路径，支持确认保存、必填错误与放弃。 |
| 实际模型发现与读取 | 两个只读 Project HTTP API。每次读取磁盘配置、构造新宿主；Model 与原文共享一次字节快照。列表隔离非法 JSON/Schema，保留坏项；I/O 故障显式失败。Runtime 的现有精确依赖引用在宿主准备，不增加 HTTP 下载或别名规则。 |
| 完整目录与内置业务模型 | 抽取 `runModelBindings()`，Run 与模型浏览复用同一组四个实际 raw 业务模型。元模型不进入业务列表，原型样例不进入正式目录。 |
| 模型界面 | 新增正式 `org.memsphere.models`，一级“模型”、二级“全部模型”，复用公共 ContentList/Theme/UI。树表四列，object/array/数组元素逐级展开，父对象 required、键盘焦点、全部展开/收起；完整原文查看/复制，不重排 JSON。高级条件明确指向原始定义，raw 不伪造字段。 |
| Project 隔离与刷新 | 使用既有 Project 路由和 API 前缀。AbortController/generation 防止旧请求覆盖；卸载移除页面标记，取消请求；目录保存后刷新生效，无需服务重启、不搬文件。 |
| 双语与公共壳 | 新模块固定文案与设置双语；正式/原型 Home 卡片明确区分并本地化。桌面与 390px 窄屏，表格内部滚动、公共 Token/Feature 作用域。 |

没有修改 `src/data/api`；没有新增模型写 API、CLI、网页编辑或值实例管理；没有迁移 Run 状态、修改 Run 内容布局或改变既有 Store 公共协议。

## 本轮文件

- 新增存储/装配：`src/project/models.ts`、`src/data/extensions/json-schema-metamodel/index.ts`。
- 新增正式 Module：`modules/org.memsphere.models/module.json`、`adapter/view/index.ts`、`adapter/view/styles.ts`；共享树表 `modules/shared/model-definition.ts`。
- 产品原型：`modules/org.memsphere.model-prototype/module.json`、`adapter/view/index.ts`、`adapter/view/definition-tree.ts`；实现阶段改为使用共享树表并让出正式主导航。保留独立直接访问入口，Home 标识为“模型原型”。
- 装配/配置/API：`src/project/model.ts`、`src/project/run-data.ts`、`src/config.ts`、`src/config-management.ts`、`src/commands/view.ts`、`src/module/builtin-catalog.ts`、`src/data/extensions/index.ts`、`package.json`（扩展子路径导出）。
- 设置与语言：Settings Module 的 `adapter/view/index.ts`、`settings-view.ts`，`src/view/locales/zh-CN.ts`、`en.ts`。
- 新测试：`test/project-models.test.ts`、`test/data-json-schema-metamodel.test.ts`、`test/view-models.test.ts`、`test/models-builtin-view-browser.test.ts`、`test/model-prototype-tree.test.ts`、`test/fixtures/project-model-view.ts`。
- 既有测试：`test/config-management.test.ts`、`module-manifest.test.ts`、`view-browser.test.ts`、`view-host.test.ts`、`view-style-contract.test.ts`；`artifact-review-browser.test.ts` 仅修正保存后按钮被移除时的测试辅助函数竞态，角色在点击前读取，不减少断言或改变产品代码。
- 文档：`README.md`、`README.en.md`、`src/data/README.md`、`src/data/extensions/README.md`、`src/data/management/README.md`、`src/skills/memsphere/SKILL.md`；本需求的契约、方案、计划、实现/验证记录及 `assets/` 产品原型和实现截图。
- Memory：`reserved-memory/system-memory/concepts/memsphere-framework.yaml`、`memsphere-view.yaml`，以及 `.memsphere/memory/concepts/` 的两个同名开发副本；未新增身份，不修改 manifest。

预先存在的 `.vscode/`、`review-summary.md` 不属于本轮，未修改或提交。浏览器临时日志不纳入交付文件。

## 已执行验证与修正

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 受影响测试组 79/79 通过；专属元模型及 Project 模型模块测试 11/11 通过；最终模型真实 View 集成测试 14/14 通过。
- 初始 `npm test`：822 项，821 通过、0 失败、1 项既有 Windows-only 测试在 Linux 跳过；实现评审第 2 轮修订后重新完整运行：824 项，823 通过、0 失败、同一项跳过，新增模型修订测试组 13/13 通过。Windows/macOS 原生执行未在本机完成，不将可移植 API 和回归覆盖声明为三平台实跑。
- 开发期间全量回归发现：模块数量仍写死为 4、原型使用非标准 `gear` 图标；已更新为明确 Catalog 等价断言和标准 `gear-six`。真实浏览器发现公共列表空说明非法、卸载页面标记残留，均已修复并补回归。
- 一轮回归出现既有 Artifact Review 保存测试竞态：成功会移除编辑器，辅助函数在点击后查询消失的按钮。独立复现路径及代码检查定位后，仅将角色查询移到点击前，最终全量通过；没有通过跳过/删除断言来解决。
- playwright-cli 在隔离 on-disk Home 的实际 View HTTP 服务、生产 Shell 和正式 Modules 操作，不使用静态页/模拟 API 替代核心功能。桌面、窄屏、字段展开/焦点、筛选、原文/复制、坏项、故障重试、卸载重挂载、设置保存/放弃、真实 Home 语言保存均有操作证据。故障重试检查中的 503 为明确注入，非正常产品错误；pageerror 为 0。没有改用户 Home 语言或模型目录。
- 已查看实现截图：`assets/models-implementation-desktop.png`、`models-implementation-mobile.png`、`models-implementation-mobile-fields.png`、`models-implementation-settings.png`、`models-implementation-english.png`。

## Memory 门禁

实现评审第 2 轮另修正原文 BOM 保留、宿主提前 URL 异常；保留现有业务编译器拒绝相对 `$id` 的边界，未扩展子集。新增两项回归，意见核对与验证见 `implementation-revision-2.md`。

`memsphere validate` 与 `memsphere memory change validate change-20261001-065614910z-18de9f8c` 均通过。源文件与开发副本 `cmp` 一致。

- ChangeSet：`change-20261001-065614910z-18de9f8c`，active，validation passed。
- 最终 Content Digest：`59d901b23ad5a33cb2e5c94652e040716c9fdd07c4d921b1c3b007aebb1a9cb2`。
- View：`http://127.0.0.1:30000/projects/memsphere/changes/change-20261001-065614910z-18de9f8c`（CLI 监听地址显示为 0.0.0.0，浏览器用可访问主机）。

## 行为、兼容性与未验证项

遵循契约“不需要向前兼容”：不加迁移或旧格式分支；原配置省略可选字段采用默认值，Memory/Run/Review/Settings 既有行为受全量回归保护。业务 JSON Schema Runtime 仍是已有支持子集，不把元模式合法或可阅读等同于支持全部反射能力。文件系统 list 仍全量扫描，不建设索引。

尚未完成：三方实现评审、产品负责人交付验收、Git 提交及需求归档；原生 Windows/macOS 执行。云存储、模型编辑、实例持久化/查询与 Run 状态建模属于后续范围。

采用 `statements/memsphere-repository-development-rules` 的避免过度设计、公共边界、System Memory/Skill 同步；采用 `testing-rules` 的最低适用层级、独立可观察契约、实际状态等待、真实浏览器、完整回归和 Memory 双门禁；采用 `requirement-rules` 的已确认范围与兼容性结论。
