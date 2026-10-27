---
id: 20261026-exploration-skill-alignment
type: improvement
created: 2026-10-26
completed_at: 2026-10-27
run_id: run-20261026-123018z-12ac8722
---

# 自由探索 Run 的 Skill 与 CLI Help 完整迭代

## 目标与范围

自由探索已交付后，Skill 仍强制 Procedure 及通用任务兜底，且部分 Help 未表达两种 Run。更新单文件 Skill、相关 Help 和必要 System Memory；Agent 有适用 Procedure 时执行，否则在目标与语义对齐后自由探索，已有任务继续原 Run。

产品负责人强调简洁但不丢能力。先逐段盘点旧版，再保留每类任务的入口、顺序、完成条件与关键边界；盘点及取舍见 [capability-inventory.md](capability-inventory.md)。升级、Memory 读写与发布、ChangeSet Comment、App/CLI、模型数据、Schema/Review、人机协作、配置/View 和迁移均保留直接指导。保持单文件，不设行数配额，不拆引用文件；领域定义和参数细节才按需读取明确的 Memory/Help。

Artifact 是围绕明确目的组织、可独立使用且值得后续引用/评审/修订/交付保留的结果。按实际用途和使用边界组织，合并同一用途的零碎讨论，不按消息、文件或保存次数机械上报；有用途的阶段结果可保留。目标与语义对齐环节不另设 Artifact 特别指令。

删除系统预置通用任务 Procedure，升级/repair 仅删除路径、canonical identity 和已知原版摘要均匹配的旧预置；自定义内容保留并报告冲突，历史 Run 冻结快照保留。同步 Memory 创建、Store 边界和 Comment finish 的文档/Help；不新增运行时或语法能力。

## 实现与兼容性

- Skill 更新于 src/skills/memsphere，安装与升级目标、覆盖选项保持兼容。
- CLI Help 区分 Procedure 与自由探索、Continue 的范围、Memory 创建/删除/改名和 Comment finish。
- v5 manifest 记录 11 个历史原版摘要，受控 Managed/Embedded 升级与 repair 保护自定义内容和竞态。
- 新增 Artifact 规则及一致的开发 Project 副本；Comment 处理流程说明与现有“全部 processing、整批单 reason”接口一致。混合处理结论无法分批 finish 时保留现场并请 Human 决定，不改运行时掩盖限制。
- 增加真实 Agent 场景及可重放 prepare/run/check，评分检查实际数据、命令和所用 Skill 的 SHA256。

## 向前兼容

结论：需要向前兼容。

调查时没有名称含 stable 的 Tag，因此无可列举的稳定 checkpoint。保持已交付命令、模型数据、Skill 安装位置/覆盖参数、Procedure Review 和历史冻结 Run 语义；明确移除的通用预置不再作为新任务兜底。没有批量修改其他真实 Project。

## 验收结果

- 需求契约第 2 轮获产品负责人通过；方案经过技术评审。第一次交付反馈后，按产品负责人授权完整重盘能力并修订。
- 补充能力技术 Review review-20261027-031049z-f1123b72 第 2 轮 round-20261027-034409z-d35cadcb：研发、测试、架构三席通过、阻塞零，Runner 通过，审查 Run run-20261027-030458z-4a422c82 完成。
- 产品交付 Review review-20261026-171424z-059c4535：旧稿第 1 轮正式要求修改；修订第 2 轮 round-20261027-042101z-1661440f 产品负责人明确“我投通过”，Runner 已接纳。
- 实现提交 eaca5a7 的结构校验、typecheck、build、23 项受影响回归、七项最终 Skill 同字节 Agent 回放和 Store 校验通过。其 full CI [40444768873](https://github.com/billtenor/memsphere/actions/runs/40444768873) 原样 npm test 164 文件零失败；全部平台、打包 Shell、汇总及 merge gate 通过。归档文档后最新 PR HEAD 的检查由关联 Run 继续核对。
- 最终 Memory ChangeSet change-20261027-032746682z-361a8d08：valid=true、零问题，基线 ec9ff27，校验后 Memory 内容未变；View http://0.0.0.0:30000/projects/memsphere/changes/change-20261027-032746682z-361a8d08。此前预置删除保留原 ChangeSet 验证证据。

## 残留问题与交付边界

测试与架构建议继续把升级恢复、Schema 收尾、正式 Review/Human 代投、迁移和 View 等规划型检查转成最终字节可重放场景，已记录 accepted-followup，不影响本轮静态/实现核对通过；没有声称所有路径均完成最终字节 Agent 重跑。App trial 沙盒内版本探测返回 unknown 时如实报告，没有宣称全项 available。

代码与必要文档交付到 [PR #116](https://github.com/billtenor/memsphere/pull/116)。产品验收已完成，需求目录已归档；原敏捷 Run 继续 Commit/PR/CI、等待 Human 合入及结果确认，不能把本记录的 completed_at 当成 PR 已合入或整个 Run 已结束。Agent 不自行合入或启用自动合入。

Git 仅纳入本 change.md 与能力盘点，其他需求讨论、方案及单次验收附件保留在本地同目录与 Run，不因归档自动纳入 Git。原始 Agent/浏览器/测试证据在 Run 和 /tmp/memsphere-capability-evals、/tmp/memsphere-skill-iteration 及各临时 trial，不随代码提交；可重放脚本与场景说明在 evals/exploration-skill。既有 .playwright/ 不属于本轮交付。

## 信息结构补充验收

产品负责人在前稿验收后指出结构像流水账，并指出前言将分页、JSON 回执、原文导出和 stdin 拼在一起。Skill 改为按任务组织，集中相关操作及完成边界；同时拆分混杂段落，通用列表/文件输入规则保持全局作用域，模型市场归模型章节，Procedure 业务数据写入和归档故障保留具名分支导航。仍是单文件，不删除原能力或改变已确认的操作规则。

补充 Run run-20261027-043530z-2c829e71 的技术 Review review-20261027-043601z-95031535 第 3 轮研发、测试、架构均通过且零未处置意见；产品 Review review-20261027-045638z-3dc610f0 第 1 轮 round-20261027-045638z-65b5fe53 获产品负责人明确“我投通过”，Runner 接纳，补充 Run 已完成。结构稿 SHA256 为 80dcb052d524e280a1d2b534fb3db65d6482a051f33d7f24c9f087b87a7fec52。

结构稿通过格式校验、构建、diff 检查与 Skill 安装/产品定位两份回归；配套移除一条只匹配旧标题的断言，所有 Memory 变更级校验和交付证据断言保留。七项同字节 Agent 回放对应此前实现稿，不声称在结构稿字节上重跑。Memory 内容未修改，既有 ChangeSet 校验仍匹配；新提交的远端 CI 继续由主 Run 跟进。


## PR 范围复核

产品负责人要求撤销 CI 改动并完整复核范围。已将 .github/workflows/ci.yml 与 test/ci-workflow.test.ts 恢复为本 PR 基线，当前净差异为零；不新增测试作业、不调整矩阵并行、不修改合入门禁。此前 CI 链接仅说明历史提交的验证，不代表这些配置仍纳入交付。

逐项检查全部 PR 文件与 diff 后，保留内容按已确认需求归属如下：

| 内容 | 范围依据 |
|---|---|
| Skill、Agent 入口元数据、CLI/Continue Help | 本轮直接交付；命令参数与执行处理器不扩展能力 |
| Artifact 定义、上报规则及对应 System Memory/开发副本 | 产品负责人明确要求定义 Artifact 和控制滥用 |
| 移除系统通用 Procedure、manifest、upgrade/repair 内容匹配保护、历史 fixture 与回归 | 产品负责人明确要求删除预置；升级仅删除已发行原版，保留用户定制及历史 Run |
| ChangeSet Comment 流程说明与 Help | 使 Skill 对现有全批单 reason 接口的指导准确，不修改 Comment 运行时语义 |
| 中英文 README、关联开发规则和旧 eval 路由描述 | 同步移除失效的强制通用流程与过时说明，不调整其他产品规范 |
| 临时隔离的 Skill 行为评测与相关测试 | 验证本轮 Skill 能力、路由、产物粒度和兼容删除，不加入 CI 或 npm test 的在线模型调用 |
| 能力盘点和本变更记录 | 本轮必要交付说明；原始验收证据留在本地和 Run |

除 CI 外，复核发现两处需修正：预置删除增加的 master/base 一致性与 Managed 健康前置检查曾影响所有系统升级，现限定在携带原版摘要的预置删除路径，保留普通更新原有行为，并添加主分支前进后普通更新仍可创建/校验的回归。Skill 评测脚本曾覆盖 HOME/CODEX_HOME，现撤掉这些环境覆盖，仍只通过 MEMSPHERE_HOME 隔离测试项目。

未发现其余新增 Run/Review/Schema/业务数据/View 功能或平台配置调整。清理后未改变已通过产品验收的 Skill 正文字节与最终 Memory 内容；本轮 CI 结果需对新 head 重新核对。范围复核不授权 Human 合入，也不代替合入结果确认。
