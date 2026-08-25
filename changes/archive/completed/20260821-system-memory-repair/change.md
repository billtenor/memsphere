---
id: 20260821-system-memory-repair
type: feature
created: 2026-08-21
completed_at: 2026-08-24T08:38:51Z
run_id: run-20260821-075424z-45e1a49a
---

# 现有 Managed Project 的 System Memory 修复命令

## 需求

为只在首次创建 Managed Project 时执行的 System Memory bootstrap 增加短且明确的重新同步入口。最终命令为 `memsphere project repair [name]`，不提供 `reinitialize` alias；用户执行一条命令即可补装、恢复或升级当前版本的 bundled System Memory。

## 验收标准

- Project 选择顺序为显式 `[name]`、全局 `--project`、当前 Primary Project。
- 只处理 Managed canonical Store 的 bundled System Memory，不修改用户 Memory，也不作用于 Embedded 或 Mounted Project。
- 缺失项 create、内容漂移项 update、manifest v3 tombstone 废弃项 delete；删除必须匹配历史 path、canonical identity 与计划时 blob digest。
- 命令内部通过受控 ChangeSet 完成 validate 与 publish；无差异时不创建 ChangeSet 或 Revision。
- ChangeSet 创建后的失败保留为带 failure 诊断的只读 `abandoned` 记录并清理 candidate。
- CLI help、README、Skill、Reserved 与 Installed framework Memory 使用一致语义，且没有 `reinitialize` 命令。

## 实现结果

- 新增 `project repair [name]` CLI 和 Managed System Memory reconcile 编排，复用既有 ChangeSet、完整校验、原子发布、CAS 与 rollback 路径。
- `project create` bootstrap 复用同一 reconcile/publish 内核。
- System Memory manifest 升级为 v3 identity tombstone；v1/v2 保持可读但不授权自动删除。
- repair 失败语义适配主线 `active / completed / abandoned` 生命周期，保留阶段、时间、安全摘要和已有 checkpoint/issues。
- `project repair --help` 明确 bundled-only、用户 Memory 不修改、Embedded/Mounted 非目标、删除保护、no-op 与 Project 选择优先级。

## 验证结果

- Artifact Review `review-20260822-031102z-5622f206` 第 2 轮由项目负责人、研发、测试和架构师全部通过，阻塞、风险、建议均为 0；Runner 已批准。
- `npm run typecheck`、`npm run build`、两份 Memory Store validate、security check 与 staged diff check 均通过。
- `npm test` 共 406 项：405 通过、0 失败、1 个 Windows 专用测试按平台跳过。
- CLI 测试覆盖 help 安全边界、repair no-op 输出和 `reinitialize` 不存在；隔离 fixtures 覆盖 Managed、Embedded、legacy tombstone、用户路径复用和失败诊断。

## 后续范围

- 当前迭代不新增交互式确认、dry-run、版本选择或 `reinitialize` 兼容别名；如有需要应作为独立需求评估。

## 残留问题

- 当前范围无阻塞残留。
- 未在真实用户 Project 上执行 repair，以避免未经授权修改持久数据；相关行为由隔离 fixtures 验证。
- 当前 Linux 环境未执行 Windows-only Agent Review 跨 shell 测试，本次功能未修改该路径。
