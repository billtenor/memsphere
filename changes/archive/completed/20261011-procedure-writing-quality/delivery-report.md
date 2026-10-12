# 流程记忆撰写规范交付报告

## 交付内容

新增“流程记忆撰写规范”统一 Statement，按字段职责、语义去重、约束作用域与业务完整性分章。明确 action 的动作职责、artifact 的机器产物契约、asserts 的独有强制语义、suggests 的非强制建议；去除跨字段语义重复，局部规则只放最小范围，保留真实全局边界。业务完整性检查防止不同业务状态被无依据合并，要求失败处理与退出前提完整。

撰写流程、Skill 和 Procedure Concept 引入完整规范，manifest、Reserved Store 安装验证和 Project 副本同步。语法规则与实体 Schema 保持结构职责，不引用撰写质量规范。没有修改 Runtime、DSL 或 UI。两个真实验收案例各只涉及一份复杂 Procedure，task 不叙述版本迭代；启动策略测试仅在 evals 手动执行，不进入常规 CI。

## 最终验证

第四轮恢复原独立业务 task，在修正生产规范后整轮重测：A/B 均 10/10。A 有 3 个 while、2 个 if、无 call；执行失败或对账未通过均进入改进、重新批准，同轮成功才交付。B 命中全部 10 个考点，无正确保留项误报，3 条额外有效意见独立核查。

第四轮 npm test 全量 141 文件零失败，1166 用例通过，1 个既有 Windows 专用用例在 Linux 跳过；相关 Reserved/Memory 3 个测试文件、typecheck、build、Store、Memory 变更级校验、差异格式检查通过。原 10 条强制规则有效投影保留，新增 1 条通用业务完整性规则。手动工具此前 3 项、测试分组 2 项通过，常规测试收集确认排除工具测试。

原始证据见 verification-revision-4.md、evidence/revision-4/。第三轮曾 A8 失败，随后任务强化的结果无法证明原输入质量，且未整轮重测；Runner 接纳研发与架构意见，恢复原 task、改生产规范、整轮新 A/B 后才获得上述当前成绩。全部旧失败和执行保留，不拼接成绩。

## Memory 与验收状态

ChangeSet：change-20261012-040452784z-0c41dc69；passed；摘要 dd5ea3391ee801e98176c97007030cdc3c92503ad99bd8b9aaae46f1716d771b。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

第四轮实现与验证成果已接纳：Human 架构、研发和架构 Agent 通过；测试提出 Schema 缺失，但持久证据中实际包含该文件，Runner 核对原始字节、来源摘要并用持久文件完成 Store/引用校验后以 rejected-invalid 处置，最终投 approve。没有待处置阻塞。产品负责人交付验收 Human 和产品 Agent 均通过，Runner 已接纳，正在按流程归档与创建 commit。

## 后续范围与限制

实际修订验证仅为后续建议，不增加第三个门槛。本轮未做跨模型/平台、历史批量治理或业务执行，不能保证任意 Agent 每次输出都正确；临时试验记录 Run 生命周期不作为产物行为通过证据。按 statements/memsphere-repository-delivery-rules 更新验收状态并归档需求，重新校验 Memory、创建本轮 commit；是否创建 PR 由 Human 决定。临时 node_modules 链接不作为提交内容。

测试意见的完整复核记录见 verification-revision-4.md 的最后一节；A-output-manifest.json 记录两份完整产物的来源与摘要，persisted-A-store-validation.log 是仅用仓库持久文件的独立校验。Memory 交付前再次校验的摘要保持不变，见 evidence/revision-4/delivery-change-validation.log。
