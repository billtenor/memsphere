# 功能实现摘要

## 已实现行为与需求映射

采用 statements/memsphere-repository-development-rules、testing-rules、delivery-rules。以第四轮冻结完整需求补充/方案及 Human 通过记录为准，三个协作 Agent 分别实现模型升级、专用 ChangeSet 和真实 CLI 验收，Runner 集成 CLI、Skill、Memory 与文档。

新增 project upgrade [name] --output text|json [--change id]，明确选择一个目标，预检后升级系统模型/登记、系统记忆并做最终目标核对；返回各阶段、整体状态、失败位置，部分成功不会返回整体成功。旧 repair 与 initialize 行为保留。skill upgrade 复用 init force:true，支持默认/global/directory 并保护其他 Skill。

模型升级更新合法旧 System 定义与完整发行登记 value，保留 UUID/创建时间，仅真实变化递增 revision。复用 settings lock、原修改日志恢复和候选 Runtime/绑定记录验证；普通原文/业务记录/冻结历史不改写，冲突损坏/不支持情况失败。

专用 intent=system_upgrade 和冻结目标/源摘要/worktree 元数据支持 System-only 候选、显式重试/校验、普通捕获排除和通用写入口拒绝。Embedded 使用独立 linked worktree/master 基线，pending 准备状态与 commit/集成分开，目标内容达到 master 才完成；Managed 使用专用校验与内部发布。全部17项通用写入口在所属及另一worktree均有拒绝前零写入测试。同步流程原本已持有变更锁，改为调用私有已持锁编辑 helper，避免公开入口再取锁。保留 Human abandon、终态archive和只读路径。

Skill 包含三类升级、npm/源码安装来源识别、整体顺序、独立工作树/专用ChangeSet/单独commit、用户审阅冲突与集成指引，以及旧Run fingerprint边界。对应Framework源与当前副本同步，双语README提供入口；没有新增升级Procedure、syntax关键字或清单项。

## 修改位置

src/cli.ts；src/commands/project-upgrade.ts（新增）；project.ts；skill.ts；cli-errors.ts；src/project/model-registration.ts；src/memory/changeset.ts；src/skills/memsphere/SKILL.md；README.md/README.en.md；reserved-memory/system-memory/concepts/memsphere-framework.yaml 与 .memsphere/memory 同名副本；test/model-upgrade.test.ts、system-upgrade-changeset.test.ts、project-upgrade.test.ts（新增）及 skill-command.test.ts。

关键路径为升级CLI→目标/工作树预检→模型显式升级计划及日志提交→System Memory reconcile计划→专用候选/冻结目标校验/Managed发布→最终System目标检查。普通CLI错误由cli-errors结构化路由；专用record通用保护在changeset服务入口锁内实施，不能只靠View按钮。

## 当前验证与未完成项

已执行 npm run typecheck、npm run build，均通过。模型升级最终9项、旧registration8项、operation13项、system13项通过；专用ChangeSet最终7项，含同步修复的6文件25项回归通过。真实CLI/Git最终9项通过，覆盖发布部分失败及同ID重试。Skill validator通过。旧Run模型Artifact37项在稳定dist中通过。

先前沙盒真实CLI测试被spawnSync EPERM阻止，改为沙盒外临时项目测试；另一次CLI单项测试与预构建并发造成dist暂缺，稳定构建后旧Run37项已通过。未删除/跳过断言。

首轮全量145文件仅Memory同步重入锁回归未通过，已修复并定向验证；补齐普通模型新登记的候选视图边界并新增回归。最终 npm test全量回归145文件已全部通过（1201通过/1既有平台跳过），最终构建后真实CLI9项再次通过；最终结果、逐条验收与未执行项见validation-report.md。当前不声称完整交付已接受。

## Memory 变更级证据

当前Framework副本与源文件字节相同；node dist/cli.js validate 已通过。node dist/cli.js memory change validate 已通过：ChangeSet change-20261012-134215362z-d42aa792，Store embedded，base a4de8045e8aa566feeb2e61efe9a9c875717599f，digest 20c05b7e67d38842973a207b599be1abcdf9b042b293ac0158a61462995e9d87，状态active/checkpoint valid。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-134215362z-d42aa792 。该记录是本需求自身Framework修改的普通交付ChangeSet；新增命令的专用升级记录由临时测试另行验证，不能混为一份。

## 影响与限制

现有普通记录身份规则及原命令保留，新增专用记录格式字段非YAML语法。Embedded仅支持master，准备成功不代表已合入，模型仍共享Project根。两类资源无跨层原子事务，失败后报告部分状态并允许修正重试。最终Git提交/PR/CI待后续流程评审完成后执行。
