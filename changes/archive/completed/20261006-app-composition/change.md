---
id: 20261006-app-composition
completed_at: 2026-10-06
type: feature
created: 2026-10-06
run_id: run-20261006-075719z-7438aa8f
---

# App 整合能力与外部 CLI 登记

## 整体目标

App 是围绕完整业务功能组织插件与资产的整合单位。Project 安装多个 App，统一使用各 App 所属 Memory，同时容纳尚未归属 App 的待组织 Memory。用户通过 View Module 操作业务，Agent 通过 Memory 发现并调用外部 CLI；两种入口使用同一业务规则和权威数据。

本次以一个可安装、可使用、可验收的完整 App 为目标，在一次迭代中完成必要整合。开发任务可以按依赖安排，不拆成多个平台建设阶段，也不要求先建设通用业务 API 平台。

设计依据：`docs/app-design.md`、`docs/architecture.md` 及本次对话已确认的概念和 CLI 登记方案。Module 即 View Module；Package 区分 View Package 与 Model Package。正式文档直接描述概念及边界，不记录术语讨论历史。

## 当前迭代范围

### App 描述与 Project 安装

- 定义 App 的稳定身份、版本、说明、自有资产、依赖和使用入口。App 可以组合 Memory、View Package、Model Package、数据扩展及外部 CLI；不要求每一种能力都存在。
- 支持从可信本地发行目录安装 App，在 Project 中记录所选版本、资产归属、启用状态及配置和资源绑定。每个 Project 对同一个 App 保留一份安装；不同 Project 独立管理。
- 提供安装、列表、详情、启用、停用和检查入口，支持 Agent 读取结构化结果。首版安装管理通过 CLI 完成，业务界面通过正式 View 使用。
- 检查声明、资产冲突和依赖；相同内容重复安装保持幂等，不通过重复安装隐式升级或覆盖本地修改。缺少外部工具或环境配置时给出明确的未就绪诊断，不把登记等同于已经可用。
- 安装失败不得显示成功或留下可被正常使用的半成品；需要清理或重试时返回可定位的诊断，不建设跨系统事务框架。

### Memory 作为 App 资产

- App 交付 Memory 内容，安装后保留 App 归属。Project 统一发现、读取、校验和运行 App Memory 与待组织 Memory，并可查询归属。
- 现有 Memory 未被明确纳入 App 时继续作为待组织 Memory；不能根据同名、目录或市场来源自动认领。
- 逻辑引用继续使用现有规则；跨 App 引用不改变归属。规范名称与别名冲突必须诊断，不能按加载顺序覆盖。
- Memory 安装和编辑遵守现有 Store、ChangeSet、校验及发布边界。Managed 与 Embedded Project 均须有清楚的安装路径；Mounted 来源保持只读。
- 停用 App 保留其 Memory、归属和业务数据，不改写已存在 Run 的冻结材料。归属变更及版本合并不由文件移动或删除登记隐式触发。

### View、Model 与数据扩展组合

- View Package 复用已有 Manifest、Loader、Slot 和实例机制，App 的业务界面入口随所在 Project 的启用状态生效；公共 Shell、主题和现有明确 Slot 选择继续遵守其组合规则。
- Model Package 交付模型定义及依赖，复用模型登记与 Store 绑定；模型定义与 DataExtension 实现分别声明和检查。
- 对 App 所需可信本地数据扩展，补齐必要的发现、依赖检查及 Project 装配连接，复用现有 Serializer 和 Factory 协议，不重建数据层。
- 为示例业务接通所需的明确调用接口，使 View 与外部 CLI 使用同一业务上下文、规则和权威数据。浏览器不直接读写 Project 文件，不提供任意系统命令执行入口。
- 组合变化沿用显式重启机制，不要求插件热替换。

### 外部 CLI 登记与发现

- CLI 描述包括稳定 ID、名称、用途、逻辑命令前缀、帮助或文档入口，以及需要的配置与可选版本检查约定；描述可随 App 交付，也可独立登记。
- 可移植描述与本机程序位置、工作目录及项目业务配置分开保存。CLI 可从 PATH 或显式绑定路径定位，仍通过自身方式安装和运行。
- 保留绑定机制：绑定保存通用 CLI 在指定 Project 或 App 中使用的固定参数、环境变量、工作目录和可选程序位置。首版由 Memsphere 提供这些调用信息，Agent 按说明组合业务参数并直接执行 CLI；绑定不自动拦截或代为执行外部命令。
- 提供登记、绑定、列表、详情、检查能力，支持按 App 查找和 JSON 输出；本轮命令入口如下，描述文件和绑定文件的具体字段在实施方案中确定。
- 一个 CLI 可被多个 App 引用，各 App 分别绑定业务上下文；相同 ID 的冲突描述不能静默覆盖，不能由最后安装顺序决定。
- list/show 只读取登记与绑定；显式 check 才进行可执行定位、配置检查及声明的版本探测。未探测时不能把工具显示为已验证可用；不会假定所有工具均支持 `--version`。
- Agent 从 Project/App 摘要发现工具，读取详情及 App Memory 后直接调用原工具。不注入 Memsphere 顶层业务子命令，不要求第三方实现统一 SDK，不重建全部子命令 schema。

以下命令已在本轮实现并通过验证。所有命令支持全局 `--project <name>` 选择 Project，省略时按现有 Workspace 绑定解析；支持 `--output text|json`，默认 `text`。描述文件和绑定文件使用 JSON。

| 命令 | 用途与输入 | 返回结果 | 是否写入或执行外部程序 |
| --- | --- | --- | --- |
| `memsphere cli register <descriptor-file>` | 从描述文件登记一个外部 CLI；App 安装复用同一登记逻辑。描述包含 ID、用途、命令前缀、帮助入口及配置要求。 | CLI ID、登记结果与来源；相同描述重复登记返回无变更，不同描述占用同一 ID 返回冲突。 | 写入登记；不安装工具、不执行程序。 |
| `memsphere cli bind <id> --binding <binding-file> [--app <app-id>]` | 创建或更新所选 CLI 的环境绑定。文件提供可选程序位置、固定参数、环境变量、工作目录及业务配置引用；指定 App 时保存该安装的绑定。 | 绑定的 Project、可选 App、CLI ID 与保存结果；不存在的 CLI 或 App 返回错误。 | 写入绑定；不执行程序，不将本机绝对路径写入可移植 App 定义。 |
| `memsphere cli list [--app <app-id>]` | 列出当前 Project 已登记的 CLI；可筛选某个已安装 App 声明使用的工具。 | ID、名称、用途、关联 App，以及声明和绑定信息；缺失登记的 App 工具依赖返回明确诊断。 | 只读登记与配置，不执行程序，不将未检查的工具标为已验证可用。 |
| `memsphere cli show <id> [--app <app-id>]` | 读取一个 CLI 的完整描述、帮助入口及适用的调用绑定。指定 App 时使用该 App 的业务上下文。 | 工具描述、结构化命令前缀、固定参数、非敏感环境变量、工作目录、配置引用及缺项，供 Agent 调用时使用；存在多个业务绑定且未指定 App 时列出候选，要求明确选择后再取得有效调用配置。 | 只读，不执行帮助命令或业务命令。 |
| `memsphere cli check <id> [--app <app-id>]` | 显式检查指定上下文中的程序定位、必要绑定和已声明的版本要求。 | 检查时间、各检查项结果和缺项；整体区分通过、失败与无法确认，版本协议未声明时不猜测。 | 不修改登记和绑定；仅可执行描述中明确声明的版本探测，不执行业务操作或自动安装。 |

未指定 `--app` 的 bind 面向工具独立使用的 Project 绑定；App 调用以自己的绑定为准，不因另一个 App 或独立绑定后写入而切换业务数据。App 绑定缺失时明确返回未就绪，不能隐式借用其他业务上下文。相同 CLI 可被多个 App 引用，卸载或停用某个 App 不代表卸载外部程序。

check 的通过仅表示已声明并实际检查的条件满足；未声明的认证、网络或业务权限不在通过结论中。失败或无法确认使用非零退出状态，JSON 输出仍保留逐项诊断。list/show 不将历史检查结果作为当前已验证可用的保证。调用信息按程序、参数和工作目录分别表达，不拼接 shell 字符串；配置展示不展开凭据值。

## 后续范围

本轮不包含远端 App 市场与包下载器、版本升级和本地修改合并、卸载资产处置、已有待组织 Memory 的批量归属迁移、同一 App 在一个 Project 的多安装实例，以及完整图形化 App 安装中心。

通用业务 API 平台、统一 CLI 执行器、进程托管、插件热替换和非可信代码沙箱不作为本轮前置能力。示例业务必需的接口、扩展装配和项目绑定仍属于本轮交付范围。

## 交付物

- App 描述校验、Project 安装记录、资产归属、依赖检查与启停组合实现。
- 外部 CLI 登记、环境绑定、发现与检查实现，以及 Agent 使用入口说明。
- 可独立交付的示例 App，包含 Memory、外部 CLI、Model Package 和 View Module；示例业务拟采用费用记录，展示创建、查询和状态更新。
- 成功、失败、冲突、跨 Project 隔离、停用及共享依赖的自动化测试，以及真实 View 操作证据。
- 同步更新 App/总体架构及相关扩展文档、中英文使用说明、System Memory 和仓库 Skill。此前在本对话中形成的相关文档改动纳入本需求；不纳入其他需求改动。
- Run 内完整的需求、实施方案、开发计划、实现摘要、验证与交付材料；本文件保留需求及验收摘要。

## 验收标准

1. 从可信本地发行目录安装示例 App，无需修改或重新编译 Memsphere；能查询安装版本、组成资产、归属、依赖与当前状态。发行包路径约束及无效描述有明确错误。
2. 同一 Project 可安装两个不同 App，并保留待组织 Memory；统一 Catalog 能读取三类内容并区分归属，跨 App 引用不改变归属。
3. 相同版本和内容重复安装不重复写入；不同内容、Memory 规范名称/别名冲突、模型或 CLI 身份冲突均拒绝隐式覆盖，并给出具体冲突项。
4. 无效资产、失败写入或缺少依赖不会呈现为完整可用的 App；失败后已有资产保持可用，未完成内容不作为已安装能力暴露，诊断支持明确修复或重试。
5. Managed 与 Embedded 的安装均遵守各自 Memory 写入/校验边界；Mounted 来源不能被安装器修改。App Memory 可以通过现有编辑流程修改，归属保持正确。
6. 按命令表实际执行 `cli register/bind/list/show/check` 的文本与 JSON 路径。外部 CLI 可独立登记，也可随 App 登记；相同描述幂等、冲突拒绝。register/bind/list/show 不启动程序；check 可区分缺失程序、缺少绑定、版本不兼容及无法确认的状态，检查失败以非零退出状态和诊断表达。仅声明的版本探测会运行，未声明版本协议不默认调用 `--version`。
7. 两个 App 引用相同工具时可取得各自调用配置；省略 App 导致多个业务绑定时，show/check 明确提示选择；缺失 App 绑定不得隐式使用另一个 App 或独立绑定。含空格路径、参数边界和工作目录按结构化信息表达，不依赖将未经处理的字符串拼入 shell。
8. 在两个 Project 安装同一 App，配置和业务数据互不串用；仅启用一个 Project 时，另一个 Project 不出现该 App 的业务入口。
9. 在正式 View 中操作示例业务后，外部 CLI 能读到相同记录；CLI 写入后，View 刷新可见，双方执行一致的业务约束。此验证必须跨真实入口，不能只证明两个描述引用了同一 ID。
10. 停用后界面与 App 活动入口撤销，Memory 归属、已保存数据和既有 Run 材料保留；其他 App 使用的共享工具和扩展继续工作。再次启用可恢复入口。
11. View 通过真实 Shell 的桌面/窄屏、Project 切换、导航、刷新与主要业务交互检查；既有主题和明确 Slot 选择不被静默覆盖。
12. 执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`；如有 Memory 差异，最终还须通过 `memsphere memory change validate` 并记录 ChangeSet ID、状态与 View 入口。未执行项与环境限制如实记录，不能作为通过。

## 向前兼容

结论：不需要向前兼容。

依据仓库需求规范，只有名称包含 stable 的 Git Tag 构成稳定 checkpoint。2026-10-06 已执行本地 `git tag --list '*stable*'` 及只读远端 `git ls-remote --tags origin '*stable*'`，均无匹配标签，因此本轮没有需要兼容的 stable Tag checkpoint。

本结论不授权删除或静默迁移当前用户资产。本轮采用显式 App 安装：未安装 App 的 Project 保持原有使用方式，既有 Memory 不自动认领，Home 界面配置不自动改成 App 配置，现有逻辑引用和历史 Run 材料保持其含义。若实施确需改动现有持久格式或扩大迁移范围，须更新本契约再评审。

## 采用的 Memory 规范

- `statements/memsphere-repository-requirement-rules`：需求文档独立声明兼容结论，以 stable Tag 为依据。
- `statements/memsphere-repository-development-rules`：按实际影响控制复杂度；新增可见能力同步 System Memory、安装副本及 Skill；本轮不预设新增 Memory DSL 关键字。
- `statements/memsphere-repository-testing-rules`：围绕可观察契约测试，执行真实边界验证、全量回归和 Memory 变更校验；View 交互使用 playwright-cli 实测。
- `statements/memsphere-memory-access-rules`：保持逻辑引用、Project 来源和冻结 Memory 的读取边界。
- `statements/memsphere-repository-delivery-rules`：最终验收后记录结果并归档需求，存在 Memory 差异时交付有效 ChangeSet 证据。
- 已完整读取 `concepts/memsphere-personalized-software`、`concepts/memsphere-framework`、`concepts/memsphere-memory`、`concepts/memsphere-view`；当前实现描述作为现状依据，用户已确认的 App 设计作为本轮目标变化，实施时同步相关 Memory。

## 现状调查

- `src/module/manifest.ts` 是要求 View 入口的 Module 契约；App 需要自己的组合描述。
- `src/module/package-registry.ts` 与 View Runtime 已有可信本地包、Slot 和实例能力；Project App 启用范围需要接入。
- `src/project/models.ts` 固定装配内置数据扩展；`src/project/model-market.ts` 已有模型包校验和导入基础，需接通 App 交付。
- `src/memory/catalog.ts` 尚无 App 归属，`src/project/model.ts` 尚无 App 安装记录。
- `src/cli.ts` 使用静态命令树，尚无外部 CLI 工具目录。

## 技术与测试方案

已形成“实施与验证方案”并提交到同一 Run，Review：`review-20261006-090105z-d6a546c0`。完整字段、持久化、装配与验证设计以该 Run 产物为准。第一轮 Human 已通过；Runner 接受 Mounted 只读与安装发布一致性意见后要求修订。第二轮 `round-20261006-092018z-f42369bb` 经 Human 明确同意并由 Runner 通过，当前进入实现验证。

- 使用 app.json 描述组成、依赖、入口、配置及连接关系，复用 View Package 与现有数据扩展协议。
- 实现 Project 安装记录、受控 Memory 安装及归属、外部 CLI 描述和固定调用绑定。
- 接入 Project 的 View/Model 装配，以最小 App 业务操作接口连接示例的共享业务实现。
- 接受产品评审对停用边界的意见：保留 Memory 可读，禁止停用 App 的 Procedure 新建 Run；既有 Run 保留冻结内容，业务调用依赖不可用时明确失败，重新启用后恢复。
- 验证包括真实 CLI/View 双向数据操作、安装失败与冲突、多个 App/Project 隔离、停用与 Run、全量回归和最终 Memory 变更校验。

## 创建与安装体验补充（已纳入第二轮技术评审）

Human 指出：现有产品与技术方案没有说明如何创建和安装 App。本补充随实施方案第二轮冻结，已通过 Human 与 Runner 评审。

- 作者交付以 `app.json` 为入口的本地目录，内含声明的资产、必要的构建产物、配置示例和使用说明。首版可手工创建或复制示例，不新增脚手架生成器作为前置条件。
- 普通使用者通过 App install/enable 完成安装和启用；App 自有 CLI 描述、Memory、View/Model Package 由安装器统一登记，无须逐项执行独立登记或 Home 包配置。
- install 结果返回 App ID、安装状态和下一步；show 显示实际可用入口，区分 Memory 阅读、Procedure Run 和 Human 界面，并说明缺项或重启要求。
- 新增双语 `docs/app-guide.md` / `docs/app-guide.en.md`，包含两个文件的完整最小 App、安装命令与预期结果，以及完整费用 App 的交付和配置路径。现在对应可执行实现，已通过最小 App 命令及独立 CLI 打包安装验证。
- 补充验收：新作者从空目录照指南创建 App，另一位使用者在独立 Project 安装、启用并找到入口；费用 App 提供可取得的构建产物、准确的工具安装命令与可执行 README，再验证 CLI/View 双向业务操作。不得把未实现的命令示例视为验证通过。

## 开发任务

- [x] 严格 App/CLI/Model Package 描述与本地路径校验，CLI 登记、绑定、发现和显式检查。
- [x] Project/worktree 安装状态、发布前路径保留、失败重试、app_install ChangeSet 与 Memory 归属。
- [x] Model/扩展/Store 与 Project View/backend 接入，停用 Run 门禁、候选及历史归属快照。
- [x] 完整费用 App、独立 CLI 构建与安装、最小 App 中英文指南。
- [x] 真实 Shell 录入/提交、CLI 双向操作、窄屏键盘路径和 Project 切换；Memory、Skill 与文档同步。
- [x] 最终全量验证、技术评审和产品验收。
- [x] 验收后归档需求；本目录与实现一并纳入本轮 commit，SHA 由 Run 的 Commit 结果记录。
- PR 创建由流程末步 Human 决定，不作为本地需求验收状态。

## 实现入口

`src/app/` 保存组合契约、安装、状态、归属 Provider、后端和装配；`src/tools/registry.ts` 处理外部 CLI；`src/commands/app.ts` 提供管理命令。既有 Memory/ChangeSet、Run、Project Model Host 与 View Runtime 增加对应接线。

字段与运行边界见 `docs/app-contract.md` / `.en.md`；可运行发行示例见 `examples/apps/expense/README.md`。本轮沿用已有四类 Memory 语法。

## 验证与验收状态

已按用户要求合并最新 master；合并适配、1111 项回归和新的最终 Memory ChangeSet 证据见 [master-merge-verification.md](./master-merge-verification.md)。

实现与验证评审 `review-20261006-101328z-113e901e` 已通过：Human 明确投通过，Runner 在修复新增 App 测试对可变 dist 的依赖并完成缺失入口复验后通过。最终全量回归 947 pass、0 fail、1 skip，Memory ChangeSet 校验再次通过。交付报告见 [delivery-report.md](./delivery-report.md)。产品评审 `review-20261006-124256z-8eacbd21` 已由 Human、产品 Reviewer 和 Runner 通过；需求记录归档至当前目录，commit 结果由 Run 后续产物记录。

补充按指南执行的完整验收：见 [App 指南端到端验收](./guide-acceptance.md)。使用打包安装后的 CLI、复制出的 App 发行目录、全新 Managed Project 和 CLI 启动的正式 View，完成安装、页面/CLI 双向操作、停用重启、恢复和 Project 隔离；同时补齐指南的新建 Project 与服务地址步骤。

最小 App 从指南创建并安装/启用成功；费用 CLI 已 npm pack 并安装到临时 prefix，离开仓库工作目录仍可运行。真实 View 完成录入/提交，CLI 读到相同记录，CLI 写入后 View 刷新可见；窄屏键盘路径及切换到未安装 App 的 Project 通过。

安装与恢复、Mounted 零写入、停用直接/文件/间接 Procedure Run、CLI 无执行发现、共享工具独立绑定、跨 Project 数据隔离及共享 Model Package 的专项测试已通过。最终全量回归 948 项：947 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过；typecheck、build、Project validate 与 ChangeSet validate 均通过，正式结果已进入 Run 验证产物；此前失败的模型设置保存状态和无 App Model Host 兼容问题已修复。

本轮新增 App Concept/使用规则并同步 System Memory、Project 副本及 Skill。ChangeSet 为 `change-20261005-031024825z-a1b5f8c3`，最终 digest 和校验结果在 Run 实现摘要记录。View 入口 `/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3`。技术与产品验收均已完成，结算记录见本节开头。
