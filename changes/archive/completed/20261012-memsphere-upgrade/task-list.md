# 开发计划

方案 Review 第四轮已由 Human 通过、Runner 接纳。完整需求补充在 submission-20261012-133051z-e9b2c2b3 与 Human assignment-20261012-133051z-0f5e2312 的通过票中确认；以 scope-and-implementation-review.md 为冻结施工依据。历史 flow[1] 不改写。

1. 模型升级：提取显式升级路径，保持 initialize 默认语义，更新定义与完整 System 登记 value，保留 UUID/createdAt，预检校验、共享写锁/日志、幂等/冲突/用户保护模块测试。
2. 专用 Memory ChangeSet：intent=system_upgrade、冻结 System 目标与 worktree/branch/master 绑定，新增内部创建、强校验、重试接口；普通 capture 排除；master 目标内容完成判定。
3. 通用入口隔离逐项验证：claim（含 force）、scope/add、edit/delete/rename 的目标追加、resume、finish、publish、complete、failMemoryChange、comment create/update/delete、checkpointWorkspaceChanges。每个适用公开入口覆盖所属与另一 linked worktree，断言写入前拒绝、文件字节与原记录 status/targets/checkpoint/claim/comments 不变；单一 guard 不能代替入口回归。只读、显式所属 validate、Human abandon 与终态 archive 验证允许边界。
4. CLI：project upgrade [name] --output --change 的目标选择/阶段结果/失败重试；抽取复用 repair 结果；JSON 错误路由。Embedded 独立分支/master 预检，准备与集成状态分开。
5. Skill：skill upgrade 复用 init force；更新升级主指引、源码/npm 来源、准备/校验/单独 commit/用户审阅及集成；同步 Framework 源/副本与双语 README。
6. 测试：受影响模块/CLI/Git测试，冻结目标回退强校验、metadata-only、同 HEAD 用户记录并存、master/main/detached/集成生命周期/工作树移除、旧 Run fingerprint。
7. 交付门禁：typecheck、全量 npm test、build、Store validate、最终 Memory change validate；记录真实证据并汇总成果，进入研发/架构/测试及产品评审后归档、commit、PR、CI。

当前只完成计划，功能尚未实现；所有失败测试使用临时项目。
