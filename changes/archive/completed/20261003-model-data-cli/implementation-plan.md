# 模型与数据 CLI：实施与验证方案

日期：2026-10-05（Asia/Shanghai）。Run：`run-20261003-090655z-f1e492f6`。当前步骤：flow[2]，第二轮方案评审稿。

依据：已通过的第八轮需求 Submission `submission-20261004-155759z-1145fcad`，SHA-256 `d7293a0552a4c7fb4016402e72cbb42d04089a0b7088f4768778b48704762724`；代码基线 `2b7400b0d3bff6670982ebcd0a02f023a6859e34`。本方案尚未实施，文中新增文件、接口和行为均是施工安排，不是现状声明。

## 目标与范围

按已确认命令提供模型 CRUD、业务 Store 管理及数据 CRUD/校验/导出；全部六个 list 命令分页；read 使用 `--path <path>` 的 JSONPath 查询，局部修改使用 data edit。系统模型通用只读，模型及元模型 ID 全部以 `.json` 结尾，全部实际定义禁止跨模型引用。

Runtime 的 Schema、类型描述、字段访问和编解码支持范围保持现状。不支持的定义明确拒绝，不改写约束使其勉强可用。实际 Run 的四个 raw 模型与九个含未支持写法的 run-domain Schema 分开处理。没有模型草稿、模型整体 revision、跨模型依赖图、通用迁移命令或新 Web CRUD 界面。

## 采用的规范与当前代码

已读取 memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-requirement-rules、memsphere-memory-access-rules、memsphere-repository-delivery-rules，以及 CONTRIBUTING.md、changes/README.md；领域语义采用 memsphere-framework。普通 Run 没有 ChangeSet Memory 快照，本 Run 的 Procedure 约束以自身冻结内容为准，其余 Memory 按当前 Project 读取。

| 当前事实 | 代码依据 | 本轮处理 |
| --- | --- | --- |
| 模型宿主已有 list/definition/runtime，写定义与登记缺少共同服务 | src/project/models.ts、model-registration.ts、model-market.ts | 增加 Project 模型服务，全部入口复用检查与提交 |
| 系统模型 ID 不带后缀，文件适配器补后缀；Run Store ID 从模型 ID 拼接 | src/project/system-model-store.ts、system-models.ts、run-data.ts；reserved-models/manifest.json | 身份和物理位置分开，显式修正现有 Project |
| 初始化能在普通异常时回滚，但恢复清单只在内存中 | src/project/model-registration.ts 的 initializeProjectModelRegistrations | 持久保存本次操作的修改前内容和阶段，支持进程中断后恢复 |
| JSON ValueStore 记录为 id/revision/时间/value；互斥只在一个 JS realm | src/data/extensions/filesystem-json-valuestore/index.ts；shared/filesystem.ts 的 withRecordLock | 在 Store 内实现跨进程保护，保留记录 JSON 格式，阻止删除重建复用版本 |
| withFileLock 使用 wx、PID 和按时间清理失效文件 | src/persistence.ts | 本轮协调入口改用操作系统文件锁，避免多个清理者误删新持有者的锁 |
| Factory 创建目录，Memory 输出仍有 memories/nodes/next_cursor | 两个 filesystem Factory；src/memory/serializer.ts | 增加纯读取装配路径；统一公开分页字段并更新调用方 |

## 一、模块与调用关系

CLI 注册保留在 src/cli.ts，新增 src/commands/model.ts、data.ts、data-store.ts。它们解析参数、读取输入和输出回执，业务判断由 Project 服务负责。

- 新增 src/commands/structured-output.ts 和 input.ts：统一参数解析失败及运行错误、stdin、JSON 值与字节输入。名称为实现模块名，不作为产品概念。
- 新增 src/project/model-service.ts：模型查询、验证、修改计划与提交。复用 models.ts 的发现和来源信息，不再由各入口单独判断系统权限。
- 新增 src/project/business-stores.ts 与 data-service.ts：配置、目录检查、只读装配、数据操作及能力判断。现有 DataManager 仍负责模型与 Store 装配，不承担 CLI 参数语义。
- 新增 src/project/model-operation.ts：只负责本轮模型文件、登记、相关配置的一致修改和恢复，不建立通用事务框架。
- 新增 src/pagination.ts、src/data/operations/json-path.ts、json-patch.ts：分别实现分页公共部分、查询适配和整组修改。

现有 View 的模型读取/市场导入、Project create/initialize、维护恢复统一接入相同服务。通用 data 服务只允许业务 Store，不开放模型、登记、Run 或 Archive 内部存储。必要的跨层共享检查提取为纯函数，避免 CLI 和 View 出现两套规则。

## 二、模型检查、读取和修改

### 检查链与错误

统一检查顺序为模型身份及权限 → 解析和元模型校验 → Schema 本地引用 → 对应 Runtime 构建。格式非法、跨模型引用、Runtime 不支持和文件读取失败分别返回稳定错误码及位置。普通 JSON Schema 使用现有 Draft-07 Runtime；元模型自身和 raw 模型采用各自 Runtime，不能全部送进普通 Schema Compiler。

保留现有 Ajv 根校验与反射校验，不补联合、条件、format 等支持。定义合法但 Runtime 不支持时，list 标 unavailable，正常 read、保存、导入、安装、绑定和使用拒绝。validate 的 definition 档只执行定义与引用检查，并明确 Runtime 未检查；runtime 档完整执行。check-data 遍历实际业务绑定，可按多个 Store 限定，说明检查数量与失败记录，不伪造跨记录快照。

src/reserved/models.ts 的资源目录加载只负责资源结构与定义格式；不能因为市场 04/05 不支持 Runtime 而连带阻断系统资源加载。实际安装、导入或使用前才执行完整 Runtime 检查。八例整包包含不支持定义时，在任何目录或记录写入前拒绝。

### 写入服务

create/update/delete 使用同一服务。create 检查所有来源的身份冲突；update 固定 modelRef、来源、定义 Store 与登记 UUID，只合并允许的管理字段，检查 set/unset 冲突及同包展示名称一致性。定义 source 保留输入字节，不顺手重新排版。系统来源由持久目录和宿主解析，不接受调用方伪造 origin。

定义内容变化或删除时，在 Project 写锁内再次检查直接业务 Store 绑定；包括空 Store，有绑定即 MODEL_IN_USE。只改登记仍完整检查最终模型。删除同时移除定义、登记及市场 publication 中对应 UUID，防止模型再次被扫描发现；不影响同包其他条目。create/update 失败不留可见半成品，delete 失败不报成功。

只读和 dry-run 采用同一纯预检，结果只保存于内存；不创建锁文件、操作记录或目录。真正提交重新检查，dry-run 结果不承诺未来仍可成功。

### 跨模型引用与资源清理

src/project/model-schema-references.ts 只遍历 Schema 位置，接受 `""`、`#`、`#/…`，验证目标有效；examples/default 中的普通 `$ref` 数据不误报。JSON Schema Compiler 的 resolve 同时拒绝外部引用，删除 Project 为解析引用预加载其他模型的逻辑。

市场 06 的 externalStatus 改成本地 string 枚举 pending/paid/cancelled；同步 manifest 说明、prototypes/model-registration/models.json 中定义和 source 两份副本、仓库示例及当前开发 Project 的实际导入副本。04/05 和九个 run-domain 定义保留原约束，作为预期不支持结果检查。

example-relocation.ts 在恢复历史内容前完整预检，移除“必须恢复 06→07 引用”的成功条件；历史基线仍作为历史证据，不改旧字节伪造一致。恢复不满足当前规则的历史资产明确失败；撤回本次未提交操作的文件修改不等同于重新发布历史模型。standards-audit.md 形成逐项结果：已修正、支持通过或明确拒绝，每项附验证，不留下有效空间中的跨模型引用。

## 三、模型 ID、锁和恢复

### 身份与位置

修改 manifest、JSON_SCHEMA_DRAFT_07、raw 元模型常量、登记模型和四个 Run 模型常量、Runtime Factory target、宿主的 Data.model/Store.model。内置旧新对应关系为现有 ID 各补一次 `.json`；已合规身份不改。不做全文字符串替换，不更改 JSON Schema 的官方 URI、普通记录 ID、Store/Factory/Extension/Serializer ID。

system-model-store.ts 删除系统专用补/去后缀逻辑。system-models.ts 使用固定元模型到物理目录的对应表：新元模型 ID 仍指向现有 definitions/json-schema/draft-07 和 definitions/raw。run-data.ts 引入独立的 Store ID 表，保持四种内容的 current/archive 共八个 Store 地址；不再以新的模型 ID 拼出 Store ID。原文件 DataStore 的 Data.model 由新绑定提供，不改原 Payload。

initialize 使用私有物理清单读取器，直接盘点登记 envelope、定义和配置，先生成完整身份对应关系；不能先调用严格化后的 host.list，否则旧 ID 与不支持的普通 Schema 会阻塞修正。该读取器仅用于显式修正，不提供旧 ID 的正常访问别名。删除当前 LEGACY_MODEL_REGISTRATION_MODEL 迁移路径，尤其不能再删除目标 memsphere/model-registration.json。

普通 Schema 的身份与元模型绑定修正不扩大 Runtime 支持、不赋予可用资格。新装或改变的系统模型必须完整校验。目标冲突、登记损坏或必要绑定无法对应时写前失败；不自动合并两个模型。

### 跨进程锁

拟锁定依赖 fs-native-extensions 1.5.1，通过薄封装使用 tryLock/unlock：Linux 使用 OFD 锁，Windows 使用 LockFileEx，macOS 使用整文件锁。官方提供对应平台实现和 CI；本机临时试验已验证 Linux，不将其等同于三平台通过。[官方 API](https://github.com/holepunchto/fs-native-extensions)、[平台实现与 CI](https://github.com/holepunchto/fs-native-extensions/blob/main/.github/workflows/integrate.yml)。

锁住独立、持久的协调文件，不能锁住随后要被 rename 替换的业务文件。锁文件创建后不删除、不替换；文件存在不表示被占用，是否持锁由内核判断。进程退出释放锁；tryLock 轮询使用超时和 AbortSignal，不永久阻塞 Node 工作线程。模块加载或底层锁不支持时写前报能力错误，不退化成不安全的普通写入。

Project 配置、模型服务、市场导入/恢复、初始化及业务 Store 变更统一使用同一个规范 Project settings 锁。覆盖 src/config-management.ts、src/project/model-registration.ts、src/commands/project.ts 和 View 调用方；内部函数传递已经持锁的上下文，避免再次获取同一把非重入锁。保留现有与本轮无关的 Run 自身锁；不声称旧程序进程会自动采用新协议，切换到本轮实现前停止旧版写入进程。

数据记录的跨进程文件锁仅在 filesystem JSON ValueStore 内实现，使用真实物理根和记录文件名确定独立记录锁，放在内部元数据目录。该实现的所有 create/update/delete 都在 Store 层获取锁，CLI/View/直接 Factory 调用相同实现。ValueStore 接口不强制其他实现采用文件锁；其他 Store 按自身存储机制保证写入，不具备条件写能力时按既定规则拒绝需要该能力的操作。filesystem DataStore 本轮不新增这套记录文件锁，保留现有写入机制。

Project settings 锁另用于配置和模型多文件修改，不属于业务数据记录锁，也不要求所有 Store 使用。Project 服务需要两把锁时固定 Project settings → filesystem JSON ValueStore 记录锁；预读与输入解析尽量在锁外，进入提交区再次核对配置、绑定及实际记录。

### 模型操作记录与只读一致性

在 Project 的 .runtime 下保存本次操作记录：唯一 operationId、操作类型、允许修改的路径、修改前/后字节及摘要、原本不存在的文件、创建目录、阶段。备份及候选内容先完整写入，再原子发布 pending 状态；pending 可见前不得修改目标。路径规范化且受计划白名单限制，恢复时不跟随后来替换的软链接。

逐文件写入前比较当前内容与计划的修改前内容；使用现有临时文件和原子替换方法发布。全部校验通过后原子记录 committed；该记录是操作成功的判断点。committed 后清理失败只返回残留诊断，不能假称业务未提交或回滚成功结果。

list/read/validate 和 dry-run 不获取会创建文件的写锁，也不自动恢复。读取操作标识与阶段，加载所需完整字节快照，再读取一次标识；pending/recovering 返回明确未完成提示，附操作类型与记录位置，建议等待正在进行的操作，或在中断后重试原写命令，不统一要求执行 initialize。前后标识变化则丢弃结果并有限重试，仍变化则报冲突。最后一次操作的标识始终保留，不能清空成“无记录”导致读前读后看似相同。长驻宿主缓存随标识变化失效，Runtime 只能从已经确认一致的定义快照构建。

未提交操作失败或进程中断后，由共同模型写入服务负责恢复。下一次实际模型写操作（create/update/delete、安装、导入、历史资产恢复或 initialize）先取得 Project settings 锁，检查操作记录并恢复修改前状态，再重新加载配置、模型宿主、登记与绑定，校验当前请求并生成新计划。基础参数与输入语法在锁外检查；依赖模型或配置的预检不能先被 pending 状态挡住，必须排在恢复后。持锁期间不误判另一正常进程为中断；恢复冲突时不执行当前请求。

恢复时当前文件等于 before 则跳过，等于 after 才恢复，二者都不等就保留现场并报告文件及恢复记录位置，绝不覆盖后来修改。操作记录先于每次目标修改保存，因此恢复再次中断仍能重试；恢复完成保留完成标识，再生成新计划。已 committed 仅清理残留，不自动重放已提交业务操作；重试后的身份冲突或记录结果按实际状态返回。

initialize 是共同写入服务的一个调用方，仍只负责系统模型初始化与身份修正；普通 CRUD 中断后重试原命令即可进入恢复，不附带初始化或身份修正。恢复上次操作也不会自动再次执行那项旧请求。整包导入的 publication 索引纳入同一次操作，不能维护两套成功判据。其他会修改相同配置的入口在持锁后检查 pending/recovering 并拒绝覆盖，避免绕过恢复服务。本轮不承诺整个 Project 的任意业务数据事务或断电硬件故障自动恢复；必须验证进程强制终止及普通 I/O 失败，不用异常 catch 测试代替进程中断。

## 四、业务 Store 与数据操作

### 配置与只读打开

Project config 增加独立 dataStores 字段，键为 Store ID，值为 `{model, kind, factory, config}`；kind 使用 data/value，对应 API 的 DataStore/ValueStore。src/project/model.ts、src/config.ts、src/config-management.ts 同步解析与保存，防止现有 View 设置保存时丢弃该字段。现有 modelRegistration 和 Run 存储不搬入此配置。

两个 Factory 的配置按需求严格校验；目录相对 Registry Project 根解析，config-file 相对 cwd。复用 model-storage-paths.ts 的路径归一化，覆盖不存在路径的已存在祖先；检查物理根相互重叠、路径别名，以及模型、登记、备份、Memory、Run、Archive、.runtime 系统区域。所有已登记配置也执行同一检查。

list/read Store 只读取配置与可用性信息，不创建 Store 目录。两个文件 Factory 增加共享的 openExisting 内部路径：只验证并打开已存在的根，不调用 mkdir；写入装配才允许创建。不能只在 CLI 中先 exists 再调用自动创建 Factory，因为目录在两次调用之间可能消失。只读模型定义适配器也改用该路径。

Store create 先验证全部输入和非空目录的完整文件协议、模型兼容性；在 Project 锁内重新预检后才创建必要目录并登记。失败只移除本次创建且仍为空的目录；无法安全清理时报残留位置。remove 只解除配置绑定，保留数据、记录锁文件和版本状态，重新登记不重置版本。目录已有非本实现的未知内部元信息时明确拒绝，不能当作自己的锁或恢复文件删除。

### 读取、写入与导出

ValueStore 直接返回 value 及真实元信息；DataStore 默认通过兼容 Serializer 解码并调用 Runtime 校验。无法解码时提示 metadata-only 或 export；不把二进制强转文本，不伪造 revision/主体。候选 validate 不需要 Store，现有记录 validate 使用显式 Store，二者组合互斥。

结构化写入完整验证后序列化；Payload 输入只按 DataStore 的绑定、ID 与 MIME 规则保存字节，不承诺它已通过结构化值校验。ValueStore 的公开文件格式仍为 id/revision/时间/value，不加模型整体版本。

data update/delete 有 expected-revision 才保护客户端版本；省略为无条件操作，但仍在记录锁内检查存在性并提交。edit 读取真实 revision、在独立副本应用整组修改，再校验完整最终值，最后用读到的 revision 一次条件 update；显式版本另行检查。冲突不自动重试，错误不产生部分修改。

为避免删除后重建复用旧 revision，在 Store 内部目录保存每个被删除记录的最高 revision。锁内先持久化该值，再删除记录；首次创建仍从 1 开始，重建使用已保存最高值加 1，更新沿用当前值加 1。删除在中途失败时，记录仍在则其可见 revision 不变；内部最高值只保守阻止复用。损坏或溢出报错，不静默清零。该目录不出现在 list、也不是业务记录；外部手工删除目录不属于应用写入保证。

export 文件目标先完成兼容性检查，在目标目录写临时文件，再排他发布，目标存在拒绝覆盖；失败清理自身临时文件。stdout 导出前检查全部参数，正文开始后不插入回执；流中断通过 stderr 和退出码报告，不能撤回已经写出的 stdout。JSON 导出使用现有严格编码器，拒绝不支持的 bytes/bigint、非安全整数等；不以普通 stringify 静默改变数据。

## 五、JSONPath、JSON Patch 与 CLI 公共行为

JSONPath 采用 jsonpath-rfc9535 1.3.0，增加一个适配模块，只暴露标准 query，不开放自定义函数或 JavaScript 执行。上游支持 ESM/CJS、Node ≥20、返回匹配数组，并声明通过指定版本的合规测试；本项目仍须独立验证标准函数和边界。[官方说明](https://github.com/P0lip/jsonpath-rfc9535)。

先验证 JSON 值和路径语法，再查询；缺失记录、非法语法、零匹配分别处理。保留 `[null]`、数组节点作为单个匹配、重复命中和标准顺序。路径层独立于 Runtime，不为支持 JSONPath 扩展模型类型。

JSON Patch 在独立模块按 RFC 6902 实现六种操作；使用 own-property 定位、严格 Pointer 转义及数组索引检查，copy 复制值，move 检查不能移入自身子节点，test 按 JSON 值相等比较。对象赋值使用普通数据属性，`__proto__` 等键不得触发原型 setter。整组只操作隔离副本，允许中间态暂不满足模型，最后统一校验；根 remove 不偷换成 null 或删除数据记录，最终没有 JSON 文档则拒绝。此处不采用带内部扩展操作或不同根删除语义的库来冒充标准。[RFC 6902](https://www.rfc-editor.org/rfc/rfc6902.html)。

Commander 解析错误与 handler 错误共用输出适配；解析前识别本次命令的 output 选择，配置 exitOverride/错误输出，覆盖 `--output=json` 和位于错误参数之后的 output。JSON 错误 stdout 为空、stderr 恰一个 error 对象、退出 1；help/version 正常退出。错误码来自结构化错误，不匹配自然语言文本。

文件输入只在显式 `-` 时读取 stdin，一次命令最多一个来源消费 stdin。先检查必填、互斥与能力，再打开输入；Payload 走字节流。机器回执包含实际 Project、适用的模型/Store/记录 ID。原始 stdout export 与 JSON 回执互斥。其他旧命令仅在本轮 list 范围同步输出，不顺带改变所有 CLI 协议。

## 六、全部 list 的分页

抽出通用 limit 校验、游标编码和分页选择；默认 100、范围 1–1000，先筛选再排序。游标包含协议版本、命令、查询范围/筛选摘要、续查位置和完整性校验值；该值只检测损坏，不代替权限。scope 不含 limit 和输出格式，允许调整每页大小；不得跨命令、Project、Store、节点或 Run 使用。

| 入口 | 排序与 scope | 主要文件 |
| --- | --- | --- |
| model list | 完整模型 ID；Project、来源/包/标签/关键词/状态 | 新模型服务、commands/model.ts |
| data list | 完整记录 ID；Project、Store 及当前绑定；包装已有 Store 游标 | data-service.ts、shared/filesystem.ts |
| data store list | Store ID；Project、model/kind；不打开目录 | business-stores.ts、commands/data-store.ts |
| project list | Project 名称；Home、Workspace | commands/project.ts |
| memory list | Project 名称和完整引用；实际项目集合、kind/query、Run | commands/memory.ts、memory/catalog.ts、factory.ts、serializer.ts |
| memory list 的子节点模式 | 声明序号；Memory、父节点、Run | memory/navigation.ts、serializer.ts |
| archive list | archivedAt 缺失时取 ID 降序，同值按 kind/ID 升序；归档范围、kind | commands/archive.ts、archive/store.ts |

字符串排序使用确定的比较，不能用随语言环境变化的 localeCompare。取多一条判断下一页，末页省略 nextCursor，空列表为 items: []。文本也只显示一页和可复制游标。Memory JSON/YAML 统一 items/nextCursor，保留所属 Memory、父节点等上下文；resolve/read 仍使用完整内部索引，不让第一页限制名称解析。

src/acp/cli-runtime.ts 的 memsphere-review 包装器透传分页参数并保持 Session/冻结 Run 限制；包装器自身拒绝也遵守 JSON list 错误约定。同步模板中翻页说明及所有 `.memories/.nodes/next_cursor` 的受影响调用方；不机械更改 View 独立 payload，也不把 Run status 扩为分页命令。原范围不变时连续翻页不得重复或遗漏，源内容变化不承诺快照。

## 七、开发任务与依赖顺序

下表是实施工作包及其依赖；正式 Task List 在本方案通过后由下一步骤生成。

| 工作包 | 修改范围与完成判据 | 依赖 |
| --- | --- | --- |
| D1 身份与检查 | 内置 ID/物理目录/Run Store ID 分离，本地引用校验与错误分类、支持范围拒绝；资源 06 与全部副本修正；正向测试模型统一 .json 身份 | 无 |
| D2 锁与恢复 | Project 内核写锁及相关入口、filesystem JSON ValueStore 记录锁、模型操作记录及只读快照；共同写入服务先恢复再预检 | D1 的身份清单 |
| D3 模型服务 | CRUD、登记、直接绑定保护、validate、系统安装/市场/恢复统一检查 | D1、D2 |
| D4 Store 与数据 | dataStores 配置、纯读取打开、目录保护、CRUD/CAS、高水位、validate/export | D2、D3 |
| D5 CLI 与路径 | 参数、输入输出、JSONPath、JSON Patch、错误与 dry-run | D3、D4；路径纯模块可并行 |
| D6 分页与调用方 | 公共游标和六个命令、Memory 模式、Reviewer、序列化 | 公共输出可先行，与 D3–D5 并行 |
| D7 文档与实际清理 | Memory/Skill/帮助/双语 README、真实 Project 修正及验证记录 | D1–D6 的接口稳定后 |
| D8 验证与交付材料 | 受影响测试、进程故障与并发、完整门槛、验收矩阵及 Memory 证据 | 按包逐步执行，最后完整回归 |

核心冲突文件 src/cli.ts、src/project/model.ts、src/persistence.ts 由一个执行者集成；其他模块可分给辅助 Agent，不能让多个 Agent 并发改同一公共文件。正式研发、测试和架构 Reviewer 通过流程派发，不由这些辅助调查代替。

## 八、验证方案与需求映射

测试以用户可观察契约命名。纯路径/游标校验用单元测试；Store/模型服务用临时文件系统模块测试；真实 CLI、并发、进程终止、View 使用集成测试。子进程竞争使用 IPC/文件屏障等待明确状态，不用固定睡眠碰运气。

| 验收 | 主要证据 |
| --- | --- |
| A1–A3 | CLI Project/worktree 选择、模型 CRUD 及登记、system 全入口含 dry-run 拒写；test/project-models.test.ts、新 model-command 集成测试 |
| A4–A5 | 相同不支持定义各来源一致拒绝、definition 分项、元模型/raw 区分；空/非空直接 Store 保护、写失败原内容保留 |
| A6–A7 | 两种 Store create/remove/re-register、真实 JSON 根值及 Payload CRUD、ID/MIME/目录兼容性和不覆盖；现有 data-filesystem 测试加新业务 Store 测试 |
| A8 | JSONPath 标准五函数、切片/递归/筛选、重复/空/null/数组/非法表达式；Patch 六操作、特殊键、转义、数组、根、test 失败及中间态非法但最终合法 |
| A9–A10 | 独立进程同 revision 的 update/update、update/delete、delete/delete、edit/edit；无条件写、CLI 与 Factory 混合；删除重建拒绝旧 revision；无 CAS Store 写前拒绝 |
| A11–A13 | 二进制导出字节一致、目标存在不覆盖；参数/解析/业务错误双流与退出码；stdin 不隐式等待；所有只读和 dry-run 前后文件树、配置、目录无写差异 |
| A14、A17–A18 | 托管目录/Store 别名拒绝；create/initialize 同标准、重复执行；损坏系统文件不回退，普通坏模型不吞掉其他列表项；Run/Review/市场回归 |
| A19–A20 | Schema 位置与数据字段区分、全部外部引用拒绝；06 全副本零跨引用；04/05 和九个 run-domain 预期不支持；系统及实际 raw Run 正常 |
| A21–A22 | model read 三个部分与删除选项；ID 冲突/映射/冻结摘要和数据地址不变；每个发布与恢复阶段 SIGKILL 后重试原写命令、再次中断、后来修改冲突不覆盖；initialize 仅恢复后执行自身职责 |
| A23–A24 | 新旧配置一致校验、路径别名/目录重叠、未知字段/Factory/MIME 拒绝；全量盘点及导入/恢复不能重新引入违规 |
| A25 | 六个 list、Memory 各模式、Reviewer；默认/边界 limit、筛选后多页、空末页、错 scope/cursor、改变 limit、三种输出与未变数据无重复遗漏 |
| A15–A16 | 受影响测试之后的四项完整门槛、System Memory 与当前副本一致、最终 ChangeSet 校验与 View 证据 |

锁和恢复专项覆盖：持锁进程活着时不可被超时抢占；SIGKILL 后新进程取得同一锁；不删除协调文件；记录发布前后均无半条 JSON；成功落盘但回执丢失时重读实际结果；模型 pending/committed/恢复各阶段与并发只读，不能看到混合状态。底层磁盘写入错误须保留恢复证据，不假称全部回滚。

第二轮补充验证：CRUD 中断后重试原命令，先恢复再加载模型和执行预检，不需要 initialize；不同模型写请求也必须先恢复，不能重放旧请求或夹带初始化。initialize 中断仍可重试自身。恢复冲突阻止新写、恢复再次中断可重试、已提交重试按实际状态返回；读取与 dry-run 遇到未完成记录前后无文件变化。相关 Project 配置入口不能覆盖 pending 操作的文件。独立 Factory 调用验证记录锁位于 filesystem JSON ValueStore；接口与其他 Store 不被新增文件锁依赖或能力要求绑定。

现有受影响套件包含 project-models、system-models、reserved-models、model-market、run-model-storage、data-filesystem-json-valuestore、data-filesystem-datastore、memory-catalog/navigation/serializer/command/cli、project-command、archive-store、agent-review、config-management、reserved-store；按实际文件名及新增测试运行，不用全量历史成功结果替代本轮。

局部模块测试使用 `node --import tsx --test <受影响文件>`。跨 CLI 测试先构建并在临时 MEMSPHERE_HOME/Project 中执行。随后实际执行并记录 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`。`npm run validate` 不是 Memory 校验。保留现有 Linux/macOS/Windows CI，并增加原生依赖安装与包安装后锁冒烟；Node 20 最低版本至少覆盖依赖导入和关键 CLI。非本机平台尚未运行必须明确记为未验证，不能用上游 CI 替代。

若修改了既有 View 模型展示、可用性或错误交互，使用 playwright-cli 实际验证相关页面；本轮不新增业务 CRUD UI。

## 九、文档、Memory 与真实 Project

同步 README.md、README.en.md、docs/data-layer-design.md、src/data/README.md 及相关 extensions/management 说明、命令帮助、THIRD_PARTY_NOTICES.md 和依赖锁文件。

修改 reserved-memory/system-memory/concepts/memsphere-framework.yaml，说明新增命令和模型/数据/Store 责任；修改 statements/memsphere-memory-access-rules.yaml 的分页规则；同步 src/skills/memsphere/SKILL.md 与中英文 acp-review/acp-review-v2 命令模板，指导 Agent 翻页到 nextCursor 缺省。本轮不新增 Memory YAML syntax 关键字。若发现必须新增，先独立修订方案并按规范取得 Human 确认，施工不得自行增加。

当前开发 Project 的 Memory 为 Embedded 读取当前 worktree，按 memory edit 返回的位置同步相应 .memsphere/memory 副本；若实际类型不同，按 Managed ChangeSet 路径处理，不直接改受管正式 Store。修改后运行 reserved-store 测试、memsphere validate 和 memsphere memory change validate，记录最终 ChangeSet ID、passed 与 View 入口。

真实 Project 的模型修正在实现和隔离测试通过后执行：先只读盘点及保存受影响原文件/冻结内容摘要，使用新 initialize 修正身份；已确定的跨引用副本按显式清单清理，保留字段约束和数据，完成后重跑同一盘点。不要把市场重导入当作清理方法，也不要覆盖冻结 Run/Review。真实项目之外的样例正向用例同步新标准，历史归档只作证据、不重新作为可用资产发布。

## 十、方案准备阶段的验证

已完成三名辅助 Agent 的只读调查，覆盖模型/初始化、数据/Store、CLI/分页。未修改业务代码、实际 Project、模型或 Memory；未运行本轮实现测试。

临时目录 `/tmp/memsphere-cli-dependency-check.vx7O1W` 安装 fs-native-extensions 1.5.1，执行 `node /tmp/memsphere-cli-dependency-check.vx7O1W/lock-probe.cjs`：Node v22.16.0、Linux x64，跨进程互斥、SIGKILL 后重新取得锁、同进程独立描述符互斥均通过。此试验只验证依赖行为，不证明上面的协调服务已经实现，也不覆盖 Windows/macOS。

同一临时目录安装 jsonpath-rfc9535 1.3.0，执行 `node /tmp/memsphere-cli-dependency-check.vx7O1W/jsonpath-probe.mjs`：真实 ESM 导入与 13 项检查通过，包含通配、筛选、零匹配、null、数组节点、重复命中、五种标准函数，以及拒绝 Pointer 和赋值表达式。此前 CJS 导入的相同范围冒烟也通过。这是依赖选择依据，不代替本项目适配器及完整 RFC 边界测试。仓库 package.json 与锁文件均未修改。

三名辅助 Agent 已对完整方案再次复核，分别覆盖模型、数据/Store、CLI/分页，均未发现阻止提交的问题；正式研发、测试与架构评审仍以本步骤提交后产生的意见为准。

## 向前兼容

结论：不需要向前兼容。沿用需求确认的无 stable checkpoint 结论，不保留旧模型 ID 或旧列表字段别名。initialize 对旧身份的识别仅为显式修正；恢复文件仅为完成或撤回本次操作，均不是日常访问兼容层。业务数据、字段含义、合法登记属性、Store/记录地址和冻结历史按需求保留。

## 待确认项

无待 Human 再选择的产品范围。Runtime 不扩展、统一 ID、禁止跨模型引用、list 分页、data edit、JSONPath 和系统只读均按已通过需求执行。

本次请求研发、测试和架构评审上述具体实现方案，包括原生锁依赖、模型操作记录、删除版本保留及 JSON Patch 实现；方案通过前不开始业务代码施工。依赖安装/平台验证失败或调查出现需要改变产品行为的问题时，明确报告并修订方案，不静默降低契约或假称已经验证。
