# Memsphere View Plugin API

简体中文 | [English](./view-plugin-api.en.md)

本文是 `@memsphere/view-sdk` 与 ViewHost 的规范性 API 参考，面向实现 SDK、Host 和 Module View 的开发者。它只记录公开类型、方法和运行时契约。

第一次开发 Plugin 请先阅读 [View Plugin Guide](./view-plugin-guide.md)；需要可复制的控件示例见 [View 公共控件使用手册](./view-ui-primitives.md)；架构边界见 [View Plugin Design](./view-plugin-design.md)；内置 Slot 名称和产品语义见 [View Slot List](./view-slots.md)。

本文定义长期公开接口，并在下方明确当前运行支持范围。新增能力时直接更新对应接口、实现状态和约束；文中的“必须”“不得”是兼容性要求，“建议”是默认工程选择。

## 当前实现状态

当前 ViewHost 已实现 Plugin 默认入口、`apiVersion: 1`、`apply()`、Module 实例身份、`lifecycle`、最小 Manifest 校验、SDK SemVer 检查、独立 Bundle 动态加载、Router、Slot Token/Registry、实例级注册事务，以及 Mount 的回滚和清理。浏览器通过 import map 将 `@memsphere/view-sdk` 解析到 Host 提供的 SDK。

当前可注入服务为 `slots`、`router`、`theme` 和 `ui`；根 Slot 的完整清单、产品语义和当前接线状态统一见 [View Slot List](./view-slots.md)。部分聚合 Slot 支持下文定义的受限 live `upsert()`，页面浮层支持 Host 管理的背景 Route 投影与局部故障边界。四个 builtin Module 均使用同一公开入口和独立 Bundle 运行。View API、I18n、Logger、自定义子 Slot、用户 Module 发现/安装和 Project 动态组合仍未接线；Plugin 请求尚未提供的服务会在 `apply()` 前明确失败。

## Module View 入口契约

View Plugin 是 Module 浏览器 Bundle 的默认导出。Manifest 的最小 View 切片为：

```json
{
  "schemaVersion": 1,
  "id": "com.example.customer-list",
  "version": "1.2.0",
  "view": {
    "entry": "./dist/view/index.js",
    "sdk": "^1.0.0"
  }
}
```

| 字段 | 契约 |
| --- | --- |
| `schemaVersion` | Module Manifest 结构版本，不等同于 SDK 版本 |
| `id` | Module 代码身份；实例另有稳定 `instanceId` |
| `version` | Module 包版本 |
| `view.entry` | Module 包内的 ESM 浏览器入口，不得越出包目录 |
| `view.sdk` | 编译目标兼容的 `@memsphere/view-sdk` SemVer 范围 |

ViewHost 必须在执行 Bundle 前检查兼容范围。不兼容时只禁用对应 Module 实例，并给出可定位诊断。

## 公共基础类型

```ts
export type MaybePromise<T> = T | Promise<T>;
export type Disposer = () => void | Promise<void>;
```

`MaybePromise<T>` 允许接口同步返回 `T` 或异步返回 `Promise<T>`。Host 可以统一使用 `await` 消费两种结果。

`Disposer` 撤销一次注册或清理一项资源。Disposer 必须幂等，多次调用与调用一次的最终结果相同。

## ViewPlugin

```ts
export interface ViewPlugin<Config = unknown> {
  /** 诊断名称，不作为 Module 身份。 */
  readonly name?: string;

  /** 当前接口主版本固定为 1。 */
  readonly apiVersion: 1;

  /** apply 前必须存在、并允许本 Plugin 访问的 Context 服务。 */
  readonly inject: readonly ViewServiceName[];

  /** 每个启用的 Module 实例调用一次。 */
  apply(
    context: ViewPluginContext,
    config: Readonly<Config>,
  ): MaybePromise<void | Disposer>;
}

export function defineViewPlugin<Config>(
  plugin: ViewPlugin<Config>,
): ViewPlugin<Config>;
```

Bundle 必须默认导出一个 `ViewPlugin`：

```ts
import { defineViewPlugin } from "@memsphere/view-sdk";

export default defineViewPlugin({
  name: "customer-list-view",
  apiVersion: 1,
  inject: ["slots", "router"],

  apply(ctx, config) {
    // 注册当前 Module 实例的 View 能力
  },
});
```

`defineViewPlugin()` 是类型辅助函数，输入和返回同一个 Plugin 对象。SDK 不同时支持函数、构造器和其他 Plugin 入口形式。

调用契约：

- ViewHost 为每个启用的 Module 实例创建独立 Context，并分别调用 `apply()`；
- 同一 ESM Bundle 可以只导入一次，Bundle 顶层状态由同版本全部实例共享，不得保存实例业务状态；
- `apply()` 成功后实例进入 `active`；抛错或返回拒绝 Promise 时进入 `failed`；
- `apply()` 返回的 disposer 自动纳入实例生命周期；
- 一个实例失败不得阻止 Shell 和其他健康实例启动。

## ViewPluginContext

```ts
export type ViewServiceName =
  | "slots"
  | "router"
  | "api"
  | "i18n"
  | "theme"
  | "logger";

export interface ViewPluginContext {
  readonly module: Readonly<ModuleInstanceContext>;
  readonly slots: SlotRegistry;
  readonly router: ViewRouter;
  readonly api: ViewApiClient;
  readonly i18n: ViewI18n;
  readonly theme: ViewTheme;
  readonly logger: ViewLogger;
  readonly lifecycle: ViewLifecycle;
}

export interface ModuleInstanceContext {
  readonly projectId: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly instanceId: string;
}
```

`module` 和 `lifecycle` 是每个 Plugin 必有的基础上下文。其他服务必须出现在 `inject` 中；Host 在 `apply()` 前检查服务可用性，访问未声明服务必须失败。

正式 SDK 的 `defineViewPlugin()` 应根据 `inject` 字面量收窄 `apply()` 的 Context 类型。上面的 `ViewPluginContext` 是 Host 提供的完整接口集合。

Context 由 ViewHost 创建。Module 不得自行构造 Context、跨实例缓存 Context，或通过 Context 注册任意 Module 间 JavaScript Service。

## ViewLifecycle

```ts
export interface ViewLifecycle {
  /** 把非 SDK 资源纳入当前 Module 实例的清理范围。 */
  own(disposer: Disposer): Disposer;

  /** 当前实例是否已经开始清理。 */
  readonly disposed: boolean;
}
```

所有 SDK 注册方法必须自动归属当前 Module 实例。只有 Plugin 自行创建的 DOM listener、timer、observer 等非 SDK 资源需要显式传给 `own()`。

Host 清理实例时：

- 按注册的相反顺序执行 disposer；
- 一个 disposer 失败不能阻止其他 disposer；
- 清理结束后以聚合诊断报告全部失败；
- `disposed` 一旦变为 `true`，不得恢复为 `false`。

## Slot Token

### 类型定义

```ts
export type SlotKind = "single" | "list" | "keyed";
export type SlotScope = "shell" | "project" | "page";
export type SlotRenderMode = "descriptor" | "mount";

export interface SlotDefinition<
  Name extends string,
  Kind extends SlotKind,
  Value,
> {
  readonly name: Name;
  readonly version: 1;
  readonly kind: Kind;
  readonly scope: SlotScope;
  readonly render: SlotRenderMode;
  /** 允许实例在 apply 提交后更新自己的 Entry。 */
  readonly live?: boolean;

  /** 所有者提供的运行时值校验。 */
  validate(value: unknown): value is Value;
}

export interface SlotToken<
  Name extends string,
  Kind extends SlotKind,
  Value,
  Key extends string = never,
> {
  readonly definition: SlotDefinition<Name, Kind, Value>;

  /** 只保存编译期 Value 与 Key，不出现在运行时对象中。 */
  readonly __types?: { readonly value: Value; readonly key: Key };

  /** 防止不同包伪造同名结构类型。 */
  readonly __slotToken: unique symbol;
}

export function defineSlot<Value, Key extends string = never>(): <
  Name extends string,
  Kind extends SlotKind,
>(
  definition: SlotDefinition<Name, Kind, Value>,
) => SlotToken<Name, Kind, Value, Key>;
```

Slot Token 的 `name@version` 是运行时契约身份。Host 必须拒绝：

- 同名同版本但定义不同的 Token；
- 向尚未声明的 Slot 注册 Entry；
- validator 拒绝的 Value；
- Host 不支持的 Slot kind 或版本。

TypeScript 类型不能替代运行时校验。内置 Token 的 validator 由 SDK 提供；自定义 Descriptor Slot 的所有者必须导出 validator；自定义 Mount Slot 可以复用 SDK 的 `isViewMount`。

### 内置 Token

```ts
import { slots } from "@memsphere/view-sdk";

slots.headerTitle;
slots.navigationSecondary;
slots.contentList;
slots.searchProviders;
```

SDK 通过 `slots` 导出当前 Catalog 中的根 Token。完整导出清单、所有者和内容语义只在 [View Slot List](./view-slots.md) 维护；上面只展示访问方式，不构成第二份 Catalog。

### Slot kind

```ts
single  // 整个 Slot 同一时刻选择一个 Entry
list    // 按 order 和稳定身份同时展示多个 Entry
keyed   // 保存多个 key 的 Entry，由所有者激活某个 key
```

当前支持这三种 kind。新增 kind 属于 SDK Minor 扩展；旧 Host 遇到不支持的 kind 必须拒绝加载 Slot 所有者，不得猜测降级。

### 声明自定义子 Slot

根 Slot 由 ViewHost 或内置 Home View 声明。Module 只能在自己拥有的 Mount Entry 中声明子 Slot；当前 Runtime 尚未接线自定义子 Slot：

```ts
export const customerDetailActions = defineSlot<HeaderActionDescriptor>()({
  name: "com.example.customer-list/detail.actions",
  version: 1,
  kind: "list",
  scope: "page",
  render: "descriptor",
  validate: isHeaderActionDescriptor,
} as const);
```

子 Slot 名称必须以所有者 Module id 为前缀。所有者包必须导出 Token；贡献方必须在 Module Manifest 中声明对所有者 Module 的兼容依赖。

所有者通过父 Entry 的 `children` 声明子 Slot：

```ts
ctx.slots.register(slots.mainView, {
  id: "customer-list.page",
  key: customerRoute.key,
  children: [customerDetailActions],
  value: customerListMount,
});
```

声明即取得生命周期内的唯一所有权。父 Entry 卸载时，子 Slot 及其中全部 Entry 必须递归清理。

## SlotRegistry

```ts
type AnySlotToken = SlotToken<string, SlotKind, unknown, string>;

type SlotValue<S extends AnySlotToken> =
  S extends SlotToken<any, any, infer Value, any> ? Value : never;

type SlotKey<S extends AnySlotToken> =
  S extends SlotToken<any, any, any, infer Key> ? Key : never;

type SingleOrListSlotToken =
  SlotToken<string, "single" | "list", unknown, never>;

type KeyedSlotToken =
  SlotToken<string, "keyed", unknown, string>;

export interface RegisterOptions<Value> {
  /** 当前 Module 实例内稳定且唯一。 */
  readonly id: string;
  readonly value: Value;
  readonly order?: number;
  readonly children?: readonly AnySlotToken[];
  readonly when?: RouteActivation;
}

export interface KeyedRegisterOptions<Value, Key extends string>
  extends RegisterOptions<Value> {
  readonly key: Key;
}

export interface SlotRegistry {
  register<S extends SingleOrListSlotToken>(
    slot: S,
    options: RegisterOptions<SlotValue<S>>,
  ): Disposer;

  register<S extends KeyedSlotToken>(
    slot: S,
    options: KeyedRegisterOptions<SlotValue<S>, SlotKey<S>>,
  ): Disposer;

  upsert<S extends typeof slots.navigationSecondary | typeof slots.headerTitle | typeof slots.headerActions | typeof slots.homeAttention | typeof slots.homeContinue>(
    slot: S,
    options: RegisterOptions<SlotValue<S>>,
  ): Disposer;
}
```

`register()` 必须同步完成 Token、Value、身份和所有权校验；失败时不得留下部分注册。成功返回的 disposer 撤销当前 Entry，并由 SDK 自动纳入实例生命周期。

`upsert()` 只用于标记为 `live` 的 Slot，当前为 `navigation.secondary`、`header.title`、`header.actions`、`home.attention` 和 `home.continue`。页面 Mount 可以据已加载内容更新二级导航数量、当前对象标题和页面级操作，并须在卸载时撤销这些 Entry。它在 `apply()` 成功提交后可调用，以当前 Module 实例内的 `id` 原子新增或替换 Entry。每次成功更新产生新的 epoch lease；旧 disposer 不得删除更新后的 Entry，实例清理仍会撤销全部 live Entry。

Entry 的运行时身份为：

```text
moduleId + moduleVersion + instanceId + slot(name@version) + id [+ key]
```

冲突规则：

- `single`：相同优先级存在多个 Entry 时失败，不静默覆盖；
- `list`：同一 Module 实例内 `id` 重复时失败；
- `keyed`：同一 `key` 存在多个同优先级 Entry 时失败；
- `order` 只影响展示顺序，不决定覆盖关系；相同 `order` 使用稳定身份排序；
- Core 保留 Entry 使用 Module 不可占用的优先级区间；不向用户 Module 开放任意 `priority`。

## Descriptor 类型

Descriptor Slot 接收可检查的标准数据，由 Slot 所有者统一渲染。除 SDK 明确定义的 Action 字段外，Descriptor 不得包含回调，也不得包含框架 Component、DOM 节点或 HTML 字符串。

`IconRef.kind: "system"` 的稳定图标名为：`archive`、`arrow-right`、`arrows-clockwise`、`brain`、`caret-down`、`check-circle`、`circle-fill`、`clock-counter-clockwise`、`code`、`cube`、`file-text`、`folder`、`gear-six`、`house`、`magnifying-glass`、`play-circle`、`plus`、`seal-check`、`sliders-horizontal`、`sparkle`、`stack`、`storefront`、`user`、`warning-circle`、`x`。兼容别名 `memory`、`search`、`settings`、`gear`、`play`、`run` 会映射到相应稳定名称；未知名称防御性回退为 `stack`。

```ts
export type TextRef =
  | { readonly text: string }
  | {
      readonly key: string;
      readonly params?: Readonly<Record<string, string | number>>;
    };

export type IconRef =
  | { readonly kind: "system"; readonly name: string }
  | { readonly kind: "asset"; readonly url: string; readonly alt: TextRef };

export interface ActionDescriptor {
  readonly label: TextRef;
  readonly icon?: IconRef;
  readonly disabled?: boolean;
  readonly run: () => MaybePromise<void>;
}

export interface NavigationItemDescriptor {
  readonly label: TextRef;
  readonly icon: IconRef;
  readonly route: RouteTarget;
  readonly badge?: TextRef;
}

export type SecondaryNavigationItemDescriptor = Readonly<{
  id: string;
  label: TextRef;
  icon: IconRef;
  badge?: TextRef;
  selected: boolean;
} & (
  | { route: RouteTarget; action?: never }
  | { route?: never; action: ActionDescriptor }
)>;

export interface SecondaryNavigationDescriptor {
  readonly title: TextRef;
  readonly icon: IconRef;
  readonly settings?: ActionDescriptor;
  readonly items: readonly SecondaryNavigationItemDescriptor[];
  readonly footer?: TextRef;
}

export interface SearchProviderDescriptor {
  readonly label: TextRef;
  readonly icon: IconRef;
  search(request: { readonly query: string; readonly signal: AbortSignal }):
    MaybePromise<readonly SearchResultDescriptor[]>;
}

export interface SearchResultDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly type: TextRef;
  readonly icon?: IconRef;
  readonly route: RouteTarget;
}

export interface AttentionItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly source?: TextRef;
  readonly icon?: IconRef;
  readonly status: "info" | "warning" | "error";
  readonly updatedAt?: string;
  readonly action: ActionDescriptor;
}

export interface ContinueItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly icon?: IconRef;
  readonly updatedAt?: string;
  readonly route: RouteTarget;
}
```

固定界面文案建议使用 Module 翻译 key。用户数据和技术标识可以使用 `{ text }` 原样展示。Host 负责标准 Action 的 loading、disabled、错误反馈、键盘操作和可访问性基础行为。

每个内置 Slot 的专属 Descriptor 由 SDK 与 [View Slot List](./view-slots.md) 共同定义。

## ViewMount

```ts
export interface ViewMount {
  mount(
    target: ViewMountTarget,
    context: ViewRenderContext,
  ): MaybePromise<void | Disposer>;

  /** 同一个 Mount 在相关 Route 间复用时，接收新的路由上下文。 */
  update?(context: ViewRenderContext): MaybePromise<void>;
}

export interface ViewMountTarget {
  /** Host 提供且只属于当前 Entry 的挂载容器。 */
  readonly element: HTMLElement;

  /** Host 管理的浮层出口；Module 不直接操作 document.body。 */
  readonly portal: HTMLElement;
}

export interface ViewRenderContext {
  readonly module: Readonly<ModuleInstanceContext>;
  readonly route: Readonly<RouteLocation>;
  readonly api: ViewApiClient;
  readonly i18n: ViewI18n;
  readonly theme: ViewTheme;
  readonly logger: ViewLogger;
}
```

运行契约：

- Host 在 Entry 激活后创建独占 `element` 并调用 `mount()`；
- 多个相关 Route 可以注册同一个 `ViewMount`。切换这些 Route 时，Host 优先调用可选的 `update()` 并保留已有容器、状态与资源；未实现 `update()` 时仍按停用与重新挂载处理；
- `update()` 只更新当前视图，不创建新的资源生命周期；原 `mount()` 返回的 disposer 仍在最终停用时调用；
- Module 可以使用原生 DOM、React、Vue、Svelte 或其他浏览器框架；
- 返回的 disposer 在 Entry 停用或容器销毁前调用；
- Module 不得修改 Host 容器外 DOM，不得假定 `element` 的父结构；
- Module 不得直接操作 `document.body`，浮层使用 `portal` 或 `overlay` Slot；
- Module 使用 Theme Token 和自身作用域样式，不依赖 Host 私有 class name；
- Host 保留未来使用 Shadow DOM 或其他隔离容器的权利。

## ViewRouter

```ts
export interface RouteDefinition {
  readonly id: string;
  readonly path: string;
  readonly query?: readonly string[];
}

export interface RouteLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly routeKey?: string;
  readonly projected?: true;
}

export interface RouteTargetOptions {
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly hash?: string;
}

export interface RouteToken {
  readonly key: string;
  readonly activation: RouteActivation;
  to(params?: Readonly<Record<string, string>>, options?: RouteTargetOptions): RouteTarget;
}

export interface RouteProjectionOptions {
  readonly from: RouteToken;
  readonly to: RouteToken;
  /** 目标参数名 -> 来源参数名。 */
  readonly params: Readonly<Record<string, string>>;
  /** 目标 query key -> 来源 query key。 */
  readonly query?: Readonly<Record<string, string>>;
  readonly hash?: "discard" | "preserve";
}

export interface ViewRouter {
  register(definition: RouteDefinition): RouteToken;
  project(options: RouteProjectionOptions): RouteProjection;
  navigate(target: RouteTarget): Promise<void>;
  readonly location: RouteLocation;
}
```

`RouteLocation.query` 是 Host 按当前 Route allowlist 解析并冻结的键值映射。`to()` 只接受 Route 已声明的 query key；`undefined` 表示省略。`project()` 的 query 映射只复制显式声明且当前存在的值，hash 默认丢弃。Overlay 的关闭、Escape 与 backdrop 由 Host 使用 replace 完成；公开的 `navigate()` 始终使用 push。

`RouteActivation`、`RouteTarget`、`RouteProjection` 和 `RouteLocation` 是由 SDK 定义、Host 创建的路由值。Plugin 不得伪造这些对象。`project()` 用于 keyed `overlay`：它把浮层 Route 的参数映射到同一 Module 实例拥有的背景页面 Route；跨实例、缺少目标参数或未知参数必须失败。背景 Mount 收到的 `RouteLocation.projected` 为 `true`，应将其视为被动背景，不主动重写当前浮层 URL。

Module Route 必须位于实例基路径下：

```text
/projects/:projectId/modules/:instanceId/...
```

Plugin 在 `path` 中填写相对路径，Host 生成完整路径。Plugin 不得覆盖 Home、Memory、Run、设置或其他实例的绝对路径。

```ts
const route = ctx.router.register({ id: "index", path: "/" });

ctx.slots.register(slots.navigationPrimary, {
  id: "navigation",
  value: {
    label: { key: "navigation.title" },
    icon: { kind: "system", name: "users" },
    route: route.to(),
  },
});

ctx.slots.register(slots.headerTitle, {
  id: "title",
  when: route.activation,
  value: { title: { key: "page.title" } },
});

ctx.slots.register(slots.mainView, {
  id: "page",
  key: route.key,
  value: customerListMount,
});
```

`when` 只接受 Host 创建的 Route Activation，不接受任意回调函数。Route 注册自动归属当前 Plugin 实例生命周期。

## ViewApiClient

```ts
export interface ViewApiClient {
  request<Response>(request: {
    readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | boolean>>;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
  }): Promise<Response>;
}
```

请求契约：

- `path` 是当前 Module 实例 API namespace 内的相对路径；
- Host 自动加入当前 Project、Module 和实例身份，Plugin 不得伪造其他实例；
- 服务端 View API Adapter 把请求转换为 Application 用例调用；
- 服务端必须执行权限、输入和输出校验；
- 错误包含稳定错误码与可本地化摘要，原始堆栈只进入诊断日志。

浏览器 Bundle 不得直接导入 Node.js 侧 Domain、Application 或 Persistence Adapter，也不得直接访问 Project 文件或数据库。

## ViewI18n

```ts
export interface ViewI18n {
  readonly locale: "zh-CN" | "en";

  register(
    namespace: string,
    messages: {
      readonly "zh-CN": Readonly<Record<string, string>>;
      readonly en: Readonly<Record<string, string>>;
    },
  ): ViewMessageNamespace;
}

export interface ViewMessageNamespace {
  text(
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ): TextRef;

  /** 提前撤销命名空间；实例清理时也会自动撤销。 */
  dispose(): void;
}
```

Module 必须同时提供 `zh-CN` 和 `en` 的固定可见文案。`namespace` 必须以 Module id 开头；Host 拒绝覆盖 Core 或其他 Module namespace。

## ViewUi v1

Plugin 同时声明 `inject: ["ui"]` 与 `uiVersion: 1` 后，`context.ui` 可用；只声明其中一项或 Host 不支持该版本会在 `apply()` 前失败。UI 服务是 Host-owned、领域无关的 Primitive 工厂，不注册 Slot，也不读取业务数据。

```ts
export interface ViewUi {
  readonly version: 1;
  contentList(source: ContentListDescriptor | ContentListProvider): ViewMount;
  button(action: ActionDescriptor, options?: { tone?: "default" | "primary" | "danger" }): HTMLButtonElement;
  confirmButton(action: ActionDescriptor, confirmation: ConfirmationDescriptor, options?: { tone?: "default" | "primary" | "danger" }): HTMLButtonElement;
  iconButton(action: ActionDescriptor): HTMLButtonElement;
  badge(value: TextRef | BadgeDescriptor): HTMLElement;
  emptyState(empty: ContentListEmptyDescriptor): HTMLElement;
  feedback(value: FeedbackDescriptor): HTMLElement;
  tabs(value: TabsDescriptor): HTMLElement;
  segmentedControl(value: SegmentedControlDescriptor): HTMLElement;
  disclosure(value: DisclosureDescriptor): ViewMount;
  textField(value: TextFieldDescriptor): FieldHandle<HTMLInputElement>;
  searchField(value: TextFieldDescriptor): FieldHandle<HTMLInputElement>;
  textareaField(value: TextFieldDescriptor): FieldHandle<HTMLTextAreaElement>;
  checkboxField(value: CheckboxFieldDescriptor): FieldHandle<HTMLInputElement>;
  select(value: SelectDescriptor): FieldHandle<HTMLSelectElement>;
  combobox(value: ComboboxDescriptor): ComboboxHandle;
  progress(value: ProgressDescriptor): HTMLElement;
  card(value: ContainerDescriptor): ViewMount;
  section(value: ContainerDescriptor): ViewMount;
  confirm(value: ConfirmationDescriptor): Promise<boolean>;
}
```

UI v1 覆盖动作与确认、徽标与反馈、Tabs/Segmented、Disclosure、受控表单、Select/Combobox、Progress、Card/Section 和标准 Content List。文本字段必须由 Module 提供 `value`，Checkbox 必须提供 `checked`；字段句柄的 `update()` 保持 control 节点稳定，适用于焦点、选区和 IME composition。`ComboboxHandle` 同样提供 `updateDescriptor(descriptor)`，供 Module 在输入过滤或选择后提交新的受控 `query/value/options`，并保持输入节点、焦点和弹层状态。`ConfirmationDescriptor.closeLabel` 可为右上角关闭按钮提供无障碍文案；`confirm()` 在确认时返回 `true`，取消、Escape 或关闭返回 `false`；`confirmButton()` 的异步 Action 失败时保留弹窗并显示内联错误。

所有公开 UI 工厂都会在运行期校验 Descriptor；Action、系统图标、状态或内容契约非法时立即明确失败，不静默替换图标或渲染部分结果。

`contentList()` 覆盖 section 分组、三行文本、多 Badge、selected、route/action、尾部操作、禁用、展开详情、filter，以及 loading/empty/error + retry。它返回普通 `ViewMount`，由 Module 注册到现有 `slots.contentList`，因此沿用原 Slot 的 single 冲突、Route scope、挂载和 dispose 语义。需要画布、编辑器或其他异构列表时仍可提交自定义 Mount。Descriptor/provider 非法时当前 Mount 明确失败，不回退或渲染部分数据。

## ViewTheme

```ts
export interface ViewTheme {
  readonly version: 1;
  readonly mode: "light" | "dark";
  readonly tokens: Readonly<Record<ViewThemeToken, string>>;
  subscribe(listener: () => void): Disposer;
}
```

声明 `inject: ["theme"]` 的 Plugin 必须同时声明 `themeVersion: 1`；只声明其中一项会在 `apply()` 前失败。Theme v1 当前提供 light mode，Token 覆盖语义颜色、字体与字号阶梯、行高、间距、圆角、阴影、动效、层级和内容几何。`viewThemeCssVariables` 给出每项到 `--mem-view-*` 的稳定映射，精确键集合以 SDK 类型为唯一来源。

Theme Token 是稳定视觉接口；Host 私有 CSS class 和 `--view-*` 变量不是接口。ViewHost 把同一个只读 Theme 放入 Plugin Context 与所有 Mount Context，并把 CSS 变量安装到 element/portal root。Module 样式只能消费公开变量，不能声明 `--mem-view-*` Token。`subscribe()` 返回的 disposer 自动归属当前 Plugin 实例，也可以被 Plugin 提前调用。

## ViewLogger

```ts
export interface ViewLogger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}
```

Logger 自动附加 Project、Module、版本和实例身份。Module 不得记录 secret 或不必要的用户数据。

## 启动、回滚与诊断

ViewHost 的实例启动顺序必须是：

```text
校验 Manifest 与 SDK 版本
→ 解析依赖和实例配置
→ 导入 View Bundle
→ 创建实例 Context
→ 调用 apply(ctx, config)
→ 原子提交实例注册结果
→ 渲染 Slot Tree
```

`apply()` 期间的 SDK 注册必须先进入实例事务，成功后才整体可见。失败时撤销本次启动产生的全部注册和资源。

Slot 未声明、Token 不兼容、稳定身份冲突和 Route 越界必须在启动阶段明确失败。Host 的只读诊断应包含 Module、版本、实例、Slot 声明树、Entry 来源和失败原因。

Descriptor Action 失败只影响该操作；Entry 渲染失败只替换该 Entry。`main.view` 失败时显示局部错误页，Shell 保持可用。

## 版本和废弃

SDK SemVer：

- Patch：修复实现，不改变公开类型和行为；
- Minor：增加可选字段、服务、Slot Token 或 Host 能力，旧 Plugin 继续运行；
- Major：允许删除或改变既有字段、Slot 语义、生命周期或运行时要求。

Slot Contract 使用 `name@version` 身份：

- Descriptor 增加可选字段通常保持 Slot 版本；
- 改变 kind、scope、必填字段、Entry 选择或渲染语义必须发布新主版本；
- Host 可以在迁移期同时声明多个版本；
- 贡献方必须显式选择版本，不自动把旧 Entry 填入新 Slot。

公开接口至少经过一个 Minor 版本的 deprecated 周期后，才能在下一个 Major 删除；诊断必须指出替代接口。Host 必须在加载前报告不兼容，不得运行后猜测降级。

## 浏览器边界约束

当前信任模型只加载用户自己编写或明确安装的可信代码，不提供恶意代码沙箱。Plugin 仍必须：

- 只依赖公开 SDK；
- 不读取 ViewHost 私有对象或容器外 DOM；
- 不跨 Module 实例访问 API；
- 不绕过 Application 和 Domain 直接操作持久化；
- 不覆盖 Core 保留 Slot Entry、Route、翻译 namespace 或稳定身份；
- 不把 secret 放入浏览器配置、Bundle、Descriptor 或日志。

Module Manifest、CLI SDK、服务端 View API 注册接口、配置 Schema、第三方签名与沙箱不属于本 API 文档。
