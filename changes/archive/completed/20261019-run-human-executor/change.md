---
id: 20261019-run-human-executor
type: bugfix
created: 2026-10-19
completed_at: 2026-10-19
run_id: run-20261019-055937z-2a5c530e
---

# Run 展示 Human 执行者

## 需求

Run 详情未展示步骤中已有的 `actor: human`，导致用户无法识别人负责的步骤；Memory 详情已正确展示。无重复需求，关联已完成的 `20261011-human-step-executor`（Memory/ChangeSet 的 Human 标记展示）。

## 验收标准

- Run 流程图的 human Action、if/while 条件及嵌套步骤显示“执行者 Human”/“Executor Human”。
- 当前、已完成和未开始的步骤均展示标记；保留当前步骤提示与产物契约。
- agent、默认执行者和 call 不显示 Human 标记。
- 中英文、桌面与 390px 窄屏可见且无页面横向溢出。

## 技术与测试方案

数据层及系统记忆已保留 actor，缺口位于 Run 的 decorateHead。追加独立于 Artifact 的执行者展示，并保留当前步骤标记。仅使用模块内可折行布局，不改变执行或快照语义。

在 builtin-run-view 浏览器集成测试新增中英文用例覆盖上述标准；修复前两例均因缺少执行者元素失败。交付前运行相关浏览器/样式测试、typecheck、build、memsphere validate 及全量 npm test，并使用 playwright-cli 检查页面。

## 开发任务

- [x] 定位根因并复现失败。
- [x] 修复 Run 步骤头部及布局。
- [x] 完成测试与验证。

## 验收结果

2026-10-19，提需方在当前 worktree 构建的独立 View 中查看「明确流程记忆字段职责」Run（run-20261011-070230z-f245b4b1）的 Human 执行者标记，并明确回复“验收通过”。显示修复及 CI 性能扩展验收完成；原修复 Run 已完成，本次归档 Run 为 run-20261019-065147z-b00ceb32。

- 定向浏览器与样式测试：16/16 通过。
- `npm run typecheck`：通过。
- `npm test`：最终 148/148 文件通过；1212 项通过、1 项跳过、0 失败，372.82 秒。pretest 包含 `npm run build`，已通过。
- `node dist/cli.js validate`、`git diff --check`：通过。
- playwright-cli：桌面和 390px 窄屏实测通过；Human 和当前步骤提示共存，无横向溢出。窄屏中正文宽度 258px / 头部 326px，避免 metadata 挤窄正文。
- 无 Memory 差异，不创建空 ChangeSet；此修复恢复已有 actor 展示语义，不修改执行、数据或快照。
- PR #104 的源码提交 1722736b09f862c33b20a53c36a4b92e83dd437b：Linux、macOS、Windows 共 17 项 CI 全部成功，含五分钟总预算。归档前再次读取检查状态，仍为 17/17 成功。
- 当前 worktree 已重新 `npm run build` 并启动独立 View，实际页面确认 Human 标记可见；提需方已验收。正式 View 未替换，PR 由 human 审核合入。


## CI 性能扩展

用户在本轮明确要求继续处理 CI 性能。首次 Windows Project Lifecycle 的 11 个测试文件全部通过，但作业清理触及五分钟时限；针对性重跑也超时。主分支最近两次运行已有总预算失败。

下载的 Windows 耗时证据显示：`project-upgrade.test.ts` 单文件 247.40 秒，整个项目套件 247.40 秒；`project-command.test.ts` 153.95 秒，其余文件较短。文件级调度无法拆分升级文件，存在串行长尾。

将升级用例按 Managed 升级、Embedded 升级、目标路由/Skill 升级拆为三个独立文件，提取原有隔离 fixture。AST 对比确认全部 11 个 test 调用的正文和断言逐字保留；未删用例或降低断言。Windows 项目套件使用三个文件级进程；保持五分钟门禁。Windows Review/Shell UI 的测试阶段为 207.51 秒、完整作业 281 秒，亦接近总预算；其最长文件仅 105.38 秒，因此同样改为三个文件级进程，缩短整体排队。调度权重按原分组耗时分配，Windows 依据本次实际耗时，其他平台按原文件权重比例估算，后续以 CI 数据核验。

- 拆分后升级测试：11/11 通过（28.72 秒，Linux 本地三个进程）。
- 跨平台测试归属与调度测试：通过，确保每个平台没有丢失或重复测试。
- 最终完整回归：148 个文件全部通过；实现提交 1722736 的 17 项 CI 全部成功。Windows Project Lifecycle 由超时降至 2分45秒，Review/Shell UI 由 4分41秒降至 3分28秒。

## 向前兼容

结论：不需要向前兼容。本轮恢复既有 actor 展示，并调整测试文件与 CI 调度；不改变 DSL、运行数据、命令或快照契约。


## 验收后 CI 跟进

用户要求继续跟进验收文档提交 30555a8 的 CI，直到通过。该轮各测试任务均成功，但 macOS 合并 Browser UI 任务用了 4分55秒（测试阶段235.65秒），工作流总时长315.3秒，未通过五分钟预算。计时来自运行39212598133及其测试耗时产物。

复用现有 model-ui/review-ui 分类，将 macOS Browser UI 拆为 Models & Settings UI、Review & Shell UI 两个并行任务，每任务三个文件级进程。所有测试用例、断言、平台覆盖及五分钟门禁均保留。既有跨平台覆盖测试验证每个平台的测试文件无缺失、无重复，浏览器安装条件与套件一致。本轮只调整 CI 分工及此记录，不修改已验收的运行时行为。

最终检查结果以 PR #104 最新 head 的检查记录为准，不再为补写 CI 状态制造额外文档提交。


后续运行39213333539中，拆分后的macOS UI任务分别为1分49秒和1分55秒，全部测试仍通过。Windows Project Lifecycle 本轮完整任务波动到4分56秒；耗时产物显示project-command单文件227.96秒、Managed升级186.42秒、Embedded升级130.60秒。

进一步将Windows升级测试分配给独立的Project Upgrades任务，与Project Lifecycle分开运行，保留各任务三个文件进程。新增project-upgrade内部测试分类，并在Linux/macOS使用的聚合套件中保留该分类；跨平台全量覆盖检查及专门的归属回归测试共同保证没有遗漏或重复测试。五分钟总预算及全部原测试仍保留。最终状态继续以PR最新提交检查为准。


运行39214127601又暴露Windows并发提交测试中的锁文件瞬态访问失败：争用期间独占打开锁文件返回EPERM，现有逻辑仅将EEXIST视为争用。Run获取锁现复用已有Windows文件访问重试，仍使用wx独占创建，保留owner token、争用截止时间和持久错误失败行为。新增Windows故障注入测试，先拒绝两次锁访问，再验证产物恰好保存一次、Run完成及锁清理；其他平台不模拟Windows文件共享规则。

该轮macOS聚合核心任务测试阶段223.85秒、完整任务4分40秒。将其拆为现有Projects & Memory及Run, Data & SDK套件，均使用三个文件进程；Windows Run, Data & SDK也调整为三个文件进程。每个平台无遗漏/重复的覆盖检查保持不变，时间门禁不放宽。锁修复不修改Memory语法、锁文件格式或流程契约。


运行39215473138中，Windows锁访问故障注入和原并发提交测试均通过，五分钟预算计时267.1秒。剩余失败为Agent Review测试fixture连续执行真实CLI期间不报告活动，触发既有10秒空闲超时。fixture现于每条CLI操作前发送实际进度，并使用pretest生成的dist/cli.js，避免每次子进程重新加载TypeScript；真实CLI调用、全部断言及启动/空闲/总时长限制保持不变。最终验证结果以PR最新提交的CI记录为准。


运行39216561657的Linux浏览器任务在安装阶段失败：ubuntu-latest已分配Ubuntu 26.04，当前Playwright明确报错不支持chromium on ubuntu26.04-x64。Linux CI固定至受支持的Ubuntu 24.04，覆盖检查同步验证四个Linux套件仍完整运行；不跳过浏览器测试，不改变依赖或测试断言。


运行39216851789发现既有ACP stderr断言竞态：RPC错误由stdout先到达时，客户端立即构造异常，可能遗漏另一管道已输出的诊断。失败清理现先终止Provider并等待stderr关闭后再构造错误；等待最多1秒，避免子孙进程保留管道时挂起。原stderr断言和超时测试保持不变，启动/空闲/总时长限制不放宽。


运行39217353655全部测试成功，但总预算296.3秒超过285秒预留线。最新耗时产物定位到未登记权重的长文件：Windows system-upgrade-changeset119.43秒、page-layout-view72.98秒，原默认仅2秒导致晚启动。按本轮全部17个套件实测数据更新跨平台耗时表，保持测试、并发及五分钟门禁不变，利用已有长任务优先调度消除长尾。
