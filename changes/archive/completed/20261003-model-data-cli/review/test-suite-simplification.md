# 测试套件精简复查

本轮按 `memsphere-repository-testing-rules` 整理测试，基线是 PR #85 的 `34df4fd7656bfb7ea75956c31581515250c7f9bb`。产品行为、Node 22、原有五个 CI job 和串行配置不变。本轮只修改测试、测试夹具及此复查记录；没有 Memory 差异，不创建空 ChangeSet。

## 检查依据与范围

基线有 134 个测试文件、1003 个静态 test 声明；参数化后上轮 CI 实际运行 1074 项。按文件列出公开契约和执行边界线索，优先检查 CLI、Git、浏览器及计时等待，再检查进程内规则和源码字符串断言。声明数不是执行数，正则提取的边界线索也不等于测试分层：通过 helper 启动的进程必须继续按集成测试处理。

遵守规范的对应处理：

- 同一公共契约的组合覆盖放在最低有效层；CLI/浏览器保留真实接线和失败边界。
- 前置条件中不被测的 Project、模型和数据写入通过 Store/API/helper 构造。Project 创建、bootstrap、包交付和 Git 真实故障本身仍调用原流程。
- 拆开互不相关的主要失败含义；连续 CRUD 或发布流程本身是一条公开生命周期契约的测试仍保留。
- 浏览器在测试文件的 before hook、尚未切换到临时 cwd 时启动并共享 Chromium 进程，每个 page/context、服务、目录和配置仍独立，作用域结束即关闭 context，文件结束关闭进程；不共享 localStorage、登录态或可变业务夹具。
- 等待实际可观察状态，并为故意悬挂的响应提供显式释放点；负向验证窗口和竞争等待的失败上限仍保留。
- 不通过 skip、重试、放宽断言、提高并发或延长 timeout 避开失败。原有平台 skip 保留。

## 覆盖迁移和精简

| 原来的成本或重复 | 当前覆盖 | 保留的真实边界 |
| --- | --- | --- |
| `cli-output-format` 的输出组合启动 67 次 CLI | `cli-presentation` 在进程内覆盖全部 JSON 根类型、特殊字符串、YAML 往返、默认输出及两种错误输出；输出集成测试启动 30 次 CLI | 三类 read/list 的三种输出，JSONPath null，三类 dry-run 的只读性，以及六种业务/参数错误 |
| 翻页测试通过十次非被测 CLI 调用初始化和写入 | 用 `mutateModel`、`createBusinessStore`、`writeData` API 设置已有对象 | 三类 list 的续页、顺序、过滤、游标作用域和格式收据；畸形 Store 配置独立检查 |
| 浏览器重复展示多种不支持的 schema | `model-unavailable` 的 19 个独立模块场景保留原 schema、错误、catalog unavailable 和读取拒绝，并检查原始文件/目录未改写 | 浏览器保留跨模型引用和 format 各一个真实案例，以及 API 422、不可用提示、正常模型仍可用和源文件原样 |
| 每个 browser scope 都启动 Chromium | `helpers/browser` 统一进程生命周期，每个测试 scope 使用独立 context | 原页面、交互、跨 Project 隔离、草稿隐私、故障隔离测试仍使用真实 Chromium |
| Memory CLI、系统模型创建和一个 Data dry-run 每次加载源码及 tsx | 普通命令启动 `dist/cli.js` | 同样的真实 CLI、退出码、stdout/stderr、stdin、目录和文件断言；专门注入 IPC 的 worker 保持源码入口 |
| Market、ChangeSet、Run 和修复测试反复执行不被测的完整 Project bootstrap | `helpers/project` 直接构造已有健康 Managed Store，使用真实登记 API、系统 Memory、独立 Git 仓库和 registry | Project 生命周期/创建/bootstrap 及 Embedded 创建测试保留原入口；市场导入、发布、候选快照和修复仍走真实被测操作 |
| 一个模型命令测试混合系统只读、错误 ID、错误输入和数据检查 | 将这些独立失败含义拆成命名测试，另拆开 Store 绑定保护与 check-data | 原 CLI 场景、错误码、stdin 未消耗和文件未保存断言全保留 |
| View Shell 断言内部监听器和函数源码；View 断言插件 source token、完整路由数组和私有 summary 函数源码 | 保留 SSR 可访问控件/宽度范围及公开路由接受/拒绝；用真实 summary API 验证正文损坏时仍列出正确头部，而完整读取返回局部错误 | `view-responsive` 的真实拖动、键盘、复位、reload 持久化；`view-host` 实际提供编译产物、模块启动和目录顺序；`memory-store` 头部读取规则 |
| 搜索 old/new 响应依赖 400/20ms 和固定 230ms 等待；下一个 Mount 依赖 250ms | 显式等待 old 查询已启动或 Mount 已准备，再由测试释放 Promise；忽略 old 的 abort 以验证 Host 仍拒绝迟到结果；pagehide 等待 DOM 消失 | 原 stale/abort/错误隔离、页面过渡和清理行为，取消对机器速度的依赖 |

保留的边界包括：跨进程文件锁及进程退出、目录回滚和失败原子性、真实 Git/worktree、符号链接及路径越界、CLI stdin/协议、包内实际发布资产、HTTP origin/权限、浏览器路由/交互/隔离。SDK 类型消费、清单/文档/安装同步和样式约束测试属于明确的公开兼容或仓库规则检查，不能因为读取源码就一概删除。纯规则、serializer、reflection、pagination、JSONPath/JSON Patch 等进程内测试已经位于有效的低层，未为降低项数而删掉。

## 验证与测量

首个精简提交 `f415ab2` 的本地基准使用同一台本地机器、Node 22.16.0、`--test-concurrency=1`，不同时运行另一批重型测试。基线四个文件为 output-format、list-pagination-cli、memory-cli 和 models-builtin-view-browser：52 项通过、159.851 秒。精简后同一组公开契约及新下移的 presentation/model-unavailable 覆盖：75 项通过、111.991 秒，约减少 30%。执行项数增加是因为独立场景拆开，并不代表浏览器/CLI 启动成本增加。

其余受影响的 20 个文件 166/166 通过（184.014 秒），包括全部实际浏览器隐私、跨 Project、组合、响应式和故障隔离场景。受健康 Store 夹具变更影响的六个文件 41/41 通过（47.671 秒）；model-unavailable 与现有 model-validation 合计 24/24 通过（1.145 秒）；新的 summary HTTP 行为 3/3 通过（0.827 秒）。公共 helper 和 presentation/summary 测试的独立严格类型检查通过。跨机器 CI 耗时受 runner 波动影响，不用局部测量承诺整个套件固定降幅。

最终在 Node 22.16.0 执行 `npm run typecheck` 通过；`npm test -- --test-concurrency=1` 的 pretest 完整执行 `npm run build` 通过，随后全量 1100 项测试：1099 通过、0 失败、1 项原有 Windows 专属 skip，耗时 475.172 秒（7 分 55 秒）。`node dist/cli.js --project memsphere validate` 通过。独立严格类型检查覆盖新增公共 helper、presentation 和 summary API 测试。`git diff --check` 通过，已批准的需求、实施计划、验收和交付文件四份原件摘要未变。

CI 验收要求仍是本提交在 [PR #85](https://github.com/billtenor/memsphere/pull/85/checks) 的原有五项全部成功；结果以 GitHub 当前提交的检查记录为准，不沿用基线绿灯，也不为填写检查结果另造一个需要再次跑 CI 的提交。

## 全套文件清单

下表记录基线文件的静态声明数、一个代表契约、直接源码可见的边界线索及处理。所有未修改文件进入最终全量回归；“保留”不表示跳过执行，也不表示把含 helper 的集成测试当成单元测试。

| 文件 | 声明数 | 代表契约（其余见文件内命名测试） | 直接边界线索 | 处理 |
| --- | ---: | --- | --- | --- |
| `test/agent-activity.test.ts` | 4 | Agent Activity keeps complete raw ACP updates while exposing a filtered projection | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/agent-review.test.ts` | 18 | ACP Agent Reviewer completes its bound Assignment through the Session CLI | service、git | 保留原公共契约/必要边界 |
| `test/archive-run-data.test.ts` | 9 | Run archive and restore transfer opaque Store content without list or local content paths | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/archive-store.test.ts` | 5 | archives and restores done run directories | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/archive-worker-guard.test.ts` | 5 | archive permits transfer only after every recorded Worker PID is confirmed absent | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/artifact-format-fixtures.test.ts` | 1 | Artifact format fixture ${fixture.id} produces the expected validation result | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/artifact-migration.test.ts` | 6 | Artifact Contract v2 migration stages, backs up, validates, and is idempotent | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/artifact-review-browser.test.ts` | 18 | Human Artifact Review keeps each participant's draft private | browser、service、git | 按上表精简；原公共契约保留 |
| `test/artifact-review-view.test.ts` | 3 | Artifact Review View API isolates drafts and settles the Run once | browser、service | 按上表精简；原公共契约保留 |
| `test/artifact-review.test.ts` | 7 | Artifact Review merges Slots and creates Human and Agent assignments | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/artifact-validation.test.ts` | 17 | Artifact v2 defaults omitted type and format to normalized string and plain | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/builtin-memory-view.test.ts` | 4 | Memory builtin independently registers its route pages and renders Memory detail | browser、service | 按上表精简；原公共契约保留 |
| `test/builtin-run-view.test.ts` | 1 | Run builtin renders a deep-linked Run and opens its Artifact Review | browser、service | 按上表精简；原公共契约保留 |
| `test/business-data-service.test.ts` | 21 | business ValueStores preserve each JSON root type through CRUD and candidate validation | process、git | 按上表精简；原公共契约保留 |
| `test/ci-workflow.test.ts` | 1 | CI bounds and supersedes cross-platform browser test runs | browser | 保留原公共契约/必要边界 |
| `test/cli-errors.test.ts` | 3 | JSON errors are selected even when an earlier argument stops Commander parsing | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/cli-output-format.test.ts` | 4 | actual model/data/Store reads use YAML text by default and preserve special strings and nested JSON values | process | 按上表精简；原公共契约保留 |
| `test/config-management.test.ts` | 12 | global and Project config documents have independent revisions and drafts | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/config.test.ts` | 1 | legacy Scope config and split roots are not accepted | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/control-plane.test.ts` | 6 | built-in control plane catalogs are complete and reject unknown ids | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-command.test.ts` | 12 | data CLI creates from stdin, reads/updates/edits complete values and returns explicit identities | process | 保留原公共契约/必要边界 |
| `test/data-extension-registry.test.ts` | 12 | extension registry is empty by default and missing capabilities return undefined | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-extensions.test.ts` | 3 | built-ins expose five independently selectable single-capability extensions | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-filesystem-datastore.test.ts` | 23 | filesystem extension supplies one independent DataStore factory | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-filesystem-helpers.test.ts` | 24 | stream cancellation interrupts a stalled read even when source cancellation never settles | process | 保留原公共契约/必要边界 |
| `test/data-filesystem-json-valuestore.test.ts` | 15 | filesystem JSON ValueStore is one independent ValueStore factory | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-filesystem-open.test.ts` | 3 | ${kind} openExisting and empty reads do not create directories or lock metadata | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-filesystem-process.test.ts` | 8 | independent creators commit exactly one complete record | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-filesystem-revisions.test.ts` | 6 | deletion history I/O failure preserves the original record and revision | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-interfaces.test.ts` | 2 | data and reflection interfaces typecheck for consumers, including rejected protocol shapes | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-json-schema-metamodel.test.ts` | 4 | metamodel bootstrap retains complete advanced definitions while reflecting only declared metadata | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-json-schema.test.ts` | 14 | JSON Schema is an independent meta-model-targeted extension with stable descriptor identities | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-json-serializer.test.ts` | 15 | JSON serializer extension registers one independent capability | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-manager.test.ts` | 19 | DataManager constructs lazily and coalesces concurrent runtime and value store preparation | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-plain-reflection.test.ts` | 15 | Map reflection rejects overridden operations without invoking user hooks | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-preparation.test.ts` | 11 | preparation shares pending work and caches successful result identity | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/data-raw.test.ts` | 8 | raw is an independent, meta-model-targeted Runtime extension without storage or serialization | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/default-content-style.test.ts` | 3 | Memory uses the system content style by default | browser、service | 按上表精简；原公共契约保留 |
| `test/embedded-changeset.test.ts` | 2 | Embedded validation checkpoints linked-worktree changes without changing the main worktree | browser、service、git | 按上表精简；原公共契约保留 |
| `test/example-relocation.test.ts` | 4 | historical examples are rejected before planning or moving bytes, with no legacy reference exception | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/file-lock.test.ts` | 4 | native lock timeout cannot steal a live process's permanent coordination file | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/file-memory-provider.test.ts` | 2 | file provider lists summaries and reads only ids from the current list | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/git.test.ts` | 5 | gitHashObject hashes the exact bytes supplied on stdin | git | 保留原公共契约/必要边界 |
| `test/home.test.ts` | 3 | resolves platform-native Memsphere Home paths | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/json-patch.test.ts` | 5 | JSON Patch applies all six operations to one isolated document in order | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/json-path.test.ts` | 4 | JSONPath always returns a nodelist and preserves null, nested arrays, duplicates and selector order | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/list-pagination-cli.test.ts` | 7 | project list pages all registered Projects and binds cursors to the Home and Workspace | process、git | 按上表精简；原公共契约保留 |
| `test/market-changeset.test.ts` | 8 | Managed Market import stays inactive until publish completes its ChangeSet | git | 按上表精简；原公共契约保留 |
| `test/market-store.test.ts` | 8 | market import plans only the selected Memory when it has no explicit Memory references | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/market-view.test.ts` | 5 | Memory Market View API aggregates imports and exposes their active ChangeSet | service、git | 按上表精简；原公共契约保留 |
| `test/memory-catalog.test.ts` | 10 | catalog lists stable public descriptors without reading bodies | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-changeset-collaboration.test.ts` | 2 | View ChangeSet records attribution and drives flat Comment claim lifecycle | git | 按上表精简；原公共契约保留 |
| `test/memory-changeset.test.ts` | 5 | Managed ChangeSet publishes atomically and enforces target CAS | git | 按上表精简；原公共契约保留 |
| `test/memory-cli.test.ts` | 10 | memory change validate checks the effective Store without expanding a sparse candidate | process、git | 按上表精简；原公共契约保留 |
| `test/memory-command.test.ts` | 8 | memory list defaults to YAML and forwards filters | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-navigation.test.ts` | 6 | node pages preserve declaration order and reject a cursor from another parent or Run | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-references.test.ts` | 7 | reference validation resolves canonical logical references | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-rules.test.ts` | 4 | rule resolver projects only the selected channel and preserves section hierarchy | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-schema.test.ts` | 22 | name is a canonical single-value shorthand for names | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-serializer.test.ts` | 5 | YAML serializer round-trips ${entity.tag} | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-store.test.ts` | 10 | listMemoryFiles treats any missing memory kind directory as empty | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/memory-sync.test.ts` | 1 | Memory sync creates merge commits and isolates conflicts in a Sync ChangeSet | git | 保留原公共契约/必要边界 |
| `test/memory-syntax.test.ts` | 11 | Memory syntax defaults to start and formal versions use immutable identifiers | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-asset-checkout.test.ts` | 1 | Git autocrlf checkout preserves released model JSON and approved originals byte for byte, including BOM and original line endings | process | 保留原公共契约/必要边界 |
| `test/model-browser-state.test.ts` | 4 | Project unpackaged scope excludes system and imported models, even when a package ID is shared | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-command.test.ts` | 6 | actual model CLI resolves the Registry Project and preserves stdin definition bytes through CRUD | process | 按上表精简；原公共契约保留 |
| `test/model-market-package.test.ts` | 1 | Packed distribution creates canonical persistent system models and rejects unsupported import and historical relocation | service、process | 保留原公共契约/必要边界 |
| `test/model-market.test.ts` | 11 | The retired order package is absent from the market while published historical imports and their bytes remain usable | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-operation.test.ts` | 9 | Model writes through an aliased Project root target the same physical Project | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-prototype-tree.test.ts` | 14 | prototype table preserves separate array and array-element levels | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-registration-browser.test.ts` | 4 | Models combine package scope, exact tags and managed search and restore search from URL | browser | 按上表精简；原公共契约保留 |
| `test/model-registration.test.ts` | 8 | Empty registry stays empty until explicit initialization installs its persistent system models | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-schema-references.test.ts` | 5 | Every Draft-07 schema position rejects cross-model references while ordinary annotation data stays opaque | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-service.test.ts` | 12 | model CRUD preserves definition bytes, registration identity and omitted metadata | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-storage-paths.test.ts` | 2 | Project-root scanning prunes every configured registry, backups and retained directories before model reads | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/model-validation.test.ts` | 5 | Candidate checking distinguishes invalid definitions from unsupported Runtime constraints with model and location | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/models-builtin-view-browser.test.ts` | 31 | model structure omits generated reading hints while preserving authored descriptions, actual rules and full source | browser | 按上表精简；原公共契约保留 |
| `test/models-view-slots-browser.test.ts` | 5 | selected definition renderer receives frozen model data and can wrap the official tree and source without replacing navigation | browser | 按上表精简；原公共契约保留 |
| `test/module-manifest.test.ts` | 6 | Builtin Catalog declares immutable and uniquely identified Modules including the product prototype | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/package-release.test.ts` | 2 | npm package preserves the memsphere first-use bootstrap contract | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/pagination.test.ts` | 5 | list limit defaults to 100 and rejects values outside the integer 1–1000 contract | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/persistence.test.ts` | 8 | directory replacement commits new content only after preparation succeeds | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/product-positioning.test.ts` | 6 | README, System Memory, and Skill share the personalized software positioning | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/project-command.test.ts` | 19 | Project lifecycle keeps creation separate from Workspace binding | git | 按上表精简；原公共契约保留 |
| `test/project-memory-provider.test.ts` | 2 | Project Memory provider annotates sources and rejects cross-Project ambiguity | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/project-model-registration-cli.test.ts` | 1 | project models initialize CLI resolves the explicit Project, persists defaults and retains repeat metadata | process | 保留原公共契约/必要边界 |
| `test/project-models.test.ts` | 10 | Project model definitions remain readable files and load through the metamodel into business reflection | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/project-registry.test.ts` | 3 | project names are readable stable identifiers | git | 保留原公共契约/必要边界 |
| `test/project-resolver.test.ts` | 2 | Embedded Projects resolve workspace Memory for CLI and canonical Memory for View | git | 保留原公共契约/必要边界 |
| `test/prompt-renderer.test.ts` | 9 | Prompt registry has paired assets for every supported locale | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/report-execution.test.ts` | 6 | Report execution probe resolves Linux runtime directories | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/reserved-models.test.ts` | 6 | Reserved model assets use canonical identities and retain eight examples with a self-contained recursive model | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/reserved-store.test.ts` | 10 | bundled memory contains a valid self-bootstrap chain and manifest | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-abandonment-view.test.ts` | 1 | View abandons a running Run without auto-archiving it | service | 保留原公共契约/必要边界 |
| `test/run-changeset.test.ts` | 2 | Managed Run can start from a validated active ChangeSet without publishing it | git | 按上表精简；原公共契约保留 |
| `test/run-command.test.ts` | 21 | run start command rejects missing, blank, and control-character names | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-data-access.test.ts` | 8 | Review candidate and frozen context use portable DataIds and preserve readable files and export bytes | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-memory-backfill.test.ts` | 2 | Standalone manifest tool only adds a missing field, check is read-only and redo is unchanged (legacy=${legacy}) | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-model-storage.test.ts` | 5 | Normal Project config selects the persisted raw definition without changing original content bytes | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-output.test.ts` | 4 | Run output scenes select stable Prompt compositions | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-rule-integration.test.ts` | 1 | Run freezes Statement projections and renders source and section groups | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/run-start-cli.test.ts` | 1 | run start CLI accepts all skipped Review Slots without a control plane | process、git | 保留原公共契约/必要边界 |
| `test/run-store.test.ts` | 65 | Runner delegated Human review submit records provenance and is idempotent after settlement | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/runner-delegated-review-cli.test.ts` | 1 | submit-for-human CLI writes delegated opinions and returns JSON/text receipts | process、git | 保留原公共契约/必要边界 |
| `test/schema-contract-migration.test.ts` | 4 | Schema Contract v2 migration stages, backs up, and removes contextual element_types | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/schema-writing-view.test.ts` | 1 | View API exposes the active Schema production projection and managed draft | service | 保留原公共契约/必要边界 |
| `test/settings-builtin-module.test.ts` | 1 | Settings Builtin Module registers its durable Route and Slot contract | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/settings-builtin-view-browser.test.ts` | 1 | Settings Builtin Mount loads both scopes and validates an edited global draft | browser、service | 按上表精简；原公共契约保留 |
| `test/skill-command.test.ts` | 2 | skill init installs only the unified memsphere skill | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/system-model-creation.test.ts` | 1 | Managed and Embedded project create publish complete persistent system models before success | process | 按上表精简；原公共契约保留 |
| `test/system-models.test.ts` | 13 | An uninitialized Project model read creates neither directories nor virtual system rows | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/validate-command.test.ts` | 2 | stateless Memory validation does not require Home or Registry | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-browser.test.ts` | 4 | View page routes are the union of the builtin Module route grants | 进程内入口（helper 另核对） | 按上表精简；原公共契约保留 |
| `test/view-docs.test.ts` | 1 | View architecture documentation matches the wired Module and Slot runtime | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-fault-isolation-browser.test.ts` | 2 | Memory builtin keeps valid Memory usable and isolates an unavailable ChangeSet detail | browser、service | 按上表精简；原公共契约保留 |
| `test/view-global-style-contract.test.ts` | 4 | global style contract scans every declaration and nested at-rule resource | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-host-composition.test.ts` | 24 | ViewHost applies instances in catalog order and isolates one failed instance | browser、service | 按上表精简；原公共契约保留 |
| `test/view-host.test.ts` | 23 | ViewHost document boots the builtin Module instances in catalog order | browser、service | 按上表精简；原公共契约保留 |
| `test/view-locales.test.ts` | 4 | View locale resources have matching keys and resolve supported languages | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-models.test.ts` | 1 | Model APIs isolate Projects and immediately follow saved model directory configuration | service | 保留原公共契约/必要边界 |
| `test/view-package-browser.test.ts` | 4 | trusted local Package replaces Memory and Run through formal composition and appears in Settings | browser、service | 按上表精简；原公共契约保留 |
| `test/view-package-config.test.ts` | 4 | View Package installation, theme, and composition are strict global configuration | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-package-example.test.ts` | 1 | example View Package bundle is reproducible, SDK-external, and copy-installable | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-package-registry.test.ts` | 5 | View Package resolver loads installed versions and blocks unresolved same-priority cells | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-project-switch.test.ts` | 1 | View keeps Project selection in the URL and isolates concurrent Project requests | browser、service | 按上表精简；原公共契约保留 |
| `test/view-responsive.test.ts` | 21 | View reflows task content and keeps horizontal scrolling local on compact screens | browser、service | 按上表精简；原公共契约保留 |
| `test/view-sdk.test.ts` | 14 | defineViewPlugin preserves the Plugin object used as the Bundle default export | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-service.test.ts` | 8 | status removes stale View service state | service | 保留原公共契约/必要边界 |
| `test/view-settings-browser.test.ts` | 4 | Settings browser preserves omitted sections and stays responsive | browser、service | 按上表精简；原公共契约保留 |
| `test/view-settings.test.ts` | 11 | loopback Settings validates same-origin JSON and rejects cross-origin requests | service | 保留原公共契约/必要边界 |
| `test/view-shell-layout.test.ts` | 4 | View Shell exposes the four-column Slot and search surfaces | 进程内入口（helper 另核对） | 按上表精简；原公共契约保留 |
| `test/view-style-contract.test.ts` | 9 | Reference Module styles use public tokens and stay inside the Feature root | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/view-theme-registry.test.ts` | 3 | Theme Registry resolves system, Home, and Project layers and restores on disposal | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |
| `test/windows-prerequisites.test.ts` | 1 | Git Bash candidates include locations derived from Git exec-path and Windows installation roots | 进程内入口（helper 另核对） | 保留原公共契约/必要边界 |

新增的 `cli-presentation.test.ts`、`model-unavailable.test.ts` 承接上表迁移的组合规则；`helpers/browser.ts`、`helpers/project.ts` 只提供隔离夹具，不增加产品能力。

## Windows 首轮 CI 反馈与修正

首轮精简提交 `f415ab2` 的 Ubuntu、macOS、Windows 安装包和 Gitleaks 检查通过，Windows 完整套件有一项失败：`Embedded validation checkpoints linked-worktree changes without changing the main worktree` 清理 `outside-view-workspace` 时 `rmdir` 返回 EBUSY。其余测试无失败。

原因是新共享 Chromium 在第一个测试已经切换到临时目录后启动。浏览器继承该 cwd；即使所有页面/context 已关闭，浏览器进程仍活到文件结束，Windows 不允许删除该进程占用的目录。修正为在测试文件的 before hook、仍位于稳定仓库 cwd 时启动 Chromium。每个场景依旧使用独立 context，文件结束关闭进程。不增加清理重试或超时，不忽略目录删除错误，也不跳过这个测试。失败文件在本机重跑 2/2 通过，browser helper 严格类型检查通过；修正后重新执行完整回归：1100 项、1099 通过、0 失败、1 个原有平台 skip，475.172 秒；pretest 完整构建通过。最新 CI 由修正提交重新触发确认。
