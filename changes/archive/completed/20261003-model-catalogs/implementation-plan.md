# 实施与验证方案

Run：`run-20261003-055813z-2e69aa7e`。基线：`f27d9f0`。依据：已通过第 3 轮产品评审的需求契约。本方案用于研发、架构、测试评审，尚未开始功能实现。

## 采用的规则与评审意见处置

采用已完整读取的 `memsphere-repository-development-rules`、`memsphere-repository-testing-rules`、`memsphere-repository-requirement-rules`、`memsphere-repository-delivery-rules`，以及 `memsphere-framework`、`memsphere-view`。保持既有模型身份、定义标准、数据保护及显式写入边界；不扩展公共 DataStore、业务 Runtime、Memory DSL 或配置平台。

需求第 3 轮 Human 已通过。产品 Agent 的兼容性意见引用了与当前工程专用 Statement 不同的通用判断规则；Runner 已核对专用规则的 stable checkpoint 条款并记录 `rejected-invalid`，需求中明确承诺保护的既有行为照常验证。备份恢复细化意见记录为 `accepted-followup`，完整纳入本方案的本轮实现和删除前置检查，不留至交付以后。

## 代码现状与影响范围

| 位置 | 现状及本轮修改 |
| --- | --- |
| `src/project/model-registration.ts` | 定义、系统登记及示例登记提示内联；拆出纯类型/校验，改从资产读取登记定义，并读写实际系统登记。 |
| `src/project/run-data.ts` | 四个 raw 模型内联 `{}`；改用统一资产作为启动来源，Project 模型查询使用实际持久定义，保留原始内容 Store 的字节语义。 |
| `src/project/models.ts` | 自动拼接五个虚拟系统模型；改按持久登记发现系统模型，增加私有系统定义 Store 映射，保留用户及市场定义读取。 |
| `src/commands/project.ts` | create 仅初始化 Memory；在新 Project staging 阶段安装系统模型，显式 models initialize 为既有 Project 补装。 |
| `src/project/model-market.ts` / `model-market-assets.ts` | 单订单包和 JSON 字符串内嵌；改从清单读取，导入校验定义标准及引用，不以 Runtime 子集编译作为入库条件。 |
| `src/project/model-storage-paths.ts` / 登记迁移 | 登记根及备份根已有发现排除；系统子树放入登记根并随现有完整迁移一起搬运。 |
| `src/commands/view.ts` / Models 模块 | 复用现有模型、市场、初始化 API 及包浏览；以真实 `origin`、`storage`、`store_id` 展示，不新增界面入口。 |
| `package.json` / 构建脚本 | 将完整 `reserved-models` 与 `scripts/relocate-example-models.mjs` 显式加入 npm `files` 白名单，脚本运行依赖由已发布 `dist` 提供；加入资产清单和恢复脚本完整性校验。 |

## 发行资产与清单

沿用需求契约中的完整 `reserved-models/` 目录树。`system-models` 保存五份定义；`market-models/examples` 保存八份原始示例 JSON；订单旧包与新示例包共用 02 的源文件。

清单固定采用以下最小结构，不新增登记字段或 Memory syntax 关键字：

```json
{
  "version": 1,
  "system_models": [
    {
      "source": "system-models/model-registration.json",
      "metaModel": "json-schema/draft-07",
      "registration": {
        "modelRef": "memsphere/model-registration",
        "name": "模型登记",
        "package": "memsphere.builtin",
        "package_name": "Memsphere 内置",
        "tags": ["management"],
        "storage": "store",
        "store_id": "models/system/json-schema/draft-07"
      }
    }
  ],
  "market_packages": [
    {
      "id": "memsphere.examples.orders",
      "name": "订单示例",
      "description": "订单与深层嵌套的 JSON Schema 示例。",
      "models": [
        {
          "source": "market-models/examples/02-nested-order.json",
          "metaModel": "json-schema/draft-07",
          "registration": {
            "modelRef": "memsphere/examples/order.json",
            "name": "订单与深层嵌套",
            "package": "memsphere.examples.orders",
            "package_name": "订单示例",
            "tags": ["订单"],
            "storage": "store",
            "store_id": "models/imported/json-schema/draft-07"
          }
        }
      ]
    }
  ]
}
```

以上只展示结构；正式清单包含全部五项系统模型及两个市场包，新 `memsphere.examples` 包包含全部八项。旧订单登记的现有名称、说明、标签等全部按原值保留。ModelRef 仅在 `registration.modelRef` 声明一次。四个 raw 模型的元模型为 `raw`、Store ID 为 `models/system/raw`。

新增 `src/reserved/models.ts`，相对模块位置定位发行包根，不依赖 cwd。源读取保留字节、BOM、空白和换行，解析副本时去除 BOM。清单读取可保留同步薄入口，以兼容既有同步启动绑定和 `listModelMarket()`；校验逻辑统一，不能为了同步接口再复制定义常量。

先提取 `src/project/model-registration-contract.ts`，仅保存登记类型、常量和纯校验函数，避免“登记模块读资产、资产模块又导入登记模块”的循环。Draft-07 定义合法性复用现有元模型校验语义，必要时提取共享校验函数；raw 定义用已有 raw 定义规则检查。业务 Runtime 子集不参与目录合法性判定。

资产门禁检查清单版本及字段、包 ID/ModelRef 唯一性、登记与包/Store/元模型对应关系、引用闭包、遗漏源文件、缺失文件和非法定义。源必须是对应目录下的普通 `.json` 文件，拒绝越界与符号链接；允许多个不同身份引用同一源文件。根布尔 JSON Schema 不在本轮新增支持范围，八个示例均为对象形式定义。

## Project 系统模型的实际存储

系统资产放在当前选中的模型登记根之内，默认布局如下：

```text
<Project>/models/registrations/
├── project/                     # 原有本项目登记
├── imported/                    # 原有市场登记
├── imported-definitions/        # 原有市场定义
└── system/
    ├── registrations/           # 五项持久登记 ValueStore
    └── definitions/
        ├── json-schema/draft-07/
        │   └── memsphere/model-registration.json
        └── raw/
            └── memsphere/run/<artifact 等四项>.json
```

登记根使用现有 `modelRegistration` 配置解析，相对路径仍以 Project Root 为基准，不增加新的配置项。系统子树随已有登记根迁移完整复制，字节和 Store ID 不变；旧根继续排除于项目定义扫描。系统持久登记仍使用原八字段，来源由 `system/registrations` 上下文决定，不写入来源字段。

新增 Project 私有系统定义适配器，对外 ModelRef 保持无 `.json` 后缀的稳定 ID；底层通过固定 `${modelRef}.json` 映射复用 filesystem DataStore。读取结果恢复原 ModelRef，Store ID 决定定义标准；不改变公共 filesystem 的扩展名和 DataId 契约。系统文件仅按登记读取，不加入用户 `.json` 目录扫描。

`readModelRegistrations()` 增加 `system` 来源，与项目、市场共同检查重复身份和包名称一致性。`createProjectModelHost()` 根据实际登记定位系统 Store、返回实际源字节，系统保持 `origin=system`、`builtin=true` 的来源标识，同时 `registration.storage=store` 和真实 Store ID 表明持久化。未安装的旧 Project 不再凭空拼出五条虚拟系统模型，必须显式补装；GET 不初始化、不创建目录、不写标记。

登记 Runtime 的自举固定定位 `system/definitions/json-schema/draft-07/memsphere/model-registration.json`，不先查询它自己的登记。系统子树尚不存在时仅用发行 JSON 作为创建/读取登记容器的最小启动定义；子树存在但定义缺失或损坏必须报错，不能静默用代码覆盖或替代。目标阶段候选的登记 Store 可使用同一发行启动定义校验。

四个 raw 定义从持久 Store 读取原始 JSON 后解码为预解码 `ModelBinding.model`，由原 `RawModelRuntime` 校验；不得用 `loadData` 强行准备不存在的 `raw` 定义格式 Runtime。JSON Schema 系统模型按已有元模型路径校验。读取源和解码定义必须来自同一字节快照。

Run 内容 Store 仍直接处理原始字节，不额外要求编译业务模型。保留 `prepareRunData()` 同步接口和注入 manager 能力；正常 Project 配置装配传入 ProjectModelInput，getModel/getRuntime 在同一 manager 快照内惰性委托 Project 模型 Host，读取实际系统定义。纯独立内容 Store 调用仍可使用发行定义启动，不向 Project 列表注入模型。缓存身份包含 Project 及存储配置，切换配置重新装配；归档调用不得覆盖已经准备的 Project 装配。

## 创建、补装与失败边界

新增系统安装服务，按“完整预检、隔离阶段、验证、发布”执行。若系统子树不存在，在登记根的隐藏候选目录准备全部五份定义及五条登记，校验实际 Store 回读字节、登记、元模型与 raw Runtime，再通过一次目录 rename 发布 `system/`。候选不参与发现。失败清理候选；清理失败返回残留路径，不伪装成功。

若系统子树已经存在，先校验完整五项和源定义内容；身份、Store 或定义冲突及缺失/损坏均拒绝，不做本轮未承诺的自动修复。内容一致直接返回 unchanged，保留用户已保存的名称、说明、标签等管理属性，不重写记录、initialized 标记或配置。其他区域占用系统 ModelRef 在发布前拒绝。并发操作复用 Project settings lock，发布前再检查目标不存在。

`project create` 在 staging Project Root 中完成系统安装和默认登记配置写入，再进入现有 rename/注册/Memory bootstrap。这样模型安装失败发生在对外注册和 Embedded Memory 写入之前；后续 Memory bootstrap 失败沿用现有 Project 回滚，清理新 Project Root。Managed 和 Embedded 共用相同模型安装，不将模型写入 Memory Git Store。

`project models initialize` 与现有初始化 HTTP 入口共用编排：先完整预检系统和用户定义/登记，拒绝已知冲突；补装系统并继续现有用户登记/已确认旧预览迁移。失败回退本次新增的系统子树与新登记，保留原数据及既有迁移备份；失败回执明确阶段和待恢复项。既有用户登记迁移所需的原始文件及记录快照纳入操作范围，不能仅回退 system 却忽略已经改动的用户记录。重复无变化时不重写 initializedAt/config。CLI 回执保留原有字段含义，并增加系统 created/retained/unchanged 结果。

本轮不新增 init 别名，不扩展 project repair、clone、register 的自动安装行为；它们的既有项目可通过显式 models initialize 补装。市场模型永远不随 create/initialize 自动导入。

## 市场导入及引用校验

`listModelMarket()` 改为清单驱动，保留旧订单包身份、单模型顺序和登记信息，再提供八项示例包。移除 `model-market-assets.ts` 的内嵌 JSON。现有候选清理按当前清单验证旧订单 receipt 时仍能命中相同包、模型 ID 和数量。

导入前使用 Draft-07 元模型检查原始定义，替换现有逐模型业务 Runtime 编译门槛。建立包内模型索引，检查完整引用闭包和本地 JSON Pointer；06 的外部引用直接命中 `examples/07-scalar-enum-root.json`，不按所在目录重写 ID。保持现有候选写入、独立 imported 定义 Store、登记写入和最终 published-imports 标记，发布前不显示半包；冲突、重复相同导入、清理失败仍按原契约执行。

新增共享的 Project 私有 Draft-07 schema 引用遍历工具。遍历 properties、patternProperties、definitions、单项/元组 items、additionalProperties、additionalItems、contains、propertyNames、not、if/then/else、allOf/anyOf/oneOf、schema 形式 dependencies；跳过 examples/default/enum 等注解值中的伪 `$ref`。不递归展开引用，从而不会因递归 schema 无限循环。保留现有“无绝对 $id 时外部引用使用精确 ModelRef”的含义；市场清单当前仅用本地 Pointer 和精确包内 ModelRef，不能判定的形式明确报错，不联网。

04、05 导入后定义可用、界面可浏览；显式准备业务 Runtime 时仍返回现有 contentEncoding/if 等不支持诊断。不得删减示例内容或宣称实现完整 Draft-07 Runtime。

## 当前 Project 八项示例的可恢复整理

使用本需求专用维护脚本 `scripts/relocate-example-models.mjs`，只处理需求列出的八个 ModelRef，提供 `plan`、`apply --plan <file>`、`restore --backup <dir>`。脚本复用可测试的 Project 私有服务，不增加通用迁移命令平台。`package.json.files` 显式增加 `scripts/relocate-example-models.mjs`；脚本仅相对自身位置导入包内 `dist/project/` 的已编译服务，预期基线等运行资产也必须位于 `dist` 或 `reserved-models` 内，不依赖源码、历史 changes 附件或临时目录。构建检查脚本存在且包内运行依赖可解析，打包测试断言白名单实际包含该脚本，以便用户从安装版本或本轮 commit 执行恢复。

计划阶段通过 Registry/配置解析实际 Project，逐项匹配已调查原始 JSON 和原有登记基线（含 02 的订单包属性），不把现场变化重新采样成已批准基线。输出 Project 名称、规范根、配置 digest、Store/路径映射、八份原文 digest、八个登记记录 ID/完整文件 digest、市场源 digest，以及保留模型及已导入内容摘要。任一目标缺失、重复、损坏、来源变化或自定义内容均报冲突并保留。

备份固定放在现有发现排除目录 `<Project>/backups/model-registration/20261003-model-catalogs/<operation-id>/`，保存完整原始定义字节、完整登记记录文件（含 revision/时间/ID/value）、计划 manifest、配置/路径映射、操作日志与成功/失败回执。备份默认长期保留，脚本不自动清理。恢复不通过 ValueStore.create(value) 重建记录，必须原样恢复完整记录及原始 ID。

apply 在 `withModelRegistrationLock()` 下重读计划中全部摘要和路径，扫描所有保留的项目及已导入模型对目标的引用；共享完整 schema 遍历器，无法确定引用含义或存在目标依赖时拒绝。先写备份并逐字节验证，再使用同一个 restore 实现向隔离临时 Project 恢复，核对登记、原文、来源及 06→07 引用。04/05 不要求业务 Runtime。备份完整性或恢复演练未通过，真实数据一项也不移出。

演练通过后逐项把原文件移入备份下不参与发现的隔离区，记录每项移动状态并检查移动后字节；本次维护脚本可限定源与隔离区同一文件系统，提前发现跨设备场景则拒绝，避免半程 fallback。失败按逆序恢复；恢复只允许目标缺失或字节相同，不覆盖不同内容。回滚不完整时保留所有备份/隔离原件并列明未恢复项及精确恢复命令。进程中断后依据 manifest 和实际文件摘要恢复，不仅信任最后一条日志。

settings.lock 协调受控写入口，不能锁住外部编辑器；因此必须在移出前重读、移出后核对，遇到不同字节保留现场与备份并失败，不声称具有存储层跨进程 CAS。restore 先对全部目标做无覆盖预检，再恢复；重复执行无变化，任何路径出现不同内容时停止并列出冲突。

真实执行限定当前 `memsphere` Project，在代码验证及方案评审通过后进行。只迁出八项本项目示例，不自动市场导入、不修改其他 Project 或已导入模型。完成回执必须证明八项本项目记录消失、市场八项完整、其他内容摘要不变、备份和恢复演练通过；重新执行须识别已完成回执而不重新创建八项。

## 开发任务与验证矩阵

后续 Task List 按下表拆分，独立模块可并行；共享函数接口及文档由 Runner 汇总。

| 工作 | 验证的用户可观察契约 |
| --- | --- |
| 资产、清单、纯登记契约与加载器 | 五项系统、两包九个市场身份/八份源；目录缺失、遗漏、重复、越界、符号链接、无效定义/登记拒绝；02 同源不同身份合法。 |
| 系统 Store、登记读取、Host 与 Run 装配 | 持久源字节、原 ModelRef/元模型、raw bytes 行为；无隐式目录写入、无虚拟系统行；已安装损坏明确诊断；登记根迁移保留系统内容。 |
| create / 显式 initialize 编排 | Managed/Embedded 创建即完整入库；新进程可读；安装失败不注册成功；重复不改 bytes/revision/mtime；冲突及注入写失败保护原数据。 |
| 市场两包、定义标准校验与引用遍历 | 八项整包可导入且原文一致；06 Runtime 引用正确，04/05 保留限制；悬空引用、联合/条件引用、注解伪引用；旧订单候选可清理。 |
| 专用整理与恢复脚本 | 正常移出/原样恢复/重复恢复、调查后改动、外部引用、坏备份、逐项失败/中断、恢复目标冲突、非目标摘要不变、备份不可见。 |
| 文档与 Memory | README/Skill、framework/view 源及当前 worktree 副本一致；最终变更级校验证据匹配。 |

先执行受影响测试，包括新增 reserved-models/system-models/example-relocation 套件，以及 `model-registration`、`project-model-registration-cli`、`project-models`、`model-storage-paths`、`model-market`、`model-market-package`、`view-models`、`model-registration-browser`、`run-data-access`、`archive-run-data`、`reserved-store` 等实际受影响文件。复用相应测试夹具，测试名称明确每个用户可观察契约；不为代码语句机械加测试。

正式打包测试使用 build 后的 `npm pack --ignore-scripts`，在仅解包发行物并离线链接依赖的隔离目录运行：检查完整 reserved-models、两市场包及八项导入；通过包内 CLI 创建 Managed 和 Embedded Project，检查真实五项定义/登记、稳定 ID 和进程重开读取。另断言 tarball 实际包含 `scripts/relocate-example-models.mjs` 及其 dist 依赖，使用包内服务构造八项旧项目 fixture，从解包目录实际执行 `node scripts/relocate-example-models.mjs plan`、`apply --plan <file>`、`restore --backup <dir>`，核对完整定义/登记原样恢复以及恢复冲突拒绝；这些运行不得读取原 checkout 的 src、changes 或 scripts。脚本遗漏时发行内容断言失败，备份损坏时包内 restore 预检失败且不写目标。测试内部不递归 build，避免共享 dist 并发清理。

前端若仅数据来源变化，仍验证真实 View 中系统存储信息、市场八项及导入后包归属；若调整任何交互，按仓库规则使用 playwright-cli 实操。隔离 Project 承担市场实际导入验证，当前真实 Project 保持八项未导入状态。

受影响测试通过后执行 `npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`；System Memory 有差异时同步运行 `test/reserved-store.test.ts` 并对最终内容执行 `memsphere memory change validate`，记录 ChangeSet ID/校验状态/View 入口。区分本轮失败、历史失败和环境阻塞，不用历史结果充当本轮证据。

## 当前验证状态与实施门槛

本方案依据实际代码调查及需求阶段证据形成，尚未运行本轮实现测试，未变更真实 Project 数据。无新增产品取舍待决。必须通过研发、架构、测试的本步骤评审后，才产出 Task List 并开始实现；备份恢复演练及真实数据整理还须满足上述各自执行前置条件。

## 方案评审修订

第二版接受首轮测试意见：显式声明恢复脚本的 npm files 白名单、只依赖包内 dist/资产、构建与打包完整性门禁，并从解包 tarball 实测 plan/apply/restore、字节保留及损坏/冲突预检。研发与架构首轮通过；本次修订不变更已确认需求范围。
