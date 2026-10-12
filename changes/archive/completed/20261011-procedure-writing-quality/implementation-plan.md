# 实施与验证方案：流程记忆撰写质量

## 已确认需求与本轮决策

基线为 Human 已通过的 requirement-contract.md 第二轮。验收门槛保持 A 真实复杂流程撰写、B 独立问题流程 review 两项。产品 Agent 关于实际修订的意见记为后续建议，本轮不将其新增为第三项必过条件；如后续扩大验收须另行确认。

本轮方案修订首先落实 Human 的要求：把改动整理为下面的逐文件、逐位置清单。研发/测试指出验收隔离缺口，本方案改用独立 CLI 子 Agent runner 与文件系统隔离封装，不以共享目录中的 prompt 限制当作隔离证据。

本轮采用 Memory、Skill 和流程入口的引导改进，并以真实子 Agent 行为验证成效。先修正字段职责、去重与作用域规范，再将同一规范接入写作及评审；不靠语法 validator 猜测自然语言重复，不增加 Runtime 状态或 UI。

## 实际实现调查

- src/memory/schema.ts：Action 支持 asserts/suggests；Procedure 根只支持 asserts。Schema 的 asserts/suggests 表达字段或结构内容要求。不能把用户对“全局 suggest”的泛称解释为新增 Procedure.suggests。
- src/memory/rules.ts：!ref 按同通道递归投影 Statement 规则，保留分组；defines 中的说明和正反例不会自动成为有效规则。
- src/prompts/run.ts：activeProcedureAssertTrees 提供全局流程规则，当前 Action 和 Schema 规则分开展示。规则放错作用域会传入不适用的执行上下文。
- reserved-memory/system-memory/procedures/memsphere-procedure-construction.yaml：实际写作与校验评审步骤是必经引导位置，已有字段职责 Statement 的引用与检查要求，但还未覆盖全局作用域问题。
- reserved-memory/system-memory/statements/memsphere-procedure-writing-rules.yaml：未提交候选已定义四字段职责及两组正反例；需要补充作用域规则，并整理正文，避免引导自身不断重复。
- src/skills/memsphere/SKILL.md：已增加完整读取该 Statement 的入口，可以保证例子不只停留在 !ref 未投影的 defines 中。
- reserved-memory/manifest.json 与 test/reserved-store.test.ts：负责系统安装清单、解析、自举和规范名称检查；新增 Statement 已有未提交登记及测试候选。
- evals/README.md、prepare-case.sh 与既有 suite：已有 task/evaluation 分离、独立 workspace、输入输出与运行证据的组织方式。采用其组织原则，不为本需求重构整个 eval 框架。

## 要修改的地方：文件与位置清单

以下路径均相对于仓库根目录。前面已形成的未提交改动一并按本清单整理；表中“检查”项如果已有候选满足要求，不制造额外无意义 diff。

| 编号 | 文件 / 位置 | 具体改动 | 可检查的结果 |
|---|---|---|---|
| M1 | `reserved-memory/system-memory/statements/memsphere-procedure-writing-rules.yaml`：根规则和正反例章节 | 完善四字段职责；禁止重复 Artifact/Schema 已声明的格式和结构；混合条目只保留新增语义；补充最小作用域、全局规则准入、多步骤共用不等于全局的规则和正反例。对象名称重复不等于约束重复。 | 一份完整规范覆盖本次全部写作问题，不设全局规则数量指标，不删必要业务约束。 |
| M2 | `reserved-memory/system-memory/procedures/memsphere-procedure-construction.yaml`：根 `asserts` | 移除仅在特定阶段适用的规则：开始前读取规范移到 Agent 收集依据步骤；Memory 精简要求只在写作步骤声明。保留贯穿整个 Run 的 ChangeSet 身份与相关目标边界。 | 本流程自身没有把读取或撰写阶段要求错误设为全局。 |
| M3 | 同一 Procedure：收集依据的 Action | 在开始调查/提取时发现并完整读取撰写规范、类型契约和语法规则。读取正反例，不只读取 !ref 投影。 | Agent 到达写作前已经获得完整规范。 |
| M4 | 同一 Procedure：更新相关 Memory 的 Action | 引用 M1；要求先判断每条信息属于哪个字段、哪个最小作用域，再落笔与去重。删除已被引用规则完整表达的重复文案。 | 撰写方法成为真实写作步骤的一部分。 |
| M5 | 同一 Procedure：校验并评审候选的 Action | 引用 M1；逐项查职责越界、语义重复、局部误放全局及必要规则是否保留。检查“删除后是否丢失要求”，不只检查 YAML 语法。 | review 明确检查本次问题，而不是仅确认结构可解析。 |
| M6 | `reserved-memory/system-memory/concepts/memsphere-procedure.yaml`：Action 字段说明 | 用简短语义说明指向 M1，说明局部和全局作用域；不另写一套详细规范或例子。 | 概念与统一规范一致。 |
| M7 | `reserved-memory/system-memory/schemas/memsphere-procedure-schema.yaml`：根规则；`reserved-memory/system-memory/statements/memsphere-yaml-syntax-rules.yaml`：Action 章节 | 检查并保留指向 M1 的规范引用，删除多处各写一套的职责与去重说明；保留合法字段与结构契约。 | 结构规则保持不变，语义规范只有一个完整来源。 |
| M8 | `src/skills/memsphere/SKILL.md`：Procedure 编写/评审入口 | 明确在撰写和 review 前完整读取 M1；仅提醒先归属、定作用域、去重的工作顺序，不重复完整规范。 | 后续 Agent 能从 skill 发现并读取规范及正反例。 |
| M9 | `.memsphere/memory/`：与 M1、M2、M6、M7 对应的五份文件 | 同步 Statement、Procedure、Concept、Procedure Schema、YAML 规则五份安装副本。 | 五组源文件/副本逐字节一致，引用可解析。 |
| M10 | `reserved-memory/manifest.json`：`system_memory.install`；`test/reserved-store.test.ts`：安装清单与规范名称断言 | 检查新增规范的安装登记与自举测试候选，确保只登记一次、名称与安装数正确；不添加只匹配自然语言文案的测试。 | 新建/修复 Project 可安装规范，安装回归通过。 |
| V1 | 新增 `evals/procedure-writing-quality/README.md`、`suite.md` 与 `cases/001-complex-writing/{task.md,evaluation.md,fixtures/}` | 固定 A 的复杂业务要求、业务保留项与评分标准；fixtures 只含业务材料和候选入口所需快照。 | A 有真实多步骤、分支、循环、Human 决策与子流程，不靠简单任务假通过。 |
| V2 | 新增 `evals/procedure-writing-quality/cases/002-seeded-review/{task.md,evaluation.md,fixtures/}` | 固定 B 的合法但有语义问题的 Procedure、十个考点与正确保留项；问题样本放 fixtures，完整答案只在 evaluation.md。 | B 首次 review 可逐项检查漏检/误报，考点在 Agent 启动前冻结。 |
| V3 | 新增 `evals/procedure-writing-quality/prepare-case.mjs`、`run-case.sh` | 为当前 Project CLI 准备独立临时 Memsphere Home/Project，拷贝候选包与 Skill，按现有 CLI runner 的干净启动参数发起 A/B 两个独立 Agent；增加 Bubblewrap 挂载白名单、隔离自检与日志收集。共享旧 runner/prepare 脚本不改，以免旧 init 接口迁移扩散到其他 suite。 | 两项试验可用固定命令启动，评分文件和另一 case 不在进程可见文件系统中，隔离证明与原始日志可保存。 |
| V4 | 本 change 的 `verification-report.md` 与 `evidence/`（实施阶段生成） | 保存固定输入摘要、A/B 真实原始输出、预埋考点、逐项评分、试验配置、隔离探针、所有尝试与回归结果。 | A/B 都通过才声明有效；失败不改答案、不丢弃原始记录。 |

M1–M10 是生产引导与安装改动；V1–V4 是用于实际验收的材料和工具。`src/memory/schema.ts`、`src/memory/rules.ts`、`src/prompts/run.ts` 仅为调查依据，本轮不改。也不改 YAML 语法、Run/Review 状态、业务执行逻辑或 UI。

正式开发 Task List 在本方案通过后的 Run 下一步骤生成；上表已确定其文件范围和修改内容，不提前实施。

## 真实 Agent 验收协议

### 输入与可见性：可执行的准备和启动

A、B 分别从 `cases/001-complex-writing` 和 `cases/002-seeded-review` 准备，不使用继承当前聊天的 Agent 或仅靠 collaboration 的共享目录约束。新的本 suite helper 复用 `evals/run-codex-agent.sh` 的干净 CLI 启动方式：`exec --cd <workspace> --sandbox workspace-write --ephemeral --ignore-user-config --ignore-rules --json --output-last-message <file>`，模型默认不强制切换。前置检查实际 CLI 支持这些参数，记录版本；失败显式报错，不静默改用弱隔离。

共享 `evals/prepare-case.sh` 仍调用当前 CLI 已无的 `memsphere init`，因此本 suite 自建最小准备脚本，使用当前 `project create --embedded ... --bind` 接口及独立 `MEMSPHERE_HOME`，不改全部历史 suite。Skill、System Memory 与 CLI 来自本轮候选构建，保存其内容摘要；必要的人类业务输入由 Runner 按冻结任务提供，不给字段归属或问题答案。实际生成的业务流程不执行生产操作，不发布到正式 Project。

固定命令（实施后在 suite README 中使用同一接口）：

```bash
node evals/procedure-writing-quality/prepare-case.mjs --case 001-complex-writing --output /tmp/procedure-writing-quality/A
bash evals/procedure-writing-quality/run-case.sh /tmp/procedure-writing-quality/A
node evals/procedure-writing-quality/prepare-case.mjs --case 002-seeded-review --output /tmp/procedure-writing-quality/B
bash evals/procedure-writing-quality/run-case.sh /tmp/procedure-writing-quality/B
```

准备后的每个 case 目录包含公开 `task.md`、`workspace/`、独立 Project/Memory/Skill 快照和 `runtime/` 候选程序包；结果目录在宿主接收原始 JSON 事件、stderr、最终回答、输出文件和 metadata。仓库 `evaluation.md` 与 Runner 的考点表不复制到公开目录，宿主保存启动前摘要供事后评分。

`run-case.sh` 在 Bubblewrap 新文件系统与 PID namespace 中发起子进程，只挂载当前 case 的 workspace/临时 Project（可写）、候选 runtime/必要系统程序（只读）、进程所需最小认证文件（只读）；不挂载宿主整个根目录、仓库、另一个 case、评分目录或父会话日志。认证内容不打印、不复制到证据目录。入口使用独立进程 cwd 和运行状态；当前业务试验不能访问宿主生产 Project。

隔离自检在同一挂载配置下实际执行：当前任务和候选规范必须可读；宿主评分文件探针、另一个 case 的探针、父仓库文件探针必须读取失败；宿主 PID/文件描述符不能经 `/proc` 暴露评分材料。保存退出码、挂载白名单、已脱敏的启动命令、cwd、运行版本和探针结果。负向探针失败则禁止启动正式验收，不能先跑后以“没有发现泄露”判有效。运行 JSON 事件/工具调用日志仍核查越界请求，并记录无效试验。

已进行本机能力检查：`bwrap --unshare-user --unshare-pid` 在挂载 `/usr`、`/bin`、`/lib`、`/lib64` 和隔离 `/proc`、`/dev` 后可成功执行 `/bin/true`。这只证明 namespace 可启动；真实 CLI、认证、候选包依赖和负向探针必须在实施阶段通过完整 smoke 检查，未通过不声称隔离完成。本方案不安装系统组件，不把 soft metadata 或 prompt 限制作为硬隔离证据。

先冻结任务、问题样本、全部考点与正确保留项，再发起 Agent；不在运行后改变考点以匹配输出。每次启动均保留 case/attempt ID、规范/任务摘要、配置、时间、退出码、原始事件和结果。A/B 使用不同进程、工作区和临时 Project，不共享被测输出。

### A：复杂流程真实撰写

固定业务主题为“紧急数据修复交付流程”，仅撰写流程，不操作生产系统。任务须包含：

- 单个指定工单贯穿全流程，证据与决策不得混用其他工单；这是实际全局业务边界。
- 故障证据整理、风险判断、修复方案、Human 批准、演练、验证与最终交付，不同步骤产出不同结构和格式。
- 数据不足时循环补充证据；风险不同选择不同分支；演练不通过时循环修订；通过后才允许进入交付。
- 独立可调用的验证子流程及相应规范名称引用，真实保留调用语义。
- 方案的某字段必须解释证据与决策关系；最终报告有自身格式、结构及专属验收内容。
- 少量非强制展示建议只适用于相关产物；若两个步骤共用某业务规则，仅在适用步骤应用。

任务应提供足够业务信息，让 Agent 完成撰写，不用缺信息作为评测目标。任务正文与逐项业务预期在启动前冻结；不得为了满足条目数量添加无意义节点。验证实际控制流、Human 角色、引用及全部业务要求，不能只看字段表面简洁。

首次输出由 Runner 独立逐项评分：职责、格式/结构语义去重、局部/全局作用域、强制/建议通道、必要业务语义、控制流/引用合法。全部通过才算 A 通过；解析只是辅助证据。评测期间不给 Agent 定向纠错或答案反馈后把修订输出当作首次成功。

### B：问题样本真实 review

Runner 制作具有多步骤、分支、循环、Human 决策及子流程引用的问题样本。保持语法合法，避免靠语法报错代替语义 review。预埋固定十个独立考点：

1. action 混入产物格式与字段清单。
2. action 混入验收标准或非强制书写建议。
3. asserts 重复 artifact.format 的强制格式要求。
4. suggests 复述已声明的格式或类型契约。
5. asserts 重复 Schema 必填字段或元素结构。
6. 混合条目包含重复结构与独有语义；应只删除重复部分。
7. 最终报告专属要求放到 Procedure 全局。
8. 只适用于部分分支的步骤要求放到全局，错误影响循环条件/子流程。
9. 字段专属内容约束放到流程全局。
10. 多个但非全部步骤共用规则被误认为全局。

每个考点记录准确节点位置、原文、错误含义、允许的修正方向。保留至少三类正确内容作为负对照：真实全局业务边界、机器契约未表达的必要语义、合法的局部非强制建议。确保考点可独立判断，避免一处笼统意见自动算作全部命中。

B Agent 先只进行 review，输出带位置、原因和修正方向的意见。Runner 保存并冻结首次完整 review；与十个考点及正确保留项逐项核对。十个考点全部识别，且未要求错误删除/削弱正确对照才算 review 通过。概括性意见、重复表述、语法检查结果不代替精确命中；额外有效问题仍应核查而非自动算误报。

产品 Agent 建议的实际修订检查列为后续建议，不改变本轮 A/B 门槛，也不将其结果代替 B 的首次独立 review。后续如要增加为必过项，先重新确认需求契约。

### 通过判定与失败处理

A 真实撰写、B 首次独立 review 两项都通过，才按已确认契约认可本迭代有效；本轮不新增第三项必过条件。结果不是模型永远可靠的证明，只针对本次任务与候选版本。

任一失败，保留原始任务、输出、完整问题清单、判定和候选版本，修正生产引导后用无历史上下文的新 Agent 重测。不得直接向同一被测 Agent透露漏检考点后重新计为盲评通过。案例和预期不因失败放宽；如样本确有歧义，先修正并记录原因，再重新冻结并整轮重测。所有尝试均进入报告。

## 自动化验证与一致性检查

- 先运行 test/reserved-store.test.ts，并根据实际范围运行 memory-schema、memory-syntax、memory-serializer、memory-rules 等受影响测试；已有测试保护合法结构、引用投影和安装链，不新增机械匹配自然语言的断言。
- 检查源文件/副本一致、System manifest 完整、规范引用可解析；执行 memsphere validate 和 memsphere memory change validate，记录同一 ChangeSet 的最终摘要与 View。
- 实际子 Agent 输出解析和引用检查使用独立临时 Memory root，不把问题样本发布到正常 Project Store；问题样本语义问题由 Runner 评分，不期待 validator 判断。
- 交付前运行 npm run typecheck、npm test（包含 build）及必要构建证据。记录真实命令与结果，不复用前面的旧版本成功记录。
- 当前无前端交互改动，因此不额外创建 UI 或浏览器手工验收任务；全量现有回归仍运行。

## 兼容性与风险

不新增 syntax 关键字、tag 或 Procedure.suggests；不更改解析、运行时规则投影、Run/Review 决策或冻结语义。既有有效 Memory 仍可读取执行；编写引导更严格不等于让历史内容解析失败。没有适用 stable Tag，因此不增加历史 checkpoint 兼容责任。

主要风险是规范堆积、规则未到达入口、简单任务假通过、漏检/误报和评分材料泄露。分别用单一规范来源、完整读取入口、固定复杂任务、逐项评分和正确保留项、真实文件系统隔离与负向探针控制。不得把本次有限评测宣称为所有模型/任务保证。

## 采用规范与待决项

采用 memsphere-repository-requirement-rules、memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules，以及现有 memsphere-yaml-syntax-rules 与实体 schema。要求避免过度设计、实际行为验收、System/skill 同步、有效 ChangeSet 证据和最终需求归档。

方案无需要先于评审确定的新关键字或业务决策。验收任务原文、问题样本与评分考点在实施步骤生成并冻结，必须满足本方案的覆盖与判定，不改变已确认范围。
