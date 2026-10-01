---
id: 20260902-runner-delegated-human-review
type: feature
created: 2026-09-02
completed_at: 2026-09-03T10:20:05+08:00
run_id: run-20260902-064608z-039f59f2
---

# Runner 受 Human 授权代提交 Artifact Review

## 需求

Human 已在与当前 Run Runner 的对话中给出评审意见并明确要求正式提交时，Runner 应能一次性把有序 Comments、Vote 和可选 Summary 提交到该 Human 自己的当前 Artifact Review Assignment，避免 Human 再到 View 重复录入同一批意见。

该能力表示“Human 作出评审决定、Runner 受托执行提交”。意见和 Vote 仍归属于 Human Actor；Runner 不是该 Review Actor，也不能根据普通讨论、建议、问题陈述或沉默自行推断授权。

## 范围

- 增加 Runner 专用的 delegated Human Review submit CLI，显式指定 Review、当前 Round、目标 Human Actor/Assignment、Vote、结构化 Comments 和非空授权说明，支持可选 Summary。
- 原子校验并提交完整 Opinion；沿用现有 Comment severity、anchor、Submission digest 和 Vote 规则。
- 同时校验目标 Human Assignment 权限和 Runner 冻结的 `decision.decide` 权限。
- Opinion 保留 Human 业务归属，并额外记录 Runner 代提交 provenance、授权说明和 Runner 授权判定。
- 相同 payload 重试幂等；不同 payload、非当前 Round、非 Human Assignment、非空 Human View Draft、权限不足和并发冲突均 fail closed，不产生部分写入。
- 不替代 Review 全员完成条件和后续 Runner 最终 Vote。
- CLI、公共 Review payload 和 View 展示直接提交与 Runner 代提交的区别。
- 同步统一 `memsphere` Skill、System Memory、当前开发 Project Memory 副本和相关测试，使 Agent 能发现并安全使用该能力。
- Review 进入 pending 后，CLI 按当前轮未完成 Assignment 的 Actor 类型输出下一动作：存在 Human 时使用 Run 冻结语言提示 Runner 收集三选一投票和条件 Comment；在当前代提交语境中，完整无歧义的“我投……”等执行性表达直接构成本次授权，仅含糊或不完整时追加确认；只有 Agent 未完成时才只提示 wait。该判断覆盖 `run report`、`run review wait` 和 `run status`。

## 范围变更与 Human 重新确认

本节是对本 Run `flow[1]` 冻结需求契约中授权触发条件的显式补充契约。原契约要求 Human 同时明确表达“提交到 Review”和给出决定；验收过程中 Human 指出，在 CLI 已经明确当前 Review、Round、Human Assignment 与 Runner 代提交语境后，“我投通过／要求修改／弃权”本身已经是要求执行当前投票的确定性表达，再要求一次同义确认会造成重复授权。

经 Human 与 Runner 讨论并明确同意后，当前迭代把触发条件收敛为：

- 在已经明确当前 Review、Round、目标 Human Assignment 和 Runner 代提交语境时，Human 给出完整、无歧义的确定性投票表达，且 Vote、必需 Comment 与引用内容均完整，该表达同时构成评审决定和本次代提交授权；Runner 直接提交并记录 authorization note。
- 普通讨论、意见分析、倾向性表达、沉默、目标不明确、必需 Comment 缺失、引用意见不唯一或 payload 尚未完整时，仍不构成授权；Runner 必须补全信息，必要时复述完整 payload 后取得确认。
- 本次补充只调整对话中授权意图的判定，不放宽 Human/Runner 双重权限、当前 Round/Submission、Human Assignment、Draft 冲突、原子提交、审计 provenance、幂等与并发边界，也不赋予 Runner 自主决定 Vote 的权力。

Human 确认与真实验收证据：Human 在对话中明确表示同意上述调整，并以“要求修改”要求落实；修订后又在同一 Review 的连续轮次中分别使用“要求修改”“弃权”和“通过”的确定性表达，由 Runner 直接代提交且不进行业务同义二次确认。第 6 轮 Human 对包含该行为及完整安全边界的交付报告投票通过。该补充契约与验收标准第 10 条共同构成对 `flow[1]` 对应条款的已确认修订，其余冻结契约继续有效。

## 不做事项

- 不提供宿主签名或密码学可验证的对话授权凭证。
- 不引入 Runner 登录会话、稳定 caller id 或 Run-bound capability；`--run` 只限定目标对象，不认证调用进程身份。
- 不自动抽取任意对话、批量代办多个 Human/Review，或跳转到原始对话消息。
- 不代替 Procedure 普通 Human Action，不修改 Decision Policy、Permission Catalog、Review Slot Binding 或 Memory YAML syntax。
- 不撤销、修改或覆盖已经正式提交的 Review。

## 验收标准

1. Human 明确授权后，Runner 能用一次命令为当前 Human Assignment 提交两条有序 Comment、`request_changes` Vote 和 Summary；View/CLI 显示 Vote 属于 Human，并显示 Runner 代提交 provenance 与授权说明。
2. Human 无需再进入 View；其他 Assignment 完成后，Review 按既有规则进入 `awaiting_runner_vote` 或结算。
3. `approve` 可无 Comment；`request_changes`、`abstain` 无 Comment失败；severity、anchor 和 Submission digest 校验保持不变。
4. Runner 或 Human 权限不足、目标为 Agent、Round 非当前或只读、Human Draft 非空时均拒绝且无部分写入。
5. 并发直接提交与代提交只有一个成功；相同代提交重试幂等，不同 payload 冲突。
6. 旧 Run/Opinion 无迁移可读；现有 Human View、Agent Reviewer、Runner 最终 Vote 和 Review 结算回归通过。
7. Skill 与 System Memory 明确要求只有 Human 显式要求正式提交时才调用；干净 Agent 上下文正向发现并执行，未授权讨论不写 Review。
8. 最终通过 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`、相关定向测试，以及最终 Memory 的 `memsphere memory change validate [change-id]`；记录 ChangeSet ID、校验状态和 View 入口。
9. 中文 Run 输出使用中文说明“通过／要求修改／弃权”，准确说明 Comment 条件和最终授权；Human-only、Agent-only 与 Human/Agent 混合场景返回可推进流程的不同下一动作，英文 Run 保持对应英文引导。
10. CLI 已建立当前 Review/Round 与 Runner 代提交语境时，“我投通过”“我投要求修改”“我投弃权”等确定且 payload 完整的表达直接触发代提交，不再次询问同义授权；倾向性表达、目标含糊、必需 Comment 缺失或引用意见不唯一时仍要求补全或确认。

## 向前兼容

结论：不需要向前兼容。

当前仓库没有名称包含 `stable` 的 Git Tag，不存在需求规范定义的稳定 checkpoint。作为当前版本回归要求，新增持久化字段仍必须可选，旧 Run 无迁移可读，现有 CLI/API/View 行为保持可用。

## 适用规范与 Memory

- `statements/memsphere-repository-requirement-rules`：明确向前兼容结论和验收范围。
- `statements/memsphere-repository-development-rules`：遵循避免过度设计、System Memory 同步、Review 模型变更和 Project 预置安装要求；更新 `memsphere-procedure`，检查 `memsphere-framework`、相关教程与 Skill。
- `statements/memsphere-repository-testing-rules`：覆盖 Review/CLI/View/Reserved Store 成功与失败路径，完成完整门禁和 Memory ChangeSet 证据。
- 直接更新：`memsphere-actor`、`memsphere-artifact-review`、`memsphere-procedure`、`memsphere-yaml-syntax-rules` 和统一 Skill。
- 检查后按实际语义决定是否更新：`memsphere-run`、`memsphere-framework`、`memsphere-view`、`memsphere-tutorial-chapter-03` 与其 Review experience Procedure。
- 本轮不新增 System Memory，因此原则上不改 manifest 路径清单；若实施中新增、重命名或删除 Memory，必须先更新契约，再同步 manifest 与 Reserved Store 测试。

## 关联需求

- `20260720-artifact-review-human-loop`：Human Assignment、Vote、Draft 和 Runner 最终 Vote 的基线。
- `20260720-artifact-review-agent-acp`：Agent Reviewer 只能提交自己 Assignment 的身份边界；本需求不放宽该入口。
- `20260819-runtime-review-slot-rebinding`：明确既有换绑不接管当前 Human Assignment；本需求新增的是 Human 保持决策主体时的受托提交，不重建 Assignment。
- `20260722-agent-review-runtime-hardening`：包含 Agent Reviewer 批量原子提交需求，但对象和权限边界不同，不与本 Human delegated submit 合并。
- 重复需求：无。

## Memory ChangeSet 闭环

- 实施时修改 `reserved-memory/system-memory/` 源文件，并用 `memsphere memory edit` 取得当前开发 Project 的对应 Memory 副本路径后同步修改。
- 对最终 Memory 内容先执行 `memsphere validate`，再执行 `memsphere memory change validate [change-id]`。
- 功能实现摘要、验证报告、交付报告和 commit 前检查均记录同一个最终 ChangeSet ID、校验状态和稳定 View 入口；Memory 内容继续变化时重新校验，不使用过期 checkpoint。
- 当前 Embedded Memory ChangeSet：`change-20260902-115404752z-b3696ed4`；最终内容校验通过，View 入口：`http://0.0.0.0:30000/projects/memsphere/changes/change-20260902-115404752z-b3696ed4`。Memory 若继续修改必须重新生成 checkpoint。

# Syntax 关键字变更

本轮不新增、重命名或删除任何 Memory YAML syntax 关键字。

## 技术与测试方案

### 现状与边界

- `src/run/store.ts` 的 Human View 提交分成 `updateArtifactReviewDraft` 与 `submitArtifactReviewAssignment`，依赖 Round revision；Agent Reviewer 通过受 ACP Session 绑定的 `submitArtifactReviewAgentAssignment` 只能提交自己的 Assignment；Runner 最终票由 `submitArtifactReviewRunnerVote` 独立处理。
- `ArtifactReviewSubmittedOpinion.authorization` 保存目标 Actor 的授权判定，公共 View payload 刻意隐藏内部 authorization；当前没有“业务意见归 Human、执行提交者为 Runner”的 provenance。
- Review mutation 已统一使用 `withRunWriteLock` 和原子 `writeRun`；delegated submit 复用同一锁、Comment normalization、Vote 构造和 `settleArtifactReviewRound`，不建立第二套 Review 状态机。
- 当前 Runner 拥有 `decision.decide`，目标 Human Assignment 按 binding 需要 `decision.decide` 或 `decision.assess`。本轮复用这两层冻结权限，不新增 Permission。

### 数据模型与领域操作

- 为 `ArtifactReviewSubmittedOpinion` 增加可选 `delegation`：固定 `kind: runner`、与承载 Review 一致的 `runId`、与目标 Assignment 一致的稳定 `humanActorId`、非空 `authorizationNote` 和 Runner `AuthorizationDecision`。旧记录缺省表示直接提交，无迁移。
- 新增 `submitArtifactReviewHumanAssignmentForRunner`，输入当前 Run、Review/Round/Assignment、Vote、Comments、可选 Summary 和授权说明；按 runId 锁定并从该 Run 内定位 Review，不使用全局 Review 查找。
- 锁内先按 runId 定位 Review/指定 Round/Assignment 并要求仍为 currentRound；已存在完全相同 delegated Opinion 时在运行状态与 pending 写门禁前只读幂等返回。只有首次写入才依次校验 Run running、Review/Round 为当前 pending、目标为 Human、目标 Draft 无 Comment/Vote、目标 Actor 权限、Runner `decision.decide`、Vote/Comment、severity 与 anchor/submission digest。
- 正常化全部 Comments 后一次写入 Submitted Opinion 和 Actor Vote，再调用既有结算函数；任何校验或结算失败不落部分状态。
- 已由 Runner 代提交且 runId、humanActorId 与语义 payload 完全相同则幂等返回，即使首次结算已进入 `awaiting_runner_vote`、`changes_requested`、`passed` 或 Run done/abandoned；只读返回不得改变 revision、Vote 或 Comment。已经产生后续 Round 的历史 Round、Human 直接提交、Run/actorId 不同或 payload 不同则冲突。比较忽略服务端生成的 Comment id/时间，只比较 Run、目标 Human、Vote、Summary、授权说明、Comment body/severity/anchor 的有序语义值。
- 修改既有 Human View `submitArtifactReviewAssignment`：直接提交的原有重试仍幂等；若已提交 Opinion 含 Runner delegation，则抛出专用 submission conflict，并由 View API 映射为 HTTP 409。反向顺序 delegated 遇到直接 Opinion 同样冲突；共享 Run lock 保证真实并发只有一个调用成功。

### Runner 调用者信任边界

- 当前 Runner 是权限类别，不是带稳定 Actor id、登录会话或 Run-bound capability 的已认证调用者；现有 `run report`、`run review vote` 与本命令共享本地 CLI 信任边界。
- `--run` 标识目标对象 namespace，并要求 Review/Round/Assignment 属于该 Run；持久化的 `delegation.runId` 用于 provenance 与审计。它们不认证发起进程就是当前对话的 Runner。
- `authorizationNote` 是 Human 明确授权的审计声明而非密码学证明。Skill 只允许在当前对话关联 Run 中，且 Human 明确要求正式提交并给出 Vote 意图时调用。
- 掌握目标 Run 全套有效 ID 且已有本地 CLI 权限的恶意进程无法在本迭代被机械区分；宿主签名授权或 Run-bound capability 属于后续范围。本迭代不增加调用者可自行伪造的环境变量、token 或 caller id。

### CLI 与 View

- 新增 `memsphere run review submit-for-human`：必需 `--run`、`--review`、`--round`、`--assignment`、`--vote`、`--comments-file`（严格 JSON array）、`--authorization-note|--authorization-note-file`；可选 `--summary|--summary-file`、`--output`。
- comments file 每项只接收 body、severity 与可选 anchor；拒绝缺失文件、未知结构、空 body和冲突来源。`approve` 无意见时仍必须显式传 `[]`，Human 的 `request_changes/abstain` 仍要求 Comment。
- 输出 reviewId、roundId、assignmentId、actorId、vote、commentCount、summary、delegation 与 Review/Round 状态，不输出私有完整授权对象。
- `publicArtifactReviewOpinion` 只公开安全 provenance：`delegatedBy: runner`、`runId`、目标 `humanActorId` 与授权说明；Run 内部 Runner authorization 继续只在 Store 审计。
- `modules/org.memsphere.run` 在已提交意见中显示“Runner 受托提交”标记和授权说明；Human 直接提交、Agent Reviewer 与 Runner 最终票显示不变。该展示补充浏览器驱动测试。

### Skill 与 System Memory

- 同步 reserved 源与 `.memsphere/memory` 中的 `memsphere-actor`、`memsphere-artifact-review`、`memsphere-procedure`、`memsphere-yaml-syntax-rules`，并更新 `src/skills/memsphere/SKILL.md` 的命令、明确授权触发、冲突处理和成功回报。
- 已检查 `memsphere-run`、`memsphere-framework`、`memsphere-view`、第三章教程与 review-experience：它们描述 Runner/Reviewer/View 的总体边界或刻意教授 View 体验，不要求把所有可选提交方式列入；只要实现未改变这些既有陈述，就记录无需修改，不机械扩散文本。
- 现有 Memory identity/path 不变，因此 manifest v4 install 清单不变；Reserved Store 测试仍验证源与安装副本。

### 验证方案

- Store：增加不含 `delegation` 的旧格式持久化 Run/Opinion fixture（`submitted` 仅含既有 comments/vote/summary/submittedAt/authorization），经真实 `readRun` 和 strict schema 解析并保持原业务值；另覆盖成功代提交、Human/Runner 权限拒绝、Agent 目标、非当前/只读 Round、非空 Draft、无 Comment 的拒绝票、anchor 失配、awaiting_runner_vote/changes_requested/passed/Run done 后相同重试、历史 Round和不同重试、run/review 对象归属不一致、delegated/direct 两种顺序与真实并发、direct/direct 原有幂等、结算/Runner 最终票；对象归属测试不声称提供调用者身份认证。
- CLI：必填 run/comments file、参数互斥、严格 JSON、授权说明必填、`approve` + `[]`、成功 text/JSON 输出、错误不写 Store。
- View/API：同一旧格式 fixture 经相应 View API/public projection 读取成功，内部 authorization 不泄露且继续按 Human 直接提交显示、不出现 delegated provenance；新格式公共 provenance 可见但内部 authorization 不泄露，直接提交无错误标记；delegated 先赢后直接 submit 返回稳定 HTTP 409，浏览器刷新为已提交只读状态；Run Module 浏览器测试验证中英文标记和授权说明。
- Memory：定向语义测试、`test/reserved-store.test.ts`、`memsphere validate` 与最终 `memsphere memory change validate [change-id]`。
- 完整门禁：先显式运行至少覆盖 `test/artifact-review.test.ts`、`test/artifact-review-view.test.ts`、`test/artifact-review-browser.test.ts`、`test/builtin-run-view.test.ts` 的受影响测试，并单独记录旧 fixture 的 `readRun`/View 投影结果，再执行 `npm run typecheck` → `npm test` → `npm run build` → `memsphere validate`；前端交互使用 playwright-cli 或等价仓库浏览器集成测试实际操作确认。
- 人工场景：本 Run 后续新建的交付报告产品负责人 Review 中，由 Human 在当前对话明确授权后使用本 worktree CLI 真实代提交；记录 provenance、后续 Runner vote，并对比操作前后的历史 Round digest，确认既有 Round 未变。

## 开发任务

- [x] 扩展 Opinion provenance schema/type/public projection。
- [x] 实现锁内 delegated Human submit、双重授权、Draft 冲突与语义幂等。
- [x] 增加 `submit-for-human` CLI 和严格文件输入/输出。
- [x] 更新 Run Module provenance 展示与双语文案。
- [x] 同步 Skill、System Memory reserved 源和当前 Project 副本，创建并验证 Memory ChangeSet。
- [x] 增加 Store、CLI、View/API、浏览器、Reserved Store 与 Agent 行为测试。
- [x] 完成最终定向与全量自动门禁并记录验证结果。
- [x] 在交付报告 Review 中取得 Human 明确授权后，执行当前 Run 的真实代提交人工场景并记录结果。
- [x] 根据 Human 验收意见，补充 `run report`、`run review wait`、`run status` 的 Human 投票下一动作和 Skill 对话编排，并覆盖中英文与参与者状态矩阵。
- [x] 根据第 3 轮 Human 验收意见，将明确执行性投票与本次代提交授权合一，并保留含糊或 payload 不完整场景的确认门禁。

## 验收结果

- 已通过 Store 定向验证：两条有序 `request_changes` Comment、Summary、双重 authorization/provenance、非空 Draft、空拒绝票、Human/Runner 权限拒绝、Agent 目标、结算后与 Run done 后同 payload 幂等、不同 payload/direct 冲突、旧格式 `readRun`。
- 已通过 View/API 与真实浏览器验证：安全 delegation projection、内部 authorization 不泄露、direct submit 稳定 HTTP 409、旧格式按 Human 直接提交显示、Run Module 英文标记与授权说明。
- `test/runner-delegated-review-cli.test.ts` 使用隔离 Embedded Project/Run，以真实 Node 子进程执行构建后的 `dist/cli.js`，覆盖 JSON `request_changes`（两条有序 Comment、Summary/note 文件）、text `approve`（空 Comments）、stdout/退出码、持久化 provenance，以及失败无写入；handler 层继续覆盖 note 缺失/互斥与 Store 冲突。`pretest`/`pretest:ci` 显式构建生产入口并保留原测试脚本契约；从无 `dist/` 状态完整执行 `npm run test:ci` 通过。
- direct/delegated 真实并发回归强制覆盖 direct-first 与 delegated-first 两种获锁顺序，均验证恰一成功、稳定 conflict、最终单一 Vote/Opinion 且 Draft/Run 状态不被覆盖；定向竞态连续运行 10 次稳定通过。
- persisted delegation 的三个文本字段均要求非空；`parseRunState` 进一步拒绝 `runId` 与外层 Run、`humanActorId` 与外层 Assignment 不一致的损坏 provenance，并由三类 corrupt-run fixtures 覆盖。
- 最终门禁：`npm run typecheck`、`npm run build`、`git diff --check` 通过；最终 `npm test` 与无 `dist/` 起步的 `npm run test:ci` 均为 510 tests、509 passed、0 failed、1 个既有 Windows-only skip。Memory ChangeSet `change-20260902-115404752z-b3696ed4` validate 通过，最终 digest `e87c0f7699e4fed7ce1122c5c748d5073c94bd0ab2c4a78cbbb7801c94fca9c2`。
- 当前敏捷 Run 的真实 Human 授权代提交场景已完成：Human 在对话中确认 `request_changes`、一条测试 Comment、Summary，并明确授权 Runner 正式提交；当前 worktree 的 `dist/cli.js` 返回 `delegatedBy: runner`，Review 进入 `awaiting_revision`。
- 内部 Store 核对 Human Assignment 已提交、业务 Vote/Comment/Summary 归属 `actor5`，delegation 记录 `kind: runner`、当前 Run/Human 与 Runner authorization；当前构建产物启动的 View 公共 API 仅公开安全 provenance 与授权说明，不泄露内部 authorization。
- 对比 `/tmp/runner-delegated-human-review-historical-round-baseline.json` 冻结的 10 个历史 Round，10/10 digest 匹配、0 mismatch，确认真实代提交未改写历史 Review。
- 第 2 轮 Human 验收意见已完成：CLI 现在按未完成 Assignment 的 Actor 类型生成 `human_vote` 或 `wait` 下一动作；`run report`、`run review wait`、`run status` 均覆盖 Human-only、Agent-only 和混合状态。中英文 Prompt 明确三种票型、Comment 条件、payload 复述与最终授权；`submit-for-human` 成功回执也按 Run 语言本地化并附带结构化下一动作。
- 第 3 轮 Human 验收真实验证暴露了重复授权：Human 明确说“我投通过”后，旧 Prompt 仍要求同义二次确认。修订后的 CLI Prompt、Skill 与 System Memory 使用上下文条件区分确定执行性投票和倾向表达；本轮“这次我投要求修改”已直接代提交并留下 authorization note，未再追加确认。
- 第 6 轮 Product Reviewer 指出 `flow[1]` 冻结契约未显式记录上述授权模型调整。已补充“范围变更与 Human 重新确认”契约，明确原条款、修订后的触发条件、未放宽的安全边界，以及 Human 讨论确认和连续三种票型的真实验收证据；该补充与验收标准第 10 条共同形成可审计的需求变更闭环。
- 需求记录已再次完成收尾：移除 active status、写入最新 `completed_at`，并归档至 `changes/archive/completed/20260902-runner-delegated-human-review/`。
