---
id: 20261028-runner-agent-identity-async-review
type: feature
created: 2026-10-28
completed_at: 2026-10-30
run_id: run-7c86229c-cf37-42de-8460-6bbec4c1d299
---

# Runner Agent 身份与异步评审唤醒

## 需求

将调用 Memsphere 的 Agent 会话识别为 Runner 上下文，以 Agent 会话作为 Continue 状态存储的身份主键，取消独立 Continue ID，使 Agent 无须记忆额外标识，并能在评审等待时释放当前回合，收到结果消息后继续。首期支持 Codex 与 Traex。产品负责人由现有产品 Agent 与 Human billtenor 共同参与；架构师由现有架构 Agent 与 Human billtenor 共同参与。

### 当前迭代范围

1. 配置界面提供 Runner Agent 配置：探测 Codex、Traex 是否安装，展示可用性及未安装提示，安装后重新探测即可进入配置。每种 Agent 提供“开启 Agent 身份”和“开启 Agent 异步执行”开关。这里的 Runner Agent 设置与 ACP Reviewer Provider 设置、Project Runner 权限分开；开关默认关闭。建议放 Home 配置，供当前机器各 Project 使用，待产品负责人确认。
2. 命令执行时从当前进程环境识别 Agent 类型和自身 thread ID。Codex 已实测 CODEX_THREAD_ID；Traex 产品 Reviewer 已在本 Run 的真实评审会话中观察到 TRAECLI_THREAD_ID 与当前 attempt session ID 一致（Reviewer 实测证据，Runner 未独立复跑）。不把父会话 ID 当当前会话 ID。无法确定或多种身份冲突时明确报告，不猜测目标。
3. Continue 仅允许在开启 Agent 身份且成功识别当前 Agent 会话时使用，命令形态为 `memsphere continue report ...`、`memsphere continue review wait`。无法识别、身份关闭、会话 ID 缺失或身份冲突时必须拒绝 Continue，不提供显式 Continue ID 绕过入口。删除原有独立随机 context/continue ID 的状态定位机制，将 Continue 状态改为以 Agent 类型与 session ID（对应各 Agent 的 thread ID）为主键存储；原有 Project/Run/Step 绑定、读取记录、状态与审计信息保留在会话状态中。会话标识不替代权限校验。
4. 启动自由探索 Run 或进入 graph Step 时建立当前会话绑定。graph Step 的提交与评审继续指向原 Step，不在候选未被接纳时漂移。后继 Step 正式进入后才切换；同一会话并行操作多个 Run/Step 时，不得静默选取任意上下文，提供明确冲突提示，通过原生 run/step 命令显式进入目标上下文后更新会话绑定，不恢复独立 Continue ID。
5. 异步执行开启、身份有效且具备 queue 能力时，Review wait 先登记后台等待，再立即返回“已登记异步等待，你可以停在此处，直到新消息唤醒”。覆盖原生 review wait 与 Continue 入口；已经可返回的评审结果直接返回，无须无条件再唤醒一次。
6. 后台等待到达与同步 wait 相同的可返回状态后，通过对应 Agent 的 `queue --thread <id> --message <text>` 回发。消息仅包含来源标记、继续提示和显式 Project/Review 的 wait 命令；完整结果通过再次执行命令读取，不在 user 通道回传。
7. 等待注册绑定具体 Project/Run/Step/Review/轮次及原 Agent 会话，脱离前台进程后仍能执行。重复调用同一等待不得造成多个活动等待和重复主动通知；旧轮次通知不得覆盖新轮次上下文。queue 失败须保留可查错误和可重试信息，不得误报成功或改变评审结论；不承诺外部 queue 的端到端 exactly-once。
8. 身份关闭或无法识别会话时禁止 Continue，仍可使用原生 `run`/`run step` 命令显式指定目标。异步关闭时原生 review wait 沿用同步行为；开启异步但缺少身份、未安装 Agent 或 queue 不可用时明确说明原因，并提供原生同步等待路径，不返回虚假的登记成功。同步降级不豁免 Continue 的身份要求。按 Human 最新修订，不提供单次显式同步等待选项；同步/异步由当前 Runner 配置决定。

### 后续范围与不做事项

不支持其他 Agent，不自动安装或登录 Agent，不实现通用 Agent 调度平台，不改变评审权限、投票和 Human 门禁，不自动替 Human 投票，不变更 Procedure YAML syntax。暂不承诺跨机器会话路由。

### 交付物

配置及界面、Agent 身份检测、基于 session ID 的 Continue 状态存储及会话绑定、后台等待及 queue 回发、测试、System Memory 与 Skill/必要文档同步。上一阶段 debug-thread-id 验证可作为证据，正式交付时判断是否保留为诊断入口。

## 验收标准

- Codex、Traex 安装/未安装/重新探测结果正确；开关保存并重新读取后保持一致；修改 Runner Agent 开关不改变 ACP Provider 配置或 Project Runner 权限。
- 从 Codex 真实调用 Memsphere 时自动得到当前 thread ID；Traex 也用真实会话验证。检测无身份、多身份冲突与缺失 thread ID 时不错误路由。
- 身份开启且会话识别成功时，无 Continue ID 的命令能正确操作当前 Run/Step；graph report、review、修订、切换后继 Step 均绑定正确；多上下文冲突可观察且不会提交到错误 Step。
- 身份关闭、无身份、缺少 session ID 或身份冲突时，Continue 必须失败且不改变任何业务或会话状态；传入旧 Continue ID 不能绕过。
- Continue 状态以 Agent 类型与 session ID 为主键保存，跨 CLI 进程可复用；不再生成或依赖独立 context ID，命令回执、提示、Help、Memory 与 Skill 同步移除旧调用方式；不同 Agent/会话状态隔离。
- 异步 wait 完成登记后前台进程立即结束；评审仍在后台推进，完成时只向原会话投递三行继续命令通知，Agent 执行命令读取当前正式结果后继续投票或修订。
- 验证通知严格只包含三行标记、提示和 wait 命令，执行命令得到当前正式结果；覆盖等待 Human、等待 Runner 投票、要求修改、Agent 失败等同步 wait 可返回状态，不仅测试全票通过。
- 覆盖重复 wait、后台进程异常、queue 失败、轮次变更、权限拒绝、关闭开关、按配置选择同步等待以及同步入口回归；已保存结果可按现有命令恢复，不虚报完成。
- 类型检查、针对性测试及仓库要求的回归通过；真实 queue 验证保留发送端和接收端证据。

## 向前兼容

结论：不需要向前兼容。当前仓库 `git tag --list '*stable*'` 无结果，未发现按仓库规则需承担兼容责任的 stable checkpoint。本轮有意移除显式 Continue ID 及其独立状态存储，不提供旧 Continue ID 迁移或兼容入口；保留默认同步等待和旧配置缺省关闭。身份未开启时应使用原生 run 命令；历史 Run/Artifact 保持可通过原生命令查询和继续，不删除业务历史。

## 采用的 Memory 与来源边界

- procedures/memsphere-agile-requirement-development-graph：阶段与正式评审门禁。
- statements/memsphere-repository-requirement-rules：明确向前兼容决策；启动 Run 前已通过 CLI 读取的仓库规范。
- statements/memsphere-repository-development-rules：控制复杂度、同步 System Memory 与 Skill；启动 Run 前已通过 CLI 读取的仓库规范。
- changes/README.md：需求记录与状态规则。

本 Run 冻结快照仅含根流程及其 delivery/git 规则依赖；上述两条启动前读取的仓库规范不冒充冻结 Memory。后续阶段需要的需求、开发、测试规范集合与来源在方案评审中列明，由 Human 一并审阅；本轮不手工修改冻结快照或悄然混入新版本。

## 待确认项

建议 Runner Agent 两个开关位于 Home 配置，按 Codex/Traex 分别设置，默认关闭；Continue 强制要求身份与可识别会话，彻底改为基于 session ID 存储，不保留显式 Continue ID 入口；异步开启必须有可识别会话才能登记。后两项已由 Human 在本轮修订中明确提出。由产品负责人评审当前契约确认这些行为。

## 技术与测试方案

技术方案第六轮已通过（artifact-25394f2b-f485-46f5-a4cb-9b0ed2f31eb2），详见 implementation-plan.md。已调查入口：src/config.ts、src/acp/detection.ts、src/commands/continue.ts、src/home/command-state-store.ts、src/commands/run.ts。Traex queue help 已确认支持 --thread 与 --message；Traex Reviewer 已提供当前会话环境变量匹配证据；仍需功能完成后的真实 Agent 调用与 queue 发送/接收端到端验证。

## 开发任务

见 development-plan.md；施工前先由 Human 核对下方汇总后的范围修订。

## 验收结果

Human 已明确回复“我通过”确认范围回写；当前正按已通过的需求、方案和开发计划实施与验证。

## 需求范围修订汇总（施工前确认版）

本节汇总 Human 在技术评审中的明确修改，补齐初始契约未包含的验收范围，优先于前文初始概述。原始冻结需求产物保留，本地修订并不冒充其新版本。

- 统一 daemon：每个 Memsphere Home 一个常驻实例，管理 View 生命周期与异步等待；新增 daemon start/status/stop/restart。CLI 异步登记自动确保 daemon 可用，未成功不能虚报已登记。
- View 启停意图持久化：view start/restart 设置 running，view stop 设置 stopped；daemon stop 不修改意图，start/restart 恢复之前的选择。首次默认 stopped，View 启动失败保持意图并展示实际错误，不阻断任务调度。旧 View 接管须验证实例身份，有界停止后迁移，不终止未验证进程。
- CommandState 按 agentType-sessionId 直接拼接 data_id，校验实际文件名含 .json 长度；无身份禁止 Continue，删除旧 context ID 入口。
- 通用 DaemonTask：首期 review-wait 处理器，模型仅保存定位信息、接收会话、status、error、认领和时间；不保存 result/delivery。queue 返回成功后 completed，失败用 error.stage 定位；取消原因保存于 error(stage=cancel)。
- 恢复边界：queued 可恢复；崩溃遗留 running 保守置 failed/execution_interrupted(stage=recovery)，显式 retry 前告知可能已投递；优雅退出仍在等待的任务退回 queued，完成发送不重复自动投递。重试重新读取固定轮次，不要求正文逐字相同。
- 身份模式的 wait/status 只推进既有业务状态，不自动 enter 后继或修改会话绑定，输出显式进入命令；start/report/vote 的唯一后继正式进入仍按已批准矩阵执行。身份关闭原生同步入口维持现有自动进入行为。
- wait 调用时评审已可返回，直接前台返回，不登记任务、不启动或通知 daemon、不发 queue；仅复用 queued/running；历史终态记录不阻止创建新的必要等待。矩阵只列 CLI 命令，daemon 内部路径独立说明。
- View 是常驻服务，不包装成 DaemonTask；本轮不发展插件式通用任务平台，不迁移现有 ACP Reviewer 调度职责。

### 新增验收标准

1. 同 Home 并发启动单例，不同 Home 实例、控制端点和任务隔离；控制端点具备本机权限与认证。
2. View running/stopped 两种意图均跨 daemon restart 恢复；View stop/restart 不影响任务；daemon stop 不清除意图或任务，恢复失败如实展示。旧实例和端口冲突路径可观察。
3. DaemonTask 模型拒绝 result/delivery 及非法状态；queue 成功才 completed，取消原因和恢复 stage 校验正确，任务失败可查询重试。
4. 就绪评审直接返回、活动任务去重、终态不虚报登记、失去登记通知仍由周期扫描发现；覆盖前台退出、daemon 重启、投递失败和旧轮次取消。
5. 身份模式下 wait/status 不隐式切换 Step，通知可引导显式 enter；原生关闭身份模式回归正确。
6. Windows package smoke 覆盖 daemon/View 生命周期与命名管道；本机 Codex/Traex 端到端 queue 各留发送接收证据，无法验证的项明确报告。

### 非目标与已知边界

不安装 OS 开机自启动服务，机器重启后须有操作触发 daemon 启动才恢复；不承诺 queue exactly-once 或接收 Agent 已处理消息。当前批准拓扑是进程内 View，普通请求错误必须隔离并验证，daemon 致命进程退出按上述失败恢复边界处理；若实施发现需改成监管 View 子进程，先修订方案，不擅自改变已批拓扑。首期任务历史无自动清理，接受扫描随历史增长，后续处理留存优化。

## 2026-10-29 Human 增补：异步消息来源标记

Human 在实现验收第1轮启动后明确要求：“memsphere 给 session 发异步消息，需要在消息里额外带一个标记，区分是 memsphere 发的消息，还是人发的消息”。这是 Human 产品负责人对本轮范围的明确增补授权，记录后实施，不将先前验收通过票用于新增版本。

所有 Memsphere 发往 Agent session 的 queue 消息以固定首行 `[Memsphere 自动消息]` 开头，再空一行接原有正文。完整评审结果通知和完整通知失败后的短通知都必须携带；同步 wait 的前台输出不添加该标记。原完整结果正文与同步渲染保持一致，不新增模型字段或持久化消息正文。新增验收标准：真实发送 argv 的 message 带标记，去除固定前缀后等于对应同步输出。


## 2026-10-29 Human 修订：通知与幂等 wait（覆盖前述完整正文与 --sync 约定）

Human 明确要求通知仅包含来源标记、“请执行命令以继续：”和继续命令，不携带结果信息；并要求 wait：配置为异步则默认异步，否则同步；需要等待则登记异步任务，否则直接返回结果。本节优先于此前来源标记增补中“完整结果回传”的旧约定。旧轮票与旧候选保留，不代表本次修订已获验收。

- 原生与 Continue wait 去掉 --sync 选项；相同命令可首次等待，也可在唤醒后取结果。
- 当前可返回状态（含 Reviewer 失败）优先直接返回，不创建任务或发送通知；否则有有效身份且对应 Runner 开启异步时登记任务，其他原生调用同步等待。Continue 身份要求不变。
- 去重只针对同键 queued/running。历史 completed/failed/cancelled 保留；需要新的等待时创建新任务，不修改历史终态或重发旧任务。仍保持每个去重键最多一个活动任务。
- queue 正文固定三行：`[Memsphere 自动消息]`、`请执行命令以继续：`、`memsphere --project P run review wait --review R`。参数按 Shell 转义，显式定位避免依赖会话当前绑定；绑定冲突仍明确拒绝，不静默切换 Run/Step。
- 不回传票、错误或结果，不把自动消息当 Human 授权。通知发送失败只记录 failed/send，取消原来的自动短消息兜底，显式 retry 仍可用，结果始终从正式 CLI 响应读取。
- 验收覆盖配置选择同步/异步、就绪直返、并发活动去重、同轮历史终态后重新等待、三行通知与实际回读、发送失败无第二条通知。无新模型字段，不存 result/delivery。


## 2026-10-29 Human 决定：在当前验收Step重审并共同交付回溯需求

Human 明确要求：“好，那我们就在当前步骤重新 review。我投要求修改，请重新发起一轮 review。这个需求文档也记得到时候一起交付合入 master”。据此不另开替代Run，也不在本轮实现graph回溯能力；修订后的需求、完整技术方案和修订3实现一起提交当前acceptance Step的新候选，由研发、测试、架构（含Human）重新评审，通过后再进入产品交付验收。

第2轮Human通过票已提交不可覆盖，本条记录为其后明确的要求修改与重审授权，不冒称旧票已改写。为结束当前未决旧轮并重报新候选，需要各重试一次仍失败的研发/架构Assignment，收齐后由Runner正式request_changes；本次重审指令作为该必要动作的授权，不扩大为无限重试。

另将 `changes/active/20261029-graph-run-backtracking/change.md` 纳入本次Git/PR交付范围，最终与本迭代一同交付合入master；该项仅为待开发需求文档，不代表本轮实现回溯或已获其正式需求评审通过。后续显式暂存时包含该文档，仍排除Human既有未跟踪graph Procedure及临时node_modules链接。合入由Human执行，保留正常产品验收与CI门禁。


## 2026-10-29 Human 限定：先处理 ValueStore 内部锁能独立覆盖的场景

Human要求先全部解决可由ValueStore内部锁解决的调用方加锁，其他问题暂不处理。已盘点现有内部记录锁/CAS及调用方外层协调，范围和处理见valuestore-lock-audit.md。移除单记录CommandState创建外层Home锁，保留相同绑定幂等与不同绑定并发冲突；不以此宣称Project整体锁或daemon竞争已解决。本指令在修订3冻结后提出，旧候选/旧票保留，新实现须纳入后续新候选验收。


### 后续范围调整：清除 Project 级锁

Human 要求逐个审视实际场景，直到清除所有 Project 级锁。首项确认：不要求 Store 绑定变更与在途数据操作瞬间同步，已打开的普通数据操作继续使用原绑定完成，后续操作使用届时可见的新绑定。当前实现正在逐项修订，不以第4轮候选或旧票代表新增范围验收通过。


### 模型生效及旧登记兼容

Human 确认模型定义先写、登记后写；登记包含定义原始内容哈希，不匹配或未登记不可用。旧登记缺少哈希时使用过程中自动通过 ValueStore CAS 补齐。普通模型 CRUD 移除 Project 锁；DataStore 锁与 CAS 暂不修改。维护/升级仍按实际场景逐项清理。


### 维护操作日志登记

按 Human 指令，移除 settings.lock，维护操作及恢复通过日志模块原子领取执行权，已有活动请求则立即报 MODEL_OPERATION_BUSY，不等待；进程退出后允许重新领取并恢复。底层保留日志专属非阻塞资源锁，普通操作不参与。其他 Project 生命周期锁继续逐项审视。


### Project 生命周期及 Embedded Memory 修复

按 Human 指令移除 Home projects/<name>.lock。创建/克隆原子领取目录，完成准备后才登记；未完成目录不可外部使用。已有 Project 登记在 Registry 自身更新边界内检查并修改。Embedded 修复按实际 Memory 目录非阻塞领取，重校验快照并保护外部新内容。后续继续逐项处理 Project 范围的 Memory ChangeSet 锁。


### ChangeSet 并发约定

按 Human 四项批注移除 memory-publish.lock：不新增校验结果新鲜度保护，同一 ChangeSet 接受后写覆盖，不强制唯一活动市场导入/系统升级。正式写入按实际工作树非阻塞领取，重叠发布立即失败，与系统 Memory 修复共用执行权。其他 Project 维度迁移锁仍待下一场景审视。


### 2026-10-29 按实际写入对象移除不必要的 Run 大锁

Human 要求同时按“确实存在并发”和“并发修改同一个对象”审视 Run 锁，并授权移除已识别的不必要锁。Context Control 的 Graph findRun、snapshot、Artifact 内容读取和绑定查询不再获取 Run 锁；终态自由探索查询同样不获取 Run 锁。运行中的自由探索查询仍保留既有恢复语义，但锁只包围恢复，查询和正文读取在锁外。

Graph 个人 Review 草稿、领取和 Attempt 状态更新、提交后的停止原因登记、单 Step 意见处置及 enter 移除 Run 锁，沿用 ValueStore 记录 CAS。个人 Review 更新和 enter 不再先推进整个 Run；恢复/调度仍由 status/advance、正式 report/submit/finish 等入口承担。两个调用同时进入同一 pending Step 时，通过 CAS 确定赢家，另一调用读取赢家的 running Step，复用原身份和 startedAt，不新建 Step。

自由探索 recordRead 不再获取 Run 锁，仍保持记账失败不影响阅读、超时及 CAS。tag、addExternal 和轻量 review 改为独立记录写入，不再调用夹带全 Run redo 的 write 包装。权限和终态前置检查保留；不新增跨记录原子事务，不承诺无锁查询是全 Run 原子快照。

本批没有移除 Graph 推进、正式上报/投票结算、Run 本体更新，以及旧 flow 同一 Run JSON 文件更新的锁。这些入口存在共同记录写入，留待下一场景逐个分析。本批亦未把自由探索 create/report 的全 Run 恢复改造成按 Artifact 恢复。

新增真实原生 Run 锁占用测试，覆盖占用期间 Graph 查询/读取/绑定/进入、个人 Review/停止原因和不同 Step 意见处置，以及自由探索标签、External、轻量反馈和读取记账。另通过暂停一人的 Review 更新验证他人可继续、同一记录过期写入仍被 CAS 拒绝，并验证并发 enter 复用 startedAt。原“report 开始即阻止读取记账”的测试改为实际写入时序：Artifact 尚未提交时允许记账，报告完成后保留已登记读取。

验证：首轮五文件 78 项中 76 项通过，两处失败分别是新增夹具使用不存在的 disposition 枚举及旧记账串行断言；修正后两文件 32/32 通过。最终源码 CLI 适配下四文件 30/30 通过，覆盖并发重复 enter、独立 CLI 进程完成不同 Step、Review、Continue、查询和模型契约；记账时序最终专项 2/2 通过。合计 106 个不同相关测试均通过，类型检查与 git diff --check 通过。日志 /tmp/memsphere-run-unlock-tests.log、/tmp/memsphere-run-unlock-rerun.log、/tmp/memsphere-run-unlock-source-integration.log、/tmp/memsphere-run-unlock-accounting-final.log、/tmp/memsphere-run-unlock-types-final.log。CLI 测试最初误用旧 dist 的运行已停止，不计入当前验证；最终由 /tmp/memsphere-run-source-cli.mjs 将 execFile 子进程指向当前源码。未重建或替换冻结 dist，不代表已安装 daemon 已更新，亦不替代后续正式候选验收。


### 2026-10-29 去除单记录 CAS 更新的重复 Run 锁

按 Human 要求，先删除两处没有附带跨记录写入的 Run 锁：ContextControl.archive（包括恢复展示）及 GraphRuntime.updateBinding。两者仍读取当前 Run revision，通过 ValueStore expectedRevision CAS 更新；同记录竞争的过期写入返回 REVISION_CONFLICT，不新增外层锁或无条件重试。归档的运行状态检查、相同可见性不重复写入，以及绑定更新的权限/Actor/Slot 预检、仅影响后续轮次的契约保持原有行为。

本批没有把仍混合恢复、调度或跨记录写入的 report、submitReview、finish、abandon、updateOutputs 改成无锁；也未修改旧 flow JSON 文件的写入锁。它们需要继续分离单记录更新与附带工作。

验证新增/扩展真实 Run 锁占用用例：持有同 Run 原生锁时仍能归档、恢复展示及更新绑定；暂停第一份 Run 写入，第二个独立 Service 先提交，第一份陈旧归档/绑定更新均由底层 CAS 拒绝，赢家内容不被覆盖。沿用 Graph 后续轮次绑定和生命周期回归。

验证结果：三文件 41/41 通过，类型检查与 git diff --check 通过。日志 /tmp/memsphere-run-cas-unlock-tests.log、/tmp/memsphere-run-cas-unlock-types.log。未重建 dist 或更新已安装版本；本批仍需随新候选进行正式验收。


### 2026-10-30 updateOutputs 移除 Run 锁及隐式 redo

Human 确认 updateOutputs 仅检查产物并通过 CAS 修改成果集合，不负责恢复整个 Run。实现由 write 改用 writeRecord：保留运行状态检查、参数互斥检查、加入产物必须完成、移除产物必须存在，以及 Run.outputOverrides 的 expectedRevision CAS；不再获取 Run 锁或执行 redo。返回成果集合使用只读 snapshotValue，不经会恢复的 snapshot/outputs 入口。未完成恢复的产物保持未完成，后续由 run status 恢复。

验证三文件 37/37 通过，类型检查及 git diff --check 通过。新增用例在同 Run 原生锁占用期间操作成果集合，并通过两个 Service 的竞争验证过期更新由 CAS 拒绝。注入 Artifact 已保存、Step 未完成的中断，验证有效成果更新不恢复该 Step，加入未完成产物明确失败且不改变 Step；显式 status 恢复仍复用原提交身份；终态不允许更新成果集合。日志 /tmp/memsphere-update-outputs-unlock-tests.log、/tmp/memsphere-update-outputs-unlock-types.log。未重建 dist 或修改正式冻结候选。

下一场景拟讨论自由探索 createArtifact：当前 write 前置 redo、创建 Artifact 后又 redo，均扫描整个 Run；本次尚未修改它。拟只创建本次独立 Artifact/Step，去掉全 Run 扫描和外层 Run 锁，中断由既有 status 恢复原始身份。该后续方案仍待 Human 确认。


### 2026-10-30 createArtifact 仅创建本次 Artifact/Step

Human 确认 createArtifact 去掉 Run 锁及创建前后两次全 Run redo。实现由 write 改为 writeRecord，读取运行状态、可选修订来源并生成独立 Artifact/Step ID 后，先创建本次 Artifact，再直接创建与其关联的 running Step。不扫描或恢复其他产物，不修改 Run 本体。保留名称、标签、修订来源检查；中断后由 run status 根据已保存 Artifact 内的 Step ID 恢复，不回滚或重建其他记录。

验证三文件 38/38 通过，类型检查与 git diff --check 通过。新增真实 Run 锁占用期间两个 Service 并发创建不同 Artifact/Step 的用例，验证 ID 独立、关系正确、修订名称/标签继承、Run 本体不被改写；注入另一条草稿创建中断并禁止扫描列表，验证后续创建不修复该遗留 Step，显式 status 才按原身份恢复。已有 Artifact/Step create 前后故障注入回归及终态拒绝创建均通过。日志 /tmp/memsphere-create-artifact-unlock-tests.log、/tmp/memsphere-create-artifact-unlock-types.log。未重建 dist 或修改正式冻结候选。

下一场景拟讨论自由探索 report：write 前置 redo、提交后 redo 及标签依赖使用 snapshot 的隐式恢复均仍存在。拟去掉外层 Run 锁和全 Run 恢复，提交已有草稿用 Artifact CAS，直接提交用独立 ID 创建，只补建/完成本次 Artifact 的 Step（已有 Step 用 CAS）；标签依赖查询改用只读快照。跨记录中断继续由 status 按已保存身份恢复。此后续方案尚未实施，待 Human 确认。


### 2026-10-30 自由探索 report 按产物提交与恢复

Human 确认自由探索 report 移除 Run 锁和全 Run 恢复，标签依赖只读查询。report 改用 writeRecord，保留运行状态/参数/正文/修订/依赖检查；标签选择改用只读 snapshotValue，仅匹配已完成产物。已有草稿提交仍用 Artifact expectedRevision CAS，直接提交创建独立 Artifact ID；提交后只调用 redoArtifact 处理本次关联 Step，补建缺失 Step 或通过 Step CAS 完成，不触碰其他待恢复产物。原 redo 提取后复用此单产物恢复逻辑，仍仅在原有恢复/生命周期入口扫描整个 Run。发生持久化后错误继续携带原 Artifact/Step 身份和 status 恢复命令，不把重发 report 当成幂等恢复。

去除全 Run 串行后，运行期间已经通过状态检查的提交允许与 finish/abandon 交错完成，Run 终态后发起的新提交仍报 RUN_FINISHED。测试不再把“某入口先拿 Run 锁”当作跨记录排序承诺，不新增 Run 版本占位写入或跨记录原子事务。

验证首轮三文件 40 项中 36 通过，四处旧原生锁占用夹具因 report 不再顺带创建锁目录而报 ENOENT；夹具自行建立目录后该文件 7/7 通过，合计 40 个不同相关测试均通过。新增验证：同 Run 锁占用下直接提交与草稿提交并发完成；标签依赖不包含、也不恢复另一条已存正文但未完成 Step 的产物；显式未完成依赖报错；Run 本体不被改写；Artifact CAS 竞争只保留赢家正文；Step CAS 竞争保留已写入的读取记账，status 按原身份完成已保存提交。既有 Artifact/Step 各写入边界前后中断、内容引用和生命周期回归通过。类型检查与 git diff --check 通过。日志 /tmp/memsphere-report-unlock-tests.log、/tmp/memsphere-report-unlock-rerun.log、/tmp/memsphere-report-unlock-types.log。未重建 dist 或更改正式冻结候选。

下一场景拟讨论自由探索 abandon：当前仍通过 write 包装获取 Run 锁并在废弃前全 Run redo。拟直接读取 running Run，通过 CAS 更新 status/endedAt/abandonment，不恢复任何 Artifact/Step；Graph abandon 的 Review 取消和进程终止另行讨论。此后续方案尚未实施，待 Human 确认。


### 2026-10-30 自由探索 abandon 直接 CAS 更新 Run

Human 确认自由探索 abandon 去掉 Run 锁和全 Run redo，只通过 CAS 更新废弃状态。实现读取 running Run 后，以该记录 revision 更新 status=abandoned、endedAt 和 abandonment（source/reason）。不恢复或修改 Artifact/Step，不新增协调锁，不无条件重试冲突；原有终态拒绝行为保留。Graph 分支保持原有取消评审/终止进程流程。通用 write 包装已无调用，随本批删除，避免后续独立操作再次夹带全 Run 恢复。

验证三文件 41/41 通过，类型检查与 git diff --check 通过。新增用例在同 Run 原生锁占用期间，通过两个独立 Service 竞争废弃，先提交者的状态、时间、来源和原因保留，过期更新报 REVISION_CONFLICT；已有 Artifact 但缺失 Step 的中断记录保持原样，不被废弃顺带补建；重复废弃及终态后新 report 拒绝；finish 先提交 Run 后，过期 abandon 同样由 CAS 拒绝，不能覆盖 done。日志 /tmp/memsphere-abandon-unlock-tests.log、/tmp/memsphere-abandon-unlock-types.log。未重建 dist 或更新冻结正式候选。

下一场景拟讨论自由探索 finish：当前仍在 Run 锁内 redo 全 Run，然后选择/校验成果，并 CAS 保存完成状态、成果根和结束时间。拟移除该分支 Run 锁及 redo，使用只读成果集合和依赖检查，基于读取成果时的 Run revision 一次 CAS 保存完成信息；未完成产物不自动恢复，显式选择未完成产物拒绝，需先 status 恢复。重复 finish 的既有幂等行为保留；Graph finish 的自动推进/完成检查另行讨论。此后续方案尚未实施，待 Human 确认。


### 2026-10-30 自由探索 finish 只读检查及 CAS 完成

Human 确认自由探索 finish 移除 Run 锁和 redo，保留 CAS 及重复完成幂等。实现先读取 Run 及其 revision，只读获取成果/Step、依据该 Run 的成果配置选定 roots 并校验依赖，然后以同一 revision 一次 CAS 保存 status=done、outputOverrides 和 endedAt。不复读较新的 revision 来覆盖基于旧版本作出的成果选择，不自动恢复未完成记录。

已经 done 且成果选择一致时直接返回，不改记录 revision 或 endedAt。并发两个相同 finish 时，CAS 失败者仅在重新只读确认已完成成果一致后复用赢家结果；不重写，不对不同成果或其他状态变更重试。不同成果完成、废弃或成果配置变更先提交时，过期 finish 保持 REVISION_CONFLICT。显式选入未完成产物拒绝，原 Artifact/Step 保持不变。Graph 分支仍在原有 Run 锁内执行推进/完整性检查和正式完成，本批不改变它的协调方式。

验证三文件 43/43 通过，另补实际 ContextControl.finish Graph 分流用例 1/1 通过，共 44 个不同相关测试通过；类型检查、git diff --check 通过。覆盖原生 Run 锁占用下完成及重复完成、不恢复未完成产物、重复显式成果去重、默认重复完成不写回；并发相同完成复用赢家整条记录，成果不同/abandon/成果配置更新赢家均不被陈旧完成覆盖。Graph 补测覆盖未完成拒绝、显式成果完成及重复完成不改记录。日志 /tmp/memsphere-finish-unlock-tests.log、/tmp/memsphere-finish-unlock-routing-tests.log、/tmp/memsphere-finish-unlock-types.log。未重建 dist 或更改冻结正式候选。

下一场景拟讨论自由探索 findRun（listRuns 逐条调用它）：当前查询 running Run 时仍获取 Run 锁并 recover 全 Run。拟仅读取 Run 及校验状态，不执行恢复；run status 经 snapshot 的恢复能力保持，snapshot/readArtifact 本身的恢复锁后续逐项讨论。此后续方案尚未实施，待 Human 确认。


### 2026-10-30 findRun/listRuns 只读查询

Human 确认 findRun 去掉 Run 锁及附带恢复，listRuns 也只读，并保留 run status 的恢复能力。findRun 现在只读取 Run、校验 running/archived 状态并返回，不扫描 Artifact/Step，不 recover；listRuns 继续逐条调用 findRun，不新增写入。status 命令仍经 snapshot 的既有恢复入口处理当前 Run，本批未改变 snapshot 或 readArtifact 的恢复流程。

验证三文件 45/45 通过，类型检查与 git diff --check 通过。新增用例注入 Artifact 已保存、Step 尚未创建的中断，持有同 Run 原生锁时 findRun/listRuns 仍完成，缺失 Run 返回 undefined，既有 Run/Artifact 记录原样保留且不补建 Step；随后真实执行当前源码 CLI run status，按原 Artifact/Step ID 补建缺失 Step，Run 记录本身不被重写。测试使用 --import tsx 的源码入口，不重建当前运行 daemon 的 dist。日志 /tmp/memsphere-find-run-readonly-tests.log、/tmp/memsphere-find-run-readonly-types.log。

下一场景拟讨论合入 master 后新增的 View 只读入口 findViewRun、viewProjection、readViewArtifact：均不执行恢复、不写领域记录，但仍套 Run 锁。拟移除这些只读入口的外层 Run 锁，保留定向加载、身份/状态校验和正文校验。此后续方案尚未实施，待 Human 确认。


### 2026-10-30 View 三个只读入口去掉 Run 锁

按 Human 确认，findViewRun、viewProjection、readViewArtifact 去掉外层 Run 锁；保留既有定向加载、身份/状态校验、已完成 Artifact/Step 校验和正文校验。overview 不加载 Artifact/Review，artifacts/action 投影不返回正文；View 查询不恢复中断操作，不补建 Step。

相关四文件 31/31 测试、类型检查通过；修正不完整产物测试的目标 ID 后，View 读取测试再次 4/4 通过。持有同 Run 原生锁时覆盖三个入口及 Graph 三种投影；不完整 Artifact 仍被拒绝，缺失 Step 未被查询修复。日志 /tmp/memsphere-view-read-unlock-tests.log、/tmp/memsphere-view-read-unlock-types.log、/tmp/memsphere-view-read-final-tests.log。本次只修改源码与测试，未重建运行中 daemon 的 dist。

下一场景拟讨论自由探索 readArtifact：读取单个产物前仍对 running Run 获取 Run 锁并 recover 全 Run。拟去掉这层锁及隐式恢复，直接保留目标 Artifact/Step 完成状态、身份及正文校验；中断状态由 run status 恢复。该后续方案尚未实施，待 Human 确认。


### 2026-10-30 自由探索 readArtifact 去掉 Run 锁与隐式恢复

按 Human 确认，自由探索 readArtifact 不再获取 Run 锁或 recover 全 Run；仍 require Run，并通过 complete 校验目标 Artifact/Step 身份及完成状态，通过 body 校验正文或 contentRef SHA-256。Graph 读取路径保持原样。

扩展原生锁占用用例：锁占用时已完成产物可读，缺失产物与缺失 Step 被拒绝且不补建；释放锁后显式 snapshot 恢复 Step，draft 仍按未完成产物拒绝。四文件 31/31 测试及类型检查通过，日志 /tmp/memsphere-artifact-read-unlock-tests.log、/tmp/memsphere-artifact-read-unlock-types.log。未重建运行中 daemon 的 dist。

下一场景拟讨论自由探索 snapshot/run status 的恢复锁：保留显式全 Run 扫描恢复能力，考虑去掉外层 Run 锁，依靠缺失 Step 创建的唯一性和现有 Step 更新 CAS 防止覆盖；并发冲突沿既有恢复错误返回、允许重试，不额外引入全 Run 事务。该后续方案尚未实施，待 Human 确认。


### 2026-10-30 按 Human 授权继续清理剩余 Run 锁

Human 授权自主处理可以决策的剩余场景，遇产品/风险选择再停。自由探索 snapshot/run status 保留扫描与显式恢复，去掉外层 Run 锁；缺失 Step 由 create 唯一性保护，现有 Step 由 CAS 更新，竞争失败沿 RECOVERY_REQUIRED 返回原因，重试恢复。findRun/listRuns/readArtifact/View 查询继续保持前述只读行为。

Graph advance、report、submitReview、finish、abandon，以及 ContextControl Graph finish 外层不再获取 Run 锁。删除 ContextControl/GraphRuntime 的 RunLock 参数及重入锁包装，删除 openContextControl 的 Run 锁工厂；各实体仍经 ValueStore create/CAS。report 和 submitReview 不再先 advance 全 Run；保存本次提交/投票后保留既有结算与自动推进。已有未恢复提交帧时 report 返回 RECOVERY_REQUIRED 及原产物身份，不覆盖已保存提交；投票保存后推进失败附 reviewId/roundId 及 status 恢复指令，不提示重投。

针对实际竞争补充处理：推进重新读取 Run 后跳过已消费 completion，collect 重新读取 Step 后跳过已完成记录；materialize 跳过已移除 pending 项；恢复始终跟随原 submission frame ID，帧已移除或更换即返回，不覆盖其他恢复者的结果；settle 复用已有提交帧。finish 绑定校验用 Run 版本并检查完成 Step 已被消费，最后 CAS 保存终态。abandon 重新读取 Review 后跳过已提交/已取消者，Review CAS 成功后才终止对应 worker，取消冲突可重试。未引入新的资源级大锁或多记录事务。

测试覆盖持有旧 Run 原生锁时恢复/Graph 提交、投票、推进、结束和废弃；并发缺失 Step 创建、恢复 Step CAS 保留 reads、同 Step 提交冲突、不同 Step 各自保存、同帧双重恢复、旧推进不重复派生 Step、独立 Reviewer 投票、终态 Run CAS 保留赢家变更。相关既有测试按此前 Human 批准的 findRun/listRuns 只读与无锁 snapshot 契约更新。当前运行 daemon 的 dist 未重建，正式验收旧轮不代表本次源码候选通过。

剩余边界：src/run/store.ts 仍有 16 个 withRunWriteLock 调用点，全部读取并回写旧 Flow 的同一个 Run JSON，未走 ValueStore，没有 CAS；与已清理的 Graph/自由探索多记录 Run 锁不同。直接去掉会产生最后一次整文件保存覆盖其他修改。继续清理这组需要将旧 Flow 迁入记录存储或引入文件版本条件写，这属于额外存储改造范围，停在此处交 Human 决策。

最终验证：15 个相关源码测试文件 149/149 通过（包含 7 项 Graph 并发专项），npm run typecheck 与 git diff --check 通过。日志 /tmp/memsphere-run-lock-cleanup-regression.log、/tmp/memsphere-run-lock-cleanup-types.log。源码扫描确认 ContextControl、GraphRuntime 及 Project 打开入口无 RunLock 或 this.lock 调用；剩余 16 个调用点均已在锁审计清单列出。


### 2026-10-30 新一轮评审范围确认

Human 明确决定旧 Flow 存储改造“不纳入”，因此保留 src/run/store.ts 中 16 个真实共写同一 Run JSON、且没有 CAS 的写锁。此前“待 Human 决策”的范围问题在此关闭；不得把旧 Flow 存储迁移或文件 CAS 扩展为本轮实现任务。Human 随后正式投要求修改并要求重新发起一轮 Review：以最新完整实现作为新候选，旧票保持历史，不转移到新版本。


### 2026-10-30 新候选准备与全量回归契约对齐

正式 Human 第4轮 request_changes 已通过当前 CLI 写入，旧轮 changes_requested；七条非阻塞建议/风险已逐项 accepted-followup，完整处置留 Run 候选，旧票不转移。此前首次用旧 dist 代提交时遭旧 Run 原生锁 LOCK_TIMEOUT；停止旧 daemon、构建当前分支后重试成功，新 daemon 恢复原 View running 状态。此处是实际操作观察，不替代并发测试。全局 memsphere 安装入口未重定向，Reviewer 使用当前分支受限 CLI。

新候选前全量回归发现历史/合并新增夹具仍假设“只写模型定义就可读”、系统外部改定义立即生效，以及市场导入必须共用一个活动 ChangeSet。按 Human 已批准契约对齐：模型展示/反射夹具使用配套登记与 definition_sha256；专门测试登记初始化的场景保持未登记起点；未登记读取明确拒绝，篡改系统定义明确断言 MODEL_DEFINITION_HASH_MISMATCH，不放松生产检查；两个市场导入分别核对自己的活动 ChangeSet，保留原导入状态断言。新增测试辅助文件仅服务隔离 fixture，不进入生产路径。全量初跑与失败后的受影响文件复核分别留原始结果，新候选如实列出，不能把首跑失败改写为一次全通过。


### 修订5最终验证补充

全量初跑183文件保留10个失败的原始记录；按当前已批准契约修正模型登记夹具与旧预期后，12个受影响文件复核全部通过。Graph跨进程测试保留保存身份、可恢复冲突错误码与恢复后不丢提交的断言。7项新增Graph并发用例并入现有Run锁测试文件，全部保留并复核通过；当前发现182文件，CI原执行预算不变。最终覆盖依据为初跑加受影响文件复核，不表述成一次全通过。


### 2026-10-30 Human 修订：可禁用 ACP 运行超时

本条替代此前必须启用 idle 超时的约束。ACP Provider 的 idle_timeout_ms 接受正整数或 null；省略与 null 均表示不启用 idle 超时。max_runtime_ms 同样接受正整数或 null，默认不限制总运行时间。startup_timeout_ms 保持原有启动超时语义。此处不引入工具执行超时，也不以其他默认时限间接限制工具耗时。

配置、ControlPlane 快照与 Provider launch 允许 nullable idleTimeoutMs。context-control Run 的模型运行时不支持联合类型，因此持久化 permissionConfig 时与现有 maxRuntimeMs 一样省略 null；idleTimeoutMs 改为可选，读取省略字段还原为 null。不扩大通用 JSON Schema Runtime 的支持范围。已冻结的正整数不被默认值覆盖，既有 Run 不因配置默认值变化而自动变更。若显式启用 idle，其语义仍是 ACP 活动静默时限。

进程意外退出（包括退出码 0、非零及信号退出）和 ACP 连接提前关闭均通过事件监听直接失败，不等待 idle/总时限，也不新增控制这两项检测的开关。ACP Client 使用独立 transport AbortSignal 中止未完成请求；正常完成请求并确认正式提交后的主动连接关闭和进程清理保持成功。断连诊断为 agent_connection_closed，进程退出为 agent_process_exit；超时显式启用时保留原超时诊断。

验证须覆盖默认/显式 null 配置与快照、静默会话正常结束、全部运行超时禁用时进程正常码提前退出/非零退出/进程仍活着但输出连接关闭、显式启动/idle/总超时，以及正常正式提交。共享工作区 dist 构建与临时日志隔离另行处理，不混入本条变更。

本修订发生在第5轮冻结候选之后；第5轮意见不能作为此新增实现的通过证明，后续候选需重新冻结代码与验证证据。本次不重建评审进程正在使用的共享 dist，也不手改既有 Run 的冻结配置。

验证结果：独立临时副本 `/tmp/memsphere-null-timeouts-validation-bph_d0vp` 执行完整 npm run build 通过（含两套 TypeScript 编译与模型检查）；agent-review、control-plane、procedure-graph-review、context-control 四文件共73项，72通过、0失败、1个平台专项跳过。原始日志 `/tmp/memsphere-null-timeouts-isolated-build.log`、`/tmp/memsphere-null-timeouts-isolated-tests.log`。此前共享 dist 模板缺失导致的失败记录保留，不计为实现通过证据；现场 dist 未由本次构建覆盖。


### 2026-10-30 Human 修订：Reviewer Attempt 工作目录隔离

每次 Reviewer Attempt 在主 Agent 调用 Memsphere 时的当前工作目录下创建 `tmp/memsphere-review-<随机唯一值>/`，不提升为 Git 根目录。新重试创建新目录，不复用上一 Attempt。目录不预置 artifacts/scratch 等子目录，也不复制代码或预下载 Artifact；Reviewer 按需使用既有读取/导出能力，自行组织本地材料。

派发时将原始调用目录作为绝对路径传给 worker；异步 daemon 从 DaemonTask.input.cwd 取得调用目录，不使用 daemon 自己的工作目录。Provider 子进程 cwd、ACP session/new cwd、会话受限 CLI 的 workspaceRoot，以及 TMPDIR/TMP/TEMP 均指向本 Attempt 目录。受限 CLI 启动器继续由内部独立管理，不作为 Reviewer 目录布局要求。

正常完成、失败和可执行 finally 清理均删除该 Attempt 目录，活动日志和正式投票继续保留在原 Run Store。强制杀死 worker 时 finally 无法保证执行，可能留下目录；不在此处增加全局锁或后台清扫机制。原仓库已有 tmp/ Git 忽略规则。cwd/临时目录变量提供默认位置隔离，不能约束硬编码绝对路径；强制文件系统访问边界由 Provider 沙箱提供，本次不新增容器/挂载隔离，也不重新建模或物化代码 Artifact。

验证包括：主调用目录处于嵌套目录时不回退到 Git 根、两次 Attempt 目录不同、子进程与 ACP cwd 一致、三个临时变量一致、成功/失败清理、真实 Session CLI 从隔离目录完成读取与提交。新增方案在第5轮候选之后，后续评审必须重新冻结。

本条验证结果：独立副本 `/tmp/memsphere-attempt-isolation-validation-12t6j92p` 完整构建通过；agent-review、procedure-graph-review、daemon-integration 三文件共46项，45通过、0失败、1项平台专项跳过。实际 fake ACP Provider 校验进程 cwd、session/new cwd、TMPDIR/TMP/TEMP 全部一致；重试目录不同，成功/失败目录清理和真实 Session CLI 读取/提交通过。原始日志 `/tmp/memsphere-attempt-isolation-build.log`、`/tmp/memsphere-attempt-isolation-tests.log`。现场共享 dist 与运行中的 Reviewer 未被本次构建覆盖。

交付前兼容补充：已为此前发布的 Run 定义（definitionHash 8b4604ec…）加入显式、仅更新定义的升级路径，保留 Run 记录版本；Graph Review adapter 将持久化省略的 idleTimeoutMs 还原为 null。context-control-upgrade 与 procedure-graph-review 两文件18项回归通过。按 Human 要求，现场现有 Run 的 Agent idle 配置通过 data edit + CAS 禁用，未改变角色、权限和模型。


### 2026-10-30 Human 修订：Agent 等待与 Human 验收分线

同步和异步 review wait 共用相同就绪判定，仅等待本轮 Agent Assignment：全部 Agent 正式提交或任一 Agent 执行失败时返回/发送继续通知；Human 的草稿、提交、投票内容不参与该判定。没有 Agent 要等待时立即返回，异步模式也不登记任务；已可返回的同轮重复 wait 不生成新任务。终态/轮次变化仍沿现有取消与返回规则处理。

Agent 意见收齐后，Runner 可独立阅读、处置并提交本人的 approve/request_changes，不等待 Human。approve 保留最终 Human 正式投票门禁，不将缺票视为批准；request_changes 可结束当前候选并进入修订，不要求 Human 为已被 Runner 否决的候选补票。Human 提前提交的有效票保留在原候选，不提前释放 Agent 等待，也不迁移到修订候选。新候选开启后旧轮 Human 提交按既有轮次冲突拒绝。

继续提示顺序为 Agent 执行/重试 → Runner 处置与决定 → Human 最终验收；不再在 Agent 尚未完成时提示先收 Human 票。Human 仍可自主提前投票，其操作不阻塞 Agent 执行、同步等待或异步唤醒。最终 unanimous 通过仍要求全部必需参与者正式提交并通过适用决策票；仅 Runner 要求修改允许提前进入修订，不允许缺 Human 票提前通过。

模型结构不新增状态或字段：整体轮次在 Human 待验收时仍可为 pending，Agent 等待完成与整体结算分离；已有 Review/vote、commentDispositions 记录两条线各自进展。Graph 和旧 Flow 同步等待、daemon、CLI 即时返回统一使用 artifactReviewWaitReady，Runner 就绪使用同一 Agent 完成判定。旧 Flow 保留此前明确排除改造的真实 JSON 写锁。

验证覆盖 Agent 执行时 Human 草稿更新不释放等待、全部 Agent 完成而 Human 未投时同步返回/异步发送、无 Agent 同步异步立即返回且无任务、重复 wait 无重复通知、Runner 在 Human 未提交时决定及修订、Human 最终验收不能绕过、旧轮投票冲突，以及既有发送失败/恢复/去重。


## 最终验收结果（2026-10-30）

实现验收第8轮 `round-67cd9018-f8a7-4036-ab93-2f0740971354`，冻结实现 commit `fa0dec4344e44579670a56ab869504f64f15232c`：研发、测试、架构 Agent 均正式通过；Runner 逐条处置6条非阻塞意见后通过；Human billtenor 以产品负责人/架构师身份明确回复“通过”，已受托提交，Review/Round 均为 passed。

官方全量回归在该冻结树一次完成182/182文件、0失败；研发与测试分别独立完整复跑全绿。Linux短TMPDIR条件及Windows平台skip已披露；相同生产源码的build/typecheck通过。最终Memory变更级校验 `change-20261030-031536690z-1676929d`，valid=true、issues=[]；此后Memory字节未变，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261030-031536690z-1676929d。

需求记录已归档，产品实现验收通过；本记录的completed_at不代表PR已创建、CI已完成或已合入master，原Run继续交付流程。Traex真实接收并继续和Windows实跑仍为合入前验证门禁，不因Human本轮通过而豁免。POSIX长socket路径及诊断、queue未知结果结构化错误码、失败Assignment内联指引等保留后续。完整交付范围、证据位置和边界见 delivery-report.md。

长期需求、方案、开发计划、锁盘点与交付报告随代码保留；本目录其余原始验收附件仍留本地及Run Artifact，不因归档纳入Git。另按Human要求交付 `changes/active/20261029-graph-run-backtracking/change.md`，仅需求概述，不实现回溯。
