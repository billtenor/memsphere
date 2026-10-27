# 旧 Skill 能力盘点与修订依据

基线：`master:src/skills/memsphere/SKILL.md`（571 行）。逐段读取旧版，并核对当前 CLI 注册、随包 System Memory 与实际实现。47 行版本仅作为待纠正版本，不能作为能力清单来源。下列“保留”均指在单个 `SKILL.md` 中保留可执行指导；没有新增 Skill 引用文件。

| 原版位置 | 能力或约束 | 47 行版问题 | 修订处理与核查来源 |
|---|---|---|---|
| 8–18 | 个性化软件定位、Agent 关系、Memory/CLI/数据/界面四类资产、Node/语言 | 只剩概念名称和转读入口 | 恢复简短定位、运行前提、Home 语言与 Run 冻结区别；framework/personalized-software Concept、package.json |
| 20–24 | Memory 最终内容的变更级校验与交付证据 | 核心门禁保留 | 保留，并补全发布路径；memory change validate、publish |
| 26–28 | App 安装、检查、启用、使用与 View 生效 | 只有 Memory 名称 | 恢复 install→check→enable→show，可信目录与配置；app Help、app-usage-rules |
| 30 | 外部 CLI 描述、独立安装、绑定、发现、执行 | 缺入口和执行方式 | 恢复 register/bind/list/show/check 关系、envFrom 与凭据边界；cli Help |
| 32 | App 停用、失败重试、Managed/Embedded、能力限制 | 缺关键完成条件 | 保留停用影响、同发行目录重试与当前无升级/卸载；app-usage-rules |
| 36–49 | 模型定义/登记、.json ID、CRUD、合法性与 Runtime | 仅让查 Help | 恢复最短读写/验证例、系统模型只读、本地与跨模型引用限制；model Help、src/model |
| 49–60 | 模型路径基准、初始化、身份与中断恢复 | 全部缺失 | 保留 Project 根基准、initialize 用途和写入中断重试；project models Help、模型实现 |
| 62 | 模型市场示例与不支持规则 | 缺独立导入能力与错误处理 | 保留市场导入入口位于 View、不修改规则绕过 Runtime；去掉具体示例编号的历史细节，完整信息查原始定义 |
| 64–78 | 业务 Store 显式登记、Factory、数据 CRUD/编辑/导出、条件写 | 全部缺失 | 保留两类 Store、最短写读例、revision/JSONPath/JSON Patch 及路径边界；data Help、业务 Store 实现 |
| 80 | list 分页、JSON/文本回执、stdin/原始导出 | 仅 Memory 翻页 | 扩为通用分页与输出规则，保留原文导出/文件目标约束；list/export Help |
| 83–109 | 自由探索启动、Continue、外部材料、提交、修订、成果、结束、归档 | 新版主体保留 | 保留用户已确认原则，去掉五个 Store、图布局和持久化实现描述；run/continue Help、run Concept |
| 111–120 | Concept/Statement/Procedure/Schema 分工 | 保留但过短 | 在定位与发现部分解释关系，不重复单列概念清单 |
| 122–174 | 发现/读取、canonical/alias、Node/context、未绑定 Project | Node 引用与逻辑引用边界不完整 | 恢复 logical reference、canonical 命名与 node_ref 原样传递、Concept 完整读取；memory Help、memory-access-rules |
| 176–180 | Project 创建/绑定/挂载、三种 Store、repair、worktree 映射 | 仅只读边界 | 恢复 Project 工作路径、CLI/View 映射区别与 repair 完成语义；project Help、project resolver |
| 182–196 | CLI/Skill/Project 三类升级、安装来源、顺序与目标范围 | 只有一句命令说明 | 恢复三类操作表、npm/源码链接识别、目标优先级及完成报告；skill/project upgrade Help |
| 198–208 | Managed/Embedded 系统升级、专用 ChangeSet、重试与集成状态 | 全部缺失 | 保留独立 master worktree、专用记录重试、共享模型状态、pending/committed/integrated 与历史快照边界；project-upgrade/changeset 实现 |
| 210–214 | Managed 候选与 Embedded 校验、ChangeSet 生命周期 | 缺编辑入口与完成条件 | 恢复 edit→validate→publish/Git 集成，稀疏候选非完整 Memory Root；memory change Help |
| 216 | Memory/模型市场的发现与受控导入 | 全部缺失 | 恢复 View 市场→ChangeSet→验证→发布、导入后独立演进；不复述 UI 文案细节 |
| 218–224 | View 意见处理、claim/finish/complete、终态只读、并发保护 | 全部缺失 | 恢复 claim→处理→validate→finish、force 授权边界、无差异 complete；changeset-comment-processing、CLI Help |
| 226–228 | Managed publish、Embedded import/app publish、普通 Git 集成 | 只提受控 ChangeSet | 恢复不同发布路径与完成条件、失败时不用手工改状态；memory publish 实现 |
| 230–258 | tagged YAML、syntax、canonical、引用通道、Procedure 写作规则 | 全部缺失 | 恢复最小 Memory 示例及易误用约束，明确读取对应 Concept、Schema、syntax/writing Statement；随包 Memory |
| 260–294、338–349 | Artifact type/format/schema、继承/数组/optional/repeat 与自然语言规则 | 只提 CLI 提示 | 保留契约层次、推断/继承区别和易错点，完整字段按命名 Memory 读取；schema Concept、syntax-rules |
| 296–300、453–455 | 模型 Artifact、Store 绑定、data_id、接受后整条 upsert | 全部缺失 | 恢复业务 Store 绑定与稳定 ID 操作、冻结目标/接受写入/历史独立；run report Help、run-model-artifact 测试 |
| 302–311 | Review Slot/Actor/Policy、ACP Provider 与 Windows | 全部缺失 | 恢复预检→review-config、skip、权限与 Provider 配置位置、运行前提；run start Help、Actor Concept |
| 312 | 未来 Review Slot 换绑 | 全部缺失 | 保留 binding show/update、只用冻结 Actor、当前轮不变；binding Help |
| 313–321、479–505 | Review 门禁、Agent/Runner 分工、Human 票、定位意见、调试 | 只剩 wait/Runner 的泛述 | 恢复真实 Agent submit、Runner 显式票、Human 授权代投、失败一次重试及 try-run 调试入口；review Help/Concept |
| 322–337 | Home/Project 配置、语言、Provider、Actor、View 服务 | 全部缺失 | 保留配置位置与 scope、保存 diff、重启条件、权限不等同 OS 授权；View/Actor Concept |
| 326–328、559–563 | View Package/Module、主题/Slot、SDK、真实 Shell 验证 | 全部缺失 | 保留可信包安装选择/重启、开发层次和公共 API/Token 边界，细节指向 memsphere-view 与仓库示例；删除宽度/折叠/布局实现复述 |
| 350–378 | 适用流程选择、Concept/Statement/Schema 按需应用 | 已改为两种 Run | 保留已确认新路由，明确移除“永远 Procedure”和通用流程兜底；用户确认、framework/run Concept |
| 380–421 | 持续推进、复用 Run、--file/--change、冻结候选 Memory | --change 与暂停恢复细节缺失 | 恢复冻结快照读取和候选试运行、当前步骤/Then、自主推进及明确暂停信息；run start Help |
| 423–451 | 读懂 Do/Ask human/Artifact/Then 与权限 | 不完整 | 保留人机边界和逐步推进，合并提示标签解释，避免冗长逐标签字典 |
| 457–505 | report、权限拒绝、Review 修订与失败恢复 | 缺失败重试和 revision-summary | 恢复 CLI 提示驱动、同参数权限恢复、完整新版本/摘要与 Runner 投票；review/report Help |
| 507–535 | Schema show、repeat、skip、全局调整、export→report | 全部缺失 | 恢复完整最短收尾路径；schema/repeat/skip/artifact export Help |
| 537–545 | 历史 Run 清单补齐、归档恢复失败重试 | 只有归档命令 | 保留遇到缺清单时的显式工具与检查/写入边界，去掉 .gitkeep/复制顺序等实现细节；backfill 脚本、archive Help |
| 547–557 | Human 决定 abandon、终态、单独归档 | 核心保留 | 补充原因文件、终态与归档分别处理；run abandon/archive Help |
| 565–569 | Human Action 与结果上报 | 仅一句 | 明确等待 Human 的当前步骤结果、按返回命令上报再继续 |
| 571 | 三类旧语法迁移检查、写入确认、Store 与历史边界 | 全部缺失 | 恢复 --check 诊断→授权迁移、Managed 候选路径、旧 running Run 不跨版本续跑；migrate Help |

盘点结论：原版各段都已纳入以上处理。应删除的是已失效的 Procedure 强制兜底、重复讲解以及不改变 Agent 操作的持久化/UI 实现细节；升级、变更发布、Schema 收尾、Review 人机协作等任务路径必须直接保留。

验证从本表独立选取真实任务：整体升级与源码链接、Embedded 升级恢复、Managed Memory 修改与发布、View Comment 处理、模型/Store/业务数据、Review 预检与失败恢复、Schema 全局调整、View 扩展与配置、旧语法迁移；原有自由探索场景继续覆盖模式选择和 Artifact 克制上报。技术 Review 需对照旧版检查遗漏，不能只接受本表或新版正文的自述。

## 第一轮复审后的实现核查

- 恢复旧版仅两种暂停条件及同一事项连续等待超过五分钟、轮询不重置计时的可判定边界；用独立时间情境实际检查 Agent 判断。
- memory edit 的现有实现支持新 canonical 引用创建模板，已补回操作入口并纠正 Help。memory delete/rename 的专用命令当前只支持 Managed，Embedded 的文件/YAML 变更与校验路径单独说明。
- finishMemoryChange 的现有 guard 要求本次 finish 包含全部 processing Comment，且命令只接受一个 reason。修正 Skill、Help 与两份随包/开发流程 Memory，不改变运行时；不同结论无法分批结算时保留现场并说明限制。
- 用可重放的 capability-checks.mjs 替代只凭临时计划案例证明 Comment/App 行为的不足。原 App 场景只认定为规划检查，不能作为真实安装/绑定证据。

## 验收结论

产品反馈后的补充技术复审第 2 轮研发、测试、架构及 Runner 均通过；产品交付第 2 轮产品负责人正式通过。最终 Skill 的七类可重放检查通过，另有规划/基础行为任务、底层回归及逐段源代码核查；未声称表内每条能力都已在最终字节上完成在线 Agent 重跑。剩余覆盖建议已 accepted-followup。后续维护从本表检查遗漏，不恢复行数配额或用提及名称代替操作指导。
