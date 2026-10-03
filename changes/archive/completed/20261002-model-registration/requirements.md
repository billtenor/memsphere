# 当前迭代需求契约：模型登记存储与包浏览（第 6 轮修订）

Run：run-20261002-113512z-65600623。产品负责人：Human billtenor（actor5）与产品 Agent（traex1）；研发 traex2、架构 traex4、测试 traex3。此版本响应第五轮 Human 对“先选存储 ID，再编辑所选存储详细配置”的要求修改，以及产品 Agent 对登记/备份与可配置模型目录隔离的阻塞意见；保留前轮字段顺序、代码内置启动和本地包导入规则。原型反馈用于确认设计，不等同于通过票。

## 整体目标

以简洁的模型管理记录承载名称、说明、包归属、包名称及标签，使用现有 filesystem JSON ValueStore 持久化，将本聊天已对齐的展示方案接入正式模型模块。模型定义原文继续使用 DataStore。

## 当前迭代范围

### 1. 模型登记

采用内置管理模型 memsphere/model-registration，仅包含以下八个字段：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| modelRef | 是 | 稳定模型 ID，也是在模型 Store 中读取定义的记录 ID；项目内不得重复登记 |
| name | 否 | 模型名称，缺省回退到定义 title，再回退到 modelRef |
| description | 否 | 模型说明，缺省回退到定义 description，空字符串表示不展示说明 |
| package | 否 | 包分组标识，省略表示未定义包；本项目也可有自己的包 |
| package_name | 否 | 包显示名称，允许在同包模型中重复保存，缺省显示 package；仅在 package 存在时使用 |
| tags | 否 | 任意分类标签；不重复，无标签可省略或为空数组 |
| storage | 是 | 模型定义的存储方式：builtin（代码内置）或 store（持久化存储），不表示包的来源 |
| store_id | 条件必填 | storage 为 store 时必填，以 store_id + modelRef 读取；builtin 时不得填写 |

不再保存 domain、嵌套 definition、kind/provider/dataId 等定位字段，也不单独保存来源字段或定义标准。定义标准从实际定义的 Data.model 取得。

同包的 package_name 按一致性约定维护；展示不得猜测中文名。缺失名称明确回退到 package。独立包模型本轮不建设，包版本、发布、升级管理后置。

模型登记采用现有 memsphere/filesystem-json ValueStore，建议 Store ID memsphere/model-registrations、Project 路径 models/registrations。记录身份不得受 modelRef 含斜杠影响；管理服务检查项目内唯一性。初始化/迁移显式、可重复执行且不覆盖已有管理属性；普通读取不静默迁移。

模型归属本项目、系统或市场导入的范围通过项目/系统/导入的装配或存储上下文确定，不依赖是否填写 package，不建立独立包登记持久对象，也不把原型外层 origin 变成新的 ModelRegistration 字段。项目登记与导入登记分别保存在同一 filesystem ValueStore 扩展的独立 project / imported 区域，读取结果携带区域上下文；重启后归属保留。系统登记由代码装配提供，只读。跨区域 modelRef 必须唯一；界面按上下文分组，不能靠包名推断。区域上下文不进入八字段登记模型，不增加包登记实体。

memsphere/model-registration 的定义必须代码内置，先注册到 Runtime，再创建登记 ValueStore；系统可装配它的自描述登记记录，但解析管理模型本身不读取登记记录，避免启动循环。模型信息显示代码内置、无存储 ID。当前 model-registration.json 是临时持久化预览文件，正式实现不据此推断管理模型的存储方式；正式切换在显式初始化/迁移入口中处理：先将旧预览文件原文字节及 oldRef → newRef 对照保存到 Project 根目录 backups/model-registration/（模型发现显式排除的内部备份目录）；校验备份后从模型扫描位置移出旧文件。备份路径由迁移回执输出，可按路径读取原文。旧 memsphere/model-registration.json 不再登记或出现在本项目/包列表；原型与正式页仅显示 canonical ID memsphere/model-registration 的代码内置模型。旧详情 URL 规范化跳转到此内置模型；扫描已知引用并显式更新，发现无法迁移的引用则停止切换并报告，不产生重复模型或损坏引用。登记草案中的旧项替换为新内置项，不保留第二条同名记录。迁移后仍为 13 个模型：8 个原项目示例、4 个既有运行内置模型、1 个新的内置登记模型；原型中的市场演示不计入。任何备份/迁移失败保留原资产并报错，不完成切换。跨字段 storage/store_id 条件由管理服务执行校验；现有 Runtime 的 JSON Schema 子集承担必填、枚举及结构校验，不声称已支持 if/then。

当前真实 Project 的 13 个模型是显式迁移输入；旧登记预览项由新的代码内置项替换，迁移后的 13 个模型是登记与验收对象；原型市场导入演示不视为真实项目数据。保留模型原文及真实定义关联。当前八字段 Schema 已可由已有 JSON Schema Runtime 反射，不再以联合结构支持作为本轮任务。

模型存储隔离规则：modelsDirectory 保持可配置；模型发现必须在枚举和读取定义前，根据 Project 配置（不依赖登记记录读取）排除所有已配置的模型登记 filesystem 根目录及其子路径，以及内部备份根 backups/model-registration 的所有内容，覆盖目录扫描、单 ID 读取及原始定义入口，不能只靠文件扩展名或 UI 隐藏。路径按解析后的绝对规范路径处理；符号链接/别名指向排除目录时同样不得作为模型读取。扫描根是排除目录的祖先（包括 Project 根）时正常扫描其余资产并剪枝这些内部目录。扫描根等于排除目录或位于其内部、登记根包含模型扫描根、登记根与备份根互相覆盖，均拒绝保存/初始化/迁移并明确指出冲突路径；不移动或覆盖数据。已有配置冲突时显式报告并禁止相关写入，正常已有效模型不由静默迁移修复。新增或修改 modelsDirectory、登记目录、执行旧预览迁移前均执行相同检查；备份目录的排除规则在迁移前生效，旧目录在数据保留期间仍纳入排除集合。默认目录、自定义相对/绝对模型目录、Project 根扫描、冲突根及别名读取都必须验收，任何登记 JSON、备份和身份对照文件不得成为模型。

### 2. 模型登记存储设置

复用正式“设置 → 存储”入口，新增“模型登记存储”选择项，先选择 ValueStore 的存储 ID，再加载并编辑该 Store 的详细配置，默认 memsphere/model-registrations。仅列出可用且接受内置 memsphere/model-registration 模型的 ValueStore；不存在、不可用或不接受此模型的 Store 不得保存为有效选择，并提供原因。

默认 Store 使用 filesystem ValueStore，目录 models/registrations（相对于当前 Project）；选择 ID 后在同一页面展示并编辑所选 Store 的配置；切换 ID 时加载对应配置，不沿用上一 Store 的目录。当前 filesystem 的目录可编辑，类型按已支持的 Store 类型展示；不虚构其他类型。本轮不包含任意切换 Store 扩展类型。保存时同时校验所选 ID 及对应配置，取消不写入，失败保留原配置。登记模型固定为代码内置，无需选择。模型存储指各模型的结构原文存储，与登记管理信息的 ValueStore 分开；固定文案统一使用“模型存储”。

首次初始化时自动提供默认 Store 及选择，重启后读取已保存选择。已有登记数据时切换 Store 或修改 filesystem 目录均需显式迁移：先确认目标可用，完整复制并校验管理记录，成功后切换配置；失败保留原选择及原数据并报告。冲突拒绝迁移，不静默覆盖；原存储数据保留，后续清理不属于此次切换。Store/目录的具体技术字段在实施方案中明确，以上选择、校验、持久化和迁移结果属于本轮验收范围。原型设置保存仅演示反馈，不改变真实配置。

### 3. 正式模型页面

沿用已经对齐的四栏原型，使用正式 ViewHost、Loader、Route、Slot、Theme 与 UI，不以独立静态页或 Fixture 代替正式 Shell 验收。

二级导航：小字“本项目”下面列“未定义包”和各项目包；小字“已导入的包”下面列系统内置与市场导入包；另设模型市场入口。项目包名称来自 package_name，缺省来自 package。不设“全部模型”入口，三级列表也不重复提供包选择。

三级列表在当前入口范围内提供搜索与标签筛选。列表项四行定义为：

1. 名称：name，采用已明确的缺省回退。
2. 模型 ID：modelRef，过长截断并可查看完整值。
3. 说明：description，最多一行，缺失时省略。
4. 标签：仅 tags，最多两个，更多显示 +N，剩余标签可查看；没有标签省略此行。不在列表展示定义标准。

详情 Tab 顺序为“模型信息 → 模型结构 → 原始定义”，默认模型信息。模型信息以一个只读字段/值表格展示名称、说明、所属包（显示名和标识）、模型 ID、定义标准、标签、存储方式、存储 ID，严格按此顺序排列，定义标准紧接模型 ID。不展示登记 JSON、下载模型信息按钮、所属领域、包来源行、重复定义 ID、“加载方式”或“定义位置”分组；无存储 ID 显示缺省占位，不捏造 Store。

模型结构保留树表、展开/收起和既有显示规则；原始定义保持原文。范围、标签、模型选择写入稳定 URL，切换时不得选中范围外的模型；未知入口和无匹配模型有明确结果。

固定文案支持 zh-CN/en，采用公开 Theme/UI/Slot 协议；覆盖 loading/empty/error、损坏单条记录、键盘路径及卸载清理。

### 4. 本地模型市场

市场以 package 为浏览与导入单位，包页面展示包含的模型及结构预览。本轮至少提供一个真实可导入的随发行本地模型包；展示名称取包中模型的 package_name，不要求独立包模型。

导入生成模型定义及管理记录，并在导入上下文中可辨识；未导入包不进入项目模型列表。重复导入、身份冲突和失败必须明确反馈，不覆盖用户模型或已改管理属性，失败不得留下伪成功状态。

原型中的 acme 包和市场导入演示模型仅用于视觉验证，不冒充可安装的正式发行内容。本轮最小正式包固定为 memsphere.examples.orders，包名“订单示例”，包含一个模型 memsphere/examples/order.json，定义内容复用仓库 examples 中的订单与深层嵌套示例，登记 storage=store、package=memsphere.examples.orders、package_name=订单示例、tags=[订单]。发行资产随本地应用提供，定义及对应八字段登记文件构成包，不需要独立包模型；store_id 在导入时绑定目标模型 Store。原型当前项目订单示例与市场正式包使用不同 modelRef，保留现有模型身份。

导入的产品规则（本轮评审提案）：

- 导入前校验整包定义、登记结构及存储方式约束，检查所有区域中的 modelRef。整包有效且无冲突才写入。
- 同一包重复导入且目标定义原文字节及管理记录与目标导入内容一致，显示“已导入 · 无变更”，不重复写入。若已导入模型或管理属性有修改，显示“已有内容不同，未导入”及冲突模型 ID，不覆盖用户修改。
- modelRef 已存在于其他区域或包，或相同包中内容不同，拒绝整包导入并列出冲突 ID，不自动重命名、合并或覆盖。
- 成功后全部模型进入 imported 区域，列表与数量更新，重启后仍可辨识。导入未完成的候选不出现在正常模型列表。
- 校验或写入失败显示“导入失败”及原因，不显示成功；撤销本次新建候选，保留导入前已有数据。清理也失败时明确显示待清理模型 ID，并保持候选不可见，允许重试清理；不得把残留候选当作已导入。具体暂存与发布技术在实施方案评审，但产品的整包可见性与数据保护规则不再后置。

## 后续范围

独立包登记模型、包版本与自动升级、远程市场服务、账号与发布、任意网络包下载、签名与治理、完整模型编辑器/CRUD、领域对象及层级。也不扩大为整个 JSON Schema 联合/条件标准实现。

## 交付物

- 八字段内置管理模型、filesystem JSON ValueStore 装配、显式初始化/迁移入口。
- 正式模型读取 API、项目/系统/导入范围及本地模型包导入。
- 已对齐原型的正式导航、标签列表和模型信息表格，以及模型登记存储设置和显式切换迁移。
- 受影响自动化测试、正式 Shell 验收证据、最终验证及交付报告。
- 同步 change.md、必要文档/Skill/Memory；产品负责人验收后归档需求并创建本轮 commit，是否创建 PR 由 Human 决定。

## 验收标准

1. 迁移后恰为 13 个有效模型（8 示例、4 运行内置、1 登记内置），旧 .json 预览不重复展示；备份原文可按回执路径读取，旧详情 URL 跳转内置模型。当前真实模型可显式初始化为有效登记，modelRef 项目内唯一；重复操作不复制记录、不覆盖 name/package/package_name/tags 或定义原文。创建含斜杠的 modelRef 不因 ValueStore 记录文件名限制而失败。
2. 有包的项目模型与未定义包模型都出现在本项目分组；系统与市场导入在对应外部包入口。归属判定不依赖 package 是否存在，无独立包模型依赖。
3. 包名由 package_name 提供，缺省显示 package；同包重复名称按约定一致。模型列表仅显示 tags，两个/更多/无标签与空说明边界均符合四行约定。
4. 模型信息是默认第一个 Tab，以单个表格按名称、说明、所属包、模型 ID、定义标准、标签、存储方式、存储 ID 的顺序显示，无已删除字段、登记 JSON 或下载按钮；结构、原文与既有 ModelRef 的行为保留。
5. 正式标签筛选、搜索、包范围切换、稳定 URL 与空状态正确；单条完整性损坏不阻塞其他记录，存储 I/O 失败不得静默吞掉。
6. 至少一个真实本地包可预览并导入；重复、冲突、失败路径不覆盖数据，导入来源范围可辨识，不借助独立包登记实体。
7. modelsDirectory 仍生效；定义文件、原文字节、模型 ID 和引用保持一致。store_id + modelRef 与运行时使用的模型身份一致，程序内置模型能直接解析。storage 必填且只允许 builtin/store；store 缺少 store_id 或 builtin 携带 store_id 必须被拒绝。管理模型在空登记存储下仍能解析并创建第一条登记，不依赖自己的登记记录。
8. 先运行并通过受影响自动化测试，再通过 npm run typecheck、npm test 全量回归、npm run build 和 memsphere validate。npm run validate 不能替代 memsphere validate。记录本轮实际命令、结果、未执行项，区分本轮失败、历史失败与环境阻塞，失败时不声称交付。
9. 所有前端交互修改交付前使用 playwright-cli 实际操作验证；在正式 Shell 检查中文/英文、桌面/窄屏、键盘、loading/empty/error、刷新 URL 和卸载清理。自动化等待被测状态，不依赖固定睡眠；静态原型和历史截图不替代此次产品验收。
10. 如果本轮修改 Memory，最终内容同时通过 memsphere validate 和 memsphere memory change validate [change-id]，记录 ChangeSet ID、状态及 View 入口。System Memory 变化需同步开发 Project 副本并跑 reserved-store 必要测试，其他变更按测试规范执行对应套件。
11. 产品负责人验收后在 change.md 写入结果与 completed_at，移除 active status，将目录移到 changes/archive/completed，已有归档目标不得覆盖；归档前不称完整交付。只提交本迭代改动，记录 commit SHA，PR 由 Human 决定。

12. 设置→存储可选择模型登记 ValueStore，初始默认 filesystem 及项目相对目录，切换 ID 使详细配置同步切换，filesystem 目录可编辑，所选 ID 和详情持久化；空目录、无效目标不能保存，取消不写入。固定内置登记模型无需用户选择。已有数据切换或目录修改需显式迁移，成功后切换，失败/冲突保留原配置与数据；相关页面文案统一为模型存储。

13. 默认及自定义 modelsDirectory 下，登记与备份资产不进入模型发现/单 ID 读取；Project 根扫描安全剪枝内部资产，根范围冲突明确拒绝，目录变更及迁移前执行一致校验。排除不依赖登记数据启动。

## 向前兼容

结论：不需要向前兼容。

当前 git tag --list '*stable*' 未返回稳定 checkpoint；按仓库规范，不承担非 stable 历史版本的兼容责任。但数据保留仍是本轮明确要求：现有文件、原文字节、ModelRef、modelsDirectory 保留，通过显式迁移补齐管理信息，不覆盖真实资产。

## 已采用的 Memory 与仓库规范

- procedures/memsphere-agile-requirement-development：契约、方案与成果评审、真实验证、产品负责人验收、commit 和 PR 决策。
- statements/memsphere-repository-requirement-rules：独立向前兼容结论与 stable checkpoint 判据。
- statements/memsphere-repository-testing-rules：四项必跑门槛、受影响及全量回归、playwright-cli 交互、正式测试边界、稳定等待、Memory 与相关范围套件要求。
- statements/memsphere-repository-delivery-rules：最终 Memory 校验、验收结果记录和归档要求。
- concepts/memsphere-framework：模型定义/DataStore、Project 上下文、现有 Runtime、正式 Shell/Theme/UI/Slot 与语言边界。
- CONTRIBUTING.md：行为变更测试与文档同步。具体开发规范在实施方案步骤继续读取。
- 已检索 Concept，无专门 ModelRegistration/模型包 Concept 命中；不虚构其既有规则。

## 待确认项

请产品负责人审阅此版本是否完整反映已确认的简化设计，并确认本轮包含真实登记存储、正式模型页和最小本地市场导入，远程市场与独立包模型后置。同时确认上述登记存储设置与切换迁移、旧预览备份及单一内置身份、管理模型代码内置启动、来源区域、最小订单包及导入保护规则；具体技术方案将在下一步由研发、架构和测试评审。

## Human 已确认的界面调整（2026-10-02）

Human 查看正式界面后明确要求：模型市场与已导入的包分开，独立“发现”小字分组并保留分隔；标签筛选使用统一下拉菜单；本轮临时隐藏添加登记存储和初始化入口，已有存储选择及详细配置仍可用，内部服务/显式CLI保留以便以后开放。该指示直接作为本轮范围调整的授权，不重新请求重复确认。
