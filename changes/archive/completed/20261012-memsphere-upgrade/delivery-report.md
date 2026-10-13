# Memsphere 升级：产品交付验收报告

## 验收对象与结论

已实现并通过研发、架构、测试第二轮成果评审，Runner 已接纳。现在请需求负责人验收当前实现与说明；这是 Human 指定的停下确认节点。尚未归档、commit、创建PR或跑远端CI，不能把当前本地验收说成整轮最终交付完成。

采用 statements/memsphere-repository-delivery-rules、testing-rules、development-rules。范围依据为 Human 已确认的完整需求契约/第四轮方案，后续未扩大接口或YAML语法。

## 已交付能力

| 类别 | 成果 |
|---|---|
| 项目运行资源升级 | project upgrade [name] [--output text|json] [--change id]，一次升级系统记忆与系统模型/登记，真实定义及完整发行登记元数据更新，保护用户数据与UUID；部分失败如实返回并可重试。 |
| Skill升级 | skill upgrade 等价于同目标参数的 init --force，支持默认/global/directory，其他Skill不变。 |
| CLI本身升级路径 | Skill按npm安装或源码链接来源组织升级，明确CLI资源来源在先，再更新Skill及目标项目；条件View重启/迁移、市场重新导入边界清楚。 |
| 用户与Agent协作 | 完整说明集中在Skill，用户自然语言发起后Agent确定范围与目标、准备和验证。Embedded用独立分支/linkedworktree、专用System-only ChangeSet、单独Git commit，按授权引导用户审阅、冲突处理与master合入；命令不自动commit/push/merge。 |

Embedded准备成功为pending，commit/push/PR后ChangeSet仍active，master目标内容匹配才完成；无master或错误工作树在写入前拒绝。Managed通过专用候选完整校验后发布。专用记录及普通协作记录隔离，通用写入口不能绕过范围保护。没有新增升级Procedure；旧repair/initialize用途保留。

## 当前代码与验收入口

当前会话目录：/data00/home/liuyanjun.lyj/.codex/worktrees/81f1/vibe-mem，分支codex/memsphere-upgrade。旧/tmp目录仅保留历史备份，不作为新实现依据。git status/git diff可直接查看本轮改动。

全局memsphere目前仍链接主仓库旧CLI；本轮验收使用当前工作区最终构建：

```bash
node dist/cli.js project upgrade --help
node dist/cli.js skill upgrade --help
node --import tsx --test --test-concurrency=1 test/project-upgrade.test.ts
```

最后一条在隔离临时项目验证11项真实CLI/Git契约，不升级真实用户项目。完整三类升级及协作说明见src/skills/memsphere/SKILL.md；最终验收映射见validation-report.md。

## 验证与问题处置

修订后的全量145/145文件退出码均0：1204tests、1203pass、0fail/0cancelled、1既有Windows-only平台skip。最终发行CLI11/11通过，类型检查、构建、Store校验、Memory变更级校验、Skill validator、diff检查均通过。evidence/full-tests.tap与full-test-counts.json可复算聚合计数，full-test-results.json有逐文件结果，typecheck.txt/build.txt/cli-tests.tap均可跟踪交付。

架构提出的Embedded记录创建失败孤儿差异已修复：记录创建在原apply回滚区域内；失败恢复旧文件并删除创建目标，清理未交付新记录的半成品。真实权限故障与跨平台回调故障证明恢复干净基线、恢复条件后重新升级成功；修订CLI11项、repair/bootstrap29项与专用记录7项回归通过。

此前sync重入锁与缺普通登记候选问题均已修复并有回归证据；执行环境/命令问题与实际代码失败在验证报告区分记录，未以删除或弱化断言通过。

## 最终Memory证据

Framework源与当前副本一致；最终ChangeSet change-20261012-134215362z-d42aa792，active/checkpoint valid，base a4de8045e8aa566feeb2e61efe9a9c875717599f，digest 20c05b7e67d38842973a207b599be1abcdf9b042b293ac0158a61462995e9d87。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-134215362z-d42aa792 。该记录为本需求自身Framework差异的交付证据，新增命令的专用记录在临时项目验证。

## 后续范围与残留事项

本地实现无未处置阻塞。Windows未在本机全套实测，后续PR最新head全部适用Windows及其他CI必须通过。新增专用intent前拆分大型changeset模块的维护建议记录follow-ups.md，本轮不扩大重构。主仓库全局CLI尚未更新，不替用户执行真实安装升级或项目迁移。

验收通过后按当前敏捷流程更新状态/归档需求，commit、创建PR并持续跟进全部适用CI；最终CI通过的PR再交给Human审核合入。未通过验收则继续修正与受影响验证，不声称最终交付完成。
