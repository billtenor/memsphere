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
  readonly route: Readonly<RouteLocation>;
}

export interface ViewMount {
  mount(
    target: ViewMountTarget,
    context: ViewRenderContext,
  ): MaybePromise<void | Disposer>;
  update?(context: ViewRenderContext): MaybePromise<void>;
}

const routeActivationBrand: unique symbol = Symbol("memsphere.view.route-activation");
const routeTargetBrand: unique symbol = Symbol("memsphere.view.route-target");
const routeProjectionBrand: unique symbol = Symbol("memsphere.view.route-projection");

/** Opaque route predicate created by ViewHost. */
export interface RouteActivation {
  readonly [routeActivationBrand]: true;
}

/** Opaque navigation target created by ViewHost. */
export interface RouteTarget {
  readonly [routeTargetBrand]: true;
}

/** Opaque mapping from an overlay route to its background page route. */
export interface RouteProjection {
  readonly [routeProjectionBrand]: true;
}

export interface RouteLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly params: Readonly<Record<string, string>>;
  readonly routeKey?: string;
  /** True when this is the passive background projected by an active overlay Route. */
  readonly projected?: true;
}

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
  project(options: {
    readonly from: RouteToken;
    readonly to: RouteToken;
    readonly params: Readonly<Record<string, string>>;
  }): RouteProjection;
  navigate(target: RouteTarget): Promise<void>;
  readonly location: RouteLocation;
}

/** @internal ViewHost only. Not part of the Module-facing compatibility contract. */
export function createHostRouteActivation(): RouteActivation {
  return Object.freeze({ [routeActivationBrand]: true as const });
}

/** @internal ViewHost only. Not part of the Module-facing compatibility contract. */
export function createHostRouteTarget(): RouteTarget {
  return Object.freeze({ [routeTargetBrand]: true as const });
}

/** @internal ViewHost only. Not part of the Module-facing compatibility contract. */
export function createHostRouteProjection(): RouteProjection {
  return Object.freeze({ [routeProjectionBrand]: true as const });
}

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

export interface HeaderBreadcrumbDescriptor {
  readonly label: TextRef;
  readonly route?: RouteTarget;
}

export interface HeaderTitleDescriptor {
  readonly title: TextRef;
  readonly subtitle?: TextRef;
  readonly breadcrumbs?: readonly HeaderBreadcrumbDescriptor[];
}

export interface HeaderActionDescriptor extends ActionDescriptor {}

export interface HeaderAccountDescriptor {
  readonly label: TextRef;
  readonly status?: TextRef;
  readonly action?: ActionDescriptor;
}

export type SidebarFooterDescriptor =
  | { readonly kind: "action"; readonly action: ActionDescriptor }
  | { readonly kind: "status"; readonly label: TextRef; readonly status: "healthy" | "warning" | "error" };

export interface HomeAttentionItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly source?: TextRef;
  readonly icon?: IconRef;
  readonly status: "info" | "warning" | "error";
  readonly updatedAt?: string;
  readonly action: ActionDescriptor;
}

export interface HomeContinueItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly icon?: IconRef;
  readonly updatedAt?: string;
  readonly route: RouteTarget;
}

export interface HomeModuleItemDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly icon: IconRef;
  readonly route: RouteTarget;
  readonly status?: "loading" | "ready" | "failed";
}

export interface OverlayMountDescriptor {
  readonly label: TextRef;
  readonly presentation: "dialog" | "drawer";
  readonly dismissible?: boolean;
  readonly background: RouteProjection;
  readonly mount: ViewMount;
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
  readonly live?: boolean;
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

export function isRouteActivation(value: unknown): value is RouteActivation {
  return Boolean(
    value
    && typeof value === "object"
    && routeActivationBrand in value
    && (value as { [routeActivationBrand]?: unknown })[routeActivationBrand] === true
  );
}

export function isRouteTarget(value: unknown): value is RouteTarget {
  return Boolean(
    value
    && typeof value === "object"
    && routeTargetBrand in value
    && (value as { [routeTargetBrand]?: unknown })[routeTargetBrand] === true
  );
}

export function isRouteProjection(value: unknown): value is RouteProjection {
  return Boolean(
    value
    && typeof value === "object"
    && routeProjectionBrand in value
    && (value as { [routeProjectionBrand]?: unknown })[routeProjectionBrand] === true
  );
}

export function isTextRef(value: unknown): value is TextRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { text?: unknown; key?: unknown; params?: unknown };
  if (typeof candidate.text === "string") {
    return hasOnlyKeys(value, ["text"])
      && candidate.text.length > 0
      && candidate.key === undefined
      && candidate.params === undefined;
  }
  if (typeof candidate.key !== "string" || !candidate.key) return false;
  if (candidate.text !== undefined) return false;
  return hasOnlyKeys(value, ["key", "params"])
    && (candidate.params === undefined || isTextParams(candidate.params));
}

export function isIconRef(value: unknown): value is IconRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { kind?: unknown; name?: unknown; url?: unknown; alt?: unknown };
  if (candidate.kind === "system") {
    return hasOnlyKeys(value, ["kind", "name"])
      && typeof candidate.name === "string"
      && candidate.name.length > 0;
  }
  return hasOnlyKeys(value, ["kind", "url", "alt"])
    && candidate.kind === "asset"
    && typeof candidate.url === "string"
    && candidate.url.length > 0
    && isTextRef(candidate.alt);
}

export function isNavigationItemDescriptor(value: unknown): value is NavigationItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<NavigationItemDescriptor>;
  return hasOnlyKeys(value, ["label", "icon", "route", "badge"])
    && isTextRef(candidate.label)
    && isIconRef(candidate.icon)
    && isRouteTarget(candidate.route)
    && (candidate.badge === undefined || isTextRef(candidate.badge));
}

export function isHeaderTitleDescriptor(value: unknown): value is HeaderTitleDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HeaderTitleDescriptor>;
  return hasOnlyKeys(value, ["title", "subtitle", "breadcrumbs"])
    && isTextRef(candidate.title)
    && (candidate.subtitle === undefined || isTextRef(candidate.subtitle))
    && (candidate.breadcrumbs === undefined || (
      Array.isArray(candidate.breadcrumbs)
      && candidate.breadcrumbs.every(isHeaderBreadcrumbDescriptor)
    ));
}

export function isHeaderActionDescriptor(value: unknown): value is HeaderActionDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HeaderActionDescriptor>;
  return hasOnlyKeys(value, ["label", "icon", "disabled", "run"])
    && isTextRef(candidate.label)
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && (candidate.disabled === undefined || typeof candidate.disabled === "boolean")
    && typeof candidate.run === "function";
}

export function isHeaderAccountDescriptor(value: unknown): value is HeaderAccountDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HeaderAccountDescriptor>;
  return hasOnlyKeys(value, ["label", "status", "action"])
    && isTextRef(candidate.label)
    && (candidate.status === undefined || isTextRef(candidate.status))
    && (candidate.action === undefined || isHeaderActionDescriptor(candidate.action));
}

export function isSidebarFooterDescriptor(value: unknown): value is SidebarFooterDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { kind?: unknown; action?: unknown; label?: unknown; status?: unknown };
  if (candidate.kind === "action") {
    return hasOnlyKeys(value, ["kind", "action"]) && isHeaderActionDescriptor(candidate.action);
  }
  return hasOnlyKeys(value, ["kind", "label", "status"])
    && candidate.kind === "status"
    && isTextRef(candidate.label)
    && ["healthy", "warning", "error"].includes(String(candidate.status));
}

export function isHomeAttentionItemDescriptor(value: unknown): value is HomeAttentionItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HomeAttentionItemDescriptor>;
  return hasOnlyKeys(value, ["title", "summary", "source", "icon", "status", "updatedAt", "action"])
    && isTextRef(candidate.title)
    && (candidate.summary === undefined || isTextRef(candidate.summary))
    && (candidate.source === undefined || isTextRef(candidate.source))
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && ["info", "warning", "error"].includes(String(candidate.status))
    && (candidate.updatedAt === undefined || typeof candidate.updatedAt === "string")
    && isHeaderActionDescriptor(candidate.action);
}

export function isHomeContinueItemDescriptor(value: unknown): value is HomeContinueItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HomeContinueItemDescriptor>;
  return hasOnlyKeys(value, ["title", "summary", "icon", "updatedAt", "route"])
    && isTextRef(candidate.title)
    && (candidate.summary === undefined || isTextRef(candidate.summary))
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && (candidate.updatedAt === undefined || typeof candidate.updatedAt === "string")
    && isRouteTarget(candidate.route);
}

export function isHomeModuleItemDescriptor(value: unknown): value is HomeModuleItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HomeModuleItemDescriptor>;
  return hasOnlyKeys(value, ["title", "summary", "icon", "route", "status"])
    && isTextRef(candidate.title)
    && (candidate.summary === undefined || isTextRef(candidate.summary))
    && isIconRef(candidate.icon)
    && isRouteTarget(candidate.route)
    && (candidate.status === undefined || ["loading", "ready", "failed"].includes(candidate.status));
}

export function isOverlayMountDescriptor(value: unknown): value is OverlayMountDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<OverlayMountDescriptor>;
  return hasOnlyKeys(value, ["label", "presentation", "dismissible", "background", "mount"])
    && isTextRef(candidate.label)
    && (candidate.presentation === "dialog" || candidate.presentation === "drawer")
    && (candidate.dismissible === undefined || typeof candidate.dismissible === "boolean")
    && isRouteProjection(candidate.background)
    && isViewMount(candidate.mount);
}

export const slots = Object.freeze({
  navigationPrimary: defineSlot<NavigationItemDescriptor>()({
    name: "navigation.primary",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    validate: isNavigationItemDescriptor
  }),
  headerTitle: defineSlot<HeaderTitleDescriptor>()({
    name: "header.title",
    version: 1,
    kind: "single",
    scope: "page",
    render: "descriptor",
    validate: isHeaderTitleDescriptor
  }),
  headerActions: defineSlot<HeaderActionDescriptor>()({
    name: "header.actions",
    version: 1,
    kind: "list",
    scope: "page",
    render: "descriptor",
    live: true,
    validate: isHeaderActionDescriptor
  }),
  headerAccount: defineSlot<HeaderAccountDescriptor>()({
    name: "header.account",
    version: 1,
    kind: "single",
    scope: "shell",
    render: "descriptor",
    validate: isHeaderAccountDescriptor
  }),
  sidebarFooter: defineSlot<SidebarFooterDescriptor>()({
    name: "sidebar.footer",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    validate: isSidebarFooterDescriptor
  }),
  homeAttention: defineSlot<HomeAttentionItemDescriptor>()({
    name: "home.attention",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    live: true,
    validate: isHomeAttentionItemDescriptor
  }),
  homeContinue: defineSlot<HomeContinueItemDescriptor>()({
    name: "home.continue",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    live: true,
    validate: isHomeContinueItemDescriptor
  }),
  homeModules: defineSlot<HomeModuleItemDescriptor>()({
    name: "home.modules",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    validate: isHomeModuleItemDescriptor
  }),
  mainView: defineSlot<ViewMount, string>()({
    name: "main.view",
    version: 1,
    kind: "keyed",
    scope: "shell",
    render: "mount",
    validate: isViewMount
  }),
  overlay: defineSlot<OverlayMountDescriptor, string>()({
    name: "overlay",
    version: 1,
    kind: "keyed",
    scope: "page",
    render: "mount",
    validate: isOverlayMountDescriptor
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

  upsert<S extends SingleOrListSlotToken>(
    slot: S,
    options: RegisterOptions<SlotValue<S>>,
  ): Disposer;
}

export interface ViewPluginContext {
  readonly module: Readonly<ModuleInstanceContext>;
  readonly slots: SlotRegistry;
  /** Present only after the Plugin declares and ViewHost wires the router service. */
  readonly router?: ViewRouter;
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

function isHeaderBreadcrumbDescriptor(value: unknown): value is HeaderBreadcrumbDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HeaderBreadcrumbDescriptor>;
  return hasOnlyKeys(value, ["label", "route"])
    && isTextRef(candidate.label)
    && (candidate.route === undefined || isRouteTarget(candidate.route));
}

function isTextParams(value: unknown): value is Readonly<Record<string, string | number>> {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === "string" || typeof item === "number")
  );
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const names = new Set(allowed);
  return Object.keys(value).every(key => names.has(key));
}
