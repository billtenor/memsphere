# ValueStore 内部锁可覆盖场景清理

最初 Human 要求先解决仅靠 ValueStore 内部锁可以解决的场景；随后扩大范围为逐项讨论并清除所有 Project 级锁。下文保留修订4的历史边界，后续进展单独记录。本次是对修订3之后的新指令实施，不修改修订3冻结候选、证据或旧票。后续正式验收须使用包含本次改动的新候选。

## 盘点与处理

当前生产代码中的 ValueStore 实现为 FilesystemJsonValueStore。create/upsert/update/delete 已在内部使用按记录的原生锁，存在性检查、revision 条件和写入处于同一个临界区；get 读取原子发布的文件快照。接口已要求条件检查与写入/删除原子执行，无须新增接口或另造一层锁。

| 调用场景 | 单记录内部锁能否独立覆盖 | 本次处理 |
| --- | --- | --- |
| CommandState 创建/重绑 | 能，唯一键是 agentType-sessionId | 删除 Home runner-sessions.lock，直接 create 或带 expectedRevision 的 update。并发相同绑定读取并复用获胜记录，不重置 reads；不同绑定冲突明确报错，不自动覆盖或重试。 |
| CommandState reads 更新/关闭 | 能 | 已使用单记录 CAS，无外部锁，不增加锁。 |
| DaemonTask 状态更新/认领 | 单记录更新能 | updateTask 已使用 expectedRevision，无需再修改。 |
| 普通 ValueStore CRUD | 单记录存储原子性能 | 修订4时保留；后续 Human 明确不要求绑定切换与在途操作同步，已移除普通 CRUD 的 Project 访问门，详见后续记录。 |
| Context Control 单记录持久化 | 记录写入能 | records.update 已使用 CAS；其外层还有轮次/权限/模型版本等其他资源检查。此次不重构跨资源协议或移除整个运行时访问门。 |
| DaemonTask 注册/显式 retry 去重 | 不能 | 要扫描同键其他任务、保证最多一个活动任务，保留现有锁；不把单条 CAS 冒充唯一约束或跨记录事务。 |
| Run 推进/多记录状态转换 | 不能 | 保留，另行设计。 |
| 模型定义/登记、配置、Store 绑定变更 | 不能 | 包含 Store 外文件或多资源切换，保留，另行设计。 |
| daemon 单例/启动/服务意图、Reviewer 派发进程 marker | 不能 | 涉及进程或非 ValueStore 文件，保留，不用 ValueStore 记录锁代替进程生命周期保护。 |
| Memory、App、Registry 等文件操作 | 不属于 ValueStore 单记录操作 | 不扩大范围。 |

## 验证

类型检查与git diff --check通过；初始局部验证未重建正在被Reviewer使用的dist；第3轮全部提交并由Runner要求修改后，已重建并完成修订4最终全量：175文件，0失败，402.45秒。旧版全量结果不作为本次增补的全量证据。

- 跨进程不同 session 在旧 Home 锁被另一个持有者锁住时仍能完成，且不创建 Project settings.lock。
- 多个进程同时首次创建同一 session，只有一条 revision=1；随后同绑定重入不重写记录、不清空 reads，也不创建旧 runner-sessions.lock。
- 在真实 ValueStore update 前注入另一绑定的成功 CAS，原操作收到冲突且获胜绑定保持不变。
- 同时运行 ValueStore 原子性及跨进程存储回归；最终37/37通过（11.59秒），日志/tmp/memsphere-valuestore-lock-tests.log。

这项清理不等于已解决 daemon 对 Project settings.lock 的竞争，也未调整轮询频率、模型升级协议、跨记录事务或 worker 启动恢复。上述问题按本次指令暂不处理；保留现状不代表认可Project整体互斥的设计。


## 后续清理第一项：普通业务数据操作

Human 确认不要求 Store 绑定切换与在途操作瞬间同步。一次操作使用 openBusinessStore 成功返回的绑定、目录及模型 Runtime；解绑只取消后续查找，已打开的操作可继续完成。当前实际入口是 data store remove（保留数据）以及同名 data store create，并无单独的原子切换命令。

- 普通业务 Store 的 create/update/upsert/delete 不再进入 withContextControlAccess，不申请 Project settings.lock。read/list/has/export 原本已不申请该锁。
- edit 对已打开的原 Store 使用读出的 expectedRevision 保存，不再重新打开 Store 或因后续绑定变化拒绝；同一记录的竞争继续由 ValueStore CAS 检测。
- 模型 Runtime 与 Store 打开过程的模型版本检查保留，未把准备阶段的并发模型冲突静默忽略，也不重试已经执行的数据写入。
- Context Control Store 的访问门、配置写入、模型写入和其他 Project 锁尚待逐项处理。本项不宣称所有 Project 锁已清理。
- 第4轮候选及票保持冻结，本项属于后续修订，须在完成后提交新的完整候选。

新增验证覆盖持有 settings.lock 时 ValueStore/DataStore 的 CRUD、读取及导出仍可完成，以及 edit 读出记录后解绑并重新绑定到新目录时，仅更新原目录、后续调用读取新目录。


## 后续清理第二项：配置文件修改

Human 明确本次不将配置迁移到 Model/ValueStore，维持 JSON、Zod 校验、内容 revision 和原子发布。改为由 withConfigFileLock 统一管理配置文件的修改锁：同目录 .runtime/config.json.lock，按真实父目录定位，避免路径别名绕过同一资源。

- Home 配置中心保存和 operator token 修改、Project 普通配置保存，以及 Store 创建/解绑，均使用配置文件专用锁，不再申请 Project settings.lock。保留原有 revision 冲突检查。
- Project 保存为验证 Home Provider 引用，按 Home config → Project config 顺序获取所需配置锁；普通读取及数据 CRUD 不获取这些锁。
- Managed Memory 发布/同步更新 published_revision 时，也在配置锁内重新读取当前配置，仅合并该字段，避免用旧 Project 快照覆盖其他配置修改。
- 模型事务包含 config.json 时，在提交和恢复期间使用同一配置锁；失败回滚在既有锁内执行，避免重复获取。仅修改模型文件的事务不因此获取配置锁。
- 新 Project 初始化在未发布 staging 目录写初始配置，不涉及已有共享配置。
- 显式模型登记迁移同时操作其他资源，仍保留原协调门，其 Project 锁留待后续模型场景清理；不会把这一残留描述为已完成。Context Control 和模型操作的原 Project 访问门也尚未清除。

验证：配置保存及普通 CRUD 可在旧 Project 锁持有时完成；两个相同 revision 的配置保存只有一个成功，另一个报告冲突；配置锁阻止 Store 解绑/创建，但不阻止普通 CRUD；包含配置的模型事务确实持有配置锁，失败可完成回滚并释放锁。

本项验证完成：配置/业务数据/模型事务61项通过，Managed发布及同步6项通过；最终类型检查及git diff --check通过。未重建正在供评审使用的dist，本项结论为源码针对性验证，不能代替后续完整候选的全量验收。


## 后续清理第三项：停写模型登记迁移

Human 明确由操作者负责停写迁移，不要求本次实现在线迁移或应用内暂停写入协议。删除配置保存中 migrateModelRegistrations 分支的 Project settings.lock 包装，迁移沿用配置文件锁，不另加模型迁移锁。原有显式迁移参数、目标冲突校验、复制及校验、旧目录保留、配置 revision 检查均保留。并发修改源模型登记不在停写迁移契约内。

扩充原有迁移回归：持有旧 Project settings.lock 时仍能迁移，并核对新旧目录字节、排除目录与配置版本保护。上一节“显式模型登记迁移保留原协调门”的记录已被本项取代；其他模型和 Context Control 访问门继续逐项处理。


## 后续清理第四项：流程模型产物

Human 确认移除 freezeModelArtifactTargets 和 processModelArtifact 两处 Project 锁。目标冻结读取当次目标；处理时核对冻结指纹、模型校验后，使用已打开的 Store/runtime 完成原子 upsert。之后发生的绑定变化影响后续操作。既有指纹不一致错误、业务记录原子写及历史产物快照契约保留，不增加其他锁。

回归增加持有旧 Project settings.lock 时完成流程启动（含指纹冻结）和 report（含校验/写入），并验证业务值及 revision；同时执行原有模型产物全部回归。


## 后续清理第五项：Context Control 普通访问

Human 确认移除统一访问门的 Project settings.lock，保留内部 Run 锁及 ValueStore CAS。withContextControlAccess 仅检查模型操作 stamp 和保留嵌套上下文，不再申请文件锁；模型升级内部仍可使用明确的内部入口跳过普通访问的 pending 检查。Graph/自由探索原有 Run 锁、记录 revision 协议不变。

语义变化：模型事务已经发布 pending 标记时，普通入口报 MODEL_OPERATION_PENDING，不再等待 Project 锁然后隐式继续；升级完成后可显式重新执行。已开始的操作仍使用已打开的 Store/Runtime，不新增在线升级同步承诺。

回归覆盖持有旧 Project 锁时打开服务和执行操作；持有 Run A 锁时 Run B 可报告和读取，A 等待至自身锁释放；升级的确定性发布屏障验证 pending 拒绝及完成后重试。原有升级等待大锁的测试按新契约更新。

本项验证：选取6个测试文件共94项，初次新增测试缺少临时 Run 锁目录，修正测试准备后复跑所在文件30/30通过，其余5文件64项已通过；类型检查和git diff --check通过。源码中的 settings.lock 调用现仅剩模型写入入口，下一项单独审视模型文件及恢复日志协调。


## 后续清理第六项：普通模型定义与登记发布

Human 确认采用“先写定义、再写登记”的生效契约：登记增加 definition_sha256（原始 UTF-8 内容的 SHA-256，包含 BOM/空白差异）。定义存在但未登记、定义与登记已有哈希不一致均不可用于 Runtime；诊断/修复仍可读取原始定义。加载器核对并复用同一份内容，不在校验后重新读取另一份文件。

兼容追加要求：旧登记缺少哈希时，在首次使用时通过 ValueStore expectedRevision 条件更新补齐，保留其他 metadata、UUID 和定义原文；并发补齐只允许一条获胜，冲突重新构建读取快照，不覆写已有不匹配哈希。旧安装的登记模型 Schema 以运行时的加法兼容允许新字段，不静默重写已安装定义；自定义/已损坏 Schema 仍按原校验拒绝。

普通 model create/update/delete 不再进入 withProjectModelWrite 或共享 model-operation 日志。定义通过 DataStore 接口修改，然后登记通过 ValueStore create/update/delete 条件操作发布；新登记使用基于 modelRef 的稳定记录键，避免并发首次发布生成重复 UUID 记录。已有登记 ID 保留。定义写后登记失败，不回滚覆盖其他写入；保留未生效状态，可用显式模型修改重新发布。两个无条件定义写入仍可能覆盖，DataStore 锁与 CAS 按 Human 要求本次不实施。

内置/市场发行的登记自动携带对应源哈希；显式 Context Control 定义升级同步更新登记哈希。App 自有模型使用 App 自身的组合入口，未冒充 Project 登记。旧的无登记裸定义将显示 unavailable，需显式登记/初始化后才能使用，不自动把未登记文件发布为模型。

剩余边界：initialize/upgrade/市场导入等维护路径的共享多文件恢复日志和原 Project 锁还保留，将作为下一实际场景继续讨论。本项不以“模型写入锁”替换普通 CRUD 的 Project 锁。

新增验证覆盖：持有旧 Project 锁仍可创建、改登记、删除模型；无登记拒绝加载、哈希不匹配拒绝且显式修改可修复；并发旧登记补齐只增加一次 revision、保留其他字段；同一 Host 使用已验证快照；模拟定义保存后登记失败，证实不可用且重试可恢复；旧已安装登记 Schema 兼容补齐而原定义不改写。更新历史回归夹具，使其显式发布旧版本模型，避免用直接文件篡改代替已发布旧版本。

本项验证完成：模型发布/登记/业务数据/Context Control/流程模型产物7文件合计136项回归，经修正旧夹具使定义和登记共同发布后通过（流程文件38/38复跑通过）；扩展覆盖升级、导入、恢复、Runtime与引用诊断，旧夹具中裸定义可用及旧登记永不写入的断言已按新契约修订。新增发布协议5/5最终通过；最终类型检查、reserved models检查及git diff --check通过。未重建正式Reviewer使用的dist，最终全量与新候选验收待所有锁场景收尾后执行。


### 2026-10-29 维护日志非阻塞登记，移除 settings.lock

Human 明确要求按日志登记方案移除该 Project 锁。删除 withProjectSettingsLock / withProjectModelWrite 及 settings.lock 的生产调用；初始化、升级、市场导入/候选清理、已知 Context Control 升级和示例迁移入口改为日志模块拥有的 withModelMaintenance。调用方不再自行持有 Project 锁。

共享恢复日志仍是 .runtime/model-operation.json；执行权通过永久 .runtime/model-operation.claim 文件的原生非阻塞锁原子领取（timeoutMs=0），不是简单读后写。这个底层日志资源锁明确保留，不宣称实现完全无锁：其唯一用途是拒绝重叠的维护/恢复，不排队，也不参与普通 CRUD、配置、Run 或其他 Project 操作。失败立即返回 MODEL_OPERATION_BUSY，附日志路径；原进程仍执行时拒绝恢复，进程退出由内核释放领取权。新维护在领取后先恢复遗留日志再进行预检；恢复被杀仍可再次领取并继续恢复。日志阶段和文件 before/after 冲突检测保留。

领取覆盖维护预检/候选目录操作和提交，而不只覆盖写日志的一瞬间；公开 commit/recover 入口自行领取，嵌套调用在同一活动调用范围内复用，退出后失效。目录别名统一到物理根。包含 config.json 的提交/恢复仍只在修改配置时使用配置文件锁；不会因错误回滚递归获取该配置锁。

并发拒绝只约束维护请求，不新增与已开始普通写入之间的在线事务保证。普通模型发布沿用定义哈希生效协议，DataStore 锁和 CAS 本次仍不实施。此项完成的是 settings.lock 清理，Home 下 projects/<name>.lock 等其他 Project 生命周期/系统 Memory 修复调用尚待下一场景审视。

验证：9 文件 95 测试首轮 94 通过，新增旧锁持有用例因测试未创建 .runtime 目录失败；补齐夹具后，model-operation 18/18 通过，连同 example-relocation、project-command 三文件 41/41 通过。与首轮其他八文件合计覆盖 118 个测试均通过。类型检查和 git diff --check 通过。原始日志位于 /tmp/memsphere-maintenance-tests-final.log、/tmp/memsphere-maintenance-rerun-final.log、/tmp/memsphere-maintenance-typecheck-final.log；未重建 dist，不能用旧轮全量测试代替当前验证。


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


### 2026-10-30 提交实现并合入最新 master

按 Human 指令先提交本次实现、测试、需求/方案和 Graph 回溯需求概述，再将 origin/master（499d3ba，Graph/Flow 统一评审及渐进式加载；同时包含 Graph 可视化）合入当前功能分支。实现提交为 541d229。未把临时运行回执、旧验收候选证据 JSON、node_modules 纳入提交。本地未跟踪的 agile graph Procedure 与 master 新增版本逐字节一致，备份后由 Git 接管，内容未变。

三处内容冲突均按能力并存解决：commands/view 保留 daemon/Runner 探测及 master View 读取入口；context-control-access 保留模型 stamp 一致性读取，不恢复已删除的 Project 锁；graph-runtime 保留 master 的定向 reviewSnapshot，沿用本分支纯查询无 Run 锁及个人记录 CAS 更新。补充锁占用用例覆盖定向 reviewSnapshot 不阻塞。

合并后类型检查、61 项源码定向回归通过。最终 Memory 变更级校验 valid=true、issues=[]：change-20261030-031536690z-1676929d，checkpoint dcc16e183c29ac0acf58a8ef97c54f2c6f3d0914e45e5661cea7be6364c239b6；View 为 http://0.0.0.0:30000/projects/memsphere/changes/change-20261030-031536690z-1676929d。日志 /tmp/memsphere-master-merge-typecheck.log、/tmp/memsphere-master-merge-source-tests.log、/tmp/memsphere-post-merge-memory-validation.json。构建与 CLI/daemon/View 验证使用临时工作树，不覆盖原工作树冻结 dist。此处记录 Git 集成，不代表新的正式候选已验收。
