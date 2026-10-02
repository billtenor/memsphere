# Project 模型存储与模型界面：实施与验证方案

Run：`run-20261001-054855z-53c67dce`。基准为产品负责人已通过的第 2 轮契约与已处置的文字修正，不变更产品范围。

## 实际代码与问题

- `src/project/model.ts` 定义严格的 Project 配置；`src/project/paths.ts` 的 `root` 来自 Registry，不是 Git/Memory 目录。配置中心只允许编辑指定字段，新增目录配置必须同步读草稿、归一化、校验、diff、写回及前端。
- `src/data/extensions/filesystem-datastore/index.ts` 已支持 ID 对应可移植相对文件名、递归 list、分页、原始字节读写和后缀识别。Factory 会创建缺失的根目录；本轮直接复用，不新增索引、封套或文件格式。
- `DefaultDataManager` 构造时接收明确的 ModelBinding 与 StoreBinding，按 ID 延迟加载。读取持久化模型时会先准备元模型 Runtime，再通过 Serializer 解码；业务 JSON Schema Factory 已存在，但缺少 `target.model=json-schema/draft-07` 的元模型 Factory。
- JSON Schema Runtime 当前支持显式单类型的 Draft-07 子集及已有引用方式，不支持任意联合类型等全部 Draft-07 特性。本轮不改变这个已有边界，不把可阅读定义等同于一定能创建业务 Runtime。
- `src/project/run-data.ts` 已装配四个 raw Run 业务模型；Runtime 缓存不是模型目录，不能用缓存反推“全部模型”。
- View 已有 Project 隔离 API、Module 资产构建和公共列表/UI。独立原型完成树形表格及设置预览，不连接真实数据；正式模块必须去除样例、演示态和模拟保存。

## 实现方式

### 1. Project 配置与路径

新增 Project 配置可选字段 `modelsDirectory: string`，省略时取 `models/json-schema/draft-07`，空白值和 NUL 字符校验失败。保留用户填写的相对或绝对值，路径解析统一由 Project 宿主按 `paths.root` 完成，使用 Node `path.resolve` 支持各平台。目录不是逻辑 ModelId，逻辑 ID 继续统一使用 `/`。

配置中心增加项目级“模型存储”分组，显示配置目录、Project 根目录和解析后的绝对路径。沿用现有草稿、校验、保存前 diff 确认、revision 冲突保护与放弃机制。省略字段不强制写回，保存新值只更新当前 Project 配置，保留 Store、Control Plane、View 和其他允许字段；不修改 Home 配置。切换目录立即对下一次模型刷新生效，无需重启，不自动搬运。

`src/config.ts`、`src/config-management.ts` 和 Settings API 同步传递已解析目录。模型 API 每次读取当前 Project 的磁盘配置，不能长期使用启动时的目录快照；Project 切换和显式 Project API 均只解析指定 Project。

### 2. JSON Schema 元模型引导

新增原子的内置扩展 `memsphere/json-schema-metamodel`，Factory 只匹配 `{ model: "json-schema/draft-07" }`，与现有匹配 `{ metaModel: "json-schema/draft-07" }` 的业务 Factory 分开注册。

宿主通过现有已解码 ModelBinding 提供这个元模型，无需先读取元模型自身的文件。其 Runtime 描述 JSON Schema 定义的对象根，公开确定为字符串的元信息字段（`$schema`、`$id`、`title`、`description`），不把 `type` 等多形态关键字错误固定成一种类型。其他关键字保留在完整 JSON 值中，但不承诺通过此最小元模型的字段反射访问。沿用公共 object Descriptor 与 Value，不新增 opaque/union 或其他公共类型。

JSON Serializer 仍按 Descriptor 读取完整 JSON 并保留未知字段；元模型 Runtime 对定义对象执行 Draft-07 元模式校验，不注入默认值、不丢字段、不读取远端资源。不支持的标准、非对象根或不合法定义显式报错。业务 Runtime 的支持范围仍由现有 JSON Schema Factory 检查，元模式合法不代表业务反射一定可用。

验证元模型与业务模型的两种 Factory 选择，确保不递归加载元模型自身、不假装业务模型定义是 raw 字节、不绕过 DataManager 的反序列化流程。

### 3. Project 模型宿主与目录

新增 `src/project/models.ts`，负责模型目录路径、Store 装配、模型目录条目与 Manager 的组合，不修改 `src/data/api`。

- StoreId 为 `models/json-schema/draft-07`，单一绑定 `json-schema/draft-07`，Factory 为 `memsphere/filesystem`。
- 列举使用 Store.list 完整翻页，筛选 `.json` 模型文件，保持逻辑 ID 与原文件相对路径一致。不读其他后缀文件为模型，不创建额外索引。
- 使用 Store.get 为扫描出的 ID 构建 lazy loadData 绑定，提供已解码的元模型与四个现有 raw 业务模型；不依赖 Runtime 是否已被调用。
- 每次显式刷新/新的模型请求构造当前目录的宿主与 Manager，Manager 在该次操作内共享准备缓存；不用公共接口增加热替换、失效或全局自动发现机制。
- 目录列表可读取标题、说明等顶层元信息；单个 JSON/Schema 不合法时保留该 ID 的 unavailable 条目，详细错误在选中后展示。权限、路径冲突等存储故障明确暴露，不静默变为空列表。
- Runtime 获取沿用 Manager 与现有依赖绑定：受支持的本地递归引用由 Factory 处理，跨模型引用需按现有精确 ModelRef 语义提供依赖，缺失或环状跨模型依赖显式报错。不新增 HTTP schema 下载或 `$id` 别名解析器。
- Built-in raw 列表来源复用 Run 的四个实际定义，不维护另一组可能漂移的模型名。模型目录 API 不展示元模型，不迁移 Run 状态。

模型定义和 Runtime 在一次操作中的缓存不构成跨请求快照承诺；用户直接修改文件后刷新重新加载。本轮不建设监听器或历史版本管理。

### 4. 只读 Project 模型 API

在现有 View 服务添加 Project-scoped 只读接口：

- `GET /api/projects/:projectId/models`：返回模型 ID、来源、定义标准、标题/说明和可用状态；实际完整读取 Store 分页，不暴露一个只能看到首 100 条的列表。
- `GET /api/projects/:projectId/models/definition?model=<完整编码的 ID>`：返回对应定义与完整原始 JSON 文本、元信息；query 避免将含 `/` 的 ID 拆成路由层级。缺失为 404，不合法定义返回定位错误，非法/越界 ID 拒绝。

不提供网页写模型的 API。用户内容仅用 textContent 展示，原始 JSON 文本用于“原始定义”，不因 pretty-print 改变原文件。按 Human 试用反馈取消复制按钮及其状态占位，不另设复制入口。内置 raw 定义可生成 JSON 文本并标注来源。API 沿用现有 Project 请求隔离规则，配置写入仍经过已有 Settings 授权与 revision 机制。

### 5. 正式模型 Module

新增 `org.memsphere.models`，稳定路由 `/projects/:projectId/models?model=<id>`，一级导航“模型”，二级“全部模型”，复用公共 ContentList、Theme 和 UI。原型模块保留供设计证据访问，但不再占据与正式模块相同的“模型”主导航；原型示例不进入真实列表。

复用并整理原型的树形表格代码，不从正式模块依赖 prototype 目录。默认对象/数组树、数组元素节点、父对象 required、字段 / 结构、类型、格式、规则、说明五列（格式保留当前节点的原始 `format` 标识及 `enum` 可选值，两者均缺省为 `—`）、全部展开/收起、键盘焦点与窄屏表格内部滚动保持产品确认的行为。“全部展开 / 全部收起”使用表格右上方的轻量文本按钮，删除通用操作说明、整体定义摘要和详见原始定义等自动阅读提示；模型及字段的作者说明和可准确展示的实际规则保留。固定文案由中英文资源提供，title/description 等用户内容保持原文。模型详情不提供 Project 级设置按钮。

结构视图只展示能够准确解析的结构；显式 additionalProperties 以 `[动态字段]` 表示名称可自定义的一类字段，与固定名称字段同层，类型列展示其值类型，对象/数组值可展开内部结构，不另增加包装层。anyOf / oneOf 在没有显式本层 type 时以 `A | B` 展示候选类型，组合方式仅在规则列显示双语“至少满足一个分支 / 恰好满足一个分支”，类型列只显示候选摘要、不重复组合标记；对象优先使用 title，未命名对象使用类型1、类型2。展开后的分支行统一命名 [类型1]、[类型2]，title 作为补充名称，各自保留字段、局部 required、format 与嵌套，不合并对象。显式 type 仍保留本层限制，同时存在的组合关键字分别保留，不误合并为普通或；布尔 Schema 的允许规则显示在规则列而非类型列，true 为无限制，false 字段为不允许存在，非字段子模式为不允许任何值；必填独立展示，可选省略，无规则为 —，矛盾的必填与禁止同时呈现。说明列只保留 description，系统生成的实际限制与引用来源统一移至规则列，不生成阅读原文提示，type 为 boolean 仍是布尔类型；本地引用解析并展示目标类型、字段、格式和枚举，保留引用来源；引用字段的必填仍属于原父对象，目标内部字段按目标 required 展示。递归边界只能手动继续展开，全部展开不越过递归边界；缺失、非法、无具体结构的循环引用、跨模型引用及嵌套 $id 作用域显式提示不能解析，不伪造子字段、不访问网络。不合并 $ref 同层的校验关键字；引用节点作者 title/description 优先作为展示注解，无注解时使用目标注解，不改验证或原文。enum 按显式类型展示文本枚举、数字枚举等，候选值在格式列自动显示并保留同时存在的 format，不依赖 description，不做类型转换。在规则列展示 const 固定值以区分对象分支。allOf、条件及其他未支持关键字只保留在完整原始定义中，不生成规则列的阅读提示，不能宣称已展示全部语义。本轮不把 UI 结构转换为另一套公共 Descriptor 类型系统。模型 ID、完整 JSON 和错误原文必须仍可查阅。

通过 AbortController、请求 generation 与 Mount disposer 防止快速切换 Project/模型时旧请求覆盖新结果，并清理所有事件和订阅。刷新、筛选、未知 ID、目录空、单项错误与全局错误均真实接入 API，不保留演示状态切换器。

### 模型展示 Slot 补充（Human 已确认）

SDK 声明 `modelsPagePresentation`（key `page`、ViewMount）与 `modelDefinitionRenderer`（key `definition`、同步 ViewDataRenderer），配置 cell 清单接入同名版本化位置，Host 按 Models 路由所有者选择 page 候选。模块以 priority 1000 注册默认页与定义 renderer；结构/原文分别经过冻结 ModelDefinitionPresentationContext，默认节点按展示方式保留。内置列表自行触发模型加载，不依赖默认详情页。

`presentation.modelsPage()` 沿用现有只读服务模式，返回当前 Project 冻结摘要、选择、refresh/openModel/getDefinition；getDefinition 使用既有 API 返回冻结定义。设置增加中英文“模型模块 / 整体页面、定义正文”，沿用现有保存、重启生效与失败回退，不修改用户全局配置或数据层 API。补充真实 View 扩展包集成测试验证两层独立替换、默认包装、原文及交互保留、JSON Schema/raw、Project 隔离、卸载、失败回退及显式默认选择；同步 SDK、Slot Catalog、使用指南、System Memory 与 Skill。

### 6. 文档与 Memory

同步 README、数据层实现文档及使用说明；补齐模型目录维护方式、Project 设置路径和本轮 Runtime 边界。更新 `reserved-memory/system-memory/concepts/memsphere-framework.yaml`、`memsphere-view.yaml` 与当前开发 Project 的对应副本，检查 Skill 中 Project/View 的冗余说明。无新 Memory 身份时不改 manifest；若发现需新增身份，先在方案修订中列明。

不新增 Memory syntax 关键字；`modelsDirectory` 是 Project JSON 配置字段，不是 Memory DSL。

## 影响范围与开发任务

1. 新元模型扩展与模块测试；不更改公共数据接口。
2. 配置 schema、Project 路径与配置中心完整读写链路及测试。
3. Project 模型目录/Manager 装配、分页与失败隔离测试。
4. Project-scoped 模型 API 与 HTTP 集成测试。
5. 正式模型 Module、树形表格抽取、Settings 分组、中英文和真实浏览器验证。
6. 文档、System Memory、副本和 Skill 同步，全量验证与三方实现 Review。

可能调整的现有代码：`src/config.ts`、`src/config-management.ts`、`src/project/model.ts`、`src/project/run-data.ts`（只抽取/复用模型定义，不改变 Run 存储）、`src/data/extensions/index.ts`、`src/commands/view.ts`、`src/module/builtin-catalog.ts`、Settings Module、View 文案与 lint 门禁。新增 `src/project/models.ts`、元模型扩展、正式模型 Module 和对应测试。

## 验证方式

| 契约 | 最低适用验证 |
| --- | --- |
| 默认/相对/绝对目录及旧配置省略 | 配置与 Project 模块测试；两个独立临时 Project；Windows/Linux/macOS 路径相关既有测试 |
| 文件布局与内容不变 | filesystem Store 模块测试：`sales/order.json` 读写原文，无封套/索引；已有文件直接可读 |
| 超过一页、坏项隔离、存储故障 | 101+ 模型分页；坏 JSON、非法 Schema、有效但 Runtime 不支持的 Schema；权限/越界/不存在路径 |
| 模型读取与元模型启动 | Manager 真实 Serializer+Factory 装配，获取订单 Runtime 并读写订单字段；缺依赖与重复 Factory 失败 |
| Project 隔离与保存重载 | Settings 和模型真实 HTTP 服务；A/B Project、保存 CAS 冲突、目录切换、原目录保留、服务不重启即可刷新 |
| 模型阅读交互 | playwright-cli 在真实 ViewHost 操作：树形展开、数组元素、required、筛选、URL 重开、原文完整且无复制按钮/占位、raw、坏项、空/错误/重试、快速切换 |
| 配置交互 | playwright-cli：设置分组、目录基准与解析路径、保存确认、校验、放弃、重载、两 Scope 草稿隔离 |
| 公共壳与双语 | 实际桌面/390px 窄屏，键盘和焦点、表格内部滚动、主题 Token、真实 Home 语言切换；卸载后无遗留监听或 console error |

先运行受影响测试：新增模型/元模型测试、`data-manager`/JSON Schema/Serializer/filesystem 测试、`config-management`/Project/Settings/View/Module/locale/Reserved Store 对应套件；按实际文件名整理开发计划。再执行 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。所有 Memory 最终内容还执行 `memsphere memory change validate`，记录 ChangeSet ID、状态和 View 入口。真实跨操作系统执行结果与仅依靠可移植 API/现有测试的覆盖分别记录，不能宣称本机执行了 Windows/macOS。

浏览器验证使用独立临时 Home/Project，不修改用户的真实 Home 语言、模型目录或配置来完成测试。复用现有构建出的 View 服务/资源，不以静态页面替代框架集成。

## 风险与处置

- 元模型有多形态关键字，不能照搬 Draft-07 自描述 schema 到单类型反射编译器；最小启动 Runtime 只承诺上述确定元信息，完整 JSON 仍保留。若三方技术评审认为必须扩大公共类型系统，先暂停并与产品负责人讨论，不自行修改 API。
- filesystem 基础 list 仍扫描目录；本轮不为性能引入索引或另一个存储协议。列表随刷新完整遍历，复杂查询属于后续范围。
- 保存配置与直接改文件不提供跨请求一致性或版本历史。一次读取失败可刷新重试，不静默修复、不新增中间状态文件。
- Schema 有效性、可读结构和可创建业务 Runtime 是不同检查结果，界面与文档不得混称。高级定义仍保留原始内容与显式边界。

## 待决问题

无待决的产品问题。以上实现选择提交研发、架构、测试 Agent 评审；如评审引起产品范围、可见行为或交互变化，按契约先与 Human 对齐。本方案尚未实施，不把设计内容作为验证结果。

## 向前兼容

结论：不需要向前兼容。

遵循已确认契约及 `statements/memsphere-repository-requirement-rules`：本轮没有旧模型存储格式需要兼容，不增加历史迁移、旧模型格式读取或回退分支；不将无 stable Tag 的任意旧提交声明为稳定 checkpoint。已有 Project 未配置可选 `modelsDirectory` 时采用默认值，Memory、Run、Review 与 Settings 原有行为仍必须回归验证，这不等于增加历史格式兼容责任。不迁移 Run 状态或其他已存在内容。

## 采用规范

已完整读取并采用 `statements/memsphere-repository-requirement-rules`、`statements/memsphere-repository-development-rules`、`statements/memsphere-repository-testing-rules`：兼容性结论及 checkpoint 范围按上节执行；避免过度设计，用户可见能力同步 System Memory/Skill，按真实边界分层测试，测试等待真实状态，不降级/跳过既有断言，实际 View 浏览器操作与完整回归、Memory 双重校验。并读取 `concepts/memsphere-framework`、`concepts/memsphere-view` 与本 Run 的敏捷 Procedure，应用 Project/Workspace 边界、公共 View SDK 与角色评审规则。

技术 Review 第 1 轮中，架构与测试通过，研发要求补充上述需求 Statement 的实际读取及采用说明。Runner 已读取规范并补齐本节和向前兼容章节；此说明不改变实施方案或验收范围，冻结 Submission 保留，修正通过正式意见处置记录关联。
