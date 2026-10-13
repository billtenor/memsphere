# 第四轮需求补充与方案修订摘要

第三轮 Human 通过；研发、测试和架构提出有效意见，Runner 要求修订。此次先将必要的公开接口与交付边界写入 requirement-contract.md 的“本轮需求补充”，在当前评审稿完整附上，供 Human 以需求负责人确认。确认前不施工；需求补充与方案可同时审阅，不以方案讨论默认为需求契约已通过。

1. 补充 --change 的用户重试契约、专用持久记录、独立 worktree/commit、Embedded 准备成功与合入完成的区别。
2. 所有通用写入口在写入前拒绝专用 intent，明确只读、所属 worktree validate、Human abandon 及终态 archive 的允许路径，避免 claim 提前 applyTargets。
3. 专用校验必须验证冻结目标版本/操作/身份摘要，必需目标退回基线一律失败；两条校验/重试入口均测试。
4. 明确沿用现有 master-only 集成范围与稳定 ref；无 master 不写入，不猜 main。专用完成判据检查目标内容，补测 merge/squash、worktree 移除和分支变化。
5. 明确全局 JSON 参数/业务失败路由改动与 CLI 测试。

保留前三轮已确认的命令＋Skill、三类升级与用户保护，未施工。
