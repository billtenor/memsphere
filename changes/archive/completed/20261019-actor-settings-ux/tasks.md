# 开发计划

依据：已通过的 implementation-plan.md 和第二轮需求契约。

- [x] T1 配置：name 允许省略/空白，解析名称回退 ID；Human strict 禁止 system_prompt；保护 Agent 原有规则。
- [x] T2 设置：名称选填提示及实时标题回退；Human 无提示词输入；类型切换清理字段；新参与者不预填名称；处理原始 Provider 引用名称空白。
- [x] T3 自动化：配置边界、Project 保存校验、快照/Assignment ID 展示、历史 snapshot、设置 API 与真实浏览器保存重载及类型切换。
- [x] T4 说明：同步 Actor/Framework System Memory 源与当前副本、Skill；检查冗余说明，记录相关 diff。
- [x] T5 验证：先受影响测试与 reserved-store，再 typecheck、npm test、build、memsphere validate、最终 Memory change validate；通过 playwright-cli 在正式 Shell 实操并保存证据。
- [x] T6 实现验收：提交实现摘要、验证报告与完整验收材料，处理研发/测试/架构 Agent 意见。
- [x] T7 产品验收与归档：Human + 产品 Agent + Runner 已通过；更新验收结果、移除 status、写 completed_at 并无覆盖归档。

Git commit、PR、最新 head 的全部适用 CI 和最终交付由本 Run 后续 flow[8]—flow[12] 继续记录；只有这些步骤完成，才宣称仓库交付完成，最终合入仍由 Human 操作。
