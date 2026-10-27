# graph 开发计划

Run：run-20261026-091339z-19538ce9。依据：第三轮方案及其 Runner 正式接纳说明、Human 范围指令。当前已完成实现并进入完整回归；下面仅勾选已有实现或明确通过证据的事项，不以计划代替验证。

## 方案接纳时的实施细化

- graphFrame.triggers 是只追加、不重排的持久数组，true trigger 的位置唯一确定关联 Step 的逻辑创建序；pendingSteps 按该序物化，新触发前先补旧暂存。collect 按该位置排列，不按 createdAt、随机 ID 或 Store.list。Step 与 true trigger 必须一对一，重复/缺失映射或不变材料冲突明确失败；不另加 creationSequence。覆盖同毫秒、逆 ID、批量及创建前后中断。
- graphFrame.nextCompletionSequence 与 Step.completionSequence 表达完成顺序，和上述创建序不同；done 与序号原子提交，先恢复旧意图再处理新完成，空号允许、重复或缺失拒绝。
- 已完整读取 memsphere-app-usage-rules：graph启动拒绝停用App根流程；候选checkpoint冻结Memory及归属；已有Run恢复不重新混入当前App启用/归属。沿既有安装/Project边界，不加新App管理能力。
- Human已明确取消启动业务input。当前change.md和方案第12节需求差分为原已接受契约的已确认修订，旧Artifact保留历史；不复活input或修改历史文件。

## 任务与完成标准

### A. Memory 语法与读取

- [x] 增加 memsphere-20261027-stable，旧 syntax/flow 保留；新语法缺省 flow、显式 graph。
- [x] AST/schema/YAML 增加 Action、Dependency、model/payload、collect，严格互斥与引用校验，JSONata语法预检。
- [x] 序列化、规则引用、canonical/catalog、Node导航和context/fragment支持graph。
- [x] 受影响 memory-schema/syntax/serializer/navigation/references/rules 与 migration 检查。

### B. 新模型、快照与升级

- [x] graphFrame 承载 triggers/joins/pendingSteps/processedStepIds/完成计数；Step四状态、固定inputs、completionSequence、提交恢复帧。
- [x] 正式Review复用Step.reviewRounds和个人Review，补必要授权/受托审计字段；不复制旧Run.artifactReviews。
- [x] 新模型显式基线升级和全记录验证，拒绝定制冲突，保留既有自由探索数据；原flow不迁移。
- [x] 根Procedure、规则及引用闭包冻结；--file/--change、Mounted/App归属与停用门禁；memory --run 路由。
- [x] reserved-models/context-control-upgrade/memory-store 与App成功/失败边界测试。

### C. 调度、材料与恢复

- [x] START与frame原子初始化；完成分发按持久完成序，独立依赖/汇合/循环幂等。
- [x] 固定inputs，pendingSteps按创建序补建；严格区分false消费和错误保留。
- [x] collect自动执行/固定结果/空数组/排序/排除候选，无虚构Artifact或独立Review。
- [x] MIME/UTF-8/模型/sha256读取校验；JSONata仅当前artifacts、普通单值/聚合数组、键冲突拒绝。
- [x] package.json/lock、THIRD_PARTY_NOTICES：核验JSONata官方版本/许可证/Node22及打包后可用。
- [x] 同毫秒/逆ID、真实进程并发、各写入边界故障注入及损坏拒绝测试。

### D. 生产、Human 与正式评审

- [x] graph report明确绑定Step；submissionFrame固定候选及本轮创建材料，可恢复且不提前done。
- [x] Reviewer个人记录、Runner决策、修订新Artifact/新轮次、控制平面/skip/binding与权限校验。
- [x] Review repository适配CLI、ACP worker/session/材料读取与View，不变更旧flow协议。
- [x] Human Action完整提示/固定材料/等待本人结果/绑定Step上报；不与Human Review混同。
- [x] Reviewer失败attempt/retry，宿主生产中断保持Step running；过期/重复提交、受托票审计和并发结算测试。

### E. enter、continue、Prompt

- [x] enter幂等pending->running；show只读；单Step自动enter、多Step选择列表、零Step独立模板，zh-CN/en。
- [x] continue固定Project/Run/Step，贯穿该Step至done，不改绑；原生身份和便捷入口调用同一handler。
- [x] 只引导当前Step，不在Review等待时自动跨Step；跨Step并发由宿主发起。
- [x] 原生CLI、Prompt、上下文恢复与冲突，以及自由探索/旧flow回归。

### F. View、成果与归档

- [x] 列表只读、坏Run隔离；单Run推进恢复；View只读详情不自动enter/生产派发。
- [x] graph定义与Step状态、实际Artifact DAG、collect成员、正式Review overlay及历史对应。
- [x] outputs推导/人工增删，Step与Run结束区分，部分汇合/未完成工作不能finish，正常空成果可确认。
- [x] 终态归档/恢复与模型Store证据保留；多Run故障隔离、View/Archive测试与playwright-cli实测。

### G. Memory、文档、发行与交付

- [x] 更新源与开发Project副本：memsphere-yaml-syntax-rules、procedure、procedure-schema、run、actor、artifact-review、framework、memory-access-rules。
- [x] 检查schema-schema、general-task-execution、procedure-construction、procedure-writing-rules与教程1/2/3/Review体验，按实际影响同步或记录无需修改原因；有新增/移动/删除更新manifest。
- [x] Skill、README双语、设计文档、两份/空资料prepare示例、CLI帮助保持一致。
- [x] 受影响验证后执行typecheck、npm test、build、memsphere validate及最终memory change validate，记录最终ChangeSet ID/状态/View。
- [x] CONTRIBUTING安全前置与npm run security:check，新增暂存文件忽略核对，不提交单次证据或.playwright其他内容。
- [x] 实现摘要、首次验证、完整工作区实现验收；第三轮两项建议已修复并正式accepted-fixed，Runner接纳。
- [ ] 产品交付报告正式评审与Human产品验收，通过后更新需求结果并归档。
- [ ] 按Human最新指令先提交commit、合并最新master；产品通过后继续PR并跟进全部CI。
- [ ] 最终合入与结果确认由Human完成，再按Run收尾。

## 验证原则

实际跨CLI/ACP/HTTP/浏览器的契约在真实边界测试；使用可控屏障、状态等待和超时，不靠固定sleep。不得删/弱化既有测试或把文档检查当功能通过。未执行与环境失败单列。新Artifact/Step信号、创建序和完成序分别有独立失败含义的测试。

已读取并采用的开发/测试/需求/Git/交付/YAML/Memory访问/Procedure写作/App使用九份Statement及约束映射见实施方案第13节。所有新增Syntax关键字仅限方案一级清单。

## 实施核对说明

- 保留 flow 的执行器、文件存储与旧 Artifact 契约；新语法对 mode 分派后保留原 flow 校验路径。只对 graph 使用新的模型 Store、Step 四状态和正式 Review 记录。
- schema-schema 不增加 Schema 字段；general-task-execution、procedure-construction 和教程 1/2/3/Review 体验仍执行已有 flow 动线。已核对并保留其业务内容，只将随包发行的 syntax 版本统一更新；graph 的新入口和职责放在对应 Concept/Statement、Procedure Schema、Skill、双语 README 和 graph 文档，不改写旧教程流程。
- Source 与开发 Project 的 System/Market Memory 副本已同步；无 Memory 资产增删，manifest 仅更新发行 syntax。自定义仓库规则未被覆盖。
- 真实 ACP Session、原生 Continue 正式评审和 graph View 的 Markdown 行内意见均有跨边界测试。Graph 评审投影仅使用本轮 Review 计算 revision，保存原始内容 hash，并将 View 锚点映射到模型的 location。
- 临时日志、浏览器原始截图和单次验收回执留在被忽略的 .tmp/graph-validation 或本线程临时目录，不作为代码交付。已停止的早期全量回归保留失败记录；最终回归使用仓库外、空间充足的临时目录，避免改变 Embedded 测试的非 Git 目录前提。
- 最终完整回归、实现评审、产品验收、Git 安全检查及 PR/CI 仍以实际结果更新；没有将待完成流程提前记作完成。

最终 npm test：168 文件、1400 项，1398 通过、2 项 Windows 专属测试在 Linux 按原定义跳过、0 失败（664.82 秒）。报告 .tmp/graph-validation/final-results.json 与 final-tests.log 为单次证据，不提交。最终源代码运行时 22 项另已实际通过；不将平台跳过算作通过。


实现第一轮评审更正：原完成序/创建序覆盖勾选的证据粒度不足，第一轮不可变报告保留历史，本轮新补确定性测试而非重解释原测试。新增测试分别保护空号、固定意图、分发前后崩溃、缺失/重复序号和多pending逆ID创建序；31项运行时、5项模型不变量及旧状态升级、13项CLI/升级定向复验已通过。169文件修订全量仍在执行，最终结果另记。四个阻塞及文档歧义已修正，Human上一轮approve不自动沿用到下一轮。

修订版最终完整回归：169/169文件、0失败；1414项中1412通过、2项Windows专属按原定义跳过；700.90秒。typecheck、build、Project validate、同一最终Memory ChangeSet及安全扫描均通过。当前accepting，准备同一Review第二轮，不代表产品验收/commit/PR/CI完成。


第二轮补漏：round/nextStatus改为双向判别并在graph恢复入口拒绝；增加Store写读/已知候选升级和无下游恢复反例。中英Prompt列出每个固定材料的Project/Run/Artifact读取命令，CLI真实执行直接材料及collect双成员数组读取。flow构建Memory边界在源/副本同步澄清。第三轮定向与全量结果以本轮实际日志为准，旧轮次票与报告不改写。

第三轮候选最终验证：最终修订全量 npm test -- --test-concurrency=2 --results=.tmp/graph-validation/r3-full-results.json：169/169文件、0失败；1419项中1417通过、2项Windows专属测试在Linux按原定义跳过；耗时723.62秒，前置build通过。原始日志r3-full-tests.log、结果r3-full-results.json均位于被忽略的.tmp/graph-validation。 typecheck、模型升级records=0、Project validate及最终Memory变更级校验均通过。仍accepting，等待同一Review第三轮正式评审；未commit/PR。


第三轮当前轮内修补：以单一submission意图拒绝歧义恢复，保留schema多帧；Human正式受托票沿用Comment/severity门禁。10模型、35运行时、23 Review/CLI/升级定向测试通过，完整回归中；待通过后在本轮以accepted-fixed+验证摘要正式处置，再由Runner作最终票。未重写旧票或旧Submission。

第三轮轮内补修最终验证：补修后最终 npm test -- --test-concurrency=2 --results=.tmp/graph-validation/r3-fix-full-results.json：169/169文件、0失败；1429项中1427通过、2项Windows专属测试在Linux按原定义跳过；732.80秒，前置build通过。完整原始日志r3-fix-full-tests.log、逐文件结果r3-fix-full-results.json均在被忽略的.tmp/graph-validation。 typecheck通过；当前待记录两项accepted-fixed与Runner最终票，不将待决步骤提前记为接纳。

实现验收已正式passed：Review review-20261027-062540z-195bb469 / round-20261027-072752z-1abbd687，两条accepted-fixed及补修后169文件/1427通过/2平台跳过证据已记录；当前进入产品交付报告步骤。
