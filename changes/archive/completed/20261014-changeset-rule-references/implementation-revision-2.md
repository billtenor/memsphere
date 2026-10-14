# 实现成果第二轮修订

接纳研发、架构两条关于同一来源隔离问题的阻塞意见：候选详情不再写入普通详情缓存；退出带 change 的上下文时强制重载正式目录和详情；切换 Project 清空正式详情缓存。保持既有正式 cache，不引入新的版本状态模型。

新增一个真实浏览器回归，在同一应用实例预先打开正式命题、进入正文和标题不同的候选、退出候选并再次往返；断言正式正文、正式目录、候选正文和候选上下文分别来自正确来源。等待版本不同的标题/正文与正式摘要响应，不用旧 DOM 的瞬时存在性充当完成信号。

采纳测试 Agent 建议，保存完整可复跑生命周期验证器 evidence/reproduce-lifecycle.mjs。运行命令（仓库根）：`node changes/archive/completed/20261014-changeset-rule-references/evidence/reproduce-lifecycle.mjs`。它复用现有 View fixture，在临时目录生成脚本，使用 12 次真实 API 请求、显式 GC 和堆快照检查，最后清理临时脚本/快照；需要宿主允许 Chromium 启动。已实际复跑，通过结果在 evidence/lifecycle-reproduction.txt。

受影响测试新增后 31/31 通过，typecheck/build 和重新操作的 playwright-cli 通过。第二轮全量回归重新执行；第一轮全部证据保留在 evidence/revision-1/。第二轮材料及 verification-report.md 只采用最终全量完成后的当前结果；前序 Run 冻结验证仍是第一轮 30 项材料，不能直接当作第二轮最终结果。

需求范围、兼容性决策、无 Memory 差异及最终 Human 验收安排均不变。
