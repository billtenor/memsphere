# Memsphere View Plugin Design

简体中文 | [English](./view-plugin-design.en.md)

本文定义 Memsphere View Plugin 的架构边界和长期设计原则，面向 ViewHost、Module Loader 和 View SDK 的维护者。扩展开发入门见 [View Plugin Guide](./view-plugin-guide.md)，精确接口见 [View Plugin API](./view-plugin-api.md)，Slot Catalog 见 [View Slot List](./view-slots.md)。

## 设计目标

- Memsphere 与用户 Module 分别编译；安装 Module 不要求 Memsphere 源码或重新编译 Memsphere。
- 官方 Module 与用户 Module 使用同一套插件入口和 Slot 协议。
- Plugin 只依赖公开 SDK，不导入 ViewHost 私有代码。
- Slot 由所有者声明，贡献方只能向已声明的 Slot 注册内容。
- 编译期类型检查与运行期校验来自同一份 Slot Contract。
- 同一 Module 版本可以创建多个隔离的实例。
- Shell 聚合区域保持统一视觉，完整 Module View 可以使用任意前端框架。
- View 可以通过重启完成 Module 安装、升级和组合变更，不建设插件热替换系统。
- View 不保存权威业务状态，浏览器或 View 服务重启后能够恢复。

## 核心模型

View Plugin 是 Module 浏览器 Bundle 的统一入口，不是页面本身，也不是独立服务。

```text
Project Composition
        ↓
ViewHost 解析 Module 实例
        ↓
动态加载每个 Module View Bundle
        ↓
为实例创建 ViewPluginContext
        ↓
调用 apply(ctx, config)
        ↓
原子提交 Route、Slot、翻译和其他注册
        ↓
根据 URL 组装并渲染 Slot Tree
```

ViewHost 负责加载、上下文、组合、故障隔离和清理；Plugin 负责声明当前 Module 实例向界面贡献什么。

## 当前落地状态

当前实现使用固定 builtin catalog 发现 `org.memsphere.memory`、`org.memsphere.run`、`org.memsphere.reference` 和 `org.memsphere.settings`，校验各自 `module.json` 的最小 View 切片、入口包内路径和 SDK SemVer，再动态加载四个独立 ESM Bundle。所有实例共享 Route/Slot Registry，但拥有独立 Context、事务、诊断和清理作用域。

已接通的 Context 服务为 `slots`、`router`、`theme` 与 `ui`。Core 与 builtin Module 通过同一 Slot Tree 组合界面，稳定 Shell、Project selector、Theme v1、UI Primitives 和故障诊断仍属于 ViewHost；准确的根 Slot 清单、所有权、组合语义与当前接线状态统一见 [Memsphere View Slot List](./view-slots.md)。View API、I18n、Logger、自定义子 Slot、用户 Module 发现/安装和 Project 动态组合仍是后续能力。

职责边界固定为五层：Shell 管区域、尺寸、滚动和响应式；Theme 管公共视觉 Token；UI Primitives 管跨 Module 通用 DOM、状态与交互；Slot 管可验证的组合关系；Feature/Module 管领域数据、行为和 `main.view` 内自由正文。标准内容列表由 UI 服务生成 `ViewMount` 后进入原有 `content.list`，不增加第二个 Slot；自定义 Mount 是复杂领域界面的受控逃生口。

Theme 与 Route/Slot 一样由 Host 形成单一真实组合路径：同一个实例作用域的 Theme 同时进入 `apply()`、`main.view`、`content.list` 和 `overlay` 的 Mount Context，并由 Host 把公开 `--mem-view-*` 变量安装到 element 与 portal root。Plugin 只能读取公开 Token，不能声明这些 Token、读取 Host 私有 `--view-*` 变量或依赖 Host 私有 class。Mount 卸载或实例回滚时，Theme root 与订阅一并清理。

## 发布与动态加载

View Plugin 随 Module 发布：

```text
Module package
├── module.json
└── dist/
    └── view/
        └── index.js
```

Manifest 的 View 切片至少声明浏览器 ESM 入口和 SDK SemVer 范围。ViewHost 必须先检查 Manifest、Module 依赖和 SDK 兼容性，再执行 Bundle。

Memsphere 编译时不知道用户以后会安装哪些 Module，因此 ViewHost 在运行时使用动态 `import()` 加载 Bundle，并从 `module.default` 取得 `ViewPlugin`。Bundle 的顶层代码在第一次导入时执行，`apply()` 随后为每个启用实例分别执行。

同一版本 Bundle 可以只加载一次，但不得用顶层变量保存实例业务状态。每个实例拥有独立的配置、Context、注册作用域和数据命名空间。

## Plugin Context 与能力声明

`ViewPluginContext` 是 Plugin 使用 Host 能力的唯一公开入口。它按职责提供：

- 当前 Project 与 Module 实例身份；
- Slot 注册；
- 稳定路由；
- Module 实例范围内的 View API；
- 国际化、主题和日志；
- 实例生命周期管理。

Plugin 使用 `inject` 声明所需的可选 Context 服务。Host 在 `apply()` 前检查服务是否存在且允许当前 Plugin 使用；未满足时禁用该实例，不让 Plugin 运行到一半才暴露依赖错误。

不开放任意 Module 间 JavaScript Service 注册。Module 间组合通过 Manifest 依赖、公开 Slot 和服务端 API 完成。

## 生命周期与清理

Plugin 注册与页面挂载是两层生命周期：

```text
Module 实例生命周期
  apply()
  ├── 注册 Route
  ├── 注册翻译
  └── 注册 Slot Entry

页面或浮层生命周期
  mount(container)
  └── 返回页面 disposer
```

所有 SDK 注册自动归属当前 Module 实例。Plugin 自己创建的 DOM listener、timer、observer 等非 SDK 资源通过 `lifecycle.own()` 纳入实例清理。

ViewHost 按注册的相反顺序执行 disposer。Disposer 必须幂等；一个清理失败不能阻止其他清理继续执行，Host 最终提供聚合诊断。

ViewHost 在以下场景清理整个 Plugin 实例：

- View 服务关闭；
- 整体切换 Project 或重新组装页面；
- `apply()` 失败后的事务回滚；
- 自动化测试结束。

页面切换只卸载对应 Mount，不等同于热替换整个 Plugin。

## Slot 所有权与组合树

Slot 是一个明确开放的 UI 扩展位置。Slot Token 同时携带：

- 稳定的 `name@version` 身份；
- `single`、`list` 或 `keyed` 组合方式；
- `shell`、`project` 或 `page` 作用域；
- `descriptor` 或 `mount` 渲染方式；
- TypeScript Value/Key 类型；
- 运行时 validator。

根 Slot 由 ViewHost 或内置 Home View 声明。Module 不能自行创建新的全局根 Slot，但可以在自己拥有的 Mount Entry 中声明子 Slot，并导出 Token 供依赖它的 Module 使用。自定义子 Slot 尚未在当前 Runtime 接线。

```text
ViewHost 根 Slot
└── Module A 的页面 Entry
    └── Module A 声明的子 Slot
        └── Module B 贡献的 Entry
```

子 Slot 随父 Entry 生命周期存在。父 Entry 卸载时，子 Slot 及其全部 Entry 递归清理；同一声明生命周期内，一个 Slot 只能有一个所有者。

三种组合方式解决不同布局问题：

- `single`：整个 Slot 选择一个最终 Entry，例如 Header 标题；
- `list`：稳定排序并同时展示多个 Entry，例如顶部操作按钮；
- `keyed`：按 key 保存多个候选，所有者激活其中一个，例如主页面和浮层。

Entry 冲突必须明确失败，不允许按加载先后静默覆盖。`order` 只控制展示顺序，不授予覆盖权限。

## Descriptor 与 Mount

公共 Shell 区域接收标准 Descriptor。Plugin 只描述文字、图标、状态、路由和 SDK 允许的 Action，由 Slot 所有者统一渲染 loading、disabled、错误、键盘操作和可访问性行为。

Descriptor 不包含任意 HTML、DOM 节点或框架 Component。这保证 Header、导航和 Home 聚合区域保持一致，并允许 Host 在不执行任意渲染代码的情况下校验和诊断内容。

完整页面、复杂浮层和 Module 自定义区域使用框架无关 Mount。Host 提供专属 DOM container 和 portal；Plugin 可以使用原生 DOM、React、Vue 或 Svelte，并返回 disposer。Plugin 不依赖 container 的父 DOM、Host 私有 class name 或全局未隔离样式。

## 路由与稳定恢复

主要页面必须拥有稳定 URL。Module 只注册实例基路径下的相对 Route，不能覆盖 Home、Memory、Run、设置或其他实例的地址。

Route Token 把同一个路由身份连接到导航 Descriptor、Header 激活条件和 `main.view` 的 keyed Entry。URL 保存当前 Project、Module 实例和页面位置，使 View 服务重启后可以重建相同界面。

## 后端与数据边界

浏览器 Bundle 不直接导入 Node.js 侧的 Domain、Application 或 Persistence Adapter，也不直接访问 Project 文件和数据库。View 需要的业务用例通过当前 Module 实例命名空间内的 View API 暴露：

```text
Module View
    ↓ ctx.api
View HTTP Adapter
    ↓
Application
    ↓
Domain
    ↓
Persistence Adapter
```

API 面向“创建客户”“获取列表”等 Application 用例，而不是逐个暴露内部函数或数据库操作。CLI 可以在 Node.js 进程中直接调用同一 Application 层，因此 View 与 CLI 共享业务规则和数据命名空间。

ViewHost 和 Module View 都是可丢弃的交互运行时。需要持久化的数据必须在 View 外写入权威存储；临时展开状态和未提交表单草稿允许在刷新时丢失。

## 启动事务与故障隔离

`apply()` 期间产生的 SDK 注册先进入当前实例事务，成功后才整体可见。失败时撤销本次启动产生的全部注册和资源，实例进入 `failed`，其他实例和稳定 Shell 继续运行。

以下问题必须在启动阶段给出包含 Module、版本、实例和契约身份的诊断：

- Bundle 缺失或无法导入；
- Manifest、依赖或 SDK 版本不兼容；
- `inject` 服务缺失；
- Slot 未声明或 Token 不兼容；
- Entry 稳定身份冲突；
- Route 越过实例边界。

单个 Descriptor Action 失败只影响该操作；单个 Entry 渲染失败只替换该 Entry。`main.view` 失败时显示可重试的局部错误页，Shell 和其他健康 Module 保持可用。

ViewHost 应提供只读诊断快照，列出实例状态、Slot 声明树、Entry 来源和失败原因；诊断入口不允许修改注册表。

## 重启模型

Module 更新的正常路径是：

```text
重新编译 Module
→ 重启 View 服务
→ 浏览器刷新
→ 按 Project Composition 重建 Plugin 实例
→ 恢复稳定 URL
```

不支持 Plugin HMR、配置变化时局部替换实例或无重启升级。开发工具可以自动串联编译、重启和刷新，但底层语义仍是完整重建。

## 版本与兼容性

View SDK 使用 SemVer：Patch 不改变公开行为，Minor 只增加向后兼容能力，Major 才能删除或改变既有契约。Host 根据 Manifest 的 SDK 范围决定是否加载，不根据运行时猜测兼容。

Slot 使用独立的 `name@version` 身份。改变 kind、scope、必填字段、Entry 选择或渲染语义必须发布新的 Slot 主版本；迁移期可以并存多个版本，贡献方必须显式选择。

公开接口至少经过一个 Minor 版本的 deprecated 周期后才能在下一个 Major 删除，诊断必须指出替代接口。

## 信任与安全边界

当前信任模型只加载用户自己编写或明确安装的可信代码，不提供恶意代码沙箱。可信 Module 仍必须：

- 只依赖公开 SDK；
- 不读取或修改 Host 私有对象和容器外 DOM；
- 不跨 Module 实例访问 API；
- 不绕过 Application 和 Domain 直接操作持久化；
- 不覆盖 Core 保留 Entry、Route、翻译 namespace 或稳定身份；
- 不把 secret 放入浏览器配置、Bundle、Descriptor 或日志。

面向陌生第三方分发前，需要另行设计签名、权限、CSP、资源配额和进程或浏览器隔离。

## 文档边界

完整 Module Manifest、CLI SDK、服务端 View API 注册、Module 配置迁移、市场、签名与沙箱由各自专项契约定义。它们必须遵守本文确定的独立编译、公开 Context、Slot 所有权、实例隔离、数据边界和整体重启模型。
