# 上下文控制：实施验收第2版修订

Run：run-20261022-130223z-496d73ae。原Review：review-20261024-120001z-b3cc3d7b，第1轮 round-20261024-120001z-f274d8e0。

Human 已对第1轮明确投通过并完成正式记录。Runner 接受 Agent 发现的可复现缺陷，要求修订；本修订保留原需求与授权，修复实现和验证，不把第1轮Human票改成修改票，也不预投下一轮。

## 修改与验证

| 意见 | 修正 |
| --- | --- |
| 研发 comment-20261024-120401z-3d4d54c1、测试 comment-20261024-120430z-08c5a05c：External 缺 --out | 注册 external show --out，复用两类读取共有的排他输出与先输出后记账路径；同步CLI文档 |
| 架构 comment-20261024-120347z-0a5a5a46：别名父目录并发污染 | 分层新记录发布时，使用现有 portable key 文件锁协调顶层目录名称空间；检查、创建与发布在同一短锁内，失败只逆序清理本次新建的空目录。保留叶记录CAS和其他顶层目录的独立性；不新增事务或补偿机制 |
| 研发 comment-20261024-120402z-2d78b51b：AC27验证不足 | 补充report/finish、report/abandon两种先后顺序，report/记账两种先后顺序，create/有目标report/直接report每个持久化边界前后中断的原ID redo；保留同目标双report竞争测试 |
| 架构 comment-20261024-120352z-d20fad5d：列表重复扫描风险 | 接受为非阻塞后续，明确O(R×E)与正文处理成本；后续先做一次扫描分组与按需正文，不在本轮引入索引/缓存协议。记录于需求目录follow-ups.md |

新增真实CLI读取矩阵同时覆盖Artifact与External：stdout、--out、有效目标记账、无效/跨Run/已完成目标仅警告、已有输出文件保留、输出失败不记账，以及持有真实Run锁导致记账超时后正文/文件仍成功。领域故障注入另覆盖CAS冲突、锁超时与I/O错误下两类内容保留。

父目录测试覆盖同进程与跨进程的 `Run/run` 和 Unicode `Σ/σ` 别名。跨进程用IPC在mkdir前暂停，观察竞争者实际等待锁后才释放，不用固定等待推断成功；断言仅一个别名目录落盘、失败后仍可list/read/write。另验证发布前故障清理自己新建的嵌套空目录，随后可用另一拼写正常创建。

## 当前证据

- 新领域/并发/持久化边界与父目录进程测试：34项通过。
- 真实CLI矩阵、JSON ValueStore和通用业务数据测试：52项通过。
- typecheck、build通过；修订版完整 `npm test -- --test-concurrency=4`：156文件全部通过，1317项中1315通过、2项Windows专属跳过、零失败、零取消，223.83秒。
- 修订版真实npm包独立安装：九条命令全部通过，包含External创建和原文文件导出。
- Memory未再次修改；变更级校验重新执行，valid=true，checkpoint仍为15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e。

最终Memory ChangeSet：change-20261024-113723145z-e05840bf，View：http://localhost:30000/projects/memsphere/changes/change-20261024-113723145z-e05840bf。

前端交互继续使用首轮已执行的Playwright CLI证据，本轮全量测试再次覆盖实际浏览器集成。最终包独立安装验证包含External导出，不用旧包结果替代本轮修订代码。

最终日志：/tmp/context-control-round2-full-tests.log；结构化结果：/tmp/context-control-round2-test-results.json；独立包结果：/tmp/context-control-round2-package-result.json。前轮已关闭为只读，修改与后续事项通过本修订表及新轮材料记录，不回写历史评论或投票。
