---
id: 20260819-run-name
type: feature
created: 2026-08-19
completed_at: 2026-08-19
run_id: run-20260819-044429z-54cc1d68
---

# Run 名称与 Procedure 名称分离

## 需求

新建 Run 时必须通过 `--name` 提供本次执行的用户可读名称。任务列表和详情页以 Run 名称为标题，详情页同时显示 Procedure 名称。历史 Run 允许缺少名称，展示时回退到 Procedure 名称。

## 交付

- `run start` 增加必填 `--name <name>`，命令层与 Store 层拒绝缺失、空白及控制字符。
- 新 Run 持久化规范化名称；历史 v2/v3 Run 无需迁移或回填。
- 列表、单 Run status、completed 输出和 View 详情均区分 Run 名称与 Procedure 名称。
- View 支持长名称安全换行，详情显示“流程/Procedure”元信息。
- Skill、Prompt 与 System Memory 同步新命令和名称语义。
- 当前 worktree 的 `.memsphere/memory` 开发副本与 `reserved-memory` 发布源同步，随本分支一起合并；未修改其他关联 worktree。
- System Memory 通过 Managed Memory ChangeSet `change-20260819-055944409z-2bb94e27` 校验并发布，Revision 为 `409873ae6d5b33a41fd0c7af07e1873d20bddaab`。

## 验证

- 针对性 Run output 与 Prompt 测试：26/26 通过。
- `npm run typecheck`：通过。
- `npm test`：360/360 通过。
- `npm run build`：通过。
- `npm run smoke:project`：通过。
- `memsphere validate`：通过。
- `memsphere --project memorybase validate`：通过。
- 当前 worktree `.memsphere/memory` 使用显式临时配置执行仓库 validator：0 issues；5 份对应文件与 `reserved-memory` 源逐字一致。
- Memory Store、Skill 与 Memory CLI 针对性测试：23/23 通过。
- `git diff --check`：通过。
- 构建产物 CLI 冒烟和 Playwright 响应式测试通过。

## 验收

- 实现验收 Review Round 1 发现单 Run status 文本未显示名称，已修复并补充测试。
- Review Round 2 产品/研发/测试及架构师兼项目负责人全部通过，阻塞、风险和建议均为 0。

## 后续范围

- 不为历史 Run 回填名称。
- 不要求 Run 名称唯一；Run ID 继续作为唯一身份。
- 不在本轮增加名称长度上限或重命名能力。

## 残留问题

- 提需方尚需在实际 View 中确认视觉层级和文案偏好；自动化测试已覆盖结构、回退和窄屏溢出。
