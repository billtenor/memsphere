# 当前迭代需求契约：Model 数据 Artifact 与自动 Upsert

## 整体目标
流程执行可直接产出模型数据实例；report 复用目标模型 Runtime 校验，产物被接受后自动写入业务 Store，写入成功才推进步骤。流程作者无需声明 create/update 或数据 ID。

## 当前迭代范围
1. Artifact 支持模型数据契约和目标业务 Store。模型从 Store 绑定推导；显式声明模型时必须与 Store 一致。具体 YAML 关键字在实施方案的独立“Syntax 关键字变更”章节列明，再提交确认。
2. 模型数据通过已有 Runtime 实例校验，不另写重复的 Artifact Schema；原有文档类 Artifact 的 Schema 能力继续保留。模型数据与 Schema 的组合边界须在实施方案中明确。
3. 第一版一步产出一条记录；数组作为一个模型值不等于多条记录。为每次步骤执行生成并持久化 step_execution_id；循环下一轮、重复调用和新的 Run 都产生独立身份。同一次执行的失败重试、审核修改重交复用身份，不用 report attempt_id。
4. 框架根据 run_id 与 step_execution_id 自动生成目标数据 ID，适配目标 Store 的 ID 约束，不接受用户声明业务数据 ID。
5. 提供 upsert 接口，缺失创建、存在整条替换，不做字段合并；接口与支持的 Store 边界在实施方案明确。实现应符合现有存储原子写入和记录锁约束，不把存在性查询当作原子保证。
6. report 先完成确定性校验；需要 Review 时待 Review 通过再写业务数据；没有 Review 时在接受产物时写入。写入失败不推进步骤。
7. 数据写入成功而 Run 状态保存失败时，重试以同一已接受候选、同一 ID 重新 upsert，然后保存推进状态；接受重复写入造成 revision 增长，不引入额外识别已完成写入协议或跨 Store 事务。
8. 已接受且成功推进的步骤不允许通过普通 report 回头修改记录。
9. 记录目标 Store、model 身份及版本或定义指纹、数据 ID、步骤执行身份、候选摘要和 Store 返回的可用 revision，支持追溯，不污染业务模型值。执行期间绑定或模型变化不得静默更换校验规则；具体冻结与变更检测方案在实施方案明确。
10. 取消或删除 Run 保留已接受的业务数据；归档或恢复 Run 不应重复写入业务数据。

## 后续范围
多条记录批量产出及稳定 item_key；跨 Run 业务键去重与更新；局部合并。不作为本次验收条件，不预建相关协议。

## 交付物
实现代码、适用层级自动化测试、示例和使用说明、对应 System Memory 源及开发 Project 副本、Skill 同步说明、实施与验证方案、开发计划、实现摘要、初始验证报告、验收材料及交付报告。Memory 修改提供最终内容匹配的 ChangeSet ID、passed 状态和 View 入口。

## 验收标准
- 合法模型数据提交后可从目标 Store 读出同样的数据；结构非法、模型不可用、Store 不存在或绑定不一致时明确失败，无业务写入和步骤推进。
- 待评审和要求修改的候选不写业务 Store；审核通过后写入并推进。
- 同次执行重试和修改重交只有一个数据 ID，整条替换不保留旧字段；循环与重复 Call 的不同执行、不同 Run 生成不同数据 ID。
- upsert 创建和更新符合存储并发约束；模拟写入失败与写入成功后 Run 保存失败，重试可得到正确值和流程状态，不新增记录。
- 步骤推进后 report 不回改已接受记录；取消、删除、归档和恢复 Run 保留业务数据且不重复提交。
- 模型或绑定变更明确拒绝或按确认方案继续，不静默切换；Run 可追溯写入来源和可用 revision。
- 原有 Schema/Markdown Artifact、分支、循环、Call、Schema 填写与 Review 行为通过相关回归验证。
- 实际运行受影响测试、npm run typecheck、npm test、npm run build、memsphere validate；Memory 差异另执行 memsphere memory change validate。失败需区分本轮、历史或环境问题，不能宣称完成。

## 向前兼容
结论：不需要向前兼容。
当前仓库 git tag --list '*stable*' 未返回稳定 Tag checkpoint。按需求规范不为非稳定历史建立迁移责任。保留当前文档类契约能力；历史 Run 状态具体读取边界在实施方案明确，不承诺重写既有产物或自动补写业务记录。

## 已采用规范与调查依据
- statements/memsphere-repository-requirement-rules：独立向前兼容结论与稳定 checkpoint 边界。
- statements/memsphere-repository-development-rules：避免过度设计；System Memory、实体 schema 与 Skill 同步；新增 syntax 关键字必须在方案中显式列明并确认。
- statements/memsphere-repository-testing-rules：真实验证、受影响测试及全量门禁、Memory ChangeSet 证据。
- 已完整读取 concepts/memsphere-procedure、concepts/memsphere-run、concepts/memsphere-framework；已发现概念中无独立 Model 或 Artifact Concept。
- src/run/store.ts 的 reportRun 已执行候选准备、契约校验和接受/Review 分流；当前无业务数据自动提交。
- src/project/data-service.ts 已用 runtime.reflect 校验完整值；当前写入仅区分 create/update。
- src/data/api/value-store.ts 与 filesystem-json-valuestore 当前有 create/update、整条替换及记录锁，没有 upsert。

## 评审参与者
产品负责人：产品 Agent traex1 与 Human actor5（提需方）共同参与；研发 traex2、测试 traex3、架构 traex4 分别承担对应视角。各 scope 使用现有 artifact_acceptance.unanimous Policy，并保留 Runner 最终投票步骤。

## 待确认项
本契约完整范围与验收标准由本轮产品负责人评审确认。具体 YAML 关键字、Store 能力边界、模型指纹检测时机和历史 Run 读取策略留给后续实施与验证方案，不在施工时自行扩展。
