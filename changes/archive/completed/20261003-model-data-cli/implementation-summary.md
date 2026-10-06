# 模型与数据 CLI：功能实现摘要

Run：`run-20261003-090655z-f1e492f6`。日期：2026-10-05。工作分支：`codex/model-data-cli`，基线：`2b7400b0d3bff6670982ebcd0a02f023a6859e34`。

本文为实现验收候选。最终全量测试 1,062 项：1,061 通过、0 失败、1 项 Windows 专属跳过；独立 typecheck/build、三个发行冒烟和两个 Memory 校验全部通过，证据见验证报告。未提交 Git，也未创建 PR。

## 采用的规则和批准依据

已读取并执行 memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules、memsphere-memory-access-rules、memsphere-yaml-syntax-rules、memsphere-framework，以及当前 Run 冻结的敏捷需求开发流程。落实避免过度设计、System Memory 与 Skill 同步、真实边界验证、变更级校验与验收后归档。

需求依据为第八轮 `submission-20261004-155759z-1145fcad`，SHA-256 `d7293a0552a4c7fb4016402e72cbb42d04089a0b7088f4768778b48704762724`。实施依据为第二轮 `submission-20261005-021129z-820666e3`，SHA-256 `cddc81883d393e375bee3aef3a14ad87cdccccb46c24e558be89c4e7c7f250f8`。上述已批准文件保持原字节。

测试 Agent 的 `comment-20261005-021401z-f192b375` 已落实：独立进程 create/create 只成功一个；create/delete 从不存在和已存在两种状态各控制两种持锁顺序；删除后重建保留递增 revision，旧版本的 update/delete 拒绝，包含 CLI 与 Factory 混合操作。屏障使用 IPC，不依赖固定睡眠。

## 实现行为和主要代码路径

| 范围 | 实现与主要 diff |
| --- | --- |
| 模型命令 | `src/commands/model.ts`、`src/project/model-service.ts`：list/read/create/update/delete/validate；read 仅 definition、registration、all，默认 definition；创建/更新始终完整校验，无草稿、无 create/update --check、无模型级 revision/if-match；管理字段与定义原文分开维护 |
| 统一模型标准 | `model-validation.ts`、`model-schema-references.ts`、`models.ts` 及 json-schema/raw 扩展：全部模型和元模型 ID 以 .json 结尾；只允许本模型内部引用，不加载其他模型或联网解引用；定义合法与 Runtime 不支持使用不同错误，正常读取、写入、导入、安装、恢复和绑定采用同一准入 |
| 系统模型与初始化 | `model-registration.ts`、`system-models.ts`、`system-model-store.ts`、清单及资源：系统定义和全部登记字段通用命令只读；显式 initialize 完成身份统一和安装，保留 UUID/属性/数据地址；重复执行无变化；冲突不覆盖；Run 的 Store ID 与模型 ID 分开，不按模型 ID 重命名物理地址 |
| 多文件模型修改 | `model-operation.ts`、`file-lock.ts`：模型 CRUD、initialize、市场导入及维护恢复共用 Project 写锁和一份修改记录；下一条实际模型写命令先恢复，再加载状态和检查新请求；读/dry-run 不恢复；读取检查修改标记防止半提交或缓存误读；外部新内容保留并报告冲突 |
| 市场与维护入口 | `model-market.ts`、`example-relocation.ts`：发布前完整检查整包，错误时不创建部分可用包；第 06 示例及原型副本改成本模型内部定义。04/05 的约束原样保留，现有 Runtime 不支持时整包明确拒绝。旧未完成导入显式清理，不自动成为正常模型 |
| 业务 Store | `business-stores.ts`、`project/model.ts`、`config-management.ts`、`commands/data-store.ts`：严格 dataStores 绑定；只支持 filesystem data 与 filesystem-json value；相对目录以 Registry Project 根解析；模型/登记/Memory/Run/Archive 等系统目录及全部 linked worktree 的 Memory 都保护；新旧配置执行同一规则；read/list 不打开或创建目录，能力不兼容明确 unavailable；remove 保留数据及版本历史 |
| 数据命令 | `commands/data.ts`、`project/data-service.ts`、`commands/input.ts`：显式 --store 的 CRUD/has/validate/export；整值更新、Payload 字节保真、导出目标不覆盖；纯读和 dry-run 零 Project 写入；stdin 显式使用 -，互斥与能力在消费输入前检查；回执包含实际身份，JSON 成功 stdout/失败 stderr 均为单个值 |
| 数据版本与文件协议 | filesystem-json ValueStore 的 `index.ts`、`revision-state.ts` 及共享文件模块：全部 create/update/delete 入口采用记录级操作系统文件锁；删除历史保留，重建递增；有 expected-revision 则原子条件提交，记录缺失也冲突；无条件写仍互斥；普通 filesystem DataStore 不提供记录 revision/条件写/edit；持久锁和删除历史不当成临时文件删除 |
| 查询与局部修改 | `data/operations/json-path.ts` 使用 RFC 9535 JSONPath，--path <path> 的结果固定数组；`json-patch.ts` 实现 RFC 6902 六操作，在隔离副本完成后一次模型校验及条件提交；中间步骤可暂时不符合模型，失败不部分保存；edit 按实际读取的 revision 保存，不自动重试 |
| 全部 list 分页 | `pagination.ts`、project/memory/archive/model/data/store 命令、Memory serializer/catalog/navigation/factory、ACP Reviewer 入口：默认 100、范围 1–1000、先筛选再分页；统一 items/nextCursor；游标绑定命令/实际范围/筛选/父节点/冻结 Run，允许改变 limit/output；Memory 声明顺序及冻结上下文保留 |
| 文档与发行 | 中英 README、数据层文档、System Memory 三份源及开发副本、Skill、四份 Reviewer 命令模板、原型说明；新增 native lock/JSONPath 依赖并补全许可证通知；CI 增加三 OS 的 Node 20 native/CLI/安装包验证，保留 Node 22 全量 |

`host.source()` 是内部用于修复或删除坏定义的受控读取方法，保留路径、登记绑定和冲突检查；它不是重新增加 CLI source 分项。替换坏定义检查新的候选；仅改登记仍必须检查现有定义。直接业务 Store 绑定即使为空，也阻止定义变化和删除。

文件锁分两处：filesystem JSON ValueStore 的记录锁保障同一记录的跨进程写入；独立 Project 锁协调模型多文件修改、配置和业务写入口。普通 DataStore 不增加记录锁能力。恢复属于共同模型写服务，`project models initialize` 是调用方之一，并非唯一恢复入口。

## 实际开发 Project 的修正

在隔离回归通过后，对 Registry Project `memsphere` 执行新构建 CLI 的 `project models initialize`。共修改六个模型文件：五份系统登记的 modelRef 增加 .json，登记模型中示例 modelRef 同步；UUID、其他管理字段和记录地址保留。重复执行无变化。当前 16 个模型全部使用统一 ID：7 个可用，9 个 run-domain 定义按原约束明确报 `MODEL_RUNTIME_UNSUPPORTED`。这 9 个定义没有被删除或弱化，Run 继续按对应 raw 模型工作。

前后逐文件核对 10,679 份 Run/Archive 历史文件，字节全部未改变。冻结历史只作为历史证据，不作为旧规则下的可用模型。证据为 `actual-project-audit.json`，另见 `standards-audit.md`。实际 Project 当前没有业务 Store 配置；新旧绑定规则由真实临时 Project 和 CLI 负向回归验证。

## 验证和已知边界

最终命令、结果、A1–A25 映射及首轮失败处理见 `initial-validation-report.md` 和 `implementation-acceptance.md`。受影响模块、真实 CLI、跨进程、故障中断及实际 View 操作均已执行；最终全量结果以报告为准。

本轮不扩展 Runtime、不支持跨模型引用、不提供整体模型修订号、业务 Store 迁移或多记录事务。普通 DataStore 的 Payload 写入保证字节和 MIME 协议，不声称能验证任意二进制的模型语义。数据扫描和分页不承诺快照；外部手工修改不属于应用锁协调范围。原始模型 JSON Schema 中的官方 URI 与模型 ID 分工不变。

本地实测平台为 Linux、Node 22.16.0、npm 10.9.2。Node 20、macOS、Windows 仅已配置 CI，尚未在本次本地执行；不以依赖上游支持说明代替结果。native 锁要求受支持的本地文件系统；没有对网络文件系统作互斥或崩溃持久性的承诺。

没有新增 Memory DSL 关键字或实体字段。Memory 更新为 framework、memory-access-rules、yaml-syntax-rules，发行源与工作树副本一致；yaml-syntax-rules 明确 CLI 分页字段不属于 DSL。最终 Memory ChangeSet 为 change-20261005-031024825z-a1b5f8c3，embedded/active、validation passed，content digest e62d52dda1c709b34a59320245f3fa899f6092e8b550ade9c5c82e7d4a654022；View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。当前三份源与副本一致；完整验证命令见报告。

## 修改文件

完整文件清单见 `changed-files.txt`。清单由最终提交评审时的 git diff 与未跟踪文件生成，包含代码、测试、资源、文档和本需求记录；所有条目均在本轮工作树中可审阅。关键新增测试覆盖模型服务/CLI/恢复、业务 Store/数据 CLI、JSONPath/Patch、文件记录版本/真实进程竞争、分页与 CLI 错误。
