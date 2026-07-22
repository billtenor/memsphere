---
id: 20260722-artifact-review-process-usability
type: feature
created: 2026-07-22
completed_at: 2026-07-22
run_id: run-20260722-105244z-b43a1863
---

# Artifact Review 流程收敛与可用性改进

## 背景

在 `run-20260722-083210z-45c9a6ce` 的 Artifact Review 草稿冲突恢复需求中，最终“实现与验证验收材料”通过了 7 轮 Artifact Review。该过程证明多角色 Review 可以发现真实问题，但也暴露了流程体验和收敛机制的问题：

- Advisory reviewer 能抓到实际 bug，但也容易把边界风险统一标成 blocking。
- Runner 可以裁量，但当前产品交互和 CLI 提示会持续把 advisory `request_changes` 放大成强阻塞感。
- 修复 reviewer 指出的有效问题后，缺少“修复并验证后直接接受”的轻量路径，容易为了记录正确性继续开新 round。
- Agent session 环境失败混入 Review 轮次，造成额外等待、重试和认知噪音。
- Review 状态输出过长，用户和 Runner 很难快速判断“当前是否还能决策、真正剩下什么阻塞”。

本需求目标是让 Artifact Review 保留质量价值，同时更快收敛、更尊重 human/runner 的裁量。

另一个暴露出的关键问题是 Artifact 的语义过窄。当前 reviewer 容易把 Review 理解为“联合审查两个上报文档”，而不是审查完整迭代交付。如果 Artifact Review 要判断实现是否可接受，Artifact 必须包含 Implementation。也就是说，Artifact 不应只是文本结论，而应代表本轮迭代可独立审查的完整交付包。

详细证据见：

- `changes/archive/completed/20260722-artifact-review-process-usability/asserts/review-run-evidence.md`
- `changes/archive/completed/20260722-artifact-review-process-usability/asserts/review-experience-analysis.md`

### ACP Agent 启动失败根因

当前 `memsphere run report` 在创建 Artifact Review 后，会从 CLI 进程立即派发 detached Agent Review worker。worker 启动后通过 `src/acp/review-bridge.ts` 在 `/tmp/memsphere-review-*/bridge.sock` 调用 Node `net.Server.listen()`，为 Session-bound CLI 建立本地 Unix socket bridge。

当 `run report` 由受限 Agent/Codex 沙箱执行时，worker 会继承调用方的沙箱权限；该环境禁止任何 socket listen，包括 Unix domain socket。最小 Node 复现稳定返回 `EPERM: listen EPERM: operation not permitted .../bridge.sock`。因此首次 report 后 Agent Assignment 经常在读取 Artifact 前就失败。通过已在沙箱外运行的 View 服务重试时，worker 不再继承该限制，所以通常能够启动。

这不是 Artifact 质量问题，也不是简单的偶发 Provider 错误。当前项目处于高速迭代阶段，本轮不再继续建设 bridge 或独立 dispatcher：彻底下线 Review bridge，继续由 worker 通过环境变量向受信任的 ACP 子 agent 注入 Session-bound `MEMSPHERE_CLI` launcher、Run ID、Assignment ID、配置路径和工作区路径；子 agent 使用该 launcher 读取 Artifact、添加 comment 并提交 vote。它不会从 `PATH` 任意选择全局 CLI，launcher 必须固定到启动 worker 的同一份 Node 与 Memsphere CLI。ACP 本身继续使用 stdin/stdout JSON-RPC，不新增网络服务或常驻进程。

该简化方案明确接受权限边界变化：Agent Reviewer 不再是“只能通过 bridge capability 写自己的 Assignment”的最小权限主体，而是受信任的工程协作者。实现仍需通过 assignment ID、当前 round、identity、状态和原子 Store mutation 防止误操作与并发覆盖，但不为对抗恶意子 agent 建设额外隔离层。

## 当前迭代需求契约

### 整体目标

让 Artifact Review 在不降低 decision policy 安全底线的前提下，能够基于完整实现交付包发现真实问题，并由 Runner 对 advisory 意见进行可追溯裁量，在当前 round 内完成修复、验证和收敛。

### 采用的 Statement

- `Memory 访问规则`：通过 Procedure 和按需读取的 Memory 驱动本轮开发，不以 list 摘要代替完整规则。
- `memsphere 代码仓库开发规范`：本轮修改 Review 数据模型、状态流转、CLI、View 和 Procedure 行为时，同步更新 `reserved-memory` 源 Memory、当前工程安装副本及相关说明，并执行 validate 与相关测试。
- `memsphere 代码仓库测试规范`：先运行覆盖 Review Store、ACP Agent、CLI、Run、View 和 System Memory 的针对性测试，再执行 `npm run typecheck`、`npm test`、`npm run build` 和 `memsphere validate`；记录本轮实际命令、结果和未执行项，不使用历史结果替代当前验证。

### 当前迭代范围

- 完成 advisory severity、Runner disposition、环境失败分类和 hotfix accepted 审计能力的数据模型及兼容读取。
- 在 Review API/Store、CLI 与 View 中提供以“是否可决策、未处理 blocking、环境失败、decision votes”为中心的摘要和处置交互。
- 增加 `memsphere run review retry --review <review-id> --assignment <identity-or-assignment-id>`，无需借助 View API 即可重试失败的 Agent Assignment。
- 删除 Review bridge 及 Unix socket listener；保留环境变量注入的 Session-bound `MEMSPHERE_CLI` launcher，让 ACP 子 agent 使用同版本 CLI 完成 Artifact 读取、comment 和 vote 提交，从根因上消除 `listen EPERM`。
- 让当前 round 在 decision votes 满足且 blocking advisory 已处理后可直接收敛，不强制通过新 report 创建下一轮。
- 将实现类 Artifact Review 的输入升级为完整交付包，至少包含可识别的 Implementation artifact，并让 reviewer prompt、CLI 和 View 明确实现证据状态。
- 更新受影响的 System Memory、敏捷需求开发流程及自动化测试。

### 后续范围

- 不在本轮重写 Agent Provider 或 ACP 协议；ACP 继续走 stdin/stdout。Agent Reviewer 作为受信任工程协作者运行，不在本轮建设针对恶意子 agent 的细粒度 CLI capability、bridge 或独立 dispatcher。
- 不在本轮引入新的 decision policy，也不改变 Human、Runner 和 advisory reviewer 的权限边界。
- reviewer 自动分类的进一步智能化、跨 Review 的长期趋势分析和独立治理后台留作后续需求。

### 交付物

- Review severity、disposition、execution failure 与 hotfix 审计的数据模型和持久化兼容实现。
- Review Store/API、CLI、View 的摘要、详情和 Runner 收敛交互。
- 可从 CLI 使用的 Agent Assignment retry 命令，以及有即时状态反馈的 View Retry 交互。
- 已移除 Review bridge 的 Agent Review worker、环境变量注入的 Session-bound CLI 直连 Store 实现及相应迁移清理。
- Implementation artifact 的最低结构、生成/识别逻辑、reviewer 约束与缺失提示。
- 更新后的 Review/Procedure System Memory 和当前工程安装副本。
- 覆盖 Store/API、CLI、browser/View、兼容性与完整回归的自动化测试及验收材料。

### 待确认项

- 无。当前迭代按本文范围整体实施；如果实施调查发现需要改变 decision policy、安全边界或扩大到 Agent Provider/ACP，必须先更新本契约并由 human 重新确认。

## 需求

Artifact Review 应区分“真实阻塞”和“建议/风险提示”，并给 Runner 提供清晰、低摩擦的收敛动作。用户和 Runner 不应因为 advisory reviewer 的每个 `request_changes` 都被迫进入新一轮评审；当问题已被修复并完成验证，Runner 应能用明确动作接受当前结果，并在审计记录中保留修复说明。

Artifact Review 审查对象应从“若干文本 artifact”升级为“本轮交付包”。交付包必须包含 Implementation artifact，用来说明本轮代码实现、变更范围、关键 diff、行为影响和验证结果。Reviewer 如果没有审查 Implementation artifact，就不能给出“实现正确/可通过”的结论；如果 Implementation artifact 信息不足，应明确指出“实现证据不足”，而不是只基于需求契约和验收材料判断通过。

## 范围

- Artifact Review 状态流转、UI/CLI 摘要、Runner 决策交互。
- Human、Runner、advisory agent 的投票和意见呈现。
- Agent assignment 环境失败与正常 Review 意见的分离展示。
- Review round 的修后收敛路径和审计记录。
- Artifact Review 输入包结构，尤其是 Implementation artifact 的生成、展示和审查要求。
- 不改变现有 decision policy 的安全底线：最终是否接受仍由 decision roles 决定。

## 不做事项

- 不取消 advisory reviewers。
- 不让 agent advisory vote 直接覆盖 Human 或 Runner 的决策权限。
- 不降低后端对 Review、Run 和 Artifact 的持久化审计要求。
- 不在本需求中重写 Agent Provider 或 ACP 协议；环境失败只要求在 Review 流程中正确降噪和处理。

## 验收标准

- Review 状态页和 CLI 能优先展示：
  - 当前是否可由 Runner 决策。
  - 决策角色是否已全部投票。
  - 剩余真实阻塞项数量。
  - agent 环境失败数量和可重试动作。
- Advisory comment 必须有明确 severity，至少区分：
  - `blocking`：违反已确认需求、会导致数据丢失、权限/身份串写、验收失败或回归风险。
  - `risk`：可能有影响但未证明阻塞，可由 Runner 接受风险。
  - `suggestion`：改进建议，不阻塞验收。
- Runner 可以对 advisory 意见逐条标记处理结果：
  - `accepted-fixed`：采纳并已修复。
  - `accepted-followup`：采纳但转后续需求。
  - `rejected-out-of-scope`：范围外。
  - `rejected-not-blocking`：非阻塞。
  - `rejected-invalid`：判断不成立。
- 当所有 decision votes 已 approve，且 Runner 已处理所有 blocking advisory comment 后，Runner 可以完成当前 round 的 approve，不必强制重新 report 新 round。
- 如果 Runner 在当前 round 内热修，应能附带验证摘要和变更说明；Review 记录必须能追溯这些说明。
- Agent assignment 的 `listen EPERM`、provider 启动失败等环境失败，应在 UI/CLI 中与 reviewer 正常意见分开展示，不计入“代码/需求阻塞”摘要。
- `memsphere run review retry` 必须能按 review ID 和 identity/assignment ID 精确重试当前 round 的失败 Agent Assignment；非 Agent、非失败状态、错误 round 或歧义目标必须返回明确错误，不能误重试其他 assignment。
- View 的 Retry 按钮点击后必须立即展示 pending/queued/running 状态和新的 attempt 序号；请求失败或再次执行失败时应就地显示本次错误，不能只有无变化的 disabled 按钮或依赖全局弹窗。
- Agent Review worker 不得创建 `bridge.sock`、监听 Unix/TCP socket 或依赖 `MEMSPHERE_REVIEW_ENDPOINT`/bridge capability。它必须继续注入 `MEMSPHERE_CLI`、`MEMSPHERE_REVIEW_RUN_ID`、`MEMSPHERE_REVIEW_ASSIGNMENT_ID`、`MEMSPHERE_CONFIG_PATH` 和 `MEMSPHERE_WORKSPACE_ROOT`；其中 `MEMSPHERE_CLI` launcher 固定使用启动 worker 的同一份 Node 与 CLI entrypoint，ACP 子 agent 通过它完成 Artifact 读取、comment 和 vote 提交。
- Agent Reviewer 的运行权限必须足以让上述 CLI 更新 `.memsphere/runs`；需求明确接受其作为受信任工程协作者拥有工作区写能力。CLI 仍必须校验 review、round、assignment identity 和状态，并使用原子 Store mutation 防止并发覆盖。
- 自动化测试必须从 `run report` 的真实派发入口覆盖 Agent 直接运行 CLI 并提交的完整路径，证明首次 attempt 不再产生 `agent_session_failed: listen EPERM`；不得只通过沙箱外 View Retry 验证。
- 当同一类 advisory 问题连续多轮重复出现时，Review UI/CLI 应聚合显示，而不是每轮展开完整重复正文。
- Review 输出默认提供摘要视图；完整 artifact 内容和完整评论只在用户展开或指定 verbose 时显示。
- Human 明确表达“可以通过/不用全部采纳”时，Runner 决策区域应突出该信息，帮助 Runner 做裁量，而不是被 advisory `request_changes` 视觉上压过。
- 每个需要判断实现正确性的 Artifact Review 都必须包含 Implementation artifact，至少说明：
  - 本轮修改的文件列表。
  - 关键代码路径和主要 diff 摘要。
  - 实现如何对应需求契约。
  - 行为影响范围和兼容性影响。
  - 已执行测试命令、结果和未验证项。
- Reviewer prompt 和 UI 必须明确：Review 对象是完整交付包，不只是需求契约和验收说明。Reviewer 结论中如果声明实现通过，必须引用 Implementation artifact 或具体代码路径。
- 当 Implementation artifact 缺失或不足以判断实现时，Review 应显示为“实现证据不足”，不能被误呈现为完整实现已通过。

## 技术与测试方案

### 数据模型

- 为 Review comment 或 submitted opinion 增加 severity 字段，兼容缺省值。
- 为 Runner decision 增加 advisory disposition 列表，用于记录每条 advisory comment 的处理结果和说明。
- 为 agent assignment failure 增加分类摘要，不与 submitted review comment 混合。
- 定义 Implementation artifact 的最低结构，支持保存变更文件、关键 diff 摘要、需求映射、验证结果和未验证项。
- 删除 Review bridge transport；保留当前临时 CLI runtime 和 `MEMSPHERE_CLI` 环境变量注入，但 launcher 后的 CLI 根据注入的 Run、Assignment、config 和 workspace 上下文直接调用 Review Store。comment/submit 仍走现有 Store 校验和原子写入，不另建 IPC、daemon 或网络服务。

### UI/CLI

- Review 面板和 `run status` 默认显示 summary：
  - decision votes 状态。
  - advisory severity 统计。
  - unresolved blocking 列表。
  - environment failures 列表。
- 提供 `--verbose` 或展开入口查看完整 artifact/comment。
- Runner 投票时允许附带 disposition，或在投票前通过独立动作标记 advisory comment 的处理结果。
- CLI 提供 Agent Assignment retry；View Retry 在请求开始、排队、运行和失败时均有可观察反馈。

### 流程策略

- `artifact_acceptance.unanimous` 的 unanimous 仍仅约束 decision bindings。
- Advisory `blocking` 不直接否决，但未处理的 blocking 应在 Runner approve 前提示。
- Runner 可以用“hotfix accepted”方式在当前 round 记录修复和验证，并 approve。
- 创建 Artifact Review 时自动检查是否存在 Implementation artifact；对实现类需求，缺失时提示 Runner 补交或自动生成。
- Agent reviewer prompt 应把 Implementation artifact 列为必须审查对象；只审查文档一致性的 reviewer 不能宣称实现正确。
- `run report`、`run review wait`、View 轮询和显式 retry 共享一致、幂等的派发语义，不能因多个入口并发而重复 claim 或覆盖 attempt；移除 bridge 后仍保留原子 claim。

### 测试

- 实施过程中先运行受影响测试文件，至少覆盖 `agent-review`、`artifact-review`、`run-store`、`run-command`、View/browser 和 Reserved Store；新增能够从原入口复现 `listen EPERM`、Retry 无反馈以及 Review 收敛问题的回归测试。
- 单元测试覆盖 severity/disposition 的序列化和旧数据兼容。
- Store/API 测试覆盖：
  - advisory request changes 不阻塞 decision unanimous。
  - 未处理 blocking advisory 在 Runner approve 前给出明确提示。
  - Runner 标记 accepted-fixed 后可以 approve。
  - agent failure 与 submitted opinions 分离统计。
  - CLI retry 对 identity ID、assignment ID、非法状态和并发 retry 的处理。
  - 无 Review bridge 时从 `run report`、Agent 直接 CLI 操作到 submit 的完整路径。
- Browser/View 测试覆盖：
  - Review summary 默认不渲染完整 artifact 长文。
  - environment failure 可重试但不显示为代码阻塞。
  - Human approve 信息在 Runner 决策区可见。
  - 缺少 Implementation artifact 时，Review UI 明确提示实现证据不足。
  - reviewer 详情能展示其是否引用了 Implementation artifact 或代码路径。
  - 点击 Retry 后立即显示新 attempt 的 queued/running 状态，失败时显示对应 attempt 错误。
- 针对性验证通过后，必须实际执行 `npm run typecheck`、`npm test`、`npm run build` 和 `memsphere validate`。验证报告记录每条命令的本轮结果、环境失败和未执行项；任一必需命令失败时不得进入提需方验收。

## 开发任务

- [x] 定义 Review comment severity 与 Runner disposition 数据结构。
- [x] 更新 Review API/Store，兼容旧 review 数据。
- [x] 更新 agent review prompt，要求输出 severity，并说明 blocking 判定依据。
- [x] 更新 View Review 面板摘要和完整详情展开交互。
- [x] 更新 CLI `run status` 和 `run review wait` 默认摘要输出。
- [x] 增加 Runner 处理 advisory disposition 的命令或 UI 操作。
- [x] 区分 agent assignment environment failure 与正常 review 意见。
- [x] 增加 `memsphere run review retry` CLI，并与 View Retry 共用 Store/dispatch 逻辑。
- [x] 下线 Review bridge 和 socket listener，保留环境变量注入的 Session-bound `MEMSPHERE_CLI` launcher并改为 CLI 直连 Store，补真实入口回归测试。
- [x] 为 View Retry 增加即时 pending/queued/running/failed 反馈和浏览器交互测试。
- [x] 增加 hotfix accepted 审计记录和当前 round approve 路径。
- [x] 定义并生成 Implementation artifact，纳入 Artifact Review 输入包。
- [x] 更新 reviewer prompt，要求审查完整交付包并引用 implementation/code evidence。
- [x] 在 UI/CLI 中展示 Implementation artifact 缺失或证据不足状态。
- [x] 补齐 Store/API/browser 测试。

## 验收结果

实现完成，Artifact Review 全票通过，提需方已于 2026-07-22 验收通过。

- Review model、Store、API、CLI 和 View 已支持 severity、blocking disposition、环境失败分类、跨轮重复意见聚合及当前 round 收敛。
- Review bridge 和 socket listener 已删除；Agent Reviewer 使用注入的同版本 `MEMSPHERE_CLI` 直连 Store，真实派发入口回归通过。
- Procedure Artifact 已支持 `review_role` 与 `review_requires`；Review submission 会保存自包含的 requirement/implementation/validation/review-material 证据包，并在 CLI/View 显示证据状态。
- Reviewer prompt 要求审查 Implementation/code evidence；CLI/View 会显示每位 reviewer 是否引用了实现证据。
- View Retry 提供即时 queued/running/failed 与 attempt 反馈，Human decision intent 在决策区域突出显示。
- `npm run typecheck`：通过。
- `npm test`：通过，274/274。
- `npm run build`：通过，并确认 `dist/acp/review-bridge.js` 不存在。
- `node dist/cli.js validate`：通过。
- 未验证项：无。
