# Runner Agent 身份与异步评审唤醒交付报告

## 交付内容与版本

本Run：`run-7c86229c-cf37-42de-8460-6bbec4c1d299`。产品验收固定实现commit `fa0dec4344e44579670a56ab869504f64f15232c`（分支 `codex/runner-agent-daemon`）。交付文档归档不修改已验收生产源码。

- Codex/Traex Runner探测、身份及异步配置；会话标识来自对应Agent环境，身份冲突/缺失明确拒绝。Continue改为无独立ID，仅在开启身份且识别当前会话时可用，CommandState主键为Agent类型与session ID直接拼接。
- Home统一daemon管理View期望状态和通用DaemonTask；启停/重启及恢复支持，任务不存result/delivery正文。wait按配置选择同步/异步，就绪直返；未就绪才登记、同轮同会话去重。通知仅三行来源标记、继续提示和显式wait命令，结果由命令响应读取。
- 同步/异步只等待Agent：全部Agent提交或任一失败即返回，Human操作不阻塞等待，无Agent立即返回且不建任务。Agent意见→Runner处置/决定→Human最终验收；Runner通过不绕过Human，要求修改可先进入修订。
- Agent idle_timeout_ms及max_runtime_ms支持null并默认不超时；进程退出/连接断开独立报错，不引入工具执行超时。当前正式Run空闲配置已调整为不超时。
- 每个Reviewer Attempt在主Agent调用目录的tmp下使用独立目录，设置Provider/ACP cwd及TMPDIR/TMP/TEMP，Artifact按需下载；不复制代码、不改造代码Artifact，不承诺操作系统沙箱。
- ValueStore内部实现写入/CAS并发保护，移除多余Project/Graph Run外层锁和不必要全Run redo；模型登记记录定义hash、不匹配拒用，旧登记缺hash时按已确认兼容行为补齐。保留实际资源互斥；旧Flow整体JSON写锁迁移由Human明确排除。
- 同步CLI/配置View、中英提示、Skill、模型及System Memory。另交付 `changes/active/20261029-graph-run-backtracking/change.md`需求概述，本轮不实现回溯。

## 验证结果

冻结fa0dec4上官方入口 `node scripts/ci/run-tests.mjs --test-concurrency=4` 一次完成182/182文件、0失败，417.00秒；研发和测试Reviewer分别独立完整复跑182/182全绿，测试Reviewer记录1586子测试通过、2个Windows平台skip。统一披露使用短TMPDIR=/tmp以避开既有POSIX socket长度限制，未声称该缺陷已修复。

fa0dec4仅修改提示回归测试，生产源码相对1481b20未变；沿用同源码成功build/typecheck，Reviewer本轮亦独立执行typecheck通过。专项验证覆盖身份拒绝/冲突、跨进程会话及CAS、等待去重/失败/恢复、Human独立等待、Runner及Human门禁、Attempt cwd/env、无限timeout下传输断开。

本轮存在Memory差异：最终变更级校验ChangeSet `change-20261030-031536690z-1676929d`，valid=true、issues=[]，checkpoint `dcc16e183c29ac0acf58a8ef97c54f2c6f3d0914e45e5661cea7be6364c239b6`，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261030-031536690z-1676929d。375b507之后Memory源码无变化；此次交付仅归档文档，既有校验仍匹配，不创建空ChangeSet。

Codex真实正式会话已收到三行通知并执行wait继续，发送/接收链路闭合。Traex有真实身份观察、queue能力及隔离夹具证据，未取得真实接收继续的完整闭环；Windows尚无真实执行结果。

## 正式验收结论

第8轮 `round-67cd9018-f8a7-4036-ab93-2f0740971354`：研发traex2、测试traex3、架构traex4均approve；阻塞0。六条非阻塞意见已逐条accepted-followup；Runner随后approve。Human billtenor本轮明确回复“通过”，授权代提交，Assignment `review-7e28ae60555a29f8061298169ca5eeb6`已正式入票，Review/Round状态均passed。

原第7轮两个阻塞（旧提示测试与缺同树全绿）已关闭；本轮未代替Human自行投票，未合入master。Agent审查不等于外部环境验证完成。

## 归档与Git边界

主需求已从 `changes/active/20261028-runner-agent-identity-async-review/` 移至 `changes/archive/completed/20261028-runner-agent-identity-async-review/`，change.md移除active status并写入completed_at与验收结论。长期交付为change.md、implementation-plan.md、development-plan.md、valuestore-lock-audit.md及本报告，其他原始验收附件不进入Git。

完整正式候选为Run Artifact `artifact-22bd2652-9004-403b-9b6c-a0f12ec00e81`，可按Run原生命令读取；本地acceptance-revision-8.md及历轮原始证据随目录归档但不提交。执行日志与JSON在/tmp：memsphere-review8-full.log、memsphere-review8-full-results.json、memsphere-review8-opinions.json、memsphere-review8-disposition-receipts.json、memsphere-review8-runner-approve.txt、memsphere-review8-human-submit-receipt.json；Memory回执为memsphere-post-merge-memory-validation.json。/tmp属本机临时证据，可能被清理，正式评审材料以Run存储为准，不把临时路径当可永久访问的仓库附件。

## 剩余范围与合入前门禁

- Traex真实会话后台等待→queue→收到并继续，及真实Windows daemon/View/命名管道package smoke，必须在合入master前取得证据；Linux全绿不替代。
- POSIX控制socket长Home/TMPDIR超限及模糊启动错误仍待缩短路径/改善诊断，异步默认开启前处理。
- queue结果未知与确定失败的结构化error.code尚未区分；现有message提示可能已送达，无自动重发，仅显式重试。
- Agent失败后回读的内联重试指引待补，当前依随包Skill处理；历史任务扫描/清理、强杀遗留目录、View重试工作目录与无限等待的运维可观测性等按既有accepted-followup保留。

产品实现验收与需求文档归档完成，Run仍开放，下一步按流程提交文档、PR及适用CI，待Human合入与结果确认；不自动合入或启用自动合入，不把completed_at解释为整个Run结束。
