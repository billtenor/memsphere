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

## 本轮需求补充：独立升级交付（已确认）

Human 已以需求负责人及架构师确认本节，正式通过票记录在方案 Review review-20261012-072023z-0f7c549c / Round round-20261012-133051z-3012fc6b / Assignment assignment-20261012-133051z-0f5e2312。Runner 已接纳，冻结的完整契约位于 submission-20261012-133051z-e9b2c2b3；历史初始需求快照不改写。本节未改变三类升级范围。

系统记忆实际变更使用专用 ChangeSet，targets 仅包含本次 System 升级；不混入、复用或改写用户现有记忆差异和协作 ChangeSet。Managed 仍受控校验/发布。Embedded 的 Agent 协作需准备独立升级分支与 worktree，并在校验审阅后形成仅含本次系统记忆变化的单独 commit；Skill 提供准备、审阅、冲突处理和集成的详细指引。

project upgrade 增加可选 --change <id>，用于显式重试当前项目/升级 worktree 的 active 专用升级记录。错误用途、其他 worktree、终态、基线或升级目标变化均明确失败，不另行复用用户记录。专用记录用途与目标范围持久化，是本轮必要实现范围；通用 claim/scope/publish/complete 等操作不能绕过隔离或完成规则。

Embedded 命令成功表示升级差异已准备并通过目标版本校验、模型阶段已完成；必须明确 integrationStatus=pending，不表示主分支已更新。单独 commit 后仍待集成，合入后才完成。CLI 不自动 commit/push/merge，Agent 按任务授权执行 Git 步骤，需用户决策的基线/冲突/最终合入给予具体引导。

本轮沿用当前 Embedded ChangeSet 的 master 完成判据：独立升级分支从 refs/heads/master 准备，以 master 为集成目标。不得按主 worktree 当前分支、远端默认分支或名称 main 猜测；没有 master 时，在任何资源写入前明确报不支持并说明现有边界，不自动创建/改名分支。master-only 适用范围须写入 Skill、输出和验收；main/其他集成分支的支持不在本轮。master 被删除或改名后不自动完成，保留 active 并给出诊断。无变化不创建分支提交或空 ChangeSet。

验收追加：同 HEAD 不同 worktree 的用户记录与专用记录独立；通用入口不能跨 worktree写入/改记录；冻结必需目标被退回旧版本或任意修改时，两条校验/重试路径均失败；单独 commit 与 master 集成生命周期；master 不存在/detached/原 worktree 在 feature/master 改名的边界明确。既有普通 ChangeSet 行为保持。

## 采用规范与调查入口

当前明确采用 `statements/memsphere-repository-requirement-rules` 与 `statements/memsphere-repository-testing-rules`。后续实施还遵循开发、交付 Statement 及流程记忆撰写规范。已完整读取测试规范并将固定交付门禁写入验收，不仅泛称适用验证。

已检查 README、Skill、CLI 帮助与 src/commands/project.ts、src/project/model-registration.ts、src/project/model-operation.ts。新工作区：/tmp/memsphere-upgrade-20261012；基线为 master 合入 PR #100 的 a4de8045e8aa566feeb2e61efe9a9c875717599f。当前仅建立需求契约和评审配置，尚未修改实现、Skill 或 Memory。
