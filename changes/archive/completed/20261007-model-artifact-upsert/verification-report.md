# 初始验证报告

## 规范与执行范围
采用已读取的 statements/memsphere-repository-testing-rules。执行受影响模块、CLI、Run、Memory 语法及序列化、Artifact 格式与迁移、Review、View、归档、Reserved Store 测试，并完成要求的全量回归。没有调整前端交互，无额外 playwright-cli 手工操作要求；全量包含真实浏览器 View 集成测试。

## 实际执行结果
- `npm run typecheck`：通过，日志 /tmp/model-artifact-typecheck.log。
- `npm test`：通过，141/141 测试文件，0 失败，耗时 284.63 秒；日志 /tmp/model-artifact-all-tests-final.log。包含 reserved-store、memory-schema/syntax/serializer、artifact-validation/format-fixtures/migration、run-store/run-command、review/view/archive 全部规定套件。
- `npm run build`：最终版本通过，日志 /tmp/model-artifact-build-final.log。
- 最后仅调整 current-step 模板命令描述，构建后执行 `node --import tsx --test test/prompt-renderer.test.ts test/run-model-artifact.test.ts`：2 个文件通过，日志 /tmp/model-artifact-final-focused.log。
- 新增模型 Run 测试详细执行 23/23 通过；data-command 文件详细执行 13/13 通过。新增文件也进入本次全量，未跳过或弱化断言。
- `git diff --check`：通过。
- `memsphere validate`：通过，当前 worktree Project Memory 可解析及校验。
- `memsphere memory change validate`：最终内容通过，ChangeSet change-20261007-135611678z-81ddf10f，digest 8a3d8a67762fd0ffbf045503f16463b9f3888a2378faf243fa73941407a91f76，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261007-135611678z-81ddf10f。六份 System Memory 源与安装副本同步。

## 验收标准映射
合法模型值接受后有完整快照和独立业务记录；非法值/目标变化不写且不推进；恢复原目标可重试；Review 未通过不写、修改后提交新不可变 Submission；标量 string/number/boolean 的 json/yaml/plain 表示通过；循环、重复 Call、不同 Run 身份独立；写失败和 Run 保存失败可重试且复用业务 ID；整条替换不合并、并发 revision 串行；业务后续修改不影响历史 Artifact；abandon/archive/restore/delete 不删除或重复写业务数据；普通 Artifact 既有回归通过。

## 本轮失败与环境问题
首次全量发现本轮 ACP Prompt modelTarget 输入校验表遗漏，已补齐 registry schemas，重新构建后的全量 141 文件全部通过；没有遗留本轮失败或归因历史失败。沙盒内 CLI 子进程及本地中央锁写入受限：CLI/full suite 在宿主提升环境执行通过，未把权限错误计为业务通过，也未绕过 Review。最后 Memory 变更校验在宿主执行通过。

## 未执行及残余风险
工程及提需方评审尚待进行。未测试其他 ValueStore Factory（首版仅 JSON filesystem），未实现跨 Store exactly-once、批量或跨 Run 业务键；redo 允许 revision 增长，符合已确认方案。无已知阻塞失败，不声明评审或交付已完成。
