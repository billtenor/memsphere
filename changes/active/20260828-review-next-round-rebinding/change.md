---
id: 20260828-review-next-round-rebinding
status: todo
type: feature
created: 2026-08-28
run_id: run-20260828-045125z-6db44ab3
---

# Review 下一轮应用运行期 Slot Binding

## 需求

扩展 Run 运行期 Review Slot 换绑能力：Runner 在一个 Artifact Review 已经创建后更新 Slot Binding，当前正在执行或已经结束的 Round 继续使用创建时冻结的参与者；同一 Review 后续新建 Round 应使用最新的显式 Binding，无需废弃并重启整个 Run。

典型场景是 Human 完成第一轮评审并要求修改后退出后续流程，Runner 将对应 Slot 换绑给 Run 启动时已冻结的 Agent Actor。修订后的 Artifact 再次上报时，应在同一个 Review 中创建由新 Actor 参与的下一轮，同时完整保留上一轮 Human 的 Assignment、Comment、Vote 和决策证据。

## 验收标准

1. Review 的当前 Round 已创建后更新其 Slot Binding，当前 Round 的 Assignment、参与者、权限、Comment、Vote 和结算不发生变化。
2. 当前 Round 要求修改后，Runner 修订并重新上报 Artifact；同一 Review 新建的下一 Round 使用更新后的 Slot Binding 创建 Assignment。
3. Review ID 保持不变，历史 Round 仍展示创建时冻结的参与者；新 Round 明确展示本轮实际 Binding 及其来源。
4. 连续多次换绑时，每个新 Round 使用其创建前最后一次成功提交的 Binding；已创建 Round 永不追溯改写。
5. Binding 更新与 Runner 投票、Artifact 重报和下一 Round 创建使用同一 Run 写锁或等价原子边界：更新先完成则下一 Round 使用新 Binding，Round 先创建则该 Round 保持旧 Binding，行为确定且可审计。
6. 新 Binding 只能引用当前 Run 启动时冻结的 Actor，并复用其冻结 Permission、Provider 和模型配置；Project 后续新增或修改的 Actor 不得静默进入现有 Run。
7. 更新前按同一 Review 的 Decision Policy 校验候选参与者能力；未知 Slot、未知或重复 Actor、空 Actor 列表、能力不足、done/abandoned/read-only Run 等情况必须拒绝且不产生部分写入。
8. 运行期换绑审计记录必须区分：保持不变的当前及历史 Round、从哪个 Round 起生效、实际受影响的 Review ID/scope，以及变更前后 Actor。
9. CLI 与 View 在更新前后明确提示“当前轮不变，从下一轮生效”；Binding 状态能够展示当前 Round 参与者与下一 Round 待生效参与者，避免把两者混为一谈。
10. Agent Reviewer 调度只派发新 Round 的新 Assignment；不得取消、接管或重复派发当前 Round 的既有 Assignment。
11. 自动化测试覆盖 Human→Agent、多 Actor、连续换绑、并发换绑/重报、能力不足、当前轮等待提交、等待 Runner 投票和历史证据不变。
12. `npm run typecheck`、针对性 Run/Review/CLI/View 测试、完整测试、`npm run build` 与 `memsphere validate` 全部通过。

## 范围

- 扩展现有 `run binding show/update` 核心语义、CLI 输出和 View 运行期绑定面板。
- 允许显式换绑影响已存在 Review 尚未创建的后续 Round。
- 在 Round 创建时冻结该轮实际 Control Plane；历史 Round 仍以自身快照为权威。
- 保存并展示 Binding 生效轮次、影响 Review 和历史保留范围的审计证据。
- 同步 Run/System Memory、内置 skill、README 和相关测试。

## 不做事项

- 不修改、撤销或转交已经创建的当前 Round Assignment。
- 不让换绑影响已经提交的 Comment、Vote、Round Result 或 Runner 决策。
- 不从 Project 当前配置动态引入 Run 启动后新增的 Actor。
- 不允许通过换绑绕过当前 Round 尚未完成的参与者或 Decision Policy。
- 本需求不设计跨 Run、跨 Project 或远程组织级评审人调度。
- 本需求不自动废弃或重启已有 Run。

## 关联需求

- 直接前置：`changes/archive/completed/20260819-runtime-review-slot-rebinding/change.md`。该需求已实现运行期 Slot Binding 更新，但明确规定已有 Review 的后续修订轮次继续使用 Review 冻结 Control Plane；本需求扩展这一生效边界。
- 基础模型：`changes/archive/completed/20260723-run-review-role-binding/change.md`，定义 Review Slot、Actor、Assignment 和 Decision Policy。
- 触发场景：Bug Fix Run `run-20260828-040831z-5d01ae74`。方案 Review 创建后将研发、测试 Slot 从 Human 换绑为 Agent，但下一轮仍固定给原 Human，实际暴露了必须重启 Run 才能交接的问题。
- 重复需求：无。

## 技术与测试方案

待开发前补充。方案必须明确 Run 级最新 Binding、Review 级身份和 Round 级冻结 Control Plane 的职责边界，并定义换绑与下一 Round 创建的锁内顺序、Policy 校验和审计模型。

## 开发任务

- [ ] 调查现有 Review 修订轮次复用冻结 Control Plane 的代码路径和数据模型。
- [ ] 设计下一 Round Binding 解析、校验、冻结和审计语义。
- [ ] 实现 Run store、Review 状态机和 Agent Assignment 调度调整。
- [ ] 更新 CLI、View API 与绑定面板的生效范围提示。
- [ ] 同步 System Memory、skill、README 和需求说明。
- [ ] 补充针对性、并发、历史不可变和完整回归测试。

## 验收结果

尚未开始。
