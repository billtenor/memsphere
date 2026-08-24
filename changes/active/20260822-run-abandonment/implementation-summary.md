# 功能实现摘要

## 采用规范

- `memsphere-general-development-rules`
- `memsphere-repository-development-rules`：System Memory 同步、Procedure Run 与 Artifact、Review、Yaml 语法维护规则、向前兼容、过程记录
- `memsphere-repository-testing-rules`
- `memsphere-procedure`、`memsphere-framework`、`memsphere-yaml-syntax-rules`

其中本需求不改变 Memory YAML 关键字或结构，因此检查 `memsphere-procedure-schema`、`memsphere-schema-schema`、`memsphere-yaml-syntax-rules` 后无需修改。评审指出开发规范仍引用已移除的 `memsphere-review` Memory，已将规则修正为分别指向 `memsphere-procedure` / `memsphere-framework` / 教程 / Skill 以及 `memsphere-memory-review-process`。

## 修改范围与关键路径

- `src/run/store.ts`、`src/artifact-review.ts`：新增 `abandoned` / `cancelled` 状态和废弃审计元数据；写锁内原子转换；统一 running 写守卫；保留证据并取消未完成 Review、Assignment、Attempt。
- `src/platform-process.ts`、`src/acp/dispatcher.ts`、`src/view/service.ts`：停止派发已废弃 Run；锁外尽力终止 detached Reviewer Worker 进程组，并避免影响普通 ACP 子进程。
- `src/commands/run.ts`、`src/cli.ts`：新增 `memsphere run abandon --run ... [--reason|--reason-file] [--actor]`，仅用于 Human 已明确决定后的执行。
- `src/commands/view.ts`、`src/view/browser.ts`：新增废弃 API、一次确认弹窗、独立 abandoned 分组、停止步骤与可选原因展示；View 不要求填写原因，废弃后只读，归档仍为单独按钮。
- `src/archive/store.ts`：允许 done / abandoned Run 归档，恢复后保持原终态；running 仍拒绝。
- `src/prompts/**`：新增双语 `run.abandoned` 终态 Prompt，并让 cancelled Review 只读呈现。
- `reserved-memory/**`、`.memsphere/memory/**`、`src/skills/memsphere/SKILL.md`、`README.md`：同步 Human-only、保留证据、不可恢复、不自动归档等用户语义。
- `test/**`：覆盖状态转换、迟到写入拒绝、Reviewer 取消与停止派发、归档恢复、Prompt、View API 和浏览器静态契约。

## 需求映射与行为影响

- 仅 `running -> abandoned`；done、v1 和只读 Run 拒绝，重复废弃幂等。
- 记录废弃时间、Human 发起来源/可选 Actor、停止位置和可选原因；原因限制 2000 字符。
- 已有 Artifact、Schema 草稿和 Review 证据不删除；未完成 Review/Worker 收口，所有后续 Run/Schema/Review 写操作拒绝。
- View 不自动归档；用户废弃后仍能查看证据，再自行决定是否归档。
- v2/v3 既有 running/done 数据和旧 Archive 无需迁移；新增字段均可选，abandoned 旧式缺少元数据时仍可只读展示。

## 已执行验证

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：410 个用例，409 通过，1 个 Windows-only 用例按当前 Linux 平台跳过，0 失败。
- 最终 View 定向测试：68/68 通过；新增 API 集成测试验证废弃不自动归档。
- `memsphere validate`：当前 Project Memory 通过。
- `node dist/cli.js validate --memory-root reserved-memory`：System Memory 源通过。
- `memsphere memory change validate`：Embedded ChangeSet `change-20260822-032730960z-632ae5cb` 通过。
- Playwright CLI 真实交互：running 时归档禁用；点击废弃后只需确认；废弃后留在 abandoned 分组且归档可用；再次确认归档后才从 Task 列表移除。

## 未验证项

- 当前环境不是原生 Windows，因此 Windows 的 `taskkill /T /F` 进程树路径仅由既有跨平台单元测试覆盖，未做真实 Windows 端到端运行。
