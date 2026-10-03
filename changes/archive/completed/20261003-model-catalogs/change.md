---
id: 20261003-model-catalogs
type: feature
created: 2026-10-03
completed_at: 2026-10-03T20:37:01+08:00
run_id: run-20261003-055813z-2e69aa7e
---

# 内置模型初始化入库与模型市场示例整理

## 需求

### 整体目标

在代码仓库中用原始 model JSON 与声明式清单管理内置模型和市场模型。Project 初始化时安装内置模型；市场模型由用户选择导入。将当前 memsphere Project 的用例 01–08 整理为市场的 example 模型，并移出当前 Project 的本项目模型。

本 Run 使用 `memsphere-agile-requirement-development`。按 Human 更新的绑定，需求评审第 3 轮起产品负责人由 Human billtenor（`actor5`）与产品 Agent（`traex1`）共同参与；研发、架构、测试沿用项目现有 Agent 绑定。开发基线为 `f27d9f0`，分支为 `codex/model-catalogs`。需求契约第 3 轮已获 Human 通过，Runner 记录产品 Agent 意见处置后通过；实施方案第 2 轮已获 Runner 通过，实现与验证已完成；实现成果评审第 1 轮研发、测试、架构及 Runner 均通过，Human 已验收最终范围并通过交付评审。正式冻结契约及全部评审记录保留在本 Run 中。

### 已调查的现状

- 当前命令为 `memsphere project create`，没有 `project init`。Managed 与 Embedded 创建仅安装 System Memory。
- 当前五个系统模型由代码临时装配定义和登记。原始定义、系统登记尚未随 Project 创建落库；查看列表也不会初始化模型登记。
- 当前模型市场只有 `memsphere.examples.orders` 订单示例包，原始 JSON 以 TypeScript 字符串内嵌。
- 用例 01–08 的真实 JSON 位于当前 memsphere Project 的 `models/json-schema/draft-07/examples/`，与历史需求附件的八份 JSON 字节一致。八项均属于本项目来源；02 已归入订单示例包，其余七项未定义包，因此本次按八个明确 ID 整理，不能只按“未定义包”过滤。
- 04、05 是合法的 Draft-07 定义，可浏览但超过现有业务 Runtime 的反射子集；当前市场导入强制编译 Runtime，会阻止它们导入。06 跨文件引用 `examples/07-scalar-enum-root.json`，需保留引用关系。

### 当前迭代范围

1. **仓库资产与清单。** 在仓库根目录新增 `reserved-models/`，与 `reserved-memory/` 并列；用一个 `manifest.json` 分别管理内置、市场两类清单，原始定义分别存放于 `system-models/` 与 `market-models/`。清单描述稳定身份、元模型、登记信息和源文件位置；构建或发布前检查缺失文件、重复身份、无效定义和登记。正式 npm 包包含全部资产，运行不依赖源码 checkout。相同原始定义可以复用文件，避免多处维护。具体布局与职责见下方“reserved-models 资产设计”。
2. **内置模型初始化。** Project 初始化成功时，清单中全部内置模型的定义和对应登记均已持久化，可重新打开并读取。覆盖 Managed、Embedded；定义和登记继续属于 Project 数据，不混入 Memory YAML。五个模型继续归属 `memsphere.builtin`，保留稳定 ModelRef 与元模型语义：登记模型使用 `json-schema/draft-07`，四个 Run 模型使用 `raw`。界面显示真实持久化存储信息。为打破登记自举依赖所需的最小启动装配可以保留，但源定义统一来自仓库 JSON，不另维护第二份内联定义。
3. **命令入口。** Human 已澄清指现有 `memsphere project create <name>`：本轮直接在该创建入口自动安装内置模型，不新增 `project init` 命令或别名。既有项目通过显式 `project models initialize [name]` 补装，不在读取页面时隐式写入。不扩展 `project repair` 的 System Memory 职责。
4. **初始化边界。** 重复补装内容一致时无变化；保留无关模型及已有管理属性。已有不同内容、损坏记录或身份冲突须清楚报错，不静默覆盖。新建 Project 失败不得报告创建成功或遗留可见的半安装 Project；现有 Project 补装失败不破坏原数据。
5. **市场供给。** 市场通过清单读取原始模型 JSON。新增 `memsphere.examples` 包，显示名称为“示例模型”，完整包含下表八项，均带 `example` 标签。未导入时只在市场显示；导入后进入“已导入的包”，不进入“本项目/未定义包”。按 Human 后续调整，不再单列 `memsphere.examples.orders` 订单示例包；订单定义保留在示例包的用例 02 中。已有订单包导入数据保留，已知旧候选仍可清理。
6. **八项示例的可用性。** 导入应校验定义标准、登记及相关引用，而不以支持全部业务 Runtime 特性作为浏览示例的前提。八项能够完整导入与浏览；04、05 的运行限制继续明确报告，本轮不扩大 Runtime 支持范围。整包重复相同导入不产生重复记录；冲突不覆盖；失败不展示为成功导入。
7. **当前项目整理。** 交付时对当前绑定的 memsphere Project 执行一次明确记录的整理：确认八项与已调查原文及登记状态匹配，检查其他本项目模型对它们的引用，保存可恢复备份，验证市场资产完整后移除这八项本项目定义及对应登记。备份位于模型发现范围之外。当前 Project 默认只在市场看到这八项，不自动导入。其他模型、其他 Project、已有市场导入内容均保留；若发现调查后的修改或范围外模型仍依赖这些示例，报告差异并保留数据，不按标题或目录批量删除。
8. **配套交付。** 同步必要测试、README、System Memory 源及当前开发 Project 的 Memory 副本、Skill 冗余说明，并提供最终验证及当前项目整理证据。

### 模型清单边界

内置模型固定覆盖当前五项：

| ModelRef | 元模型 |
| --- | --- |
| `memsphere/model-registration` | `json-schema/draft-07` |
| `memsphere/run/artifact` | `raw` |
| `memsphere/run/memory-snapshot-file` | `raw` |
| `memsphere/run/agent-activity-log` | `raw` |
| `memsphere/run/agent-activity-snapshot` | `raw` |

JSON Schema 元模型本身是启动基础设施，不作为新增业务模型列入安装与市场列表。市场示例保留原始 JSON 字节及以下 ModelRef：

| ModelRef | 示例内容 |
| --- | --- |
| `examples/01-basic-types.json` | 基础类型与标量数组 |
| `examples/02-nested-order.json` | 订单与深层嵌套 |
| `examples/03-array-root.json` | 数组根与多维数组 |
| `examples/04-dictionaries-and-encodings.json` | 动态字段、字典与编码 |
| `examples/05-unions-and-conditions.json` | 联合类型与条件 |
| `examples/06-references-and-recursion.json` | 引用与递归 |
| `examples/07-scalar-enum-root.json` | 字符串枚举根 |
| `examples/08-numeric-enum-root.json` | 数字枚举根 |

### 后续范围与不做事项

远程市场、第三方上传、自动更新与版本管理、通用包管理平台、模型编辑界面、Runtime 特性扩展、所有历史项目自动清理、通用卸载/升级框架留待后续。此次清单管理采用满足安装、发现和校验所需的最小结构。

### 交付物

仓库 JSON 资产与清单、初始化与市场读取/导入能力、八项示例市场包、当前 memsphere Project 的迁移备份与回执、自动化验证、配套文档与 Memory、Run 中的方案/计划/实现摘要/验证报告/交付报告及本轮 commit。是否创建 PR 由流程末尾 Human 决定。

## 向前兼容

**结论：不需要向前兼容。** 当前本地 Git Tag 列表没有名称包含 `stable` 的 Tag，因此没有仓库规范定义的稳定 checkpoint；不额外承诺未知历史版本迁移。

这不取消本轮明确的数据保护要求：保留当前五个内置 ModelRef、元模型与 Run 原始字节语义；保留现有 `project create` 和模型存储配置能力；保留已导入订单模型的数据及旧候选清理能力，不再提供独立订单市场包的新导入；仅整理明确指定的八项本项目示例，不覆盖其调查后修改，不处理其他 Project 的用户数据。

## 验收标准

1. 从正式打包产物使用 `project create` 创建全新 Managed、Embedded Project，均安装清单中的五个内置模型及登记。通过持久 Store 检查实际定义和登记，进程重开仍可读取；不能仅以列表中存在五行证明入库。
2. 内置模型稳定 ID、五个定义的元模型、系统包归属和原始字节行为正确；Run 产物、Memory 快照、活动日志和快照读写回归通过，登记自举无循环依赖。
3. 对既有 Project 显式补装成功，重复执行无额外写入；冲突、损坏和写入失败有可验证结果且不破坏用户数据。模型/市场读取保持只读。
4. 仓库根目录存在 `reserved-models/manifest.json`、`reserved-models/system-models/` 和 `reserved-models/market-models/examples/`，分别可直接阅读两类清单、五项内置原始定义和八项示例原始定义；正式 npm 包包含完整 `reserved-models/`，安装后可按清单读取资产，清单遗漏、缺失文件、重复身份和无效内容由检查捕获。同一源文件被不同合法身份引用不视为身份重复；订单模型仅作为示例包中的用例 02 供给。
5. 市场“示例模型”完整展示 01–08；新 Project 与尚未导入的当前 Project 均不把八项列为本项目模型。独立订单包不再出现在市场且不能新导入，已有导入模型继续可读、已有候选继续可清理。
6. 在隔离 Project 实际导入八项后，全部位于已导入的示例包，原始定义字节和 ModelRef 保持一致，06 的引用仍有效；04、05 可导入与浏览，但原有 Runtime 不支持行为仍明确，不能宣称支持完整 Draft-07。
7. 相同包重复导入无变化；任一模型身份或内容冲突时整包不覆盖；写入失败不会显示部分导入成功，清理失败有明确回执。
8. 当前 memsphere Project 整理后，原八项本项目定义和登记均已移出有效模型范围，只在市场可见；八项备份及回执可核对，其他模型、配置与已导入数据保持原状。
9. 实际执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。Memory 最终差异通过 `memsphere memory change validate`，交付记录包含 ChangeSet ID、校验状态和 View 入口；涉及前端交互调整时用 playwright-cli 实操验证。

## 采用的 Memory 与仓库规范

- `concepts/memsphere-framework`：Project/模型/登记/市场边界、稳定身份、显式写入及数据保护。当前“系统模型只由代码提供”的事实将由本需求更新。
- `concepts/memsphere-view`：包浏览、模型结构与原文展示、未支持特性边界、稳定入口。未找到独立命名的 Model/Data Concept。
- `statements/memsphere-repository-requirement-rules`：独立向前兼容结论及稳定 checkpoint 定义。
- `statements/memsphere-repository-development-rules`：控制复杂度、同步 System Memory 与 Skill、Project 初始化行为一致。
- `statements/memsphere-repository-testing-rules`：可观察产品契约、实际边界集成验证、全量回归、Memory 与受影响 Reserved Store 校验。
- `statements/memsphere-repository-delivery-rules` 与 `changes/README.md`：最终变更级校验、验收记录、完成后归档。

未发现重复 active 需求。强关联已完成需求：`20261001-project-models`、`20261002-model-registration`；参考管理方式：`20260826-memory-market`。

## 待确认项

Human 已确认创建命令沿用 `project create`，八项组成一个 `memsphere.examples` 示例包，以及当前 Project 的八项备份后移出而不自动导入。交付验收期间，Human 进一步要求移除独立订单市场包，并明确暂不扩展已导入包的卸载功能；本文件反映最新范围，已冻结 Review Submission 仍保留当时内容。

## 技术与测试方案

### reserved-models 资产设计

在代码仓库根目录新增下列资产目录，与现有 `reserved-memory/` 并列：

```text
reserved-models/
├── manifest.json
├── system-models/
│   ├── model-registration.json
│   └── run/
│       ├── artifact.json
│       ├── memory-snapshot-file.json
│       ├── agent-activity-log.json
│       └── agent-activity-snapshot.json
└── market-models/
    └── examples/
        ├── 01-basic-types.json
        ├── 02-nested-order.json
        ├── 03-array-root.json
        ├── 04-dictionaries-and-encodings.json
        ├── 05-unions-and-conditions.json
        ├── 06-references-and-recursion.json
        ├── 07-scalar-enum-root.json
        └── 08-numeric-enum-root.json
```

**原始定义与清单分工。** `system-models/` 和 `market-models/` 中的每个 JSON 文件只保存原始 model 定义，不包裹登记信息。一个 `manifest.json` 内分别维护内置安装清单、市场包与模型清单；条目显式关联源文件路径、稳定 ModelRef、元模型及名称、说明、所属包、包显示名称、标签等登记信息。源路径相对 `reserved-models/` 解析；文件名和目录仅定位发行资产，不推断 ModelRef、元模型或 Project 存储位置。具体清单字段结构及加载接口在后续实施方案中明确。

例如，`system-models/run/artifact.json` 对应的 ModelRef 仍为 `memsphere/run/artifact`，元模型仍为 `raw`，原始定义为 `{}`；保存为 JSON 文件不使它变成 JSON Schema 模型。登记模型对应 `memsphere/model-registration`，使用 `json-schema/draft-07`。八项市场示例保持 `examples/01-basic-types.json` 等原 ModelRef 和原始文件字节，因此 06 对 07 的引用无需改写。

**订单示例。** `memsphere.examples` 包的 `examples/02-nested-order.json` 引用 `market-models/examples/02-nested-order.json`。独立订单市场条目已按 Human 要求移除；历史导入数据及恢复基线保留各自原身份，不进行自动删除或改名。

**发行与落库。** `package.json` 的发布文件列表纳入整个 `reserved-models/`；正式 npm 包可独立加载清单及原始定义。`project create` 只按内置清单将五项定义和登记写入新 Project 的模型存储；既有 Project 可通过显式 `project models initialize` 补装。市场列表根据市场清单提供内容，用户显式导入选定包后，才将其定义和登记写入该 Project 的导入存储。仓库资产是发行源，Project 落库数据使用 Project 自己的存储配置；浏览市场不写入 Project，也不会把示例加入内置初始化集合。

**设计验收。** 除检查源码目录外，必须检查正式打包内容并从包内加载全部清单资产；验证五项内置定义及八项示例完整可读、ModelRef 和元模型映射正确、原始定义字节保持、订单用例仍完整供给，并检查缺失资产、重复身份和无效定义/登记等失败路径。其余初始化、导入和当前项目整理边界继续按本契约验收标准执行。

### 后续实施与验证方案

以上资产设计属于本需求契约。需求契约通过后，在同一个 Run 的下一步基于实际代码细化清单格式、读取与安装路径、影响范围、开发任务和测试方案，并交研发、架构、测试评审。本步骤只完成需求及验收调查，没有执行实现或功能测试。

### 需求评审修订

2026-10-03，产品负责人要求“把 reserved-models 的设计放到需求方案里”。本次补入完整目录布局、清单与原始定义分工、稳定身份映射、订单源复用、npm 发布与两类落库时机，并同步当前范围及验收标准第 4 项；功能范围保持本契约所述。

2026-10-03，Human 在界面将产品负责人绑定更新为 `actor5 + traex1`，并明确对第 2 轮投“要求修改”、要求重新发起评审。本次按新绑定重报第 3 轮，仅同步参与者与评审记录；需求范围、资产设计和验收标准不变。

## 开发任务

已按 `development-plan.md` 完成；代码路径、文件清单和验证证据见 `implementation-summary.md`。

## 验收结果

实现与验证成果已获研发、测试、架构和 Runner 通过；Human 已实际验收最新范围并明确投同意，产品 Agent 和 Runner 的交付评审均通过。最终内容包括市场仅保留一个八项示例包、保留既有导入数据且暂不扩展卸载。

## 实现与验证进展

首轮已完成五项系统模型持久化、当时的两市场包与八份示例资产、Run/归档装配、发行与可恢复整理脚本，配套 README/Skill/Memory 已同步。该轮全量测试 933 项：932 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过；typecheck、build、Memory 双校验通过。

当前 memsphere Project 已补装五个系统模型，并将八项原始示例定义及登记移出。备份通过隔离恢复演练，保留 11 项无关模型，24 个非目标文件字节未变。详情及恢复命令见 `evidence/relocation-receipt.json`；没有自动导入示例。

实现成果 Review `review-20261003-092937z-1a30d87f` 第 1 轮三个 Agent 均通过，Runner 已接纳。Human 已完成最终验收，交付 Review 已通过；需求移入 completed 归档，提交结果由同一 Run 的后续 Commit Artifact 记录。

## Project 隔离方式确认

2026-10-03，Human 在讨论 Home 级共享可能性后，明确选择保持各 Project 隔离，接受内置模型多份复制，不增加中控或 Home 级共享存储。内置模型的定义与系统登记随每个 Project 初始化分别落库；发行源继续统一存放于 `reserved-models`。这与已确认方案及当前实现一致，不构成功能范围变更。

各 Project 使用各自的存储目录；现有自定义目录配置仍有效，显式配置同一实际目录会共享文件。此处确认的是保留当前 Project 独立存储方案，并未增加跨 Project 目录占用检查。该设计取舍不代替交付 Review 的正式投票。

## 交付验收期间的市场范围调整

2026-10-03，Human 明确要求“订单示例就去掉了吧”，随后选择“暂不扩展，先移除市场订单包”。因此只移除市场清单中的独立订单包，保留 `memsphere.examples` 八项及其中的用例 02；不新增卸载入口，也不删除任何 Project 的既有导入数据。旧订单候选清理保持可用。最新实现与复验记录见 `market-adjustment.md`，首轮冻结的评审材料及历史测试证据不改写，本次指令不代替正式交付投票。

本次市场范围调整已完成，最终完整回归 937 项：936 通过、0 失败、1 跳过；Memory 双校验通过。已重启当前工作树 View，实际接口仅供给包含八项的示例包，新 Project 中 Human 已导入的八项继续可用。完整结果及最终 Memory checkpoint 见 `market-adjustment.md`。

## 最终验收与归档

2026-10-03，Human 明确表示“我验收没问题了，请你继续流程，我投同意”。Runner 已按明确授权提交 approve，读取全部评审意见后投通过，Review `review-20261003-093613z-5714da24` 第 1 轮完成。Human 随后明确要求创建 PR 并跟踪至 CI 全部通过，无须再次询问是否创建。需求按仓库交付规范归档；最终索引见 `acceptance-record.md`，正式投票证据见 `evidence/delivery-acceptance.json`。
