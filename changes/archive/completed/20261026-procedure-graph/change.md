---
id: 20261026-procedure-graph
type: feature
created: 2026-10-26
completed_at: 2026-10-27T20:25:16+08:00
run_id: run-20261026-091339z-19538ce9
---

# 流程记忆 mode=graph

## 产品验收与需求归档

产品第二轮 `review-20261027-081948z-d4b7f400` / `round-20261027-110039z-850d25d9` 已 passed：Human actor5 明确“我投通过”并授权代提交，产品 Agent Seed-2.1-Pro-0915 approve，Runner 阅读正式意见后 approve。唯一 suggestion `comment-20261027-111156z-d5f08876` 已 accepted-fixed：忽略既有 `.playwright/`，核验无已跟踪内容，未提交任何单次证据。Human 查看真实 graph-demo Memory/运行实例，并明确本轮聚焦语法和运行，不扩展前端设计范围。

按交付规范记录验收、移除 active status、写 completed_at，将四份长期需求/方案文档归档。下文实施记录按当时事实保留，其“待验收/未commit”等状态不覆盖本节最新结论。完整合并后验证为172文件、1455通过/2平台跳过/0失败；已确认功能commit `14a966a`、master合并commit `4d1c6b5`。本次收尾只变更忽略规则、归档记录及设计文档的归档链接，不修改运行代码或Memory。

本功能Memory最终门禁为 `change-20261027-084251029z-56ea5f07`，passed，digest `637b63699956306937ae9ab5016942af87d3fe73ce4e12cedf8a1b35779aafdf`，View：http://127.0.0.1:30000/projects/memsphere/changes/change-20261027-084251029z-56ea5f07。旧 `change-20261027-052552940z-dfe0c95e` 保留合并前基线历史；PR需关联两者，最终进入master后按Embedded集成条件处理收尾，不以本地commit提前关闭。

需求实现与产品验收已完成；PR/远端CI及Human最终合入与结果确认继续同一Run，未提前宣称整个流程结束。原始日志、截图和一次性报告保留于忽略的 `.tmp/graph-validation` 与运行存储，不随需求归档提交。

## 最新集成状态（2026-10-27）

按 Human 明确指令提前提交功能 commit `14a966a4502d136cb3c852921578fe128e076ef4`，并将最新 `origin/master`（`7eeb28c46e6e77c20ed92e82ee5bef4fdefa74e9`）合并到当前功能分支。保留主干 Run 列表仅读取 Run Store 的优化，并为 View 按记录隔离损坏 Run；Skill 同时保留主干自由探索入口与 graph Step/Continue 指引。manifest 使用主干版本 5 和新 syntax；新探索规则同步新 syntax，历史升级 fixture 保持上游原始字节。

合并候选完整回归：172 个测试文件、1457 项，1455 通过、2 项 Windows 专属测试按原定义跳过、零失败，791.06 秒，前置 build 通过。typecheck、Project validate、暂存安全扫描通过；冲突相关定向测试全部复验通过。实际 View 已验证列表选择、graph Step/collect 与原始 Artifact、1280/740 宽度及无 pageerror；临时环境与等待条件造成的早期失败保留原始记录，不计作通过。

合并前最终 Memory 变更级校验通过：`change-20261027-084251029z-56ea5f07`，基线为功能 commit，digest `637b63699956306937ae9ab5016942af87d3fe73ce4e12cedf8a1b35779aafdf`，View：http://127.0.0.1:30000/projects/memsphere/changes/change-20261027-084251029z-56ea5f07。原功能 ChangeSet 保留其旧基线证据，未强行复用。

实现评审已通过；产品评审仍待 Human，需求保持 accepting。此次本地 commit/master 同步不代表产品验收、归档、push、PR 或最终合入完成。日志、浏览器临时材料和既有 `.playwright/` 不纳入提交。

## 需求与整体目标

以主干 `f6a7df3cbe0e375b1987a780238f22e60399f254` 的 `docs/procedure-graph-syntax.md` 为需求基线，将设计实现为可编写、校验、启动、执行、评审、恢复、查看及完成交付的流程能力。该基线只有设计，尚无完整 graph 实现；本轮将其落实为可执行功能。

本次使用已安装的 `memsphere-agile-requirement-development`。保留 Agent 产品、研发、测试、架构评审，并额外将 Human `actor5`（billtenor）绑定到产品负责人和架构师。Human 负责需求契约、架构方案和产品交付评审，以及最终 PR 合入及结果确认。

## 当前迭代范围与交付物

- 发布明确的新 syntax 标识，同时支持 flow 和显式 graph；补全 AST、YAML、schema、序列化、引用检查和 Memory 读取导航。
- 实现新版 Action、Dependency、产物 model/payload、规则引用和 review slot；普通 Action 与 collect 互斥，错误输入明确拒绝。
- 实现 START、顺序、固定分支并发就绪、JSONata 条件、回边循环、多条依赖独立触发、多来源汇合及持久化调度。并行分支允许同时就绪且保留独立实例；宿主 Agent 的具体并发派发方式在架构方案中明确，不假定必须同时运行多个模型进程。
- 实现普通产物的解码及模型校验、评审接纳后才完成、具体 Artifact 依赖追溯、collect 固定集合和下游材料读取。
- 实现面向 Runner/Human 的 CLI 和 View 闭环：当前可执行工作、输入与依赖、状态及诊断、历史 Step/Artifact/Review、推导成果与人工增删、完成确认。复用现有组件，不扩展无关页面。
- 同步设计文档、README、System Memory 源及开发 Project 副本、Skill；提供可复用示例、测试与验证报告。存在 Memory 差异时交付最终 ChangeSet ID、校验状态和 View 入口。
- 完成评审后提交 commit/PR，跟进全部适用 CI；Human 合入并确认结果无问题后按流程收尾。

## 后续范围

2026-10-27 Human 明确调整：本轮不提供启动时传入结构化业务参数的能力，不新增 --input-file 或 Run 级 input，不向条件求值上下文注入启动 input。业务材料由入口 Action 收集或读取并形成 Artifact，后续沿依赖传递。设计文档的相关示例将在探索方案定稿时同步调整；此决定替代原候选中关于启动输入入口的要求。

不包含 forEach/Send、动态批次、wait: batch、defer、子图、graph 内 !call、跨图跳转、全局可变业务 State、跨批次业务轮次配对、collect 递归、别名或同名材料自动合并。旧 flow 的既有 !call 等能力保持。

## 向前兼容

结论：不需要向前兼容。

2026-10-26 核对本地标签及 `git ls-remote --tags origin '*stable*'`，均没有名称包含 stable 的 Tag，因此不存在仓库规范所定义的稳定 checkpoint；本结论仅针对该规范中的向前兼容责任，不取消下面的产品兼容和回归要求。

### 产品兼容与回归要求

保留设计文档明确要求的行为兼容：既有 syntax 继续可读可执行；未写 mode 的 Procedure 按 flow；不批量改写旧 Memory；旧 Run 按冻结快照恢复，来源 Memory 后续修改不改变执行方式。新增字段不得静默解释为旧 syntax 已支持。syntax 标识、持久化版本以及是否需要显式迁移由架构方案确认，禁止静默迁移历史 Run。这些要求已纳入验收标准 1、2、8。

## 验收标准

1. 新 syntax 可解析、校验、序列化和读取 graph；mode 缺省按 flow。混用字段、未知引用、重复/保留 Action ID、非法 collect、非法模型定义等返回可定位错误；旧 syntax 和 flow 回归通过。
2. START 每 Run 一次；独立依赖分别创建 Step，汇合按来源标记并使用求值前最新完成产物，消费后重置，不当作次数队列。循环产生新 Step，刷新、重复读取和重启不重复消费同一信号。
3. when 使用 JSONata，仅暴露本次直接材料及聚合展开材料，不提供启动 input；结果必须 boolean。读取、解码、模型、表达式及上下文键冲突错误均明确报告，不能静默转 false 或删除失败成员。
4. 候选或单个 Reviewer 投票不会触发下游；普通产物通过模型校验并按配置被接纳才完成。Human Action、Human/Agent Review 和修订保留独立历史，不覆盖已提交 Artifact。
5. collect 不创建虚构 Artifact，也不单独发起评审；仅收集当前 Run 已完成 Step 最终采用的产物，按 Step 创建顺序去重，空来源保留数组，结果一经完成固定。下游实际依赖指向成员 Artifact ID，调度来源可追溯。
6. 两份资料与空资料示例调整为入口 Action 收集或读取材料并产出 Artifact，再从依赖取得材料，均能从启动走到最终成果确认；另外覆盖固定分叉、条件不满足、循环、汇合、评审修订和中断恢复。Artifact 依赖保持 DAG。
7. 所有已启动任务、评审及触发判断完成后才允许正常结束；从未激活分支不阻塞，部分汇合未满足时给出可追踪诊断且不得误报成功；最终成果推导、增删和结束确认符合设计。
8. CLI/View 可查看并操作本轮 graph 的工作、材料、评审和成果，Memory/ChangeSet/Run 的 graph 内容正常展示，旧 flow 与自由探索入口保持可用。
9. 按仓库要求完成受影响测试、npm run typecheck、npm test、npm run build、memsphere validate，以及最终 Memory ChangeSet 校验；前端交互变更用 playwright-cli 实测；不以历史结果替代本轮证据。

## 技术与测试方案

Human 要求另起自由探索 Run 共同逐项制定技术方案：`run-506ca3de-d02a-48af-92a9-2f348e6600fa`，前文 `context-fa43a325-7868-4fc3-9480-5ef9c56c0bcc`。共同探索整合稿见 `implementation-plan.md`，已在第三轮架构评审由 Human 通过、Runner 正式接纳；探索 Run 已完成。当前实现与验证第三轮也已正式接纳，进入产品交付评审。历史修订与原票保留在同一敏捷 Run。

实际主要影响范围为 Memory AST/schema/syntax/YAML/读取导航、context_control graph 运行时与正式 Review、CLI/Continue/ACP、两个保留模型及显式升级、Run/Memory View、文档/Skill/Memory 与对应测试。开发任务和实际验证进度见 `task-list.md`；当前源码和最终校验结果以最新验收记录为准。

现有旧流程以 stack/frame/events 执行，自由探索另有持久化 Step/Artifact 与 outputOverrides；新方案必须明确复用边界，防止只转换为旧顺序 flow 而丢失依赖语义。正式方案必须有独立一级标题“Syntax 关键字变更”，列全允许新增或调整的关键字。

测试按最低适用层级覆盖 schema/serializer/navigation、触发与恢复、Artifact 与 Review、CLI、View、Archive、Reserved Store 和受影响迁移；使用受控 fixture 和状态等待，避免依赖执行速度。

## 开发任务

开发计划与核对项见 `task-list.md`。实现、定向验证、完整回归及正式实现验收已完成；产品交付评审、需求归档、commit/PR/CI 和 Human 合入确认仍按原 Run 推进。

## 采用规范

- `memsphere-repository-requirement-rules`：向前兼容结论与稳定 checkpoint。
- `memsphere-repository-development-rules`：避免过度设计、System Memory/Skill 同步、syntax 关键字显式审批。
- `memsphere-repository-testing-rules`：分层测试、相关套件、全量回归、前端实测和 Memory 校验。
- `memsphere-repository-git-rules`、`memsphere-repository-delivery-rules`：交付范围、提交检查、需求归档与最终校验证据。
- `memsphere-yaml-syntax-rules`：以当前稳定 DSL 为 flow 基线，严格检查节点、字段、缺省值、引用和版本语义。该规则描述的旧 !artifact 标签、type/format/schema 及尚无 graph 等限制保持适用于旧语法；新 graph 按已给定设计及经评审的关键字清单实施，并同步更新规则、Reserved Memory、Skill、迁移说明与示例，不能把自由探索 JSON 字段误作 YAML 关键字。
- `memsphere-memory-access-rules`：graph 读取与导航保持 canonical 引用、分页完整性、CLI 生成 node_ref、局部 context/fragment、!ref 原貌及有效规则来源层级；Run 冻结规则和 ChangeSet 快照不随当前 Memory 改变。新节点导航纳入验收标准 1，冻结与历史读取纳入标准 2、8。
- `memsphere-procedure-writing-rules`：编写与评审示例、System Memory 时逐项检查字段职责、语义去重、最小作用域、输入/分支/完成条件。原 action/artifact 机器契约规则继续用于 flow；graph 按设计将生产工作放在 description、机器契约放在 model/payload、过程与产物规则分别放在最小适用层，不照搬旧版禁止 artifact 自然语言规则的限制。规则与示例同步更新纳入交付范围和验收标准 9。
- `CONTRIBUTING.md`、`changes/README.md`：构建测试、安全检查和需求记录约定。

## 待确认项

产品交付评审及 Human 产品验收；其后完成需求归档与 commit/PR/CI。最终 PR 合入及结果确认仍由 Human 执行。Human现明确要求先提交commit并合并最新master；该Git保存/同步提前执行，产品验收和PR/CI/合入仍按同一Run推进，不把通过实现评审等同于整个迭代交付完成。

## 验收结果

实现 Review `review-20261027-062540z-195bb469` 第三轮 `round-20261027-072752z-1abbd687` 已于2026-10-27由Runner正式接纳。Human approve、测试Agent approve；研发和架构的两条建议型阻塞均在当前开放轮修补、以accepted-fixed附完整验证摘要，原票和Submission保留，未伪改为所有Agent都通过。

最终冻结源码全量169文件、1429项：1427通过、2项Windows专属按原定义跳过、0失败，732.80秒。typecheck/build、Project validate、Memory变更级门禁、安全与忽略检查通过。ChangeSet `change-20261027-052552940z-dfe0c95e`，digest `ec2617373900183152d12e25c0f44a0b947fcf97ca9a4f825c625fb1dd69b86e`，View http://127.0.0.1:30000/projects/memsphere/changes/change-20261027-052552940z-dfe0c95e。

当前为产品交付评审，仍accepting。按Human最新明确指令，先保存commit并合并最新master；产品验收后记录最终结果并归档需求，再继续PR/CI等Git交付；远端CI、Human合入与结果确认尚未完成。单次证据保存在忽略的 `.tmp/graph-validation`，不进入代码提交。

## 需求契约评审记录

第一轮：Human 明确回复“我投通过”，已正式提交 approve，Comments 为 []。产品 Agent 提出两项规范修订，Runner 接纳并要求修订：按无 stable Tag checkpoint 的事实纠正规范术语；补读并落实三份直接适用的 Statement。第二轮候选保留全部功能范围、交付物和九项验收标准，仅修正规范结论及补全采用项；正式投票和完整意见保存在关联 Run。

第二轮：Human 再次明确投通过票，已正式记录。产品 Agent 提出的初始输入入口细节被 Runner 接纳为方案阶段必须落实项（accepted-followup）；现有 CLI 闭环、固定 input、真实示例及恢复验收不允许用内部 fixture 代替。实施方案明确 --input-file、JSON 解析与冻结、恢复和 View 只读边界。Runner 已接纳需求契约，进入方案步骤；后续文件更新仅补充执行进度，不改写 Run 中已接纳的不可变需求契约快照。

上述第二轮段落为当时评审历史。2026-10-27 Human 明确取消启动结构化业务参数，已据此更新当前范围和验收标准 3、6，并将设计示例改为入口 prepare Action；旧 input/--input-file 要求不再适用。共同探索确认 Step/Prompt/continue/graphFrame/信号消费等决策并保存在探索 Run；正式评审存储沿 Step.reviewRounds 和个人 Review 复用现有模型。其余无明显歧义的技术细节由 Runner 按授权补齐，并在整合方案中处置原 Agent 评审意见。

方案评审修订：Human 对旧候选的 request_changes 已正式提交，含 1 条意见；旧轮随之只读，原意见不改写。Runner 在 revision summary 中逐项记录处置，已将共同探索整合稿提交方案评审第二轮。Human 当前 Assignment 为 assignment-20261027-043123z-baf99f39。

方案第三轮：第二轮 Human 投通过票，Comments 为 []；Agent 意见已由 Runner 逐项处置。采纳并补持久化 completionSequence/nextCompletionSequence 与恢复顺序测试、实际规范采用清单、生产Agent/Reviewer attempts职责边界、security:check和JSONata依赖发行闭环。对要求恢复已取消input或重写已接纳前序Artifact的推断记录驳回，并在方案第12节提供Human范围指令与当前契约差分作为正式附录。第三轮修订稿已上报，等待整体评审；尚未施工。现有代码基线 npm run typecheck 通过，npm ci 完成，不代表graph功能验证通过。


## 实施过程记录（2026-10-27）

共同探索整合方案已在第三轮架构评审由 Runner 正式接纳，Human 已投通过；开发计划已上报，当前同一敏捷 Run 位于 flow[4] 实现步骤。graph 语法、Store 运行时、CLI/Continue、正式 Review/ACP、View、模型升级与文档/Memory 已实现，尚未将当前实现宣称为最终验收通过。

已验证：22 项最终运行时与文档示例场景、16 项语法场景、8 项模型升级、5 项 CLI 全路径（含真实进程并发与正式评审）、4 项个人 Review/真实 ACP Session、2 项内容解码、1 项 View HTTP 场景、1 项 graph 浏览器交互、19 项旧 flow 评审浏览器场景和 2 项页面布局。实际 Project 的 View/Continue/collect 验收 Run run-d36f9604-c8d2-498f-81c7-d07f1b261a92 已 done，playwright-cli 实测宽/窄屏及产物详情。早期全量回归保留真实失败证据，已修复校验分派与评审锚点等代码问题并定向复验；页面布局改用独立页面保留全部原断言。最终全量回归将临时目录置于仓库外、空间充足的位置，保持 Embedded 非 Git 前提，正在执行。

Memory 变更级校验已通过：change-20261027-052552940z-dfe0c95e，digest 7cc49af8da6d513e3b197020617a671ef1e83f7939707a2c408e346953ca92cb，View http://127.0.0.1:30000/projects/memsphere/changes/change-20261027-052552940z-dfe0c95e。当前 Project 的显式 context_control 模型升级已完成，迁移重写业务记录数为 0。后续仍需完成回归、最终实现摘要、实现评审和产品验收；尚未 commit 或创建 PR。

功能实现摘要已上报，敏捷 Run 当前进入初始验证步骤。最终 typecheck、Project validate、相同 Memory ChangeSet 再验证、暂存范围核对、新增文件忽略检查及安全扫描均通过；最终全量结果与正式评审尚待完成。

最终完整回归已完成：168 测试文件、0 失败；1400 项中 1398 通过、2 项 Windows 专属测试在 Linux 按原有定义跳过，耗时 664.82 秒。此前失败记录未替代本次结果；实现与产品评审尚待进行。


## 实现评审第一轮与修订

Human 对 review-20261027-062540z-195bb469 / round-20261027-062540z-0e115901 的“我投通过”已按明确授权代提交 actor5 approve，Comments 为 []。三位 Agent 给出4项阻塞、1项风险和1项建议。Runner 阅读后正式要求修改，不将 Human 通过票扩展为忽略可复现问题或下一轮授权。

四项阻塞均采纳：共享 Step 恢复 failed/cancelled 旧状态（graph 自己仍仅四状态）；保留模型业务 Runtime 严格判别 Run/Step frame 和 artifact/arrival/trigger 的必需、互斥载荷，通用 Store 读写与升级共用；Continue 补齐 resolve 与 submit-for-human；完成序及创建序补确定性崩溃恢复与损坏反例。公开文档另明确 graph 只保存 context_control Artifact，不提供 flow 的业务 Store artifactStore/write-options 能力。

覆盖更正：第一轮报告“完成序恢复、同毫秒/逆 ID、批量物化已覆盖”的表述缺少逐场景测试证据，不能用第一轮168文件通过代替方案要求。现新增序号分配后/意图保存前空号、意图已固定/done前、同源完成积压分发保存前后、缺失/重复序号、同一次分发多pending同时间逆ID且创建前后中断测试。修订版运行时31/31、模型业务不变量及历史状态升级5/5、CLI与旧模型升级13/13已经实际通过；最终169文件回归正在执行。

当前 Project 对已知首轮 graph 候选完成显式模型升级（records=0），不删除或改写历史业务记录。当前开发修正已完成、处于回归与验收，状态已更新 accepting；commit/PR/CI/产品验收仍未完成。原始单次证据继续留在被忽略的 .tmp/graph-validation。

修订版最终完整回归：169/169文件、0失败；1414项中1412通过、2项Windows专属按原定义跳过；700.90秒。typecheck、build、Project validate、同一最终Memory ChangeSet及安全扫描均通过。当前accepting，准备同一Review第二轮，不代表产品验收/commit/PR/CI完成。


## 实现评审第二轮与第三轮修订

Human 对第二轮 round-20261027-065505z-e5c6d5b6 明确“我投通过”，已正式记录 actor5 approve，Comments=[]。架构 Agent approve并给出1条建议；研发/测试各给1条阻塞。Runner全部读完后采纳两项阻塞并要求修订：中英Step Prompt必须给每个固定输入的可执行读取命令；submissionFrame的round与nextStatus必须双向对应，防止矛盾意图跳过评审。

已修正：awaiting_review必须且仅能携带round，done禁止round；通用Store/旧候选显式升级/损坏读取和graph恢复均有反例，非法恢复不得创建Artifact/Review或下游。模型业务不变量7/7、运行时32/32已实际通过。材料Prompt为直接输入及collect每个成员固定Project/Run/Artifact读取命令，中英CLI用循环实际产生两次产物，并执行最终数组全部读取命令。

采纳架构建议的最小方案：源及开发Project副本的memsphere-procedure-construction明确限定flow构建，不新增graph写作流程。Memory同一ChangeSet重新校验通过，最新digest为ec2617373900183152d12e25c0f44a0b947fcf97ca9a4f825c625fb1dd69b86e；此前digest为各旧轮次当时内容，保留历史，不视为新内容门禁。源/副本同步，未新增Memory资产。

当前仍accepting，定向CLI/Prompt/升级及最终完整回归尚在收尾；未将上一轮票沿用为第三轮授权，未commit/PR。

第三轮候选最终验证：最终修订全量 npm test -- --test-concurrency=2 --results=.tmp/graph-validation/r3-full-results.json：169/169文件、0失败；1419项中1417通过、2项Windows专属测试在Linux按原定义跳过；耗时723.62秒，前置build通过。原始日志r3-full-tests.log、结果r3-full-results.json均位于被忽略的.tmp/graph-validation。 typecheck、模型升级records=0、Project validate及最终Memory变更级校验均通过。仍accepting，等待同一Review第三轮正式评审；未commit/PR。


## 第三轮 Runner 处置中的常规修补

Human已明确授权第三轮 round-20261027-072752z-1abbd687 的actor5 approve，Comments=[]。测试Agent approve，研发和架构各提交1条阻塞：comment-20261027-074039z-273c6115（Human受托意见门禁）及comment-20261027-073825z-8beb0795（多submission恢复意图）。所有正式意见收齐后，Runner选择在当前开放轮次完成已确认契约内的修补，再以accepted-fixed及完整验证证据处置；尚未作Runner最终票，不重写原Submission或要求Human重投同一范围。

修补已实现：submission帧必须独占Step.frames，禁止不同候选、重复候选或schema混存；保留旧schema多帧。模型业务Runtime与Graph恢复/只读快照都拒绝歧义，反例覆盖通用Store写/损坏读/已知模型升级、不预校验后端及实际advance不创建Artifact/Review/下游、不分配完成序或丢弃任一意图。Human request_changes/abstain必须至少一条Comment，summary不能替代；建议型Human每条Comment需要合法severity，按本轮冻结权限确定binding。正常Agent/Runner总结语义不改。

定向模型10/10、运行时35/35、Review/CLI/模型升级23/23实际通过；旧修订测试的Human请求修改fixture补齐真实Comment，原身份/轮次/Artifact断言保留。当前Project显式模型升级records=0，最终Memory digest仍为ec2617373900183152d12e25c0f44a0b947fcf97ca9a4f825c625fb1dd69b86e。补修后完整回归执行中，结果与正式处置待记录；仍accepting，未commit/PR。

第三轮轮内补修最终验证：补修后最终 npm test -- --test-concurrency=2 --results=.tmp/graph-validation/r3-fix-full-results.json：169/169文件、0失败；1429项中1427通过、2项Windows专属测试在Linux按原定义跳过；732.80秒，前置build通过。完整原始日志r3-fix-full-tests.log、逐文件结果r3-fix-full-results.json均在被忽略的.tmp/graph-validation。 typecheck通过；当前待记录两项accepted-fixed与Runner最终票，不将待决步骤提前记为接纳。

2026-10-27实现验收正式结束：第三轮两条accepted-fixed与完整补充验证已保存；Runner approve后Review/round均passed，当前敏捷Run进入交付报告步骤。产品验收尚未提交，后续Git/CI/Human步骤继续保留。

Human最新执行指令：“请你先提交 commit，合并最新的 master 分支代码”。此指令授权在产品评审尚未投票时提前保存本轮commit并同步master，不构成产品通过票、需求完成或PR合入授权；需求保持accepting，单次证据与.playwright继续排除。


## CI 改动撤销

Human明确约束：“你不被允许修改任何ci配置”。已撤销产品验收后追加的CI workflow、调度分组/耗时、编译缓存、时限及其配套测试/fixture拆分和CI政策文档，恢复到d7bfe54的原始状态；graph功能及已验收归档保留。后续不修改CI配置，不以放宽时限或改变检查配置处理失败。先前取消/超时属于未通过结果，不能宣称最终CI成功；原始结果保留于GitHub与本地忽略的.tmp/graph-validation。
