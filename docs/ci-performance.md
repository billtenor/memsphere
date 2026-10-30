# CI 分层与测试精简

## 必须守住的边界

测试按用户可观察契约和真实运行边界选择。删除、合并或下沉必须说明重复保护及覆盖代价；不得为隐藏失败而删断言、跳过测试或放宽验收。保留教程安全规则、数据发布/回滚、权限、并发与原生文件/进程保护。

`npm test` 仍构建并运行`test/` 下递归发现的全部 `.test.ts`（含 `test/ci/`），每个文件使用独立临时 MEMSPHERE_HOME，文件内部串行；`--test-concurrency=N` 控制文件进程数。`--results=<path>` 或 CI_TEST_RESULTS 保存计划与实际结果。失败不停止其他文件，不转换为成功。`pretest:ci` 每个测试job构建一次，Windows安装包使用 `npm pack --ignore-scripts` 复用该job产物；不跨OS共享dist。各平台测试job与Windows打包job在runner.temp启用Node 22原生编译缓存，供该job的重复Node/CLI子进程复用编译结果；不缓存测试状态、不复用MEMSPHERE_HOME、不跨job共享缓存。

## 默认 PR

统一Node22，Linux固定Ubuntu24.04（当前Playwright不支持Ubuntu26.04）。默认矩阵由 `scripts/ci/ci-plan.mjs` 生成：

| 平台 | 套件 | 文件并发 |
|---|---|---|
| Linux | Browser UI / CLI & Packaging / Projects & Memory / Run, Data & SDK | 3 / 3 / 2 / 2 |
| macOS | Platform & Upgrade Contracts | 4 |
| Windows | Platform Core Contracts / Platform Publication & Upgrades | 4 / 4 |
| Windows | 真实npm安装包、Run/View及四种Shell冒烟，default另运行project-command | 独立job |

Linux对每个保留文件恰好执行一次，macOS和Windows对平台风险集增加执行，macOS同job包含全部升级测试，Windows将发布、Run产物和Memory变更用例放入升级组，其余35项平台保护由core组执行；project-command重型集成用例复用原有安装包job的空闲时间（runner并发上限2，实际一个文件），直接调用测试runner，不再触发pretest重建。full仍由原有矩阵覆盖这份用例，安装包job仅在default追加该文件。不是增加job或删除保护。新增测试默认进入Linux和完整检查，不要求人工登记才会执行。39项平台清单位于 `scripts/ci/test-plan.mjs` 的platformTests，缺失清单文件会使计划生成失败；平台差异新增时同时更新风险审计和清单。Chromium安装依据实际选集自动计算，不按文件名或job标题猜测。

不再设置整条workflow的五分钟硬预算，平台排队与调度不构成检查失败。default测试/打包及Security仅保留GitHub原生job 5分钟超时；整体耗时作为观察指标。精简目的包括降低总消耗，不能只用更多runner换取墙钟时间。

Runner 交付后，系统升级和历史通用流程升级两个重测试改由已有的升级分组执行，不再落入 Run/Data/SDK 的默认兜底分类。Linux Projects & Memory、macOS完整Memory组和Windows完整升级组接收它们；默认原生保护集合保持原范围，在已有Reviewer平台文件中补充Windows queue包装脚本验证。所有文件仍完整执行，未增加job或并发，也未放宽5分钟预算。

### daemon 测试职责审计

按 `memsphere-repository-testing-rules`，非被测前置状态应优先用 Store/API 构造。daemon 通知测试原先逐例通过 CLI 创建 graph Run、上报候选、准备 Human 票，重复演练了非被测流程；现通过 Graph API、CommandState Store 和 Review API 准备这些状态。真实 CLI wait、身份拒绝、并发登记、显式重试与真实 daemon/queue 子进程继续执行，通知内容、目标会话、幂等和失败结果断言保持。Run start/report/Continue 绑定的真实 CLI 保护由 `procedure-graph-cli.test.ts` 保留，未以手写夹具取代该边界的专门测试。

首次通知与显式重试拆为各自的契约测试。同步等待不再睡眠500毫秒后猜测进程是否已进入等待，而是等待受控 Reviewer 建立 session；不确定投递后的禁止重发测试不再睡眠2.2秒猜测 daemon 已再次扫描，而是登记禁用接收方标记任务并等待其取消，证明后续调度已发生。状态等待均有界，既有用例超时不放宽。浏览器滚动测试使用 locator trial click 重新定位重渲染后的按钮，保留页面与弹窗滚动隔离断言。

Run 锁与 View 读取测试的模型、Store 和服务初始化移至 `beforeEach` 夹具阶段，各用例继续拥有独立目录与服务；业务操作仍在原5秒/10秒等超时内验证。初始化不是锁绕过契约，不应消耗其测试主体时限。真实文件锁占用、跨服务 CAS 竞争、失败注入和恢复断言保留，不改为共享可变 Store，也不放宽CI job预算。

## 合入 master / 发布前完整检查

每次合入master（push master）自动运行full，不再配置每日schedule。GitHub Actions的CI工作流支持手动选择ref和profile（default/full，手动默认full）：

```bash
gh workflow run ci.yml --ref <branch-or-tag> -f profile=full
gh run list --workflow ci.yml --branch <branch>
gh run watch <run-id> --exit-status
```

必须核验run的head SHA为目标提交；仅看到某次历史full通过不足以证明当前版本可发布。发布前待发布SHA必须具备成功的full记录，失败或缺失不得声明可发布。当前没有自动发布流水线，此项是维护者的发布要求，不宣称已建立平台强制发布门禁。

full复用既有17个suite行：Linux4、macOS5、Windows8，再加Windows打包。每个OS对所有保留文件恰好执行一次；各行原有2–4文件进程数不变，full测试/打包job采用20分钟有界超时，full汇总job采用5分钟。它验证跨平台质量，没有整条workflow五分钟预算。正常执行远低于20分钟；额外余量容纳已观察到的runner收尾长尾，不改变测试失败结果。`Full cross-platform regression`必须等全部测试/打包成功才成功。

default按PR号或ref分组，继续取消同目标旧default运行。full按run ID独立分组且不取消，保证连续master push不会挤掉旧pending full，与default互不取消。bootstrap独立，不能提供full证明。合入后full会暴露未进入PR平台集的OS组合故障，失败阻拦后续PR，修复PR可手动验证其自身full再解锁。无合入时不主动检测依赖或runner变化，仍可手动触发full。full触发自身失败也必须处理。

## 平台风险与降频边界

审计src中process.platform、realpath、symlink和终止信号的81处匹配，并与测试交叉检查。平台清单不是对所有原生操作自动证明覆盖；后续变更需要更新相关映射。

| 代码边界 | 逐PR平台保护（均为.test.ts文件） |
|---|---|
| project/resolver、workspace、registry，home、Git路径 | project-resolver、project-registry、home、git、model-storage-paths |
| Embedded repair的chmod CAS、literal pathspec、链接kind目录拒绝和写后回滚 | project-command（整个文件保留，非仅参数矩阵） |
| Report与快照补齐 | run-store、report-execution、run-memory-backfill（含Windows junction） |
| 原生锁、原子写入与跨进程记录 | file-lock、persistence、data-filesystem-process/open/revisions/json-valuestore/datastore/helpers、business-data-service |
| 模型事务、注册目录与备份还原 | model-service、model-operation、model-registration、example-relocation |
| Memory链接、Git隔离、受控更新 | memory-changeset、embedded-changeset、memory-sync、reserved-store、system-upgrade-changeset、reserved-models；另含3个project-upgrade文件 |
| App/Module包路径、外部CLI与资源 | app-install、view-package-registry |
| ACP进程、Shell、命令提示 | agent-review、run-output、run-rule-integration、run-model-artifact、windows-prerequisites、cli-errors |
| 服务、归档、配置 | view-service、archive-store、config-management |

其余Schema/语法组合、CLI消息与选项组合、View大部分浏览器场景逐PR在Linux运行，macOS/Windows全组合合入master后或发布前运行。保留文件内部有部分纯逻辑断言，本轮不为进一步减少毫秒级开销继续拆分。

## 本轮删减审计

基于master332b562（PR104合入），未修改产品行为或教程安全规则。

| 删除的独立用例 | 剩余保护 / 接受减少的约束 |
|---|---|
| view-host：document boots the builtin Module instances in catalog order | 启动metadata、locale、runtime、routeGrants、messages及SDK import-map断言合并到同文件真实HTTP的serves Host/SDK/Runtime用例；实际加载、失败与Retry保护保留。去掉特定内联源码调用名匹配。 |
| view-shell-layout：resizers expose separate accessible handles with bounded widths | aria边界断言迁入view-responsive的真实拖动、键盘、持久化与复位用例。 |
| view-shell-layout：Project Home and Project switching expose separate accessible controls | Home链接、独立菜单和无障碍属性断言迁入view-project-switch的真实导航和并发隔离用例。 |
| view-style-contract：share one canonical Procedure flow renderer | shared renderer样式边界检查并入官方样式用例；保留Memory/Run的嵌套流程及Human标记行为回归。接受不再锁定内部import、函数名和旧CSS名；不改变共享实现。 |

`product-positioning.test.ts`保持原样，尤其教程发布授权与系统/挂载Memory保护等独有安全规则。系统Memory API分类用例从view-responsive迁至无浏览器的view-browser HTTP集成，保留改名路径、system/user分类及响应字段断言，避免为fetch API启动浏览器及庞大Run fixture。

布局检查由60个几何点减为18个精确tuple，ChangeSet意见栏和扩展包交互仍单独保留：

- en/light：四类Memory和Run五路径分别1280px（5点）。
- en/light：长Concept、Procedure、Run三路径分别821/820/390px（9点）。
- en/light：Procedure和Run分别2560px（2点）。
- zh-CN/dark：Procedure和Run分别1280px（2点）。

原对称留白、主题Token、无溢出、宽屏利用和意见堆叠断言保留。接受不再每类Memory×主题×宽度全组合；测试验证18个tuple无重复。用例数量、文件数和几何组合分开计量，不能互相充数。

## 基线与测量

历史run39218044291：148文件×3OS=444次文件执行；17测试行+1打包job=18次完整构建；这18个job的completedAt-startedAt合计2849秒（47.48分钟），非CPU或账单时间，未含作业排队。预算计时244.1秒含排队，仅作历史对照。

集成最新master新增用例后，当前150个保留文件，默认执行234次（150+42+35+6+1），相对原444次基线减少47.3%；完整构建8次，减少55.6%。另有不构建的profile计划和结果汇总job，不能把它们漏记成“整个workflow只有8个job”。full成本单列，不能混算成PR节省。最终耗时以当前head实际CI为准，记录事件/profile、SHA和环境波动。


## PR full 健康门禁


| 界面名称 | 对象与职责 |
|---|---|
| `CI (full)` | Actions工作流运行，真正执行完整跨平台测试。 |
| `Update PR merge gate` | Actions工作流，查询测试结果并通过API更新PR状态；不跑测试。 |
| `Merge gate / full regression` | 挂在PR最新提交SHA上的Commit Status标志，不执行任务；GitHub保护规则要求它成功。 |

刷新任务的运行标题带事件来源，例如 `Update PR merge gate (master updated)`、`Update PR merge gate (CI completed)`、`Update PR merge gate (PR opened)`。同一工作流会被不同事件启动多次，每次都按实时事实刷新所有开放master PR，不读取另一次刷新任务的结果。default CI事件也会产生工作流运行，但脚本直接退出，不发布门禁状态。刷新job名 `Publish merge gate status (no tests)` 与PR状态名刻意不同。

新建普通PR时，default CI测试该PR；同时PR创建事件启动门禁刷新。状态最初不存在，必需状态缺失会阻拦合入；刷新脚本先通过API写pending，再查询当前master提交对应的full（或PR自身最新head的full），最后写success/failure/pending，必要查询失败写error。master变化会触发新刷新，撤掉其他PR保存的旧绿灯；master full结束的completed事件再次刷新这些PR。无需重跑其他PR的default CI，就能更新它们的合入门禁。查询/写入使用[GitHub Commit Status API](https://docs.github.com/en/rest/commits/statuses)，状态记录与真正执行测试的任务在PR检查区中并排展示。

状态 `Merge gate / full regression` 是master ruleset的必需检查，绑定GitHub Actions app15368，保留其余保护且不额外要求PR更新到master。发布器只查GitHub API并发布commit status，不安装项目依赖、不构建、不执行PR代码或构建Artifact。`pull_request_target`、master push、CI full requested/in_progress/completed和手动刷新均从master可信代码读取实时事实，刷新所有开放master PR，事件乱序不会直接复用旧事件结论。

| PR当前head最新full | master最新提交full | 结果 |
|---|---|---|
| success | 任意 | success，修复解锁 |
| 排队/运行/重跑 | 任意 | pending，等待 |
| 非成功 | 任意 | failure，拦截 |
| 无 | success | success |
| 无 | 排队/运行/重跑，或新master提交尚无full登记 | pending，等待 |
| 无 | 非成功或无有效full历史 | failure，拦截 |
| 任意 | 必要API/身份查询异常 | error，重试可信刷新 |

full限定本仓库固定CI workflow335696122，profile标记及实际full汇总核证；default中的skipped汇总不算full。成功必须run和full汇总均success；取消、超时、neutral、skipped、汇总缺失等不会放行。最新按created_at/run ID和当前attempt；重跑期间pending，保留前次失败作审计，绝不回退更旧绿灯。当前PR head改变后，旧head full不能解锁。master则必须匹配实时最新SHA，不能借合入前的绿灯放行。

恢复命令（修复PR每次更新后需对最新提交再跑full）：

```bash
gh workflow run ci.yml --ref <repair-branch> -f profile=full
gh run list --workflow ci.yml --branch <repair-branch>
# 已部署后可信手动刷新；通常full状态事件会自动刷新所有PR
gh workflow run full-health.yml --ref master
```

API读取失败时发布error；状态写API本身故障时工作流失败并暴露无法刷新，不能保证服务故障期间阻拦。事件/API从触发到状态更新存在传播窗口，此机制不承诺与点击合入原子同步；需要绝对串行合入须另外采用merge queue。本门禁证明master已知健康，普通PR仍由精简default保护。

### 首次安装与回滚

发布器必须先进入默认分支才能自动触发；首次安装采用现有CI工作流受控bootstrap。维护者在Human架构/成果正式验收、精确head default/full/Security全部通过及只读dry-run成功后，先从最新ruleset追加必需context、Actions身份，保持全部现有规则和bypass设置；新增规则固定strict_required_status_checks_policy=false、do_not_enforce_on_create=false。此时验证required context尚未到达导致PR被阻拦，再由owner显式运行：

```bash
gh workflow run ci.yml --ref <reviewed-branch> -f full_health_bootstrap=true -f reviewed_sha=<exact-reviewed-head>
```

bootstrap要求owner workflow_dispatch，reviewed_sha等于实际运行github.sha，checkout精确SHA；仅轻量发布，无构建，且不能被识别为full。脚本检查master尚未安装正式发布器，已安装即拒绝bootstrap。依据真实当前head full成功发布状态，回读确认github-actions身份、required满足与PR恢复；不能伪造失败full来验证生产。首次真实接线验证仅missing→真实success，失败full路径由策略及本地HTTP集成覆盖；自动事件合入master后才生效。bootstrap到合入之间由Runner重查实际head/full，不声称已部署自动刷新。

激活异常时只撤回本轮新增context和对应来源，保留全部既有及并发新增规则，回读确认；修复后重试。不移除其他保护，不把回滚当成完成。首次master full历史建立前，无自身head full证明的其他PR保守阻拦；可手动master full，或本次合入后的push full建立证明。


### 从旧名称迁移

旧context是 `Full health / master`，旧发布工作流显示名是 `Full health`；工作流文件路径 `full-health.yml` 保持不变。历史Actions运行及旧提交上的状态记录仍可显示旧名，不能把它们当作新任务；新名称用于后续发布。初始化运行现在显示 `Initialize PR merge gate`，历史 `Full health bootstrap` 同样被明确排除在full证明之外。

迁移需要维护者按顺序完成：

1. 合入改名PR前确认旧required context仍为Actions15368，保留全部原保护；设置仓库变量 `FULL_HEALTH_PUBLISH_LEGACY=true`。新代码未合入时，线上旧发布器继续正常工作，改名PR仍由旧门禁验收。
2. 合入后新发布器从可信master执行，临时向旧context和新context发布相同状态。撤旧分阶段进行：先对所有PR写旧context pending，再对所有PR写新context pending；即使某一笔失败，也继续尝试其余独立的撤旧写入，每笔仅尝试一次。撤旧阶段有任何错误就整体失败，全部成功后才查询事实。新context写入失败时所有可写旧门禁已等待，不会留下后续PR的旧绿灯；不自动重试。若旧context写服务本身不可用，无法保证撤销旧绿灯，与原有API不可写边界相同，不能声称此时仍能强制拦截。
3. 手动可信刷新并检查新状态确实由 `github-actions[bot]` 发布，和旧状态的SHA、结果、full目标链接一致。读取最新ruleset，将旧context原位替换为 `Merge gate / full regression`，保留Actions15368、其他required checks、strict策略、bypass和全部其他规则；不通过先删除保护再重建进行切换。
4. 回读规则及PR状态确认门禁生效后，删除仓库变量，重新运行可信刷新验证只写新名。已有旧提交上的历史状态仍可能显示；之后的新提交只使用新名。切换期间已启动的刷新可能携带旧变量值，待其完成后再作最终确认。

异常时保留双写和旧必需context；若已切换，则只恢复本次context名称，保留并发新增的其他规则。实际新状态与规则回读成功前不宣称线上迁移完成。发布脚本只持有statuses写权限，不修改仓库变量或ruleset；上述配置操作由维护者执行。
