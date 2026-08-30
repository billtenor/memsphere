export type MaybePromise<T> = T | Promise<T>;
export type Disposer = () => void | Promise<void>;

export type ViewServiceName =
  | "slots"
  | "router"
  | "api"
  | "i18n"
  | "theme"
  | "logger";

export interface ModuleInstanceContext {
  readonly projectId: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly instanceId: string;
}

export interface ViewLifecycle {
  own(disposer: Disposer): Disposer;
  readonly disposed: boolean;
}

export interface ViewMountTarget {
  readonly element: HTMLElement;
  readonly portal: HTMLElement;
}

export interface ViewRenderContext {
  readonly module: Readonly<ModuleInstanceContext>;
}

export interface ViewMount {
  mount(
    target: ViewMountTarget,
    context: ViewRenderContext,
  ): MaybePromise<void | Disposer>;
}

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
  validate(value: unknown): value is Value;
}

const slotTokenBrand: unique symbol = Symbol("memsphere.view.slot-token");

export interface SlotToken<
  Name extends string,
  Kind extends SlotKind,
  Value,
  Key extends string = never,
> {
  readonly definition: SlotDefinition<Name, Kind, Value>;
  readonly __types?: { readonly value: Value; readonly key: Key };
  readonly [slotTokenBrand]: true;
}

export function defineSlot<Value, Key extends string = never>(): <
  Name extends string,
  Kind extends SlotKind,
>(definition: SlotDefinition<Name, Kind, Value>) => SlotToken<Name, Kind, Value, Key> {
  return definition => Object.freeze({
    definition: Object.freeze({ ...definition }),
    [slotTokenBrand]: true as const
  });
}

export function isSlotToken(value: unknown): value is SlotToken<string, SlotKind, unknown, string> {
  return Boolean(
    value
    && typeof value === "object"
    && slotTokenBrand in value
    && (value as { [slotTokenBrand]?: unknown })[slotTokenBrand] === true
  );
}

export function isViewMount(value: unknown): value is ViewMount {
  return Boolean(value && typeof value === "object" && typeof (value as ViewMount).mount === "function");
}

export const slots = Object.freeze({
  mainView: defineSlot<ViewMount, string>()({
    name: "main.view",
    version: 1,
    kind: "keyed",
    scope: "shell",
    render: "mount",
    validate: isViewMount
  })
});

type AnySlotToken = SlotToken<string, SlotKind, unknown, string>;

type SlotValue<S extends AnySlotToken> =
  S extends SlotToken<string, SlotKind, infer Value, string> ? Value : never;

type SlotKey<S extends AnySlotToken> =
  S extends SlotToken<string, SlotKind, unknown, infer Key> ? Key : never;

type SingleOrListSlotToken = SlotToken<string, "single" | "list", unknown, never>;
type KeyedSlotToken = SlotToken<string, "keyed", unknown, string>;

export interface RegisterOptions<Value> {
  readonly id: string;
  readonly value: Value;
  readonly order?: number;
  readonly children?: readonly AnySlotToken[];
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

export interface ViewPluginContext {
  readonly module: Readonly<ModuleInstanceContext>;
  readonly slots: SlotRegistry;
  readonly lifecycle: ViewLifecycle;
}

export interface ViewPlugin<Config = unknown> {
  readonly name?: string;
  readonly apiVersion: 1;
  readonly inject: readonly ViewServiceName[];
  apply(
    context: ViewPluginContext,
    config: Readonly<Config>,
  ): MaybePromise<void | Disposer>;
}

export function defineViewPlugin<Config>(plugin: ViewPlugin<Config>): ViewPlugin<Config> {
  return plugin;
}
