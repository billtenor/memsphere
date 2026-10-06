# 模型与数据 CLI：实现与验证验收材料

Run：`run-20261003-090655z-f1e492f6`。日期：2026-10-05。候选是当前 `codex/model-data-cli` 工作树，基线 `2b7400b0d3bff6670982ebcd0a02f023a6859e34`。请正式研发/测试/架构 Reviewer 直接检查实际源码、资源、测试及 git diff；辅助 Agent 意见不代替本轮正式投票。

## 验收依据与材料

第八轮需求 `submission-20261004-155759z-1145fcad`、第二轮实施方案 `submission-20261005-021129z-820666e3` 已获批准，原文件不修改。Task List D0–D8 逐项实施。功能摘要见 `implementation-summary.md`，完整命令/实际结果/失败处置与平台限制见 `initial-validation-report.md` 和 `verification-results.json`；实际 playwright-cli 与模型侧命令见 `browser-verification.md`；全部变更文件见 `changed-files.txt`。

## A1–A25 对照

| 验收项 | 实现及实际验证证据 |
| --- | --- |
| A1 项目定位 | model-command/data-command/business-data-service：显式 --project、cwd 输入路径与 Registry Project 根分工；真实 linked worktree Memory 区受保护；回执身份明确 |
| A2 模型 CRUD | model-service/model-command：原始定义与管理字段分开、一致提交、重复拒绝、project/market 删除后不被重新扫描，publication 索引同步 |
| A3 元信息和 system 只读 | model-service/model-command：省略字段保留、unset 与空说明区分、包名一致；不合规登记修改拒绝；全部系统定义/元信息 create/update/delete/dry-run 及未闭合 stdin 前拒绝 |
| A4 定义与 Runtime | model-validation/model-service/project-models/model-market/system-models/example-relocation/View：同一合法但不支持定义新旧一致拒绝且定位，definition 单项通过不代表可用，runtime 完整检查；无 create/update --check，无半发布 |
| A5 直接使用保护 | model-service/model-command：空 Store 和多 Store 直接绑定阻止定义变化/删除，登记允许；未用模型修复/替换；不构建模型间依赖图 |
| A6 Store 管理闭环 | business-data-service/data-command：两种配置、实际目录/能力、解除保留、重新登记、目录协议/别名/系统区域拒绝；raw ValueStore 与 raw DataStore 能力明确区分 |
| A7 数据 CRUD | business-data-service/data-command/data-filesystem-json-valuestore：null/标量/数组/对象、重复和缺失、完整替换、has/list，无隐式 upsert |
| A8 path 和 edit | json-path/json-patch/business-data-service/data-command：JSONPath 根、特殊名、下标/切片/通配/递归/筛选/函数，固定数组返回；RFC 6902 六操作、根/数组/特殊键、仅最终校验、失败不保存 |
| A9 跨进程条件写 | data-filesystem-process/data-command/file-lock：IPC 控制的独立 create/create、create/delete 两种初态 × 两种持锁顺序的四组合、update/delete 组合、无条件两写、CLI/Factory 共锁、edit/edit 同读版本只成功一个；删除重建旧条件拒绝 |
| A10 DataStore 能力 | data-command/business-data-service：无 revision 时 expected-revision/edit 写前拒绝；Store read 不虚报条件写或值能力 |
| A11 Payload/export | business-data-service/data-command：非文本原字节/MIME 保真、结构化 JSON、已存在目标拒绝、stdout 原始正文不混回执 |
| A12 机器输出 | cli-errors/model-command/data-command/list-pagination-cli：解析/参数/能力/输入/验证/冲突错误单个 stderr JSON、stdout 为空、非零退出；成功单个 stdout JSON |
| A13 纯读/dry-run | model-service/model-command/business-data-service/data-command/project-models：Tree 快照比较文件、字节和 mtime，缺失系统不虚拟补行或初始化；export 仅写显式目标 |
| A14 系统区域保护 | business-data-service/config-management/data-command：模型/登记/Run/Archive/Memory 含全部 linked worktree、目录别名、保留 ID 均拒绝，原 Run/Review/归档流程全量回归 |
| A15 完整检查 | 最终 typecheck/npm test/build/validate 命令与退出码见 verification-results.json；首轮失败独立留档，全部修正后最终整轮重新执行 |
| A16 Memory/Skill | 三份 System Memory 源与副本同步、Skill/README/模板更新；reserved-store/skill-store/prompt-renderer、Memory schema/syntax/serializer 在全量中执行；最终 ChangeSet 证据见下节 |
| A17 安装一致 | system-models/model-registration/project-models：Project 创建与 initialize 同一 ID/Runtime 标准、重复不改、损坏冲突拒绝、不开放系统通用写入 |
| A18 损坏隔离 | project-models/model-service：普通模型 unavailable 隔离展示，必要系统文件损坏明确失败，不隐式替换；原文保留、读零修复 |
| A19 引用一致 | model-schema-references/model-validation/model-service/model-market/example-relocation：有效本地与递归引用、片段、非法目标、嵌套跨模型引用；数据里的普通 $ref 不误报；不加载其他模型、无新旧放行例外 |
| A20 实际资产 | reserved-models/model-market/model-registration 测试、builtin View、actual-project-audit：04/05 明确不支持、整包失败零发布；06 与原型副本改本地定义；系统 JSON/raw 正常；实际 9 个 run-domain 保留约束且 unavailable，raw Run 仍正常 |
| A21 read 分项 | model-service/model-command：仅 registration/definition/all、默认 definition；已删除选项报参数错误，不合规正常读拒绝；内部 source 方法不暴露为命令 |
| A22 身份修正/恢复 | model-registration/system-models/config-management：对应关系与绑定修正、UUID/属性保留、旧 ID 不别名、冲突拒绝、重复幂等；model-operation 真实 SIGKILL 写入 pending、file-0/1/2 和恢复 pending、file-0，再验证后来修改冲突；实际 Project 10,679 份初始化前历史文件字节保留 |
| A23 新旧 Store 规则 | business-data-service/data-filesystem-datastore/config-management：未知字段/kind/Factory/目录/MIME 新旧一致拒绝；__proto__ 一致拒绝、constructor/toString 正常；默认/替换/禁用/复合后缀实际映射、跨 cwd 相同结果 |
| A24 全标准审查 | standards-audit、实际 Project 盘点、model-market/example-relocation：统一身份/无跨模型引用/配置协议，04/05 与 9 个域 Schema 不支持则拒绝，不删约束或以历史字节豁免；全部发布/恢复入口统一 |
| A25 全部 list | pagination/list-pagination-cli/memory-catalog/navigation/serializer/command：六入口、子节点、Reviewer 冻结 Run，默认/1/1000/非法范围、先筛选、多页无遗漏、limit/output 可变、其他scope 不可复用、统一 items/nextCursor |

## 重点审阅的技术边界

filesystem JSON ValueStore 的记录锁与 Project 修改锁分工明确；普通 DataStore 无记录条件写能力。删除后保留 revision 历史，旧条件不能命中新记录。模型无整体 revision/if-match，模型锁和修改记录只保证当前写入协调及定义/登记一致，不宣称为调用方更早读到的模型提供版本保护。

共同模型写服务先恢复再加载及预检；initialize、CRUD、导入和维护恢复都是调用方。纯读和 dry-run 不写恢复记录或锁。修改记录仅覆盖这一次模型操作的有限文件；后来手工修改不覆盖，明确报告冲突。已提交但回执丢失不把成功撤回为失败。

Runtime 能力保留现状：现有 04/05 和 9 个域模型均明确拒绝，支持资源才成功。JSON Schema 官方 URI 不是模型路径，模型内引用没有跨模型能力。业务 Payload 路径保证字节/MIME，不能冒充结构化校验。

## 最终 Memory 证据

ChangeSet `change-20261005-031024825z-a1b5f8c3`，embedded、active、validation passed；base `2b7400b0d3bff6670982ebcd0a02f023a6859e34`；digest `e62d52dda1c709b34a59320245f3fa899f6092e8b550ade9c5c82e7d4a654022`。

View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。普通 validate 和变更级 validate 均真实通过，无新增 Memory identity/DSL 关键字。

## 待确认项

本轮产品/架构行为没有新增待决策项。请研发、测试、架构 Agent 及 Human 架构师评审实际候选并正式投票。Node 20/macOS/Windows 的远程 CI 尚未执行，材料明示本地 Linux Node 22 验证范围，不能把 CI 配置当作平台通过。

尚未交付验收、归档、commit 或创建 PR。若本轮发现需要变更已批准行为，先形成修订和同等确认；实现缺陷直接修正并重跑相应验证。
