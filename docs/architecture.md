# Memsphere 总体架构

简体中文 | [English](./architecture.en.md)

本文记录 Memsphere 的长期总体架构基线。它描述 Memsphere 在 Agent 生态中的位置、平台核心与个性化软件的边界、Project、App 与组成能力的组织方式、代码分层，以及 CLI、View 与数据能力如何协作；不规定当前版本必须一次性实现的全部细节。

App 的完整设计见 [App 设计](./app-design.md)；数据协议与扩展机制见 [数据层设计](./data-layer-design.md)；前端扩展机制见 [View Plugin Design](./view-plugin-design.md)。三者分别细化业务功能组合、数据能力和界面能力。

## 系统定位

Memsphere 是运行在通用 Agent 之上的个性化软件运行环境。Agent 负责理解意图、推理和执行；Memsphere 负责组织、运行和管理可以跨对话、模型与 Agent 持续积累的软件资产。

Human 和 Agent 从不同入口使用同一套个性化软件：

```text
Human
  → Memsphere View
  → Module（View Module）

Agent
  → Memory
  → CLI（独立工具或 CLI Adapter）

View / CLI
  → Application
  → Domain
  → Persistence Adapter
  → Project 中的权威数据
```

Memory、CLI、数据和界面是个性化软件可以逐步生长出的四类协作资产。它们不要求在软件诞生时全部存在。App 围绕一个完整业务功能组织这些能力，并声明它们的连接关系；Memory 可以是 App 自身的组成资产，随 App 交付和演进。Project 安装并组合多个 App，同时容纳各 App 所属 Memory 和尚未归属任何 App 的待组织 Memory。CLI 可以是外部独立工具，不要求以 Memsphere 插件实现。

## 总体边界

Memsphere 的总体组织边界如下：

### Memsphere Core

Memsphere Core 是随 Memsphere 发布并保持稳定的平台基座，负责：

- Home、Registry、Workspace Binding 与 Project 解析；
- Memory 的发现、读取、修改和验证；
- Procedure Run、Artifact、Review、ChangeSet 与 Archive；
- App 与组成能力的发现、安装、资产归属管理、依赖解析、实例组装和生命周期边界；
- CLI 登记与环境绑定、View Host、数据扩展装配以及扩展可依赖的公开 SDK；
- 故障隔离、配置管理和稳定的系统入口。

Core 提供运行环境和公共机制，不承载某个个性化软件的专属业务规则。

### Project

Project 是比 App 更大的项目与持久空间，由多个已安装 App 组合而成，并容纳尚未组织进 App 的 Memory、运行记录和权威数据。Project 统一提供 Memory 的发现、读取、校验与 Run 能力，同时保留 Memory 各自的 App 归属。Workspace 绑定 Project 后，Agent 与 Human 才能在当前工作上下文中使用其中的软件。

### App 与组成能力

App 是围绕完整业务功能组织的独立插件与资产集合。它直接组合 Module、Model、DataExtension、CLI 登记和自身拥有的 Memory，并可声明对其他 App 资产的依赖；这些组成不要求位于同一个物理包。官方能力与用户能力都应尽量通过相同的扩展机制接入 Core。

Module 就是 View Module，指可独立开发、加载和组合的界面模块。完整软件的组合与管理职责由 App 承担，Model、DataExtension 和 CLI 与 Module 并列参与组合。

它们的关系如下：

```text
Memsphere Core
├── Memory / Run / Review / ChangeSet Runtime
├── App Composition Runtime
├── CLI Registry / Environment Binding
└── View Host

Home
└── 可复用 App 包与组件的获取、缓存

Project
├── 已安装 App A
│   ├── Module / Model / DataExtension / CLI
│   └── App A 所属 Memory
├── 已安装 App B
│   ├── 按需选择的组成能力
│   └── App B 所属 Memory
├── 待组织 Memory（不属于任何 App）
├── Run / Review / ChangeSet / Archive
└── App 实例绑定的权威数据
```

## 个性化软件与 App

软件不再要求以传统应用的形式整体打包，也不要求从第一天起就具备完整代码：一份程序化 Memory 可以独立形成软件，一个只提供交互界面的能力也可以独立形成软件；随着使用深入，它们可以继续生长出确定性工具、领域逻辑和持久数据。

为了让完整业务功能能够独立组合和演进，Memsphere 引入 **App**。一个 Project 可以安装并启用多个 App；每个 App 按需组织由官方或用户提供的组成能力。只有 CLI、只有 View 或只有 Memory 的 App 都可以成立，完整性由业务目标决定。App 所属 Memory 是 App 的交付资产，纳入 App 版本与升级范围；Project 统一管理其使用，不改变其归属。

App 面向两类使用者提供入口：Project 中的 Memory 可以指导 Agent 发现并调用已登记 CLI，Human 通过 View Module 操作和观察软件。操作同一业务的 CLI 与 View 通过公共业务接口复用 Application 与 Domain，并最终操作同一份权威数据。外部 CLI 如何接入业务接口和 Project 数据必须显式适配，登记本身不会自动建立这些连接。

因此，用户代码不能进入 Memsphere 源码，也不能要求重新编译已经发布的 Memsphere。Memsphere 固化稳定的 Host、SDK 和组装协议，各组成能力独立开发和发布，由 Project 中的 App 配置建立具体使用关系。

## 总体架构目标

- Core 固化跨软件复用的平台机制，个性化业务功能通过 App 组合已有扩展点。
- Project 成为多个 App、各 App 所属 Memory、待组织 Memory、运行记录和权威数据的统一项目边界。
- 一个 Project 可以安装多个 App，并分别启用；初版每个 App 在一个 Project 中安装一份，View Module 保留多实例能力。
- App 可以按真实需要逐步增加自身 Memory、CLI、View 和数据能力，不为形式完整而强制空实现。
- Project 统一读取、校验和运行 Memory，同时保留 App 归属与跨 App 依赖；待组织 Memory 可后续明确纳入 App。
- 官方 Module 与用户 Module 采用同一套发现、加载和组装机制。
- CLI 是 Agent 使用确定性能力的入口，可以独立于 Memsphere 运行；View 是 Human 操作和观察软件的入口。
- CLI 与 View 复用 Application 和 Domain，并基于同一份权威数据工作。
- 用户安装 Memsphere 后仍可独立开发、编译、安装和组合 Module，无需重新编译 Memsphere。
- 一个 Module 既可以贡献完整页面，也可以扩展其他 Module 明确开放的局部界面。
- 界面原型与正式 Module 使用相同结构，可以从可交互原型直接演进为正式界面。
- View 服务不持有业务状态，可以随时重启并从 Project 配置和持久数据重新构建。
- 单个用户 Module 损坏时，基础 Shell 和其他健康 Module 仍然可用。
- Project 及其个性化软件资产可以迁移、复现和持续演进。

## 非目标

本文暂不设计：

- App Manifest、CLI 登记和 Module Manifest 的具体字段；
- App Memory 的物理路径、owner 元数据、命名空间、本地修改与升级合并、卸载资产处置等实现契约；
- Domain 数据模型、存储格式、迁移协议和跨 App 数据访问规则；
- CLI、View API 和 Persistence Adapter 的具体 TypeScript API；
- 非可信第三方代码的沙箱与权限模型；
- 不重启服务的插件热替换；
- 常驻的用户后台服务。

## 个性化软件组织模型

### Project

Project 是多个 App 安装组合而成的项目，也是软件资产、待组织 Memory 及运行记录的持久空间。Project 安装 App 时建立该 App 的资产与归属，保存安装版本、配置、环境和数据绑定；启用 App 则建立其运行入口。

Project 不等于一个传统软件包。它可以同时容纳多个用途不同的 App，例如一套研究流程、一个客户列表和一个任务看板，也可以保留尚未归属任何 App 的 Memory。统一 Catalog、存储或 Run 入口不意味着所有 Memory 都是 Project 独有资产。

### App 定义与 App 实例

App 定义保存稳定身份、版本、自身资产、组成能力、依赖和协作契约，可以跨包分发。App 实例是这份定义在 Project 中的一次具体安装，具有独立的配置、资产归属和启用状态。首版限制同一 App 在一个 Project 中安装一份；这不限制其引用多个 View Module 实例。

### Memory 归属与生命周期

App Memory 随 App 交付并纳入其版本和升级范围。Project 对各 App 所属 Memory 与待组织 Memory 提供统一的读取、校验、修改和 Run 管理；现有 ChangeSet 与 Run 机制继续承担受控修改和运行记录职责，如何承接 App 升级仍需专项契约明确。统一存储和操作入口不替代 App 归属。

逻辑引用用于寻址和依赖。App 可以依赖另一个 App 的 Memory，引用和使用不会转移资产归属。待组织 Memory 可以经明确组织操作纳入某个 App，不因同名、被引用或被使用而自动归属。

停用 App 撤销运行入口，保留已安装资产及其 App 归属。卸载 App 需要处理资产依赖和 Project 中的本地修改，并保留既有 Run 快照；资产保留、删除或迁移的具体策略另定，不默认删除 Memory，也不自动将其变为待组织 Memory。

本地安装的物理布局、归属与 checkpoint 见 [App 实现契约](./app-contract.md)。升级合并、卸载资产处置及已有 Memory 归属迁移仍待后续契约。

### Module 与其他组成能力

Module 是可独立开发、安装、加载和组合的 View Module，负责界面能力：

- 页面和路由；
- 向公开 Slot 贡献内容，并在自身界面内开放 Slot；
- 界面交互、展示逻辑和视图状态。

一个 Module 可以组织一组相关界面，不限于单个页面，也可以只贡献局部 UI。CLI、Model 和 DataExtension 是 App 直接引用的其他组成能力，不属于 Module 的子能力。需要后端业务规则时，Module 通过业务接口使用独立的共享库或服务。

Model 定义业务数据结构；DataExtension 提供模型解释、序列化与存储等可插拔实现；CLI 登记描述工具的稳定身份、用途、命令入口、帮助和版本要求，本机路径与环境配置属于实际使用绑定。发现工具、检查可用性和执行工具是三个步骤，登记成功不代表工具已经安装或配置完成。

### Module 实例

Module 是界面代码和资产定义，Module 实例是这份界面在 Project 上下文中的一次具体使用。

同一个 Module 版本只需安装一次，但一个 Project 可以声明多个实例。例如，同一个表格 Module 可以同时呈现“客户列表”和“任务列表”两个视图实例。每个实例拥有稳定 ID、独立的 View Context、界面配置和注册作用域；业务数据绑定归 App 与 Project 管理，Module 实例使用传入的业务上下文，不自行定义权威数据命名空间。

Module 之间可以声明界面依赖，也可以通过公开 Slot 等契约相互扩展。界面依赖属于 Module，实例选择与配置纳入 Project 的 App 组合；业务依赖与数据绑定由 App 声明。

### Memsphere View 与 Module View

Memsphere View 是一个 Home 级通用管理界面，用于管理 Project、Memory、Run 等 Memsphere 能力；Module View 是某个个性化软件提供给 Human 的专属界面。

两者最终运行在同一个 View Host 和产品外壳中，但不是同一个产品概念。官方 Memory、Run 等界面也应作为内置 Module 接入，而不是依赖不可替换的业务特权。

基础 Shell、Project 切换和故障诊断属于 View Host，不允许 Module 替换。

### 当前实现与目标设计

当前仓库已落地六个 builtin View Module：

```text
modules/
├── org.memsphere.memory/
│   ├── module.json
│   └── adapter/view/
├── org.memsphere.run/
│   ├── module.json
│   └── adapter/view/
├── org.memsphere.models/
│   ├── module.json
│   └── adapter/view/
├── org.memsphere.model-prototype/
│   ├── module.json
│   └── adapter/view/
├── org.memsphere.reference/
│   ├── module.json
│   └── adapter/view/
└── org.memsphere.settings/
    ├── module.json
    └── adapter/view/
```

构建分别生成 `dist/modules/<module-id>/dist/view/index.js`，不存在聚合业务界面的 Legacy Bundle。Core 中的 builtin catalog 只声明可信包根、实例和保留路由授权；内置和可信本地包统一经过 Manifest 校验、SDK 兼容检查、Bundle import、实例 Context、`apply()` 事务和 Slot/Route commit。

ViewHost 当前接通 Router、Slot Catalog、稳定 Shell、Home 与公共浮层能力。单实例失败只产生局部诊断，Project 切换允许整页重组。可信本地 View 包安装和 Home 级配置已实现；Home 中的主题、Slot 选择及包组合对所有 Project 生效，服务启动时保存固定 snapshot。准确的 Slot 清单、产品语义与当前接线状态统一见 [Memsphere View Slot List](./view-slots.md)。

当前实现通过 Project App 安装记录装配 Model Package、DataExtension、Store、View Module 和业务操作；CLI 登记与绑定支持 Agent 直接使用独立工具，App 自有 Memory 通过 ChangeSet 安装并保留归属。字段与实际命令见 [App 实现契约](./app-contract.md) 和[创建安装指南](./app-guide.md)。升级、卸载和已有资产迁移属于后续范围。

## Module 的界面代码组织

Memsphere 自身的源码仓库把 Core 与内置 Module 分开组织：

```text
memsphere/
├── src/                        # Memsphere Core
└── modules/                    # 随 Memsphere 发布的内置 Module 集合
    └── <module-id>/             # 一个内置 Module
```

`modules/` 是多个 Module 的集合目录，不是架构层。每个内置 Module 与用户 Module 使用相同的目录结构、Manifest 和 Host 协议；区别只在于内置 Module 随 Memsphere 一同分发。Core 中的业务界面按领域边界归属对应的内置 Module。

单个 Module 的内部结构为：

```text
module/
├── module.json                 # Module 描述文件；具体字段由 Module Manifest 契约定义
├── adapter/view/               # 页面、路由、Slot 贡献、交互与界面资源
└── dist/view/index.js          # 独立编译的浏览器入口
```

`adapter/view/` 存放 Module 的界面实现；CLI、后端业务与持久化实现由 App 独立组合。

## 业务实现的三层代码结构

业务实现采用三个同心层次：Domain、Application 和 Adapter。App 是业务功能的组合与管理单元；Application 是代码中的用例编排层，二者不是同一个概念。供 Module 与 CLI 共同使用的业务逻辑位于独立的共享库或服务中，不属于 Module。

下面仅示意业务代码的分层，不定义新的注册实体、强制目录或包格式：

```text
business-implementation/
├── domain/                     # 领域模型、规则和领域所拥有的契约
├── application/                # 用例编排和应用层所拥有的契约
└── adapter/                    # 外圈适配器
    ├── cli/                    # Agent 的确定性入口
    ├── api/                    # Module 与外部 CLI 可调用的服务端业务接口
    └── persistence/            # 文件、数据库或远程存储实现
```

目录按能力渐进出现，不要求为空缺能力创建占位目录。CLI、业务 API 和 Persistence 都属于 Adapter，不是新的架构层。共享库、服务和界面可按实际工程需要组织，彼此的职责不会因共用仓库或分发包而合并。

### Domain

Domain 保存不依赖界面、命令行和具体存储技术的领域模型与业务规则。只有领域本身拥有的边界契约才放在 Domain，例如领域需要的 Repository 或领域服务接口。

### Application

Application 把 Domain 能力编排成可执行用例，负责事务边界、权限检查和跨领域步骤协调。CLI 与 View 面向同一组用例工作，避免复制业务规则。

如果某个契约只服务于应用用例而不是领域本身，它由 Application 定义。

### Adapter

Adapter 位于同一个外圈，从不同方向连接业务实现与外部世界：

- CLI Adapter 把 Agent 发起的确定性命令转换成 Application 调用；
- 业务 API Adapter 把 Module 或外部 CLI 发起的业务请求转换成 Application 调用，Module 负责界面操作与结果展示；
- Persistence Adapter 实现 Domain 或 Application 拥有的持久化契约，把权威数据保存到具体介质。

Module 的浏览器 Bundle 不能直接导入只在 Node.js 中运行的 Application 与 Domain。服务端 HTTP/API 入口属于业务实现，独立于 Module 的浏览器入口；独立 CLI 可以通过该 API 或共享业务库接入：

```text
Agent
  → CLI Adapter
  → Application
  → Domain
  → Persistence Adapter
  → 权威数据

Human
  → Module 浏览器 Bundle
  → 业务 API Adapter
  → Application
  → Domain
  → Persistence Adapter
  → 同一份权威数据
```

具体传输协议由对应 Adapter 契约定义，但不能让浏览器直接访问数据库，也不能让 CLI 和 View 各自维护独立业务状态。

### 依赖方向与契约归属

静态依赖始终指向内层：

```text
adapter → application → domain
```

依赖倒置不要求单独建立 `ports/` 目录。契约写在拥有需求的内层，并与相关领域能力或应用用例放在一起：

- Domain 与 Application 的边界契约由 Domain 定义；
- Application 暴露给 CLI/View 的用例契约由 Application 定义；
- Persistence Adapter 需要实现的契约，根据需求所有者放在 Domain 或 Application；
- Adapter 不反向要求内层实现由 Adapter 定义的业务接口。

Port 是边界契约，不是第四个架构层。防腐层负责外部模型与内部模型之间的翻译，通常属于 Adapter，也不等同于 Port。

## App 与组件的运行结构

```text
Memsphere
├── App Composition Resolver
├── CLI Registry / Environment Binding
└── View Host
    ├── Boot Page
    ├── Stable Shell
    ├── Bundle Loader
    ├── Slot Registry / Renderer
    ├── View SDK
    └── Failure Boundary

Project
├── 已安装 App Instance A
│   ├── View Module 实例
│   ├── CLI 登记与环境绑定
│   ├── Model / DataExtension / Store 绑定
│   ├── 业务操作接口 → Application / Domain / Persistence
│   ├── App A 所属 Memory
│   └── 对其他 App 资产的依赖
├── 已安装 App Instance B（含 App B 所属 Memory）
└── 待组织 Memory
```

App Composition Resolver 根据 Project 安装与启用状态解析 App 版本、资产归属、能力依赖、实例配置和数据绑定，再交给各能力自己的 Host 或运行环境装配。Project 统一提供 Memory 读取、校验和 Run，并保留所属 App 身份及跨 App 依赖。View 和 CLI 使用同一业务与数据绑定；外部 CLI 保持独立进程和自身发布方式，不要求由 Memsphere 启动或托管。

Memsphere 的核心执行发生在 Agent 中；View 是可以重建的辅助入口。重启 View 不应中断 Agent 已经发起的核心任务，App 使用的权威业务数据持久化在 View 进程之外。

## View Host 与 Slot

### View Host

View Host 是 Memsphere 提供的最小浏览器运行基座，负责：

- 启动页面和稳定 Shell；
- 读取当前 Project 已解析的 View Module 组合；
- 加载每个 Module 独立编译的 View Bundle；
- 维护 Slot 注册表并组装界面；
- 提供稳定的 View SDK；
- 隔离 Module 启动和渲染故障；
- 在服务重启后协助浏览器恢复。

View Host 不承载 Memory、Run 等具体业务界面。这些界面由内置 Module 提供，业务操作通过对应接口完成。

### Slot

Slot 是 Module 明确开放的 UI 扩展位置，也是 View Host 与 Module 之间、Module 与 Module 之间的界面契约。

```text
View Host
├── Header Slots
├── Navigation Slots
├── Home Slots
├── Main View Slot
├── Overlay Slot
└── Module 声明的子 Slot
```

Slot 的所有者负责定义位置、输入和组合规则，其他 Module 只能通过公开契约注册内容。Module 可以在自己拥有的界面中继续声明子 Slot，由此形成一棵可扩展的界面树。

Slot 的名称、所有权、贡献权限与组合语义见 [Memsphere View Slot List](./view-slots.md)；View 扩展的边界和生命周期见 [Memsphere View Plugin Design](./view-plugin-design.md)；精确接口见 [Memsphere View Plugin API](./view-plugin-api.md)。

## 编译与加载

Memsphere 与用户 Module 始终分别编译：

```text
Memsphere 发布
  → 组成能力的 Host + CLI 登记 + View Host + SDK

用户开发 Module
  → 独立编译浏览器 View Bundle
  → 安装 Module
  → App 组合 Module 与其他资产
  → Project 安装 App，再按需启用并配置实例
  → Host 启动时解析并加载
```

生产环境不会把用户源码与 Memsphere 联合编译。开发工具可以监听用户源码并自动编译，但它只构建对应 Module。

CLI、DataExtension 与共享业务库或服务按各自方式构建和发布，经 App 另行引用和连接；它们不属于 Module 的编译产物。

View 扩展协议不绑定 React、Vue 或其他 UI 框架。View Host 提供框架无关的挂载、数据和回调契约；官方工具链可以优先提供 React + TypeScript 开发体验。Module 默认自行携带浏览器运行所需的 UI 框架，只依赖稳定的 View SDK。

## 安装与 Project 组装

获取、安装和启用是三个不同阶段：

- Home 获取或缓存可复用的 App 包与组件，供多个 Project 使用；缓存存在不表示 App 已安装到某个 Project；
- Project 安装 App，建立其资产与归属，记录精确版本、能力配置和数据绑定；App Memory 随安装进入该 Project，并保留所属 App 身份；
- Project 启用已安装 App，解析运行依赖并建立 CLI、Module 等入口；安装和启用状态分别记录；
- 外部 CLI 使用自己的安装方式，登记不等于安装；
- Project 内开发的本地 Module 随 Project 保存和迁移；
- Memsphere 内置 Module 的源码位于仓库根目录 `modules/`，构建后随 Memsphere 一同分发；
- 公共组件不必复制进每个 Project，但 Project 必须锁定解析版本并能报告缺失依赖；
- App 和组件升级由用户明确触发，不自动改变既有 Project；App 升级包含其所属 Memory 的版本变化，本地修改与升级的合并规则另定；
- 同一个 Module 版本的代码只加载一次，但可以创建多个 View Context、配置和注册作用域相互隔离的实例。

Home 的 View 配置仍全局生效；Project App 安装在其上叠加本 Project 启用的实例，不改写 Home 选择。安装与归属布局见 [App 实现契约](./app-contract.md)，卸载处置属于后续范围。

界面原型从创建之初就使用正式 Module 结构，可以继续完善为正式界面、锁定版本或独立发布。功能需要 CLI、业务规则或持久数据时，由 App 另行接入相应能力，并将 Module 连接到同一业务接口与数据绑定。

## 运行与重启模型

Memsphere 使用可重建的整体启动模型，不建设插件热替换生命周期：

```text
启动 Host
  → 读取当前 Project 的已安装 App 与启用状态
  → 解析 App、资产归属、能力版本、实例与数据绑定
  → 校验依赖和 CLI 环境
  → 按需加载后端与 View 运行部分
  → 建立 App 入口与组成实例

Module 更新
  → 重新编译 Module
  → 重启相关 Memsphere 服务
  → 浏览器自动刷新
  → 按相同 Project 组合重新构建
```

切换 Project 时允许整页重新加载，并根据目标 Project 重新组装 Module，不要求在原页面中动态卸载和替换整棵插件树。

View 组件仍需支持普通的挂载和卸载，用于页面切换、释放 DOM 事件和测试。这是 UI 组件生命周期，不是插件热替换生命周期。

开发模式可以把“编译 Module、重启服务、刷新浏览器”自动串联起来，但底层语义仍是完整重启。

## 无状态与数据边界

View Host 和 Module 是可丢弃的展示与交互运行时，不保存持久业务状态。服务重启后，界面必须能够根据 Project 组合和持久化的权威数据重新构建。

- 当前 Module、实例和页面位置保存在 URL 中；
- 浏览器检测到 View 服务重启后自动刷新并恢复 URL；
- 临时展开状态、悬浮状态等只属于浏览器；
- 未提交的表单草稿允许在刷新时丢失；
- 需要持久化的数据必须经 Application、Domain 和 Persistence Adapter 写入 View 之外；
- CLI 与 Module 操作同一业务时，必须使用 App 与 Project 中对应的同一数据绑定。

这一边界保证 View 可以随时重启、升级或替换，而不会丢失权威业务数据，也不会中断 Agent 中的核心运行任务。

## 故障处理

用户会频繁创建和修改原型 Module，因此一个 Module 失败不能导致整个 Memsphere View 不可用。

- Module 或 View Bundle 缺失、版本不兼容或启动失败时，只禁用对应 Module；
- Slot 注册冲突应明确指出 Module、实例和 Slot；
- Module 渲染异常由故障边界捕获；
- Stable Shell、故障诊断页和其他健康 Module 继续工作；
- 依赖故障 Module 的 Module 可以一并禁用，但不得形成静默的半启动状态；
- Persistence Adapter 故障必须显式返回，不能让 CLI 或 View 假装写入成功。

开发模式自动重启后仍保留清晰诊断，避免刷新循环掩盖真实错误。

## 信任与样式

当前信任模型只加载用户自己编写或明确安装的可信代码，不为陌生第三方 Module 提供安全沙箱。可信不代表可以依赖内部实现：Module 仍必须遵守公开的 Host、SDK、Slot 和版本契约。

Memsphere 提供主题变量和标准界面能力，帮助 Module 融入官方 Shell，但不强制 Module 采用统一视觉风格。Module 样式不得污染 Host 或其他 Module；具体样式隔离机制在 View SDK 和前端实现设计中确定。

## 专项契约

总体架构由以下专项契约细化：

1. App 定义与组装：身份、版本、自身资产、组成能力、依赖、连接关系、Project 安装与实例绑定；
2. Module Manifest 与 Runtime：界面模块的身份、兼容范围、浏览器入口、加载、实例化和故障协议；
3. CLI 登记与环境绑定：Agent 可发现的工具描述、命令入口、帮助、版本要求和上下文传递；
4. View SDK：Slot 声明与注册、Module 实例上下文、路由、主题、挂载和故障协议；
5. 业务 API：View、CLI 共享的操作接口、业务与数据绑定；
6. 数据与 Persistence 契约：Model、DataExtension、Store、权威数据、事务、迁移和实例隔离；
7. 开发工具链：开发组成能力、Mock 数据、监听编译、重启与浏览器刷新；
8. 第三方分发：签名、权限、沙箱、市场和兼容性策略；
9. App Memory 生命周期：归属、寻址、交付与升级，以及与 Project 统一读取、校验、ChangeSet 和 Run 的衔接；具体元数据、合并和卸载策略另定。

其中完整功能的身份、组成、连接关系、App Memory 归属，以及 Home 获取、Project 安装与启用边界由 [App 设计](./app-design.md) 定义；Model、DataExtension 与 Store 契约由 [数据层设计](./data-layer-design.md) 定义；界面机制由 [View Plugin Design](./view-plugin-design.md) 定义。CLI 登记与环境绑定不要求外部工具采用 CLI SDK；只有需要托管运行的适配器才需要对应 Host 契约。

所有专项契约都不得让用户扩展依赖 Memsphere 私有源码，不得把联合编译作为扩展前提，也不得让同一业务的 CLI、View 或 Persistence Adapter 绕过 Application 与 Domain 各自形成业务逻辑。
