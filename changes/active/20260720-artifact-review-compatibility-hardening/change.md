---
id: 20260720-artifact-review-compatibility-hardening
status: todo
type: feature
created: 2026-07-20
run_id: run-20260720-155527z-b6301fb6
---

# Artifact Review 兼容迁移与可靠性收口

## 需求

在 Artifact Review 全部核心能力交付后，完成语法与持久化迁移、旧 Run/Task Review 退役、并发和崩溃恢复、安全与性能收口，形成可以默认长期使用的稳定功能。旧 `kind: memory` Memory Review 必须保持原有语义和操作，不参与本次替换。

本需求是父 Epic 的第 6 个、也是最后一个串行子需求。

## 范围

- 发布包含 Artifact `review` 和 Memory `role_bindings` 的新 syntax version，并提供逐版本 `memsphere migrate syntax` 转换和可读诊断。
- 为 Run/Artifact Review 新持久化模型提供 contract migration；迁移可重复执行、失败可恢复，不丢失 Artifact、Comment、Vote、Decision 或 Snapshot 元数据。
- 废弃旧 `kind: task` Review：
  - 移除新建和编辑入口、旧 Run 右侧 Task Review 面板及新流程依赖。
  - 已持久化历史 Task Review 不自动删除，保留只读查看、归档和恢复能力，或提供有证据的等价迁移。
  - 文档和错误提示引导用户使用 Artifact Review。
- `kind: memory` Memory Review 的 create/comment/submit/done/archive/restore、View 和 memsphere-review Skill 全部保持不变。
- 强化一致性与恢复：
  - report、Submission、Round Result、Artifact 接受和 Run 推进具有原子/可恢复边界。
  - 并发 Vote、重复回调、重复 report、Challenge/Decision/Override 竞争只产生一个生效结果。
  - 服务/Agent/CLI 在关键写入点崩溃后可恢复，不重复启动完成的 Assignment 或推进 Action。
  - `review wait` 可跨长时间、断线和服务重启恢复，不依赖 View 在线。
- 后台 Agent 生命周期收口：超时、取消、孤儿进程、重试预算、清理和审计。
- 大型 Workspace、多轮、大 Artifact、多 Reviewer 的增量 Snapshot、存储上限、分页/懒加载和性能基线。
- 安全收口：路径穿越、符号链接、Secret 脱敏、恶意 Artifact/Comment、Identity 冒用、越权和日志泄漏测试。
- 更新 CLI/View/配置/迁移文档与完整 Smoke，证明六个子需求串联后的端到端行为。

## 不做事项

- 不实现远程 ACP、A2A、企业身份提供方或组织级 Policy。
- 不实现 OSS/远程 Review 存储、跨 Run 缓存或成本治理。
- 不新增加权/quorum 等超出前置 Decision Policy 的策略。
- 不把旧 Task Review 历史强制转换成不真实的 Artifact Review Round。
- 不删除用户现有 Review、Run、Memory 或 Workspace 文件。

## 验收标准

- 新旧 Memory syntax 识别准确；旧语法给出 migrate 提示，迁移到新版本后 validate 通过且二次迁移无变化。
- Run 数据 migration 保留全部 Review 证据，可中断恢复；未知未来版本拒绝写入而不损坏数据。
- 新 Run/View 不再创建或编辑旧 `kind: task` Review；历史 Task Review 可按既定只读策略查看、归档和恢复且不被删除。
- Memory Review 的存储、API、View、Skill、归档与恢复回归全部通过，行为和文案未被 Artifact Review 混淆。
- 并发 report/Vote/Decision 与重复命令只产生一个 Round Result、一个接受 Artifact 和一次 Action 推进。
- 在 Agent 调用、Vote 写入、Result 汇总、Artifact 接受、Run 推进各故障点注入崩溃后，恢复结果一致且无重复副作用。
- `review wait` 在 Human 长时间未提交、CLI 断线、View 重启和 Review 已提前结束的场景均正确恢复。
- 完成 Assignment 不会被重复启动；超时/取消不会遗留不可控子进程，失败记录可审计。
- 大 Workspace、多轮和多 Reviewer 基准满足技术方案确定的时间、内存与存储上限；View 使用分页/懒加载保持可操作。
- 路径穿越、Workspace 外符号链接、Secret 文件、恶意 Comment/Artifact 和 Identity 冒用测试无法泄漏内容或越权改变决策。
- 完整 Smoke 覆盖：控制平面解析 -> Human 首轮要求修改 -> Agent/Human 混合第二轮 -> Challenge/Decision -> Revision Summary/Workspace diff -> 最终通过并推进。
- 全量项目测试、CLI 测试和桌面/移动 View 浏览器回归通过，无实质遗留阻塞后方可将父 Epic 进入 accepting。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 前置：`20260720-artifact-review-evidence-view` 及前面全部串行子需求。
- 本需求完成后，六个子需求共同满足父 Epic；没有后续串行子需求。

## 技术与测试方案

待开发前补充。

## 开发任务

尚未开始。

## 验收结果

尚未开始。
