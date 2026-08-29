# Module 与 View 扩展架构

本文记录 Memsphere 个性化软件 Module 及其 View 扩展能力的长期架构基线。它描述稳定的产品边界、代码分层和系统职责，不规定当前版本必须一次性实现的全部细节。

## 背景

Memsphere 是个性化软件的运行环境。软件不再要求以传统应用的形式整体打包，也不要求从第一天起就具备完整代码：一份程序化 Memory 可以独立形成软件，一个只提供交互界面的能力也可以独立形成软件；随着使用深入，它们可以继续生长出确定性工具、领域逻辑和持久数据。

为了让这些能力能够独立开发、安装、组合和演进，Memsphere 把一个可独立成立的软件单元称为 **Module**。一个 Project 可以组装多个 Module；Module 可以由 Memsphere 官方提供，也可以由用户在安装 Memsphere 后自行开发。

Module 面向两类使用者提供入口：Agent 通过 Memory 理解软件并调用 CLI，Human 通过 View 操作和观察软件。CLI 与 View 不各自实现一套业务逻辑，而是复用 Module 的 Application 与 Domain，并最终操作同一份权威数据。

因此，用户代码不能进入 Memsphere 源码，也不能要求重新编译已经发布的 Memsphere。Memsphere 固化稳定的 Host、SDK 和组装协议，Module 则独立编译并由 Project 引入运行。

## 架构目标

- 一个 Project 可以声明和组装多个独立的 Module 实例。
- Module 可以按真实需要逐步生长出 Memory、CLI、View 和数据能力，不为形式完整而强制空实现。
- 官方 Module 与用户 Module 采用同一套发现、加载和组装机制。
- CLI 是 Agent 使用确定性能力的入口，View 是 Human 操作和观察软件的入口。
- CLI 与 View 复用 Application 和 Domain，并基于同一份权威数据工作。
- 用户安装 Memsphere 后仍可独立开发、编译、安装和组合 Module，无需重新编译 Memsphere。
- 一个 Module 既可以贡献完整页面，也可以扩展其他 Module 明确开放的局部界面。
- 原型与正式 Module 使用相同结构，可以从可交互原型直接演进为正式功能。
- View 服务不持有业务状态，可以随时重启并从 Project 配置和持久数据重新构建。
- 单个用户 Module 损坏时，基础 Shell 和其他健康 Module 仍然可用。
- Project 及其个性化软件资产可以迁移、复现和持续演进。

## 非目标

本文暂不设计：

- Module Manifest 的具体字段；
- Domain 数据模型、存储格式、迁移协议和跨 Module 数据访问规则；
- CLI、View API 和 Persistence Adapter 的具体 TypeScript API；
- 非可信第三方代码的沙箱与权限模型；
- 不重启服务的插件热替换；
- 常驻的用户后台服务。

## 核心概念及关系

### Project

Project 是个性化软件资产及其运行记录的持久空间，也是 Module 的组装边界。一个 Project 可以声明多个 Module 实例，记录每个实例使用的 Module 版本、配置和数据命名空间。

Project 不等于一个传统软件包。它可以同时容纳多个用途不同的软件，例如一套研究流程、一个客户列表和一个任务看板。

### Module

Module 是 Memsphere 中可独立开发、安装、组合和演进的软件单元。它可以包含以下能力：

- **Memory**：Agent 理解和进入软件的语义入口，保存知识、规则、结构与流程；
- **CLI**：面向 Agent 的确定性操作入口；
- **View**：面向 Human 的操作与可视化入口；
- **领域与数据能力**：由 Domain、Application 和 Persistence Adapter 共同实现，作为 CLI 与 View 的公共底座。

这些能力不要求在 Module 诞生时全部存在。只有 Memory 的 Module、只有 View 原型的 Module，都是有效的早期形态；需要确定性执行和持久状态时，再逐步补充其他部分。

### Module 实例

Module 是代码和资产定义，Module 实例是 Project 对这份 Module 的一次具体使用。

同一个 Module 版本只需安装一次，但一个 Project 可以声明多个实例。例如，同一个表格 Module 可以同时产生“客户列表”和“任务列表”两个实例。每个实例拥有稳定 ID、独立配置和独立数据命名空间。

Module 之间可以声明依赖，也可以通过公开契约相互扩展。依赖关系属于 Module 代码，实例选择和配置属于 Project；二者不能混为一体。

### Memsphere View 与 Module View

Memsphere View 是一个 Home 级通用管理界面，用于管理 Project、Memory、Run 等 Memsphere 能力；Module View 是某个个性化软件提供给 Human 的专属界面。

两者最终运行在同一个 View Host 和产品外壳中，但不是同一个产品概念。官方 Memory、Run 等界面也应作为内置 Module 的 View 能力接入，而不是依赖不可替换的业务特权。

基础 Shell、Project 切换和故障诊断属于 View Host，不允许 Module 替换。

## Module 的三层代码结构

Module 采用三个同心层次：Domain、Application 和 Adapters。

```text
module/
├── module.json                 # Module 描述文件；具体字段后续定义
├── memory/                     # 可选，面向 Agent 的语义资产
├── domain/                     # 领域模型、规则和领域所拥有的契约
├── application/                # 用例编排和应用层所拥有的契约
└── adapters/                   # 外圈适配器
    ├── cli/                    # Agent 的确定性入口
    ├── view/                   # Human 的界面、静态资源及 View API 入口
    └── persistence/            # 文件、数据库或远程存储实现
```

目录按能力渐进出现，不要求为空缺能力创建占位目录。`cli`、`view` 和 `persistence` 是三类 Adapter，不是三个新的架构层。

### Domain

Domain 保存不依赖界面、命令行和具体存储技术的领域模型与业务规则。只有领域本身拥有的边界契约才放在 Domain，例如领域需要的 Repository 或领域服务接口。

### Application

Application 把 Domain 能力编排成可执行用例，负责事务边界、权限检查和跨领域步骤协调。CLI 与 View 面向同一组用例工作，避免复制业务规则。

如果某个契约只服务于应用用例而不是领域本身，它由 Application 定义。

### Adapters

Adapters 位于同一个外圈，从不同方向连接 Module 与外部世界：

- CLI Adapter 把 Agent 发起的确定性命令转换成 Application 调用；
- View Adapter 把 Human 的界面操作转换成 Application 调用，并把结果呈现为浏览器界面；
- Persistence Adapter 实现 Domain 或 Application 拥有的持久化契约，把权威数据保存到具体介质。

浏览器 Bundle 不能直接导入只在 Node.js 中运行的 Application 与 Domain。View Adapter 因此可以同时包含独立编译的浏览器界面和 Node.js 侧的 HTTP/API 入口：

```text
Agent
  → CLI Adapter
  → Application
  → Domain
  → Persistence Adapter
  → 权威数据

Human
  → 浏览器 View Bundle
  → View API Adapter
  → Application
  → Domain
  → Persistence Adapter
  → 同一份权威数据
```

具体传输协议后续定义，但不能让浏览器直接访问数据库，也不能让 CLI 和 View 各自维护独立业务状态。

### 依赖方向与契约归属

静态依赖始终指向内层：

```text
adapters → application → domain
```

依赖倒置不要求单独建立 `ports/` 目录。契约写在拥有需求的内层，并与相关领域能力或应用用例放在一起：

- Domain 与 Application 的边界契约由 Domain 定义；
- Application 暴露给 CLI/View 的用例契约由 Application 定义；
- Persistence Adapter 需要实现的契约，根据需求所有者放在 Domain 或 Application；
- Adapter 不反向要求内层实现由 Adapter 定义的业务接口。

Port 是边界契约，不是第四个架构层。防腐层负责外部模型与内部模型之间的翻译，通常属于 Adapter，也不等同于 Port。

## 总体运行结构

```text
Memsphere
├── Module Composition Resolver
├── CLI Host
└── View Host
    ├── Boot Page
    ├── Stable Shell
    ├── Bundle Loader
    ├── Slot Registry / Renderer
    ├── View SDK
    └── Failure Boundary

Project
├── Module Instance A
│   ├── Memory
│   ├── CLI Adapter
│   ├── View Adapter
│   └── Domain / Application / Persistence
├── Module Instance B
└── Module Instance C
```

Composition Resolver 根据 Project 声明解析 Module 版本、依赖、实例配置和数据命名空间。CLI Host 和 View Host 使用同一份解析结果，但可以拥有不同的进程生命周期。

Memsphere 的核心执行发生在 Agent 中；View 是可以重建的辅助入口。重启 View 不应中断 Agent 已经发起的核心任务，Module 的持久业务状态也不能只存在于 View 进程中。

## View Host 与 Slot

### View Host

View Host 是 Memsphere 提供的最小浏览器运行基座，负责：

- 启动页面和稳定 Shell；
- 读取当前 Project 的 Module 组合；
- 加载每个 Module 独立编译的 View Bundle；
- 维护 Slot 注册表并组装界面；
- 提供稳定的 View SDK；
- 隔离 Module 启动和渲染故障；
- 在服务重启后协助浏览器恢复。

View Host 不承载 Memory、Run 等具体业务功能。这些功能由内置 Module 的 View Adapter 提供。

### Slot

Slot 是 Module 明确开放的 UI 扩展位置，也是 View Host 与 Module 之间、Module 与 Module 之间的界面契约。

```text
View Host
└── Root Slot
    ├── Navigation Slot
    ├── Page Slot
    ├── Toolbar Slot
    └── Module 声明的子 Slot
```

Slot 的所有者负责定义位置、输入和组合规则，其他 Module 只能通过公开契约注册内容。Module 可以在自己拥有的界面中继续声明子 Slot，由此形成一棵可扩展的界面树。

长期 Slot 模型需要支持单一内容、列表内容、按键选择和按条件选择等组合方式；具体类型及 API 在 View SDK 设计中确定。

## 编译与加载

Memsphere 与用户 Module 始终分别编译：

```text
Memsphere 发布
  → Module Host 能力 + CLI Host + View Host + SDK

用户开发 Module
  → 独立编译 Node.js 运行部分
  → 独立编译浏览器 View Bundle（如果存在 View）
  → 安装 Module
  → Project 声明 Module 实例
  → Host 启动时解析并加载
```

生产环境不会把用户源码与 Memsphere 联合编译。开发工具可以监听用户源码并自动编译，但它只构建对应 Module。

View 扩展协议不绑定 React、Vue 或其他 UI 框架。View Host 提供框架无关的挂载、数据和回调契约；官方工具链可以优先提供 React + TypeScript 开发体验。Module 默认自行携带浏览器运行所需的 UI 框架，只依赖稳定的 View SDK。

## 安装与 Project 组装

安装和启用是两个概念：

- 公共 Module 可以安装到用户级 Module 仓库，被多个 Project 复用；
- Project 记录启用的 Module、实例、精确版本和实例配置；
- Project 内开发的本地 Module 随 Project 保存和迁移；
- 公共 Module 不必复制进每个 Project，但 Project 必须锁定版本并能报告缺失依赖；
- 公共 Module 升级由用户明确触发，不自动改变既有 Project；
- 同一个 Module 版本的代码只加载一次，但可以创建多个配置和数据相互隔离的实例。

原型从创建之初就使用正式 Module 结构。原型完成后可以原地补充 Domain、Application、CLI 或 Persistence，锁定版本或独立发布，不需要迁移到另一套工程。

## 运行与重启模型

Memsphere 不采用 DSH 那种为热更新设计的复杂插件生命周期。它使用可重建的整体启动模型：

```text
启动 Host
  → 读取当前 Project 组合
  → 解析 Module、版本和实例
  → 加载 Module 运行部分
  → 注册 CLI 与 View 能力
  → 创建 Module 实例

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

View Host 和 Module 的 View Adapter 是可丢弃的展示与交互运行时，不保存持久业务状态。服务重启后，界面必须能够根据 Project 组合和持久化的权威数据重新构建。

- 当前 Module、实例和页面位置保存在 URL 中；
- 浏览器检测到 View 服务重启后自动刷新并恢复 URL；
- 临时展开状态、悬浮状态等只属于浏览器；
- 未提交的表单草稿允许在刷新时丢失；
- 需要持久化的数据必须经 Application、Domain 和 Persistence Adapter 写入 View 之外；
- CLI 与 View 对同一 Module 实例的操作必须落到相同的数据命名空间。

这一边界保证 View 可以随时重启、升级或替换，而不会丢失 Module 状态，也不会中断 Agent 中的核心运行任务。

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

当前阶段只加载用户自己编写或明确安装的可信代码，不为陌生第三方 Module 提供安全沙箱。可信不代表可以依赖内部实现：Module 仍必须遵守公开的 Host、SDK、Slot 和版本契约。

Memsphere 提供主题变量和标准界面能力，帮助 Module 融入官方 Shell，但不强制 Module 采用统一视觉风格。Module 样式不得污染 Host 或其他 Module；具体样式隔离机制在 View SDK 和前端实现设计中确定。

## 与 DSH 的关系

本架构参考 DeepSeek Harness 的微内核和客户端组合思想。

采用的原则：

- 产品功能通过插件式 Module 组合，而不是修改特权核心；
- 官方 Module 与扩展 Module 使用同一机制；
- Module 代码与 Module 实例分离，同一份代码可以承担多个配置角色；
- 浏览器 Bundle 独立编译，由 Host 发现和加载；
- UI 通过类型化 Slot 形成组合树；
- Slot 只能由所有者声明，其他 Module 通过公开契约贡献内容。

刻意不采用的部分：

- 为长时间运行 Session 服务的插件热更新；
- 每一项注册都必须可逆的 effect 系统；
- 配置变化触发的动态插件树卸载和重挂载；
- 为卸载、依赖丢失和热替换设计的精细停稳协议。

DSH 不能轻易重启，是因为重启可能中断大量正在运行的 Session。Memsphere 的核心运行发生在 Agent 中，View 只是可重建的辅助入口，因此整体重启是更适合 Memsphere 的复杂度选择。持久业务状态属于 Module 的数据能力，不属于 View 进程。

## 后续设计

在本架构基线上，后续文档应依次明确：

1. Module Manifest：Module 身份、版本、Memory、Node.js 入口、View Bundle、静态资源、SDK 兼容范围和依赖声明；
2. Module Runtime：Module 发现、依赖解析、加载、实例化、CLI/View 注册和故障协议；
3. Project Composition：本地 Module、公共 Module、实例配置、数据命名空间和版本锁文件；
4. View SDK：Slot 声明与注册、Module 实例上下文、路由、主题、挂载和故障协议；
5. CLI SDK：Agent 可发现的命令描述、参数、输出和 Module 实例选择协议；
6. Persistence 契约：权威数据、Repository、事务、迁移和实例隔离；
7. 开发工具链：创建 Module、Mock 数据、监听编译、重启与浏览器刷新；
8. 第三方分发：签名、权限、沙箱、市场和兼容性策略。

在这些细节确定前，实现不得让用户 Module 依赖 Memsphere 私有源码，不得把联合编译作为扩展前提，也不得让 CLI、View 或 Persistence Adapter 绕过 Application 与 Domain 各自形成业务逻辑。
