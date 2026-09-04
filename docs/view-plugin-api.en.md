# Memsphere View Plugin API

[简体中文](./view-plugin-api.md) | English

This is the normative API reference for `@memsphere/view-sdk` and ViewHost. It is intended for SDK, Host, and Module View implementers and records only public types, methods, and runtime contracts.

For your first Plugin, read [View Plugin Guide](./view-plugin-guide.en.md). For copyable control examples, see the [View UI Primitives Handbook](./view-ui-primitives.en.md). For architecture boundaries, see [View Plugin Design](./view-plugin-design.en.md). For built-in Slot names and product semantics, see [View Slot List](./view-slots.en.md).

This document defines the long-term public interface and explicitly records current runtime support below. Add capabilities directly to the corresponding interfaces, implementation status, and constraints. “Must” and “must not” are compatibility requirements; “should” is the default engineering choice.

## Current Implementation Status

ViewHost currently implements the default Plugin entrypoint, `apiVersion: 1`, `apply()`, Module instance identity, `lifecycle`, minimum Manifest validation, SDK SemVer checks, independent Bundle loading, Router, Slot Tokens and Registry, per-instance registration transactions, rollback, and Mount cleanup. An import map resolves `@memsphere/view-sdk` to the Host-provided browser SDK.

The currently injectable services are `slots`, `router`, `theme`, and `ui`. The complete root Slot list, product semantics, and current wiring status are maintained in the [View Slot List](./view-slots.en.md). Some aggregate Slots support the restricted live `upsert()` contract defined below, while page overlays support Host-managed background Route projection and local failure isolation. All four built-in Modules use the same public entrypoint and independent Bundles. View API, I18n, Logger, custom child Slots, user Module discovery/installation, and dynamic Project composition remain unwired. A Plugin requesting an unavailable service fails explicitly before `apply()`.

## Module View Entrypoint Contract

A View Plugin is the default export of a Module browser Bundle. The minimum View section of the Manifest is:

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

| Field | Contract |
| --- | --- |
| `schemaVersion` | Module Manifest structure version; not the SDK version |
| `id` | Module code identity; an instance has a separate stable `instanceId` |
| `version` | Module package version |
| `view.entry` | Browser ESM entrypoint within the Module package; it must not escape the package directory |
| `view.sdk` | Compatible `@memsphere/view-sdk` SemVer range used at compilation |

ViewHost must check compatibility before executing the Bundle. An incompatible Module disables only its own instance and produces a locatable diagnostic.

## Common Types

```ts
export type MaybePromise<T> = T | Promise<T>;
export type Disposer = () => void | Promise<void>;
```

`MaybePromise<T>` allows either synchronous `T` or asynchronous `Promise<T>` results. Host may consume both with `await`.

A `Disposer` reverses a registration or cleans one resource. It must be idempotent: repeated calls have the same final effect as one call.

## ViewPlugin

```ts
export interface ViewPlugin<Config = unknown> {
  /** Diagnostic name; not the Module identity. */
  readonly name?: string;

  /** The current interface major version is 1. */
  readonly apiVersion: 1;

  /** Context services required and authorized before apply. */
  readonly inject: readonly ViewServiceName[];

  /** Called once for every enabled Module instance. */
  apply(
    context: ViewPluginContext,
    config: Readonly<Config>,
  ): MaybePromise<void | Disposer>;
}

export function defineViewPlugin<Config>(
  plugin: ViewPlugin<Config>,
): ViewPlugin<Config>;
```

The Bundle must default-export one `ViewPlugin`:

```ts
import { defineViewPlugin } from "@memsphere/view-sdk";

export default defineViewPlugin({
  name: "customer-list-view",
  apiVersion: 1,
  inject: ["slots", "router"],

  apply(ctx, config) {
    // Register View capabilities for this Module instance.
  },
});
```

`defineViewPlugin()` is a typing helper that returns the same object it receives. The SDK does not also support functions, constructors, or other Plugin entrypoint forms.

Invocation contract:

- ViewHost creates a separate Context and calls `apply()` for every enabled Module instance.
- One ESM Bundle may be imported once. Top-level state is shared by all instances of that version and must not hold instance business state.
- A successful `apply()` makes the instance `active`; a throw or rejected Promise makes it `failed`.
- A disposer returned by `apply()` automatically joins the instance lifecycle.
- Failure of one instance must not prevent Shell or healthy instances from starting.

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

`module` and `lifecycle` are always available. Every other service must appear in `inject`; Host checks availability before `apply()`, and accessing an undeclared service must fail.

The production `defineViewPlugin()` should narrow the `apply()` Context from the `inject` literal. The interface above describes the complete Host capability set.

ViewHost creates Context. A Module must not construct it, cache it across instances, or use it to register arbitrary inter-Module JavaScript services.

## ViewLifecycle

```ts
export interface ViewLifecycle {
  /** Attach a non-SDK resource to current instance cleanup. */
  own(disposer: Disposer): Disposer;

  /** Whether current instance cleanup has begun. */
  readonly disposed: boolean;
}
```

All SDK registration methods automatically belong to the current Module instance. Only Plugin-created non-SDK resources such as DOM listeners, timers, and observers require `own()`.

During instance cleanup, Host must execute disposers in reverse registration order, continue after individual failures, and report all failures together. Once `disposed` becomes `true`, it never returns to `false`.

## Slot Token

### Types

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
  /** Allows an instance to update its own Entry after apply commits. */
  readonly live?: boolean;

  /** Runtime Value validator supplied by the owner. */
  validate(value: unknown): value is Value;
}

export interface SlotToken<
  Name extends string,
  Kind extends SlotKind,
  Value,
  Key extends string = never,
> {
  readonly definition: SlotDefinition<Name, Kind, Value>;

  /** Compile-time Value and Key only; absent from runtime objects. */
  readonly __types?: { readonly value: Value; readonly key: Key };

  /** Prevent structurally identical objects from forging Tokens. */
  readonly __slotToken: unique symbol;
}

export function defineSlot<Value, Key extends string = never>(): <
  Name extends string,
  Kind extends SlotKind,
>(
  definition: SlotDefinition<Name, Kind, Value>,
) => SlotToken<Name, Kind, Value, Key>;
```

A Slot Token’s `name@version` is its runtime contract identity. Host must reject:

- Tokens with the same name and version but different definitions;
- Entries registered into undeclared Slots;
- Values rejected by the validator;
- unsupported Slot kinds or versions.

TypeScript does not replace runtime validation. The SDK supplies validators for built-in Tokens. A custom Descriptor Slot owner exports its validator; a custom Mount Slot may reuse SDK `isViewMount`.

### Built-in Tokens

```ts
import { slots } from "@memsphere/view-sdk";

slots.headerTitle;
slots.navigationSecondary;
slots.contentList;
slots.searchProviders;
```

The SDK exports the current Catalog's root Tokens through `slots`. The complete export list, ownership, and content semantics are maintained only in the [View Slot List](./view-slots.en.md); the line above demonstrates access and is not a second Catalog.

### Slot Kinds

```ts
single  // select one Entry for the whole Slot at a time
list    // display multiple Entries by order and stable identity
keyed   // retain Entries under keys and let the owner activate one key
```

These are the supported kinds. Adding one is an SDK Minor extension. An older Host must reject an unsupported kind instead of guessing a fallback.

### Declaring a Custom Child Slot

Root Slots are declared by ViewHost or the built-in Home View. A Module may declare child Slots only inside a Mount Entry that it owns; the current Runtime does not wire custom child Slots yet:

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

The name must begin with the owner Module id. The owner package exports the Token, and contributors declare a compatible dependency on the owner Module in their Manifest.

The parent Entry declares child Slots through `children`:

```ts
ctx.slots.register(slots.mainView, {
  id: "customer-list.page",
  key: customerRoute.key,
  children: [customerDetailActions],
  value: customerListMount,
});
```

Declaration establishes unique ownership for that lifecycle. Unmounting the parent recursively cleans the child Slot and all its Entries.

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
  /** Stable and unique within current Module instance. */
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

`register()` synchronously validates Token, Value, identity, and ownership and leaves no partial registration on failure. Its disposer removes the Entry and automatically joins the instance lifecycle.

`upsert()` is restricted to Slots marked `live`, currently `navigation.secondary`, `header.title`, `header.actions`, `home.attention`, and `home.continue`. A page Mount may update secondary-navigation counts, the current object title, and page-level actions from loaded content, and must withdraw those Entries when it unmounts. It may be called after a successful `apply()` commit and atomically inserts or replaces an Entry by `id` within the current Module instance. Each successful update creates a new epoch lease: an older disposer cannot remove a newer Entry, while instance cleanup still removes every live Entry.

Entry runtime identity is:

```text
moduleId + moduleVersion + instanceId + slot(name@version) + id [+ key]
```

Conflict rules:

- `single`: multiple Entries at the same priority fail; they never silently replace one another.
- `list`: duplicate `id` within one Module instance fails.
- `keyed`: multiple same-priority Entries for one `key` fail.
- `order` affects display only; equal values are sorted by stable identity.
- Core reserves an Entry priority range unavailable to user Modules; arbitrary `priority` is not public.

## Descriptor Types

Descriptor Slots accept inspectable standard data rendered by the Slot owner. Except for SDK-defined Action fields, a Descriptor contains no callback, framework component, DOM node, or HTML string.

Stable names for `IconRef.kind: "system"` are `archive`, `arrow-right`, `arrows-clockwise`, `brain`, `caret-down`, `check-circle`, `circle-fill`, `clock-counter-clockwise`, `code`, `cube`, `file-text`, `folder`, `gear-six`, `house`, `magnifying-glass`, `play-circle`, `plus`, `seal-check`, `sliders-horizontal`, `sparkle`, `stack`, `storefront`, `user`, `warning-circle`, and `x`. Compatibility aliases `memory`, `search`, `settings`, `gear`, `play`, and `run` map to their stable names; unknown names defensively fall back to `stack`.

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

Fixed UI copy should use Module translation keys. User data and technical identities may use `{ text }`. Host owns standard Action loading, disabled, error, keyboard, and baseline accessibility behavior. The SDK and [View Slot List](./view-slots.en.md) jointly define each built-in Slot’s specialized Descriptor.

## ViewMount

```ts
export interface ViewMount {
  mount(
    target: ViewMountTarget,
    context: ViewRenderContext,
  ): MaybePromise<void | Disposer>;

  /** Receives a new route context when related Routes reuse this Mount. */
  update?(context: ViewRenderContext): MaybePromise<void>;
}

export interface ViewMountTarget {
  /** Host-provided mount container exclusive to this Entry. */
  readonly element: HTMLElement;

  /** Host-managed overlay outlet; Modules do not edit document.body. */
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

Runtime contract:

- Host creates an exclusive `element` and calls `mount()` after Entry activation.
- Related Routes may register the same `ViewMount`. When navigating among them, Host prefers the optional `update()` and preserves the existing container, state, and resources; without `update()`, normal disposal and remounting still apply.
- `update()` only refreshes the active view and does not create another resource lifecycle; the disposer returned by the original `mount()` still runs on final deactivation.
- Modules may use the DOM, React, Vue, Svelte, or another browser framework.
- Host calls the returned disposer before deactivation or container destruction.
- Modules must not mutate DOM outside Host containers or assume the parent structure of `element`.
- Modules must not edit `document.body`; overlays use `portal` or the `overlay` Slot.
- Modules use Theme Tokens and scoped styles, not private Host class names.
- Host may adopt Shadow DOM or another isolation container later.

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
  /** target parameter name -> source parameter name. */
  readonly params: Readonly<Record<string, string>>;
  /** target query key -> source query key. */
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

`RouteLocation.query` is the frozen key/value map parsed by the Host through the active Route allowlist. `to()` accepts only query keys declared by that Route; `undefined` omits a key. `project()` copies only explicitly mapped values that exist, and discards the hash by default. Overlay close, Escape, and backdrop dismissal use Host-only replace navigation; public `navigate()` always pushes.

`RouteActivation`, `RouteTarget`, `RouteProjection`, and `RouteLocation` are SDK-defined, Host-created route values. Plugins must not forge them. `project()` supports keyed overlays by mapping parameters from an overlay Route to a background page Route owned by the same Module instance. Cross-instance projections, missing target parameters, and unknown parameters must fail. A background Mount receives `RouteLocation.projected === true`; it must remain passive and must not rewrite the active overlay URL.

Module Routes live below the instance base path:

```text
/projects/:projectId/modules/:instanceId/...
```

Plugins provide relative paths. Host generates complete paths. A Plugin must not override Home, Memory, Run, settings, or another instance’s absolute path.

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

`when` accepts only a Host-created Route Activation, never an arbitrary callback. Route registration automatically belongs to the Plugin instance lifecycle.

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

Request contract:

- `path` is relative to the current Module instance API namespace.
- Host attaches Project, Module, and instance identity; a Plugin cannot impersonate another instance.
- The server View API Adapter translates the request into an Application use case.
- The server validates authorization, inputs, and outputs.
- Errors contain stable codes and localizable summaries; raw stacks go only to diagnostics logs.

Browser Bundles must not import Node.js Domain, Application, or Persistence Adapters and must not access Project files or databases directly.

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

  /** Remove early; instance cleanup also removes it automatically. */
  dispose(): void;
}
```

Modules must provide fixed visible copy in both `zh-CN` and `en`. A `namespace` begins with the Module id. Host rejects attempts to replace Core or another Module namespace.

## ViewUi v1

A Plugin declares both `inject: ["ui"]` and `uiVersion: 1` before `context.ui` is present. Declaring only one, or requesting an unsupported version, fails before `apply()`. This Host-owned, domain-neutral service provides actions and confirmations, badges and feedback, Tabs/Segmented controls, Disclosure, controlled fields, Select/Combobox, Progress, Card/Section, and the standard Content List. Text fields require a Module-owned `value`, Checkbox requires `checked`, and field-handle `update()` preserves the control node for focus, selection, and IME composition. `ConfirmationDescriptor.closeLabel` supplies the accessible label for the top-right close button. `confirm()` resolves `true` only for confirmation and `false` for cancel, Escape, or close; a failed `confirmButton()` action remains open with inline feedback.

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

`ComboboxHandle.updateDescriptor(descriptor)` lets a Module commit controlled `query`, `value`, and `options` changes without replacing the input node. Every public UI factory validates its descriptor at runtime and fails fast on an invalid action, icon, state, or content contract.

`contentList(descriptorOrProvider)` covers section grouping, three-line copy, multiple badges, selection, route/action activation, trailing actions, disabled items, expandable detail Mounts, filtering, and mutually exclusive loading/empty/error-with-retry states. It returns a normal `ViewMount` for the existing `content.list` Slot; custom Mounts remain the escape hatch for domain-specific structures. Invalid descriptors fail that Mount explicitly without fallback or partial rendering.

## ViewTheme

```ts
export interface ViewTheme {
  readonly version: 1;
  readonly mode: "light" | "dark";
  readonly tokens: Readonly<Record<ViewThemeToken, string>>;
  subscribe(listener: () => void): Disposer;
}
```

A Plugin that declares `inject: ["theme"]` must also declare `themeVersion: 1`; declaring only one fails before `apply()`. Theme v1 currently provides light mode with semantic colors, font and size scales, line heights, spacing, radii, shadows, motion, layering, and content geometry. `viewThemeCssVariables` provides the stable `--mem-view-*` mapping; the SDK type is the single authoritative key list.

Theme Tokens are stable visual interfaces; private Host CSS classes and `--view-*` variables are not. ViewHost passes the same read-only Theme to Plugin and Mount Contexts and installs its CSS variables on element and portal roots. Module styles may consume public variables but must not declare `--mem-view-*` Tokens. The `subscribe()` disposer automatically joins the instance lifecycle and may also be invoked early.

## ViewLogger

```ts
export interface ViewLogger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}
```

Logger automatically adds Project, Module, version, and instance identity. Modules must not log secrets or unnecessary user data.

## Startup, Rollback, and Diagnostics

ViewHost starts an instance in this order:

```text
validate Manifest and SDK version
→ resolve dependencies and instance configuration
→ import View Bundle
→ create instance Context
→ call apply(ctx, config)
→ atomically commit instance registrations
→ render the Slot Tree
```

SDK registrations during `apply()` enter an instance transaction and become visible only after success. Failure reverses all registrations and resources created during startup.

Undeclared Slots, incompatible Tokens, stable identity conflicts, and out-of-bound Routes must fail clearly during startup. Read-only Host diagnostics should contain Module, version, instance, Slot declaration tree, Entry source, and failure reason.

A Descriptor Action failure affects only that action. Entry rendering failure replaces only that Entry. A failed `main.view` displays a local error page while Shell remains available.

## Versioning and Deprecation

SDK SemVer:

- Patch fixes implementation without changing public types or behavior.
- Minor adds optional fields, services, Slot Tokens, or Host capabilities while old Plugins continue to run.
- Major may remove or change existing fields, Slot semantics, lifecycle, or runtime requirements.

Slot Contracts use `name@version` identity:

- adding an optional Descriptor field usually retains the Slot version;
- changing kind, scope, required fields, Entry selection, or rendering semantics requires a new major version;
- Host may declare multiple versions during migration;
- contributors select a version explicitly; old Entries are not automatically inserted into new Slots.

A public interface must remain deprecated for at least one Minor release before removal in a following Major, and diagnostics must name its replacement. Host reports incompatibility before loading and never guesses a downgrade after execution.

## Browser Boundary Constraints

The current trust model loads only code written by the user or explicitly installed as trusted and does not provide a malicious-code sandbox. Plugins must still:

- depend only on the public SDK;
- not read private ViewHost objects or DOM outside their containers;
- not access another Module instance’s API;
- not bypass Application and Domain to operate persistence directly;
- not replace Core-reserved Slot Entries, Routes, translation namespaces, or stable identities;
- not put secrets in browser configuration, Bundles, Descriptors, or logs.

Module Manifest, CLI SDK, server-side View API registration, configuration Schema, third-party signing, and sandboxing are outside this API document.
