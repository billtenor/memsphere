---
id: 20261019-changeset-inline-comments
type: bugfix
created: 2026-10-19
completed_at: 2026-10-19
run_id: run-20261019-144339z-278320f8
---

# 需求

修复 ChangeSet 新增文档在“新增”附近悬停时布局错乱、章节评论 + 移入后消失，以及保存评论后只在侧栏显示的问题。保持 completed/abandoned 不允许评论且不显示 +；已有评论仍可阅读。产品、研发、测试、架构 Artifact Review 均由 Agent Actor 执行。

# 验收标准

1. 新增 Schema/Statement 文档在 diff 中保持块级宽度，悬停不改变布局。
2. 可评论的 active ChangeSet 中，鼠标移入章节 + 后仍可点击，能够提交评论。
3. 评论按 Memory 和 anchor 回到对应原行，差异和完整内容模式均可查看；展开原行后显示；收起正文时评论随正文隐藏，不强制展开；侧栏始终保留记录。
4. completed、abandoned 隐藏 + 和评论修改入口，后端继续拒绝写入；已有评论保留。
5. 正文展开状态与最新 master 的会话内状态保留功能兼容，不因评论渲染或操作覆盖用户选择。
6. 类型检查、受影响测试、全量 npm test、build 和 Memory 校验通过；如存在 Memory 差异，记录最终有效 ChangeSet。

# 向前兼容

结论：不需要向前兼容。仓库没有名称包含 stable 的 Tag checkpoint；本轮不新增数据格式或迁移。现有 Comment 的 memory_reference/path/target/location.anchor、权限和生命周期保持兼容。

# 范围与不做事项

范围是官方 Memory/ChangeSet View 和相应测试、System Memory 和 Skill 同步说明。保留后端原有 active 状态门禁。不会重新开启 completed，不引入新的评论模型，不修改 Artifact Review，不扩展审批、认证或权限机制。原始外部 ChangeSet 已找不到，不依赖该历史记录作为唯一验收数据。

# 关联需求

强关联：20261019-preserve-disclosure-state（已合入 master），需要验证评论显示不破坏正文展开状态。不存在重复的 active 需求。

# 技术与测试方案

需求契约第二轮及实施方案已由指定 Agent 通过；实施方式、范围和验证见 implementation-plan.md、implementation-summary.md、verification-report.md。

# 开发任务

任务清单见 tasks.md，代码、测试、Memory/Skill 同步、真实 Shell 验收和本地全量回归已完成；合并 master 时的测试冲突已解决且保留双方覆盖。

# 验收结果

本轮 typecheck、构建、149 个文件的全量回归（1247 passed，0 failed，2 Windows-only skips）及真实 30000 Shell 操作通过；35 项受影响测试和 27 项 reserved/style/locale 测试通过。Memory ChangeSet change-20261019-145538606z-5db05ae5 校验有效，Digest ae7a2cf040b086915be9710853771f0082f5bd9cb8624b5e5de258209a8af348，View /projects/memsphere/changes/change-20261019-145538606z-5db05ae5。研发、测试、架构 Agent 第二轮实现验收全部 approve，第一轮章节自身折叠 blocking 已修复并重跑最终全量；产品 Agent 交付验收 approve，Runner 均通过。实现验收及需求归档完成；commit/PR/CI 和最终合入确认继续由关联 Run 跟踪，本记录不伪称尚未执行的远端门禁已通过。
