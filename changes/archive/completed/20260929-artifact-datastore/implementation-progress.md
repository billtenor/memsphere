# 实施进度（已验收）

Run：run-20260929-121744z-d56a5df3。实施方案第六轮由 Runner 批准；实现与验证 Review 第一轮研发、测试、架构均投通过。2026-10-01 Human 完成试用并正式投通过，产品 Agent 与 Runner 同样批准；当前完成需求归档和 commit 收尾，不自动创建 PR。

## 已开始的代码接入

- Project run-data 宿主装配四模型八 Store，复用 DataManager，日志内部映射 .acp.jsonl；受控 Manager 可由宿主装配输入提供。
- Artifact 正式文件、Submission/context、中间文件的核心读写删除走 Store，去除 drafts 子目录；CLI/View/Reviewer 内容读取与 Schema 合成已替换主要旁路。
- 增加 Artifact export 和外部本地副本最终 report 入口，修改中英文提示，不再要求编辑内部托管路径。
- Memory 快照创建通过 Store 并发布 files，RunMemoryProvider 按清单读取；独立补齐脚本已实现、纳入包清单并测试。.gitkeep 问题已按 Human 确认排除占位文件，无 Store 配置或 API 扩展，来源 Project 文件不动。
- 活动 JSONL 使用 create/append，快照使用 Store；失败后只从实际日志重建。零字节、完整行前缀、半行及损坏完整行故障注入测试通过，不重放、不修复日志，错误回调一次。
- archive/restore 按 Run 清单经 Store 搬运，元信息原生 JSON 管理，Run status 最后切换。不透明 Store、复制失败、切换后清理失败、旧式 layout、恢复残留及活动五状态/四存在组合等边界测试通过。未知文件保留，旧端 Memory .gitkeep 可丢弃。
- 六份相关 System Memory 源与当前开发 Project 副本已同步，Skill 更新为导出本地副本、编辑、统一上报。ChangeSet change-20260930-092656432z-e44618d2 已校验通过，入口 http://0.0.0.0:30000/projects/memsphere/changes/change-20260930-092656432z-e44618d2 。没有 Memory 命名或安装清单变化。

## 已执行检查

- npm run typecheck：通过。
- git diff --check：通过。
- 沙箱外实际运行 node --import tsx --test test/archive-worker-guard.test.ts test/archive-store.test.ts test/agent-activity.test.ts test/data-manager.test.ts：35 项通过、0 失败。沙箱内仅返回文件入口结果，不用它代替实际用例结果。
- 沙箱外分别运行 Run Store 与 ChangeSet 测试：60 项中 58 项通过、2 项失败；失败均为 test/run-changeset.test.ts 的旧 memorySnapshot 精确断言仅预期 path，不包含本轮已确认新增的 files。后续须升级为验证清单正确性，不删除或弱化快照契约断言。
- run-command 子进程持续占用 CPU，整体与缩小范围的两次检查均未完成。已核实并停止仅属于本轮的两个诊断任务，不把其结果记为通过；卡点仍需诊断并重跑。未影响用户已有 Worker 或 View。

## 后续实际检查

- 更新提示和清单的旧断言后，archive-run-data、run-command、run-changeset 共 26 项通过；早期 run-command 未完成结果不作为成功证据。
- 受影响测试 run-data-access、run-memory-backfill、package-release、reserved-store、run-store 共 79 项通过。
- 第一次全量 npm test：674 项，672 通过、1 失败、1 Windows 平台跳过；唯一失败为 package-release 包清单未加入已确认独立工具的旧断言，已补齐并在受影响测试通过。随后以 `npm test -- --test-reporter=dot` 重跑最终全量，退出码 0。该成功不能覆盖单独诊断已复现的 .gitkeep 兼容问题。
- 最新 typecheck、build、git diff --check、memsphere validate、Memory ChangeSet validate 通过。普通 validate 不替代变更级校验。

最终全量新增不透明 Store Schema export/edit/report 用例后为 710 项，709 通过、0 失败、1 Windows 专属跳过；当前受影响验证 82 项与新增 Schema 测试通过。详细命令、历史失败、真实 Home 配置差异和未验证项见 verification-report.md。

Windows/macOS 未实际运行；新构建 CLI 在较新真实 Home 配置上失败，但同一 schema 与 820530e 一致，隔离 Home/Project 通过，真实配置未动。独立实现 Review 与后续 Human 验收均已通过，详见 acceptance-record.md。

实现 Review：review-20260930-094805z-4d2059cd，round-20260930-094805z-ac63b047。三位 Reviewer 均独立检查实际代码并复跑测试、typecheck、build；没有结构化阻塞意见。未复跑的环境校验及跨平台、云后端限制均在摘要中明确保留。

## 暂停点

元信息与 .gitkeep 均已由 Human 确认并实现，相应 decision-pending 文件仅为历史命名，不再待决。当前继续 Review，没有新的已知待决选择。用户 .vscode/ 和根目录 review-summary.md 不属于本轮实现文件，未修改或暂存。
