# Runner Agent 身份与异步评审：实施与验证方案

## 依据与结论

基于已通过的需求产物 artifact-7f9caeed-1938-49da-a559-72ff6b622d1e，在 CLI 入口统一检测调用会话，以会话状态替代独立 Continue ID；以每个 Memsphere Home 一个统一 daemon 承载 View 与持久化异步等待、结果回发。保留现有评审引擎、权限与 ACP Reviewer 派发，不另建评审调度系统。

原方案第六轮已通过并完成实施；本文件按 Human 最新要求更新为修订3方案，随当前实现验收 Step 重新交各 Reviewer 审查，不将旧方案票用于本次变化。通用 DaemonTask、View 意图恢复和身份模式 wait/status 不自动 enter 已在前轮明确授权并回写 change.md；三行通知、配置驱动等待与去掉 --sync 以最新 Human 决定为准。历史评审条目保留，不把旧冻结产物冒充新版。

## 已调查的代码与可行性证据

- `src/config.ts` 的 Home `globalConfigSchema` 严格校验配置；`src/config-management.ts` 显式枚举编辑字段，新增配置必须贯穿读取、draft、归一化、diff、校验及保存，否则会丢字段。
- `src/commands/view.ts` 已有 ACP 探测与带 revision 的配置 API；配置界面实际在 `modules/org.memsphere.settings/adapter/view/settings-view.ts`。Runner 探测复用可执行文件定位/版本探测能力，但 Codex Runner 查找 `codex`，不是 Reviewer 的 `codex-acp`。
- `src/home/command-state-store.ts` 当前创建随机 context ID；`src/commands/continue.ts` 接收必填 context ID；`src/commands/context-control.ts` 与 `src/commands/procedure-graph.ts` 负责创建、提示、读取记账和关闭。全部需要一起替换，不能只省略 CLI 参数。
- graph 的 `stepPrompt()` 当前会创建上下文，`graphNext()` 可自动 enter 唯一就绪 Step。同步 review 输出也可能推进后续步骤，因此不能直接在后台调用现有打印函数并捕获 stdout，否则可能改绑前台会话。
- `src/commands/run.ts:runReviewWaitCommand` 当前负责 dispatch、wait、打印；`src/context_control/review-repository.ts` 适配 graph 与 legacy，两个分支都在评审不再 pending 或 assignment failed 时返回。后台必须保持同一返回条件，并额外固定登记轮次。
- `src/view/service.ts` 当前以 PID/状态文件管理独立 View 进程；`src/commands/view.ts` 提供 start/stop/restart/status/serve。新 daemon 需接管 View 生命周期并保持这些命令可用。`src/acp/dispatcher.ts` 的 Reviewer worker 保持现有派发，本轮统一 daemon 管理 View 和异步等待。
- Codex 源码 CLI 实测读取到当前 CODEX_THREAD_ID。产品 Reviewer 在真实 Traex attempt 中观察到 TRAECLI_THREAD_ID 与其 session ID 一致，这部分属于 Reviewer 提供的证据，Runner 未独立复跑 Traex 会话。
- Codex 与 Traex 的 `queue --help` 均已实际核对，支持 `queue --thread <THREAD> --message <TEXT>`；此前本聊天已有 Codex 外部 queue 发送与接收成功证据。新功能仍须补充两种 Agent 的功能端到端验证。

## 配置与界面

Home 增加独立 `runner_agents` 字段，首期结构为：

```json
{
  "runner_agents": {
    "codex": { "identity_enabled": false, "async_enabled": false },
    "traex": { "identity_enabled": false, "async_enabled": false }
  }
}
```

缺省等价两个开关关闭。异步开关依赖身份开关；界面先展示安装探测结果，未安装时显示提示与重新探测入口，不提供可操作的开关。关闭身份时同时关闭异步，并由配置校验拒绝异步开、身份关的非法组合。检测只执行对应 CLI 的版本/queue help 探测，不启动登录、安装或模型推理；PATH 探测有超时。

新增 Runner 配置分区和独立探测 API，沿用现有设置授权、revision 校验、draft/diff/保存链路和中英文文案。保存不修改 ACP Provider 和 Project `control_plane.runner.permissions`，不要求重启 CLI。安装状态是当前探测结果，不持久化为永久安装事实。

## Agent 身份

新增 Runner adapter 层，集中声明 Agent 类型、CLI 命令、会话环境变量与 queue 参数构造：Codex 使用命令 `codex`、变量 CODEX_THREAD_ID；Traex 统一使用命令 `traex`、变量 TRAECLI_THREAD_ID，首期不额外发现 `traecli` 别名，避免探测与发送选择不同程序。内部统一称 `sessionId`，对 CLI 回发使用 `--thread`。

纯检测函数返回已识别、缺失或冲突；分别记录身份开关与环境检测结果。多个非空会话变量同时存在时拒绝绑定，即使只开启其中一种，也不能凭开关猜测当前调用者。空白 ID 视作缺失；只识别白名单变量，不枚举和打印完整环境，不采用父 session ID。

复用 `src/acp/provider.ts` 已有环境白名单，并验证后续 agent.env、providerEnv 和 sessionEnv 合并不会意外注入父级会话变量；子 Agent 自己建立身份。daemon 使用登记时固定的接收身份，不依赖自身继承的 Agent 环境选择接收人。

Continue 先验证身份开关与无歧义会话，再解析状态，失败不写会话或业务数据。session ID 只用于上下文定位，Runner 权限继续由原有配置和冻结评审规则决定。

## 会话状态存储与 Continue

保留 `CommandState` 模型名称及 `memsphere/command-state.json` 模型 ID，修改其字段和身份语义；用 Home `data/runner-sessions` ValueStore 承载新结构。`data_id = agentType + "-" + sessionId`，例如 `codex-01a18246-2f05-7a11-b6b2-78bb69690bb2`。不 hash、不编码、不生成随机 context ID；具体模型改动见下节。

会话记录承载当前 commandGroup、Project、Run、可选 Step、active/closed、原有 reads/lastArtifactId 和更新信息。一个会话只保存一个当前生产上下文，历史业务与评审记录仍由 Run/Step Store 保存，不另造历史状态平台。无身份或身份关闭时原生命令不创建 Continue 状态，回执提示显式 Run/Step 命令。

`continue` 改为无 ID 路由，保留现有操作白名单、参数解析与业务 handler；旧 `continue context-...` 明确报错。Help、JSON 回执、报错、graph 提示、文档和 Skill 移除随机 context ID。身份有效但未绑定时，提示先通过原生命令启动/进入 Run 或 Step。

上下文更新原则：

- 自由探索 `run start` 绑定新 Run；graph 首次正式 enter 绑定 Step。显式启动或 enter 是用户选择目标的动作，可切换当前会话，但不得由无关只读查询或后台任务切换。
- Continue report 和 review 始终固定当前 Step；产物尚未接纳时不切换。Step done 后关闭该绑定，唯一后继正式 enter 时更新；多后继要求显式 enter。
- `run show`、`step show`、列表与所有 Run 的 status 不抢占绑定；status 可保留原有 graph advance 来收敛已完成的业务状态，但不自动 enter 后继。下方矩阵完整定义前台入口和后台入口的差异。
- 新会话继续自由探索通过显式 `run enter --run R` 绑定；graph 沿用 `run step enter --run R --step S`。前者只选择已存在的运行，不创建另一个业务实例。
- 身份开启且已有绑定 A 时，对目标 B 的原生 report/vote 等生产写命令在业务写入前拒绝并提示先 enter；同目标允许，无身份时仍按原生显式目标执行。显式 start/enter 才承担选择上下文语义，不让生产写命令隐式切换。
- 同一会话的单记录并发更新由 ValueStore 内部记录锁及 expectedRevision 原子校验保证，调用方不再获取 Home runner-sessions.lock；命令开始冻结绑定，写操作前核对仍为同一目标。冲突明确失败，不把读取到的旧目标结果写到新目标。跨会话可显式进入同一 Run，业务并发仍受原有锁与评审权限约束。
- 终态和关闭只影响匹配当前 Run/Step 的会话状态，不把已切到其他任务的会话错误关闭。旧 command-states 数据不再读取、不迁移、不主动删除，历史 Run/Artifact 保留原生访问能力。

## 数据模型改动

### CommandState：修改现有模型

模型 ID 保持 `memsphere/command-state.json`，源文件 `reserved-models/home-models/command-state.json`；同步更新 `src/home/command-state-store.ts` 的 TypeScript 类型、读写验证与例子。本次不再新增另一个同义的 RunnerSession 模型。

| 字段 | 本轮改动与约束 |
| --- | --- |
| Store `data_id` | 改为 `${agentType}-${sessionId}`，直接拼接；同一 Agent 会话更新同一条记录，Project/Run/Step 不参与计算。 |
| `id` | 保留，但值必须等于 Store 的 `data_id`，不再生成 context UUID，也不再作为 CLI 参数。 |
| `agentType` | 新增必填枚举 `codex` / `traex`。 |
| `sessionId` | 新增必填非空字符串，来自 adapter 确认的当前会话，原样保存，不 trim 后替换成另一个 ID。纯空白或首尾空白均拒绝。 |
| `commandGroup` | 保留必填；本轮仍为 `run`。 |
| `groupId` | 保留必填，保存当前 Run ID。 |
| `status` | 保留 `active` / `closed`，表示当前绑定是否可 Continue。 |
| `parameters.project` | 保留，必填 Project 名称。 |
| `parameters.step` | graph 必填、自由探索省略；运行时对照 Run 类型及 Step 所属关系校验。 |
| `state.lastArtifactId`、`state.reads` | 保留原有产物关联与读取记账；切换不同 Run/Step 时重置，避免旧上下文记账污染新目标。 |
| `updatedAt` | 新增必填 date-time，记录绑定更新、关闭及记账变化的时间。 |

示例（`data_id` 与 `id` 相同）：

```json
{
  "id": "codex-01a18246-2f05-7a11-b6b2-78bb69690bb2",
  "agentType": "codex",
  "sessionId": "01a18246-2f05-7a11-b6b2-78bb69690bb2",
  "commandGroup": "run",
  "groupId": "run-example",
  "status": "active",
  "parameters": { "project": "memsphere", "step": "step-example" },
  "state": { "reads": {} },
  "updatedAt": "2026-10-28T13:00:00Z"
}
```

拼接前校验 sessionId 与最终 data_id：调用现有 `validateFilename`，要求是合法的单个可移植文件名，拒绝路径分隔符、控制字符、保留名称、不合法 Unicode和过长 ID；大小写别名冲突由 ValueStore 写入时的 portableNameKey 检测拒绝；还须校验 `${data_id}.json`，实际 data_id 上限为 250 字节/字符，测试覆盖 250 可写与 251 在输入阶段拒绝，不私自放宽。输入不合法时直接报错，不回退 hash 或静默规范化。JSON Schema 负责必填、类型和枚举，运行时负责 `id === data_id === agentType + '-' + sessionId`、目标归属与可移植文件名约束；Store 的 revision 用现有元数据，不再复制一个业务 revision 字段。

旧 Store `data/command-states` 不再打开、不迁移、不主动删除，新代码只打开 `data/runner-sessions` 并以新版 CommandState 模型验证，避免用新版 schema 扫描旧记录。历史 Run/Step/Artifact/Review 数据保持原有 Store 与模型；进入旧 Run 时根据当前会话建立新状态。关闭后重新 enter 仍复用同一 data_id。

### DaemonTask：新增通用后台任务模型

新增 `memsphere/daemon-task.json`，源文件 `reserved-models/home-models/daemon-task.json`，登记 `reserved-models/manifest.json` 的 Home 模型清单；ValueStore 为 Home `data/daemon-tasks`。不新增专用于 ReviewWait 的模型或 Store。首期只注册 `review-wait` 处理器，不引入插件协议或任意命令执行平台。View 是常驻服务，启停意图另行持久化，不包装为 DaemonTask。

| 字段 | 结构与用途 |
| --- | --- |
| Store `data_id` / `id` | `task-<UUID>`，id 等于 data_id；任务标识与 CommandState 的会话定位无关。 |
| `type` | 必填字符串，首期支持 `review-wait`；未知处理器报 unsupported_type，不执行任意代码。 |
| `status` | 必填枚举 queued/running/completed/failed/cancelled；表示包括等待及发送在内的完整任务生命周期。 |
| `input` | 必填对象，按 type 校验；review-wait 保存 project、runId、reviewId、roundId，graph 必填 stepId，legacy 省略 stepId；以及 configPath、cwd、运行入口信息。 |
| `recipient` | 可选 `{agentType, sessionId, agentCommand}`；review-wait 必填，来自调用环境检测，禁止 CLI/配置覆盖接收会话。 |
| `error` | failed 或 cancelled 时必填 `{code, message, stage}`；stage 为 wait/render/send/cancel/recovery。cancelled 必须 stage=cancel，code 为 round_changed 或 runner_disabled；failed 使用对应失败阶段。不在日志输出正文或令牌。 |
| `daemonInstanceId` | 认领后保存当前 daemon 实例标识，结合锁/CAS 避免多实例处理。 |
| `createdAt`、`updatedAt` | 必填 date-time。 |

review-wait 业务去重键在同一 Home 下为 `(type, input.project, input.runId, input.stepId或缺省标记, input.reviewId, input.roundId, recipient.agentType, recipient.sessionId)`。锁内完整分页查询并创建或复用原任务，更新使用 expectedRevision。不同任务类型由自己的处理器定义输入校验与去重规则；公共 Store 不解释 Review 字段。

任务只有一套状态：queued → running → completed；对于 review-wait，running 覆盖等待评审和发送通知，queue 返回成功后才 completed（不表示 Agent 已处理消息）。等待、渲染或发送失败统一进入 failed，error.stage 区分 wait/render/send/recovery；轮次变化或配置关闭进入 cancelled，统一在 error 保存 stage=cancel 及 code=round_changed/runner_disabled。不保存 result 或 delivery，也不另建投递子状态。

发送时按 input 中固定的 Review/轮次读取业务记录，仅生成三行继续通知；任务 Store 不保存结果正文。重试重新核对权限、配置及轮次，重新读取和渲染；允许不同时间或版本下文字变化，不要求与首次尝试逐字一致。轮次过期则取消旧任务，不向新轮次误投。completed 不重新发送，failed 通过显式 retry 重试整个任务。

daemon 重启时恢复 queued；旧实例的 running 任务因可能已调用 queue 而无法确定投递结果，转为 failed + error.code=execution_interrupted，等待显式 retry，不自动重发，不新增额外状态字段。这意味着恢复运行中任务采用保守失败，而不是保证重启后所有等待都自动继续。正常 daemon stop 优雅中止仍在等待中的任务并将其退回 queued；若发送已开始则等待有界完成，结果不确定按 failed 处理。发送成功但完成状态尚未保存时崩溃存在重复通知的可能，不承诺 exactly-once。

### View 期望状态：持久化服务配置

Home `.runtime/daemon-services.json` 保存 `{version:1,view:{desiredState:"running"|"stopped"}}`；由小型严格 schema 校验并使用现有文件锁与 atomicWriteJson 写入。该文件虽位于 .runtime，属于持久化服务意图，daemon stop/退出清理只移除瞬时 PID/socket/令牌，禁止删除此文件。无需为单个服务意图再建 ValueStore 模型。运行状态、端口、PID 和最后启动错误属于观测信息，与 desiredState 分开展示。

`view start` 先持久化 running 再启动/确保服务；`view stop` 先持久化 stopped 再停止 View，daemon 和任务继续；`view restart` 持久化 running 并重新加载配置。启动失败保留 running 意图与错误，status 显示期望 running、实际 failed，不谎报运行；显式 start/restart 或 daemon 下次启动重试，不无限热循环。

`daemon stop` 停止 View 和任务调度，但不改变 View desiredState；`daemon start/restart` 读取此文件，running 则恢复 View，stopped 则保持关闭。首次无文件默认为 stopped；迁移旧 View 时仅在已核验它确实运行且无新意图文件时初始化 running，不用陈旧 PID 覆盖 stopped。无 daemon 时 `view stop` 也能保存 stopped，无须为停止 View 启动 daemon。机器重启后在 daemon 再次启动时同样恢复；操作系统开机自启动暂不安装。

### 模型及配置 schema 的交付和校验

- CommandState 与 DaemonTask 都是 Home 内部状态模型；按现有 `readBundledHomeModels()` 机制读取随包定义，不向 Project 业务模型 Registry 安装同义副本。
- Home 配置 schema 增加 `runner_agents`；这属于配置模型变更，不改变 Project Runner 权限 schema。
- 本轮不改 Run、Step、Artifact、Review 的持久化字段，不新增 Procedure YAML 关键字。
- 模型 fixture 覆盖合法记录、缺身份、错误枚举、data_id 与 payload 不一致、错误 Step 归属、非法文件名、failed 缺 error、error.stage 非法、重复等待及并发创建。跨字段一致性由 Store wrapper 校验，不假定 JSON Schema 自动推导。
- 构建执行 reserved-model 校验；新增/修改 Home 模型及 manifest 的解析与运行时验证测试，确认旧 command-states 不被隐式迁移或读取。

### graph 命令行为矩阵

以下“身份模式”指开启身份且成功识别会话；未开启身份的原生入口保留现有自动 enter 行为。前台身份模式的 wait/status 改为不 enter 后继，是本方案明确提交 Human 确认的行为变化。

| 入口 | 身份模式下业务推进与会话操作 | 身份关闭的原生入口 |
| --- | --- | --- |
| graph run start | 正式 start；唯一就绪入口自动 enter 并绑定，多入口只列出显式 enter 命令。 | 保持既有自动 enter，不建会话状态。 |
| run step enter | 显式 enter 目标并绑定；允许切换当前上下文。 | 保持既有显式 enter。 |
| report / review vote | 校验当前目标；收敛业务状态，Step done 时只关闭匹配绑定；唯一后继正式自动 enter 并绑定，多后继列出 enter 选择。 | 保持现有回执推进。 |
| 同步 review wait（配置关闭异步） | 允许既有 graph advance 收敛；纯渲染，不 enter、不写会话，目标终态后旧绑定不可继续生产。 | 保留既有自动后继 enter，但不产生 Continue ID。 |
| run status | 允许 advance，不 enter、不改绑，输出就绪 Step 的显式 enter 命令。 | 保持现有自动 enter。 |
| show / step show / 列表 | 仅查询；不 enter、不改绑。 | 保持只读。 |

`stepPrompt()` 改为纯渲染，不再调用 `context()` 建绑；会话创建/更新/关闭由前台 start/enter/report/vote 的命令编排层承担。wait 不关闭绑定，但 Continue 加载时对照真实 Step 状态，已 done 的绑定直接拒绝并提示显式 enter；避免 daemon 关闭用户已切换的绑定。

身份模式 wait 完成后，待 Runner 投票则打印原生 vote 命令；若 Step 已 done，正文直接列出 `memsphere --project P run step enter --run R --step S`，多个就绪 Step 列出选择，不依赖 status 才获得入口；Run 已全部完成则打印原生 finish 命令。queue 只携带继续命令，完整结果由 wait 当前读取；共享 ReviewWaitResult 仅为前台内存结果对象，不要求与非身份模式的旧回执相同。模板 `run.review-summary`、`run.review-next-action`、graph waiting/selection/step 及 Skill 对应更新，并分别回归两种模式。

## 同步输出与后台等待

先提取共享 `ReviewWaitResult` 获取与纯文本渲染函数，graph 与 legacy 复用现有模板；身份模式与非身份原生路径按上方行为矩阵区分。纯渲染不调用 `graphNext()`，不 enter Step、不改会话；需要推进时由 Runner 后续显式投票/原生推进命令执行。完整结果只通过前台命令响应输出；queue 不携带结果或摘要，只引导再次执行原生 wait。

`review wait` 与 Continue 入口不提供 --sync；先检查当前结果，可返回则直接输出，否则根据调用方 Runner 配置选择异步登记或同步等待。Continue 严格身份要求不变；无可用会话的原生命令同步等待。有身份且配置异步时，queue 能力不可用明确报错，不虚报登记。

### 统一 daemon 生命周期与 View

每个 Memsphere Home 仅一个 daemon，服务 View 与 DaemonTask；使用 Home `.runtime` 中的文件锁、实例 UUID、PID 和本地控制端点保证并发启动只有一个实例。PID 必须配合握手和实例 UUID 校验，不凭 PID 存活直接认定是正确进程。控制端点仅本机可访问，使用本地文件权限和随机令牌认证；控制协议支持健康检查、启动/停止/重载 View、通知任务、优雅退出。跨平台分别选 Unix socket / Windows named pipe；不开放公网控制端口。

新增 `memsphere daemon start/status/stop/restart`。`view start` 先确保 daemon 存在，再请求启动 View；`view stop` 只停止 View，异步任务继续运行；`view restart` 只重启 View 并应用配置；`view status` 展示 View 自身状态和 daemon 状态。View 以 daemon 内受控 HTTP 服务运行，View 启动失败不终止任务调度；View 未开启时 daemon 仍能处理等待。`daemon stop` 优雅停止所有服务与任务调度，不删除等待；下次 daemon start 恢复 queued 任务并报告中断的 running 任务。daemon 启动按持久化的 View desiredState 恢复，首次默认 stopped；已有 View 状态迁移时检查旧实例身份，先有界停止旧 View，再由 daemon 接管端口，失败则明确报错，不能杀死未经验证的 PID。若独立旧 View 被其他程序占用端口则报错，不擅自终止。

两个 wait 入口先校验权限和 Continue 所需身份，再做同源就绪检查（graph advance + 当前轮次/assignment 状态）。可返回时直接输出完整结果，不操作任务或启动 daemon。仅仍需等待时读取当前身份对应的异步配置：开启则验证 queue 能力、确保 daemon 健康、在锁内复用同键 queued/running 或创建新任务，持久化成功后返回登记回执；否则同步阻塞。历史 completed/failed/cancelled 不参与活动去重，保留原记录，不复活历史任务；业务 retry 使同轮重新 pending 后，相同 wait 命令可以创建新等待。任务创建并发锁保证至多一个活动任务。daemon 周期扫描防止登记唤醒信号丢失。

后台任务固定 Project/Run/Step（legacy 无 Step）/Review/Round 与接收 Agent/session，使用现有就绪条件和权限检查，允许 graph advance 收敛，禁止 enter 后继或修改会话绑定。轮次变化取消；发送前再核对当前轮次、就绪状态和开关。通知严格只有三行：[Memsphere 自动消息]、请执行命令以继续：、带 Shell 转义 Project/Review 的原生 review wait 命令。不回传票、错误、意见或状态。Agent 执行命令后，通过工具响应取得当前正式结果。发送失败记 failed/send，不再自动发送第二条短通知；显式任务 retry 保留，投递结果未知时仍提示可能重复。不新增模型字段。

### 后台任务的 graph 执行边界

此处描述 daemon 内部执行路径，不是 CLI 命令。处理 `review-wait` 任务时，daemon 可以调用既有 graph advance 收敛评审状态，但禁止 enter 后继 Step 或写入、关闭、切换前台会话绑定；通知只生成显式定位的继续命令，结果渲染留在前台 wait。异步任务只能在调用方身份有效时登记。收到通知后，由前台 Agent 根据下一步命令继续操作。

### 恢复、去重与运维

使用持久化 DaemonTask 状态及 daemon 实例认领，按上述单一 status 规则恢复和去重。status/retry 命令展示任务状态和 error.stage，不提供独立投递状态。`run review wait status --review R` 按轮次标明当前轮；retry 显式指定轮次，保留接收会话，重新读取评审生成正文。旧 running 恢复为 execution_interrupted 失败，显式重试前告知可能已送达，不盲目自动重发。

机器重启后，下一次 `daemon start`、`view start` 或异步 wait 会启动 daemon 并恢复任务；本轮不自动安装 systemd/launchd/Windows 自启动服务，因此不能承诺机器重启后在无人触发 daemon 启动前自动唤醒。daemon 日志与状态保存在 Home，限制敏感内容输出；真实 queue 发送不可与持久化写入组成原子事务，不承诺 exactly-once。

## 文件与开发任务

1. 新增 `src/runner/` adapter、配置 schema 和探测模块；更新 `src/config.ts`、`src/config-management.ts`、设置 API、设置模块及 locales。
2. 将 `src/home/command-state-store.ts` 改为 session 状态读写，修改现有 CommandState Home 模型并新增 DaemonTask 模型/manifest 登记、Continue 路由、自由探索与 graph 命令、回执及提示。新增原生自由探索 enter 入口。
3. 从 `src/commands/run.ts`、`src/commands/procedure-graph.ts` 分离共享 review wait 结果渲染；保持现有评审引擎和权限调用；按入口矩阵同步改造 vote/report/status/start 编排与纯 stepPrompt。
4. 新增统一 daemon、控制端点及 View 管理，持久化等待 Store、daemon 调度器、queue 发送器与 status/retry 命令；同步选项贯穿原生/Continue 两入口。
5. 同步 `reserved-memory` 的 framework、procedure 与关联 schema/教程中受影响说明、当前 Project Memory 副本和 `src/skills/memsphere/SKILL.md`；新建 Runner 概念说明并登记 Memory manifest。检查当前 debug-thread-id 诊断是否改为共享检测入口，避免保留仅 Codex 的另一套逻辑。
6. 补齐针对性测试，完成回归、真实 Agent 端到端验证、正式实现验收与交付。

## 验证方案

单元测试保护 adapter 的缺失/空白/双身份冲突、开关判定、键隔离、queue 参数不经 shell；模块测试保护 Store CAS、绑定生命周期、关闭不误伤新目标、重复登记、过期轮次及投递失败保存。

CLI/子进程集成覆盖无 ID Continue、旧 ID 拒绝、缺身份不写入、自由探索/graph 提交与修订、显式 enter、只读查询不改绑、多个会话隔离；两个会话绑定同一 Run 时 accountRead 通过当前 agentType/sessionId 定位各自记录并独立记账；真实 daemon 跨前台退出存活、有界健康握手、重复 wait、故障 retry、queue 超时/非零退出与当前固定轮次同步正文一致性。可控假 queue 记录 argv 并模拟失败，不能以测试 fake 代替真实 Agent 通路验收。并发测试通过明确握手控制时序，不依赖固定 sleep。

daemon 集成额外验证：View running/stopped 均跨 daemon restart 恢复；daemon stop 不修改意图；无 daemon 的 view stop 保留 stopped；首次默认 stopped；恢复 View 启动失败不影响任务且可查询。

daemon 集成覆盖并发单例启动、View start/stop/restart 不影响等待、端口占用及旧 View 接管、daemon 强制退出后重启恢复、running 中断转 failed/execution_interrupted、daemon stop 后任务留存、首次启动默认不打开 View、重启恢复 running/stopped 两种期望状态、View 启动失败保持期望状态并可查询、控制端点认证和隔离；机器重启后的恢复触发明确测试；两个 Home daemon 同时运行，锁、socket、任务扫描与投递互不污染。Windows package smoke 加入 daemon start/status/stop 与 view start/status/stop 真实命名管道冒烟，未通过不得声称跨平台验收完成。

设置 API/浏览器测试覆盖未安装、安装后重探测、开关依赖、持久化、revision 冲突和配置分区隔离。依据仓库要求用 playwright-cli 实际操作受影响页面，检查桌面/窄屏、键盘与错误状态。

先执行受影响测试，包括 command-state-store、context-control-cli、procedure-graph-cli、agent-review、config-management、view-settings、settings-builtin 及新增 session/async-wait 套件；再执行 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。System Memory 变更执行 reserved-store 测试和最终 `memsphere memory change validate`，记录 ChangeSet、校验和 View 入口。

Codex/Traex 各实际创建受控会话调用新 CLI，验证环境身份、无 ID Continue、后台 wait 前台退出、queue 完整结果送回原会话并能继续。保留发送与接收证据，不以本轮静态 Help 或旧 debug-thread-id 测试代替功能验收；若环境能力不足则明确记为未验证，不能声称全部交付。

### 必测边界补充

- graph 与 legacy CLI：调用 wait 时已 passed/awaiting_revision/awaiting_runner_vote/cancelled/assignment failed，前台直返与同步正文一致、无任务写入、无 daemon 启动或通知、无 queue；pending 时才登记。登记竞争期间再次核对状态，已产生任务则由同一登记者/daemon 认领处理，避免双重发送。
- 模型/Store：type 专属输入验证、legacy 无 stepId 合法、发送成功才 completed、发送失败统一 failed、旧 running 恢复 execution_interrupted 不自动重发；拒绝接收方覆盖参数且无任务写入。
- 探测用受控进程覆盖挂起、非零退出与异常输出；daemon 日志仅含任务 ID/轮次/状态码等诊断字段，断言令牌、queue 正文与 operator token 均不出现。


- CLI 集成：无变量、空白 ID、双身份冲突、身份关闭、旧 Continue ID 均拒绝，业务与会话 Store 无新增记录；绑定 A 时原生 report/vote 写 B 必须失败，先 enter B 后成功。
- 子进程集成：验证 ACP 已有环境白名单及后续配置合并不会重新注入父级 CODEX_THREAD_ID/TRAECLI_THREAD_ID，子 Agent 自行注入的当前身份仍可用。
- daemon 任务集成：passed、awaiting_revision、awaiting_runner_vote、cancelled、assignment failed 各自验证正文、轮次和不改绑；等待 Human 未完成时不得提前发送。登记前缺 artifact.read 等权限时不得登记或派发任务。
- 模块/集成：登记后发送前关闭身份或异步开关停止发送并记录 runner_disabled；轮次变化 cancelled + round_changed；超长 queue 参数失败保存 error.stage=send，任务 Store 不保存正文，重试按轮次重新读取；原生与 Continue 的 --sync 分别覆盖。
- graph 集成：按入口矩阵验证 start/report/vote/status/wait/show；未通过不切换、唯一/多后继正确输出 enter 命令；身份关闭原生同步路径保持旧自动 enter，身份模式同步/异步正文一致。

## 适用规则、来源与边界

采用项：`statements/memsphere-repository-requirement-rules`（向前兼容）、`statements/memsphere-repository-development-rules`（复杂度、Memory/Skill 同步、Syntax 准入）、`statements/memsphere-repository-testing-rules`（测试分层、回归及浏览器要求）。独立设计类 Statement：无。

本 Run 冻结快照只有 graph 根流程、repository-delivery-rules 与 repository-git-rules，已通过 `memory list/read --run` 核对。需求/开发规则在启动 Run 前通过 CLI 读取，测试规则在本阶段从当前 Project 显式读取，均不冒充冻结快照。按已通过契约的来源披露约定，将这三条作为仓库工程约束交由本次方案评审共同确认，不手改冻结快照。采用要点为向前兼容明确决策、避免过度设计、System Memory/Skill 同步、必跑回归、真实浏览器验证、仅提交交付范围文件与证据不进 Git。

## 向前兼容与 Syntax

结论：不需要向前兼容。当前无名称含 stable 的 Tag；按已确认需求删除独立 Continue ID 入口和存储依赖，不迁移旧 context ID。缺省不开身份时使用原生 run 命令。旧 Run/Artifact/Review 业务数据保留，现有 ACP 配置和权限不改变。

本方案不新增任何 Memory DSL syntax 关键字；新增 Home 配置字段与 Home JSON 模型不改变 Procedure YAML syntax。

## 方案评审重点

请共同审查：Home 两开关与独立配置分区；会话唯一当前绑定及显式 enter 切换；后台可收敛业务状态但不 enter 后继、不写会话；统一 daemon 生命周期、View 独立启停、持久化恢复/握手/显式 retry 的可靠性边界；严格拒绝无身份 Continue；单次 --sync 与 queue 失败的可恢复路径。Human billtenor 与架构 Agent 共同参与架构师评审，研发与测试 Agent 同时参与。

## 第四轮评审处置补充

- Human 要求已落实：DaemonTask 无 result/delivery，仅持久化定位、接收会话、status 和错误，queue 成功才 completed。
- 已更正证据符号为 runReviewWaitCommand；按 data_id 加 .json 的实际文件名校验长度。
- 开发硬前置：把 daemon/View/模型及身份模式 wait/status 行为更新到 change.md，列明新增验收标准并取得 Human 对修订文档的确认，未完成前不施工。
- queue 当前已验证入口仅为 --message，正文作为 argv 可被有权限查看本机进程参数的用户看到。实现时再核对是否支持 stdin/文件，如支持优先使用，否则保留此本机权限边界并在交付中披露，不宣称日志脱敏消除了进程参数可见性。
- 补测试：完整正文发送失败后短通知成功仍为 failed，两次均失败可查询；短通知长度受限。登记唤醒丢失时周期扫描可接管；status 区分轮次、retry 不复活过期任务。Help/回执/模板不残留 context-ID 调用；原生 artifact show 到 continue report 的 reads 归属跨命令验证。
- 会话后续命令提示未处理失败任务的增强记入后续范围，本轮通过原生 wait status/retry 查询处理。

## 第五轮评审意见汇总与处置

轮次 round-87292bf9-0439-4fa1-8a0a-ffb1021c3c5f 已收齐 4/4。研发通过；架构通过并提出派发风险；Human 要求修改命令矩阵；测试要求修改取消原因约束，并提出重复登记风险。

1. Human：已将 daemon wait/queue 行移出命令矩阵，内部行为集中在“后台任务的 graph 执行边界”。
2. 测试阻塞：取消原因统一存放 error，cancelled 必填 stage=cancel 和 round_changed/runner_disabled；failed 与 cancelled 通过 status 区分。删除配置关闭“记录失败”的矛盾措辞。模型 fixture 增加合法取消、缺原因、错误阶段及错误原因码拒绝用例。
3. 测试风险：只复用 queued/running，failed 必须返回失败与 retry 提示，不返回已登记；cancelled 不对同一键复活，completed 不再发送。评审已就绪直返优先，新轮次重新按新键判断。集成测试覆盖 pending 时命中 failed/cancelled/completed 的回执、无伪登记以及显式 retry 边界。
4. 架构风险：同步和异步 wait 在权限及 Continue 身份校验后均保留既有 dispatchArtifactReviewAgents 派发点，然后执行就绪判定。异步登记路径每次调用只做一次派发兜底；daemon 认领或恢复 queued 任务时，可为仍 queued 的 assignment 补派一次，轮询/advance 循环不重复派发，失败 Reviewer 的业务重试仍使用原有显式 review retry，任务 retry 不代替它。共享派发函数需在 assignment 级锁内检查认领/启动状态，等待 worker 认领的有界确认后才释放派发保护，避免 report、wait、daemon 竞争重复启动同一 assignment；失败明确记录，不假设仅靠事后 claim 可以避免重复 spawn。测试模拟 report 派发失败、异步登记/恢复补派、并发登记与同一 assignment 不重复启动、派发失败不虚报评审已完成。

上述修订只澄清本轮任务和派发边界，不扩展为通用 Agent 调度平台。新增派发认领保护优先复用现有 assignment/attempt 状态与锁，不新增一套任务状态模型。

## 实现验收期间 Human 增补：消息来源

2026-10-29 Human 明确要求异步消息区分 Memsphere 与人。按新需求在统一 sendQueue 传输出口添加 `[Memsphere 自动消息]\n\n` 前缀，覆盖完整结果、失败短通知和显式 retry；同步 renderer 保持原正文，DaemonTask 不新增 origin/result/delivery 字段。更新真实子进程集成断言，检验前缀及其后同步正文一致性。旧轮 Human 已投通过不覆盖为新版本通过；第1轮收齐意见后将此增补与意见合并新候选评审。


## 2026-10-29 Human 最新修订：幂等 wait 与命令通知

本节及当前正文覆盖历史各轮条目中的完整结果回传、--sync、终态禁止新登记、失败短通知约定。Human 已明确授权按两条 wait 规则修订，当前先完成修订，暂不重试旧轮架构 Reviewer。

- CommandState 与 DaemonTask 模型不变；task 去重查询仅选 queued/running，所有终态保留，新等待新建 id。
- 去掉原生与 Continue --sync；配置默认控制等待方式，可返回结果的判断优先于异步能力探测和任务登记。
- 原生无可用身份走同步，Continue 仍拒绝；明确 Project/Review 的通知命令仍遵守 session target 冲突检查，不自动切换绑定。
- queue 标记、继续提示、命令三行；不再调用完整结果 renderer 或发送失败兜底正文。发送失败可查询并显式 retry。
- 测试重点：配置关闭时确实阻塞且无任务、开启时即时登记；就绪结果与任务历史无关；同轮终态后并发调用只创建一个新活动任务；收到通知执行同一 wait 可读结果而无新通知；发送失败只尝试一次。
- 实际故障记录：旧候选 task-3ebc6a22… 完成后同轮业务 retry 的 wait 曾被 TASK_COMPLETED 拒绝。本次去重只看活动任务，消除该恢复障碍。旧候选与票保留，不以历史通过票接纳修改后的实现。


## 实现验收第2轮后的修订3补充

旧轮已由 Runner 正式 request_changes。Human 指定仍在当前验收 Step 重审；新候选正文同时嵌入本版需求契约、技术方案、实现摘要和初始验证报告，保留旧冻结输入和旧票作为历史。

- 修复测试清理顺序：businessFixture 支持 beforeCleanup；先等待 stopDaemon 完成，再删除临时 Home。控制协议 stop 先应答，但对外 stopDaemon 已等待状态文件删除/进程结束，不能把底层 ACK 当成 CLI stop 完成。
- 若任务终态保存及其 failed 保存均失败，本实例将该任务暂停调度，daemon status.taskErrors 暴露 TASK_STATE_WRITE_FAILED。暂停表只保存在内存，持久化模型不变；停止时不把结果未知的 running 任务退回 queued。修复存储后重启，遗留 running 按现有恢复规则置 failed/execution_interrupted，显式 retry 前需确认可能已投递。避免状态无法落盘时周期性重新发送。
- 故障测试在 queue 返回前更改真实任务记录 revision，强制 completed/failed 两次 CAS 冲突，验证诊断、跨多个 tick 仅一次发送和优雅重启后的 failed/recovery，未加入生产故障开关。
- 三行通知的固定标记和提示遵循本轮 Human 指定中文格式，不随工作语言翻译；正式结果仍按原有 Run 工作语言渲染。无需任务新增语言/result/delivery 字段。
- 已知残余：派发 marker 仅以 PID 存活判定，PID 复用可能抑制派发；marker 与任务历史没有自动回收。此项保留为后续可靠性工作，未声称本轮已修复。View 恢复 await 无独立超时诊断亦保留为后续项。Windows 真实环境验证留在适用 CI 门禁，Linux 测试不替代它。


## 2026-10-29 Human 修订4：先清理 ValueStore 可独立覆盖的外层锁

Human明确要求只处理ValueStore内部锁能独立覆盖的问题，其他暂不处理；随后明确“不要通过、投修改、继续修改”。第3轮原通过票保留，Runner已要求修改，仍在同一验收Step。

当前文件型ValueStore已对create/upsert/update/delete的条件检查与写入持有内部记录锁，无须新接口或Project级锁。CommandState创建删除调用方Home锁：首次创建直接create；重绑使用expectedRevision；遇到同目标并发获胜记录则只读复用、不清空reads，异目标并发明确REVISION_CONFLICT，不盲目重试。不同session无共同调用方锁。

任务去重涉及其他任务记录；运行推进、模型升级/绑定切换及进程生命周期涉及其他资源，本次不重构。Project整体互斥和daemon高频扫描的已发现问题仍未解决，不以此次单记录清理宣称已消除。完整盘点见valuestore-lock-audit.md。

第3轮8条非阻塞意见逐项留存：Windows真实CI仍为合入前门禁；轮次变更及assignment失败组合测试、queue能力失败/名称控制字符加固、PATH升级提示、PID身份和历史留存/扫描优化等先登记后续；不能自动扩展本次Human范围。Git交付排除单轮原始证据/逐轮验收材料，保留Run记录。需求契约、长期技术方案/结论和graph回溯需求概述按仓库规则进入最终交付。


### 后续锁清理修订：配置文件维度

按 Human 新要求逐项清除 Project 级锁，不迁移配置的现有存储方式。普通 CRUD 使用打开时的 Store/Runtime 快照；配置修改统一使用 withConfigFileLock（.runtime/config.json.lock），涵盖配置中心、Store 绑定修改、Managed 发布版本更新和模型事务中的配置提交/恢复。读取与普通数据操作不参与配置锁。模型登记显式迁移、Context Control 及模型原有访问门尚待后续场景处理。此为第4轮冻结候选之后的修改，需新候选验收。

后续 Human 确认模型登记迁移采用操作者停写方式，因此移除迁移入口的 Project 锁，保留配置文件锁和已有迁移校验；不新增在线迁移协调协议。此前记录的迁移残留锁已在本项移除。

后续 Human 确认流程模型产物的目标冻结及处理移除 Project 锁，保留指纹匹配、模型校验及 ValueStore 原子 upsert，操作使用当次打开的绑定/Runtime 完成。

后续 Human 确认移除 Context Control 普通访问的 Project 锁，保留模型 stamp、Run 锁和 ValueStore CAS。遇到 pending 模型发布明确报错，完成后重新执行，不再通过 Project 锁排队。


### 后续模型发布契约修订

登记新增可兼容缺省的 definition_sha256。已有值必须与原始定义字节一致才允许 Runtime 使用；缺省时首次使用通过登记 ValueStore CAS 自动补齐，不自动覆盖已有哈希。无登记的定义不生效。普通模型修改先用 DataStore 写定义，再用 ValueStore 发布登记，不再使用 Project 锁或共享多文件日志；部分失败允许暂时不可用并显式重试，不以旧快照回滚其他操作。DataStore 内部锁及 CAS 不在本次范围。显式维护/升级路径继续单独审视，不宣称该类 Project 锁已经清除。


### 2026-10-29 维护日志非阻塞登记，移除 settings.lock

Human 明确要求按日志登记方案移除该 Project 锁。删除 withProjectSettingsLock / withProjectModelWrite 及 settings.lock 的生产调用；初始化、升级、市场导入/候选清理、已知 Context Control 升级和示例迁移入口改为日志模块拥有的 withModelMaintenance。调用方不再自行持有 Project 锁。

共享恢复日志仍是 .runtime/model-operation.json；执行权通过永久 .runtime/model-operation.claim 文件的原生非阻塞锁原子领取（timeoutMs=0），不是简单读后写。这个底层日志资源锁明确保留，不宣称实现完全无锁：其唯一用途是拒绝重叠的维护/恢复，不排队，也不参与普通 CRUD、配置、Run 或其他 Project 操作。失败立即返回 MODEL_OPERATION_BUSY，附日志路径；原进程仍执行时拒绝恢复，进程退出由内核释放领取权。新维护在领取后先恢复遗留日志再进行预检；恢复被杀仍可再次领取并继续恢复。日志阶段和文件 before/after 冲突检测保留。

领取覆盖维护预检/候选目录操作和提交，而不只覆盖写日志的一瞬间；公开 commit/recover 入口自行领取，嵌套调用在同一活动调用范围内复用，退出后失效。目录别名统一到物理根。包含 config.json 的提交/恢复仍只在修改配置时使用配置文件锁；不会因错误回滚递归获取该配置锁。

并发拒绝只约束维护请求，不新增与已开始普通写入之间的在线事务保证。普通模型发布沿用定义哈希生效协议，DataStore 锁和 CAS 本次仍不实施。此项完成的是 settings.lock 清理，Home 下 projects/<name>.lock 等其他 Project 生命周期/系统 Memory 修复调用尚待下一场景审视。


### 2026-10-29 移除 Home projects/<name>.lock

按 Human 确认的方案，删除 commands/project.ts 的 withProjectLock 及全部调用。创建和克隆用原子 mkdir 排他领取目标目录，不再先检查后 rename 发布到可能由另一次尝试创建的目录。准备标记 .memsphere-project-creating.json 拒绝外部登记/解析；创建调用通过有活动范围限制的 AsyncLocalStorage 私有上下文引导初始化和 System Memory bootstrap，准备完成后才更新真实 Registry。Registry 更新始终读持久化内容，不会把私有上下文带入写入。失败清理核对目录 dev/ino 和本次随机 token；不清理其他尝试的目录，已发布登记指向该目录时保留有效 Project。进程崩溃遗留的准备目录不自动认领，后续创建明确失败，需检查遗留目录。

登记已有 Project 把当前登记、同名冲突和 Workspace 绑定检查全部收进 updateProjectRegistry 回调，沿用 Registry 文件自身的更新边界，无外层 Project 锁。Registry 本身的文件锁保留，不扩大到 clone/Git/bootstrap 工作。

Embedded System Memory 修复准备阶段只生成独立候选；应用阶段按 realpath 后的 Memory 目录领取执行权，跨 Project/Home 指向相同目录时使用同一资源。永久 claim 放在系统临时目录专用子目录中，不污染 Git worktree；原生非阻塞领取失败返回 MEMORY_REPAIR_BUSY，不排队。领取成功后重新校验上下文与快照，每个目标写前再核对。失败恢复只覆盖仍等于本次写入的内容/模式（或已恢复原值时跳过），出现外部新内容则保留并报告 MEMORY_REPAIR_CONFLICT/不完整回滚，不静默覆盖。

验证：当前源码 CLI 适配下六文件 37 测试全部通过，随后 preparation 六测试通过（新增目录别名、登记持久化后报错保护，共计 39 个不同测试）。覆盖持有旧 .runtime/projects/shared.lock 仍可创建、同名并发创建保留赢家、准备隔离、并发登记只允许一个 Workspace 绑定、修复并发立即拒绝、回滚保留外部新内容，以及 Registry/Resolver/Managed 与 Embedded 升级。类型检查、git diff --check 通过。原始日志 /tmp/memsphere-project-lock-source-tests.log、/tmp/memsphere-project-preparation-final-tests.log、/tmp/memsphere-project-lock-typecheck-final.log。升级测试默认执行旧 dist，曾出现新哈希断言不匹配；最终用 /tmp/memsphere-project-source-cli.mjs 将测试子进程定向当前 src/cli.ts，未替换正式 Reviewer 使用的冻结 dist。该适配器仅为本地验证工具，不进入生产或 Git。

下一场景：memory/changeset.ts 的 memoryMutationLock 仍指向 Project .runtime/memory-publish.lock，不同 ChangeSet 的编辑、校验、读取、发布和 App Memory 预留共用。后续需要分别审视单 ChangeSet 状态更新与实际 Memory Git 工作树/index/HEAD 的发布操作，尚未修改此锁。


### 2026-10-29 Human 四项决定：移除 ChangeSet 的 Project 互斥

Human 对方案逐项决定：不要求候选编辑后自动撤销校验结果；同一 ChangeSet 接受后写覆盖；市场导入和系统升级不必只有一个活动候选；同一工作树的第二次发布直接报正在发布。按这些决定删除 memoryMutationLock/.runtime/memory-publish.lock 及 31 处调用，不引入 ChangeSet 锁、CAS 或活动槽索引。

编辑、候选保存/恢复、校验、查询、评论、领取/完成等操作不再参与 Project 互斥。expectedUpdatedAt 参数为调用兼容继续接收，但不因过期时间戳拒绝写入；记录仍使用原子文件替换，接受后写覆盖。候选编辑后保留已有校验记录，不增加保存校验结果前的候选新鲜度检查。原有权限、终态、专用升级意图、目标/基线和冻结 checkpoint 完整性契约保留。查询仍沿用已有对账行为，可能写回单记录，同样不加 Project 锁。

市场导入每次创建独立活动 ChangeSet，不再扫描并复用唯一活动市场候选，也不因另一市场候选被领取而拒绝新导入。新导入不改写旧候选或旧校验结果。系统升级移除“已有活动升级则拒绝创建”的规则，同一工作树可有多个活动升级；隐式校验遇到升级候选仍提示明确 change-id，不猜测用户选择。工作区 checkpoint 跳过专用升级记录，不因存在升级而拒绝处理其他候选。

新增 memory/write-access.ts，正式发布、Embedded 应用、系统升级 Managed 发布、同步 merge/commit 和恢复正式文件等写入口按物理 Git 工作树 instanceKey 非阻塞领取执行权；非 Git 使用物理目录身份。同一工作树内不同 Memory 子目录共用其 Git index，独立 linked worktree 分开领取；别名指向同一资源。第二次请求立即返回 MEMORY_PUBLISH_BUSY，不排队；进程退出由内核释放。已完成的系统 Memory 修复也改用同一个模块，修复重叠返回 MEMORY_REPAIR_BUSY，避免两套占用机制互不认识。Config 文件更新沿用自身锁；App 状态文件自身的协调仍保留。未重建 dist，不以此声明已安装 daemon 或旧正式候选已升级。

验证：七文件首轮 60 测试发现两处旧“等待发布锁”断言及一处隐式升级选择断言需调整；修订后对应三文件 20/20 通过，其他首轮 40 项通过。另三文件 5/5（Embedded 浏览器/Run、跨进程写入）通过，共 65 个不同相关测试通过。新增/调整覆盖：发布执行权占用期间仍可编辑、校验和读取；第二次发布/同步立即拒绝；持有旧 memory-publish.lock 不影响发布/同步；多个活动市场/升级候选；过期时间戳照常修改；候选编辑后保留通过记录；同一工作树跨目录/别名/进程拒绝并发、独立 worktree 可执行、强杀后重新领取。最后两文件契约复验 7/7，类型检查及 git diff --check 通过。日志 /tmp/memsphere-changeset-unlock-tests.log、/tmp/memsphere-changeset-unlock-rerun.log、/tmp/memsphere-changeset-unlock-additional-tests.log、/tmp/memsphere-changeset-unlock-contract-tests.log、/tmp/memsphere-changeset-unlock-final-check.log。

下一场景：migration/store-write.ts 仍在 config.scopeRoot/migrations/memory-store.lock 用 wx 登记语法/契约迁移；范围随 Project，崩溃后会遗留占用文件。尚未修改，需要继续审视实际 Memory 目录上的迁移写入及其与正式发布的关系。


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
