# 实施与验证方案

Run: run-20261019-033517z-efbcea22
基准：第二轮已接纳的需求契约；不增加或缩小产品范围。

## 采用规范与第二轮意见处理
已读取并采用 memsphere-repository-requirement-rules、memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules。
两条产品 Agent 建议接受并作为本方案的强制门禁：
- 必须同步 Actor、Framework 的 System Memory（reserved-memory 源与 .memsphere/memory 当前开发副本）以及 src/skills/memsphere/SKILL.md。逐项核对相关 README 等冗余说明，必要时同步。不可把整项同步视为条件任务。
- 验收通过后在 change.md 记录结果，移除 status、填写 completed_at，将整个需求目录无覆盖移动至 changes/archive/completed/20261019-actor-settings-ux/，再提交本轮 commit/PR 并跟进适用 CI。Human 最终合入。

## 实现方式和影响范围
### 配置层
src/control-plane/schema.ts 的 actorInputSchema 是原始 Project Control Plane 与解析后的 runtime 的共同入口。Human 分支移除 system_prompt 键，沿用 strict 对显式字段（含空串、纯空白）报错；Agent 沿用现有可省略、显式空白无效的 schema。Human 不产生 systemPrompt runtime 值。
Human 与 Agent 的 name 均允许省略或空白。保持已填写非空名称的原有内容；将“可选原始名称”与“可展示的解析后名称”分开：resolveActor 接收 actorId，在载入配置时将缺失/空白名称归一成 actorId，解析后 ControlPlaneActor.name 仍为非空 string。这能覆盖所有依赖解析后 name 的显示面，无需把 optional 类型传播到每个消费者或复制 UI fallback。
projectControlPlaneConfigSchema（设置草稿/保存校验）允许未填名称，但不向原始文件强制回写 ID 作为名称。明确检查 settings normalize/save 路径，确保不丢失 optional 字段语义。

### 展示链路
逐一核对 src/commands/view.ts 的 actorNames 与操作归因、src/run/store.ts 的启动预检及 Binding 列表、src/control-plane/snapshot.ts 的新 Run 快照、src/artifact-review.ts 的 Assignment actorName、src/prompts 与 src/acp 的评审输出。新配置在解析入口回退 ID 后，这些链路均使用非空解析名称；通过配置/快照/Review 联动测试验证，不只依赖代码推断。
冻结的旧 Run/Snapshot 保持原文，不通过变更快照校验 schema 或批量迁移改写历史。快照旧 Human systemPrompt 只为历史只读兼容而保留，不代表新 Project config 可填写该字段。

### 设置界面
modules/org.memsphere.settings/adapter/view/settings-view.ts：
- 名称输入标识选填，并提供 ID 回退提示；支持中英本地化。
- Human 不渲染系统提示词输入；Agent 保持原有输入。
- Agent 切为 Human 时从草稿删除 agent 和 system_prompt；切回 Agent 恢复默认 Provider，不恢复已清掉的提示词。
- 草稿名称清空时删除可选 name；标题对空白名称也回退 ID，保留有效名称原文。新建参与者不再自动填充名称。
- 检查 input/change 引起的 rerender，保证改名、类型切换和保存重载行为稳定。UI 移除输入与服务端 strict 拒绝共同守住禁止 Human 字段的契约。

## 开发任务
1. 修改配置 schema/resolve；增加独立产品契约测试覆盖 name 可选及 Human 字段禁止。
2. 修改设置表单、草稿切换、名称回退和中英文文案；补充真实 View 浏览器集成测试。
3. 核对新 Run/Assignment 的 ID 展示和有名 Actor 的保持行为；历史快照不改写。检查受影响 fixtures，只有新建配置中的 Human prompt 才需修正，旧历史 snapshot 测试保留。
4. 同步 Actor、Framework、Skill（源及当前副本），检查 README；更新 change.md 的实施进度。
5. 完成下述验证，提交实现摘要、首次验证报告和实现验收材料，由研发/测试/架构 Agent 按角色审查，处理意见并重跑受影响验证。
6. 交付报告由 Human 与产品 Agent 评审，完成归档、commit、PR 和全部适用 CI。

## 验证方式和验收证据
- 配置模块测试：Human/Agent name 缺失、空串、纯空白回退 ID；有效名称保留；非字符串名称失败。Project 原始配置可保存缺失名称；解析、新快照、Review Assignment actorName 回退正确。
- Human system_prompt 省略成功；提供有效文本、空串、纯空白均拒绝。Agent 省略成功、有值正确传递、显式空白失败。
- 设置真实 View 集成：无名 Human 和 Agent 展示 ID；名称清空与填入；Human 无系统提示词区域；Agent 输入提示词后切为 Human，确认草稿删除字段，保存后重新加载仍合法；切回 Agent 时不恢复旧 prompt。通过真实设置 API 检查不合法 Human 配置不能保存。
- 先执行受影响 control-plane、view-settings、view-settings-browser、相关 review/run 测试与 test/reserved-store.test.ts；成功/失败边界分开，避免只模拟实现步骤。
- 必须使用 playwright-cli 对正式 View Shell 实际操作上述交互，检查桌面/窄屏与 console；保存截图及可复查证据，不用静态页面或独立 mock 页面代替。
- 必须在最终内容运行 npm run typecheck、npm test、npm run build、memsphere validate；记录实际结果、未执行项和环境阻塞，失败不得声称交付。
- 必须执行 memsphere memory change validate [change-id]，记录最终内容匹配的 ChangeSet ID、校验状态与 View 入口；之后有 Memory 修改则重新验证。

## 兼容性、风险和待决问题
无适用 stable Tag，遵循契约的“不需要向前兼容”。Human 原始 config 携带提示词从允许变为拒绝，错误必须指出字段；不静默清理磁盘配置。Settings UI 类型切换属于用户编辑草稿，可明确清理字段。旧冻结 Snapshot 容忍历史字段并保持不可变。
风险：遗漏未走解析入口的原始 config 展示；通过搜索所有 actor.name、原始 settings draft 与集成测试核对。名称回退保持运行态非空，避免更改下游数据结构。无 syntax 关键字变化，无额外待决产品问题。

## 实施细节校准记录
代码复核确认原有 nonEmptyString 会 trim 有效名称。按需求契约中“保持原有显示行为”，可选 name schema 继续 trim，在此之后判断空白并回退 ID；不改变集中归一化入口、字段可选性或产品范围。上述“名称原文”指有效名称内容，不引入保留首尾空白的新语义。最终测试显式保护该既有归一行为。
