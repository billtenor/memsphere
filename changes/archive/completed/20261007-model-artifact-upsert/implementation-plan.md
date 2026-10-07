# 实施与验证方案：Model 数据 Artifact 与自动 Upsert

## 方案结论
第一版模型数据 Artifact 显式指定目标业务 store，可选指定 model 做一致性检查，模型从 store 绑定推导。只支持 kind=value、type=memsphere/filesystem-json 的 JSON ValueStore。原始 DataStore 不在本轮自动写入范围，启动时明确拒绝。一次执行写一条记录，数组值也作为一条记录。

Run 启动时冻结全部可达模型 Artifact 的目标配置和模型指纹，包括 Call、分支和循环。report 提交前及实际接受写入前检查冻结指纹；发现目标绑定、规范化目录、模型 ID、定义或元模型定义变化，明确失败、不写入、不推进。恢复原绑定及定义后可重试同一 Run，不自动采用新模型、不自动另起 Run。指纹不包含与校验无关的显示名称和标签。

以上两项回答产品 Agent 的两条建议，细节在施工前由 Human 确认。

# Syntax 关键字变更
仅新增以下两个 !artifact 字段，不引入新的 tag、syntax 版本、create/update 配置或可配置数据 ID：

| 关键字 | 允许区块 | 值结构 | 业务含义 |
| --- | --- | --- | --- |
| store | Procedure 中普通 !action 的 !artifact | 非空字符串，符合现有业务 Store ID 约束 | 目标当前 Run 所属 Primary Project 的业务 Store；指定即启用模型数据校验和接受后 upsert |
| model | 同一 !artifact，必须同时声明 store | 合法相对模型 ID 字符串，含 .json 后缀 | 可选的期望模型，必须等于目标 Store 的模型；省略从 Store 推导 |

示例：
```yaml
- !action
  action: 生成本次处理结果。
  artifact: !artifact
    name: 处理结果
    type: object
    format: json
    store: processing-results
    model: business/processing-result.json
    review: [产品负责人]
```

model 可省略；type 沿用现有显式声明规则，不隐式改动 type 默认值。schema 与 store/model 互斥，模型实例校验由 Runtime 负责。模型产物的表示明确覆盖标量：object/array 使用 json 或 yaml；string/number/boolean 可以使用 json/yaml，也可以使用现有 plain 表示。只有声明 store 的模型 Artifact 新增标量与 json/yaml 的合法组合，未指定 store 的原有 Artifact 类型/格式契约保持原行为。model 单独出现、空值、Schema 混用、markdown 模型产物、object/array 与 plain 混用、目标 kind=data 或没有原子 upsert 能力均明确失败。

json/yaml 通过已有解析器恢复完整值，再先检查 Artifact type、后调用 Runtime 校验，不把 JSON 字符串的引号当作业务值。plain 标量复用 decodePlain：string 保留原始文本，number 转有限数值，boolean 按既有显式 token 解析；非法 token 或非有限数值无法通过 type 校验。空字符串通过文件或受支持的空内容输入提交，仍按 Runtime 约束校验。对应示例为 type: string + format: json + store: scalar-results，提交内容为 JSON 字符串字面量，或 format: plain 提交原始字符串。数字/boolean 采用同样的完整值路径。

普通 Action 在声明 store 时允许 boolean 业务数据产物；它不成为分支或循环控制值。未声明 store 时继续保留“普通 Action 不产出 boolean、boolean 仅用于 condition”的既有约束。条件 Artifact 本身仍不允许 store/model。该组合扩展不新增 type 名称、format 名称或其他 YAML 关键字，并在实体 schema、syntax Statement、Procedure/Skill 说明和测试中同步明确。

store/model 仅允许普通 Action 的产物，不允许分支或循环条件 Artifact、Schema 内字段产物；分支、循环、Call 中的普通 Action 仍支持。新增字段的编写、解析、序列化、实体 schema、提示和 Memory 必须一致。施工不自主添加其他 YAML 关键字。

## 代码事实与实现路径
- src/memory/ast.ts 的 ArtifactNode 当前只有 name/type/format/schema/final/review。src/memory/schema.ts 的 artifactNodeSchema 基于 legacyArtifactNodeSchema 做字段扩展；在此增加 store/model 的显式解析与组合校验，按是否声明 store 分流标量 json/yaml 及普通 Action boolean 业务产物校验，同步 YAML serializer、syntax 门禁及 reserved 实体 schema；不得让 legacyArtifactNodeSchema 在识别 store 前先拒绝合法的新组合。
- src/run/store.ts 的 startRun 冻结可达 Procedure 模板，并在 RunState 保存 plan/stack/procedureSnapshots。增加可选目标快照，通过受信任的 Project 根上下文解析目标，不能以 Memory 源或 Mounted Project 作为写入目标，也不把 Registry 根混同当前 worktree 的 Memory 根。
- 增加一个小范围的模型 Artifact 服务模块，复用 src/project/business-stores.ts 的打开、目录隔离和模型加载，集中处理快照、指纹、实例校验和 upsert，避免在 Run 多入口复制逻辑。
- startRun 的 Project 上下文由 CLI 的 config.scopeRoot 提供；其他公共 API 入口显式传同等上下文。已有非模型 Run 无需新增参数。持久化的路径只用于识别来源，实际写入仍经当前受信任 Project 解析及一致性检查。
- reportRunUnlocked 的 prepareArtifactCandidate 与现有 type/format 校验之后，模型 Artifact 使用 runtime.reflect(candidate.representation.value)。错误保留可读字段路径和模型信息；不进入 Schema 逐字段填写。
- acceptPreparedArtifact 无 Review 分支及 acceptArtifactReviewSubmission 的已接受 Submission 分支共享写入逻辑。业务写入先于 events/frame 推进及 writeRun；Review 接受时重新校验冻结目标和候选。必须读取正式 Submission 的不可变内容，不读取 /tmp 或调用方可修改的源文件。
- Review approve 写入失败时，磁盘仍留在当前未通过状态，可以重试当前 Runner vote；不得持久化一个 passed Review 和未提交数据的组合。保留既有权限校验，不因新增写入绕过 Runner report 或 decision 权限。

## 步骤执行实例身份
为当前实际进入的模型数据 Action 生成 UUID stepExecutionId 并保存到运行栈的该执行实例。第一次上报前必须先保存该身份再发生业务副作用。读状态不生成不稳定身份。

运行模板和 cloneStep 不携带已经执行实例的 UUID；applyControlStep 插入下一轮循环体、instantiateProcedureTemplate 产生下一次 Call 时分配新的执行身份。Review 重交或失败重试保持当前实例身份。

自动业务 Data ID 为 `${run.id}--${stepExecutionId}`，不含斜杠，适配 JSON ValueStore 单文件 ID。普通 report 只作用于当前步骤，不开放历史实例修改接口。

## Upsert 接口与存储语义
- ValueStore 增加可检测的 upsert 能力；未实现的外部 Store 保留 create/update 能力，但不允许作为模型 Artifact 目标。
- filesystem JSON 实现 upsert：校验与编码完整值，在现有 withRecordLock 内读取旧记录并原子创建或替换；复用删除 revision 历史、overflow 检查、createdAt/createdBy 保留和原子发布，不用 has/create/update 的未保护拼接。
- project/data-service 提供 upsertData，复用 prepareInput 和 Project settings 写锁；仅接受完整 value，不支持原始 payload、patch 或 expected-revision 条件。
- data CLI 增加 data upsert <id> --store <id>，支持 --value/--value-file、--dry-run、--output，保持同一错误与回执规范。此 CLI ID 属于通用数据操作；Run Artifact 仍由框架自动生成 ID。
- 固定锁顺序：Run 写锁 → Project settings 锁 → 记录锁。目标配置与定义指纹检查及写入位于同一 Project 写锁范围；不得反向获取 Run 锁，不嵌套重复获取 settings 锁。已有模型写与 settings 修改使用同一锁约束。

## Artifact 快照与业务 Store 双份持久化
当前版本明确保留两份内容：Run 自身持久化完整、不可变的 Artifact 快照；产物被接受后，目标业务 Store 另行持久化同一模型值。业务 Store 写入不替代 Artifact 快照，Artifact 不简化为仅包含 store/dataId/revision 的引用。

两者职责不同：Artifact 快照保存每次提交时的原始内容，作为 Review、历史查看和执行追溯的依据；业务 Store 保存可由 upsert 更新的当前业务数据。历史 Artifact 与 Review 必须从提交快照读取，不得通过读取业务 Store 当前值还原历史，也不能假定现有 Store 可按 revision 读取历史。

持久化时序如下：
1. report 对候选执行格式、类型与模型校验；合法候选按现有 Run 内容存储规则保存完整 Artifact 快照。有 Review 时先保存不可变 Submission，审核期间及要求修改时不写业务 Store；重交产生独立 Submission，不覆盖此前快照。
2. 无 Review 的接受路径以及 Review 通过的接受路径，均以本次完整快照中的模型值执行目标 Store 的 upsert；重新检查冻结目标及模型指纹。源文件在提交后变化不影响写入内容。
3. upsert 成功后，将业务数据引用与可用 revision 关联到接受事件，再保存 Run 推进状态。模型值在快照与业务 Store 中应语义一致；不要求 JSON/YAML 原始编码字节与 Store 内部编码完全一致。

现有失败清理规则继续适用：未完成提交的临时快照可按现有逻辑清理，已经正式保存的 Review Submission 保留；数据写入成功而 Run 保存失败时，业务数据不回滚，按固定 ID redo。Run 不引用不存在或已清理的快照。取消、删除或归档 Run 对快照遵循既有 Run 生命周期，对业务数据则保留、不联动删除。

因此本轮接受完整值重复存储的空间开销，不增加去重或共享存储协议。只有未来 Store 提供可靠、不可变且可按历史 revision 读取的数据时，才另行设计快照复用；该优化不属于本轮范围。

## 失败重试与来源记录
失败后重做同一候选的整条 upsert，不新增跨 Store 事务、写入日志、exactly-once 或识别已完成写入机制。重复写入增加 revision 被允许。Review 重试读取同一 Submission；普通 report 写入后 Run 保存失败时，重报同一产物至同一 ID。

Run Event 的业务提交引用保存 Store ID、modelRef、绑定及模型指纹、stepExecutionId、dataId、候选 digest、提交时间和可用 revision；业务 value 不增加框架字段。无 Review 的原始候选文件归档遵循既有清理路径；写入后 Run 保存失败产生的业务数据不回滚，明确可重试。

业务数据不加入 Run Archive 的内容搬迁或删除清单；取消、删除、归档和恢复只操作 Run 自身数据。重试必须经过模型及目标指纹检查，不允许借恢复路径绕过变化检测。

## 兼容性
按已确认契约，不新增稳定 checkpoint 向前兼容责任。新持久化字段可选，原有非模型 Run 继续读取及运行，不重写历史 Run、不补写历史业务数据。store/model 为新增语义，不改变既有文档型 Schema 校验。现有 ValueStore create/update 的存在性与 revision 契约不改变。

## 开发任务与影响范围
1. ValueStore upsert 能力、filesystem 原子实现、数据服务与 CLI、模块及 CLI 测试。
2. Artifact AST/schema/syntax/serializer、契约传递、Project 来源与可达目标快照、实例身份及提示。
3. report 和 Review 接受时校验与提交、追溯信息、失败重试与生命周期回归。
4. System Memory 源及开发 Project 副本：memsphere-procedure、memsphere-procedure-schema、memsphere-schema-schema、memsphere-yaml-syntax-rules、memsphere-framework、memsphere-run，检查 memsphere-procedure-construction；同步 src/skills/memsphere/SKILL.md、双语使用说明及示例。不新增不必要的 Memory。
5. 最终受影响测试及全量验证，提交完整实现材料至研发、测试、架构 Agent 独立评审。

## 验证方案
- Memory 模块：合法 json/yaml、标量 plain/json/yaml 组合、仅有 store 时普通 Action boolean 合法且非模型原规则不变、model 推导/显式一致、未知/空 store、model-only、schema 混用、条件 Artifact 限制、serializer roundtrip；运行 memory-schema、memory-syntax、memory-serializer 和相关 migration 测试。
- ValueStore 模块：缺失创建、整条替换、无旧字段残留、createdAt 保留、revision 单调、删除后重建历史、并发同 ID、非法模型值不写；用受控临时目录及确定性并发同步，避免固定 sleep。
- 标量模型成功/失败验证：发行 examples/07-scalar-enum-root.json 的合法与非法枚举值；string 的引号、转义及空值；number 的合法值、非法文本与非有限值；boolean 的 true/false 和非法 token；验证 Artifact 展示、快照读回、Runtime 校验和业务 Store 读回值与类型一致。对 json/yaml/plain 各适用组合覆盖成功路径；原有非模型标量 json/yaml 拒绝规则保留回归。
- data CLI 集成：upsert 创建/更新、value-file、dry-run 不写、JSON 回执、非法值和 DataStore 拒绝；保留 create/update 回归。
- Run 模块及 CLI 集成：无 Review 模型产物接受、校验失败、目标丢失、原始 DataStore 拒绝、同次执行固定 ID、不同循环/Call/Run 独立 ID、模型数组单条保存。运行 run-store、run-command、artifact-validation、artifact-format-fixtures 及 migration 回归。
- Review 集成：待提交或要求修改无业务数据，Runner approve 才写；写入错误不推进，重试正确；不可变 Submission 作为写入来源；运行 artifact-review 及相关 Store 测试。
- 快照与业务数据集成：接受后同时存在完整 Artifact 快照及业务记录，二者模型值一致；随后通过通用 data upsert 修改业务记录，历史 Artifact/Review 仍展示原提交内容。Review 修订保留各 Submission 快照；源文件在 report 后变化不影响正式 Submission 和业务写入。仅有 revision 元数据不得作为历史内容读取能力。
- 明确注入“业务写入失败”和“业务写入成功后 writeRun 失败”，验证前者不推进、后者 redo 后同 ID 正确且继续流程，不用测试人为构造不存在的跨 Store 原子承诺。
- 在 Run 启动之后、首次 report 之前、Review 等待期间、失败重试之前分别变更模型、绑定及目录，验证明确拒绝且没有新写入；恢复原目标后可重试。登记显示名称/标签变化不误报。
- 取消/删除/归档/恢复 Run 后业务数据保留，不发生额外 upsert。历史无模型 Run 与文档 Schema Run 保持现有行为。
- 最终实际运行 npm run typecheck、npm test、npm run build、memsphere validate，Memory 修改执行 memsphere memory change validate 并记录 ChangeSet ID/状态/View；reserved-memory 变更运行 reserved-store 测试。
- 若涉及 View 交互改动，运行真实 Shell 的 playwright-cli 验证；仅显示现有可阅读的 Artifact/元数据则避免新增界面功能范围。

## 已采用 Statement
memsphere-repository-requirement-rules、memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules、memsphere-yaml-syntax-rules。后者作为既有字段、类型/格式及 stable 兼容扩展规则的直接基线；本方案仅在显式 store 存在时扩展模型产物组合，旧 Memory 的解释不变。满足避免过度设计、Syntax 关键字显式批准、System Memory/Skill 同步、当前内容 ChangeSet 校验和实际测试门禁。

## 施工前确认
Human 需确认本方案中 store/model 两个新增 YAML 关键字、首版 JSON ValueStore 支持边界，以及 Run 启动冻结指纹、发生变化明确拒绝的行为。未确认前不修改相应代码或 Memory。研发、架构和测试 Agent 将对本方案独立评审；方案被要求修改时先处理意见，再开发。
