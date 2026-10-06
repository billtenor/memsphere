# 当前迭代需求契约：模型与数据 CLI 工具

Run：`run-20261003-090655z-f1e492f6`。
日期：2026-10-04（Asia/Shanghai）。版本：第八轮评审稿。
当前代码依据：`2b7400b0d3bff6670982ebcd0a02f023a6859e34`（master #84，系统模型持久化与模型市场示例目录）。Run 启动时的冻结上下文及第一轮 Submission 保留原样，本稿依据合入后的工作区修订。

本契约说明模型与数据 CLI 的本轮开发范围。所有模型、数据与存储采用相同的检查规则；所有 list 命令统一分页，局部修改使用 data edit。读取参数统一为 --path <path>：path 表示记录内的查询路径，本轮采用 JSONPath，后续可支持其他实现。Human 已明确本轮不扩展 Runtime 支持范围，不支持的定义统一明确报错，不要求将这些定义改写到可用。模型 ID 统一及全部跨模型引用清理仍须完成；已有 Project 的 ID 修正复用 project models initialize，具体行为与验收见第 2 节。此前已提交的产物保持原样。当前仍在需求评审，尚未进入实现。

## 整体目标

让 Agent 通过稳定、可发现、可组合的 Memsphere CLI 管理项目模型和模型实例数据，完成“发现模型 → 读取定义 → 准备业务 Store → 创建/读取/修改/删除数据 → 得到明确回执”的闭环。复用现有数据抽象，不要求 Agent 理解磁盘布局、手写登记记录或绕过业务服务修改系统文件。

新增顶层 `memsphere model` 与 `memsphere data`；`data store` 提供最小业务 Store 配置入口。创建 Project 时自动安装系统模型，已有 Project 使用 `project models initialize` 显式安装缺失系统模型或完成本轮模型 ID 统一；两者采用同一标准。模型与数据的读取命令不承担安装或修复职责。

## 统一标准

**本契约的每项标准都适用于全部内容，不因创建时间、导入时间、来源或使用旧入口而降低要求。没有“存量允许、增量禁止”的例外。** 模型 ID、跨模型引用、Store 配置等不符合标准的内容须修正。符合 JSON Schema 格式但超出当前 Runtime 支持范围的定义，采用统一的明确拒绝规则；本轮不扩展 Runtime，也不强制改写这些定义使其可用。

| 对象 | 统一要求 |
| --- | --- |
| 模型身份 | 所有模型和元模型 ID 都以 `.json` 结尾；登记、定义、Store 和程序使用同一 ID，不保留无后缀别名 |
| 模型定义 | 按各自模型格式通过校验；JSON Schema 定义为 JSON 对象，仅允许本模型内部引用，不允许跨模型引用 |
| 模型可用性 | 定义、内部引用及对应的当前 Runtime 全部通过才是可用模型；定义合法但 Runtime 不支持时明确报告不支持，不标为可用，也不误报为定义格式非法 |
| 模型入口 | 新建、更新、导入、安装、恢复和模型使用均遵守同一标准；只改登记信息不能豁免定义检查 |
| Store | 模型、Factory/kind、配置字段、目录隔离与文件协议规则，对新登记和已登记 Store 一致 |
| 数据与写入 | 数据格式、校验、版本条件及跨进程协调规则，不因记录或写入入口的年代而不同 |
| 列表查询 | 所有 list 命令均支持相同的分页参数、边界和翻页方式；已有命令、子节点模式和 Reviewer 入口也执行同一标准 |
| 系统资产 | 系统模型及其登记信息始终不允许通过通用 CLI 修改；持久化保存不赋予额外写权限 |

本轮须逐项检查仓库模型、模型市场、示例和原型，以及当前开发 Project 已有和已导入的模型。模型 ID 和跨模型引用等修正覆盖全部来源及副本；Runtime 检查以“支持的通过，不支持的明确拒绝”为验收标准，不承诺所有现有 Schema 都能使用，也不为通过检查而删减约束。排查清单及发现记录见 `standards-audit.md`。

## 参与者与 Review

用户已授权启动本 Run，要求所有项目 Agent 参与，并额外以 Human 身份参与产品负责人、架构师。

| Slot | 参与者 | 对应产物 |
| --- | --- | --- |
| 产品负责人 | traex1（产品 Agent）、actor5（billtenor） | 当前迭代需求契约、交付报告 |
| 研发工程师 | traex2（研发 Agent） | 实施与验证方案、实现与验证验收材料 |
| 测试工程师 | traex3（测试 Agent） | 实施与验证方案、实现与验证验收材料 |
| 架构师 | traex4（架构 Agent）、actor5（billtenor） | 实施与验证方案、实现与验证验收材料 |

全部 Review scope 使用预检列出的 `artifact_acceptance.unanimous`。各 Agent 按对应流程步骤被正式派发；“全部参与”不表示每个产物都脱离流程 Slot 额外派发全部角色。Human 的正式 Vote 由本人在 View 提交，或在明确投票并授权后由 Runner 代提交。

## 当前设计事实与依据

以下记录源码基线，用来说明本轮需要补齐或修改的地方，不构成对统一标准的例外。

1. `Data = id + model + payload`，模型定义也是 Data；其 `model` 指向元模型。ModelRuntime 提供 Descriptor 和值反射，不负责持久化。
2. ModelRegistration 有 modelRef、name、description、package、package_name、tags、storage、store_id 八个字段。`store_id` 定位模型定义 DataStore，不能用作业务实例的默认 Store。origin 表示来源，storage 表示存储方式；已安装系统模型的 origin 为 system、storage 为 store，不能由 storage=store 推断可任意修改。
3. Store 在 Project 内有独立 ID，每个 Store 绑定一个模型，同一模型可拥有多个 Store。数据必须按 StoreId + DataId 定位。
4. DataStore 保存原始 Payload，ValueStore 直接保存值实例。两者已有 get/has/create/update/delete/list；update 为整条替换，list 仅分页枚举 ID。
5. Project 模型宿主已有 list/definition/runtime，模型写入缺少同时维护定义、登记及依赖关系的统一服务。只删登记，定义仍会被扫描发现。
6. 当前 Project 配置没有通用业务 Store bindings；模型宿主已装配四类模型定义 Store：`models/json-schema/draft-07`、`models/imported/json-schema/draft-07`、`models/system/json-schema/draft-07`、`models/system/raw`。后两类服务已持久化的系统 JSON Schema 与 raw 模型。
7. 当前 Draft-07 定义校验能独立于 Runtime 执行。Runtime 只支持能映射到现有类型描述和数据访问接口的一部分写法，超出范围会在构建 Runtime 时报错；支持的定义已有 Ajv 数据校验。本轮保留此能力范围，不能把“定义格式合法”当作模型可用的充分条件，也不能将“不支持”误报为定义格式非法。
8. 文件型 DataStore 不维护 revision，也不支持 expectedRevision；文件型 JSON ValueStore 有 revision，但现有互斥只覆盖同一个 JavaScript realm，不能承诺独立 CLI 进程间的条件写原子性。
9. Run 内部 Store 的目录与路由受 Run 业务约束，不能直接开放为任意业务数据 CRUD 入口。
10. 系统模型已保存在项目中，默认目录为 models/registrations/system。读取以这些已保存的文件为准；必要文件缺失或损坏时报告错误，不自动替换或修复。系统模型及登记信息不允许通过通用 CLI 修改。
11. 模型市场当前为 `memsphere.examples` 包的八个示例；旧独立 orders 市场项已下架。所有实际使用的示例及已导入模型都在本轮清理范围内，不因来自已下架条目而保留不符合标准的定义。现有市场缺少的 Runtime 准入检查须补齐。
12. 当前模型没有草稿和发布状态。成功创建、更新、导入、安装以及标记可用，都必须通过定义格式、本模型内部引用和当前 Runtime 检查，且不含跨模型引用。对已有定义也采用相同检查，不支持时明确拒绝正常使用，不因已存在而放行。
13. 当前项目和市场模型使用带 `.json` 后缀的文件路径作为 ID，系统模型则在存储时额外补上后缀。这是现有实现的差异；本轮将统一模型 ID 与文件名规则，系统模型不再例外。
14. 当前市场第 06 个示例引用第 07 个模型，可运行原型也保存了该定义副本。这些跨模型引用必须全部改成本模型内部的定义，不保留可继续使用或正常浏览的旧版本例外；相关导入、恢复和测试要求同步修改。

代码依据：`docs/data-layer-design.md`；`src/data/api/{data,model,data-manager,store,data-store,value-store,reflection}.ts`；`src/data/management/data-manager.ts`；`src/data/extensions/{filesystem-datastore,filesystem-json-valuestore,json-schema,json-schema-metamodel,json-serializer}/index.ts`；`src/project/{models,model-registration,model-registration-contract,model,run-data,system-model-store,system-models,model-schema-references}.ts`；`src/reserved/models.ts`；`reserved-models/manifest.json`；`src/cli.ts`；`test/{project-models,system-models,model-market,run-model-storage,data-filesystem-json-valuestore}.test.ts`。

## 当前迭代范围

### 1. 公共 CLI 契约

- 新增 model/data 命令复用全局 `--project <name>`。省略时使用当前 Primary，一次只针对选定 Project；不隐式组合 Mounted Project 的数据。模型和业务数据路径以 Registry 的 Project 根目录为基准，不误用 Embedded Memory 的 worktree 重映射规则。其他 list 命令的查询范围在下表分别说明。
- 新增 model/data 命令的 `--output text|json` 默认 text。JSON 成功时 stdout 恰为一个完整 JSON 值；失败时 stdout 为空，stderr 为一个 `{ "error": { "code", "message", "details"? } }` JSON 对象。正常退出为 0，失败为 1。诊断不得污染 JSON；原始导出流另有约束。所有 list 命令均须支持此 JSON 输出约定；Memory 另有的 YAML 输出同样返回下述分页字段。
- 命令的参数错误、输入解析错误和运行期错误都遵循上述 JSON 错误契约，不通过匹配自然语言错误文本驱动 Agent。
- 回执携带实际 Project、操作及适用的 modelRef/storeId/id。未支持的 revision 或主体身份不伪造；不把可自由填写的 `--actor` 当作可信身份。
- 文件输入均支持 `-` 表示 stdin，文件路径相对命令 cwd。每份输入只能有一个来源，至多消费 stdin 一次；缺少必填输入立即失败，不隐式等待 stdin。JSON 输入支持 null、boolean、number、string、array、object，按实际模型校验。
- 以下 Project 状态变更命令支持 `--dry-run`：model create/update/delete、data create/update/edit/delete、data store create/remove。检查输入、身份冲突、能力与适用影响，返回计划，不修改配置、记录、登记或存储目录。预检不保证实际执行时仍无并发变化，真正提交必须重新检查。data export 只导出内容，不变更 Project 状态，明确不提供 --dry-run；文件输出仅写入显式指定的导出目标。
- list/read/has/validate 不初始化登记、不创建目录、不迁移或写回损坏记录。export 仅写显式目标；使用可创建目录的现有 Factory 时，宿主必须先阻止读操作产生该副作用。
- 只有稳定 ID 可用于写入；模型 name、package_name 和 tags 都不能代替身份。

#### 所有 list 命令统一分页

**所有名为 list 的 CLI 命令都必须支持分页，不因是已有命令、查询模式不同或条目较少而省略。** 当前需覆盖下表全部入口；后续新增 list 也采用同一规则。清单及源码核对见 `list-pagination-audit.md`。

- 参数统一为 `--limit <n>`、`--cursor <token>`。limit 默认 100，须为 1–1000 的整数，非法值报参数错误；省略 cursor 从第一页开始。
- 先应用全部筛选条件，再按明确且固定的顺序分页。limit 限制筛选后的本页条数；同一份内容连续翻页不得重复或遗漏。字符串比较区分大小写，不随系统语言变化。
- JSON/YAML 输出统一包含 `items`，各项保留该命令的领域信息；有下一页时提供 `nextCursor`，末页省略该字段。空结果为 `items: []`，不能只凭本页条数判断是否结束。文本输出也只显示本页，并在有下一页时给出可复制的 nextCursor。
- 下一页将 nextCursor 原样传给 --cursor，可以调整 limit。游标只能用于同一个命令、查询范围、筛选条件及查询模式；例如不能跨 Project、Store、Memory 父节点或 Run 使用。无效或不匹配时报错，不静默返回第一页。
- 分页本身不创建跨页快照，也不要求返回总数。查询源发生变化时，不保证结果与第一页时完全一致；读取 Run 冻结的 Memory 时，仍以该 Run 的同一份冻结内容为准。

| list 命令或模式 | 查询范围、筛选与固定顺序 | 分页要求 |
| --- | --- | --- |
| `model list` | 所选 Project 的模型；先按来源、包、标签、关键词及状态筛选，再按完整模型 ID 升序 | --limit、--cursor；items 为模型概要 |
| `data list` | 所选 Project 的指定 Store；按完整数据 ID 升序 | --limit、--cursor；items 为记录 ID |
| `data store list` | 所选 Project 的业务 Store；先按 model/kind 筛选，再按 Store ID 升序 | --limit、--cursor；items 为 Store 概要，不打开或创建存储目录 |
| `project list` | 当前 Memsphere Home 登记的 Project；按 Project 名称升序 | 补齐 --limit、--cursor；每项包含项目状态及与当前 Workspace 的关系，游标限定 Home 和 Workspace |
| `memory list` | 该命令选定的 Memory 范围；按 kind/query 筛选，再按项目名称和完整逻辑引用升序 | 补齐 --limit、--cursor；保留每项 names/defines 等信息，游标限定实际项目范围及 --run（如有） |
| `memory list <reference> [--node <node-ref>]` | 指定 Memory 或父节点的直接子节点；按定义中的声明顺序 | 同样补齐 --limit、--cursor；返回本页节点和父节点信息，游标限定 Memory、父节点及 --run（如有） |
| `archive list [kind]` | 所选归档范围；先按 kind 筛选，再按 archivedAt（缺失时用 ID）降序，相同值按 kind、ID 升序 | 补齐 --limit、--cursor、--output text\|json；items 为归档条目 |

`memsphere-review memory list` 调用相同的分页能力，并继续受当前 Review Session 的项目与冻结 Run 限制。Memory 顶层列表及子节点列表统一使用 items/nextCursor，不保留另一套 memories/nodes/next_cursor 分页字段；帮助、Skill、序列化及调用方同步调整，节点引用和节点内容不因翻页改变。

### 2. 模型命令

以下命令的完整形式都是 `memsphere model ...`。`<model-ref>` 是模型 ID。**所有模型 ID 统一使用以 `.json` 结尾的相对路径**，例如 `order.json`、`sales/order.json`、`memsphere/model-registration.json`；项目模型、市场模型和系统模型采用同一规则。查看已有模型时，使用 `model list` 返回的 ID，不用显示名称代替，也不自动补上或去掉后缀。

模型有两类可查看的内容：

- **登记信息（registration）**：模型的名称、说明、所属包、标签，以及定义存放在哪里。包用于给模型分组。
- **模型定义（definition）**：描述数据字段、类型和限制的 JSON 内容，例如订单的金额必须是数字。

数据存储（Store）是保存同一种模型数据的地方。用 `data store list --model order.json` 查看哪些数据存储使用订单模型。

来源 `project` 表示本项目创建的模型，`market` 表示从市场导入的模型，`system` 表示 Memsphere 自带的系统模型。**系统模型只允许查看和校验，不能创建、修改或删除；名称、说明和标签也不能改。**

#### 命令和参数

| 命令 | 参数 | 用途 |
| --- | --- | --- |
| `model list` | `--origin project\|system\|market`、`--package <id>`、`--unpackaged`、`--tag <tag>`（可重复）、`--query <text>`、`--status available\|unavailable`、`--limit <n>`、`--cursor <token>` | 分页查找模型；items 返回 ID、基本信息及不可用的原因（如有），有下一页时返回 nextCursor |
| `model read <model-ref>` | `--part all\|registration\|definition`，默认 definition | 读取指定部分；all 一次返回登记信息和定义 |
| `model create <model-ref>` | 必填 `--definition-file <path\|->`；可选登记参数、`--dry-run` | 在当前项目创建模型；ID 已存在时拒绝，不覆盖 |
| `model update <model-ref>` | 可选 `--definition-file <path\|->`、登记参数、`--unset <field>`（可重复）、`--dry-run` | 更新已有的 project/market 模型；至少提供一项修改，未指定的内容保持原样 |
| `model delete <model-ref>` | `--dry-run` | 删除 project/market 模型的定义和登记信息；仍有数据存储使用时拒绝 |
| `model validate <model-ref>` | 可选 `--definition-file <path\|->`、`--check definition\|runtime`（默认 runtime）、`--check-data`、`--store <id>`（可重复） | 检查已保存的模型或指定文件中的定义，返回结果，不保存修改 |

`--definition-file` 读取本地 JSON 文件，`-` 表示从标准输入读取。`--dry-run` 只检查这次创建、修改或删除能否执行，并说明将做什么，不保存任何改动；对系统模型的修改请求仍须报错。

#### 查找和读取

`model list` 的筛选规则：

- `--origin` 按上述来源筛选；`--package` 选择一个包，`--unpackaged` 只找未分包的模型，两者不能同时使用。
- 每个 `--tag` 指定一个必须包含的标签，多次提供时须全部匹配。
- `--query` 搜索模型 ID、名称和说明。
- `--status available` 表示模型满足全部统一标准，包括当前 Runtime 支持；`unavailable` 表示定义不符合规则、当前 Runtime 不支持或文件无法读取，并分别说明原因。文件能读出来不能单独作为“可用”的依据。

`model list` 先应用全部筛选条件，再按完整模型 ID 排序并分页，limit 限制的是筛选后的返回条数。项目、市场和系统模型合并为同一列表，使用相同分页规则。翻页须使用同一个 Project 和相同筛选条件；改变筛选条件时从第一页重新查询。无效游标或其他 Project、筛选条件、命令的游标报错，不静默返回第一页。

例如，每页查询 20 个项目模型；继续查询时，把上一页返回的 nextCursor 填入第二条命令：

```bash
memsphere model list --origin project --limit 20 --output json
memsphere model list --origin project --limit 20 --cursor '<上一页的 nextCursor>' --output json
```

`model read` 默认返回模型定义。`--part registration` 返回登记信息，`--part all` 返回两者。不提供 references 选项或模型之间的引用关系查询。读取结果带上模型 ID 和项目名称；不符合规则或当前 Runtime 不支持时返回对应错误，不因是已有模型而按正常结果返回。读取不会修改文件或重新排版保存的定义。

#### 本轮 Runtime 支持范围

本轮保留当前 Runtime 支持的模型写法，不增加联合类型、条件等尚不支持的能力，也不扩展类型描述、字段访问、字段修改和编解码能力。模型 ID 统一和禁止跨模型引用所需的入口调整仍在本轮范围内。

定义格式非法和定义合法但 Runtime 不支持是两类不同问题，错误必须区分，并说明失败位置及原因。支持的模型继续执行现有完整数据校验；不支持时明确报错，不能忽略规则、回退为 raw 或伪报成功。

该规则对新输入、已有模型、市场和系统模型一致。已有不支持的定义在列表中标为 unavailable，正常读取、使用及完整检查均失败；分项校验可说明定义检查通过而 Runtime 未检查。这不是草稿状态，也不赋予保存或使用资格。本轮不要求这些定义变得可用，不为通过检查而删减业务约束、改写定义或删除数据。

#### 创建和修改

本轮 CLI 创建的模型采用 **JSON Schema Draft-07** 格式，它规定如何用 JSON 描述数据格式。所有采用此格式的模型，定义文件最外层都必须是 JSON 对象。模型 ID 必须符合上述 `.json` 后缀规则，不带后缀时按参数错误拒绝。定义文件可以另取文件名，例如用 `./order.schema.json` 的内容创建 ID 为 `order.json` 的模型。

创建或更新模型时，必须检查修改后的完整模型：定义格式正确、不含跨模型引用、本模型内部的引用有效、当前 Memsphere 支持使用该定义校验数据。全部通过才保存；创建失败不留下新模型，更新失败不写入修改。**create/update 不提供 `--check` 选项，也不创建“先保存、以后才能使用”的草稿模型。**

只改名称、说明、标签等登记信息时，也必须保证更新后的模型满足相同标准，不能借此保留不符合标准的定义。更新不改变模型 ID、定义格式或保存位置。

以下登记参数用于 create/update：

| 参数 | 含义 |
| --- | --- |
| `--name <text>` | 设置显示名称；与定义文件中的 title 分开保存 |
| `--description <text>` | 设置说明；传空字符串表示不显示说明 |
| `--package <id>` | 设置所属包的 ID |
| `--package-name <text>` | 设置包的显示名称；必须已有或同时设置 package |
| `--tag <tag>` | 设置标签，可重复；update 中提供标签会替换原有全部标签，未提供则保持；重复标签报错 |
| `--unset <field>` | 仅用于 update，移除一个登记字段；支持 name、description、package、package_name、tags，可重复使用 |

同一个字段不能同时设置和移除。移除 package 时也移除 package_name，因此不能再同时设置 package_name。移除 description 后，重新使用定义文件中的 description（如果有）。同一包的显示名称不一致时返回明确诊断。

```bash
memsphere model create order.json --definition-file ./order.schema.json --name 订单
memsphere model read order.json --part all
memsphere model update order.json --description 订单数据模型
memsphere model update order.json --unset description
```

#### 模型内部复用与使用限制

**本轮不支持跨模型引用。** 一个模型的定义必须完整保存在自身定义中，不能通过 `$ref` 使用另一个模型的定义，即使两个模型在同一个项目或同一个包中也不允许。例如 `$ref: "money.json"`、`$ref: "money.json#/definitions/amount"` 或指向其他文件、网址的引用都不支持。

同一模型内部仍可以复用定义，`$ref` 只接受空字符串、`#` 或 `#/...` 形式，其他写法均拒绝。例如 `#/definitions/address` 指向本定义内的 address，空字符串和 `#` 指向当前定义的根。引用须能在本定义内找到有效目标，递归等写法仍受当前程序支持范围限制。指向自身也使用这种本地写法，不用模型文件名或网址。示例数据中的普通 `$ref` 字段不当作模型引用。

创建、更新、导入、安装、恢复、读取、校验以及数据存储绑定都执行同一标准。发现跨模型引用时，明确报告“暂不支持跨模型引用”及其所在位置，不能因为定义原本就存在而放行，也不在普通读取中从其他文件或网络补全定义。

本轮必须清理全部现有跨模型引用：将需要的定义放入模型自身，直接定义字段或使用本地 definitions 复用。字段名、含义及数据约束应保持一致，相关登记说明、可运行原型、导入和恢复入口同步修改。不能只改市场源文件，却留下已导入副本继续违反标准。

如果该模型已经关联数据存储，本轮暂不允许改变它的定义或删除它，即使数据存储还是空的。错误使用 `MODEL_IN_USE`，并列出使用它的数据存储。提交的定义没有变化时不受此限制；可写模型的登记信息仍可修改。

没有数据存储使用时，替换定义只校验当前模型，删除只删除当前模型的定义和登记信息；不扫描其他模型的引用，不做间接依赖检查，不自动修改其他模型或业务数据。数据存储使用某个模型不属于这里禁止的跨模型定义引用。

市场导入的模型可以修改，来源和保存位置不影响必须满足的标准。重复导入遇到内容冲突时仍报错，不能把冲突当作不清理现有问题的理由。本轮通过下述显式初始化完成已有 Project 的模型 ID 统一，全部跨模型引用另按本轮清理要求修正。不新增通用模型重命名、迁移或自动升级命令，也不提供模型版本条件更新。

#### 单独校验

`model validate <model-ref>` 默认检查已保存的定义。加 `--definition-file` 时，检查该文件在使用这个模型 ID 时能否通过校验，不保存文件内容。

- `--check runtime` 是默认值：检查格式、本模型内部引用、没有跨模型引用，以及当前 Memsphere 是否支持使用该模型校验数据。这里 runtime 指 Memsphere 执行模型校验的现有组件。
- `--check definition` 仅用于分项诊断，检查格式、本模型内部引用及没有跨模型引用，Runtime 标为未检查。通过此项不能作为模型可用、保存、导入、安装或绑定 Store 的依据；这些操作始终采用完整标准。
- `--check-data` 进一步读取使用该模型的数据，检查它们是否符合定义。默认检查使用这个模型的全部已配置数据存储；可重复提供 `--store` 限定范围。指定的数据存储必须使用这个模型，且程序能读取和校验其中的数据。`--store` 只与 `--check-data` 一起使用，`--check-data` 不能与 `--check definition` 同用。

校验结果说明哪些检查通过、失败或未执行，并给出原因。定义格式非法与当前 Runtime 不支持分别报告；不支持不能当作通过。数据检查报告列出实际检查的范围；检查期间数据可能发生变化，因此结果不保证代表同一时刻的全部数据。校验不会修改模型或数据，也不会解除上面的修改限制。

#### 系统模型未安装或损坏时

创建项目时安装系统模型；项目缺少系统模型时，使用现有的 `memsphere project models initialize` 命令安装。两种安装方式都只接受满足完整标准的系统模型，不保留旧 ID 或旧定义规则。

查看模型不会自动安装或修复系统模型。尚未安装的系统模型不会出现在列表中；读取它时，报“模型不存在”并提示初始化。

模型不符合标准或文件损坏时，列表标明错误，其他合规模型继续展示。如果保存模型登记信息所必需的系统文件损坏，整个命令可以失败，但必须说明原因，不能返回空列表假装成功，也不能直接换成程序自带的另一份定义。重复初始化不改变已经合规的内容；遇到冲突则明确报错，不把不合规内容作为成功安装结果。这些行为不开放系统模型的通用编辑权限。

#### 已有 Project 的模型 ID 如何统一

本轮先同步仓库中的模型资源、登记和程序绑定；当前开发 Project 通过现有 `memsphere project models initialize` 完成对应修正。其他已有 Project 需要时使用同一命令、遵守同一规则。一次只处理选定的 Project，不扫描修改其他 Project 或 Mounted Project。普通读取遇到旧 ID 时明确提示执行该命令，不自动改文件，也不把旧 ID 当作可用别名。

- **修正什么。** 不带 `.json` 的模型和元模型 ID 补上一次后缀，已带后缀的保持原样。例如 `memsphere/model-registration` 对应 `memsphere/model-registration.json`，`json-schema/draft-07` 对应 `json-schema/draft-07.json`，`raw` 对应 `raw.json`。同步更新实际定义身份、登记键与 modelRef、Data.model、Store.model 和宿主绑定；不做任意文本替换。系统定义原本已用 `.json` 文件保存的，保留该文件名，不产生 `.json.json`，也不把目标模型当作旧预览删除。
- **保留什么。** 模型的字段与业务约束、业务数据、名称说明等登记属性保持不变。Store ID、普通记录 ID、存储目录和编解码协议不改。Run 的 Store ID 与模型 ID 分开保存，不再随模型 ID 拼接变化；现有数据地址继续指向原记录。冻结的 Run/Review 产物、Memory 快照、意见和投票不改字节，不对其中的历史文字做替换；正常运行使用新的模型绑定。
- **写入前检查。** 先列出完整的旧新 ID 对应关系和受影响文件，检查定义、登记及绑定是否能一致修正。不同模型落到同一目标 ID、目标内容冲突、登记损坏或必要绑定无法定位时，在写入前失败并列出冲突，不自动合并或覆盖。新安装或变更的系统模型须通过完整检查。无关普通 Schema 超出 Runtime 支持范围不阻止身份修正，修正后仍报不支持、标 unavailable；身份修正不赋予模型可用资格，也不改写其约束。
- **一致完成。** 一个 Project 的本次 ID 修正及相关系统安装作为一次操作完成。修正期间，受影响模型和绑定的读写不得看到一半旧、一半新的状态；提交前重新检查原内容没有被其他入口改动，成功回执须表示全部目标和绑定已一致。具体锁和文件写入机制交由实施方案评审。
- **失败与中断。** 修改前保存本次涉及文件的原内容和恢复进度。普通失败恢复本次修改；进程中断后不能把混合状态当作正常 Project 使用，应明确提示重新执行同一个 initialize。再次执行先恢复到修改前的一致状态，再重新预检和修正。恢复发现文件被其他操作修改时不得覆盖，报告冲突文件及恢复记录位置，交由人工处理后重试。重复执行已经完成的修正不再改变内容。

上述恢复记录只用于完成或撤回这一次显式操作，不提供旧 ID 的正常访问能力，不建立通用迁移工具。系统模型仍不可通过 model/data 通用命令修改。实施方案必须给出相应修改清单和故障测试；本节规定的是需要实现的行为，不代表现有 initialize 已有进程中断恢复能力。

### 3. 实例数据命令

除按模型校验候选值外，所有数据命令都必须显式 `--store <store-id>`。模型从 Store 绑定获得，不能从模型登记的 store_id 猜测实例位置。

| 命令 | 参数 | 产品行为 |
| --- | --- | --- |
| `data list` | `--store`、`--limit <n>`、`--cursor <token>` | 返回 items 中的 ID 与 nextCursor；文件实现沿用默认 100、上限 1000；游标原样传回同一 Store |
| `data read <id>` | `--store`、`--metadata-only`、`--path <path>` | 返回解码值与记录元信息；path 是记录内的查询路径，本轮采用 JSONPath 语法；metadata-only 不要求可解释 Payload，与 path 互斥 |
| `data has <id>` | `--store` | 返回 exists 布尔值；缺失不是执行错误 |
| `data create <id>` | `--store`、值输入或 Payload 输入、`--dry-run` | 目标已存在时报错，绝不覆盖 |
| `data update <id>` | `--store`、值输入或 Payload 输入、`--expected-revision <n>`、`--dry-run` | 整条替换；显式版本条件不符时报冲突，省略为无条件更新；缺失报错，不隐式创建 |
| `data edit <id>` | `--store`、`--patch <json>` 或 `--patch-file <path\|->`、`--expected-revision <n>`、`--dry-run` | 修改指定字段，其余内容保留；输入采用 JSON Patch，整组操作应用后完整校验，最终一次条件提交 |
| `data delete <id>` | `--store`、`--expected-revision <n>`、`--dry-run` | 无条件删除缺失记录成功返回 deleted=false；指定版本而缺失/不匹配时冲突 |
| `data export <id>` | `--store`、`--as payload\|json`、`--out <path\|->` | 导出原始 Payload 或解码 JSON；不提供 --dry-run，不变更 Project 状态；导出目标已存在时拒绝覆盖 |
| `data validate [id]` | 现有记录模式用 id + --store；候选模式用 --model <ref> + 值输入 | 校验数据与模型，不持久化；两种模式互斥 |

值输入：`--value <json>` 或 `--value-file <path|->`，二选一；适用于 ValueStore，以及具有兼容 Runtime 与 Serializer 的 DataStore。结构化值写入必须校验，不能静默类型转换或丢弃字段。

Payload 输入：`--payload-file <path|-> --content-type <mime>`，仅适用于 DataStore，与值输入互斥。按字节保存，不假定能按模型解释；仍检查 Store 绑定和内容格式约束。文件 DataStore 的 DataId 含文件后缀，MIME 必须与后缀映射一致；JSON ValueStore 的 DataId 是单层记录名，其物理 .json 后缀不是逻辑 ID 的自动补删规则。帮助和能力信息须说明各自 ID 约束。

read 默认读取结构化值。不可解码时返回 UNSUPPORTED_CAPABILITY 并指向 metadata-only 或 export，不把原始二进制强行转文本。

`--path <path>` 中，path 是这条记录内部的查询路径。**本轮采用 [JSONPath（RFC 9535）](https://www.rfc-editor.org/rfc/rfc9535.html) 语法；JSONPath 是路径查询的一种实现，后续可以支持其他实现，参数名统一为 --path <path>。** 本轮只实现下述 JSONPath 行为。

例如 `$.customer.name` 读取客户姓名，`$` 表示这条记录的完整值；支持字段访问、数组下标与切片、通配符、递归查找、条件筛选及标准函数。只查询指定记录内部的数据，不跨记录或 Store 查询。本轮表达式必须符合 JSONPath 标准，不接受 `/customer/name` 这样的 JSON Pointer 写法或 JavaScript 脚本扩展；参数语法无效时报错。只对 JSON 兼容的结构化值开放，无法按 JSON 值查询时返回 UNSUPPORTED_CAPABILITY。

不带 --path 时，回执中的 value 是完整记录值。带 --path 时，value 始终是匹配值数组：没有匹配返回 `[]`，命中一个 null 返回 `[null]`，命中一个数组则将该数组作为一个元素保留，不自动展开。匹配顺序及重复命中遵循 JSONPath 标准；不根据匹配数量自动在标量与数组之间切换。记录本身不存在仍按读取缺失报错，与查询无匹配区分。

例如，读取客户姓名、所有商品价格，以及价格大于 100 的商品：

```bash
memsphere data read order-001 --store orders --path '$.customer.name'
memsphere data read order-001 --store orders --path '$.items[*].price'
memsphere data read order-001 --store orders --path '$.items[?@.price > 100]'
```

`data update` 提交完整数据并替换整条记录；`data edit` 修改指定字段，其余内容保留。edit 的输入采用 JSON Patch 格式，通过 `--patch` 或 `--patch-file` 提供，覆盖 add/remove/replace/move/copy/test 语义及数组索引规则，只操作兼容 JSON 的值。必须在隔离副本上完成整组操作，再整体校验；某一步操作失败或最终校验失败都不得提交部分修改。不能逐步调用每次都校验整根的反射修改来改变整组操作的最终态语义。

JSON Patch 操作中的 path/from 按 [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902.html#section-4) 使用 JSON Pointer（如 `/amount`），用于定位明确的修改位置；它们与 read 的 `--path` 查询参数分别遵循各自的标准。JSONPath 的多值查询不自动转为批量修改。

例如，将 orders 存储中 order-001 记录的 amount 字段改为 120：

```bash
memsphere data edit order-001 --store orders --patch '[{"op":"replace","path":"/amount","value":120}]'
```

首版 edit 仅对补齐跨进程协调的 filesystem-json ValueStore 开放。未显式提供 expected-revision 时仍以本次命令实际读取的 revision 条件提交；显式提供时额外检查 Agent 指定版本。此保护只覆盖本次命令的读改写过程，不能代替调用方更早读取时的版本条件。发生冲突不自动重试、不降级为无条件写。JSON DataStore 可 read --path，但没有条件写能力时 edit 明确拒绝。

`data update/delete` 显式提供 `--expected-revision` 时，在提交时原子检查该版本，不匹配或记录缺失时报冲突。省略时执行无条件更新或删除，仍参与写入协调并遵守校验和存在性规则，但不检查调用方之前读到的版本，不承诺阻止覆盖调用方基于旧数据生成的修改。命令临时读取的版本不能冒充调用方的版本条件。所有记录及受支持写入口采用同一规则。

data 命令的 expected-revision 为正安全整数，表示该数据记录版本，不是整个模型或 Project 配置的版本。DataStore 不支持时写入前返回 UNSUPPORTED_CAPABILITY。ValueStore 成功提交才增加 revision，校验、edit 或冲突失败不增加。

export --as payload 仅对 DataStore 原样输出；--as json 使用兼容的值编码，不能普通 JSON.stringify 静默损坏 bytes/bigint 等类型。`--out -` 时 stdout 只输出内容，不再打印回执，且与 `--output json` 互斥；文件导出可返回普通 JSON 回执。不得在 export 中创建目标 Project 状态。

`data list` 遵循公共分页约定，游标仅用于同一个 Project 的同一个 Store；无效游标或其他 Project、Store、命令的游标报错，不静默返回第一页。首版不提供 where/order/join/total 或跨页快照承诺；业务过滤与关联查询后续通过业务读视图设计。重复运行 create 仍报冲突，不提供含糊的默认 upsert。

### 4. 最小业务 Store 管理

| 命令 | 参数 | 产品行为 |
| --- | --- | --- |
| `data store list` | `--model <ref>`、`--kind data\|value`、`--limit <n>`、`--cursor <token>` | 分页列出当前 Project 已配置的业务 Store；items 返回 Store 概要，有下一页时返回 nextCursor，不隐式打开/创建各目录 |
| `data store read <store-id>` | 无额外必填参数 | 返回模型、Factory、配置、可用性、ID 规则、值/Payload 能力及条件写支持范围 |
| `data store create <store-id>` | `--model <ref>`、`--kind data\|value`、`--factory <id>`、`--config-file <path\|->`、`--dry-run` | 验证并登记业务 Store；StoreId 已存在时报冲突 |
| `data store remove <store-id>` | `--dry-run` | 解除业务 Store 绑定，保留目录、记录和内容，返回 dataRetained=true 及保留位置 |

`data store list` 遵循公共分页规则：先应用 model/kind 筛选，再按 Store ID 升序分页；翻页须保持同一 Project 和相同筛选条件。例如：

```bash
memsphere data store list --model order.json --kind value --limit 20 --output json
memsphere data store list --model order.json --kind value --limit 20 --cursor '<上一页的 nextCursor>' --output json
```

首版支持 `memsphere/filesystem-json`（value）和 `memsphere/filesystem`（data）。Factory 表示存储的具体实现，必须与 kind 匹配。`data store create` 的 `--model`、`--kind`、`--factory`、`--config-file` 均必填；模型必须存在且通过完整标准检查，包括当前 Runtime 支持。

配置文件必须包含一个 JSON 对象，两种实现的字段如下：

| Factory / kind | 配置字段 |
| --- | --- |
| `memsphere/filesystem-json` / `value` | 只允许 `directory`，必填，非空且不能全为空白的字符串 |
| `memsphere/filesystem` / `data` | `directory` 的规则相同；另允许可选的 `contentTypeExtensions`，配置文件后缀与内容类型的对应关系 |

`directory` 是存放数据的目录，没有默认值，也不从 Store ID 推测。相对路径以所选 Project 根目录解析，绝对路径按指定位置解析，再检查目录是否可用及是否与其他存储重叠。配置文件本身的路径仍相对命令 cwd。拒绝 null、数组、非对象配置、未知字段和字段类型错误；`model`、`kind`、`factory`、Store ID 由命令指定，不重复写进配置。

data 配置可选的 `contentTypeExtensions` 是 JSON 对象，键是小写、不带参数的 MIME 内容类型，值是文件后缀字符串数组，例如 `{"application/x-ndjson":[".jsonl"]}`。后缀以点开头，只包含字母、数字、下划线、加号、连字符和用于复合后缀的点，不接受路径或通配符；每段以字母或数字开头。省略时使用现有内置映射，如 `.json` 对应 `application/json`、`.txt` 对应 `text/plain`；空对象不改变默认值。同一 MIME 的数组替换该类型的默认后缀，空数组禁用该类型，其他类型保留默认映射。后缀匹配不区分大小写，复合后缀按最长匹配；数组内重复或合并默认映射后同一后缀属于多个 MIME 时拒绝。null、非数组值、非法 MIME 或后缀均拒绝。value 配置不接受这个字段。`data store read` 返回实际使用的映射。

例如，已选定的项目中有 `order.json` 模型时，下面两条命令分别创建值存储和文件存储。`--config-file -` 接收管道传入的 JSON：

```bash
printf '%s\n' '{"directory":"data/orders"}' |
  memsphere data store create orders --model order.json --kind value \
    --factory memsphere/filesystem-json --config-file -

printf '%s\n' '{"directory":"data/order-files"}' |
  memsphere data store create order-files --model order.json --kind data \
    --factory memsphere/filesystem --config-file -
```

所有配置和目录检查在登记或创建目录之前完成，失败不留下配置或目录，dry-run 不创建目录。模型、Factory、目录的变更涉及迁移，首版不提供直接更改绑定的 update；后续独立设计 store migrate。

已存在目录只能在与目标文件协议和模型兼容时显式登记，不覆盖记录；移除后使用相同配置重新登记可读回保留数据。非空且无法证明兼容的目录必须报错。两个业务 Store 的物理根不得重叠，也不得覆盖模型定义、登记、备份、Memory、Run、Archive 等系统托管区域，包含所选登记目录下的 `system/definitions` 和 `system/registrations`（默认分别为 Project 下的 `models/registrations/system/definitions`、`models/registrations/system/registrations`）；按规范绝对路径及可解析别名检查，不以不同 StoreId 假装物理隔离。

以上模型、Factory/kind、配置、目录和文件协议要求同样适用于已经登记的业务 Store。加载时发现不合规内容必须报告错误，不能因登记得早而跳过，也不能忽略未知字段、回退到其他 Factory 或正常开放不符合规则的操作。本轮清理包含当前开发 Project 已有的相关配置和记录，不能只保证以后新建的 Store 合规。

模型定义、登记与 Run 内部 Store 不列为可任意写入的业务 Store，不能通过新建目录别名或自选保留 ID 绕过业务服务。保留 ID 包含 `models/system/json-schema/draft-07`、`models/system/raw`。系统模型可按所需能力作为独立业务 Store 的模型，但不能因此取得系统定义或登记 Store 的写权限。不能使用 data CRUD 直接写登记记录来绕过模型唯一性、系统只读边界或已有数据存储的使用限制。

### 5. 实施必须补齐的能力

- 模型 ID 统一：CLI、View、模型登记的 modelRef、模型定义 Data.id、Data.model、Store 绑定的 model 以及内置模型清单使用相同的带 `.json` 后缀身份。元模型统一为 `json-schema/draft-07.json` 和 `raw.json`，对应 Runtime 和宿主绑定一起修改。Store、Factory、Extension、Serializer 的 ID、目录名称、普通数据记录 ID 不按此规则改名，MIME 和编解码协议保持一致。现有代码中按模型 ID 拼接的系统目录和 Run Store ID 须分开处理。JSON Schema 文档内的 `$id`、`$schema` 不等同于 Memsphere 模型 ID，不强行改写为相对路径。
- 系统模型存储与安装：以完整模型 ID 直接定位定义文件，取消系统专用的补后缀及列表去后缀行为，避免 `.json.json`。删除运行时旧 ID 别名和反向转换规则，不再把 `memsphere/model-registration.json` 当成应删除的旧预览。项目创建安装符合统一标准的模型；已有 Project 的 initialize 按第 2 节完成显式 ID 修正、系统安装及中断恢复，不建设通用迁移流程。
- 模型完整检查：新建、更新（含只改登记）、市场模型作为可用资产发布或导入、系统安装、恢复、Store 绑定和正常模型读取采用一致检查，包含定义格式、本地引用、无跨模型引用及对应 Runtime 支持。分项诊断不赋予正常使用资格。Data.model、Store.model 及元模型归属仍按原有职责工作，不属于跨模型 Schema 引用。
- 全部现有模型检查与必要修正：盘点仓库模型、市场、示例/原型、当前开发 Project 已有和已导入模型。ID 统一、跨模型引用全部改成本地定义，登记说明和副本同步修正。市场第 06 例及原型中的外部引用必须清理；第 04/05 例及当前 Project 的 9 个 run-domain 定义超出当前 Runtime 支持范围，验证其明确报不支持，不强制等价改写，也不扩展 Runtime。保留原有业务约束和数据，不把这些定义标为可用。包含不支持定义的整包导入须在写入前明确失败，不能继续以“八例导入成功、使用时才报错”为验收结果。实际 Run 使用的 raw 模型仍按其对应 Runtime 回归，不改为强制使用这些 run-domain Schema。
- 清理覆盖全部入口与测试：移除 Project 为解析 `$ref` 加载其他模型的行为；市场导入及维护恢复不得重新发布不合规定义，撤掉“恢复时必须保留第 06 例到第 07 例引用”的旧要求。正向测试和可运行示例均满足统一标准，负向测试验证同一拒绝规则；不建设模型依赖图、反向查询或传递影响检查。本次已确定的资源和数据修正单独列入实施任务，不作为通用 CLI 放宽系统只读或直接 Store 保护的理由。
- 模型统一管理服务：协调定义和登记写入、唯一性、system 完全只读与其他来源的字段保护、本模型定义检查、直接 Store 使用检查和失败诊断，接入四类定义 Store。成功回执只能代表两部分均一致提交；中断或清理失败不能留下被当作成功模型的半成品，需提供明确残留及恢复方式。具体最小协调机制在实施方案中评审，不为此建立通用分布式事务系统。
- Project 业务 Store 配置与宿主装配：与模型定义位置、登记 Store 及 Run Store 分开管理，保持各原有职责。
- 业务数据记录的跨 CLI 进程写入协调：filesystem-json ValueStore 的 create/update/edit/delete 及所有能写入这些记录的受支持 CLI、View 和宿主入口都使用同一机制，已有入口不能绕过。两个条件写指定同一版本，或两个 edit 实际读取同一版本时，至多一个提交成功；无条件更新/删除也参与协调，但不保证调用方旧读版本未被覆盖。不能用同进程测试代替。外部手工编辑不在应用协调范围内。
- CLI JSON 输入、值/Payload 适配、JSONPath 读取查询、JSON Patch 局部修改与稳定错误协议；不假定现有 DataManager 已提供这些功能。
- 全部 list 入口分页：实现新增 model/data/data store 列表，以及现有 project/memory/archive 列表的公共分页约定；覆盖 Memory 子节点和 Reviewer 入口。同步命令帮助、JSON/YAML/文本输出及调用方，不能只增加参数却仍一次返回全部内容。
- 修改 System Memory 与 Skill 说明，使 Agent 能发现和正确使用新增能力；仅有 README 不满足现有开发规范。

## 后续范围

- 模型市场 CLI（model market list/read/import），先复用现有 View 市场能力，本迭代不扩大为远程市场、发布或升级；未来提供 model market list 时也必须采用公共分页规则。master 新增八例示例目录作为校验与兼容边界的验证素材，不因此扩大命令范围。
- 通用 ModelRef 重命名、元模型切换、定义 Store 迁移、带实例的模型演化与数据升级；本轮已确定的 ID 统一和现有不合规内容清理必须完成，不属于后置范围。
- 业务 Store 更换模型/Factory/目录及数据迁移、清空与备份工具。
- 跨模型定义引用及其查询、校验、更新和删除影响；后续确有需求时另行设计，本轮不预留开关或绕过方式。
- 通用业务查询语言、跨模型关联、自动关系解引用、级联删除、索引和物化读视图。
- 批量导入导出、跨记录或跨 Store 事务、自动 upsert、追加写命令。
- 任意新模型定义标准；扩展当前 Runtime 的 Schema 支持范围、类型描述、字段访问/修改或编解码能力，包括完整 Draft-07 支持；非 JSON 值的通用路径访问和局部修改。本轮接受对不支持定义明确报错。
- 模型和数据的完整 Web CRUD 界面，以及新的 Actor/ACL 权限系统。

## 交付物

1. 本契约确认的 model、data、data store CLI 命令与帮助文本。
2. 模型 ID、定义和模型归属绑定的统一，全部现有不合规内容的修正，统一标准检查，模型写入、业务 Store 装配、JSON 局部操作和必要的跨进程保护实现。
3. 面向 Agent 的机器输出协议、使用示例、README/数据层文档和相应 System Memory、Skill 更新。
4. 自动化验证与实际执行记录，包括独立 CLI 进程并发测试。
5. 本 Run 的需求、实施方案、Task List、实现摘要、验证报告、评审与交付记录；最终验收后按仓库规范归档需求和提交本轮 commit，PR 由 Human 决定。

## 验收标准

| 编号 | 前提与操作 | 可观察结果 |
| --- | --- | --- |
| A1 | 指定 Project 或使用 Primary；从不同 worktree 执行新命令 | 命中明确的 Project 模型/数据空间；回执标明身份，不跨 Mounted 或误操作另一个根 |
| A2 | Agent 创建 project 模型，并读取、修改和删除未被数据存储使用的 project/market 模型 | 定义与登记一致，名称和定义 title 区分；删除后不被扫描重新发现；重复身份拒绝 |
| A3 | 修改本项目或市场导入模型的登记信息；对不合规模型也尝试只改登记；另尝试修改或删除系统模型，包括 dry-run | 合规模型按参数修改，未指定字段保持，空说明与移除说明效果不同；不能只改登记保留不合规定义；系统模型定义及全部登记信息一律不能由通用 CLI 改删或创建覆盖 |
| A4 | 将格式正确但当前 Runtime 不支持的同一定义作为新输入和已有模型，覆盖创建、更新、仅登记修改、市场导入、系统安装、恢复、读取和 Store 绑定；再执行两档 validate，并与格式非法定义对照 | 正常操作及 runtime 检查统一拒绝，报告 Runtime 不支持及位置，与定义格式非法区分；无部分写入，不修改原定义或数据；create/update 不接受 --check；definition 分项检查可通过，但标明 Runtime 未检查，不赋予可用资格；列表标为 unavailable |
| A5 | 模型被一个或多个数据存储使用，包括空存储；再对未使用的模型替换定义或删除 | 已使用的模型拒绝删除或定义内容变化，并列出直接使用它的数据存储；不检查其他模型或间接依赖；允许替换时只校验本模型，失败保留已有内容；不修改其他模型或记录 |
| A6 | 按第 4 节两条最小配置示例创建业务 Store，读取配置和能力，写入数据后移除，再按相同配置重登记 | 两种 Store 均可成功创建并返回实际目录；数据完整保留并可重新读取；移除后原 Store ID 不能隐式访问；目录冲突、系统别名和不兼容绑定拒绝 |
| A7 | 对具有兼容 Runtime 和值编解码能力的合法模型，以完整 JSON 值执行 create/read/update/delete/has/list | CRUD、完整替换、缺失/重复、分页语义正确；null/标量/数组与对象均按模型工作；无隐式 upsert |
| A8 | 命令帮助统一写为 --path <path>，说明本轮采用 JSONPath；读取覆盖根、特殊字段名、索引、切片、通配符、递归、筛选和标准函数，测试零/单/多匹配、null、数组及非法表达式；data edit 使用 JSON Patch，与 update 整条替换对照 | 本轮 read 带 path 时 value 固定为匹配值数组，无匹配为 []，null 为 [null]，命中数组不展开；语法错误、记录缺失与无匹配区分，本轮拒绝 Pointer 查询参数；edit 的 path/from 保持 JSON Pointer 语义，未涉及内容保留；整组最终态校验，失败无部分更新；不跨 Data 边界 |
| A9 | 两个独立进程显式指定同一 revision 竞争 update/delete；两个 edit 先读到同一版本再提交；另测省略条件的更新/删除及不同受支持入口竞争 | 前两组至多一个成功，另一个冲突；省略条件按实际提交顺序执行，允许连续更新成功，不伪报客户端版本保护；记录完整且版本仅随成功提交变化；所有入口参与同一协调 |
| A10 | 对无 revision 的 DataStore 传版本条件或执行 edit | 写前拒绝并报 UNSUPPORTED_CAPABILITY；不能静默忽略条件 |
| A11 | 写入并导出含非文本字节的 Payload，或导出结构化 JSON | 原始字节一致，MIME 与 ID 规则可诊断；不损坏 JSON 类型；不覆盖现有导出文件 |
| A12 | JSON 模式分别触发成功、参数错误、解析失败、校验失败、冲突 | 约定流上始终为单个可解析 JSON；正确退出码和稳定 error code；无需自然语言匹配 |
| A13 | 未安装系统模型的项目上读取/校验，或对公共契约列明的 Project 状态变更命令 dry-run；另执行实际 export | 读取/校验与 dry-run 不改变 Project 配置、目录、记录和登记；不生成虚拟系统模型行，系统 ID 缺失有明确诊断；export 无 dry-run，只写显式目标文件或 stdout，不覆盖既有目标，不变更 Project 状态 |
| A14 | 使用通用 data 命令指向模型登记、定义或 Run 系统区域，包括 system 目录别名和保留 Store ID | 在业务写入前拒绝；不能绕过 system 完全只读限制；既有 Run、Review、模型市场和初始化流程回归通过 |
| A15 | 行为实现完成，执行本轮验证 | 受影响自动化测试先通过；随后 npm run typecheck、npm test、npm run build、memsphere validate 全部通过；实际命令/结果/未执行项有记录 |
| A16 | 本轮更新 System Memory 和 Skill 后交付 | reserved-memory 源与当前开发 Project 副本同步；必要 manifest 与 reserved-store 测试通过；最终 ChangeSet ID、通过状态和 View 入口与内容一致 |
| A17 | 通过项目创建和 initialize 安装系统模型，重复初始化；另注入身份或定义冲突 | 两条安装路径使用相同的 `.json` ID、定义和对应 Runtime 标准，无重复后缀；重复执行不改变合规内容；冲突明确失败，无部分成功；不开放系统模型通用编辑权限 |
| A18 | 普通模型文件损坏或必要的系统文件缺失、损坏 | 能继续列出模型时，标明出错项并展示其他模型；必要文件损坏导致命令失败时，明确说明原因，不返回空列表假装成功，不自动换用另一份定义或修复文件 |
| A19 | 将本地引用、命名片段、跨模型及嵌套引用分别作为新输入、已有定义、导入内容及恢复内容检查；覆盖登记修改、读取、两档校验、绑定和运行；示例数据含普通 `$ref` | 相同内容不因来源或时间而得到不同合法性结论；有效本地引用通过，无效目标和非支持写法拒绝；跨模型引用定位明确，不为解析引用加载其他模型或联网；无部分写入，普通示例字段不误报 |
| A20 | 清点并校验市场全部示例、已有及已导入模型、示例和原型；回归系统 JSON Schema/raw 模型及 Run 数据读取 | 支持的模型通过完整检查，不支持的统一明确拒绝；04/05 及 9 个 run-domain 定义不因已存在而放行，不删减其约束或数据；含不支持定义的整包导入失败且无部分写入；06 及全部副本的跨模型引用已清理，全部实际定义中的跨模型引用为零；现有 Run 使用对应 raw 模型正常工作；不承诺所有 Schema 均可运行 |
| A21 | 分别读取 registration、definition、all，省略 --part，传入被删除选项；另检查不合规模型的列表/读取和 Store 使用查询 | 两种内容符合所选部分，all 聚合两者；省略时与 definition 一致；references/source/structure 及独立 --source/--all 拒绝；available 仅表示完整合规，不合规读取报错；读取不改文件；Store 查询只列直接绑定 |
| A22 | 对已有 Project 执行 initialize 后，以新 ID 列表、读取、校验和创建业务 Store；覆盖目标 ID 冲突、登记损坏、并发改动、各写入阶段失败及强制终止后重试；回归元模型、原有 Run 数据和冻结历史 | 定义、登记和绑定统一为 `.json`；旧 ID 不作别名；冲突写前拒绝，失败恢复或明确报告需恢复状态，重试不覆盖后来修改；成功后重复执行无变化；无关 Runtime 不支持项仍不可用但不阻塞身份修正；Store/Factory ID、记录 ID、目录、业务数据及登记属性保留；原 Run 数据地址和冻结内容字节不变；元模型及编解码绑定有效，无 `.json.json` 或误删目标模型 |
| A23 | 相同配置分别经新建和已有 Store 加载，覆盖非法 directory、非对象、未知字段/Factory、kind 不匹配、目录重叠与 MIME 映射错误；另从不同 cwd 解析同一 Project 目录 | 新建和已有绑定遵守同一规则，不因登记时间放行；非法内容明确拒绝，无隐式忽略或回退；合法映射及目录结果一致；dry-run 无目录或配置变更 |
| A24 | 对全部实际模型、Store、相关记录和受支持入口逐项核对本契约标准；重复执行导入、安装和维护恢复 | ID、跨模型引用、配置及记录协议的已发现问题全部修正；Runtime 不支持项以统一识别和明确拒绝验收，不要求变得可用；无“旧内容放行、新内容拒绝”的正向用例；恢复或导入不能重新引入问题；每项修正及拒绝验证有记录，不以历史字节相等替代当前标准 |
| A25 | 对公共分页表中全部 list 命令和模式执行默认及指定 limit、筛选后连续翻页；覆盖空结果、末页、非法 limit/游标及跨命令/范围/条件复用；特别覆盖 Store 的 model/kind 筛选、Memory 子节点和 Reviewer 冻结 Memory | limit 默认 100，1 和 1000 有效，0、负数、小数及超过 1000 拒绝；先筛选再按规定顺序分页，未发生内容变化时完整遍历无重复或遗漏；全部格式只显示本页，JSON/YAML 使用 items/nextCursor，末页无 nextCursor；允许调整 limit，其他不匹配游标明确报错；节点顺序、父节点及冻结上下文正确，不额外创建快照；源码命令清单与帮助核对无遗漏，已有 list 无豁免 |

并发保证、故障恢复和可用性边界须在实施方案中给出具体可测契约，不能以理想化“原子操作”代替实际范围。数据规模和并发修改使兼容扫描无法获得快照时，报告明确限制，不伪造全面验证结果。

## 向前兼容

结论：不需要向前兼容。

依据：本次在当前仓库执行 `git tag --list '*stable*'` 未返回稳定 checkpoint，按仓库需求规范不承担非 stable 历史状态的兼容责任。

本轮没有任何基于内容年代的标准豁免。无后缀模型 ID、跨模型引用、错误配置或不符合记录协议的实际内容，都必须按当前统一标准修正。定义合法但当前 Runtime 不支持时，新旧内容均明确拒绝，不标为可用；这类能力限制不要求通过扩展 Runtime 或改写定义消除。不能为了兼容而保留第二套 ID、校验、导入、恢复或写入规则。

本轮直接完成已确定的资源、代码、登记和数据修正，不建设旧格式兼容层或通用迁移工具。保留正确的业务数据、字段含义及登记属性，不以删除数据代替修正。历史评审、归档和负向测试是记录与验证材料，不是可继续发布的不合规模型；任何重新进入有效模型或数据空间的内容都须满足同一标准。

## 已采用的 Memory 与仓库规范

- `procedures/memsphere-agile-requirement-development`：当前步骤产物内容、依次评审与人机协作、实现验证和交付流程。
- `concepts/memsphere-framework`：模型定义/登记区分、八字段登记、来源与包、Project 根路径、只读发现、四类定义 Store、系统模型持久化与启动边界、市场冲突和系统数据职责；本稿已结合 master 合入后的当前版本重新核对。
- `statements/memsphere-repository-requirement-rules`：独立向前兼容结论及 stable checkpoint 判据。
- `statements/memsphere-repository-development-rules`：避免过度设计、新能力的 System Memory/Skill 同步；本轮不计划新增 Memory YAML syntax 关键字。
- `statements/memsphere-repository-testing-rules`：四项必跑门槛、实际 CLI/跨进程边界测试、受影响与全量回归、Memory/Reserved Store 验证。
- `statements/memsphere-repository-delivery-rules`：最终 Memory 差异证据、提需方验收和需求归档。
- `changes/README.md`、`CONTRIBUTING.md`：需求记录格式、关联 Run、测试与文档同步。

已通过 Memory Catalog 检索核心概念，未发现独立的 Model/Data/Store Concept；使用命中的 memsphere-framework 完整定义，并以数据层设计与当前源码补充依据。当前仅新增需求/评审配置文件，尚未修改 Memory、业务代码或执行实现测试；不创建空 ChangeSet。

## 本轮决策与后续架构工作

以下产品取舍已写入正文，并获 Human 第七轮通过票。实施阶段不得悄悄替换，也不再重复询问这些相同取舍：

1. 本轮包括模型 CRUD、业务数据 CRUD/校验/导出、JSONPath 读取查询、JSON Patch 局部修改和最小 Store 管理，模型市场 CLI 后置。
2. 模型已有直接业务 Store 绑定时暂拒绝定义内容变化和删除，先通过只读 check-data 分析，模型演化/迁移后置；不再检查跨模型依赖。
3. 首版 edit 仅对补齐跨进程条件写的 JSON ValueStore 开放，普通 DataStore 仍支持原始 CRUD，但不伪造 revision 能力。
4. 模型标准对全部来源和时间一致；新建、更新（含只改登记）、导入、安装和恢复均执行完整检查，分项诊断不能作为可用资格。系统模型仍禁止通用 CLI 修改，project/market 可修改；这是操作权限差异，不是模型标准差异。重复导入的冲突处理不能被用来搁置本轮现有不合规内容清理。

产品 Agent 提出的 **已有 Project 的模型 ID 如何修正**，本稿已在第 2 节补齐：复用 initialize 显式修正，先检查完整对应关系和冲突，再一致提交；失败恢复，中断后通过同一命令先恢复再重试；数据地址及冻结 Run/Review 内容保持不变。A22 覆盖这些结果。具体文件清单、锁、恢复记录格式和故障注入位置由下一步实施方案与架构评审确定，不改变这里的产品行为。本轮新增的这部分说明接受正式评审，尚不代表实现已完成。

关于 **Runtime 不支持的约束如何保留**，Human 已在第七轮讨论中明确：本需求不扩展 Runtime，不支持时直接报错可以接受。本稿据此撤掉强制改写市场 04/05 及 9 个 run-domain 定义的要求，保留其约束，按新旧一致的拒绝规则验收。这是已经明确的需求范围，不再作为待扩展能力；正式评审也不表示实现或验收已经通过。

第二轮 Human 正式投票要求修改，要求落实已讨论的命令调整，并用清楚的语言重写整个“2. 模型命令”。第三轮已提交这些修改及产品 Agent 提出的导出命令澄清，修订摘要见 `revision-summary-round-3.md`。

第四轮 Human 已正式投要求修改，要求清理全部已有跨模型定义，并全面禁止任何“存量允许、增量禁止”的规则；Runner 已代提交两条 blocking Comment。第五轮已提交全篇审查结果和产品 Agent 的条件写语义修改，详见 `standards-audit.md` 与 `revision-summary-round-5.md`。此前各轮正式产物和投票保持原样。

第五轮 Human 已正式投要求修改，要求所有 list 命令支持分页，并采用 data edit 命名；Runner 已受托提交两条 blocking Comment。本稿已全面核对新增及现有 list，补齐公共规则、完整清单、Store 示例和 A25，同步修改 edit 命令名及相关说明和验收。修订记录见 `revision-summary-round-6.md`，列表清单见 `list-pagination-audit.md`。第六轮完整需求及上述未决问题继续接受正式评审。

第六轮讨论中 Human 指出读取路径本轮采用 JSONPath，并最终要求参数统一为 --path <path>，后续可支持其他路径实现。Human 已在 View 提交的第六轮 approve 保留；Runner 按 Human 最新明确的修改要求投 request_changes，进入第七轮。本稿已修改参数说明、返回规则、示例及 A8；摘要见 `revision-summary-round-7.md`，最新要求与决策依据见 `review/round-6-revision-request.md`。

第七轮 Human 已投通过，产品 Agent 要求修改上述两项。Runner 保留 Human 的通过票，决定将 Runtime 最新范围及补齐的 ID 处理行为形成第八轮修订，不能以本地工作稿替代第七轮冻结产物。修订摘要见 `revision-summary-round-8.md`，Runner 决策依据见 `review/round-7-runner-decision.md`。当前未发现额外必须由 Human 选择的新产品范围；具体实现机制留待架构评审。
