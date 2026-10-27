# mode=graph 实施与验证方案

版本：2026-10-27 共同探索整合稿，供整体方案评审；尚未施工。

敏捷 Run：`run-20261026-091339z-19538ce9`。技术探索 Run：`run-506ca3de-d02a-48af-92a9-2f348e6600fa`。本稿替代此前技术候选；已确认决定来自探索记录，剩余无明显歧义的细节由 Runner 按 Human 授权自主补齐。

## 1. 范围与执行边界

旧 flow 执行和持久化保持现状，新 graph 使用现有 context_control 模型 Store。自由探索仍在 report 时形成 Step；graph 在依赖满足时预先创建 Step。新 graph 不再写一份旧 Run JSON 作为第二权威数据，不在本轮迁移旧 flow。

Memsphere 负责依赖、状态、固定材料、精确工作提示和恢复。enter 后只引导当前 Step，贯穿生产、评审和修订，直到 done。跨 Step 生产并发由宿主 Agent 框架自行安排，Memsphere 不增加生产 Agent 派发器、抢占或租约；短期写锁仍用于并发调用下的正确性。

collect 由命令自动执行，不要求 Agent enter/report，也不创建独立产物或评审。连续可自动执行的 collect 处理完后，再输出人/Agent 的工作提示。

Human 已明确取消启动时结构化业务参数：不增加 --input-file、Run input、初始输入存储或 View 输入界面，不向 JSONata 注入 input。入口 Action 收集或读取材料形成 Artifact，后续通过依赖传递。保留 Step.inputs，它是实际材料引用。范围差分及确认依据见第12节；它不是以旧快照要求恢复已取消功能。

不包含动态批次、forEach/Send、wait/defer、子图、graph 内 !call、跨图跳转、可变全局 State、按业务批次配对、递归 collect 或材料自动合并。

## 2. 真实代码基线与复用

- `src/run/store.ts` 的旧执行器依赖 stack/frame/index、currentStep 和旧事件 Artifact，继续服务 flow。
- `src/context_control/{types,service,outputs,graph,view}.ts` 已服务自由探索；其 redo 会把 submitted 直接置为 done，不能用来恢复 graph 待评审候选。
- `reserved-models/context-control/{run,step,artifact,external,review}.json` 已设计独立 Step/Artifact、固定内容和 Review 结构；模型具备字段不代表执行器已实现。
- Run 已有 frames；Step 已有 source、inputs、reviewRounds、frames、artifact、createdAt/startedAt/endedAt；Review 已有 roundId、reviewer、comments、vote、attempts。
- `src/artifact-review.ts`、control-plane 提供现有权限与结算规则。ACP dispatcher/review-worker/review-session、旧 Review API 直接依赖旧 Run，需要存储适配。
- CLI 的 `run step show` 现为详情查看；`continue` 当前只承接自由探索 Project/Run，尚不能自动绑定 graph Step。
- `ValueStore` 提供单记录原子 create 和 revision 条件 update，不提供多 Store 事务。Project context-control 已有 per-Run 文件锁。

新增 graph 应用服务和调度模块，复用内容读取、模型 Runtime、Store、成果推导和界面基础组件；不把 graph 转译为旧顺序 flow，不全面重写自由探索。

## 3. syntax 与模型演进

新增 syntax `memsphere-20261027-stable`，同时支持 flow/graph；旧 syntax 和未标版本的 start 解释保持原样。新版本缺省 mode=flow，显式 graph 才使用 actions；不根据字段猜模式，不静默接受旧版本的新字段。

AST 为模式建立可判别分支；旧 FlowNode/Action/Artifact 契约保留，新 graph 建立自己的 Action、Dependency 和产物契约。解析、严格 schema、序列化、factory、引用检查、规则投影、catalog、Node 导航和 View 一起支持新结构。Action ID 唯一且非空，START 保留；引用必须存在，collect 只能引用普通生产 Action。允许有环，不把依赖数组的两条独立规则去重合并。

Run/Step/Review 模型沿既有可反射 JSON Schema 子集扩展。联合结构用已有 type 字段及对应可选结构表示，并在业务校验中要求匹配，不顺带扩大 Runtime 到 oneOf/if/then 等新能力。模型打开/升级检查必须同步；既有模型按已知基线显式升级并校验全部存量记录，定制定义冲突明确拒绝，不覆盖或静默迁移。

### Run 与 graphFrame

Run.frames 增加 type=graph，与 graphFrame 对应；现有 type=procedure/procedureFrame 保持。不存在第二层 mode，也不增加顶层 graphState。

| graphFrame 字段 | 职责 |
| --- | --- |
| memoryRef | 冻结根流程引用 |
| triggers | 已作出的依赖触发判断及目标 Step 关联 |
| pendingSteps | 已确定但尚待正式创建的完整 Step 初始值，成功后移除 |
| joins | 各 actionId + dependencyIndex 当前汇合到达材料 |
| processedStepIds | 完成信号已全部分发的 Step ID |
| nextCompletionSequence | 本 Run 下一个可分配的完成序号，供完成信号恢复排序；允许分配中断产生空号 |

触发记录保存 id、actionId、dependencyIndex；true 时关联固定 stepId。false 判断不创建 Step，保存实际条件材料及结果以满足追溯；true 的材料从所关联 Step.inputs 或 pendingSteps 取得，不永久再复制一套。trigger 不保存 sourceStepIds。运行记录字段不是新增 Memory YAML 关键字。

triggers 是只追加、不重排或删除的持久数组。true trigger 在该数组中的位置是其唯一目标 Step 的逻辑创建顺序；同一次分发内稳定遍历后一次保存，pendingSteps 按此顺序物化，且处理新触发前先补建全部旧暂存。collect 通过 stepId 对应的 true trigger 位置排序，不按 createdAt、随机ID、Store.list 或 completionSequence 排序，不再重复新增 creationSequence 字段。每个 graph Step 必须唯一对应一个 true trigger；重复目标、无对应记录、暂存/正式Step不变身份不符均报损坏。false trigger 可造成序位空隙，不影响排序；整个帧结束后仍保留该创建序依据。

普通汇合 arrivals 直接保存 Artifact 引用，保持已确认形状。collect 来源保存 kind=collect 与按原 Action 分组的成员引用；START 使用无产物的入口标记。业务校验按来源定义检查匹配，不创建虚构 Artifact。汇合所需来源读取冻结依赖定义，不复制一份来源清单。

graphFrame 和调度记录在 Run 结束后保留用于历史追溯；结束不把 graph frame 清空，归档保留原 Store 数据。当前不支持 graph 子流程，一次运行只有根 graph frame。

### Step

有 source.memoryRef/actionId 的 graph Step 仅使用 pending、running、awaiting_review、done 四个状态。错误不引入第五状态；命令返回可定位诊断，生产校验使用既有 validation。Memsphere 不启动生产 Agent，也不记录其进程 attempts；宿主生产失败后该 Step 保持 running，重启/重试重新 enter 同一实例，既有输入和进度保留。仅 Review.attempts 记录由 Memsphere 派发的 Reviewer 执行。Run 废弃使未完成工作不可再操作，不伪造 done，也不为此增加 cancelled Step 状态。

依赖满足先建立 pending Step；第一次手动或自动 enter 将它改为 running，startedAt 首次固定，重复进入不重置。提交无需评审时 done；需评审时 awaiting_review；要求修改返回 running；接纳为 done。collect 自动经历 pending/running/done，可在同一命令中完成。

Step.inputs 在触发时固定。普通来源按原 Action ID 保存单份引用数组，collect 展开来源保存零份或多份；所有引用均指向实际材料。循环新触发创建新 Step，同 Step 的评审修订不新建 Step。

Step 新增可选 completionSequence，graph done Step 必须具备，表示该实例的真实完成顺序，不是状态或时间戳。自由探索旧记录省略。不用随机 ID/Store.list 顺序或同毫秒 endedAt 推断“最近完成”。分配和提交协议见下一节。

## 4. 调度与恢复

所有本 Run 的业务状态更新通过现有 per-Run 锁和 ValueStore CAS 串行化；锁覆盖短期读取/验证/持久化，不跨人工工作或 ACP 会话。实际并行提交仍由多个调用者发起，不能丢失合法分支。

### START

启动预检完成后，在创建 Run/graph frame 的同一原子写入内保存 START 的一次分发结果及 pendingSteps。frame 存在即入口结果已记录；入口条件全 false 也保存空初始化帧。不另加 startProcessed，不把 START 伪造为 Step。

### 完成信号分发

先恢复本 Run 所有提交意图和 pendingSteps，再处理尚未列入 processedStepIds 的 done Step，按其 completionSequence 递增分发。同一来源下各依赖定义顺序只用于稳定遍历，不改变独立触发语义。

完成序号在 Run 锁内从 graphFrame.nextCompletionSequence 分配，先条件保存递增计数，再将分配值固定到该 Step 的提交意图，最后在同一次 Step 原子更新中落定 done、completionSequence、最终结果和 endedAt。若分配后尚未固定便中断，空号可跳过；已固定的提交意图恢复复用原序号。任何后续完成动作前先恢复全部旧提交意图，因此不会让后来的 done 插到已固定完成意图前。collect 同样在锁内为最终 done 原子提交分配序号；若尚未保存完成结果就中断，它仍未完成，恢复重新执行后再取得有效序号。缺失/重复序号的 graph done 记录报损坏，不随意猜测。

单来源依赖各自判断，各自创建执行；多来源依赖按来源保存最近完成材料。来源重复完成覆盖该来源标记，不形成次数队列。全部到齐才固定材料并评估 when，true/false 均消费本次汇合，true 另分配目标 Step ID。

同一次 Run 原子写入保存该完成信号的全部已成功决策、汇合更新、触发记录、pendingSteps 和 processedStepIds 更新。保存之前不创建正式后继 Step；保存之后用已固定 ID 和初始值 create，成功后移除暂存。

- frame 尚未保存：没有消费信号，可重新处理。
- frame 已保存、目标 Step 缺失：按原 ID/inputs/时间补建。
- Step 已存在、暂存未清：核对不变身份及材料后清暂存，不覆盖已有进度。

来源的任一读取/求值失败时不提交该信号的消费和后继决策，不执行一部分然后伪称分发完毕。返回错误位置与固定材料引用；必要诊断写在帧的错误信息中，不改 Step/Run 生命周期。前次已保存的汇合材料保留，新到达来源的 done Step/最终产物也仍可读取。恢复该信号前不越过错误继续分发后来信号，避免改变错误上下文。I/O 等外部问题修正后重试同一 Run；冻结表达式本身有误则保留失败诊断，修正 Procedure 后新建 Run，不能偷改历史快照。

### collect

在 Run 锁内按 Step 创建次序扫描指定 Action 的 done Step，选择其最终 adopted Artifact，按 ID 去重并保留空组。Step.artifact.mode=collect/items 保存固定成员，和 done 在同一次 Step 原子更新中提交。

已 done 的 collect 恢复时只读已存 items，不重新收集未来产物；尚未完成的 collect 在恢复推进中执行，结果以其最终提交时刻为界。先恢复本 Run 自动工作再接受新的生产写入，不把中断后未来工作插到恢复前。collect 不等待未来生产，作者用依赖保证其时机正确。

### 列表与恢复隔离

CLI/View Run 集合列表只读摘要，不执行恢复、调度、自动 enter 或 ACP 派发。单条记录损坏标为 unavailable，其他健康 Run 正常显示；配置级错误仍明确报错，不能伪装空列表。

单 Run 的工作推进命令执行恢复和调度。run status 是面向 Runner 的继续工作入口：必要时恢复，并按零/一/多工作输出；原生 run show、step show 和 View 详情为只读检查，不因为打开页面就 enter 或启动生产。View 的评审提交、成果确认等显式动作调用同一应用服务。损坏详情只影响该 Run。

## 5. 产物与条件求值

graph 产物要求从冻结 Action 读取 model/payload，不接受 report 改写契约。inline content 与 contentRef 沿现有模型二选一；contentRef 经固定 Store 读取并核对 SHA-256、实际 MIME，改变/缺失均报错。

复用现有元模型 Factory/Runtime 校验 JSON 文本 definition 和实际值，不以裸 JSON.parse 代替模型校验，不扩大 JSON Schema Runtime 支持范围。raw.json 保持 whole-bytes 语义，不把它当任意 JSON schema。

首版明确支持已有 JSON、YAML、plain、Markdown 对应 MIME：UTF-8 严格解码，JSON/YAML 必须得到 JSON 兼容值，plain/Markdown 保持字符串。其他格式只在已有明确解码器可转 JSON 值时准入，否则报不支持；不猜字段。raw 模型先验证原始 bytes，再按 MIME 解码供条件使用。

JSONata 使用官方包，解析时检查 when 语法，运行时 await evaluate 并严格要求 boolean，不使用 eval/自制运算语言。不注入宿主函数或 Run 全局最新产物，求值对象只含本次 artifacts；普通来源对应单值，collect 展开来源始终数组。Step.inputs 统一数组是引用存储格式，不能据此改变求值形状。重名来源报错，不合并或覆盖。

新增直接 Runtime 依赖 jsonata，施工时核验官方发行版本/Node 22 兼容性/许可证，固定到 package.json 和 package-lock.json，并按仓库现有格式更新 THIRD_PARTY_NOTICES.md。用实际 Node 22 的异步求值、构建后 CLI 与 npm pack 安装验证闭合发行依赖，不只在源码环境能导入；不顺带升级无关依赖。

提交通过格式/模型验证才产生 submitted Artifact；未通过留在 running，返回 validation。submitted 的内容/依赖固定，修订产生新 Artifact ID；tags 沿现有分类规则可变。普通产物 dependencies 固定为本次采用的具体材料引用，collect 展开到成员 ID，不指向虚构聚合产物。对实际 Artifact DAG 检查自依赖/成环。

## 6. report 与正式 Review 的恢复

不要将通用事务系统加到 ValueStore。使用 Step 已有 frames 扩展 type=submission 与 submissionFrame，作为本 Step 提交的短期创建意图：冻结候选 Artifact ID/内容、修订关系、下一轮固定配置和创建所需时间/身份；与 flow 的 schemaFrame 区分。

在 Run 锁内先校验输入与权限，再保存 Step 的 submissionFrame，然后创建固定 Artifact、固定 Round/个人 Review，最后在同一次 Step 更新中落定 artifact 引用、reviewRounds、awaiting_review/done 并清理意图。已存在的同 ID 记录必须匹配，不覆盖已提交内容；正在恢复时不接受另一份候选。部分写入的候选不作为 completeIds 或下游材料，ACP 在轮次/Review 全部保存成功后才派发。

这是 Step 提交的窄范围恢复结构，与已确认的 Run.pendingSteps 采用相同的“固定创建材料后重放”原则；不在 Run 再复制旧 artifactReviews，也不把所有持久化都改造为事务。

正式评审直接复用新模型：Step.reviewRounds 冻结本轮 Artifact、名单、权限、策略与意见处置；每名 Reviewer 每轮一份 Review，同 Actor 多 Slot 合并；Runner 的最终票使用 role=runner 的 Review。个人评论/票/attempts 不再在 Round 复制，进度和结论从固定配置与正式提交推导。

复用现有权限与 Decision Policy，Human 决策票、Agent 建议票、Runner 最终决定保持职责。Reviewer 进程结束/失败不等于正式投票；失败可 retry，保留同一 Review 并新增 attempt。轮次输入与历史提交不可改；修订必须提供 revision summary，新 Artifact 属于同一个 Step，再开启新轮次。

个人提交与 Runner 决策先保存在各自 Review；Step 的结算由固定本轮已提交记录重放计算，接纳后 Step 原子置 done，再由图分发扫描发现其完成信号。拒绝修改回 running 不产生信号。旧轮次/重复或冲突投票明确拒绝，Human 受托提交仍要求明确业务投票与授权审计，continue 上下文不代替授权。

提交已部分成功时回执提供真实 Artifact/Step ID 与恢复入口，不提示盲目重报。若等待评审/已完成，重复 report 不能创建新执行；已要求修订后的新报告必须满足修订摘要与当前 Step 检查。

## 7. CLI、continue 与 Prompt

原生命令：

```bash
memsphere run start <procedure> --name <name> --review-config review.json
memsphere run step enter --run R --step S
memsphere run step show --run R --step S
memsphere run report --run R --step S --artifact-file result.json
memsphere continue C report --artifact-file result.json
```

新增 enter：首次把已有 pending Step 改 running，固定 startedAt，返回完整 Prompt 和 contextId；重复进入读取同一实例，不能新建或重置。step show 保持详情查看，不进入执行。

continue 上下文固定绑定 Project/Run/Step，贯穿生产、评审和修订。不同 Step 的上下文不改绑、不相互覆盖；每次读取真实业务状态，继承身份后调用与原生命令相同的 handler。Step done 后原上下文禁止继续生产，返回 Run 后续工作；唯一后继自动 enter 并返回其新上下文，多个后继给列表。上下文缺失可由 enter 重建，不能因此改变 Step。

graph continue 新增 report、review wait/vote/retry/resolve/submit-for-human 等当前合法操作；正式 Review 的稳定身份从当前 Step/轮次解析，不自动补票型、Human 授权或对另一轮代投。help 列出当前可用命令与绑定信息；显式冲突身份拒绝。自由探索 continue 旧功能保持，语义分派不得误路由到自由探索 report/redo。

三个独立的 graph Prompt：

| Prompt | 使用条件与内容 |
| --- | --- |
| graph-current-step | 一个可执行 Step 自动 enter，或显式 enter。完整工作、流程/过程规则、固定材料读取命令、model/payload 产物要求和 continue 下一步 |
| graph-step-selection | 多个可执行 Step。Step ID、工作概述、执行者、产物名称与 enter 命令；不展示 Action ID，不展开多份契约 |
| graph-no-ready-step | 当前 Step 完成后无可执行工作。区分其他 Step 未完成、部分汇合已无法推进、全图可结束并展示成果确认 |

模板接入 src/prompts 的 model/registry/renderer 和 zh-CN/en，不在命令里拼接另一套文案。JSON 回执提供稳定身份及完整数据，不用截断文本作为契约。

enter 后只输出该 Step 的工作；awaiting_review 时只引导该 Step 的评审，不主动跳到其他分支。Human Action 的 Prompt 明确“请 Human 执行”，展示固定材料、工作与产物要求并等待 Human 结果；Runner 不代产，拿到结果后用绑定 Step 的 continue report 提交。Human Action 不等于 Human Review，不套用代投 API；身份越界、错误 Step、重复上报和恢复均需测试。

## 8. 成果、View 与生命周期

有未完成 Step/Review、未分发信号、pendingSteps/提交意图、待判断或部分汇合时不能正常结束。尚有生产者能提供来源的汇合属于等待，不能提前断言永久阻塞。图穷尽后显示成果并明确 finish，不新增 Run 生命周期枚举。

复用 outputs.ts 的完整 Artifact 推导与 outputOverrides 人工增删，只将 done Step 最终采用的 submitted Artifact 纳入 completeIds。被替换候选不成为最终成果。无产物且图已正常穷尽时允许确认空成果。原生命令 run outputs/finish 保留，Step 完成后的提示给精确入口；不把关闭 Step 上下文等同结束 Run。

View 使用现有 Run 模块、图布局、Review overlay 和语言/主题：graph 定义和 Step 列表展示当前工作，Artifact DAG 只显示真实产物，collect 在 Step 结果中显示成员引用。人可看材料、提交本人 Review、调整成果、确认结束；生产正文由 Runner/Human 经 CLI 提交，不增无关编辑器。轮询和打开详情只读，不代 Agent enter。

Run/Step/Review API 与 ACP 经统一 repository/application adapter 识别旧 flow、自由探索和新 graph；旧协议继续由旧实现处理。graph 使用新模型权威数据，UI/ACP 需要的 DTO 可投影，不持久化第二份旧结构。Review worker 只绑定自己的轮次/Assignment，不能越权读取/写其他 Step。归档仅终态，恢复归档保持终态和全部历史。

## 9. Memory 与版本同步

graph 启动冻结根 Procedure（含 --file 原文）及规则、引用闭包和有效来源树；--change 从已验证 checkpoint 读取。memory list/read --run 对 graph 路由到其内嵌快照，后续 Project 修改不影响已有 Run。App 启用限制与来源归属沿现有规则，不绕过预检。

必须逐项核对并更新 reserved-memory 源及开发 Project 副本：

- memsphere-yaml-syntax-rules、memsphere-procedure、memsphere-procedure-schema：新语法、Action/产物职责、模式边界和执行。
- memsphere-run、memsphere-actor、memsphere-artifact-review、memsphere-framework：Step、continue、评审模型、View 与运行行为。
- memsphere-memory-access-rules：graph 导航与 Run 快照读取。
- memsphere-schema-schema：检查 flow/Schema 既有契约；graph 不采用旧 Schema 写作接口，若无字段变化记录检查结论，不为凑同步改无关语义。
- memsphere-general-task-execution、memsphere-procedure-construction、memsphere-procedure-writing-rules：入口、工作提示和字段规则；对应官方发行流程检查后按实际影响同步。
- 教程章 1/2/3 及 Review 体验流程：检查旧 flow 路径仍可用，有行为说明变化时更新，不强制改写成 graph。
- src/skills/memsphere/SKILL.md、README/README.en、设计文档与 manifest：概念和命令保持一致；新增/移动/删除资产时更新 manifest。

修改 Memory 前完整读取对应规范，存在 Memory 差异须执行 memsphere validate 和最终 memory change validate，交付记录匹配最终内容的 ChangeSet ID、通过状态、View 入口。普通 validate 不代替变更级校验。

## 10. 开发分解与验证

| 工作包 | 主要修改范围 | 独立验证契约 |
| --- | --- | --- |
| A 语法 | memory AST/schema/syntax/YAML/serializer/references/rules/navigation | 新版 graph 与 flow、旧 syntax 拒绝新字段、严格字段/引用、规则来源、往返序列化 |
| B 模型及读取 | reserved-models、context_control types、显式升级/存储路由 | graph frame/四状态/完成序号/Review 字段可读写；已知基线升级保留旧数据；定制冲突拒绝 |
| C 调度 | graph scheduler、frame 恢复、collect | START 一次、独立依赖分别触发、汇合最近标记/false 消费、循环新实例、冻结输入、空集合/排序/固定结果 |
| D 生产与评审 | 内容/Runtime、submissionFrame、Review repository/ACP、package.json/lock、THIRD_PARTY_NOTICES.md | 合法/非法模型与 MIME、SHA 错误；候选不提前完成；Round 修订、个人提交/Runner 决策、权限/失败重试；Node22与打包后JSONata依赖可用 |
| E CLI/Prompt | CLI、continue、command-state、模板 | 零/一/多提示、enter 幂等、上下文隔离、原生 Step 身份、Human Action 结果闭环、Human Review 受托授权 |
| F View/成果 | Run/Memory 模块、Review API、outputs/finish/archive | 只读详情、Human 投票、历史材料、成果增删/结束、collect 展示、损坏单条隔离 |
| G 文档与发行 | 上述 Memory、Skill、设计和示例 | 可执行两份/空资料示例，无启动 input；Reserved bootstrap/升级与最终 ChangeSet 校验 |

先用最低适用层级覆盖明确契约，再运行真实 CLI/受控 ACP 子进程/浏览器边界。新增 graph 测试按产品职责拆分，不以实现步骤逐行镜像。

故障注入覆盖：START 保存前后、frame 消费及暂存保存前后、Step 创建与暂存清理、collect 结果提交、候选写入、Round/个人 Review 创建及结算。断言原 Step/Artifact/Review 身份可恢复、没有双重触发、不丢固定材料、不覆盖后续进度。

完成顺序专门覆盖：同来源 A1、A2 依次 done、分发前中断，重启按 completionSequence 恢复，汇合采用 A2；两者 endedAt 相同且随机 ID 排序逆序仍正确。另覆盖序号分配后/意图固定前的空号、意图固定后/Step done 前的恢复，以及重复/缺失序号的损坏拒绝。

创建顺序单独覆盖：同毫秒触发、随机ID逆序、一次分发创建多个pendingSteps、正式创建前后崩溃，恢复后按true trigger持久追加位置固定collect顺序；重复/缺失Step对应和不变材料冲突必须拒绝。

并发测试使用受控屏障和状态等待：不同 Step 同时 report；同一 Step 两次竞态；report 与恢复/status 竞态；多人 Review 提交与 Runner 结算竞态。两个合法分支都保留，冲突调用明确拒绝，不使用固定 sleep 或反复重跑掩盖竞态。

列表隔离覆盖至少两个健康 Run 加一个损坏 Run，损坏包含暂存恢复失败、引用目标冲突和内容损坏；CLI/View 列表仍显示健康条目，打开损坏详情才暴露完整错误，列表不派发 ACP。

Human Action 覆盖就绪/自动或手动 enter、向 Human 展示契约及材料、等待结果、指定 Step 提交到下游；错误 Step、重复上报、重启和框架显式并发选择分别验证。Human Review 测试不能代替 Human Action。

生产 Agent 的外部失败通过模拟宿主中断后重开服务/命令验证：原 Step 仍 running，重复 enter 取得相同实例/输入，不新增内部生产 attempts 或误写 Review.attempts。Reviewer ACP 失败另有受控子进程测试，不能混为同一失败协议。

必跑现有套件（按改动先运行受影响文件）：memory-schema、memory-syntax、memory-serializer、memory-navigation、memory-references、memory-rules；artifact-validation、artifact-format-fixtures、artifact-migration/schema-contract-migration；run-store、run-command、run-output、prompt-renderer；artifact-review、artifact-review-view/browser、受控 ACP；context-control CLI/lifecycle/graph/view/browser/memory-store/upgrade；archive-store/archive-run-data/archive-worker-guard；reserved-store、reserved-models、report-execution。

完成受影响测试后，必须实际通过 npm run typecheck、npm test、npm run build、memsphere validate，以及最终 Memory ChangeSet validate。前端交互使用 playwright-cli 实测，按状态等待。单次日志/截图留 Run 证据，不强行纳入 Git。尚未实现，当前不声称这些测试已通过。

提交前按 CONTRIBUTING.md 执行 npm run security:check，逐项核对暂存范围及新增文件的忽略检查；需要初始化本地安全 hook 时先核对既有身份再执行 security:setup，不覆盖用户身份。记录实际命令与结果，缺少 Gitleaks 等环境前置则明确处理，不以弱化门禁通过。

## 11. 原方案评审意见的处置

- Human Action 缺少闭环：本稿第 7 节定义交互与身份，第 10 节增加独立成功/边界测试。
- 列表被单 Run 恢复错误阻断：第 4、8 节隔离列表/详情/推进副作用，第 10 节明确多 Run 损坏测试。
- 真实并发未验证：第 10 节明确进程屏障、重复竞态与恢复竞态。
- 具体 Memory/套件映射遗漏：第 9、10 节逐项列明，不以目录总称代替。
- 旧需求评审关于启动 input 的补充：Human 已明确取消该能力，需求记录与设计示例同步调整，不再以旧意见扩大范围。

## 12. 需求契约范围差分与 Human 确认

本节是原已接纳需求契约的显式修订附录，与当前 change.md 一致；旧 Artifact 按不可变历史保留，不要求或假装已经重写。当前生效契约为原整体目标、交付及九项验收要求，加以下已获 Human 明示确认的差分：

- 取消启动结构化业务参数、Run 级 input 和 --input-file，不在 JSONata 注入 input；保留已确认的 Step.inputs。
- 验收标准3改为：JSONata 只读本次直接材料及 collect 展开材料，仍须 boolean；所有读取/解码/模型/表达式/重名冲突失败均明确报错。
- 验收标准6改为：两份/空资料均由入口 prepare Action 形成 Artifact，再依赖传递，必须通过真实 CLI 从启动走到成果确认，仍覆盖其他原边界。
- 其他范围、兼容承诺、质量门禁与交付步骤不降低。

Human 原文（2026-10-27）：“当然不需要启动时传入结构化业务参数的功能了。”Runner 随后已更新 change.md 的范围和验收标准3/6，并将该确认与差分保存为探索决策20（Artifact artifact-b072ff4a-13db-42fb-8409-c4101b8efc6f），当前需求全文保存为 artifact-8818aed0-08dc-412f-a7ff-580812a50015。Human 后续正式要求按共同探索整合稿替换旧方案，并对包含此范围差分的方案第二轮投 approve；授权记录保存在本敏捷 Run 的 assignment-20261027-043123z-baf99f39。

这些是 Human 对范围调整的明确指令和正式整体票，不是 Runner 自行缩小范围。当前 CLI 没有对已通过前序 Artifact 回退重写的入口，不能直接改状态文件、废弃原 Run 或另起 Run 来制造一份过去的“已接受”记录。修订附录作为本阶段正式 Artifact 的组成部分冻结，供后续开发/验收同时对照；原快照只作历史基线。

## 13. 实际读取并采用的规范

下列 Statement 已通过 memsphere memory read 读取并作为本方案的约束，第9节的“待同步 Memory”与本清单是不同职责。当前发现到的适用项均采用，无额外未找到项。第三轮Runner决定补读并采用App使用规则，并将下述创建顺序细化同时记录到正式开发计划，不改变Human已确认范围或接口。

| Statement | 采用约束及落实位置 |
| --- | --- |
| memsphere-repository-requirement-rules | 保留独立向前兼容结论；无 stable Tag checkpoint 的事实与产品兼容责任分别记录于 change.md，第3/10节验证旧语法和历史 |
| memsphere-repository-development-rules | 避免通用事务/生产编排的过度设计；System Memory 源/副本及Skill同步；本方案一级 Syntax 清单控制新增关键字，第2/6/9节与A/B/D/G包落实 |
| memsphere-repository-testing-rules | 分层/失败边界/真实并发/浏览器/全量回归/Memory变更级校验；第10节逐项套件及实际结果记录 |
| memsphere-repository-git-rules | 仅交付确认范围的实现/可复用测试/必要文档，禁止强行提交忽略文件与单次证据；第10节提交前范围/忽略检查 |
| memsphere-repository-delivery-rules | 完成验收后更新change并归档，记录最终ChangeSet/状态/View；需求和实施交付阶段落实，不提前宣称完成 |
| memsphere-yaml-syntax-rules | 旧syntax严格字段/版本语义不改，graph新增按本方案清单及同需求Memory更新；第3/5/9节与A/G包 |
| memsphere-memory-access-rules | canonical引用、分页完整性、生成node_ref、context/fragment、规则来源层级与Run冻结读取；第3/9节与A/B/G包 |
| memsphere-procedure-writing-rules | 字段职责、语义去重、最小作用域和完整业务路径；新description/model/payload及过程/产物规则分层，第3/7/9节与A/E/G包 |
| memsphere-app-usage-rules | graph启动不得使用停用App的根流程，候选checkpoint冻结Memory/App归属，恢复只用既有快照不混入当前启用状态；第9节与B/E/G包，覆盖停用根流程拒绝、ChangeSet归属冻结和旧Run恢复 |

另采用 CONTRIBUTING.md 的构建/测试与安全检查、changes/README.md 的需求状态和归档约定。未将模型设计里尚未实现的字段当作已交付能力，未以 Reviewer 意见代替 Human 范围授权。

# Syntax 关键字变更

以下是本轮允许新增或调整的完整 Memory YAML 清单。运行时 graphFrame/触发记录、Step 状态、continue 参数均不是 YAML 关键字；不得施工时另增未列字段。

| 名称 | 允许位置 | 值与业务含义 |
| --- | --- | --- |
| mode | 新 syntax 的 !procedure 根 | flow 或 graph，省略 flow；此为 Memory 编排方式，不在 Runtime frame 另加 mode |
| actions | graph Procedure | 非空 !action 数组，展示顺序不决定执行，与 flow 互斥 |
| !action | actions 成员 | 新版普通生产或 collect 定义，flow 同名标签保留旧规则 |
| id | graph !action | Procedure 内唯一非空 Action ID，START 保留 |
| description | graph !action | 非空工作说明，graph 不使用旧 action 字段 |
| dependencies | graph !action | 非空 !dependency 数组，每条独立触发 |
| !dependency | dependencies 成员 | 仅 from 和可选 when 的 mapping |
| from | !dependency | 单来源或非空不重复来源 ID 数组，入口使用 START |
| when | !dependency | JSONata 字符串，最终 boolean；只有本次 artifacts 材料，无启动 input |
| collect | 聚合 !action | 非空不重复普通 Action ID 数组，与 artifact 互斥 |
| actor | 普通 graph !action | agent/human，缺省 agent；collect 不允许 |
| asserts / suggests | graph Action、artifact | 自然语言或 Statement !ref 数组，过程/产物分层、去重与最小作用域 |
| artifact | 普通 graph !action | 普通 mapping，不要求 !artifact 标签；包含 name/model/payload 与可选规则/review |
| name | graph artifact | 非空产物名称 |
| model | graph artifact | definedBy/definition mapping |
| definedBy | artifact.model | 元模型 ID |
| definition | artifact.model | JSON 文本字符串，不能用 YAML 对象代替 |
| payload | graph artifact | 内容表达 mapping，不含正文 |
| contentType | artifact.payload | 非空 MIME 类型 |
| review | graph artifact | 非空不重复 Slot 名称数组；绑定与 Policy 由运行配置选择 |

根级 name/names、defines、goals、asserts、Statement !ref 沿用；不新增 triggers/inputs/edges/END/final/isFinal/业务 State 等 YAML 字段。JSON 模型定义的 type、properties 等由元模型解释，不属于新增 Memory 关键字。
