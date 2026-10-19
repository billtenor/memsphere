---
id: 20261019-actor-settings-ux
type: enhancement
created: 2026-10-19
completed_at: 2026-10-19
run_id: run-20261019-033517z-efbcea22
---

# 当前迭代需求契约

## 整体目标
优化设置中心的参与者配置：名称可选，未填写名称时使用参与者 ID 展示；人类型禁止配置系统提示词，避免误填。

## 当前迭代范围
1. Human 与 Agent 的名称均为选填。省略、空字符串和纯空白名称均按未填处理；填写有效名称时保持原有显示行为。
2. 所有需要展示参与者名称的位置（含设置标题、选择器、评审和流程输出）在名称未填时显示该参与者 ID，配置保存并重新加载后行为一致。
3. Human 禁止填写或配置 system_prompt。界面移除该输入项，配置校验拒绝 Human 携带 system_prompt（包括空字符串和纯空白），不能只隐藏界面或改成选填。切换为 Human 时删除草稿中的 system_prompt，避免残留误提交。
4. Agent 继续展示系统提示词，保持原有可省略、显式空白值无效的校验与运行用途。
5. 同步必要的用户说明、System Memory 与有针对性的验证。

## 后续范围
无本轮已识别后续需求；不扩展权限、Provider、角色绑定或评审策略功能。

## 交付物
代码及必要测试、同步说明、实施与验证方案、开发计划、实现摘要、验证与验收报告；验收后提交 commit、PR 并跟进全部适用 CI。

## 验收标准
- Human/Agent 名称清空后可保存并重新加载；配置中省略名称及空白名称不会导致配置校验失败。
- 无名参与者在设置与流程/评审相关显示中均以 ID 标识，不出现空标签或 undefined；有名参与者保持名称显示。
- Human 不提供系统提示词输入；不含 system_prompt 时可以保存并重新加载，配置中显式提供该字段时校验拒绝，包含空字符串和纯空白情况；Agent 提示词区域保留，仍可省略，但显式提供空字符串或纯空白时校验失败。
- Agent 切换为 Human 时删除草稿中的 system_prompt 并移除输入项；切回 Agent 后需满足 Agent 原有提示词校验（允许省略，显式空白无效）。既有 Human 携带 system_prompt 的配置应明确报错并提示移除，不静默容许该字段。
- 先运行受影响的配置、View、Review 等针对性测试，再通过 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。
- 使用 `playwright-cli` 实际操作名称清空、Human 禁止输入提示词、类型切换及保存重载，验证实际界面行为。
- 若同步 System Memory，源文件及当前开发 Project 副本一致，运行 `test/reserved-store.test.ts`，对最终 Memory 内容执行 `memsphere memory change validate [change-id]`，记录 ChangeSet ID、校验状态和 View 入口。

## 向前兼容
结论：不需要向前兼容。
当前仓库没有名称包含 stable 的 Tag，不存在适用的稳定 checkpoint 兼容责任。仍尽量保留现有有效名称配置的行为与冻结 Run 历史；Human 的 system_prompt 不再属于合法配置；已有该字段的 Human 配置须移除字段，不为历史误填保留例外。

## 采用规范
采用 memsphere-repository-requirement-rules：明确向前兼容结论及 checkpoint 范围。
采用 memsphere-repository-testing-rules：针对性及全量回归、类型检查、构建、Store 校验、实际浏览器操作与适用的 Memory 变更校验。
采用 memsphere-repository-development-rules 中的 System Memory 同步要求：同步检查用户可见配置行为的说明及副本。
同时遵循敏捷需求开发流程的范围确认与评审门禁；后续设计、开发、测试和交付阶段按步骤读取对应规范。

## 待确认项
已按用户明确纠正：Human 禁止填写系统提示词，界面移除输入且配置层禁止该字段。本轮产品负责人为 human actor5 与产品 Agent traex1；研发、测试、架构师分别绑定 traex2、traex3、traex4，Human 不参与这三个角色。
Agent 提示词保持实际现有规则（可省略、显式空白无效），本轮不新增 Agent 必填限制。
需求契约第二轮已通过；产品最终交付验收在实现验收完成后进行。

## 技术与测试方案
见 implementation-plan.md，已通过研发、测试、架构师三位 Agent 评审。

## 开发任务
见 tasks.md，配置、界面、测试、说明同步、验证、独立实现验收及最终产品验收均已完成。Git/PR/CI 收尾由本 Run 后续步骤跟踪。

## 验收结果
2026-10-19，Human 明确回复“验收通过”，正式 approve 已提交；产品 Agent approve，Runner approve。
产品 Review：review-20261019-112911z-1f55fdd9，Round：round-20261019-112911z-aa7af495，passed，无阻塞意见。
研发/测试/架构师实现验收第二轮均通过。最终 73/73 受影响测试通过，146 文件全量成功（1224 passed、0 failed、1 个 Linux 不适用的 Windows 测试 skip）。
需求目录已按规范完成归档；跨平台 CI、commit/PR 等仓库交付按 Run 后续步骤继续，尚不宣称 CI 已通过。

## 规范与流程结果
- 采用 memsphere-repository-delivery-rules；产品最终验收通过后记录结果、填写 completed_at、移除 status 并无覆盖归档，再提交 commit/PR 并跟进最新 head 的全部适用 CI。
- Actor、Framework System Memory 源与当前副本及 Skill 已同步；最终 ChangeSet change-20261019-060004472z-18cf913a 校验 passed，digest 6c81209fe21a50b2562ccbc7e23462b08ba59310ca1a0650db9cd24f180fbee7。
- 最终 73/73 受影响测试通过；全量 146 文件成功，1224 passed、0 failed、1 个仅 Windows 测试在 Linux 不适用而跳过；typecheck/build/validate/正式 Shell 实操通过。
- 实现验收第一轮要求补齐点号 ID 修复后的冻结证据，已重新提交完整摘要、验证报告和 14 份实现文件哈希；第二轮研发、测试、架构师均投通过，无阻塞意见。
- 此前 Provider 排队导致的超时是历史事件，已恢复，不是当前阻塞。当前 Run Reviewer 5 分钟空闲超时按用户授权保留；详情见 evidence/review-environment-failure.md 与 run-timeout-override.json。
- 产品最终验收已通过，本需求按规范归档；Windows/macOS 必须在后续 PR 最新 head 的全部适用 CI 中验证。

产品最终 Review：review-20261019-112911z-1f55fdd9；Round：round-20261019-112911z-aa7af495。Human、产品 Agent、Runner 均已通过；后续 Git/PR/CI 结果保存在同一 Run。
