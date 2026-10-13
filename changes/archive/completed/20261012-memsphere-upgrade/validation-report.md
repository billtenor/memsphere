# 初始验证报告

## 结论与采用规范

采用 statements/memsphere-repository-testing-rules。最终全量回归与固定门禁均通过，现阶段可提交实现成果评审；尚未取得成果/产品交付评审通过，未创建本轮PR，不宣称整轮交付完成。

最终 npm test -- --results=changes/active/20261012-memsphere-upgrade/evidence/full-test-results.json：145/145文件，1204测试，1203通过，0失败/取消，1原有Windows-only平台测试跳过，338.18秒。逐文件记录见 evidence/full-test-results.json。最终构建后11项真实CLI/Git测试再次通过，67.07秒，见 evidence/cli-tests.tap。

npm run typecheck、npm run build、node dist/cli.js validate、node dist/cli.js memory change validate change-20261012-134215362z-d42aa792、Skill validator、git diff --check 均实际通过；构建/类型输出见 evidence，命令与结果汇总见 evidence/verification-summary.json。node dist/cli.js 为本工作树最终构建的 memsphere CLI，避免误用仍指向主仓库的全局链接。

## 需求验收映射

| 验收 | 实际验证与结果 |
|---|---|
| 1 项目入口/选择/输出 | 真实CLI显式name>全局project>Primary、无Primary/未知项目、文本与JSON、非零失败及Commander错误路由通过。 |
| 2 Skill upgrade等价 | 函数对照init force与真实CLI default/global/directory，其他Skill保留、参数冲突/I/O失败通过。 |
| 3 三类路径/协助 | Skill主指引与Framework/双语README核对：CLI安装来源、Skill位置、项目类型、整体顺序、条件View/迁移、独立worktree/单独commit与用户审阅集成均明确。没有新增升级Procedure；不在CI调用真实Agent升级用户环境。 |
| 4 Managed一次升级 | 临时Managed双资源真实差异一次升级，专用校验发布completed、目标字节匹配、普通原文及登记身份保护通过。 |
| 5 Embedded一次升级 | 同HEAD独立linked worktree有专用不同ID、只含System范围、原用户diff和带scope/comment/claim记录不变；pending准备与active提交状态、master内容完成通过。 |
| 6 单类/noop/幂等 | Memory-only、model-only、metadata-only、全新/已最新；无多余Revision/空ChangeSet，UUID/createdAt及未变化envelope字节保护通过。 |
| 7 失败与重试 | 用户同名、损坏/不支持、工作树/分支/脏目标、冻结目标回退/额外文件/源变化；两条校验/重试拒绝。模型成功后Managed发布hook拒绝，整体失败且保留同ID，解除后同ID重试完成通过。 |
| 8 用户/历史保护 | 普通Memory/模型原文/业务记录/登记UUID与必要字段、原协作记录和冻结历史前后核对；Raw/绑定候选只读验证、旧Run模型fingerprint拒绝/未变化可继续37项回归通过。全部失败测试在临时Project/Home。 |
| 9 固定交付门禁 | typecheck、全量test、build、Store validate与最终ChangeSet validate均通过，Framework源/副本相同，CLI/Skill帮助一致。 |

补充验收：所有17个适用通用写入口在所属及其他worktree拒绝前零写入；只读/显式所属validate/Humanabandon/终态archive边界通过。main无master、detached、原worktree非master、master删除/改名、merge/squash、撤回目标、worktree移除后完成判据已验证。

## 失败分类与处置

本轮实际代码回归：Memory sync持锁后调用新公开加锁编辑入口，导致重入等待。修复为私有已持锁helper，6文件25项受影响测试及最终全量通过。只读审查另发现缺普通登记的已绑定模型未加入候选视图，最小修复并补升级成功/身份幂等/用户数据保护回归，模型升级9项通过。

环境/执行问题：沙盒spawnSync EPERM，改为沙盒外临时项目真实测试；预构建与单项测试并行造成dist暂缺，稳定后复验；结果保存参数误写为--results path导致未执行测试，纠正为--results=path。测试fixture先前未考虑bootstrap既有记录/Embedded根准备，已按实际非被测前置修正。均未删除、跳过或弱化产品断言；上述失败不作为最终成功证据。

## 最终Memory交付证据

ChangeSet：change-20261012-134215362z-d42aa792；Store embedded；状态active；最终checkpoint valid；base a4de8045e8aa566feeb2e61efe9a9c875717599f；digest 20c05b7e67d38842973a207b599be1abcdf9b042b293ac0158a61462995e9d87。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-134215362z-d42aa792 。Framework源与当前副本一致，最终内容复校通过。此记录是本需求自身的Memory交付证据，新增upgrade专用记录在隔离临时项目验证。

## 未执行项与限制

本轮未修改前端交互，不适用新增手工Playwright交互验收；既有View浏览器回归已运行。没有调用真实Agent去升级真实用户环境，没有对family/memorybase做破坏测试。Windows-only既有测试在Linux按既有条件跳过；未在当前主机执行Windows全套，后续适用CI必须通过。PR及CI尚未进行，待成果与产品交付评审后按流程执行。

## 成果评审修订复核

架构指出专用记录创建失败发生在Embedded文件apply之后，原回滚未覆盖。现将创建记录作为afterApply回调放在原try/rollback内；失败恢复更新目标、删除创建目标，清理尚未交付的新记录半成品目录。已有记录的后续校验失败仍保留原ID。新增CLI只读changes目录故障和跨平台APIcallback故障2项均通过；恢复权限fresh重试成功，原HEAD/Memory字节/记录列表受保护。普通repair/bootstrap29项和专用ChangeSet7项回归通过，修订后的最终全量145文件零失败。

日志证据已改为typecheck.txt/build.txt并确认不被gitignore忽略。Windows平台风险仍由后续全部适用CI验证，未声称本机已执行Windows套件。

当前审阅与施工目录为 /data00/home/liuyanjun.lyj/.codex/worktrees/81f1/vibe-mem，分支codex/memsphere-upgrade；/tmp副本仅保留历史备份，不能作为本轮新代码依据。最终Memory交付证据在当前目录复校，ID/digest不变。
