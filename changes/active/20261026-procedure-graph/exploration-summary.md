# graph 技术探索结论

日期：2026-10-27。探索 Run：`run-506ca3de-d02a-48af-92a9-2f348e6600fa`。完整可评审方案见同目录 implementation-plan.md，详细意见及决定保留在探索 Artifact，不把原始对话或单次执行日志作为代码交付。

## 与 Human 已确认的决定

1. 旧 flow 先不动，新 graph 使用 context_control 模型 Store。
2. 依赖满足时创建独立 Step；循环/再次触发新建，修订沿同一个 Step。
3. Step 只有 pending、running、awaiting_review、done 四状态。首次 enter 将 pending 转 running，重复进入不重置。
4. 一个可执行 Step 自动 enter 并给完整 Prompt；多个给概述列表和 enter 命令，不展示 Action ID。
5. 保留 step enter；step show 只读。撤回 enter 只读及复用 show 进入工作的旧候选。
6. 原生命令明确绑定 Run/Step，continue 自动补参；上下文固定绑定同一 Step，贯穿生产、评审、修订，到完成后不改绑。
7. enter 后只引导当前 Step 直到完成；跨 Step 并发由 Agent 框架安排。
8. 无可执行 Step 使用单独 Prompt，区分等待、无法推进、成果确认。
9. collect 由 Memsphere 命令自动全部执行，不要求 Agent enter/report 或独立评审。
10. graph 运行状态复用 Run.frames；新增 type=graph/graphFrame，不额外加顶层 graphState 或帧内 mode。
11. 触发记录以 actionId/dependencyIndex 定位依赖，不保存 sourceStepIds。
12. Step.inputs 在触发创建时固定，存具体材料引用；普通一份、collect 零或多份，上游未来产物不改变当前输入。
13. graphFrame.pendingSteps 暂存完整创建材料，正式 Step 建好后清理，恢复按固定 ID/inputs 补建，不覆盖已有进度。
14. joins 按来源保存最近完成材料，不积攒次数；到齐后 true/false 均消费，true 准备 Step，求值错误不当 false。
15. processedStepIds 记录已分发完成信号，与触发/汇合/pendingSteps 一次原子保存。
16. START 分发与 graph frame 初始化一起原子保存；frame 存在就不重复 START，无单独启动标记或虚构 Step。
17. 不提供启动时结构化业务参数，不增加 --input-file 或 Run input。入口 Action 形成 Artifact 后沿依赖传递。
18. 正式评审复用 Step.reviewRounds 与每位参与者的 Review；Runner 使用 role=runner，固定名单与材料按轮保存，不在 Run 复制旧 artifactReviews。
19. 后续无明显歧义的技术细节由 Runner 自主决策，只对范围/重要方向变化另行对齐，不逐项请求确认。

## Runner 按授权补齐的落地方式

- 新 syntax 选择 memsphere-20261027-stable；旧解释保持，schema/serializer/navigation 全链路支持新模式。
- 明确 MIME 解码与既有元模型 Runtime 校验，JSONata 只接收本次 artifacts 并要求 boolean，不自制语言或扩大模型 Runtime。
- 提交候选使用 Step.frames 的短期 submissionFrame 固定多记录创建材料；正式结算可从已提交 Review 重放，不建立通用 Store 事务系统。
- 列表只读且按记录隔离故障；单 Run 工作推进才恢复/调度。详情与集合轮询不自动 enter 或派发生产。
- Human Action 独立覆盖“展示材料与要求、等待 Human 结果、绑定正确 Step 提交”的闭环；不能被 Human Review 测试替代。
- 加入真实进程竞态、故障注入、多 Run 损坏隔离、CLI/受控 ACP/浏览器验证，并逐项列出 Memory 与必跑套件映射。

这些内容是待正式评审的实施细化，不标为 Human 对每一字段已单独批准。没有修改业务实现或发布新的 Memory。

## 原敏捷流程衔接

原 Run `run-20261026-091339z-19538ce9` 的方案评审 `review-20261026-094209z-1bb42cc8` 仍在旧候选第一轮，Human Assignment 尚未正式提交。当前 API 不允许未决评审期间替换为不同候选，Runner 也只能在 awaiting_runner_vote 时投最终票。

因此不伪造 Human 票、不直接改状态文件、不新起敏捷 Run 绕过现有评审。完整新方案已准备好；下一次正式 Human 评审动作应针对旧候选要求修改，并引用本整合稿作为替换内容，之后在同一 Run 提交修订。日常技术决策自主授权不等于对当前正式 Artifact 的特定票型授权。

## 整合稿与校验

完整方案 Artifact：`artifact-6ec040b0-af56-434e-8252-0f2402a26020`；语法设计 Artifact：`artifact-3054ca72-3862-4719-aaaa-18cb9c350bce`；当前需求 Artifact：`artifact-8818aed0-08dc-412f-a7ff-580812a50015`。它们通过实际依赖关联全部共同决策材料。

本轮只更新方案和设计文档。执行了 Markdown 围栏/空白检查、git diff --check，以及使用已安装 CLI 的 yaml/ajv 对完整例子的 YAML、五个 Action 引用、模型定义、两份/空资料及非法值进行结构校验，均通过。工作树未安装依赖，首次本地包解析提示缺少 yaml，随后明确使用已安装 CLI 依赖完成上述文档检查；这不是当前工作树功能测试。未执行 npm 回归、浏览器或 Memory 校验，不声称功能已实现或验收完成。
