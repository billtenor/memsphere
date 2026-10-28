# 当前迭代需求契约

Run：run-20261027-134406z-6b0c9b5a

## 整体目标

自由探索 Agent 交付 Artifact 后，用户仍能反馈并要求修改；只有用户明确确认当前成果并同意结束，才结束 Run。区分 Agent 当前回复结束与 Run 进入只读终态。

## 当前迭代范围

1. 更新随包 Memsphere Skill 的自由探索规则：上报后保持 running，交付当前成果等待人工检查；反馈与修订沿用同一 Run。Agent 自认为完成、测试通过、用户沉默及局部认可都不能视为结束授权。
2. 用户明确确认当前交付成果并同意结束后，允许 Agent 代为执行 finish；已有清楚授权不重复追问。确认后修改的成果需要重新确认。
3. 原生 `run finish` 与自由探索 `continue <contextId> finish` 使用唯一参数 `--authorization <text>` 声明用户确认依据，必须为非空白文本。不提供文件输入形式，不保留本轮未发布的 authorization-note / authorization-note-file 名称。
4. 缺失或空白依据返回 HUMAN_CONFIRMATION_REQUIRED，不结束 Run、不关闭 CommandState；之后仍可反馈和修订。文本合法后按既有成果选择与结束逻辑执行。
5. View 继续使用现有人工确认对话框。保留 done / abandoned 只读、归档恢复只改变可见性的既有语义。
6. 同步 CLI Help、用户文档、Skill 与相关回归测试；按照正式敏捷流程完成方案、开发、验收与交付。

## 明确限制及后续范围

authorization 是调用者对真实用户授权的声明，仅校验非空，不验证真实对话、不提供身份隔离，不实现仅人工可调用的强制门禁。不将依据持久化到 Run；若需审计记录，应另行确认设计。

本轮不增加 waiting_confirmation 状态，不增加界面反馈编辑器或 Agent 自动唤醒，不重开历史终态 Run，不升级全局 CLI / Skill 或批量迁移项目。Procedure 的结束与正式 Review 代提交参数不受本次自由探索参数简化影响。

## 交付物

- 确认后的需求契约、实施与验证方案、开发计划及实现/验证/验收记录。
- 自由探索 CLI/Continue、随包 Skill、文档及回归测试的实现差异。
- 按流程交付 PR 和最新提交全部适用 CI 结果，等待 Human 合入及结果确认。

## 验收标准

- 自由探索 finish Help 仅提供 `--authorization <text>`，无本轮引入的两个旧参数；Continue 语义相同。
- 两个入口在缺失/空白授权时均拒绝结束；Run 为 running、CommandState 为 active，原成果保留。
- 拒绝结束后，可在原 Run 添加轻量反馈、提交 revisedFrom 修订版，提供授权后可将该修订版作为最终成果结束。
- 有效授权后保留现有成果根选择、done、Continue 关闭、终态只读及归档/恢复行为。
- Skill 清楚说明等待人工确认和继续修订规则；不把本参数描述成独立核实人工授权的安全边界。
- View 现有确认流程回归通过；无关 Procedure Review 的 authorization-note-file 不受影响。
- 构建与适用仓库回归通过；不以先前候选的测试代替本轮最终实现验证。

## 向前兼容

结论：不需要向前兼容。

当前 checkout 执行 `git tag --list '*stable*'` 未发现稳定 checkpoint Tag。authorization-note 与 authorization-note-file 仅存在于本聊天产生的未提交、未发布候选中，不形成兼容承诺。本次明确收紧自由探索 CLI：原先不带授权的 finish 将失败。保留已有 Run 数据结构、历史只读与归档语义；不修改 Procedure Review 参数。

## 采用的 Statement 与仓库规范

- statements/memsphere-repository-requirement-rules：明确当前范围与独立的向前兼容结论。
- statements/memsphere-exploration-artifact-rules：上报产物与选择最终成果为不同决定；反馈与完整修订分别记录。
- statements/memsphere-repository-git-rules：只提交确认范围的代码、可复用测试和必要文档，不提交临时日志截图，不强制添加忽略文件。
- statements/memsphere-repository-delivery-rules：完成验收后按规定归档；存在 Memory 差异时执行变更级校验。
- CONTRIBUTING.md、changes/README.md。

## 当前现场与待确认项

先前 Agent 未经方案讨论便修改的 6 个已跟踪文件及 change 记录均未提交、未发布，仅是候选；参数仍是旧名称，本轮尚未实施简化。无关 .playwright/ 保留，不纳入提交。

待产品负责人确认本契约是否接受“用户授权声明 + Agent 行为约束”作为本轮范围，特别是非空文本校验、不持久化、不做人工独占门禁的限制。用户已指定唯一参数名为 --authorization，不再将参数命名作为待决项。

## 后续评审记录

本契约第1轮已由Human产品负责人billtenor与产品Agent投通过，Runner通过并推进方案步骤。产品意见要求显式遵守仓库全量测试门禁、保留Human明确决定才可abandon的约束，已纳入implementation-plan.md和tasks.md；不改变本契约产品范围。原“待确认”段保留该版本提交时的现场，本轮确认已完成。
