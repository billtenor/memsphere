# 第四轮：需求补充确认与实施方案评审

本轮请 Human 同时以需求负责人确认下述完整需求契约的新增章节，并以架构师评审实施方案。当前已通过的第三轮需求快照仍是历史依据；下述需求补充通过后作为后续实施约束，不在确认前施工。

# Memsphere 升级路径与统一项目运行升级：需求契约

## 整体目标与当前问题

用户升级 Memsphere 时，需要分别了解程序、Agent Skill、项目系统记忆、项目系统模型及登记、View 进程与旧格式迁移，当前缺少统一而明确的操作入口。尤其项目系统记忆与系统模型/登记分属两个命令，执行其中一项容易误以为项目运行环境已整体更新。

调查确认：`project repair` 更新 System Memory；`project models initialize` 安装系统模型、建立登记并兼容旧 ID，但已安装系统模型定义与当前内置定义不一致时会报冲突。因此“调用两个旧命令”本身不能证明实现了完整项目升级。

理想态：Human 与 Agent 能从 Skill 找到适合当前安装方式的完整升级路径；对一个目标项目，只调用一个统一入口，就能完成其系统记忆和系统模型/登记的升级，并得到清楚、可信、可复核的整体结果。

## 已确认的范围与参与者

Human 已明确选择：统一命令负责“项目升级：系统记忆＋系统模型/登记”；CLI、Skill 等完整升级路径也在本轮明确，统一项目命令的自动执行范围不扩大到 CLI 自安装或全局 Skill 覆盖。

Human 额外参与产品负责人（需求负责人）与架构师；对应产品、研发、测试、架构 Agent 全部按流程参与。评审绑定见 review-config.json。

## 三类升级与 Agent 使用入口

升级对外收敛为三类，必须明确写入本轮交付的 Memsphere Skill：

| 类别 | 范围 | 操作入口 |
|---|---|---|
| 项目运行资源升级 | 指定项目的系统记忆、系统模型、模型登记与必要绑定 | 本轮新增 `memsphere project upgrade [项目名]` |
| Skill 升级 | 将选定安装位置的 Memsphere Agent Skill 更新为当前 CLI 随包提供的版本 | 本轮新增 `memsphere skill upgrade`，等价于相同目标参数下的 `memsphere skill init --force` |
| CLI 本身升级 | 更新 Memsphere 程序及随包资源 | npm 安装使用相应 npm 升级操作；本地源码连接使用同步源码、重新构建的方式，按实际安装来源选择 |

项目运行资源升级不会自动改写普通业务数据。View 重启和确需的旧格式迁移是上述升级过程的配套步骤，Skill 应说明其触发条件与处理方式，不能将它们误认为每次必做的第四/第五类独立升级。

### 用户如何发起

用户启用 Memsphere Skill，或直接对具备该 Skill 的 Agent 说“用 Memsphere 帮我升级”。例如“升级 family 项目的运行资源”“更新 Memsphere Skill”“协助我完整升级 Memsphere”。Agent 应根据已安装的 Skill 主动组织步骤，而不是让用户先记住所有 CLI 命令。

`memsphere skill` 是管理 Skill 文件的 CLI 命令组；使用 Agent 的 Memsphere Skill 是读取该 Skill 并按其指引协作，两者的用户入口需说明清楚。

Skill 必须指导 Agent：识别用户希望升级哪一类或哪些类、CLI 的实际安装来源、Skill 的目标安装位置，以及项目名和存储类型；从已有上下文能确定时直接使用，关键信息缺失时才询问。完成所需升级后验证各类实际结果，报告成功、失败或尚未完成的部分，不能把一项完成当作所有升级完成。

用户要求整体升级时，先更新作为内置资源来源的 CLI，再更新选定 Skill 和目标项目运行资源，最后按需要重启 View 或处理明确要求的迁移。具体版本确有额外前置条件时按兼容要求调整顺序；不自动扩大为全部项目，也不引入自动下载安装 CLI 的新通用命令。用户只要求某一类升级时，执行该类及确有必要的前置步骤。

### 新增 Skill 升级命令

```bash
memsphere skill upgrade
memsphere skill upgrade --global
memsphere skill upgrade --directory <路径>
```

新命令的默认位置与 `skill init` 一致，`--global`、`--directory` 的选择规则、校验和冲突行为沿用现有 `init`。`upgrade` 内置覆盖安装语义，不要求用户额外传 `--force`：相同目标参数下，效果等价于 `init --force`。保留 `init` 用于首次安装；不影响目标之外的其他 Skill。无效参数或文件操作失败明确报错，不声称完成。内部复用方式由实施方案决定。

## 新增命令与功能契约

本轮新增 `memsphere project upgrade`，作为项目运行升级的统一入口；Skill 升级另有上文规定的 `memsphere skill upgrade`。以下是本轮要求实现的用户功能，当前尚未实施。

### 调用方式与目标选择

```bash
# 升级指定项目
memsphere project upgrade memorybase
memsphere project upgrade family

# 升级当前工作区的 Primary 项目
memsphere project upgrade

# 通过全局参数选择项目
memsphere --project family project upgrade

# 获取结构化结果
memsphere project upgrade family --output json
```

命令形式为 `memsphere project upgrade [项目名] [--output text|json] [--change <升级 ChangeSet ID>]`，默认输出 text。目标选择顺序为显式项目名、全局 `--project`、当前 Primary。不存在目标、没有 Primary 或上下文不能安全定位目标时明确失败，不猜测项目、不自动处理全部项目。Embedded 项目使用其匹配仓库的当前有效 worktree，不回退写入其他 worktree。

### 一次调用完成的功能

| 功能 | 要求的行为 |
|---|---|
| 系统记忆升级 | 将内置清单管理的 System Memory 更新到当前执行 CLI 所附带的内容，补齐缺失项、按既有清理准入处理明确废弃项，校验完整有效 Memory；用户 Memory 保持不变。Managed 完成受控校验与发布，Embedded 保留可审阅的当前 worktree 差异并遵守脏目标保护。 |
| 系统模型升级 | 补装应有的系统模型，并将归属于 System 的已安装模型定义更新到当前 CLI 支持的内置定义。必须处理真实定义变化，不能只在首次安装时工作。升级目标须通过 Runtime/结构及相关绑定一致性检查；用户同名模型、损坏或不支持/不安全的变化明确失败，不强行覆盖或扩大 Runtime 能力。 |
| 模型登记与绑定维护 | 为需要登记的资源补齐登记，执行当前支持的旧身份转换，并同步必要的引用和 Store 绑定。保留已有登记 UUID、来源与必要管理属性，普通模型原文、业务记录和冻结历史保持不变；不能自动改写业务数据来让模型升级通过。 |
| 完整结果与重试 | 同次调用检查两类系统资源，即使只有其中一类需要变更也检查另一类。输出目标、两类资源各自的处理结果与整体结果；仅全部完成并通过必要校验时成功。无变化时报告已是最新，重复执行不制造无意义 Revision 或改变用户数据。失败明确指出阶段及完成/未完成部分，修正后重试可以完成。 |

同一次调用的“升级目标”是当前 CLI 附带的系统资源，不自行下载或安装新的 CLI。CLI/Skill 升级、View 重启和需要单独确认的旧格式迁移由完整升级指引组织；本命令自动处理的范围是 Human 已选择的项目系统记忆与系统模型/登记。

### 输出与成功判据

文本和 JSON 输出均需表达：目标项目、存储类型、当前 CLI 的升级目标说明、系统记忆的创建/更新/删除或无变化结果、系统模型及登记的安装/更新/保留或失败结果、必要校验与整体状态。涉及 Memory 变更时，应能追溯其变更与发布结果；有 ChangeSet 的结果给出 ID、校验状态与 View 入口。

整体状态为“已升级”“已是最新”或“失败”。仅两类资源均已达到目标且必要校验通过时返回成功退出码 0；任何子项失败返回非零退出码，并明确失败原因及哪些部分已经完成或尚未完成，不把部分完成表示为整体成功。输出字段的精确编码、执行顺序和恢复机制在实施方案中设计。

### 与现有命令的关系

保留 `memsphere project repair` 和 `memsphere project models initialize` 的现有用途与行为，便于单项操作；完整项目运行升级的推荐入口改为 `memsphere project upgrade`。Skill、CLI 帮助、README 和升级流程记忆（若采用）统一使用这个名称，不能继续要求使用者手工拼接两个旧命令才能完成完整项目升级。

## 当前迭代范围

1. 明确完整升级操作的对象、适用条件、先后关系和完成判据，涵盖 CLI、Skill、项目系统记忆、系统模型/登记、正在运行的 View，以及版本确需时的旧格式迁移。区分 npm 安装与本地源码连接等安装方式，不能让 Agent 机械套用不适合当前机器的命令。
2. 提供统一的项目运行升级 CLI 入口：同一次调用处理一个明确目标项目的系统记忆和系统模型/登记。支持显式目标与当前 Primary 的一致选择规则，Managed 与 Embedded 均应有清楚且符合其存储方式的行为。
3. 系统资源确实更新到当前 CLI 支持的内置版本；模型缺失、需要安装/登记、已安装定义变化或当前支持的旧 ID 转换均需有明确处理。不能把定义差异静默忽略，也不能将初始化冲突误报为“升级完成”。支持哪些定义变化及其准入边界由实施方案说明，遇到不支持或不安全的变化必须明确失败，不强行扩大 Runtime 能力。
4. 保护用户 Memory、普通模型原文、业务记录、登记 UUID 与必要管理属性；应有的身份/绑定调整明确、可追溯。历史 Run 和冻结产物不因升级被改写；运行中 Run 受版本变化影响时有清楚且符合现有契约的处理，不为了让升级成功篡改旧快照。
5. 完整结果明确显示两类资源各自的处理状态和整体成功/失败。某一部分失败时不能声称整体完成，应指出失败位置及已完成/未完成部分，并允许修正后重试。是否采用跨资源原子性、操作顺序和具体恢复方式属于方案决策，当前不预设新的跨层事务框架。
6. 本轮新增 `memsphere skill upgrade`，功能等价于同目标参数的 `skill init --force`，支持默认位置、--global 与 --directory。Skill 必须提供三类升级及 Agent 协助入口的明确说明；详细说明可集中在 Skill 或专用升级流程记忆中，方案阶段决定，不重复维护多份完整规范。保留现有独立命令的行为；统一入口必须存在。

## 交付物

- 可执行的 `memsphere project upgrade`、`memsphere skill upgrade` 及明确帮助/结果输出。
- Skill 升级入口、完整升级指引及其单一主要说明来源；如采用流程记忆，则同步内置安装清单与当前 Project。
- 当前范围的实现、自动化测试和相关仓库说明，验证报告记录真实命令与结果。
- 按已安装敏捷流程完成需求/方案/成果/交付评审、归档、commit、PR，以及最终提交全部适用 CI 通过。

## 验收标准

1. CLI 提供本契约规定的 `memsphere project upgrade [项目名] [--output text|json] [--change <升级 ChangeSet ID>]`；验证显式项目名、全局 --project 与 Primary 的选择顺序、无目标明确失败、文本/JSON 两种结果、整体成功退出码和失败非零退出码。所有说明入口采用相同命令名称，现有单项命令行为保留。
2. `skill upgrade` 与同位置参数的 `skill init --force` 产生相同安装结果；覆盖默认位置、--global、--directory、已有目标更新、无效参数/文件失败，保留 init 行为且不改其他 Skill。
3. Skill 明确写出三类升级及其入口，用户用自然语言发起升级后，Agent 能识别类别、来源和目标，并据此组织步骤和核对完整结果。从 Skill 入口可确定完整升级步骤，区分当前安装来源和目标项目类型；能解释哪些资源由 CLI 包提供、哪些需项目更新、何时需重启 View/进行迁移。不能遗漏系统模型/登记，或把旧初始化命令宣称为通用升级。
4. 在受控临时 Managed 项目上，一次统一调用同时完成需要更新的系统记忆与系统模型/登记；最终系统资源与当前支持的内置目标一致，Memory 校验通过并正常发布。
5. 在受控临时 Embedded 项目上统一调用同样覆盖两类资源；遵循当前 worktree、脏目标保护与存储边界，Memory 变更可审阅，不自动 commit/push，不写其他 worktree。
6. 覆盖仅 Memory 需要更新、仅模型/登记需要处理，以及已处于最新状态的情况。无变化的重复执行不制造无意义 Memory Revision，不改变登记 UUID或业务数据。
7. 至少覆盖模型定义变化/当前支持的身份转换、用户同名冲突、损坏或不支持资源、Embedded 脏目标等本次涉及的失败路径。失败不会静默覆盖用户内容，也不会返回整体成功；修正问题后可重试并达成完整升级。
8. 对用户 Memory、普通模型、登记/业务记录及冻结历史做升级前后核对，证明本轮更新范围和保护要求。使用临时项目，不把真实用户项目作为破坏性失败测试对象。
9. CLI、Skill、System Memory、README/帮助等相关入口一致。交付前必须实际通过 `npm run typecheck`、`npm test` 全量回归、`npm run build` 和 `memsphere validate`；有 Memory 交付差异时，还必须在最终内容上执行 `memsphere memory change validate [change-id]`，记录 ChangeSet ID、校验状态和 View 入口。实际命令、结果和未执行项在验证报告中区分，有失败不得声称完成。

## 向前兼容

结论：不需要向前兼容。当前 Git Tag 中没有名称包含 stable 的适用 checkpoint，不扩展为所有历史版本的无限兼容责任。

现有项目的安全升级、当前支持的旧身份转换、用户数据和历史保护是本轮需求本身；现有独立命令按本契约保留，不能用“无 stable checkpoint”回避这些要求。

## 后续范围

全套自升级命令（自动更新 CLI、全局 Skill 和所有项目）、项目批量升级调度、App 专用升级协议、任意第三方 View Package 更新，以及所有历史/未来数据格式的自动迁移不在本轮自动执行范围。市场导入 Memory 的显式重新导入等边界应在升级说明中交代，不纳入系统资源强制覆盖。

## 待确认项与方案阶段决策

当前核心范围已由 Human 明确。两个新命令名称、目标选择、对外功能、三类升级模型、Agent 使用入口、结果和既有命令关系已在本契约明确。Skill 与升级 Procedure 的分工、内部实现、两类资源的执行顺序、模型升级准入的实现细节和失败恢复方式由方案阶段提出并经架构/研发/测试评审。

## 本轮需求补充：独立升级交付（待 Human 确认）

本节与修订方案一并供 Human 以需求负责人身份确认；确认前不施工。本节补充此前需求快照，未修改三类升级范围。

系统记忆实际变更使用专用 ChangeSet，targets 仅包含本次 System 升级；不混入、复用或改写用户现有记忆差异和协作 ChangeSet。Managed 仍受控校验/发布。Embedded 的 Agent 协作需准备独立升级分支与 worktree，并在校验审阅后形成仅含本次系统记忆变化的单独 commit；Skill 提供准备、审阅、冲突处理和集成的详细指引。

project upgrade 增加可选 --change <id>，用于显式重试当前项目/升级 worktree 的 active 专用升级记录。错误用途、其他 worktree、终态、基线或升级目标变化均明确失败，不另行复用用户记录。专用记录用途与目标范围持久化，是本轮必要实现范围；通用 claim/scope/publish/complete 等操作不能绕过隔离或完成规则。

Embedded 命令成功表示升级差异已准备并通过目标版本校验、模型阶段已完成；必须明确 integrationStatus=pending，不表示主分支已更新。单独 commit 后仍待集成，合入后才完成。CLI 不自动 commit/push/merge，Agent 按任务授权执行 Git 步骤，需用户决策的基线/冲突/最终合入给予具体引导。

本轮沿用当前 Embedded ChangeSet 的 master 完成判据：独立升级分支从 refs/heads/master 准备，以 master 为集成目标。不得按主 worktree 当前分支、远端默认分支或名称 main 猜测；没有 master 时，在任何资源写入前明确报不支持并说明现有边界，不自动创建/改名分支。master-only 适用范围须写入 Skill、输出和验收；main/其他集成分支的支持不在本轮。master 被删除或改名后不自动完成，保留 active 并给出诊断。无变化不创建分支提交或空 ChangeSet。

验收追加：同 HEAD 不同 worktree 的用户记录与专用记录独立；通用入口不能跨 worktree写入/改记录；冻结必需目标被退回旧版本或任意修改时，两条校验/重试路径均失败；单独 commit 与 master 集成生命周期；master 不存在/detached/原 worktree 在 feature/master 改名的边界明确。既有普通 ChangeSet 行为保持。

## 采用规范与调查入口

当前明确采用 `statements/memsphere-repository-requirement-rules` 与 `statements/memsphere-repository-testing-rules`。后续实施还遵循开发、交付 Statement 及流程记忆撰写规范。已完整读取测试规范并将固定交付门禁写入验收，不仅泛称适用验证。

已检查 README、Skill、CLI 帮助与 src/commands/project.ts、src/project/model-registration.ts、src/project/model-operation.ts。新工作区：/tmp/memsphere-upgrade-20261012；基线为 master 合入 PR #100 的 a4de8045e8aa566feeb2e61efe9a9c875717599f。当前仅建立需求契约和评审配置，尚未修改实现、Skill 或 Memory。


---

# Memsphere 升级：实施与验证方案

## 目标与采用规范

依据第三轮已通过的 requirement-contract.md 及 Human 在方案评审中明确授权的专用升级交付补充，实现项目运行资源、Skill、CLI 三类升级入口与说明。新增 project upgrade 和 skill upgrade；CLI 更新仍使用安装来源对应的 npm 或源码操作。本轮不新增 YAML syntax 关键字、不修改 DSL、Review 协议或业务数据格式。

已读取并采用 statements/memsphere-repository-development-rules、statements/memsphere-repository-testing-rules、statements/memsphere-repository-delivery-rules。开发遵循适度复杂度、System Memory 源与副本同步；验证执行固定四项门禁和最终 Memory 变更级校验；交付归档后提交 PR 并跟进 CI。需求评审：review-20261012-065509z-014e85e2，第三轮 Human 与产品 Agent 均通过，Runner 已接纳。

## 实际代码与修改清单

| 位置 | 修改内容与目的 |
|---|---|
| src/cli.ts | 注册 project upgrade [name] --output text/json 与 skill upgrade 的 default/global/directory 参数；project upgrade 增加 --change <id> 显式重试专用升级记录，保留旧命令。 |
| src/commands/project.ts | 提取可返回结果的 System Memory repair 服务，旧 repair 保持输出与行为；统一升级复用服务并补齐校验及 ChangeSet 证据。 |
| src/commands/project-upgrade.ts（新增） | 单项目选择、独立工作树预检、分阶段执行、专用 ChangeSet 创建/显式重试及结果输出；不调用子 CLI 或抓取 console。 |
| src/memory/changeset.ts 及相关 Store 测试 | 新增持久记录 intent=system_upgrade 及升级范围元数据、专用创建/校验路径；普通 Embedded 自动捕获排除专用记录，显式校验保护升级范围与所属 worktree。保留普通 ChangeSet 的 repository/base 身份与原行为。 |
| src/project/model-registration.ts | 复用初始化的登记发现、旧 ID 转换、普通模型补登记与配置绑定处理，抽取计划构建；默认 initialize 仍拒绝已安装定义差异，升级路径显式允许经过校验的系统资源更新。 |
| src/project/model-operation.ts | 复用已有 settings 文件锁、before/after 冲突检查、修改日志与中断恢复；不新增跨资源事务协议。仅在实现所需时调整接口，不改变原恢复契约。 |
| src/project/model-validation.ts、models.ts | 优先复用现有定义、Runtime、登记、引用和 Store 装配校验；需要的升级候选校验通过内部辅助接口接入，避免用当前损坏/缺失状态启动 Host。 |
| src/commands/cli-errors.ts | 将 project upgrade 纳入结构化错误识别，覆盖 Commander 和 action 失败的真实 CLI 路由。 |
| src/commands/skill.ts | 新增 skillUpgradeCommand，复用 skillInitCommand 并内置 force:true；无新增安装状态文件。 |
| src/skills/memsphere/SKILL.md | 增加三类升级的主要操作说明、自然语言协助入口、安装来源识别、整体顺序与结果核对；调整旧 repair/initialize 说明。 |
| reserved-memory/system-memory/concepts/memsphere-framework.yaml 及 .memsphere/memory 同名副本 | 将新的项目/Skill 升级能力与边界纳入现有 Framework 概念，说明 initialize 与 upgrade 的差别。不新增升级 Procedure，不改 manifest 清单。同步 Framework 中 ChangeSet 专用用途及范围说明。 |
| README.md、README.en.md | 命令示例、目标选择及结果概览；指向 Skill 的完整升级说明，避免多份完整操作规范。 |
| test/skill-command.test.ts、test/project-upgrade.test.ts（新增）、test/model-registration.test.ts 等 | 覆盖两项新增命令、真正系统定义升级、既有命令回归、保护与失败重试。 |

现有 project repair 已有 Managed ChangeSet 校验/发布及 Embedded 候选校验/脏目标保护；统一命令复用，不重新实现。现有 initialize 已用 commitModelOperation 发布所有模型与配置变化，但安装定义不一致即报冲突；本轮必须扩展显式升级计划，不能只顺序调用两个旧命令。

## 项目升级的执行与失败语义

目标优先级：显式名称 > 全局 --project > Primary；使用现有项目上下文解析并冻结本次目标。Embedded 的 Memory 使用当前匹配 worktree；模型与登记按现有 Project 配置的有效模型根处理，不擅自把模型迁移到 Memory 根或改变配置路径。模型数据当前为 Project 共享状态；linked worktree 的限制保护的是 Memory 工作树，不能声称模型天然分支隔离。Mounted 来源不写入。

先只读预检目标与 Memory 写入/ChangeSet 边界，然后选择模型/登记升级，随后 System Memory 升级，最后复核两类资源。各子操作沿用各自锁、校验和恢复机制，不长时间持有 settings 锁去嵌套 Managed 发布。选择模型在先，是为了在模型冲突时不先发布新的 Memory；仍允许 Memory 阶段失败时模型已经升级。失败不自动回滚此前已成功发布的另一类资源，明确报告已完成/失败/未执行部分，用户修正后重试；模型本阶段写失败沿用现有恢复日志。重复调用只应用真实差异。

Managed Memory 无差异也执行有效 Store 健康检查；有差异复用受控 ChangeSet 的 validate/publish 并返回 ID、状态、View 入口。Embedded 先完整校验候选、保护计划写入目标、只应用当前 worktree 的差异；有差异运行相应变更级校验并返回逻辑 ChangeSet 证据，不 commit/push。

系统记忆有差异时必须创建专用 ChangeSet，targets 只包含本次升级计划的创建/更新/明确废弃项，禁止把升级前用户差异纳入。Managed 沿用受控升级候选及 validate/publish；Embedded 使用下文独立升级工作树与专用记录。无系统记忆差异时不创建空记录，也不更新用户已有 ChangeSet。变更级校验失败即整体失败，已完成部分与当前升级候选如实报告，可用专用 ID 重试。

## Embedded 专用 ChangeSet、分支与 commit

Skill 引导 Agent 在目标仓库选择 refs/heads/master 作为唯一集成基线，创建独立升级分支和 linked worktree；有歧义的基线才询问用户，不携带原工作区的未提交修改，不 stash/reset 或切换原工作区。命令在准备好的独立 worktree 中执行，不自动创建分支、Git commit、push 或合入。执行前确认当前分支不是该项目集成分支，并检查当前 Memory 无用户差异；不满足时在模型写入前失败并给出准备指引。专用 worktree 不混入其他施工内容。模型/登记仍按 Project 配置共享根更新，不能承诺它们因 worktree 而分支隔离。

当前普通 Embedded 捕获按 repository/base revision 自动复用记录，因此仅切分支不足以隔离。具体改动是在持久 ChangeSet 的 intent 枚举增加 system_upgrade（不是 YAML syntax），并保存 system_upgrade 元数据：原始升级目标路径/逻辑身份/操作及基线摘要、升级来源目标摘要、所属 branch 与 worktree instance。由升级内部 API 在既有 Memory 变更锁下分配新 ID 并初始化记录，不扫描或复用用户记录；创建时没有真实差异则不持久化空记录。原有格式版本保持 1，新字段可选，但 intent 与元数据配对校验；其他用途记录不能冒用该元数据。

专用校验通过 validateMemoryChange(id) 的 intent 分支进行：从记录限定目标构造稀疏候选，校验完整有效 Store，并检查 worktree 相对基线的 Memory diff 没有目标以外内容、目标身份/操作未被替换。必需计划项不得退回旧基线并从有效 targets 消失；逐项证明 operation、身份、目标内容摘要与冻结的当前 bundled manifest/source 相符，删除项确实缺失，完整有效 Store 校验之外还要核对系统安装结果达到目标。任何目标被还原或合法但非目标版本的改写都导致失败，不写 valid checkpoint，不报成功；既有 CAS、所有权与路径保护继续生效。校验成功写专用 checkpoint，不读取或改变用户 ChangeSet。普通无 ID 的 Embedded capture 排除 system_upgrade，且在同一升级 worktree 存在专用未完成差异时提示使用其 ID，不为该升级差异再创建普通记录；其他 worktree 的普通捕获照旧。同仓库同 HEAD 的用户 active 记录与升级记录可以并存，不参与去重/自动废弃彼此。

project upgrade --change <id> 仅接受当前项目、当前专用分支/worktree 的 active system_upgrade，明确拒绝普通、其他工作树、终态或基线不匹配记录；重新规划当前 CLI 升级目标，只允许原已授权范围，目标版本或范围变化时停止并提示另开升级，不能悄悄扩展。没有 --change 但当前 worktree 已有专用差异时，给出带原 ID 的重试命令，不生成第二份记录。原有完成/废弃终态保持不变；用户明确放弃才可废弃，不因失败自动吞掉证据。

校验与审阅后，Agent 只 stage 专用 ChangeSet 对应的系统记忆路径，核对 index 没有其他内容，再形成一个单独 Git commit。输出/交付记录关联 ChangeSet ID、分支、worktree、commit SHA。Git commit 不等于 ChangeSet 创建或完成；commit/push 后仍 active，按原有合入master 集成规则再 reconcile 为 completed。不创建人为的空 commit 来改变 HEAD，不以此绕过记录隔离。提交后不再用原 base 的工作树捕获重写 checkpoint，保留与该 commit 内容匹配的已验证证据。

升级差异已准备/校验成功与已合入是不同状态。Embedded 的整体命令成功表示当前 CLI 的升级差异准备完成且模型阶段已通过，输出 memory.integrationStatus=pending、branch/worktree 与后续独立 commit/审阅/合入步骤；不能宣称主 worktree 已升级。独立 commit 完成后交付记录 integrationStatus=committed，合入并 reconcile 后才是 integrated/completed。发生冲突时引导用户选择解决方式，解决后重新检查最终 Memory 与专用证据，不能把旧校验结果套用到新内容。


输出确定为 project、storeType、CLI version、overall（upgraded/unchanged/failed）、models、memory、validation。子项带 status（upgraded/unchanged/failed/not_run）、变更计数、适用的 revision/changeSet/worktree 和安全错误摘要；Memory ChangeSet 包含 id、intent、status、validation、view 与 evidenceScope=system_upgrade；Embedded 另给出 integrationStatus、branch/worktree，commit SHA 在 Agent 提交后的交付记录中补充。JSON stdout 只输出一个结果对象，诊断不污染 JSON。成功仅在最终两类校验通过时退出 0，任何失败非零；无法定位项目时仍输出失败阶段 target。部分完成不得转换为成功。

## 专用记录通用入口与完成判据

先在所有可能修改记录或写文件的服务入口判定 system_upgrade，不依赖 View 按钮隐藏。通用 claim（含 --force）、scope/add、edit/delete/rename 追加目标、resume、finish、publish、手动 complete、failMemoryChange 自动废弃均拒绝专用记录，当前或另一 linked worktree 都不得提前写入/改记录。comment 创建/编辑/删除也在本轮拒绝，审阅通过 Agent 对话及 Git/PR；避免引入 claim 评论处理的第二条升级工作流。list/read/detail/checkpoint 只读展示允许；显式 validate 仅所属 worktree 与冻结范围通过时可更新 checkpoint。用户明确 abandon 可在既有权限范围废弃记录，但不改用户文件；archive 仅既有终态允许。checkpointWorkspaceChanges 不能对升级记录做普通自动捕获。保护检查在变更锁内、任何 applyTargets/claim 状态写入之前完成。升级命令内部安全失败保留专用候选与诊断，不调用会自动废弃记录的普通失败入口。

明确当前仅支持 refs/heads/master：准备基线直接读取 master，不从主 worktree 当前分支推断，不引入新的自动分支发现。缺失 master、detached 升级 HEAD、在 master 本身执行，均在模型/Memory 写入前失败并给出准备指引；原工作区在 feature 分支不影响独立 worktree 选择 master。元数据保存 integrationRef=refs/heads/master 与原 base OID，refs 移动不改变冻结基线；master 删除/改名保留 active 并诊断，不猜新分支。正常 master 合并或 squash 后，逐目标内容达到专用 checkpoint 才 completed；专用 reconcile 不仅凭祖先关系判成功，以免合入后目标被撤回却仍完成。来源 worktree 已移除时仍通过 common repository、checkpoint 与 master 内容判定完成，不能要求该 worktree 存在。原有普通 ChangeSet reconcile 不变。

CLI JSON 错误路由将 project upgrade 纳入 src/commands/cli-errors.ts 的 requestedCliOutput 识别；action 捕获业务阶段失败输出单个结果对象，Commander 参数失败/未知项目/无 Primary/未捕获内部失败走一致结构化错误契约，stderr 无堆栈和重复 JSON。无效 --output 值按既有参数错误契约失败，不能将其当成功 JSON 请求；--output json 与非法其他参数同时存在时仍保证 JSON 错误及非零退出。

## 系统模型升级准入与数据保护

计划读取当前 CLI reserved-models 的 System 清单，只写清单归属的 system/definitions、system/registrations、必须变化的已有登记身份/配置绑定和首次初始化标记。普通模型定义原文字节、业务记录、冻结 Run/Review 文本不作为写入目标。

已有 System 登记区分 envelope 与 value：保留 record UUID/id、createdAt、来源区域等持久身份与管理字段；value 的 modelRef、name、description、package、package_name、tags、storage、store_id 均由当前 bundled descriptor 管理，整体同步其增删与内容，不保留旧发行元数据。只有 value 实际变化才递增 revision/updatedAt；没有变化保留原 envelope 字节。普通/市场登记仍保留用户管理属性，仅执行必要的旧身份转换。缺失的应有定义/登记可以补装；如果有同身份用户/市场/App 资源、重复或损坏登记、损坏已有定义、不安全路径或未知系统资源，则失败，不依据文件名猜归属，不删除未知资源。合法旧系统定义与当前内置定义不同才走升级，普通 initialize 保持原冲突行为。

旧 ID 转换沿用当前 MODEL_ID_UPGRADES 和已有登记规范化行为，配置中相关 Store model 引用同步；普通模型原文及跨模型引用不自动改写，现有不支持引用仍显式失败。

候选 System 定义先通过现有 JSON Schema/raw 定义检查与 Runtime 构建，再在候选视图中验证清单、登记模型与全部现有登记 envelope、必要 Store/模型引用及绑定的一致性。登记模型变化不得使现有普通/市场登记失效；raw Run 模型的变化必须保持已有内容可读取，检查受影响持久记录的现有读取契约，仅只读验证，不重写历史或业务值。需要转换现有业务内容、改变不支持的 metamodel/Store、或无法证明当前绑定与记录可用的变化拒绝执行，报告具体资源。不会增加 Runtime 支持或任意数据迁移器。全部模型预检通过才交给现有日志提交；提交后用新 Host 复核。

## Skill 与完整升级协助

skill upgrade 调用同一个安装函数并固定 force:true；默认 .agents/skills、--global ~/.agents/skills、--directory 指定位置，global/directory 互斥，安装错误原样失败，保留 init 的首次安装及 --force 行为。

完整指引集中在 Skill。用户请求升级后，Agent 根据已有上下文确定范围、CLI 来源、Skill 安装位置及项目；只询问缺失的关键条件。npm 安装指引使用实际包/安装范围升级；源码链接先核对仓库与工作树，再同步和构建，不在存在未提交改动时强行切换/重置。整体升级先更新 CLI，再升级选定 Skill 和项目运行资源，最后按实际进程和版本条件重启 View；旧格式迁移遵守既有明确确认与 Managed/Embedded 边界，市场导入 Memory 需要显式重新导入。单类升级不扩展到全部项目/其他安装位置。以实际结果说明每类完成情况。Embedded 系统记忆升级须引导用户配合选择有歧义的基线、准备独立分支/worktree、查看专用 ChangeSet、审阅单独 commit、解决合入冲突并按项目流程集成。Agent 在已有授权范围内准备和提交可审阅结果；push/PR/merge 遵循当前任务授权，未授权的最终集成由用户决定，不重复询问已授权动作。明确 ChangeSet、Git commit、合入三个阶段。升级改变 running Run 冻结的模型/Store fingerprint 时，旧 Run report/accept 应按现有契约拒绝；说明恢复原模型/绑定以继续，或重新发起新 Run，不声称升级会迁移旧 Run。

## 开发任务与验证

1. 抽取保留 initialize 默认语义的模型计划，加入显式升级候选、更新/补装、校验和提交；验证真实定义差异、仅 System 登记发行元数据差异、旧 ID、UUID 与用户原文保护、冲突、损坏和恢复。
2. 提取 Memory repair 结果服务，新增统一项目命令、输出及最终校验；验证 Managed/Embedded 两类资源一起更新、单类变化、无变化、目标选择与部分失败后重试；实现专用 intent、范围校验、同 HEAD 并存、普通捕获排除及显式 --change 重试。
3. 新增 skill upgrade 与默认/global/directory 对照测试；旧 init 和其他 Skill 保护测试保留。
4. 更新 Skill、Framework 源与副本、双语 README。逐项核对自然语言入口和三类升级路径；用受控环境演示新 CLI 调用，记录文本/JSON、退出码及 ChangeSet 证据。此轮不把真实 Agent 自主升级真实环境放入 CI。
5. 执行受影响测试，再执行固定门禁与最终 Memory 校验，汇总成果并按流程评审、归档、提交 PR、跟进 CI。

验证按最低适用边界：模型候选/失败回滚为临时文件系统模块测试；目标选择、JSON 与退出码、新旧 CLI 行为为真实 CLI 集成测试；Embedded 当前 worktree/脏文件保护为临时 Git 集成测试。已有 model-operation、system-models、project-model-registration-cli、project-command、reserved-store、changeset 和 run-model-artifact 测试纳入受影响回归。不涉及前端交互修改。

| 验收契约 | 验证场景 |
|---|---|
| 项目一次升级 | 临时 Managed 与 Embedded 都构造 Memory 和 System 定义的真实差异；一次命令达到当前包目标并验证发布/差异及最终可读性。 |
| 幂等及完整检查 | Memory-only、model-only、完全最新；第二次无多余 Revision、登记 revision/UUID 不变化，无空 ChangeSet。 |
| 仅 System 登记元数据变化 | 定义字节完全相同，仅名称/说明/包名/标签不同或字段删除；升级 value 达到 manifest 目标，UUID/createdAt 保留，首次文本/JSON 计为更新，二次 unchanged 且不改 revision/updatedAt。 |
| Embedded 独立升级 | 原工作区有合法用户 Memory diff 及带 Comment/claim/scope 的 active ChangeSet；同 HEAD 创建升级分支/worktree，生成不同 ID 专用记录，targets 仅 System 升级。原工作区字节及原记录 targets/checkpoint/评论/claim/scope/status 不变；普通捕获不选升级记录；误用 ID/加入无关 Memory 明确失败。 |
| 单独 Git commit 与集成 | 在临时 Git 仓库核对专用分支 commit 只含目标 System 文件、与 checkpoint 内容一致；commit 后仍 active，合入集成分支后 completed。验证 staged 无关内容阻止提交、冲突不覆盖、无变化无空 commit/ChangeSet、失败 --change 重试。 |
| 通用入口隔离 | 同/另一 worktree 执行 claim（含 force）、scope、publish、complete 等拒绝前零文件/记录变化；只读展示可用；所属 worktree 显式 validate 允许，其他 worktree 拒绝；普通用户记录行为不变。 |
| 目标版本强校验 | 必需目标回退旧基线、合法但非目标内容、目标遗漏、错误删除；memory change validate <id> 与 project upgrade --change <id> 均失败且没有 valid checkpoint/成功输出。 |
| master 完成边界 | 无 master 的 main 仓库写入前报不支持；detached/在 master 执行拒绝；原 worktree 在 feature 仍可准备；master 移动/删除/改名、merge/squash 与工作树移除后按目标内容判定；已合入但撤回目标不报完成。 |
| JSON 错误路由 | 无 Primary、未知项目、非法参数/--output、内部失败，验证 stdout/stderr 与退出码，避免 JSON 请求退回文本。 |
| 旧 Run 继续执行 | 升级前启动冻结模型目标的 Run，升级后目标 fingerprint 变化时 report/accept 拒绝，历史文本不变；未变化仍可继续。执行 run-model-artifact 回归并记录应恢复原目标或新建 Run 的说明。 |
| 安全与失败重试 | 用户同名资源、坏登记/定义、不支持模型、未提交目标、模型成功但 Memory 校验/发布失败；非零且报告部分结果，修正后重试成功。 |
| 保护契约 | 比较普通 Memory/模型、业务记录、UUID/管理属性、冻结历史前后字节或必要字段，除明确身份/绑定变化外相同。 |
| Skill 等价与说明 | 临时默认/global/directory 目标对照 init --force；冲突参数/I/O 失败；核对三类、来源识别、条件步骤和最终状态说明。 |
| 固定交付门禁 | npm run typecheck；npm test；npm run build；memsphere validate；最终 memsphere memory change validate，记录当前 ChangeSet ID、状态、View。 |

全部测试使用受控临时 Project/Home/模型与记录，不对真实 family/memorybase 进行失败测试。记录每项命令、结果、未执行项；在验证报告中映射需求九项验收。通过方案评审后形成施工任务清单；实施中新范围/准入边界变化回到需求或方案修订。

## 风险与限制

两类资源没有跨层原子事务，允许可诊断的部分完成；升级命令不会自动安装 CLI 或覆盖所有 Skill/项目。System 模型升级只支持当前 Runtime 与持久记录可用的变化；失败优先保护数据。历史 Run 保持冻结内容，版本不兼容的 running Run 按现有契约处理，不通过升级改写快照。当前无适用 stable Tag，不增加无限历史兼容责任。
