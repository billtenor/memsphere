---
id: 20260907-issue-63-skip-review-without-control-plane
type: bug
created: 2026-09-07
completed_at: 2026-09-10
run_id: run-20260907-122343z-39dc05f7
github_issue: https://github.com/billtenor/memsphere/issues/63
---

# 全部 Reviewer Slot skip 时允许无 Control Plane 启动 Run

## 需求

健康的 Memsphere Project 未配置 `control_plane` 时，只要当前 Run 的全部可达 Reviewer Slot 都显式配置为 `skip: true`，含 Artifact Review 声明的 Procedure 应能正常启动并推进，不创建 Artifact Review，也不要求 Actor 或 Runner 权限。

只要任一 Slot 实际绑定 Actor，Run 启动仍必须要求 Control Plane；已经提供 Review 配置时应明确报告 `control_plane` 缺失，不得误报为未提供 Review 配置。

## 当前范围

- 无 Control Plane 时仍输出含内置 Decision Policy 的完整预检和有效全 skip example。
- 分离 Review 配置缺失、配置无效、Control Plane 缺失三类诊断。
- 根 Procedure 与可达 `!call` 子 Procedure 的全部 Slot skip 路径均可启动和 report。
- 实际 Actor binding 在 Run 持久化前失败且没有额外 Run 副作用。
- 同步 System Memory、当前开发 Project Memory 副本和 Memsphere Skill。

## 不做事项

- 不自动创建 Control Plane、Actor、ACP Provider 或权限。
- 不修改 Decision Policy、Assignment、Vote、Round 或既有 Review 结算语义。
- 不改变 Review 配置 JSON、Run v3 schema 或 YAML syntax 关键字。

## 验收标准

1. 不带 `--review-config` 时继续输出预检、不创建 Run，且无 Control Plane 时仍列出内置 Policy。
2. 全部可达 Slot 显式 skip 时 Run 启动退出码 0，Artifact 直接推进，不创建 Review/Assignment/Vote。
3. 任一 Slot 绑定 Actor 且无 Control Plane 时明确报告 `control_plane config is required`，不误报配置缺失且不创建 Run。
4. 无效 scope、slot、policy 与已有 Control Plane 路径保持严格校验。
5. 根 Procedure、延迟 `!call` 子 Procedure、真实 CLI 和全量回归通过。

## 向前兼容

结论：不需要向前兼容。

当前仓库没有名称包含 `stable` 的 Git Tag。作为回归兼容要求，保留 CLI 参数、Review 配置 JSON、Run v3 schema 和已配置 Control Plane 的行为。

## 开发任务

- [x] 修复 Run Review 预检和配置校验。
- [x] 支持无 Control Plane 的全 skip Procedure 实例化与延迟 `!call`。
- [x] 增加 store、command 和真实 CLI 回归测试。
- [x] 同步 Reserved/System Memory、开发 Project 副本和 Skill。
- [x] 完成定向与全量验证。
- [x] 完成研发、测试、架构三角色工程验收。
- [x] 完成 Human 产品负责人最终验收。
- [x] 写入 `completed_at` 并归档到 `changes/archive/completed/`。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：573 项，572 通过，0 失败，1 个既有 Windows 条件跳过。
- `npm run build`：通过。
- 定向 Run 测试：87/87 通过。
- Reserved/Skill 测试：2/2 通过。
- `memsphere validate`：通过。
- `git diff --check`：通过。
- Memory ChangeSet：`change-20260910-045452073z-2f4d947b`，最终内容校验通过，digest `677f131a951b65afd865d3f2987753c40d9aaeb0d163b7d4f1844fea2a81bc17`。

## 验收结果

- 研发、测试、架构 Reviewer 已直接检查 Workspace 实现和测试，并在 `review-20260910-050014z-b9972ad4` 第 1 轮一致通过。
- Human 产品负责人 billtenor 与产品 Agent 在 `review-20260910-050645z-47c8b5e2` 第 1 轮均投票通过；Runner 接纳评审结论，最终产品验收通过。
