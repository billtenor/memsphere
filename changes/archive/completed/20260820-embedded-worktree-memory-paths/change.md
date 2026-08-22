---
id: 20260820-embedded-worktree-memory-paths
type: breaking-change
created: 2026-08-20
completed_at: 2026-08-20
run_id: run-20260820-163449z-8d01fcf1
---

# Embedded Memory worktree-aware 路径解析

## 需求

Embedded Project 在 linked worktree 中执行 CLI 时，Memory 必须解析到当前 worktree，避免 Agent 根据 View 或 Project 配置中的主工作树地址误改主干。View 继续只展示唯一的主工作树 Memory。

Embedded Store 配置拆分为：

- `repository_path`：Git 主工作树绝对真实路径。
- `memory_path`：规范化的仓库相对 Memory 路径。

## 当前范围

- Project 创建时发现并记录 Git 主工作树。
- 普通 CLI 校验 Git common-dir，并在当前 worktree 解析 Embedded Memory。
- View start、restart、serve 与 Project 切换固定使用 canonical 主工作树 Memory。
- Embedded `memory edit` 直接返回并编辑当前 worktree 文件，不使用 Managed ChangeSet 或 publish。
- `project show` 展示 canonical 与可用时的 effective Memory Root。
- 拒绝其他仓库、非 Git Workspace、非主工作树 `repository_path`、路径穿越和 symlink escape。
- 当前 worktree 缺少 Memory 路径时不回退主工作树。
- README、统一 Skill、Reserved Memory 与当前 Project System Memory 同步。

## 向前兼容

结论：不需要向前兼容。

旧的 `{ type: "embedded", memory_path: "/absolute/path" }` 配置会被拒绝；不提供兼容读取或自动迁移工具。合入后、运行新版本前，由维护者手工将现有 Embedded Project 配置更新为 `repository_path` 与相对 `memory_path`。

## 验收结果

- CLI linked worktree、View canonical 主工作树、Embedded edit、跨仓库拒绝、非主工作树配置拒绝、缺失目录不回退及 symlink escape 均有回归测试覆盖。
- symlink 检查覆盖 Memory Root 已存在和子目录缺失但父级 symlink 指向仓库外两种情况。
- macOS realpath 与 Windows 长短路径行为已纳入跨平台断言。
- 本地 `npm test` 共 387 项：386 通过、0 失败、1 项 Windows-only 在 Linux 正常跳过。
- `npm run typecheck`、`npm run build`、两份 Memory Store validate、diff check 与 gitleaks 通过。
- GitHub PR #16 的 Ubuntu、macOS、Windows、Windows packaged CLI shells 与 Gitleaks 五项检查全部通过。
- 实现与验证经研发、测试、架构师三轮评审，最终全票通过且无阻塞意见。

## 后续范围

- 不提供自动配置迁移。
- 不改变 Managed Store 的 ChangeSet、validate 与 publish 生命周期。
- 现有 Embedded Project 配置的手工更新属于合入后的运维动作。
