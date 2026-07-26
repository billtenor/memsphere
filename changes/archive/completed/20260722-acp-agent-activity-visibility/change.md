---
id: 20260722-acp-agent-activity-visibility
type: feature
created: 2026-07-22
completed_at: 2026-07-23
run_id: run-20260722-144949z-34fd2b5a
---

# ACP Agent 运行活动可见性

## 需求

### 背景

Artifact Review 已能展示 Agent Assignment 的 queued、running、submitted 和 failed 状态，但 Agent 真正运行时，用户看不到它正在读取什么、是否在执行测试、是否持续有活动。一次评审可能持续数分钟，单一的 `running` 状态会形成明显的黑盒体验；失败时也只能看到最终错误，难以判断此前执行到了哪里。

Memsphere ACP Client 已接收标准 `session.update` 通知，但当前仅用通知刷新 idle timeout，没有保存或展示其中的 Agent 消息、工具调用和执行计划。产品不需要提供终端控制或与 Agent 交互，只需要把已经存在的 ACP 活动转化为稳定、可刷新、可审计的只读运行记录。

### 目标体验

- 每个 Agent Reviewer 在 Artifact Review 弹窗右侧的参与者列表中显示当前 attempt、最近活动和活动时间。
- 用户可以直接在 Agent 参与者行下展开只读的“运行记录”，按时间查看 Agent 消息、工具调用状态和计划进度；无需也不得切换成 Agent 身份。
- 页面轮询、刷新、View 重启和 Agent 结束后，运行记录仍然可读。
- Retry 创建的新 attempt 使用独立记录，历史失败 attempt 不被覆盖。
- 没有可展示事件时继续显示现有状态和“等待 Agent 活动”，不能把无事件误判为卡死。

### 需求契约修订记录

- 2026-07-22，Human 在实现阶段追加确认：“ACP 的所有内容，都可以存起来，只是展示的时候，只展示我们之前约定的东西。这样整个 run 里面会保留更完整的信息。”
- 本轮将“ACP 的所有内容”具体化为 Agent attempt 实际发送的初始与催交 prompt，以及接收到的完整 ACP `session.update` 原始事件流；不额外抓取 ACP stdin/stdout 协议控制请求，也不读取 Provider 私有 session 文件。
- 该修订把“本地完整留存”和“默认产品展示”分成两个边界：Run 内 `*.acp.jsonl` 是唯一事实源，完整、未裁剪地留存原始 ACP 事件和 Memsphere 已知生命周期；View API 和页面只读取由该事实源计算出的过滤、合并且容量受控的规范化投影。
- 本修订替代本 Run 初始需求契约中“thought 原文、工具 raw input/output、ACP `_meta` 和 Provider 私有字段不进入默认持久化”的旧表述；这些字段允许进入随 Run 保存的本地原始 JSONL，但不得进入 View API 或页面。
- 2026-07-23，实现验收 `review-20260722-162010z-0b5c6a3f` 的三名 Agent Reviewer 均就上述新旧契约差异提交 blocking comment；Runner 将意见处置为 `accepted-followup`。Human 在看到该差异后对双层存储实现投 `approve`，Runner 随后投 `approve`，构成对本修订的正式重新确认。

## 范围

- 消费 ACP `session.update` 中稳定且适合展示的事件：
  - `agent_message_chunk`。
  - `tool_call` 与 `tool_call_update`。
  - `plan`；实验性 plan update 只有在 SDK 能力明确协商且实现稳定时才纳入。
  - Session 启动、停止和失败等由 Memsphere 已知生命周期生成的事件。
- 将事件规范化为与具体 ACP Provider 无关的活动记录，并按 Review Assignment attempt 隔离。
- Agent 参与者行展示最近活动摘要，并在原位展开时间线查看当前或历史 attempt。
- 使用现有 View 轮询机制按游标增量读取，不要求 WebSocket、SSE 或新的常驻服务。
- 运行记录保存在对应 Run 目录中，随 Run 归档；高频活动不得持续改写 `run.json` 或推进 Review revision。
- 每个 attempt 另存实际发送的 ACP prompt、完整未裁剪的 ACP `session.update` 与 Memsphere 生命周期 JSONL，供本地审计和后续排障；规范化展示记录不包含 prompt 正文，是可校验、可重建的派生缓存，不构成第二份事实数据。
- 对连续文本 chunk 做合并，对 tool call 按 `toolCallId` 关联状态，控制文件数量、单次 attempt 大小和前端渲染量。

## 不做事项

- 不实现终端模拟、stdin 输入、权限确认、暂停、取消或其他 Agent 交互控制。
- 不恢复 Review bridge，不新增 daemon、dispatcher、Unix/TCP listener 或远程传输。
- 不读取或依赖 Trae、Codex 等 Provider 的私有 session 文件和日志目录。
- 不默认展示 `rawInput`、`rawOutput`、完整命令输出、环境变量或其他可能包含敏感信息的大字段。
- 不通过 View API 或页面展示原始 ACP 日志；`agent_thought_chunk` 在页面中仅映射为不含推理正文的“正在分析”状态。
- 不在本轮提供 transcript 搜索、下载、跨 Run 聚合或使用量分析。

## 验收标准

1. Fake ACP Reviewer 发出 `agent_message_chunk` 后，View 中对应 running attempt 最迟在下一次正常轮询后显示最近活动，用户无需刷新整页。
2. `tool_call` 和同一 `toolCallId` 的 `tool_call_update` 能显示可读标题及 running/completed/failed 状态，不因流式更新产生无法辨认的重复条目。
3. 连续 message chunk 在展示时合并为可读消息，不逐 token 生成大量 DOM 节点或持久化记录。
4. Agent 卡片至少显示当前 attempt、最近活动摘要和最后活动时间；展开后按时间顺序显示只读活动时间线。
5. 用户向上查看历史时，新增事件不得强制把滚动位置拉回底部；用户回到底部后可以继续自动跟随。
6. 页面刷新、View 重启以及 Agent submitted/failed 后，已记录活动仍可读取；Run 归档后活动文件随 Run 保留。
7. Retry 后的新 attempt 使用独立时间线，旧 attempt 的活动和失败原因仍可切换查看且不会被覆盖。
8. 活动记录不进入 Review draft，不增加 Review Round revision，也不得引发 Human 评论保存的 revision conflict。
9. View 通过受控 review、assignment、attempt 标识读取活动，不接受任意文件路径；workspace 文件位置对外展示时转换为相对路径。
10. `agent_thought_chunk` 的原始文本、工具 `rawInput`/`rawOutput`、环境变量和 Provider 私有日志不出现在默认 API 响应或页面中。
11. 单个 attempt 的记录具有明确的大小或事件数量上限；达到上限后保留可见的截断标记，ACP Session 和 Review 提交不能因记录失败而失败。
12. 不发送任何 `session.update` 的 Agent 仍可正常完成 Review，页面保持现有状态展示并给出无活动的中性提示。
13. Agent Activity 写入、View 增量读取、失败保留、Retry 隔离和浏览器时间线交互均有自动化回归；项目 typecheck、全量测试、build 和 validate 通过。
14. Activity 入口位于现有 Artifact Review 弹窗右侧参与者列表，不新增第三栏、独立浮窗或 Agent 身份选项；现有 Human 身份选择与 Agent assignment 访问隔离保持不变。
15. 每个 attempt 完整保留按实际发送与接收顺序写入的初始/催交 ACP prompt、ACP `session.update` 和 Memsphere生命周期原始 JSONL，包括默认页面会过滤的 Provider 扩展字段；该文件不受展示记录上限裁剪，也没有 View 读取 API，prompt 正文不得进入 View 投影。
16. Artifact Review 的候选产物和 requirement、implementation、validation 证据统一在左侧 Artifact 区域通过下拉框切换；证据快照只读，切换时不得丢失右侧未提交评论草稿。
17. Activity JSON 投影必须记录对应 JSONL 的源字节位置；缓存缺失、损坏或落后时由 JSONL 自动重建，读取到尚未写完的末尾行时保留上一份有效投影并等待下一次读取。

## 关联需求

- `changes/active/20260720-artifact-review-agent-acp/`：提供 ACP Client、Agent Session、Assignment 与 attempt 生命周期，是本需求的直接前置能力。
- `changes/archive/completed/20260722-artifact-review-process-usability/`：提供 Agent 状态、失败分类、Retry 和 View Review 工作区，本需求复用其展示入口。
- 重复需求：无。

## 技术与测试方案

### 建议技术方案

- 在 ACP Client 的 `session.update` handler 中将允许展示的事件交给 activity sink；idle timeout 刷新继续独立执行。
- activity sink 对事件做 Provider 无关的规范化、文本 chunk 合并、tool call 状态归并和节流批量写入。
- 每个 attempt 使用 Run 目录下的确定性 JSONL 活动文件；文件路径由 Store 根据 Run/Review/Round/Assignment/Attempt 生成，不由 API 调用方提供。
- 同目录保存唯一事实源和派生投影：未裁剪的 `*.acp.jsonl` 追加写入原始事件与生命周期，受大小约束的 `*.json` 规范化快照只服务 View；投影携带 JSONL 源字节位置并可在缺失、损坏或过期时重建，前端 API 仅暴露后者。
- 高频事件不写入 `run.json`。View API 读取指定 attempt 的活动文件并返回 `nextCursor`、截断状态和增量事件；仅在用户打开 Agent 详情时拉取时间线。
- Session 结束前 flush 待写事件；活动记录写入失败只记录诊断，不得改变 Agent Review 的成功或失败语义。
- UI 将最近一条规范化事件投影到 Agent 参与者行，使用 disclosure 在该行下方展开有稳定尺寸的时间线；工具调用使用状态图标和标题，消息使用普通文本。该区域属于 Review 观察视图，不复用 Human identity selector，也不调用 Human assignment context API。

### 测试方案

- 扩展 Fake ACP Reviewer，覆盖分块消息、tool call 生命周期、无 update、失败和 Retry。
- 单元测试覆盖原始事件完整留存、规范化过滤、chunk 合并、tool call 归并、大小上限和截断。
- Store/API 测试覆盖确定性路径、attempt 隔离、增量 cursor、刷新恢复、归档保留和任意路径拒绝。
- Browser 测试覆盖参与者行摘要、原位展开/收起、窄右栏与移动端 Review tab、自动跟随暂停、attempt 切换及 submitted/failed 历史展示，并断言 Agent 不会进入 Human identity selector。
- 至少执行 `npm run typecheck`、相关聚焦测试、`npm test`、`npm run build` 和 `node dist/cli.js validate`。

## 开发任务

- 已完成 ACP `session.update` 原始流与过滤 View 投影的双层持久化。
- 已完成 Agent Worker 生命周期接入、受控 Activity API 和 Artifact Review 参与者行时间线。
- 已完成 System Memory 同步及单元、API、全量和无头浏览器回归。

## 验收结果

- 实现验收 `review-20260722-162010z-0b5c6a3f` 已通过；三条契约差异意见均完成 `accepted-followup` 处置并补录需求契约修订记录。
- Human 于 2026-07-23 确认提需方验收通过，没有新增修正意见。
- 聚焦测试 64/64、Reserved Store 14/14、全量测试 290/290 通过；typecheck、build、`memsphere validate` 与 `git diff --check` 均通过。
- 验收后根据 Human 反馈将 Activity Attempt 原生下拉框统一为 Artifact Review 的自定义 combobox，并限制为 260px；菜单交互期间 Activity 轮询不替换控件。补充聚焦测试 52/52 和无头浏览器交互通过，随后全量 290/290、typecheck、build、validate 与 diff check 再次通过。
- 修复已结束 Activity 在阅读历史记录时仍被轮询替换并跳回末尾的问题：用户离开底部后暂停会干扰阅读的整页刷新，且 Activity 游标、错误和加载状态未变化时不替换日志 DOM。无头浏览器会向上滚动并跨越一个轮询周期验证节点与滚动位置保持不变；全量测试 290/290、typecheck、build、validate 与 diff check 通过。
- Activity 事件不再仅靠边框颜色区分类型：`message`、`tool`、`plan`、`thought`、`lifecycle` 在中文界面分别显示“消息”“工具调用”“执行计划”“分析”“运行状态”标签，事件及计划状态也显示中文标签。无头浏览器覆盖实际标签渲染；聚焦测试 52/52、全量测试 290/290、typecheck、build、validate 与 diff check 通过。
- 将 Activity 入口从右侧评审结论区移至 Agent 活动摘要行，并使用“查看详情 / 收起详情”的轻量链接式按钮；右侧仅保留评审结论和必要的 Retry。无头浏览器断言入口归属、展开状态和结论区隔离；聚焦测试 52/52、全量测试 290/290、typecheck、build、validate 与 diff check 通过。
- 参与进度和已提交意见中的 Implementation evidence 统一中文化为“实现证据：已引用 / 未引用”；Activity 事件状态为 `completed` 时不再显示冗余的“已完成”徽标，`in_progress` 等有效实时状态继续显示。无头浏览器验证真实证据值及已完成工具事件无状态徽标；聚焦测试 52/52、全量测试 290/290、typecheck、build、validate 与 diff check 通过。
- 评审意见分类标签从 Reviewer 名称下方移至卡片右上角，与左侧角色共同组成固定头部，正文从下一行完整展示；相比右下角更便于跨长短意见快速扫描严重级别。无头浏览器验证角色与分类同处首行且左右分布；聚焦测试 53/53、全量测试 291/291、typecheck、build、validate 与 diff check 通过。
- Activity 事件卡片统一为两层头部：第一行左侧显示事件类型、右上角显示时间，具体工具命令或消息标题从第二行开始，避免长命令将时间挤到下一行。无头浏览器验证工具类型与时间同处水平首行且标题位于其下；聚焦测试 53/53、全量测试 291/291、typecheck、build、validate 与 diff check 通过。
- Artifact Review 的 requirement、implementation、validation 证据产物已移到左侧 Artifact 下拉框，与候选产物统一切换；证据保持只读，候选产物仍可评论，切换不会清空右侧草稿，右侧不再重复展示完整“评审证据包”。Activity 持久化同时收敛为 JSONL 唯一事实源，Memsphere 生命周期也写入 JSONL；JSON 仅作为带 `sourceBytes` 的可校验、可重建 View 投影缓存，覆盖缓存缺失、过期、损坏及 JSONL 半行追加。聚焦测试 57/57、全量测试 292/292、typecheck、build、validate 与 diff check 通过。
- `sourceBytes` 是投影缓存的必填一致性字段：缓存字节位置与 JSONL 不一致时必须立即重算，没有 JSONL 事实源时投影必须为空，不允许 JSON 成为第二事实源。定向回归只使用当前缓存格式，覆盖“缓存落后于事实源”和“缓存没有事实源”两种一致性状态；聚焦测试 4/4、全量测试 293/293、typecheck、build 与 diff check 通过。重启 View 后通过当前 Run 的只读 Activity API 实际触发六个 attempt，三个 JSONL 投影按源字节重算，三个无 JSONL 投影重写为 `sourceBytes: 0` 的空快照。
- ACP Client 在每次实际调用 `session.prompt()` 前把 prompt 以 `initial` 或 `reminder` 记录写入同一 attempt JSONL；未发送的 reminder 不落盘。prompt 正文仅留在事实源，不进入 JSON 投影、Activity API 或页面。Agent Activity 单元回归覆盖两类 prompt 的完整留存与投影隔离，Agent Review 集成回归覆盖成功 attempt 只记录 initial、未提交 attempt 记录 initial 与 reminder；聚焦与集成测试 12/12、全量测试 293/293、typecheck、build、validate 与 diff check 通过。
