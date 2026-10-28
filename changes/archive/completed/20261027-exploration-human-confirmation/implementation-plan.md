# 实施与验证方案

Run：run-20261027-134406z-6b0c9b5a。依据需求契约第1轮：Human、产品Agent均通过，Runner已通过。产品的两条非阻塞意见均采纳为本步骤的明确执行约束，不改变产品范围。

## 采用规范

已读取 statements/memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-requirement-rules、memsphere-exploration-artifact-rules、memsphere-repository-git-rules、memsphere-repository-delivery-rules，以及 CONTRIBUTING.md 与 changes/README.md。采用适度复杂度、同步System Memory与Skill、真实边界集成测试、全量回归和变更级Memory校验要求。

## 实际代码与实现路径

- `src/commands/context-control.ts` 的 Options 和 registerExplorationCommands 注册自由探索 finish；tryContextCommand 在解析具体 Run 后执行结束。将本轮候选的 authorizationNote/authorizationNoteFile 合并为 authorization?: string，仅注册 `--authorization <text>`。在调用 s.finish 前检查 `o.authorization?.trim()`，缺失/空白抛 HUMAN_CONFIRMATION_REQUIRED，提示等待用户确认并记录授权。保留原成果根选择和结束后 closeRunCommandStates 路径。不能将参数注册为 Commander 的 requiredOption，因为需返回领域错误且要在两个入口保持一致。
- `src/commands/continue.ts` 复制原生命令选项并调用同一业务处理器，finish 的允许列表只保留 artifact、authorization、output。无需新协议或单独文件读取路径。
- `src/context_control/service.ts` 的 finish 和 Run 模型保持不变；HTTP View finish 仍使用既有人工确认对话框。非空授权是CLI调用者声明，不是服务层的身份验证、审计存储或版本签名。显式空成果、重复结束与终态规则沿用既有实现。
- `src/skills/memsphere/SKILL.md` 保留交付后开放、反馈继续同Run、修改后重新确认、明确授权不重复追问，以及等待确认时不能自动 finish/abandon；示例唯一参数改为 authorization。保留 Procedure 正式Review的 authorization-note-file，参数简化只作用于自由探索。
- 更新 `docs/context-control-exploration-cli.md` 和 `docs/context-control-delivery-report.md` 的命令和限制说明。
- 按System Memory同步规范，在已有 `reserved-memory/system-memory/statements/memsphere-exploration-artifact-rules.yaml` 补充结束与反馈规则，并在已有 `concepts/memsphere-run.yaml` 补充自由探索上报不等于结束、人工确认后结束的定义；同步当前 Embedded worktree 的 `.memsphere/memory` 对应副本。无新增/重命名Memory，因此manifest不变。通过 memory edit 取得合法编辑入口，最终执行变更级校验。已有 Procedure Concept 将自由探索语义委托给 memsphere-run，本次不改Procedure流程、YAML或Schema，无相关契约差异。

## 测试设计

当前候选将人工确认测试混入归档和读取测试，最终实现会拆分出以“授权缺失拒绝且保持可修订”为主要契约的CLI集成测试，非被测前置条件优先由 service/helper 构造。检查原生与Continue两个真实CLI入口的缺失/空白授权、有效授权和旧参数拒绝；校验错误码、Run和CommandState状态、原成果不变，验证之后可反馈、revisedFrom修订并授权结束。已有归档测试只补有效授权参数，保留原契约。

Help 检查唯一支持 authorization，无 note/file 两个候选旧参数；Procedure Review Help 仍保留其既有参数。Skill与System Memory的一致性检查明确保留等待人工确认、不自动abandon的指引。既有生命周期/归档/View测试覆盖结束后只读和人工View确认行为，无前端交互变更。

## 验证门禁及证据

1. `npm run build` 构建最终CLI；先执行受影响的 context-control-cli、context-control-lifecycle、context-control-view、context-control-view-browser、skill-command 和 reserved-store 测试。修改Run语义按规则运行 run-store、run-command 相关套件。
2. `npm run typecheck`、`npm test`（全量）、`npm run build`、`memsphere validate` 必须通过；另外最终 Memory 执行 `memsphere memory change validate [change-id]`，记录ID、checkpoint、校验状态与View入口。源与开发副本对比一致，修改后重新校验。
3. 记录本轮实际命令、结果、未执行项以及失败归因；不能使用流程前候选的测试作为本轮通过依据。
4. Sandbox限制监听本机端口或托管Project写入时，通过宿主审批在沙箱外执行相同命令；不更改产品逻辑绕过失败。日志留在 /tmp 或 Run，不提交原始测试证据。

## 开发任务与交付边界

在当前保留候选的worktree创建 codex/ 前缀迭代分支；修改CLI/Continue、指引和文档、两个Memory源及开发副本、测试；执行验证；提交实现摘要和验收材料。交付须经产品负责人Human评审，再commit/PR并跟进最新head全CI，最终由Human合入确认。本轮不升级全局CLI/Skill、不改历史终态Run、不新增UI反馈入口或授权持久化。

## 风险与兼容

授权可由Agent编造，技术上仅防止未声明授权的误调用；这是需求已明确接受的边界。删除两个未发布候选参数，无兼容别名。已有无授权自由探索 finish 调用将拒绝，需按新指引传授权；Procedure Review 参数不变。未发现 *stable* Git Tag，沿用需求契约“不需要向前兼容”结论。无 syntax 关键字、Run schema、存储结构或状态迁移变更。
