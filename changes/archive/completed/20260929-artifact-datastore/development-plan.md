# Run 附属数据接入开发计划

Run：`run-20260929-121744z-d56a5df3`。依据实施方案第六轮及 Runner 处置记录；需求和技术决策不另行扩张。

## 工作项

1. Project 数据宿主：共享内置 Extension 注册，按既有根目录配置装配四个 raw 模型、八个当前/归档 Store；复用 DataManager，不改变 `src/data/api`，不按 Run 增殖 Store。日志 Store 内部映射 application/x-ndjson → .acp.jsonl。提供业务按 ID 内容访问入口与受控 Store 测试接入。
2. Artifact 接入：正式产物、Submission、冻结上下文、中间产物读写删除经 Artifact Store；文件字节、正式路径、身份和 digest 保持不变，中间产物移出 drafts 目录。CLI/View/Schema 合成与 Review 读取不旁路 Store。
3. 导出与上报：新增统一 Artifact export，默认选择中间产物、当前 Submission 或既有最近 Event；只写用户指定的本地副本，默认不覆盖、force 显式覆盖。最终 report 接受该副本，候选字节只读取校验一次，保留权限、未完成 Schema、revision summary 和冻结边界。
4. Memory 快照：来源枚举后经 Store 保存并一次发布 `memorySnapshot.files`；失败清理本次内容。Run 专用 Provider 按状态清单读取，保留 Memory 解析、逻辑引用与 Project 标签；不改造普通 Project Memory。独立补齐脚本默认检查，显式写入仅补缺失字段，核心不自动扫描旧记录。
5. 活动记录：有限批次首批 create、后续 append，保持运行中读取、原错误回调与不中断 Agent 的策略。日志写入失败后只从实际保存的日志重建后续快照，不重放、不修复损坏完整行；读写经两类 Store。
6. 归档与恢复：Run 业务清单驱动复制覆盖、校验、最后移动原状态文件、旧端清理；已切换重跑只清理。修改两端前保守检查已有 Worker PID，只有 ESRCH 允许继续，无 PID 保留既有处理。元信息保持原格式和最终布局：directory 恢复后位于当前 Run 目录，legacy 恢复不保留归档元信息；有效归档列表以状态文件为准，不以目录或元信息为准。删除受管理旧内容后仅清理空目录，不删除未知文件；清理失败可按有效端状态续做。
7. 同步文档、Skill 和相关 System Memory；改动 Memory 时创建或复用 ChangeSet 并执行变更级校验，保持状态与最终内容匹配。
8. 执行受影响测试与全量验证，报告实际修改、需求映射、兼容结果和未验证项，提交实现与验证 Review，再按流程进入交付及 Human 验收。未通过验收不提交本轮 commit。

## 验证与完成依据

按实施方案第 6 章全部矩阵开展：受控不透明 Store 禁止 list/本地内容旁路，真实 filesystem 验证原布局和 JSONL 映射；覆盖数据隔离、原正式字节和摘要、Memory 清单、export/report、日志零字节/完整行/部分行失败、redo 各边界、PID 保守判断、权限与路径安全。

针对第六轮架构意见增加明确用例：恢复后 listArchived 不显示该 Run，清理元信息或空目录失败后再次 restore 只续做旧端清理；directory/legacy 元信息最终布局与旧行为一致，残留目录不构成归档，未知文件不被删除。

执行 typecheck、受影响套件、全量 npm test、build、memsphere validate；Memory 变更需 memsphere memory change validate。跨平台结果按实际运行及现有 CI 如实说明，不能用 Linux 结果冒充 Windows/macOS 实测。真实前端交互变更时使用 playwright-cli 验证。

采用规范：statements/memsphere-repository-development-rules、statements/memsphere-repository-testing-rules、statements/memsphere-repository-requirement-rules；stable checkpoint 仅按 Human 已确认的本轮例外使用 820530e 回归参照。

当前为开发计划，不是已完成实现或验收证明。出现必须改变已确认 API、布局、配置、兼容性或失败语义的实际问题时，停止依赖该选择的施工并与 Human 决策。
