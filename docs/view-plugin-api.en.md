# Memsphere View Plugin API

[简体中文](./view-plugin-api.md) | English

This is the normative API reference for `@memsphere/view-sdk` and ViewHost. It is intended for SDK, Host, and Module View implementers and records only public types, methods, and runtime contracts.

For your first Plugin, read [View Plugin Guide](./view-plugin-guide.en.md). For architecture boundaries, see [View Plugin Design](./view-plugin-design.en.md). For built-in Slot names and product semantics, see [View Slot List](./view-slots.en.md).

This document defines the long-term public interface and explicitly records current runtime support below. Add capabilities directly to the corresponding interfaces, implementation status, and constraints. “Must” and “must not” are compatibility requirements; “should” is the default engineering choice.

## Current Implementation Status

ViewHost currently implements the default Plugin entrypoint, `apiVersion: 1`, `apply()`, Module instance identity, `lifecycle`, minimum Manifest validation, SDK SemVer checks, independent Bundle loading, Router, Slot Tokens and Registry, per-instance registration transactions, rollback, and Mount cleanup. An import map resolves `@memsphere/view-sdk` to the Host-provided browser SDK.

The currently injectable services are `slots` and `router`. The wired root Slots are `navigation.primary`, `header.title`, `header.actions`, and `main.view`. The three builtin Modules—`org.memsphere.memory`, `org.memsphere.run`, and `org.memsphere.settings`—all use this public entrypoint and independent Bundles. View API, I18n, Theme, Logger, custom child Slots, user Module discovery/installation, and dynamic Project composition remain unwired. A Plugin requesting an unavailable service fails explicitly before `apply()`.

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
slots.headerActions;
slots.headerAccount;
slots.navigationPrimary;
slots.sidebarFooter;
slots.homeAttention;
slots.homeContinue;
slots.homeModules;
slots.mainView;
slots.overlay;
```

Their exact names, ownership, and semantics are defined by [View Slot List](./view-slots.en.md).

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
}
```

`register()` synchronously validates Token, Value, identity, and ownership and leaves no partial registration on failure. Its disposer removes the Entry and automatically joins the instance lifecycle.

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

export interface AttentionItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly status: "info" | "warning" | "error";
  readonly updatedAt?: string;
  readonly action: ActionDescriptor;
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
}

export interface RouteToken {
  readonly key: string;
  readonly activation: RouteActivation;
  to(params?: Readonly<Record<string, string>>): RouteTarget;
}

export interface ViewRouter {
  register(definition: RouteDefinition): RouteToken;
  navigate(target: RouteTarget): Promise<void>;
  readonly location: RouteLocation;
}
```

`RouteActivation`, `RouteTarget`, and `RouteLocation` are SDK-defined, Host-created route values. Plugins must not forge them.

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

## ViewTheme

```ts
export interface ViewTheme {
  readonly mode: "light" | "dark";
  readonly tokens: Readonly<Record<string, string>>;
  subscribe(listener: () => void): Disposer;
}
```

Theme Tokens are stable visual interfaces; private Host CSS classes are not. The `subscribe()` disposer automatically joins the instance lifecycle and may also be invoked early.

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
