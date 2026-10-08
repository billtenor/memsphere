# 初始验证报告

Run：run-20261008-064617z-ca3c75d4；验证对象为 Issue #95 最终工作区代码、文档、System Memory 与 Skill。

## 采用规范

采用已读取 memsphere-repository-testing-rules：测试保护独立用户契约、真实 CLI 集成、受影响测试与全量回归、System/Reserved Memory 校验、最终 ChangeSet 证据。没有界面交互逻辑调整，修改为 CLI/Agent Prompt 与元数据展示 API，因此不新增前端交互验收。

## 验收映射

1. 默认 ID：既有循环/Call、新 Run、失败重试测试通过；default review 不得改显式 ID。
2. 同业务 ID 跨步骤/Run：一条记录 revision 连续增长、完整替换删除旧可选字段、不同执行 UUID、原快照保持。
3. Review：候选/详情/API/contract/回执包含 ID，评审前无业务数据；同 ID 重报和省略继承，变更拒绝，通过写修订值。
4. 失败：空/空白/路径/Windows reserved/NFC/扩展名长度/NUL 拒绝，无推进/无目标分配；模型及格式失败不冻结；非模型、控制、Schema 字段/收尾拒绝；业务写入失败及写后 Run 保存失败保持目标，恢复重试增加 revision。
5. 旧记录：移除新增字段的 legacy pending Review 仍用默认 ID 接受，并拒绝新显式目标；无需迁移。
6. 接受目标：模拟步骤目标在 Submission 后改变，接受拒绝且无业务写入；既有模型/目录指纹变化同样拒绝。
7. 文档与 Memory：中英文说明无条件整条替换、最后成功写入覆盖、并发可能覆盖更新、不含 CAS；六份 System Memory 源与副本逐字节相同。Review Concept 与第三章教程已核查，无相关字段或步骤需要修改。

## 实际命令与结果

- npm run typecheck：通过。
- npm run build：通过；全量 npm test 的 pretest 会重新构建最终代码与发行资源。
- 模型 Artifact 文件：34 tests，通过，包含真实 node dist/cli.js 参数与回执验证。
- run-store、run-command、review-store、prompt-renderer、reserved-store：105 tests，通过。
- 修复后 run-rule-integration 与 run-model-artifact：35 tests，通过。
- memsphere validate：通过。
- git diff --check：通过。
- 六份 System Memory 源/副本 byte comparison：全部一致。
- 最终 npm test：141/141 files，1164 tests，0 failures，289.01 秒；退出码 0。最终 npm run build、memsphere validate 和 Memory ChangeSet validate 均通过。

## 失败、修复与限制

本轮首次全量 npm test：141 files，1 failed，290.52 秒。run-rule-integration 的普通产物最小上下文不含 submissions，新增 ACP contract 逻辑在非模型路径无条件读取导致失败；已限定只在模型路径读取，保留原测试断言并复跑35项通过。没有把此失败归为历史失败。新测试构造错误此前已修正。受限沙盒缺失真实 CLI stderr，最终测试通过宿主执行；没有环境阻塞遗留。

无 stable Tag，不建立历史兼容责任；默认/旧记录行为作为当前功能回归测试。Linux/Node 22 实测，未在 Windows/macOS 额外运行；复用可移植 ID 规则，不宣称跨平台实测。无条件覆盖为确认范围，CAS 后续考虑。

## Memory 交付证据

ChangeSet ID：change-20261008-071155715z-ff7c51a9。
校验状态：passed；内容 digest：02720c9f5e02f2706d1ed57d93cad1e6eed29641d234ed2fbf0618e7061ac01e。
CLI 返回的 View 入口：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-071155715z-ff7c51a9 （入口记录，不作为服务可达性测试）。
