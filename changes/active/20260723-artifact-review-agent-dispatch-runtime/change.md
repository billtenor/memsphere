---
id: 20260723-artifact-review-agent-dispatch-runtime
status: todo
type: feature
created: 2026-07-23
run_id: run-20260723-065241z-05e8589b
---

# Artifact Review Agent 独立调度运行时

## 需求

解除 Artifact Review Agent Worker 与 `memsphere run report` 调用环境之间的隐式绑定。

当前 `run report` 在保存 Artifact、创建 Review Round 和 queued Agent Assignment 后，会在同一调用链中立即派发 detached Worker。Worker 虽然脱离了父进程组，但仍继承父进程的文件系统沙箱、环境变量和其他进程级约束。当 `report` 从只允许写当前 Workspace 和临时目录的受限 Agent 环境执行时，Traex ACP 可能因无法写入 Home 下的配置、缓存或 PATH 相关文件而启动失败；同一命令从普通用户终端执行则可以成功。

需要把“可靠提交并入队”和“在稳定运行环境中消费 Agent Assignment”分成职责清晰的边界。`report` 的成功不得取决于 Reviewer Provider 能否在调用方环境立即启动，Agent 调度也不得把 View 是否正在运行作为必要前提。

## 范围

- `run report` 完成 Artifact 准备、确定性校验、Review/Submission/Round/Assignment 持久化和 queued 状态提交后即可成功返回，不在调用方进程环境中直接启动 Agent Provider。
- 建立独立的 Agent Assignment 调度运行时，负责发现、原子 claim、启动和恢复 queued Assignment。
- 调度运行时必须有明确的启动、停止、状态查询和故障诊断方式；其生命周期不得隐式依附浏览器页面请求。
- View 可以展示调度状态并提供管理入口，但 View HTTP 服务和浏览器页面均不是 Agent Review 正常运行的硬依赖。
- 明确无 View 场景的运行形态：用户只使用 CLI 时，queued Assignment 仍能被启动、等待和完成。
- 调度器与 Worker 使用配置确定的 Workspace、CLI Runtime 和 Provider 环境；不得继承一次性 `report` 调用方不相关的沙箱限制或临时环境。
- 多个可用调度入口同时存在时，依靠 Run Store 写锁和 Assignment claim 保证单个 Attempt 最多启动一次。
- 调度器中断、机器重启或 Worker 异常退出后，queued/running/failed 状态具有明确、可观察且可恢复的语义。
- 环境类失败应被稳定归类并展示；只读文件系统、不可写 Home/配置目录等错误不得落入无信息量的 `unknown`。

## 验收标准

1. 从只允许写 Workspace 和临时目录的受限进程执行 `run report`，命令能够成功保存候选 Artifact 并创建 queued Agent Assignment；不会在该受限进程内启动 Provider，也不会把只读 Home 错误写入 Attempt。
2. `report` 返回后，独立调度运行时能够在配置的正常运行环境中自动 claim 并启动 Traex ACP Reviewer，最终形成 submitted 或具有明确类别的 failed Attempt。
3. 未启动 View HTTP 服务、未打开浏览器页面时，仅使用 CLI 仍能启动调度能力、执行 Agent Review、`run review wait` 并取得结果。
4. View 已启动时，不会产生第二套调度真相或重复启动同一 Assignment；View 只展示并操作统一调度状态。
5. 同一 queued Assignment 被两个调度进程并发发现时，只创建一个 running Attempt、一个 Provider 进程和一个最终提交。
6. 调度进程在 claim 前退出时，Assignment 仍保持 queued 并可被其他调度器消费；claim 后 Worker 未建立 Session 即退出时，形成可诊断的失败或按明确租约规则恢复，不会永久卡在 running。
7. 调度运行时重启后，不会重新执行 submitted Assignment；对允许恢复的 queued Assignment 能继续派发，对 failed Assignment仍要求既有显式 Retry 语义。
8. Traex 因 `EROFS`、只读 Home、配置目录不可写或等价环境问题退出时，Attempt failure 的 `category` 为 `environment`，并保留足以定位问题的脱敏错误摘要。
9. `run report`、`run review wait`、View Retry 和后台调度之间的职责与幂等行为具有自动化并发测试；Human-only Review 和未配置 Review 的普通 Artifact 行为保持不变。
10. 使用真实 Traex 完成一条端到端证据：受限环境提交 Artifact，正常环境后台调度，Agent 读取评审上下文并正式 Submit，Runner 能取得 Review 结果。

## 不做事项

- 本需求不要求 View 成为常驻或必需服务，也不把浏览器轮询作为调度触发器。
- 不恢复已移除的 Review bridge、Unix Socket 或 TCP Listener 方案。
- 不改变 ACP stdio 协议、Reviewer Prompt、Comment/Vote、Decision Policy 或 Review 多轮状态机。
- 不在本需求中调整 Traex 自身的安装、登录、模型授权和内部配置写入行为。
- 不把远程分布式队列、跨机器调度、高可用集群或通用作业平台作为首期目标。
- 不改变 Human Assignment 的执行方式。

## 关联需求

- 直接前置：`20260720-artifact-review-agent-acp`。该需求建立 ACP Worker 和当前由 report/wait/View 幂等派发的行为，本需求重新划分派发所有权。
- 强关联：`20260722-agent-review-runtime-hardening`。它处理 Reviewer 进程内部的权限、超时、成本和终态，本需求处理 Worker 启动环境与调用方解耦。
- 关联：`20260722-acp-agent-activity-visibility`。该已完成需求明确不新增 daemon/dispatcher；本需求若引入独立调度运行时，应在设计阶段说明新的边界和必要性，但不改写其活动记录契约。

## 技术与测试方案

待开发前补充。方案阶段至少比较以下运行形态，并以“无 View 可用、无 Socket、调用方环境不污染 Worker”为共同约束：

- 独立的 `memsphere agent-dispatcher start/stop/status` 后台服务。
- 由已有 Memsphere 后台服务托管调度器，但 View HTTP 能力与调度能力可独立启停。
- CLI `run review wait` 在没有后台服务时显式保障调度可用，但不得再次直接继承受限调用方环境启动 Provider。

需要定义队列扫描周期或唤醒机制、Assignment claim/租约、进程状态文件、日志与错误分类，以及开发安装和全局安装下的 CLI Runtime 定位方式。

## 开发任务

待开发前补充。

## 验收结果

尚未开始。
