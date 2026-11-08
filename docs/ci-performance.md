# CI 测试执行与门禁

## 必须守住的边界

测试按用户可观察契约和真实运行边界选择。删除、合并或下沉必须说明重复保护及覆盖代价；不得为隐藏失败而删断言、跳过测试或放宽验收。保留教程安全规则、数据发布/回滚、权限、并发与原生文件/进程保护。

`npm test` 仍构建并运行`test/` 下递归发现的全部 `.test.ts`（含 `test/ci/`），每个文件使用独立临时 MEMSPHERE_HOME，文件内部串行；`--test-concurrency=N` 控制文件进程数。`--results=<path>` 或 CI_TEST_RESULTS 保存计划与实际结果。失败不停止其他文件，不转换为成功。`pretest:ci` 每个测试job构建一次，Windows安装包使用 `npm pack --ignore-scripts` 复用该job产物；不跨OS共享dist。各平台测试job与Windows打包job在runner.temp启用Node 22原生编译缓存，供该job的重复Node/CLI子进程复用编译结果；不缓存测试状态、不复用MEMSPHERE_HOME、不跨job共享缓存。

## 默认 PR

统一 Node 22，Linux 固定 Ubuntu 24.04。默认矩阵按 full 相同的职责边界分组，当前有 13 个非空测试 job，另有 Windows 打包 job：

| 平台 | 套件 | 文件并发 |
|---|---|---|
| Linux | Browser UI / CLI & Packaging / Projects & Memory / Run, Data & SDK | 3 / 3 / 2 / 2 |
| macOS | CLI & Packaging / Projects & Memory / Run, Data & SDK | 4 / 3 / 3 |
| Windows | Memory & Project CLI / App, Model & Data CLI / Project Lifecycle / Project Upgrades / Memory Stores & Changes / Run, Data & SDK | 2 / 2 / 3 / 3 / 2 / 3 |
| Windows | 真实 npm 安装包、Run/View、四种 Shell 冒烟 | 独立 job |

测试文件递归发现。Linux 默认与所有平台 full 均执行全部 `.test.ts`；macOS 和 Windows 默认仅排除 `scripts/ci/test-plan.mjs` 的 `defaultTestExclusions` 中的固定相对路径。该清单由原默认白名单对应的未选文件生成，现有测试覆盖保持一致，执行任务按 full 的分类与并发数分组。排除项只匹配精确路径，不使用目录或名称模式；新增测试路径自动纳入默认 CI，同名的其他目录文件也不会被排除。

原生平台选中测试按 full 的职责类别分组，每个文件只运行一次；空分组不创建 job，新增测试使其非空时自动创建。分组决定由哪个 job 执行，不用于拒绝新增测试。Chromium 安装依据实际选集自动计算。平台专属用例仍由测试代码声明适用条件，其他平台记录 skip。

测试发现、排除清单、分类、矩阵与覆盖回归均受 CI change guard 保护。增加排除项需要审查，新增普通测试不需要编辑 CI 文件。full 不应用默认排除清单，保持三平台全量验证。

两个 profile 保留不同的触发、取消、门禁和时间标准：default 测试及打包 job 上限为 5 分钟，full 为 20 分钟；其他辅助 job 保持现有超时。整体排队时间不作为测试失败条件，测试失败或 job 超时均不得视为通过。

### 升级测试的契约与层级

升级覆盖按职责分层，不通过扩大 job 时限或固定等待降低失败概率：

| 契约 | 验证位置与范围 |
|---|---|
| 项目选择优先级、目标缺失、参数错误 | project-upgrade-routing 使用真实命令树和最小登记信息，在资源预检处停止；真实子进程升级成功路径由 project-upgrade 保留。 |
| 模型元数据刷新、原注册身份与用户内容保留、幂等 | model-upgrade 验证模型子系统；project-upgrade 保留模型/Memory 两阶段状态、部分更新、失败与重试，不重复整套元数据断言。 |
| 专用候选保护、冻结范围、过期基线、合入与回滚 | system-upgrade-changeset 使用一个目标 Memory 和真实 Git 构造 Store，不安装无关模型与发行 Memory；16 个普通写入入口仍在两种 Store、两个 worktree 中验证具体拒绝原因及不变性。 |
| Embedded 工作区准入 | system-upgrade-changeset 覆盖主工作区、detached HEAD、脏 Memory、缺失 master；project-upgrade-embedded 以脏 Memory 验证 CLI 在任何模型写入前拒绝。 |
| 历史发行身份识别与安全删除 | legacy-general-task-upgrade 穷举历史 manifest 的全部身份/摘要；Managed、Embedded 端到端清理各按不同目标路径取代表，保留删除结果、专用记录、原 worktree 隔离与定制内容保护。不对同一路径的每个身份重复完整升级。 |
| 多个候选互不破坏 | 两种 Store 均验证候选可校验、放弃一个后另一个仍 active、可校验且目标内容保留；仅记录数量不足以证明该契约。 |

CLI 边界、真实 Git/worktree、失败回滚、用户定制内容与重试保护仍由集成测试承担；缩短的前置构造不宣称覆盖项目创建或安装，这些行为由对应套件验证。

### 测试取消与进程回收

`run-tests.mjs` 收到 SIGINT、SIGTERM 或 SIGHUP 后停止调度，回收它已启动的测试进程树，再删除临时 Home 并保存已有结果；取消分别以 130、143、129 返回，不会误报成功。正常执行不扫描进程表，也不增加 worker 数、job 或测试执行期限。

POSIX 上每份测试拥有独立进程组；取消时通过进程树快照识别 Playwright 等另建的进程组，只向本次 runner 的组发送信号。保留最多2秒的退出清理窗口，仍存活的进程组强制回收，并确认已退出。Windows 使用进程树快照和原生 taskkill 回收；退出确认同时核对启动时间，避免把已复用的 PID 当作原进程仍未退出。清理窗口只用于取消回收，不是工具或测试执行超时。

文件执行次数和相对 full 的执行降幅仅作观察数据，不作为通过门禁；新增测试不应因文件数量增长而被拒绝。default 每个 job 上限保持5分钟，full 的测试和 Windows 打包 job 上限保持20分钟；其他辅助 job 保留现有不超过5分钟的上限。执行时限由 GitHub 原生 job 超时控制，仓库测试保留对应配置断言。full 完整覆盖、default 固定排除及同一平台不重复执行的校验继续保留。

`test/ci/test-runner.test.ts` 使用原样 runner 副本与真实 Chromium 验证正常完成、SIGINT 取消及并发 SIGTERM 取消。受控 HTTP/IPC 握手确认浏览器和拒绝正常退出的子进程已经启动，取消后通过 OS 进程表检查所有已观测后代均退出、后续测试未调度、临时 Home 已删除。测试不依赖固定 sleep。Windows 用受控预加载 IPC 触发同一信号处理器，实际树回收仍执行原生 Windows 路径；不把它描述为 Windows 控制台按键测试。

### daemon 测试职责审计

按 `memsphere-repository-testing-rules`，非被测前置状态应优先用 Store/API 构造。daemon 通知测试原先逐例通过 CLI 创建 graph Run、上报候选、准备 Human 票，重复演练了非被测流程；现通过 Graph API、CommandState Store 和 Review API 准备这些状态。真实 CLI wait、身份拒绝、并发登记、显式重试与真实 daemon/queue 子进程继续执行，通知内容、目标会话、幂等和失败结果断言保持。Run start/report/Continue 绑定的真实 CLI 保护由 `procedure-graph-cli.test.ts` 保留，未以手写夹具取代该边界的专门测试。

通知测试通过 Review API 创建并完成受控 Agent assignment，不再启动 ACP Reviewer 或其工具链。这里保护的是 Memsphere 的等待登记、通知格式、目标会话、失败可查询、显式重试和任务历史；外部 Agent 的正确性不属于本仓库职责。Memsphere 的 ACP 适配行为由 `agent-review.test.ts` 等专门测试使用受控协议端点验证，不在通知测试中重复覆盖。

首次通知与显式重试各自保护一个契约。已可返回结果的 Runner 决策、会话绑定冲突的目标 Run 通过域 API 准备。夹具复用自己打开的模型服务读取当前 Store，不缓存 Review 结果，也不跨用例共享可变服务。通知测试的 daemon 以真实 CLI `daemon serve` 作为可直接持有的子进程启动，清理等待其 exit 事件后才删除目录，不再轮询 PID 或读取 `/proc`。CLI 自启动和 restart 仍由专门的 daemon/View 生命周期用例覆盖。

持久化任务状态通过文件变更事件唤醒后重新读取；监听先于首次读取注册，避免遗漏读取期间发生的变更。事件本身不代表任务成功，不依赖固定 sleep、轮询次数或扫描周期；等待仍受原用例期限约束，不增加测试或 CI 超时。

同步等待用真实 CLI 与受控待决轮询握手验证：先确认已经读取到待决 Agent 状态，再完成评审并释放轮询，断言返回结果且不登记异步任务。通知终态写冲突用受控 queue 握手验证：发送被观察到后由第二个真实 Store 写入推进 revision，再释放发送；daemon 必须暴露写冲突并停止自动投递，重启后记录结果不确定且等待显式恢复。两者不以固定时长或 `finished === false` 推断协作状态。

daemon 控制鉴权测试继续通过真实 socket 验证越权请求被拒绝且实例不变。浏览器滚动测试使用 locator trial click 重新定位重渲染后的按钮，保留页面与弹窗滚动隔离断言。

Run 锁与 View 读取测试的模型、Store 和服务初始化移至 `beforeEach` 夹具阶段，各用例继续拥有独立目录与服务；业务操作仍在原5秒/10秒等超时内验证。初始化不是锁绕过契约，不应消耗其测试主体时限。真实文件锁占用、跨服务 CAS 竞争、失败注入和恢复断言保留，不改为共享可变 Store，也不放宽CI job预算。

并发 CLI report 的 `STEP_FINISHED` 失败不是应放宽的测试预期：已提交产物后，自动进入下一 Step 使用的快照可能过期。提示生成遇到该目标已完成时，返回读取当前 Run 状态的命令；不使已持久化的提交误报失败。用小范围提示测试确定性覆盖此竞态与其他错误原样传播，真实并发 CLI 测试继续保留原有错误白名单、产物数、完成状态和完成序号断言。

## 合入 master / 发布前完整检查

每次合入master（push master）自动运行full，不再配置每日schedule。GitHub Actions的CI工作流支持手动选择ref和profile（default/full，手动默认full）：

```bash
gh workflow run ci.yml --ref <branch-or-tag> -f profile=full
gh run list --workflow ci.yml --branch <branch>
gh run watch <run-id> --exit-status
```

必须核验run的head SHA为目标提交；仅看到某次历史full通过不足以证明当前版本可发布。发布前待发布SHA必须具备成功的full记录，失败或缺失不得声明可发布。当前没有自动发布流水线，此项是维护者的发布要求，不宣称已建立平台强制发布门禁。

full复用既有17个suite行：Linux4、macOS5、Windows8，再加Windows打包。每个OS对所有保留文件恰好执行一次；各行原有2–4文件进程数不变，full测试/打包job采用20分钟有界超时，full汇总job采用5分钟。它验证跨平台质量，没有整条workflow五分钟预算。正常执行远低于20分钟；额外余量容纳已观察到的runner收尾长尾，不改变测试失败结果。`Full cross-platform regression`必须等全部测试/打包成功才成功。

default按PR号或ref分组，继续取消同目标旧default运行。full按run ID独立分组且不取消，保证连续master push不会挤掉旧pending full，与default互不取消。bootstrap独立，不能提供full证明。合入后 full 验证实际 master 提交，失败阻拦后续 PR，修复PR可手动验证其自身full再解锁。无合入时不主动检测依赖或runner变化，仍可手动触发full。full触发自身失败也必须处理。

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

## PR full 健康门禁

master full 的已知失败具有合入否决权；full 完成不是每个 PR 或每轮敏捷迭代的前置条件。

| 界面名称 | 对象与职责 |
|---|---|
| `CI (full)` | 真正执行完整跨平台测试的 Actions 运行。 |
| `Update PR merge gate` | 查询事实并更新 PR 状态的发布工作流，不跑测试。 |
| `Merge gate / full regression` | PR 最新 head 上的 Commit Status，表示是否存在 full 健康阻断；success 不等于 master full 已通过。 |

发布器优先使用 PR 当前 head 自身最新的显式 full（保留修复 PR 的解锁方式）。没有自身 full 时，按下表判断 master 健康门禁：

| master 最新提交的 full | 最近已完成的 master full / attempt | 合入状态 |
|---|---|---|
| success | 任意 | success |
| 非成功的完成结果 | 任意 | failure |
| 排队、运行中或尚未登记 | success | success，不等待当前 full |
| 排队、运行中或尚未登记 | failure | failure，保持已知失败阻断 |
| 排队、运行中或尚未登记 | 无 | success，尚无已知失败 |
| 必要 API / 身份查询异常 | 任意 | error，不能推断无失败 |

“最近已完成”按运行 created_at、run ID 及 attempt 选择，跨 master 提交保留；新提交和重跑不会清除已知失败。重跑的最新 attempt 尚在运行时，向前读取已完成 attempt，成功须核验其自身 full 汇总。失败后的后续完整成功可以解除阻断。PR 自身显式 full 保持原判定：排队/运行/重跑为 pending，失败为 failure，成功为 success；旧 PR head 的证明不适用于新 head。

full 仅识别本仓库固定 CI workflow 335696122，通过 profile 标记及实际 full 汇总核证。default 的 skipped 汇总不算 full；取消、超时、neutral、skipped、汇总缺失等已完成非成功结果仍计作 failure。无已知失败时，success 描述明确为 `No known master full failure; full completion is not required`，不宣称 full 已执行完毕或通过。

### 事件刷新与合入约束

`pull_request_target`、master push、CI full requested/in_progress/completed 和手动刷新都会从可信 master 代码读取实时事实，刷新所有开放的 master PR；default CI 事件直接退出，不发布状态。每次先撤销旧绿灯，短暂写入 `Refreshing merge gate` pending，再发布查询结果；这个短暂状态表示刷新中，不表示等待 full。失败事件会把同一 PR head 的门禁更新为 failure，无需重新运行 PR default CI。

状态仍是 master Ruleset 的必需检查，绑定 GitHub Actions app 15368；本次判定调整无需修改 Ruleset、权限或 bypass。发布器不安装依赖、不构建、不执行 PR 代码。API 读取失败写 error，写入失败暴露工作流错误；查询失败不会冒充无已知失败。事件传播存在窗口，不承诺与点击合入原子同步。

敏捷流程的“全部适用 CI”只包含实际验证当前 PR 候选的检查。master 健康门禁单独记录，失败不阻断技术或产品验收，也不进入本分支 CI 修复循环。最终交接核对并报告 master full 与实际合入门禁：full 在运行时正常交接，失败时报告合入受阻并保留验收成果；实际合入仍须满足 GitHub 门禁。合入后的 full 排队或运行也不是本轮清理的等待条件。

### 修复与生效

修复 PR 可以对当前 head 显式运行 full；其最新 full 成功沿用现有修复解锁机制：

```bash
gh workflow run ci.yml --ref <repair-branch> -f profile=full
gh run list --workflow ci.yml --branch <repair-branch>
# 已部署后通常由 full 状态事件自动刷新；必要时手动刷新
gh workflow run full-health.yml --ref master
```

发布器固定 checkout master，因此 PR 中的修改不会提前改变线上门禁；Human 合入后，master push 和后续 full 事件使用新判定。修改 CI 机制的 PR 仍会命中独立的 `CI change guard`，由 Human 审查并在合入时按该规则放行，不通过脚本伪造成功。

### 从旧名称迁移

旧context是 `Full health / master`，旧发布工作流显示名是 `Full health`；工作流文件路径 `full-health.yml` 保持不变。历史Actions运行及旧提交上的状态记录仍可显示旧名，不能把它们当作新任务；新名称用于后续发布。初始化运行现在显示 `Initialize PR merge gate`，历史 `Full health bootstrap` 同样被明确排除在full证明之外。

迁移需要维护者按顺序完成：

1. 合入改名PR前确认旧required context仍为Actions15368，保留全部原保护；设置仓库变量 `FULL_HEALTH_PUBLISH_LEGACY=true`。新代码未合入时，线上旧发布器继续正常工作，改名PR仍由旧门禁验收。
2. 合入后新发布器从可信master执行，临时向旧context和新context发布相同状态。撤旧分阶段进行：先对所有PR写旧context pending，再对所有PR写新context pending；即使某一笔失败，也继续尝试其余独立的撤旧写入，每笔仅尝试一次。撤旧阶段有任何错误就整体失败，全部成功后才查询事实。新context写入失败时所有可写旧门禁已等待，不会留下后续PR的旧绿灯；不自动重试。若旧context写服务本身不可用，无法保证撤销旧绿灯，与原有API不可写边界相同，不能声称此时仍能强制拦截。
3. 手动可信刷新并检查新状态确实由 `github-actions[bot]` 发布，和旧状态的SHA、结果、full目标链接一致。读取最新ruleset，将旧context原位替换为 `Merge gate / full regression`，保留Actions15368、其他required checks、strict策略、bypass和全部其他规则；不通过先删除保护再重建进行切换。
4. 回读规则及PR状态确认门禁生效后，删除仓库变量，重新运行可信刷新验证只写新名。已有旧提交上的历史状态仍可能显示；之后的新提交只使用新名。切换期间已启动的刷新可能携带旧变量值，待其完成后再作最终确认。

异常时保留双写和旧必需context；若已切换，则只恢复本次context名称，保留并发新增的其他规则。实际新状态与规则回读成功前不宣称线上迁移完成。发布脚本只持有statuses写权限，不修改仓库变量或ruleset；上述配置操作由维护者执行。
