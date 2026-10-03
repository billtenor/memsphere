# 模型登记实施与验证方案

## 依据与当前代码

已确认契约为 requirements.md 第 6 轮，Run run-20261002-113512z-65600623。Human 与产品 Agent 均通过，Runner 已接纳。本方案交研发、架构、测试 Agent 评审，通过后才开始正式实现。

src/project/models.ts 当前以 modelsDirectory 装配 filesystem DataStore，发现 .json 定义，使用 DefaultDataManager/JSON Schema Runtime 解析，并拼接 src/project/run-data.ts 的四个 raw 内置模型。该层暂无管理 ValueStore，也没有包/标签信息。src/commands/view.ts 的 GET /api/models 和 /api/models/definition 使用这个 host。

src/data/extensions/filesystem-json-valuestore/index.ts 已提供 memsphere/filesystem-json ValueStore，配置只有 directory，记录为独立 JSON envelope、filename stem ID；不允许斜杠 ID，不负责跨记录或跨进程事务。现有 withFileLock/atomicWriteJson 可复用作 Project 管理操作串行化。

src/project/model.ts 是严格 Zod Project config；src/config-management.ts 统一读取、校验、revision conflict 和保存。modules/org.memsphere.settings/adapter/view/settings-view.ts 的 models 页面目前只编辑 modelsDirectory。正式模型 Module 已使用 SDK Slot/Route/UI/Theme、contentList、definition renderer，有加载取消及页面卸载处理，但仍是全部模型入口、标准徽标和两种结构/原文视图。

## 管理模型与装配

新增 src/project/model-registration.ts，以代码常量定义 canonical memsphere/model-registration 及八字段 schema，与 examples/models/model-registration.json 语义一致。注册内置 ModelBinding，再创建 ValueStore，无登记数据也可取得 Runtime。模型层保留 store_id+modelRef 的定义读取；storage 与 store_id 的条件由明确的业务 validator 执行，结构/枚举仍由 Runtime 检查。package_name 仅在 package 存在时使用，同包显示名不一致报数据诊断，不凭空翻译包 ID。

filesystem ValueStore 记录 ID 使用管理层稳定的 UUID filename stem，modelRef 保存在 value；先扫描记录建立 modelRef 唯一索引，不能把斜杠 identity 直接当文件名，也不更改通用 ValueStore ID 约束。不新增包实体、domain 或来源字段。

扩展 Project config，加入 modelRegistration 配置：storeId（默认 memsphere/model-registrations），stores（ID→factory/directory 配置，factory 本轮限 memsphere/filesystem-json），以及保留旧目录的内部 excludedDirectories 集合。前端展示存储 ID、受支持的类型、可编辑目录、固定只读登记模型。project/imported 两个 ValueStore 区域使用同一管理 schema，根目录下分别装配；系统登记由代码提供。所有区域共同检查 identity 唯一性。普通 GET 不迁移不写入；尚未初始化时可从发现的定义构造只读回退摘要，并显式提示初始化，不假装已落库。

## 模型 DataStore 与登记 ValueStore 的明确分离

项目原有模型 Store 保持 stable ID models/json-schema/draft-07，kind=DataStore、model=json-schema/draft-07、factory=memsphere/filesystem、Config({directory: resolve(Project.root, modelsDirectory ?? 默认目录)})。管理初始化为这些模型填写 storage=store、store_id=models/json-schema/draft-07；配置中 modelRegistration.stores 只配置管理 ValueStore，绝不用于解析定义的 store_id。

导入模型 Store 使用 stable ID models/imported/json-schema/draft-07，同样 kind=DataStore、model=json-schema/draft-07、factory=memsphere/filesystem；directory=所选登记 filesystem 根/imported-definitions。该目录关系由 Project 装配规定，ID 不随选中登记 Store/目录改变。imported 记录填写此 store_id；项目和 imported 定义目录禁止相互覆盖；builtin 无 store_id。通用注册记录不增加新定位字段。

host 明确建立两种 DataStore 绑定及 Store ID→实例表，按登记的 store_id 选择唯一支持的定义 Store，再用 modelRef 做 DataStore.get。未知 Store ID、错误 kind 或登记 storage 与解析来源不符报诊断，不能回退到登记 ValueStore。snapshot 读取 stored.data.payload 的 readAll 原始 bytes，source 使用 UTF-8 fatal/ignoreBOM 解码保留 BOM/空白/换行，给 Manager 的 loadData 返回同一冻结 bytes；Runtime descriptor ID 始终是原 modelRef。初始化与预览迁移不重新序列化现有定义；发行导入以 inline source UTF-8 bytes 写 DataStore，而非 JSON.stringify parse 后定义；迁移登记根时连同 imported-definitions 原始文件逐字节复制校验，目标 config 发布前所有记录+定义完整，store_id 不变化。

补充模块/HTTP 测试：项目记录读取命中原 DataStore且 bytes 完全相等；市场记录命中 imported DataStore、不误用同名 ValueStore；未知 store_id 和伪造跨区域绑定拒绝；导入与登记目录迁移均保留 BOM/空白与 descriptor ID；同 modelRef 跨两种定义 Store冲突拒绝，失败不改已有原文。fixture 直接造 Store/配置，测试以 API source及Runtime结果验证，不验证内部方法调用次数。

## 目录隔离和模型读取

新增 src/project/model-storage-paths.ts，统一处理目录规范路径、祖先关系及 realpath 的已有祖先，拒绝扫描根等于/位于登记根、登记根包含扫描根、登记根和备份根重叠。扫描根是其祖先时允许但剪枝。默认登记根 models/registrations，内部备份根 backups/model-registration；配置修改、初始化、切换及迁移都调用同一规则。

模型发现通过带排除集合的专用遍历取得文件 ID，读取前也检查目标路径不位于内部根。排除信息来自 Project config 与固定备份根，在登记装配之前即可取得。现有通用 filesystem DataStore 默认行为不改；模型 host 使用排除遍历而不遍历内部 envelope。已有枚举不跟随 symlink；对扫描根及排除根的别名统一规范化，单 ID 获取沿用 DataStore 的严格 symlink/路径校验并额外检查排除。保留目录仍排除，不能通过旧 Store 或 source API 读取内部数据。

createProjectModelHost 增加内部配置/登记摘要装配支持，ModelPresentationSummary/Definition 新增 optional registration 和 origin（响应上下文，不属于 value）。所有新字段都是 JSON 可传递只读数据。模型定义保持 DataStore，不将管理属性混入结构 schema；内置系统模型也不靠 package 名判断 builtin。模型存储名称统一，标准来自 Data.model。

## 显式初始化与预览迁移

增加 memsphere project models initialize（针对明确 Project）及受正式设置权限保护的初始化 API；输出新建/保留/诊断和备份路径。复用 Project 文件锁序列化本管理操作，但不声称提供通用 Store 分布式事务。

预检所有定义和已有登记，保留已存在 name/package/package_name/tags、定义原文字节及 IDs。使用已确认的 13 条草案作为本任务实际开发 Project 的种子映射；其他 Project 的未知模型回退 title/description，不套用订单包归属。逐条写入可重复操作，遇到损坏记录明确诊断，不覆盖它；不同进程初始化通过 Project 锁互斥。读取隔离单条 JSON/结构错误，I/O 权限和存储失败显式失败。

特殊迁移仅匹配已知管理模型旧 identity 与已确认预览 schema，先备份 bytes 和 oldRef→newRef 回执，预检引用并替换受支持的明确引用。不能处理的引用阻止迁移，不盲目全文件字符串替换。校验后退出扫描位置并使用内置 canonical ID；旧详情 URL 重定向/规范化，新列表单项展示。开发 Project 迁移后清单为 8 原示例+4 raw 内置+1登记内置，13 项；真实迁移在实现验证后执行，不能在方案评审前删除旧文件。

## 设置保存与目录迁移

更新 Project schema、EditableProjectConfigDraft、normalization、resolved paths、校验/保存接口及正式 settings models 页。先选择有效 ID，展示所选配置，切换不串用目录，取消不写入，错误定位到字段。保存走现有设置令牌、revision 检查及 Project 锁，不能绕过权限。首次显式初始化保存默认配置。配置中不存在所选 ID、无效目录或冲突不保存。

有登记数据且变更所选 ID/目录时，设置提交先显示现有 diff 确认，同时明确需要迁移；保存 API 必须提供显式 migrate 授权才执行，不能把普通参数编辑当迁移授权。预检目标全体记录、冲突及目录隔离，复制两个区域并逐条校验，成功才以 expected revision 切换 config；旧数据保留且旧目录记录在排除集合。失败不切配置、保留原数据、报告目标候选及清理异常；目标已有同 identity 不同内容整次拒绝。配置发布之前目标内容不进入正常 Catalog。目录迁移不替用户清理旧数据。

## 最小本地市场

新增随代码构建发布的 src/project/model-market.ts 与 src/project/model-market-assets.ts 内联资产，至少一个 memsphere.examples.orders 包，模型 memsphere/examples/order.json，定义使用当前订单深层嵌套示例（保留 schema 内容），包名来自该模型 package_name。model-market-assets.ts 导出订单 source 字符串及包登记常量（定义字符串来自已确认示例原字节，构建时不读取仓库 examples）。tsc 编译生成 dist/project/model-market-assets.js，model-market.ts 相对导入它，因此 npm files 白名单里的 dist 即包含完整资产；不新增需要额外复制的 JSON 资产，不依赖源码目录。市场响应包/模型/预览，不包含原型 acme 虚构内容。

导入到独立的模型 DataStore：定义根位于登记根的 imported-definitions 内（因此不作为项目定义重新发现），登记 storage=store、store_id 指向该导入模型 Store。host 从已发布 imported 区域登记装配这些绑定，origin=market；未导入市场资产不装配入项目。

导入在 Project 锁下预检全部 IDs/bytes/登记。完全相同显示“已导入 · 无变更”；同包用户修改或跨区域 identity 冲突拒绝整包并返回 IDs，不覆盖、不重命名。临时候选写入内部 staging，校验后发布；以内部 publish 状态保证消费者仅读取全部完成的导入（发布状态是内部操作元数据，不是包登记模型）。写入失败回滚新建项，回滚失败保留不可见候选并给出待清理 IDs，重试只可明确恢复/清理候选。服务端测试通过注入失败保护这一路径，不以 toast 代替实际导入结果。市场 POST 复用正式写权限与 body limits，读取 GET 不授权写入。

## 正式 View

modules/org.memsphere.models 使用正式 Shell 的二级 Slot 和三级 contentList。Route query 添加 scope/tag/model/q；默认未定义包，项目包和外部包按 origin 分组。公开 SecondaryNavigationItemDescriptor 增加可选 group label（前向兼容既有 contributor），官方 shell 统一渲染小字分组；导航 contribution 随数据刷新/路由更新，卸载撤销，不做 Module 私有 Shell。标签筛选在 list mount 内增加受 Theme 样式管理的可访问 select，不扩展整个通用 UI 表单协议。

搜索沿用 contentList 的输入交互，搜索字段为管理名称（含 title/ID 回退）、modelRef、管理说明及 tags，大小写无关的子串匹配。先限制 scope，再对 tag 精确过滤，再应用搜索，三者为 AND；纯空白搜索等同无搜索。搜索文本写入 q，刷新/浏览器前进后退按 URL 恢复；切换包清空 tag/q，改变搜索不改包，选中模型被过滤时规范化到首项，无结果保留条件显示 empty。输入更新保留焦点/selection，刷新数据保留范围、标签和搜索，仅移除已失效标签。不把搜索实施成额外服务端数据库查询，HTTP 列表必须提供可搜索的登记值。增加独立可复用的列表筛选辅助模块，模块测试组合规则与回退名称；HTTP 测试验证可搜索响应字段及错误；浏览器验证输入、组合、URL刷新、清空、空结果及焦点。四行列表为名称、ID、可选说明、仅 tags，最多两项+N，tooltip/aria 提供剩余；无标签省略，无标准徽标。scope/tag/model 稳定 URL；选择超出范围时规范化到当前首项，无匹配显示 empty，未知 scope 回默认；完整 ID 可查看。模型信息默认第一 Tab，八行顺序名称、说明、所属包、模型 ID、定义标准、标签、存储方式、存储 ID；表格沿用 Theme tokens，无 JSON/下载。定义结构与原文仍通过现有 portable renderer，不能破坏第三方定义 renderer 的 view 契约。市场页面用真实包 API、预览和导入反馈，成功刷新包导航。所有 DOM 内容 textContent/既有 escape，避免将登记值注入 HTML。

扩展 src/view/view-sdk.ts 响应类型，并更新 src/view/view-runtime.ts 中 alternative page presentation 的读取/打开上下文，使正式/替换 renderer 接收一致注册信息及 route。中英文固定文案、窄屏、键盘焦点、loading/error/empty、请求取消和 generation guard 继续维护。

## 文档与 Memory

采用 statements/memsphere-repository-requirement-rules：已确认契约独立的“结论：不需要向前兼容”，以名称含 stable 的 Git tag 为唯一历史 checkpoint；本轮实际 git tag --list '*stable*' 无返回，故无 stable checkpoint 兼容责任。数据保护仍按已确认契约执行，原定义字节、ModelRef/既有管理属性保留，旧预览仅显式备份和身份迁移，不用无兼容责任豁免这些验收。采用 statements/memsphere-repository-development-rules：控制复杂度、用户可见行为同迭代同步 System Memory；statements/memsphere-repository-testing-rules：受影响/全量回归、真实边界与稳定等待；statements/memsphere-repository-delivery-rules：最终校验、Human 验收与归档；已读 concepts/memsphere-framework 及 CONTRIBUTING.md。未发现专门 model-registration 的设计 Statement，记录为无；本轮不新增 YAML syntax 关键字。

更新 reserved-memory/concepts/memsphere-framework 的 Project/模型描述及 src/skills/memsphere/SKILL.md 的冗余说明，README/README.en 的初始化和设置说明。Managed 开发 Project 通过受控 ChangeSet 同步副本，不直接改正式 Memory；reserved manifest 中已有 framework identity 不新增包模型。最终记录 ChangeSet ID、校验及 View 入口。使用 Run 冻结的评审上下文，不把后来 Memory 修改影响归因给旧快照。

## 开发顺序和验证

1. 路径隔离、内置 schema、管理 service、config schema/初始化/迁移及市场模块；优先模块测试。
2. 正式 HTTP 和 CLI 接入，settings 保存/迁移 API；真实临时 Project 与权限/revision/失败路径集成测试。
3. SDK 分组、模型 Module、settings UI 与 locale/Memory 文档同步；正式 Shell 浏览器测试。
4. 受影响套件通过后全量回归及人工实际交互，交付总结、产品验收、归档/commit；不提前询问 PR。

测试文件新增 model-registration、model-storage-paths、model-market 模块测试；更新 project-models（内置从4增5且保留原字节/Runtime契约）、config-management、view-models、view-settings、models-builtin-view-browser、models-view-slots-browser、view-settings-browser；reserved-store 在 Memory 改动后必须运行。每个测试独立保护可观察产品契约，不以实现镜像测试、删除/跳过旧断言或固定 sleep 取巧。

关键覆盖：空登记启动；斜杠 identity；枚举和条件非法；两区域 identity 冲突；损坏单条隔离/I/O失败；重复初始化；管理属性保留；13项迁移/备份/旧 URL；默认/自定义/Project 根扫描与单 ID 排除；冲突路径及 symlink；Store选择、目录编辑、取消、无效输入、权限和 revision conflict；迁移失败保持原选择；市场真正导入、重复无变更、用户修改拒绝、部分失败候选不可见。

正式 Shell 的浏览器集成覆盖包导航/URL刷新、搜索与 scope/tag 组合、q 刷新恢复/清空/空结果/焦点保持、tags二项溢出/无标签/空说明、模型信息字段顺序、结构折叠与原文、市场安装、settings ID/配置切换和数据迁移、loading/error/empty、中文/英文、窄屏/键盘、卸载取消；受影响交互另用 playwright-cli 实际操作，不以静态原型截图替代。

新增 test/model-market-package.test.ts：clean npm run build 后确认 dist/project/model-market-assets.js 及其引用存在；执行 npm pack --ignore-scripts --pack-destination <临时目录>，解压 tarball 并断言包含编译资产。临时 clean 包目录只为离线测试链接现有依赖，从解压后的 dist/commands/view.js 启动真实临时 Project HTTP 服务，调用市场 GET 预览及授权 POST 导入，再用模型 API 读 source/登记，确认不依赖 Workspace examples/src；关闭服务和清理临时目录。此为跨打包/HTTP集成测试，不在 test 内递归调用 npm test。最终验证报告记录 clean build、npm pack、包内容及 packed API 预览/导入实际命令与结果。

实际执行并记录 npm run typecheck、受影响测试、npm test 全量、npm run build、memsphere --project memsphere validate 及 memsphere memory change validate [change-id]，任何失败不得宣称交付。当前 worktree 无 node_modules，优先使用现有本机安装依赖的离线配置完成构建，避免无关依赖升级；构建命令和测试仍针对本 worktree 代码。所有截图、清单和日志归入需求目录。向前兼容无需额外历史版本支持，但本契约明确的资产保护不能省略。

## 风险和评审关注

实际原型是 fixture，正式 API/ValueStore 接入均未完成。目录隔离、写权限、显式迁移和失败可见性是本轮主要风险，不能用“以后再做”缩小已通过范围。方案不扩展通用 ValueStore 的分布式事务承诺，也不新增包生命周期系统；并发统一 Project 管理锁与候选发布状态满足本应用边界。发现方案外产品取舍时先修订契约，发现技术缺口时修订本方案再评审。
