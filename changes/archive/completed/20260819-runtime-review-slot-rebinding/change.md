---
id: 20260819-runtime-review-slot-rebinding
type: feature
created: 2026-08-19
run_id: run-20260819-031737z-da37aae2
completed_at: 2026-08-19T11:51:11+08:00
---

# Run 运行期 Review Slot 换绑

## 当前迭代需求契约

### 整体目标

允许 Runner 在 Run 仍处于运行状态时，把 Review Slot 从当前绑定的 Human Actor 切换为 Agent Actor（或其他已冻结 Actor），使 human 完成前几段流程后可以退出，后续尚未创建的 Review Assignment 自动使用新 Actor。

### 当前迭代范围

- 新增受锁保护的 Run 运行期 Slot Binding 更新能力，按 Slot 原子替换 Actor 列表或显式 skip。
- 换绑只允许选择 Run 创建时 `controlPlane` 快照中已冻结的 Actor，并复用该 Actor 的冻结权限与 Agent 运行配置。
- 更新所有尚未创建 Artifact Review 的当前/未来步骤；已经创建的 Review、Round、Assignment、Vote 和历史 Artifact 不改写。
- 每次换绑保存时间、Runner 主体、Slot、变更前后绑定及实际影响 scope 的审计记录。
- 换绑前重新验证未知 Slot、未知/重复 Actor、空 Actor 列表、Decision Policy 决策能力、已完成/只读 Run 等错误；失败不写入部分状态。
- 提供 CLI：查看当前可换绑 Slot 与 Actor，并执行换绑；CLI 输出明确列出变更和未受影响的既有 Review。
- 在 View 的任务详情中展示当前有效绑定和换绑历史，并允许本机用户完成同等换绑操作。
- 更新 Run/System Memory、内置 skill、README 或相关用户说明，使“启动时冻结且不可变”改为“Actor/权限目录冻结，Binding 可通过显式审计操作影响未来 Review”。
- 增加 Run store、CLI、View API/UI 的成功、失败和边界测试。

### 后续范围

- 不支持把当前正在等待的 Human Assignment 就地转交给 Agent；如需处理当前 Review，仍由原参与者完成，或后续另行设计 Review 级撤销/重建协议。
- 不支持从 Run 启动后新增的项目 Actor 换入当前 Run。
- 不新增 Decision Policy、Permission 或 Memory YAML syntax。
- 不做通用组织权限审批、远程身份认证和多人并发编辑 UI。

### 交付物

- Run binding 变更模型、校验、持久化与审计实现。
- CLI `run binding show/update`（最终命名以现有 Commander 结构一致性为准）。
- View API 与任务详情换绑交互。
- 对应自动化测试、System Memory、skill 和需求文档更新。

### 验收标准

1. Run 中 Human 已完成前两个 Review 后，Runner 可把后续共用 Slot 换绑为冻结的 Agent；下一次 Review 只创建 Agent Assignment。
2. 已经创建的 Review 及其 Assignment 在换绑后完全不变；历史 View/CLI 仍显示原 Actor。
3. 同一 Slot 可原子替换为一个或多个 Actor，或显式 skip；Actor 去重且至少一个。
4. 未知 Slot、未知 Actor、重复 Actor、空列表、已完成 Run、只读 Run、换绑后无法满足 Policy 时拒绝，磁盘 Run 保持不变。
5. 同一 Actor 承担多个 Slot 时仍只生成一个 Assignment，并保留全部 Slot 来源。
6. `!call` 的尚未实例化/尚未创建 Review 步骤使用更新后的 Run Binding；父子 Procedure 同名 Slot 仍按完整 Slot key 隔离。
7. 并发 report/rebind 使用同一 Run write lock，不产生部分写入或丢失更新。
8. Run JSON 兼容读取当前 v3 文件；缺少换绑历史的既有 Run 继续执行，现有启动配置与 CLI 脚本不受影响。
9. CLI 与 View 都能查看可用冻结 Actor、当前绑定、受影响的未来 scope 和审计历史，并执行同一套校验。
10. 通过针对性测试、`npm run typecheck`、`npm test`、`npm run build` 与 `memsphere validate`。

### 向前兼容

结论：需要向前兼容。

当前 v3 Run、Review、启动 Review 配置、CLI 脚本和 View 数据已经可能存在于用户工程中。本轮通过可选的换绑历史字段与现有 v3 schema 兼容读取，不改变 `run start --review-config`、既有 Review snapshot、Assignment/Vote 语义，也不让项目配置变更静默影响 Run。旧 Run 无换绑历史时视为从未换绑，无需迁移或重建。

### 采用的 Statement

- `memsphere 代码仓库需求规范`：独立写明向前兼容结论、风险范围及验收约束。
- `memsphere 代码仓库开发规范`：Run/Review/View 行为变化同步更新 System Memory 与 skill；不新增 YAML syntax 关键字。
- `memsphere 代码仓库测试规范`：覆盖成功和失败边界，并完成目标测试与全量验证。

### 待确认项

- 本迭代采用“只影响尚未创建的 Review”作为安全边界，不接管当前已创建的 Human Assignment。
- 换绑仅可使用 Run 冻结 Actor；如需使用新 Actor，应在启动 Run 前加入配置，或另行设计扩展 Run Actor 快照的受控流程。

# Syntax 关键字变更

本轮不新增、重命名或删除任何 Memory YAML syntax 关键字。

## 实施与验证方案

### 现状证据

- `src/run/store.ts` 在 `startRun` 中生成 `controlPlane` 与 `reviewConfiguration` 快照，并在 `instantiateProcedureTemplate` / `applyControlPlaneToSteps` 中把绑定复制到每个 `RunStep.controlPlane`；后续 `!call` 也从同一 `reviewConfiguration` 实例化。
- `reportRun`、Review mutation、Schema/Repeat mutation 已统一通过 `withRunWriteLock` 串行写 Run；新增换绑应复用该锁和 `writeRun` 原子替换。
- `ArtifactReview.controlPlane` 在 Review 创建时再次冻结，因此只要不修改已有 `artifactReviews`，历史 Assignment 与鉴权自然保持不变。
- `RunState` v3 使用 Zod 严格解析；新增审计字段必须设为 optional，确保既有 v3 JSON 无迁移读取。
- CLI 的 Run 子命令位于 `src/cli.ts` / `src/commands/run.ts`；View 的 HTTP 路由位于 `src/commands/view.ts`，浏览器单文件 UI 位于 `src/view/browser.ts`。

### 数据与核心 API

- 在 `RunState` 增加可选 `bindingChanges`，单条记录包含稳定 id、时间、主体 `runner`、Slot key、before/after、affectedReviewScopes 与 preservedReviewIds。
- 新增只读 `buildRunBindingSnapshot(run)`：返回冻结 Actor、每个 Slot 当前配置、未来可影响 scopes、已创建 Review 与历史。
- 新增 `updateRunSlotBinding({ runsRoot, runId, slot, actorIds | skip })`：
  1. 在 Run write lock 内读取并检查 v3/running/not-readOnly/controlPlane/reviewConfiguration；
  2. 从 `procedureSnapshots` 推导合法 Slot 与关联 Review scope，不信任客户端传入 scope；
  3. 校验 Actor 存在、非空、去重；构造候选 `reviewConfiguration`；
  4. 对所有尚未创建 Review 的关联 scope 重新解析 `ArtifactControlPlane` 并执行现有 `assertArtifactReviewCanStart`；
  5. 同步更新 `reviewConfiguration`、`plan`、活动 `stack` 中匹配 scope 的步骤；已创建 Review 与对应冻结 control plane 不变；
  6. 追加审计记录并原子写入。
- 将“给单个受 Review step 应用配置”和“收集 scope/slot”抽成共享函数，供 start 与 rebind 使用，避免两套校验漂移。
- 后续 `!call` 继续读取更新后的 `reviewConfiguration`，因此未实例化子 Procedure 自动使用新绑定。

### CLI 与 View

- CLI 增加：
  - `memsphere run binding show --run <id> [--output json|text]`
  - `memsphere run binding update --run <id> --slot <procedure::slot> (--actor <id>... | --skip)`
- `binding update` 输出 before/after、影响 scope、保留的 Review id 与审计 id；错误沿用核心 API 信息。
- View 增加 `/api/runs/:id/bindings` GET/POST；POST 仅接收 slot 与 actorIds/skip，服务端调用同一核心 API。
- Task View 增加“运行期评审绑定”区域：展示冻结 Actor 类型/权限、当前绑定、未来影响数量与换绑历史；当前 Run 可编辑，done/read-only 只读。提交后重新加载 runs，不修改 Artifact Review 浮窗状态。

### 文档与 Memory

- 更新 `reserved-memory/concepts/memsphere-procedure.yaml`、对应 schema/Statement 中所有“Run 创建后 Binding 永久不可变”的描述，明确 Actor/Permission 快照冻结而 Binding 只能通过显式 Runner 操作影响未来 Review。
- 同步 `src/skills/memsphere/SKILL.md` 与安装到当前开发 Project 的对应 Memory 副本；不修改 YAML syntax 和 manifest。
- 更新 README 的 Run Review CLI 说明。

### 开发任务

1. RunState 审计 schema、binding snapshot/update 核心逻辑与公共导出。
2. Run store 单元测试：未来步骤、当前未建 Review、既有 Review 保留、skip、多 Actor、失败原子性、done/read-only、`!call`、旧 v3 读取与并发串行。
3. CLI 命令、解析与 run-command 测试。
4. View API、浏览器交互与 service/browser 测试。
5. System Memory、skill、README 同步。
6. 目标测试、全量测试、构建与 Memory 校验。

### 验证方式

- 目标：`npx tsx --test test/run-store.test.ts test/run-command.test.ts test/view-service.test.ts test/view-browser.test.ts`。
- Memory/Reserved：`npx tsx --test test/reserved-store.test.ts test/memory-schema.test.ts`，并实际执行 `memsphere validate`。
- 全量：`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。
- 手工 CLI smoke：创建两步含同一 Slot 的 Run，完成第一个 Review 后换绑，确认第二个 Assignment 使用 Agent 且第一个历史 Assignment 不变。

### 采用的 Statement

- `memsphere 代码仓库开发规范`：Run、Review、View 变更共用核心语义并同步 System Memory 与 skill；本轮不新增 syntax。
- `memsphere 代码仓库测试规范`：覆盖成功、错误、兼容与并发边界，并执行目标与全量验证。

### 待决问题

- 无。需求契约已确认只影响尚未创建的 Review，且 Actor 来源限定为 Run 冻结快照。

## 功能实现摘要

### 修改文件与关键路径

- `src/run/store.ts`
  - Run v3 增加可选 `bindingChanges` 审计记录，旧 v3 无需迁移。
  - 新增 `buildRunBindingSnapshot` 与锁内原子 `updateRunSlotBinding`。
  - 从冻结 `procedureSnapshots` 推导合法 Slot/scope，复用启动期 Assignment/Decision Policy 校验。
  - 同步更新根 `plan`、活动 Procedure `stack` 与未来 `!call` 使用的 `reviewConfiguration`。
  - 已创建 Review 的修订轮次改为持续使用 Review 自己冻结的 control plane，避免换绑后下一轮偷偷换人。
- `src/cli.ts`、`src/commands/run.ts`
  - 新增 `run binding show` 与 `run binding update`；支持重复 `--actor` 或 `--skip`。
- `src/commands/view.ts`、`src/view/browser.ts`
  - 新增 Run binding GET/POST API 与 Task View 绑定面板、未来 scope 数量和历史。
  - POST 复用设置接口的同源检查；非 loopback View 还要求 operator token。
- `test/run-store.test.ts`、`test/artifact-review-view.test.ts`、`test/view-browser.test.ts`
  - 覆盖 Human→Agent、已有 Review 保留、skip、非法/重复/未知 Actor、决策能力不足、done Run、`!call`、API 原子失败和同源保护。
- `reserved-memory/**`、`.memsphere/memory/**`、`src/skills/memsphere/SKILL.md`、`README.md`
  - 同步运行期换绑语义、CLI 使用方式与“Actor/权限冻结、未来 Binding 可显式审计变更”的边界。

### 需求映射与行为影响

- Human 完成前序流程后可以从 View 或 CLI 把完整 Slot key 换绑给本次 Run 冻结的 Agent。
- 新绑定对同 Slot 的未来 Review scope 和尚未实例化子 Procedure 生效；已有 Review、Round、Assignment、Vote 和修订轮次不变。
- 换绑与 report/review mutation 共用 per-Run write lock，所有校验通过后才一次性写入配置、步骤快照和审计记录。
- 旧 v3 Run 缺少 `bindingChanges` 时继续读取和执行；现有 `run start --review-config`、Artifact Review 和 View 数据保持兼容。

### 采用的 Statement

- `memsphere 代码仓库需求规范`：保持既有 v3 Run、CLI 与 Review 数据向前兼容。
- `memsphere 代码仓库开发规范`：同步 Run/Review/View、System Memory 和 skill；未新增 YAML syntax。
- `memsphere 代码仓库测试规范`：补充成功、失败、兼容、权限与子流程边界测试，并执行目标与全量验证。

### 已执行测试

- `npm run typecheck`：通过。
- `npm test`：344/344 通过。
- `npm run build`：通过。
- `node dist/cli.js run binding --help`：通过，show/update 命令已注册。
- 目标测试：Run/CLI/Review 66 项通过；View/System Memory 99 项通过；最终新增目标集 103 项通过。
- `memsphere validate`：通过。
- `git diff --check`：通过。

### 未验证项与残留风险

- 未在真实外部 ACP Provider 账户上执行 Human→Agent 的生产 Run；Agent Assignment 派发沿用已有且已通过全量测试的 dispatcher 路径。
- View 交互通过 API、浏览器脚本有效性和静态行为测试验证，未新增独立 Playwright 视觉用例。

## 初始验证报告

### 验收标准检查

- Human→Agent：Run store 测试确认已有 Human Review/Assignment 保持不变，后续同 Slot Review 只创建 Agent Assignment。
- 原子与审计：成功换绑同时更新配置/步骤/审计；未知 Slot/Actor、重复 Actor、能力不足失败后持久化状态不变。
- 状态边界：支持多 Actor 与 skip；done/read-only 入口拒绝；已有 Review 的后续修订轮次继续使用 Review 冻结 control plane。
- 子流程：尚未实例化的 `!call` 子 Procedure 从更新后的 Run Binding 创建 Agent Assignment。
- 兼容：`bindingChanges` 为 v3 optional 字段；全量旧测试通过，现有启动、Review、Archive、View 行为无回归。
- CLI/View：构建产物注册 `binding show/update`；View GET/POST API、绑定面板、历史展示和同源/令牌保护通过测试。
- Memory/skill：Reserved Memory、当前开发 Memory、skill、README 已同步；Reserved Store 与 Memory schema 测试通过。

### 实际执行结果

- `npm run typecheck`：通过。
- `npm test`：344 tests，344 passed，0 failed，0 skipped。
- `npm run build`：通过。
- `memsphere validate`：通过。
- `git diff --check`：通过。
- 目标回归均通过：最终目标集 103/103，Run/CLI/Review 66/66，View/System Memory 99/99。

### 失败与阻塞分类

- 本轮代码/测试失败：无。
- 历史失败：无已知历史失败。
- 环境阻塞：首次 typecheck 因尚未安装依赖报 `tsc: not found`，执行锁定的 `npm ci` 后解决；首次沙箱内 `tsx` 因本地 IPC socket `EPERM` 被阻塞，按宿主权限流程重跑后通过。二者均未通过修改测试或降低验收标准规避。

### 未执行项

- 未连接真实生产 ACP Provider 账户做人工端到端操作；已有 fake ACP 与全量 Agent Review 测试覆盖派发协议。
- 未新增视觉快照测试；View 脚本、API 和现有浏览器/响应式全量测试均通过。

## 验收修订说明

- 修正 `affectedReviewScopes`：已创建 Review 的 scope 现在从“未来受影响范围”排除，并通过 `preservedReviewIds` 单独记录。
- `buildRunBindingSnapshot` 同样区分未来 scope 与既有 Review，避免 CLI/API/View 把冻结历史误报为将被改写。
- Task View 直接使用服务端 binding snapshot 展示未来 scope 数量，并另行展示保留的既有 Review 数量。
- 回归断言覆盖：完成首个 Human Review 后换绑，审计仅列出尚未创建的后续 scope，首个 Review 仍列入 preserved 集合。
- 修订后再次执行：`npm run typecheck` 通过，目标测试 103/103 通过，`npm test` 344/344 通过，`npm run build`、`memsphere validate`、`git diff --check` 均通过。

## 最终验收结论

- 实现与验证验收 Review `review-20260819-033836z-fff55781` 第二轮由研发、测试、项目负责人全部投票通过，阻塞与风险意见均为 0。
- Runner 已于 2026-08-19 接受验收结论；需求契约中的运行期换绑、历史冻结、原子校验、审计、CLI、View 与兼容性标准均满足。
- 非阻塞后续建议：补充 run-command 级 CLI 专项覆盖，直接断言 `run binding show/update` 的参数解析、text/JSON 输出和错误路径。
- 已披露残留：未使用真实生产 ACP Provider 做人工端到端操作，也未新增独立视觉快照；现有 fake ACP、API、浏览器脚本与全量回归已覆盖本轮交付路径。
