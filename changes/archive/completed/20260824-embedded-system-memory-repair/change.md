---
id: 20260824-embedded-system-memory-repair
type: feature
created: 2026-08-24
completed_at: 2026-08-24
run_id: run-20260824-110844z-6547e14f
---

# Embedded Project 的 System Memory repair

## 需求

让 `memsphere project repair [name]` 支持 Embedded Project。用户升级 memsphere 后，可以显式运行同一条 repair 命令，把当前 package 携带的 bundled System Memory 同步为当前 Git worktree 中经过完整校验的普通文件差异，再通过正常 Git 流程审阅和集成。

## 当前迭代范围

- Managed repair 的受控 ChangeSet、validate、publish、no-op 和失败诊断行为保持不变。
- Embedded repair 使用命令所在 linked worktree 的 effective Memory Root，不回退或修改主 worktree。
- 共用 bundled manifest 的 create/update 与 v3 tombstone delete 规则；路径或 identity 冲突在写入前失败。
- 计划目标存在未提交修改时拒绝覆盖；候选完整 Store 校验失败或目标快照变化时不写入。
- 校验通过后只产生 worktree diff，不 commit、push 或调用 Managed publish。
- CLI help、README、Skill、Reserved Memory 和当前开发 Project Memory 保持一致。

## 验收标准

- Embedded create/update/delete、no-op、linked worktree、不 commit、脏目标、路径 identity 冲突、候选校验失败和 snapshot/CAS 冲突都有自动化覆盖。
- 命令失败不留下部分 repair 修改。
- Managed repair 回归通过。
- `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`、Reserved Store 测试和两份 System Memory 一致性检查通过。

## 后续范围

- 不自动随 package 升级同步。
- 不提供版本选择、降级、dry-run、逐项交互确认或 `reinitialize` alias。
- 不改变 Mounted Project 的只读模型。

## 向前兼容

结论：不需要向前兼容。

仓库当前不存在名称包含 `stable` 的 Git Tag，因此没有需求规范定义的稳定 checkpoint。现有 Managed repair 行为仍作为本迭代兼容性验收基线。

## 交付内容

- `memsphere project repair [name]` 现在按 Store 类型分流：Managed 保持 ChangeSet validate/publish；Embedded 在当前 linked worktree 的 effective Memory Root 同步 bundled System Memory。
- Embedded repair 共用 manifest identity、create/update 与 v3 tombstone delete 规划，只留下普通 Git diff，不 commit、push 或 Managed publish。
- 写入前执行 dirty target、identity/path conflict、完整候选 Store、snapshot/CAS（包含内容与 mode）校验；失败时不留下部分 repair 修改。
- staging 只复制真实目录和常规文件，拒绝任何层级的符号链接或特殊文件，避免候选构造写出 Memory Root。
- CLI help、README、内置 Skill、Reserved Memory 与当前 Embedded System Memory 已同步更新。

## 验证结果

- `npm run typecheck`、`npm run build`、`memsphere validate`、Reserved Store validate 与 `git diff --check` 通过。
- project-command 14/14、memory-cli 9/9、reserved-store 5/5 通过。
- `npm test`：421 项，420 通过、0 失败、1 项 Windows-only 用例按平台跳过。
- 覆盖 Managed 回归，以及 Embedded create/update/delete、no-op 完整校验、linked worktree、dirty target、identity/path conflict、candidate validation、内容与 mode CAS、rollback、symlink staging 零外部写入。

## 验收结论

- 需求契约与实施方案已完成多角色评审。
- 最终实现验收中研发、测试与架构角色均通过；不存在未处置阻塞问题。

## 残留问题

- Windows-only Agent Review 跨 shell 用例未在当前 Linux 环境执行；该路径不属于本次改动范围。
- 对抗性本地进程仍可能利用 snapshot 复核与原子 rename 之间的极窄 TOCTOU 窗口替换父目录；当前 Project lock、dirty 检查、staging symlink 拒绝、CAS 与回滚满足本轮常规并发及安全验收，目录句柄级不跟随链接写入可作为后续安全强化。
