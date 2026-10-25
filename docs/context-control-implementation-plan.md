> 历史文档：自由探索相关规则已由20261025“自由探索体验优化”迭代取代。当前用法见[自由探索 CLI](context-control-exploration-cli.md)，当前完整需求及方案见[本轮变更目录](../changes/archive/completed/20261025-exploration-experience/requirements-revised.md)。下文保留旧Run的契约与评审历史，其中artifact create、--for、finalArtifactIds等接口不代表当前用法。

# 上下文控制：实施与验证方案

Run：`run-20261022-130223z-496d73ae`。基准：第 4 轮已通过的《当前迭代需求契约》，Review Round：`round-20261024-092331z-93d24a8d`。本方案待研发工程师、架构师和测试工程师评审；不将方案提交等同于开始产品实现。

版本：第 4 版已通过（round-20261024-111321z-5cbf4ff3，Human 与 Runner 均已通过）。按 Human 最新确认简化为单记录 CAS、业务层跨记录编排和幂等 redo；第三轮固定材料保持不变。范围变化见 [需求契约补充](context-control-requirement-contract.md#实施方案评审期间的需求补充)；补充需求已由同轮 Human 明确确认，正式记录见 assignment-20261024-111321z-d6960ebe；已进入实施。

| 本轮重点 | 决定 |
| --- | --- |
| 生产边界 | artifact create 声明空草稿目标并自动关联 Step；读取用 --for；report --target 提交同一 ID。无前置阅读可直接 report |
| 读取记录 | 归目标 Step.reads，覆盖 Artifact / External；纯浏览不记账，记账失败不影响正文 |
| 并发与恢复 | Store 只保证单记录 CAS；跨记录由业务服务按 Run 加短锁编排。中断用同一 ID 幂等 redo，缺少信息或冲突再报错 |
| 改绑 | 本轮不增加禁止改绑、绑定版本隔离或存储迁移保护，沿用现有配置行为；该场景后续单独支持 |
| 范围确认 | 第4轮固定附录A已由 Human 产品负责人明确确认并记录正式通过票；原需求与该补充共同作为实施基线 |

## 1. 目标与边界

| 层面 | 实施决定 |
| --- | --- |
| JSON ValueStore | 扩展现有 Factory 支持分层 data_id，保持原有单层数据可读写；实现键校验、原子写、锁、删除版本记录及枚举的整体适配，不增加开关 |
| 后端 | 新建 `src/context_control/` 领域及应用服务，依赖模型 Store 接口；首版使用现有 JSON 文件 ValueStore |
| 前端 | 扩展既有 `org.memsphere.run`；复用运行入口、列表、详情和浮窗，产物图只是运行详情的另一种展示形态 |
| 旧流程 | `src/run/store.ts` 及现有正式评审继续承载旧流程；不将其 RunState 灌入新模型、不全量双写或迁移 |
| 新模型 | 沿用五个 `memsphere/context_control/*.json` 模型；仅增加下文明确列出的读取记录及轻量评审适配 |
| 本轮不做 | graph Procedure、JSONata、调度器、正式评审新动线、普通局部正文草稿/report --draft、自动重放、图编辑、标签移除、归档存储改造 |
| 语法 | 不新增 Memory YAML syntax 关键字，不把新领域数据协议写成另一套 type/format/layout |

## 2. 实际代码与开发基线

当前工作区 HEAD 为 `2b7400b`，处于 detached HEAD；本地 master 为 `1d4679b4e9208e93778aef4233bffe82d0e3b90d`，工作区落后 25 个提交，无独有提交。已分别调查工作区和当前安装 CLI 的源码，不能把安装目录的新接口误当作工作区已有接口。

实施前在当前工作区建立 `codex/` 分支，保留现有未跟踪文档和原型，核查目标路径不冲突后快进到已调查的 master 基线。若 master 后续又变化或合入存在冲突，重新核对受影响路径后再施工，不覆盖用户文件。不是在安装 CLI 所指向的主工作区直接施工。

| 现有路径 | 已核实的行为 | 接入方式 |
| --- | --- | --- |
| `src/cli.ts`、`src/commands/run.ts` | start 目前要求 Procedure；report/status/show 进入旧执行器 | 保留命令外观，增加新旧运行服务路由；不改写旧执行器内部数据结构 |
| `src/data/api/value-store.ts`、`store.ts` | get/create/update/delete/list；记录可带 revision；支持条件写的后端通过 expectedRevision 检查 | 用作新领域持久化边界；完整处理 list 游标，不扫描文件目录 |
| `src/data/management/data-manager.ts` | 按模型及 Store Binding 装配 Runtime/Factory | 复用装配，不自建文件读写 Store |
| master 的 `src/project/models.ts`、`business-stores.ts` | 项目模型 Runtime、业务 Store 绑定及兼容性检查；JSON 文件是现有受支持后端 | CLI/Host 适配层打开 Store，再注入新服务；远端 Factory 将来在装配层扩展 |
| master 的 `src/project/data-service.ts`、`model-operation.ts` | 通用业务数据操作及项目设置锁；Store 变更需要检查配置一致性 | 复用现有检查及本地操作协调；领域服务不接收物理路径 |
| `src/data/extensions/filesystem-json-valuestore/` | 单条原子操作和版本元信息；master 已有跨进程记录锁，旧工作区实现只有进程内锁 | 以同步后的实现为基线；不假设存在跨 Store 事务 |
| `src/commands/view.ts` | `/api/runs` 与单个运行读取直接依赖旧 RunState | 加入运行读取适配器；旧数据走旧服务，新数据走模型 Store 服务 |
| `modules/org.memsphere.run/adapter/view/` | 运行列表、详情、评审浮窗、顶部标题均在同一模块 | 在此模块内增加产物图详情组件，保留旧流程详情 |
| `src/view/view-sdk.ts`、`ui-primitives.ts` | 公共标题、列表、badge、路由及 overlay | 沿用公共接口；不依赖 Host 私有 DOM 或复制公共组件样式 |
| `examples/view-packages/context-control-prototype/` | 真实 Shell 中的固定数据交互演示 | 仅作为已确认交互基准，不能作为正式新模块或实际数据实现 |

## 3. 模块与服务接口

| 位置 | 责任 |
| --- | --- |
| `src/context_control/types.ts`、`rules.ts` | 五类实体类型、引用与状态约束、严格输入解析；不导入旧 RunState 或文件系统 |
| `src/context_control/service.ts` | start/create/report/read/tag/external/review/finish/abandon 等用户用例，依赖注入的五个实体仓储、Run 锁能力与内容读取端口；负责跨记录顺序和 redo |
| `src/context_control/graph.ts` | 依赖闭包、下游影响、修订分组和版本图投影；只做读取与计算，不修改依赖或交付根 |
| `reserved-models/context-control/`、其 `manifest.json` 与 `src/context_control/model-assets.ts` | 五个模型原始 JSON、登记信息及加载器；沿用已确认 ID/字段/包名。使用现有 npm files 中的 reserved-models，不依赖 src 下未被编译复制的 JSON |
| `src/project/context-control.ts` | Project 下模型/Store 的初始化、打开、兼容性检查，以及业务 Run 锁的本地装配；不扩展 ValueStore 为跨模型事务接口 |
| `src/commands/context-control.ts` | CLI 输入输出、文件正文、输出文件和服务调用；命令入口由现有 run 命令组注册 |
| 内容读取端口 | Project 适配层注入 readContent(storeId,dataId)，返回按现有 Store/模型读取能力解析的 contentType、modelRef 与字节；领域层只做 SHA-256 对照，不导入 openBusinessStore 或物理路径 |
| JSON ValueStore 与 Project data 适配 | 支持分层键的 CRUD/upsert/list、完整路径锁/版本元数据、业务 Store 重新登记与 CLI data 操作；不放松其他单文件名调用点的校验 |
| Run 读取适配器 | 根据实际存储来源返回运行摘要及详情展示数据；拒绝 ID 冲突、存储不可用等异常，不能在读取失败时静默回退旧来源 |
| Run 图组件 | 接收真实数据的产物图、历史选择、产物内容和评审浮窗；没有独立一级导航或独立运行列表 |

五个 Store 作为依赖传入服务，不通过全局变量查找，不以“先找到的同模型 Store”为默认。默认绑定 ID 为 `context_control/runs`、`steps`、`artifacts`、`externals`、`reviews`（后四项也使用 `context_control/` 前缀）。它们不是新模型 ID；分别绑定原先确认的五个模型。

首次启动自由探索时，通过现有项目模型与业务 Store 服务补齐缺失的定义、登记和默认绑定；默认目录放在 `data/context_control/<实体>/`。已有绑定必须检查模型和后端兼容性，不覆盖同 ID 的其他绑定，不静默改写用户模型。初始化未完成时不创建 Run；中断后可补齐缺项，不重建已存在的数据。需要调整当前项目模型时，按本方案通过后的实际定义进行受控更新，先验证兼容性；不以启动命令暗中迁移不兼容模型。

领域服务依赖五个模型 Store 的单记录 create/CAS 与完整分页读取，跨记录顺序、必要的 Run 锁和 redo 留在业务服务。不增加通用 commit(expectedRecords,mutations) 协议，不要求后端支持跨 Store 事务；远端替换时保持单记录契约，锁能力在装配层替换。

### 3.1 模型发行与初始化来源

五份 JSON 定义和一份登记清单放入 `reserved-models/context-control/`。`src/context_control/model-assets.ts` 依照现有安装包根目录的定位方式，从发行包的该目录加载，只允许清单内的固定相对路径；不从 cwd、当前 Project 或开发者源码树回退读取。

`package.json#files` 已包含整个 reserved-models，因此无需依赖 TypeScript 复制 JSON，也不把这五个领域模型悄悄加入系统只读模型列表。扩展 `scripts/check-reserved-models.mjs`，校验专用清单、五个 ID、文件齐备和 Runtime 可读性；模型通过现有项目模型服务登记为项目模型。检查 `test/package-release.test.ts` 与模型/初始化测试，加入真正解包 npm pack 产物后、全新 MEMSPHERE_HOME/Project 下启动自由探索并重启读取的用例。

初始化分为可重试的模型/绑定补齐和创建 Run 两个阶段。前一阶段调用各自取得设置锁的现有服务，不嵌套外层同名锁；补齐后重新取得设置锁、完整核对五个绑定/模型，再创建 Run。并发初始化出现“已存在”时只接受与期望一致的结果；冲突明确失败，不覆盖。

### 3.2 尚未初始化的读取边界

| 探测结果 | 列表/查询行为 | start 行为 |
| --- | --- | --- |
| 五个默认绑定全不存在，Project 配置可正常读取 | 新来源尚未初始化，视为空；旧 Run 列表和详情正常读取，不为查看自动建模型/目录 | 通过发行资产初始化后再创建新 Run |
| 只存在部分绑定，或完整绑定对应模型不兼容/缺失 | 明确报初始化不完整，不当成空来源或旧 Run 不存在 | 仅补齐缺失且兼容的项；冲突需修复，未完整前不创建 Run |
| 绑定完整，底层 Store/I/O/元数据错误 | 明确报存储不可用，不回退、忽略或返回空图 | 不假装成功，不覆盖已有数据 |
| 绑定完整且可读取 | 按实际来源合并列表/定位详情；同一 Run ID 两边同时存在则报歧义 | 创建新的自由探索 Run |

只有确认“五绑定全不存在”才采用未初始化分支，不能捕获任意 STORE_NOT_FOUND/I/O 错误后统统当作旧模式。Project 配置损坏本身始终是错误。

### 3.3 实体 ID 与存储 data_id

| 实体 Store | data_id | 模型内容 |
| --- | --- | --- |
| runs | run_id | Run.id=run_id |
| steps | run_id/step_id | Step.id=step_id，Step.runId=run_id |
| artifacts | run_id/artifact_id | Artifact.id=artifact_id，stepId 保持实体 ID，通过该 Run 内的 Step 校验归属 |
| externals | run_id/external_id | External.id=external_id，External.runId=run_id |
| reviews | run_id/review_id | Review.id=review_id，artifactId 保持实体 ID，通过同 Run 的 Artifact/Step 校验归属 |

键的组合与拆解集中在仓储适配器；领域不拼接本地文件路径。dependencies、revisedFrom、Step.artifact、Review.artifactId 等仍引用实体 ID，所有定位都带已知 Run 上下文。Store 返回的记录外层 id 是完整 data_id，value.id 是实体 ID，二者不混用；列表返回完整键，按精确 run_id/ 前缀筛选并处理全部分页，不能误匹配相似 Run ID。

不新增模型字段，不从 data_id 前缀替代领域归属验证。模型内已声明的 runId、stepId 等继续保留，必须与存储键所表示的运行一致。业务 contentRef.dataId 仍是其目标 Store 的真实完整 ID，不擅自加上当前 Run 前缀。

### 3.4 JSON ValueStore 分层 ID 的实现范围

| 关注点 | 具体规则 |
| --- | --- |
| 可读映射 | `data_id=a/b` 保存为 Store 根目录下 `a/b.json`，只对末段追加 .json；记录管理字段 id 为 a/b；不编码或散列公开键，目录只是此 Factory 的映射方式 |
| 合法键 | 使用现有 portable 相对路径规则，每段非空、NFC、可移植；禁止绝对路径、前后/重复斜杠、反斜杠、点/上级路径、保留设备名和内部 .memsphere- 前缀；末段加后缀后仍满足单段长度限制 |
| 目录访问 | 复用 shared/filesystem 的逐段解析、防路径穿越、别名和 symlink 校验；create/upsert 可建缺失父目录，get/has/update/delete/list/openExisting 不为缺失数据创建父目录；符号链接不作为正常路径跟随 |
| 单条原子操作 | create/update/upsert 继续在目标叶文件所在目录进行原子发布；同一 data_id 的整次读-改-写持有同一个原生记录锁；版本条件检查与写入同锁，不在读完后再无保护写回 |
| 锁与删除版本 | 根 `.memsphere-json-store` 中的键由完整规范化相对记录路径计算，包含全部目录段；`run1/x` 与 `run2/x` 独立，大小写/Unicode 别名共享冲突检查。无斜杠旧键的散列输入及元数据位置保持不变，不重置旧 revision。revision-state 的 filename 字段允许完整相对路径，校验与键计算同步升级 |
| 删除与重建 | 删除只移除该叶记录，不递归删除目录/其他记录；保留完整键对应的版本高水位及永久锁。删后重建版本递增，旧 expectedRevision 不得命中新记录 |
| list | 递归枚举业务 JSON 叶文件，移除末尾 .json 得到完整 data_id，沿用完整键的稳定词法顺序和分页。根元数据目录单独验证后排除；不进入它，不把临时发布文件、锁或删除历史当作业务记录。共享 walker 的默认 DataStore 行为不被意外改变 |
| 业务操作入口 | 同步 `src/project/data-service.ts` 的 ValueStore ID 校验、business-stores 的目录协议扫描/重新登记检查；CLI data read/create/update/upsert/edit/delete/export 接受同一完整 ID，JSON 回执不截掉 Run 前缀 |
| 兼容与能力 | 既有扁平键及其文件不迁移，允许与分层记录共存；保持 Factory ID/config 和 ValueStore 接口，不添加分层开关、prefix 参数或新 Store 类型。API 层仍按绑定后端能力处理，不把所有远端后端等同于文件系统 |

不全局放松 validateFilename。新增或复用相对 ID 校验用于需要分层的调用点；withRecordLock/recordStateKey 与 revision-state 一并适配完整路径，旧单文件调用保持原行为。已有 list 游标仍只代表同一 Store 的词法续查位置，不承诺并发快照。

## 4. 必要模型差异

| 模型 | 变更 | 必要性与约束 |
| --- | --- | --- |
| Step | 可选 reads，map 键为 artifact:ID 或 external:ID，值为 {readAt} | 两类阅读统一归目标的生产 Step；不写来源 Step 或 Run。它是辅助候选，不是依赖或审计全集 |
| Step.artifact | produce.id 可指向正在生产的 draft，也可指向已提交成果 | create 时即绑定目标 ID；Step.done 才表示完整接纳，不额外增加 targetId 字段 |
| Artifact | 不加字段；补充 draft / submitted 的内容约束 | create 的空 draft 没有 content/contentRef、dependencies=[]；report 提交时必须二选一。revisedFrom 可在声明时确定；已有的 Schema draft 规则保持独立 |
| Review | `roundId` 从必填变为可选 | 无 roundId 表示轻量评论；有 roundId 的正式评审保留原有轮次约束 |
| Review.reviewer | 增加可选 `source: human / agent` | 无正式轮次时必须填写来源类别，可不填 actorId，不要求注册 Actor；role 沿用 reviewer，表示意见提供者。正式轮次仍按原角色/Actor 规则处理 |
| Run、External | 不增加字段 | Run 不汇集读取记账；不为图选择、事务或修订序号另设字段 |

轻量 Review 创建时一次保存 submitted 状态、comments、createdAt 与 endedAt，不生成 reviewRound、Assignment、vote 或 attempts。至少一条非空评论，各评论有独立 ID 与 createdAt；顺序与重复 --comment 一致。source 只是来源声明，不验证或冒充具体 Human 身份；界面用简短的参与者类别显示，不加说明段落。

带轮次的正式 Review 继续要求合法 roundId、绑定身份与对应产物；无轮次不允许写入正式 vote、轮次配置或 attempts。无法用当前 Runtime 支持的 Schema 表达的交叉约束由领域代码执行，不使用 oneOf 等当前不支持的规则。

Step.reads 只在已确定生产上下文且目标 Step 允许更新时记录，Run 必须仍为 running；终态运行和已完成 Step 仍可读，但不因阅读改写历史记录。候选提示限定本 Step，不清空其他 Step 的记录。它不是完整审计日志，只记录通过本轮 CLI 完成的产物读取，不监控编辑器、浏览器或其他工具的读取。读取成功后提示近期读取且未被本次明确依赖覆盖的候选，不阻断提交、不添加确认参数，也不自动关联。读取记录属于辅助信息；记账失败不影响已经成功的正文读取或文件输出，只通过告警渠道提示，不将成功读取判为失败。

## 5. 生产、并发与失败边界

### 5.1 create → 读取 → report

| 阶段 | 持久化及 CLI 行为 |
| --- | --- |
| 声明 | artifact create 返回目标 B；预分配 B 和 Step ID，先保存无正文 draft B（含 stepId），再建立最小 running Step（artifact={mode:produce,id:B}）；两者完整才返回成功。draft 保存后已有足够信息 redo 建 Step |
| 阅读 | artifact show --artifact A --for B / external show --external E --for B；正文成功后尽力记到 B 的 Step.reads；不传 --for 只浏览 |
| 生产 | Agent 编辑、测试，不上报每次尝试；目标和 Step 始终相同，不根据上次 report 或名称推断边界 |
| 校验 | report --target B 只接受同 Run 未提交目标；完整解析内容、展开标签、校验引用和模型。失败不改草稿或读取记录 |
| 接纳 | 业务服务在 Run 短锁内 CAS 提交同一 B，再补齐 Step.done/endedAt；两者完成才成功。目标身份和 revisedFrom 在 create 时确定。中断后按已提交 B redo，不重写内容或生成新 ID |
| 查看 | 再次 show B 不会开始下一项任务；带 --for B 时若 B 已提交，正文仍返回，但跳过记账并告警 |
| 修订 | artifact create --revised-from B 产生 B_NEW 及新 Step；阅读用 --for B_NEW，提交用 --target B_NEW。旧 B 固定，历史回退复用同样操作 |
| 便利入口 | 无需前置阅读时，完整 report 自动建立 Step/Artifact 并提交；不要求所有简单结果都先 create |

create 不接收正文或依赖；名称新建必填，修订可沿用原名；标签 default 加显式集合，自定义标签不从旧版继承。report --target 保留声明时名称、revisedFrom，拒绝再次提供两字段，新增标签与既有标签合并。提交时未提供依赖则从 revisedFrom 继承具体 ID，否则以显式集合替换，[] 清空。revisedFrom 不是 dependency。

每个目标独立绑定 Step，同 Run 可有多个正在生产的目标；无全局 selection、单活动 Step 假设或隐式切换。不提供普通 report --draft，不把无正文声明扩成局部内容编辑。流程执行已有 Action 上下文，仍由旧执行器推进，不增加 create 操作。

相同内容两次直接 report 得到两个成果；target 模式只产生一份提交结果，普通重复 report 仍按现有规则拒绝；内部 redo 则按同一 Artifact ID 补齐缺失步骤，已完成返回已有结果。网络结果不明先查目标状态，不新增请求幂等参数。Store revision 只是持久化元信息，不是产物修订号。

### 5.2 单记录 CAS 与业务编排

| 层次 | 本轮责任 |
| --- | --- |
| ValueStore | get 返回 revision；update/条件 delete 带 expectedRevision，比较与修改原子完成；create 不覆盖。文件锁与原子替换复用现有实现 |
| 业务服务 | 按用例安排多个模型的写入顺序；涉及同 Run 的 report、finish、abandon 等约束时，在短 Run 锁内检查状态并写入；不同 Run 独立，不跨 Agent 生产或正文输出持锁 |
| 查询 | CLI/View 共用完成判定；遇到写入中间态显示未完成，不拼成已完成结果。只读浏览不触发写入或要求 Store 提供多记录快照 |

Run 锁由 Project 适配层装配，业务服务在应用用例内使用；首版复用跨进程原生文件锁，放在项目 .runtime/context-control/ 的按 Run ID 定位的永久锁文件。始终先 Run 锁后单记录锁，不锁整个 Project，也不把业务锁塞入 JSON ValueStore 的元数据协议。Store 的职责仍只是单记录 CAS。

finish 与 report 在同一 Run 锁内重新检查状态并串行执行：report 先完成，finish 可读到完整结果；finish 先完成，新的 report 被拒绝。finish 写 Run 的状态、交付根和结束时间用一次 CAS，同根集合重复执行返回已有结果。跨记录操作不要求全有或全无，写到一半退出后按下节 redo。

本轮沿用现有 Store 配置机制，不增加改绑禁止规则、绑定版本隔离、配置切换锁或迁移恢复协议；不宣称支持运行中换存储地址。普通打开/输入/模型读取校验仍保留，实际读取或写入失败正常报错。

### 5.3 幂等 redo

每个业务操作安排好写入顺序，先保存后续步骤所需的信息。redo 始终使用已有实体 ID：目标已达到就返回，缺的步骤补做，已有内容冲突或信息不足再报错。反复 redo 不增加 Artifact、不覆盖已提交正文、不重复创建 Step。不增加事务日志、补偿流程、自动回滚或通用修复系统。

| 场景 | 自动 redo |
| --- | --- |
| create 的 draft 尚未保存 | 没有已持久化操作可恢复；命令正常失败，后续重新 create 即可 |
| draft B 已保存，Step 未保存 | B 已包含 name、stepId 等信息，Run 上下文已知；用相同 stepId 建立最小 running Step 并指向 B。已存在且归属一致则沿用，不覆盖已有生产状态或读取记录 |
| B 为 draft 且 Step 已存在 | 正常生产，没有需要 redo 的提交，不擅自提交空正文 |
| B 已 submitted，Step 未 done | 读取固定的 B，校验归属与引用后，用原 Step ID 补齐 done；已 done 且指向 B 则直接返回，不再写入 |
| 输入缺失、实体关系冲突、Run 已终态而操作未完成 | 无法安全 redo，明确报错并列出相关 ID；不猜正文或静默改数据 |

触发点明确为该 Run 下一次业务写操作（含 create、report、finish、abandon）开始时：在 Run 短锁内先对已有 Artifact/Step 配对执行上述 redo，再执行当前操作。依赖读取记账如遇 draft 的 Step 缺失，可在自己的尽力处理范围内复用同一 redo；失败仍仅告警。status/show/View 保持只读，显示中间态和下一次写操作会重做的提示，不另加 repair 命令。

恢复所需信息留在现有 Artifact 和 Step 中：create 先保存 draft 后保存 Step，避免只留下无法还原名称等信息的空 Step；report 先保存完整 submitted Artifact 后完成 Step。直接 report 校验完整输入后先保存 submitted Artifact，再建立/完成最小 Step，复用同一 redo。Step 的必填 id、runId、createdAt、status 与 artifact 关联在首次补建时生成并保存，以后不重置。

内部 redo 与重新执行一条没有目标 ID 的 CLI 请求不同；不会靠正文相同猜测它们是同一个请求。首版不承诺任意网络重试自动去重。

### 5.4 正文优先，记账尽力

1. 先验证源材料的归属、完整提交、contentRef 及 SHA-256，正常读取正文；正文错误必须失败。
2. stdout 输出正文或 --out 排他写入文件；输出失败正常报错，拒绝覆盖已有文件。
3. 不带 --for 不记账；带 --for 时在正文成功后解析同 Run 草稿目标，找到其生产 Step。在业务 Run 短锁内核对 Run running/Step running，合并 Step.reads 并用最新 expectedRevision 条件写入；不更新 Run 或来源 Step。
4. 无效/跨 Run/已提交目标、已完成 Step、终态 Run 均跳过记账并告警。存储失败、冲突或超时也仅告警，正文或文件保留、命令成功；stderr/JSON warnings 不混入正文。
5. 记账总等待上限为 1 秒，端口传递取消信号，超时后取消尚未提交的写入；已进入原子发布的结果按实际完成处理，不能安排脱离命令的无限后台写入。CAS 冲突至多重读合并一次，仍冲突则放弃。

Step.reads 的键为 artifact:ID / external:ID，值 {readAt}，重复材料更新最近时间。它不是审计全集，可能缺失；候选只是本 Step 的辅助提示，不自动添加依赖、不阻断 report、不加确认参数，也不按上次 report 时间清空。错误目标不创建替代 Step。编辑器和浏览器阅读不在记账范围。

## 6. 内容与引用

| 入口 | 保存与读取方式 |
| --- | --- |
| 直接文本/正文文件 | 由系统装箱为 content.model={definedBy:raw.json,definition:"{}"} 与 content.payload={contentType,content:string}，默认 text/plain；保留正文原始换行与空字符串，不创建具名业务 Model |
| 结构化 content | 沿用 model.definedBy/definition 与 payload.contentType/content；不另加 encoding/type/format/layout；只执行领域结构检查，不要求预配业务标准 |
| contentRef | 经注入的内容读取端口解析指定 Store/dataId；DataStore 返回原始 Payload 字节，ValueStore 使用其模型 Runtime 与现有 JSON Serializer 得到稳定字节表示，再检查 sha256；不自行读取后端文件。缺少序列化能力或引用内容改变均明确失败 |
| 查看与 --out | stdout 或文件只输出正文；--out 使用排他创建，默认不覆盖。元信息和读取候选留在回执渠道，不混入正文 |
| 真实前端预览 | 文本按文本节点展示；Markdown/JSON 复用现有安全渲染组件，不把示例中的 innerHTML 写法用于不可信正文。不能预览的格式保留清楚的访问方式 |

内容读取端口由 Project 适配层装配，按现有业务 Store/模型服务打开并读取；返回模型/格式来自目标 Store，不用不覆盖配置变更的 model-operation stamp 冒充改绑保护。不把任意 Value 强行 JSON.stringify 成内容，也不在领域服务内调用 openBusinessStore；不支持的编码明确拒绝。无文件路径能力的测试后端必须同时覆盖内嵌内容与该端口的 contentRef 读取。

External 以 source 字符串加内嵌内容或 contentRef 保存；source 不拆出新的来源实体。Review 材料由目标 Artifact.dependencies 递归取得，不新增“补充材料”字段。

## 7. CLI 与新旧路由

| 场景 | 路由与限制 |
| --- | --- |
| start 无 Procedure/无 Procedure 文件 | 创建新自由探索 Run；--name 必填；不要求 review 配置或开始生产信号 |
| start 指定 Procedure/Procedure YAML | 保持旧流程，包括 Schema 特例和既有评审配置；--change 不可在无记忆的自由探索中被静默忽略 |
| status/show/report/abandon | 先明确 Run 的存储来源，再进入对应应用服务；两边 ID 同时存在时拒绝歧义，不以 ID 前缀猜来源，不在 Store 故障时回退 |
| artifact create/show | create 返回空草稿及关联 Step；show 按 --artifact 源 ID 读取，可带 --for 目标及 --out。旧运行原有 --step/导出保留，新参数混用明确拒绝 |
| artifact tag / impact | 新运行的标签追加及真实依赖下游查询；无独立 rewind、submit 或依赖确认命令 |
| external add/show | 同 Run 的文本/结构化资料入口；show 可带 --for 目标，记账规则与 artifact show 一致 |
| report --target | 同 Run 草稿一次提交完整成果；不带 target 保留自动创建便利入口；旧流程不支持该参数 |
| review create/list/show | 新轻量评论入口；旧 review wait/vote/assignment/submit 等正式评审入口维持原行为 |
| finish | 新运行选择一个或多个具体 Artifact ID，校验后完成；不将其强加给旧流程执行器 |
| --output json | 新命令返回结构化回执；原文和 --out 与回执分开；旧命令默认提示不被整体替换 |

命令清单、互斥规则和示例继续以已通过需求及 `context-control-exploration-cli.md` 为准。本次经 Human 要求增加 artifact create 作为需要生产前阅读的目标声明；不要求 Agent 管理 Step、revision 或锁，流程执行也不增加此步骤。内部协调、恢复和初始化由服务完成或明确报错。

## 8. Run 前端接入与版本图

| 接入点 | 方案 |
| --- | --- |
| 既有运行列表 | 同一列表读取新旧摘要并保持运行身份；共享名称/状态等展示字段，不把新模型持久化成旧 RunState |
| 既有详情路由 | 继续使用 Run 详情路由体系，由读取适配器给出 flow/graph 展示数据；展示判别是响应数据，不是新持久化 mode 或全局 state |
| 新图详情 | 新数据读取 Artifact/Step/External/Review Store；旧流程保留既有详情及正式评审路径。没有新一级导航、独立 Run 列表或正式生产页面 |
| 顶部标题 | 公共 header.title 随 Run 更新，名称和状态不在内容区重复 |
| 节点与标签 | 名称、标签、版本及必要状态/评论数；图上隐藏 ID/default，浮窗显示 ID/完整标签；两处使用 ctx.ui.badge() |
| 产物浮窗 | 用现有 overlay/主题区域，桌面约 90% 视口，760px 及以下铺满；左正文、右该 ID 的评审，保留窄屏内容/评审切换 |
| 草稿 | 运行态保留正在生产的草稿节点，不画尚未固定的依赖边；空正文显示未提交。草稿不替换最新已提交版本，不纳入交付闭包 |
| 更新 | CLI 创建/提交后刷新读取真实 Store；避免响应竞态让旧数据覆盖新选择；错误与暂无产物/暂无评审分开 |
| 动作范围 | 保留旧运行的原有动作；新运行只接入本轮已经定义的动作，不让旧归档或正式评审按钮误操作新存储 |

### 版本投影规则

- 以 revisedFrom 的实际链或分支分组，不用 name 或标签猜测同一产物；版本顺序结合修订关系和 Step.createdAt，ID 仅作稳定的并列排序，不生成权威持久化版本号。
- 默认收起无须当前查看的修订；交付态严格从 finalArtifactIds 求闭包。当前依赖真正引用旧版时保留那个 ID，不能为了显示“最新”而替换引用或造边。
- 选择历史 Artifact 后，先求它的实际依赖闭包，再沿实际依赖反向查下游；仅显示兼容所选版本的后续结果，没有下游则不显示。修订关系本身不是下游触发边。
- 同一修订族有多个分支时，历史列表保留可访问的全部真实版本；若一个实际成果确实依赖同族的多个版本，不能为了折叠丢掉必要节点或边。默认选择只控制展示，不删除历史；线性修订用原型的三节点案例验收，分支及多版本引用另以真实 ID 回归保护。
- 图上历史选择只切图，点击产物才开浮窗。浮窗内上一版/下一版或版本选择更新同一打开浮窗及背后图，不销毁重开；评论、标签和正文均按新选 ID 更新。
- 关闭后保留图的版本选择并恢复节点焦点，可返回最新/交付视图；状态只保留在当前界面会话，不新增 Run.selection。

## 9. 开发任务与影响范围

| 顺序 | 任务 | 产出与主要路径 |
| --- | --- | --- |
| T0 | 对齐基线与确认接口 | 独立 codex 分支、快进 master，保留原文档/原型及另一份 graph DSL 文档 |
| T1a | 分层 ValueStore | Factory、shared filesystem、revision-state、Project data/目录协议/重新登记及类型文档；保留旧扁平键和版本记录 |
| T1b | 模型发行与 Store 装配 | reserved-models/context-control 清单与五模型、加载器、构建检查及 npm pack 干净安装；初始化状态三分支；仅上表的模型差异 |
| T2 | 领域用例与恢复 | 分层仓储键、引用校验、单记录 CAS/业务 Run 短锁与幂等 redo、Step.reads 记账与输出、create/target 完成判定、恢复、终态和条件写、内容读取端口 |
| T3 | CLI 新旧路由 | 新自由探索动线；旧流程、正式评审、Schema 回归 |
| T4 | 运行读取与前端 | 既有 Run 列表/详情适配、真实产物图与浮窗，替换原型固定数据 |
| T5 | 联动及失败验证 | 真实 CLI + Store + View 闭环、故障注入、并发与 50 次修订；修复后复跑受影响测试 |
| T6 | 语义资产与交付 | 文档、System Memory、Skill、ChangeSet 验证；创建并维护本轮 active change，验收后移除 active status、写 completed_at，检查归档目标无冲突后移入 changes/archive/completed/，再提交本轮 commit；PR 仍由 Human 决定 |

## 10. 验证矩阵

测试按用户可观察契约组织，最低适用层级验证；纯函数不启动服务，Store 协作模块测试可使用受控临时目录；CLI/HTTP/浏览器是真实边界集成测试。

| 层级 | 前提与操作 | 应观察到的结果 / 对应验收 |
| --- | --- | --- |
| 分层 Store 模块 | 两级/多级 ID 的 create/get/has/update/upsert/delete、删除重建，旧扁平数据混存 | 文件位于完整键目录，记录 id 正确；CAS 冲突、版本高水位与旧键版本均保留；读缺失项不建目录 |
| 路径/锁回归 | 非法路径、别名、symlink、文件/目录冲突；不同目录同叶名和同键跨进程写入 | 不越过 Store 根目录，不误共享不同键锁；同键线性化且别名/元数据损坏明确失败；flat 键旧锁及 revision 不失效 |
| 分层枚举集成 | 超过一页的混合深度记录、删除记录和内部元数据；CLI data CRUD/edit/export、非空目录重新登记 | 完整键无缺失重复，分页有效，元数据不作为记录；CLI 与重登记同样接受合法分层 ID |
| 干净发行安装 | npm pack 后仅解包产物，在无这五模型/Store 的新 Home/Project 启动并重启 | 无源码树或预装 Project 也能初始化；包内五定义/清单齐全、数据可读，AC1、12、13 |
| 初始化边界集成 | 五绑定全无的旧项目、部分初始化、完整绑定但损坏、完整新旧并存 | 旧项目列表/详情不受影响；只对全无绑定视为空，其他故障不被吞掉；AC10、13、17 |
| 读取并发集成 | 跨进程 show/show、show/finish、show/abandon，含 stdout、--out、记账失败/超时/冲突 | 记账成功时合并读取项，失败允许缺失并给告警；正文/文件保持成功、终态不回退。内容或输出本身失败仍明确失败，AC3、14–16 |
| 生产生命周期 | create→artifact/external show --for→report --target；多目标并行、纯浏览、提交后再读、直接 report、修订声明 | 读取归目标 Step，同 ID 提交且只成功一次；纯浏览/提交后不新建 Step，正常草稿不误判失败；旧流程无 create 负担 |
| CAS 持久化模块 | 相同旧 revision 的并发更新/条件删除/删除重建/重复 create；多进程同 target report、report/finish、记账/report | 旧版本不能覆盖或命中重建记录；同目标只有一份提交结果，业务 Run 锁内终态检查有效；记账不覆盖 Step.done。JSON 与可替换后端共享契约 |
| 领域单元 | A→B→C 与修订、标签展开、非法来源 | 具体 ID 固定、去重、继承/替换/清空准确，非法引用和终态变更拒绝；AC4、6–9、14 |
| 模型/Store 模块 | 五个真实模型 Runtime 与 JSON Store 创建和重启读取，检查四实体的完整键、value.id 与归属 | 新字段可存取且校验生效，无旧 RunState 文件；缺失/冲突绑定明确失败；AC12、13 |
| 可替换性模块 | 无文件路径能力的内存 Store 和内容端口执行内嵌/contentRef 用例 | 领域服务完成 start/report/review/finish，引用检查正确且不导入文件后端；AC12 |
| redo 模块与重启集成 | create 在 draft/Step 之间、report 在 submitted/Step.done 之间退出；重启后执行下一写操作触发 redo，再重复触发 | 使用原 Artifact/Step ID 补齐；重复 redo 不多建、不重写，不再遗留已知中断死路；信息不足/冲突明确报错；AC16、AC25、AC27 |
| 并发集成 | 两个 CLI 进程 report/tag 与 finish 竞争，以及 Store 记录版本变化 | 单记录冲突不覆盖，业务 Run 锁控制终态编排；不把未建设的改绑隔离作为本轮验收；AC14–16 |
| CLI 集成 | 实际 start→create→show --for/--out→文本/文件/结构化 report --target→review→修订→finish，另测直接 report | ID/正文/多评论顺序正确；输出文件不覆盖；输入系统字段、互斥参数、无匹配标签均失败；AC1–8、15 |
| 多根与重启集成 | 多交付根及重复/非法根；进程重启后继续读取 | 闭包并集准确、重复 finish 幂等、非法选择不部分完成；AC9、13 |
| 新旧路由集成 | 同一 Project 既有流程与新自由探索并存 | CLI 与既有 Run 列表/详情均选对后端；旧流程无迁移、无双写、旧路径回归；AC10、13、17 |
| 真实 View 浏览器集成 | CLI 提交后从现有 Run 列表打开；点击、关闭、翻页、刷新 | 正确正文/评审/徽标/顶部标题；历史只切图，浮窗翻页保持同一打开节点；AC17、20–23 |
| 版本图回归 | 50 次修订、无下游版本、分支、同族多 ID 实际依赖 | 主图不随无关历史膨胀，无伪造下游或替换引用；交付根固定；AC18、23 |
| 窄屏与错误浏览器集成 | 桌面/大视口/760px 以下、键盘/Escape、空数据和读取失败 | 区域与 Run 浮窗一致，正文/评审可读，焦点恢复，错误不冒充空态；AC19、22、23 |
| 内容安全/引用集成 | 不可信 Markdown/文本及 contentRef 内容被改写 | 不执行注入内容；sha256 不符明确失败，不展示错误旧内容；AC4、17、19 |

先运行分层键涉及的 `test/data-filesystem-json-valuestore.test.ts`、`data-filesystem-helpers`、业务 data CLI、Store 重新登记、模型/保留版本及发行包测试，确认旧扁平键不回归；随后运行新增 context-control 领域、CLI、Store、图投影和真实 View 的受影响测试，再执行 `run-store`、`run-command`、Artifact Review、View、模型/业务 Store 等现有相关回归。涉及 System Memory 源或安装时加入 `reserved-store`；涉及 Artifact 格式边界时加入 `artifact-validation`、`artifact-format-fixtures` 及相关 migration；实际改到语法/序列化时运行对应 Memory 测试，不以跳过既有断言维持通过。

最终必须实际执行 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。前端须在真实 Shell 用 playwright-cli 操作，不用固定示例或 HTTP 200 代替。存在 Memory 差异时运行最终 `memsphere memory change validate <change-id>`，记录 ID、状态和 View 链接。

当前只完成代码调查和方案编写；上述新功能测试尚未执行，也没有产品实现通过的结论。浏览器检查方式按此前 Product Design Skill 的许可要求单独处理，未获准前不调用 Playwright。

## 11. 采用规范与语义资产

| Memory/资产 | 本方案采用项 |
| --- | --- |
| memsphere-repository-requirement-rules | 第4轮固定契约加本次显式需求补充；列明范围与 AC24–AC27，补充已由第4轮Human正式确认 |
| memsphere-repository-development-rules | 现有实体承载过程，不增加事务实体/全局 state；公共 UI 复用；无新增 YAML 关键字 |
| memsphere-repository-delivery-rules | 验收后更新 change.md、移除 active status、写 completed_at 并归档整个需求目录，归档目标存在时拒绝覆盖；未完成收尾不算完整交付 |
| memsphere-repository-testing-rules | 单元/模块/集成分层、故障与真实边界覆盖、等待确定状态而非固定 sleep；执行全量与 ChangeSet 校验 |
| memsphere-procedure、procedure-schema、schema-schema、yaml-syntax-rules | 检查并更新自由探索、旧流程并行、Artifact/Review 说明和明确的语法边界 |
| memsphere-framework、相关 Run/Review 教程、Skill | 同步五模型 Store、新旧运行服务、轻量评论与既有 Run 图展示；不能把来源类别写成认证身份 |
| general-task-execution、procedure-construction | 逐项判断通用执行和流程编写说明的影响，不需修改时记录理由 |
| reserved-memory、Project 副本、manifest | 按仓库要求同步源与副本；只有新增/重命名/删除 System Memory 才更新 manifest，最终记录 ChangeSet 证据 |

### 本轮需求目录与交付收尾

已检查当前工作区 changes/active/*/change.md，未发现本 Run 或上下文控制自由探索的 active 需求目录；因此不能假称已有记录。正式施工 T0 创建 `changes/active/20261024-context-control-exploration/change.md`，关联本 Run，并记录需求、方案、任务与验收；同名目录已有内容时先核对归属，不覆盖。T6 在全部实现/测试/提需验收通过后填入真实 completed_at、移除 active status，检查 `changes/archive/completed/20261024-context-control-exploration/` 不存在后移动整个目录，再核对运行关联、文档链接和工作区范围。归档目标冲突或未完成时停止交付收尾，不覆盖且不宣称已交付；本轮 commit 只能包含本需求文件，不混入 procedure-graph-syntax 草案。

## 12. 风险与方案评审门槛

- 目前业务 Store 打开逻辑只装配本地 Factory；领域接口为替换后端保留边界，本轮不声称已经支持任意远端 Store。
- Store 提供单记录 CAS，业务按 Run 加短锁编排。中间态通过原 ID 幂等 redo 补齐；缺信息或冲突再报错，不扩成通用事务和容错系统。
- 按 Human 最新决定，改绑保护与迁移并发不纳入本轮；不新增禁止改绑或绑定版本隔离。
- 分层 data_id 是 Human 明确追加的通用 Store 能力，必须同时保护现有扁平键、旧元数据及通用 data CLI，不以仅让当前自由探索案例能写入作为完成。
- 全量分页关联在首版可能较慢；先保证完整性，不增加持久化查询索引或缓存副本。以后按实际规模优化，不能截取第一页当成全图。
- 草稿声明同时保存 redo 所需的生产目标信息；首版重点验证 draft→Step、submitted→Step.done 两条可重复重做路径。
- 需求补充与 AC24–AC27 已经由第4轮 Human 明确产品确认；正式授权、Runner 处置与通过结论均保存于该轮。此处更新工作文档状态，不改历史固定 Submission。
- Human 作为架构师参与此阶段；本方案通过前不进入正式开发。此处是方案评审，不将前一阶段产品通过票沿用为架构通过票。

## 13. 向前兼容

结论：不需要向前兼容。

沿用已通过需求契约的稳定 checkpoint 判断：本地未发现名称含 stable 的 Tag，不为未发布的领域草案自动迁移。与此同时，既有扁平 JSON ValueStore 数据、完整 revision/删除高水位、默认配置和通用 data 命令继续可用，是本次扩展明确保留的产品行为，必须回归验证。分层键与扁平键共存，不批量搬迁旧记录；新领域的 run_id/实体_id 只作用于本轮新建数据。旧流程仍保留原存储与运行入口。


## 附录 A：已确认需求补充

固定文本及确认记录见第4轮不可变产物与Human意见；以下同步工作文档。

状态：已由产品负责人 Human 确认。固定文本为实施方案第4轮 round-20261024-111321z-5cbf4ff3 附录A；确认与方案通过票保存于 assignment-20261024-111321z-d6960ebe，授权原文为“补充需求我也确认了，这轮我投通过，继续往下走吧。”后续基线为原第4版需求加该固定补充及本次确认记录，历史材料不改写。

### 追加决定与原条款的关系

| 决定 | 产品行为及边界 | 替代或补充原条款 |
| --- | --- | --- |
| 分层 data_id | 扩展现有 JSON ValueStore，a/b 对应 a/b.json；通用 data 命令、完整键分页与 Store 重新登记一同支持。Run 自身用 run_id，其他四模型用 run_id/实体_id；模型内 id 仍是实体 ID | 增补 AC12/13；这是公共 Store 能力变化，不仅是内部路径选择 |
| 兼容责任 | 旧扁平键、旧记录、revision/删除高水位和默认配置保留；新旧键共存。禁止路径穿越/别名/symlink，删除不递归误删。其他后端不被强制套用目录结构 | 增补兼容范围；不增加开关，不迁移旧运行 |
| 声明生产目标 | artifact create 返回无正文 draft 和系统关联 Step；Agent 管理 Artifact ID，不显式创建 Step。读取用 --for 目标，report --target 提交同一 ID。简单结果可以直接 report | 替代普通产物提交、不可变成果、AC2 中“report 才建 Step”和“不提供普通 draft”的绝对表述；仅开放空目标，不开放普通局部正文草稿 |
| 修改与回退 | create --revised-from 创建新 ID、新 Step；旧成果不变，读取旧成果和新上游后提交新目标，依赖默认继承或显式替换 | 补充 AC6/7；原直接修订 report 仍可用，无独立 rewind |
| 阅读归属 | artifact/external show --for B 的记录归 B 的生产 Step.reads；无 --for 是纯浏览。提交后阅读不自动开启下一任务，不按名称、时间或单活动 Step 猜边界 | 替代 AC3 及读取候选中 Run 全局记账设想；候选不自动变依赖 |
| 正文与记账 | 正文及输出文件先成功；记账失败、冲突、超时或目标不可记账只告警、不影响正文。内容解析/引用校验/输出本身错误仍失败 | 明确 AC3 的失败语义；不将辅助功能变成读取门禁 |
| 可靠持久化 | 持久化层比较 expectedRevision 并原子修改，拒绝旧版本覆盖；create 不覆盖。生命周期减少共享更新；单记录 CAS 归持久化层，多记录约束由业务层按 Run 加短锁编排 | 补充 AC14–16；CAS 元信息不写成领域字段，不要求 Agent 传版本 |
| 跨记录一致性 | 创建/提交/终态操作须有可验证的接纳边界；单条 CAS 不代表多记录事务。中断采用同一实体 ID 的幂等 redo：能安全重做就自动补齐，已完成直接沿用，缺少信息或冲突再报错；不要求多个文件全有或全无 | 继续保留 AC16，不弱化或虚构全有全无保证 |
| Store 改绑 | 本轮不增加改绑禁止、绑定版本隔离或迁移保护，沿用现有配置行为；后续再支持该场景 | 不把改绑并发正确性扩成本轮验收 |
| 草稿查看 | 可找回草稿目标和状态；图保留正在生产的节点，尚无固定依赖边，点击显示未提交。草稿不替换默认最新已提交版本、不可作依赖或交付根 | 补充 AC17–19；其余已确认原型交互不变 |

### 补充验收

| 编号 | 验收标准 |
| --- | --- |
| AC24 | JSON ValueStore 与通用 data CLI 的分层 CRUD/upsert/edit/export、完整键分页、非空目录重新登记可用；合法分层键和旧扁平数据混存。验证路径/别名/symlink/元数据保护，旧 revision 保留、删除重建不命中旧 CAS，不误删同目录其他记录。五模型按上述键布局读写，实体归属仍独立校验 |
| AC25 | create 返回空 draft B 与关联 Step，跨进程读取 A/E 时 --for B 记录归 B 的 Step，再 report --target B 完整提交且 ID 不变；同目标只提交一次。多目标不串记、纯浏览不新建 Step、提交后阅读不新建任务；重启可找到草稿继续生产，旧流程不增加 create；简单结果仍可直接 report |
| AC26 | 正文 stdout 和 --out 成功后，注入记账失败、超时、CAS 冲突及无效/跨 Run/已完成目标，命令仍成功且正文/文件保留，仅独立告警；源内容/引用或输出失败正常报错。候选限定目标 Step，Artifact/External 都覆盖，不写 Run，不自动成为依赖 |
| AC27 | 两进程基于同旧 revision 更新时至多一方成功，旧值不覆盖；删除重建保留防 ABA 的版本语义。并发 report/finish、report/abandon、report/记账及同目标 report 不出现终态后新接纳成果或 Step.done 被覆盖；create 和 report 的各记录边界注入崩溃，重启后下一次业务写操作自动按原 ID redo，重复 redo 不新增成果或重写正文；信息不足/冲突再报错。CAS 归 Store，跨记录由业务 Run 锁编排，不要求 Project 总锁或 Agent 版本参数 |

### Human 修改要求依据

- “那就让 JSON ValueStore 支持分层 data_id 吧，其他四个模型按 run_id/实体_id 来存，把这个调整也同步到实施方案里。我投修改票，把这个修改意见提交后重新发起 review。”
- “读取记录应该放到 step 上而不是 run 上吧？”以及“这个锁不应该是业务层的锁，而是持久化层的锁。”
- “我说的持久化层的锁，不止是锁这件事情，而是要有 CAS 的保证，让数据能靠谱的被持久化。”
- “好，那就按这个思路，把自由探索下 create、读取和 report 的动线整理清楚，连同读取记录归 Step、持久化层保证 CAS 的调整，一起同步到 CLI 设计和实施方案。我投修改，整理修改意见后重新发起 review。”

- 后续明确：“CAS 只保证单记录的，多记录相当于要让多个聚合根之间有约束条件了，只能再业务逻辑层加锁来编排。”
- 最新明确：“改绑这种操作，后面会再支持的。现在禁不禁都无所谓。为了简单可以不用管。我觉得异常恢复最重要的就是能 设计好幂等的 redo 流程就行。能通过 redo 修复的都自动 redo，不能 redo 再报错。不用搞得太复杂，设计太多的容错机制来保证永远是正确的。”

以上是补充的修改依据；后续正式确认由上述第4轮 Human 通过票及授权记录保存。

## 附录 B：目标 CLI 最小用例

命令是待实现接口，不执行这些示例来操作当前旧流程 Run。R、A、E、B、B_NEW 均用实际命令返回 ID 替换。

```bash
memsphere run artifact create --run R --name "缓存方案" --tag design --output json
# 返回 B；自动关联 Step，尚无正文。
memsphere run artifact show --run R --artifact A --for B --out requirements.md
memsphere run external show --run R --external E --for B
memsphere run report --run R --target B --artifact-file design.md --depends-on artifact:A --depends-on external:E

# 查看刚提交的 B 不开启下一项任务。
memsphere run artifact show --run R --artifact B

# 修订和回退重走使用同一套操作。
memsphere run artifact create --run R --revised-from B --output json
# 返回 B_NEW，读取旧 B 后生产；未传依赖则继承 B 的具体 ID。
memsphere run artifact show --run R --artifact B --for B_NEW
memsphere run report --run R --target B_NEW --artifact-file design-new.md

# 无前置读取的完整小成果保留直接 report。
memsphere run report --run R --name "结论" --artifact "完整结论"
```

完整 CLI 动线、互斥规则、标签与轻量 Review 示例见同次修订的 docs/context-control-exploration-cli.md；本方案第5节已固定 create/for/target 的全部新增行为边界。
