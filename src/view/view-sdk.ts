export type MaybePromise<T> = T | Promise<T>;
export type Disposer = () => void | Promise<void>;

export type ViewThemeMode = "light" | "dark";
export type ViewThemeToken =
  | "color.canvas" | "color.surface" | "color.subtle"
  | "color.text" | "color.textMuted" | "color.border"
  | "color.accent" | "color.accentHover" | "color.accentSoft"
  | "color.danger" | "color.dangerSoft" | "color.focusRing"
  | "color.onAccent" | "color.overlay" | "color.badge" | "color.account" | "color.borderStrong"
  | "font.sans" | "font.mono"
  | "font.sizeXs" | "font.sizeSm" | "font.sizeBase" | "font.sizeMd" | "font.sizeLg" | "font.sizeXl" | "font.sizeDisplay"
  | "line.compact" | "line.body" | "line.heading"
  | "space.1" | "space.2" | "space.3" | "space.4" | "space.5" | "space.6"
  | "radius.sm" | "radius.md" | "radius.lg" | "radius.pill"
  | "shadow.card" | "shadow.popover" | "shadow.overlay" | "motion.fast"
  | "z.overlay" | "layout.contentMax" | "layout.pagePadding";

export const viewThemeCssVariables: Readonly<Record<ViewThemeToken, `--mem-view-${string}`>> = Object.freeze({
  "color.canvas": "--mem-view-color-canvas", "color.surface": "--mem-view-color-surface",
  "color.subtle": "--mem-view-color-subtle", "color.text": "--mem-view-color-text",
  "color.textMuted": "--mem-view-color-text-muted", "color.border": "--mem-view-color-border",
  "color.accent": "--mem-view-color-accent", "color.accentHover": "--mem-view-color-accent-hover",
  "color.accentSoft": "--mem-view-color-accent-soft", "color.danger": "--mem-view-color-danger",
  "color.dangerSoft": "--mem-view-color-danger-soft", "color.focusRing": "--mem-view-color-focus-ring",
  "color.onAccent": "--mem-view-color-on-accent", "color.overlay": "--mem-view-color-overlay",
  "color.badge": "--mem-view-color-badge", "color.account": "--mem-view-color-account",
  "color.borderStrong": "--mem-view-color-border-strong",
  "font.sans": "--mem-view-font-sans", "font.mono": "--mem-view-font-mono",
  "font.sizeXs": "--mem-view-font-size-xs", "font.sizeSm": "--mem-view-font-size-sm",
  "font.sizeBase": "--mem-view-font-size-base", "font.sizeMd": "--mem-view-font-size-md",
  "font.sizeLg": "--mem-view-font-size-lg", "font.sizeXl": "--mem-view-font-size-xl",
  "font.sizeDisplay": "--mem-view-font-size-display",
  "line.compact": "--mem-view-line-compact", "line.body": "--mem-view-line-body",
  "line.heading": "--mem-view-line-heading", "space.1": "--mem-view-space-1",
  "space.2": "--mem-view-space-2", "space.3": "--mem-view-space-3", "space.4": "--mem-view-space-4",
  "space.5": "--mem-view-space-5", "space.6": "--mem-view-space-6",
  "radius.sm": "--mem-view-radius-sm", "radius.md": "--mem-view-radius-md",
  "radius.lg": "--mem-view-radius-lg", "radius.pill": "--mem-view-radius-pill",
  "shadow.card": "--mem-view-shadow-card", "shadow.popover": "--mem-view-shadow-popover",
  "shadow.overlay": "--mem-view-shadow-overlay", "motion.fast": "--mem-view-motion-fast",
  "z.overlay": "--mem-view-z-overlay",
  "layout.contentMax": "--mem-view-layout-content-max", "layout.pagePadding": "--mem-view-layout-page-padding"
});

export interface ViewTheme {
  readonly version: 1;
  readonly mode: ViewThemeMode;
  readonly tokens: Readonly<Record<ViewThemeToken, string>>;
  subscribe(listener: () => void): Disposer;
}

export type ViewServiceName =
  | "slots"
  | "router"
  | "api"
  | "i18n"
  | "theme"
  | "ui"
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
  readonly theme: ViewTheme;
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
  readonly query: Readonly<Record<string, string>>;
  readonly routeKey?: string;
  /** True when this is the passive background projected by an active overlay Route. */
  readonly projected?: true;
}

export interface RouteDefinition {
  readonly id: string;
  readonly path: string;
  readonly query?: readonly string[];
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
  readonly params: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly hash?: "discard" | "preserve";
}

export interface ViewRouter {
  register(definition: RouteDefinition): RouteToken;
  project(options: RouteProjectionOptions): RouteProjection;
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

export interface SearchProviderRequest {
  readonly query: string;
  readonly signal: AbortSignal;
}

export interface SearchResultDescriptor {
  readonly title: TextRef;
  readonly summary?: TextRef;
  readonly type: TextRef;
  readonly icon?: IconRef;
  readonly route: RouteTarget;
}

export interface SearchProviderDescriptor {
  readonly label: TextRef;
  readonly icon: IconRef;
  search(request: SearchProviderRequest): MaybePromise<readonly SearchResultDescriptor[]>;
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

export interface HeaderActionDescriptor extends ActionDescriptor {
  readonly tone?: "success";
}

export interface SidePanelDescriptor {
  readonly label: TextRef;
  readonly icon?: IconRef;
  readonly defaultOpen?: boolean;
  readonly mount: ViewMount;
}

export interface ContentListFilterDescriptor {
  readonly label: TextRef;
  readonly placeholder?: TextRef;
  readonly value?: string;
  readonly onInput: (value: string) => MaybePromise<void>;
}

export type ContentListItemDescriptor = Readonly<{
  id: string;
  title: TextRef;
  meta?: TextRef;
  icon?: IconRef;
  badge?: TextRef;
  selected?: boolean;
} & (
  | { route: RouteTarget; action?: never }
  | { route?: never; action: ActionDescriptor }
)>;

export interface ContentListSectionDescriptor {
  readonly id: string;
  readonly label?: TextRef;
  readonly items: readonly ContentListItemDescriptor[];
}

export interface ContentListEmptyDescriptor {
  readonly title: TextRef;
  readonly description?: TextRef;
}

export interface ContentListHeaderDescriptor {
  readonly eyebrow: TextRef;
  readonly title: TextRef;
  readonly action?: ActionDescriptor;
}

export interface ContentListDescriptor {
  readonly label: TextRef;
  readonly header?: ContentListHeaderDescriptor;
  readonly state?: "ready" | "loading";
  readonly filter?: ContentListFilterDescriptor;
  readonly empty: ContentListEmptyDescriptor;
  readonly sections: readonly ContentListSectionDescriptor[];
}

export interface ConfirmationDescriptor {
  readonly title: TextRef;
  readonly description?: TextRef;
  readonly confirmLabel: TextRef;
  readonly cancelLabel: TextRef;
  readonly tone?: "primary" | "danger";
}

export type ContentListProvider = (
  context: ViewRenderContext,
) => MaybePromise<ContentListDescriptor>;

export interface ViewUi {
  readonly version: 1;
  contentList(source: ContentListDescriptor | ContentListProvider): ViewMount;
  button(action: ActionDescriptor, options?: Readonly<{ tone?: "default" | "primary" | "danger" }>): HTMLButtonElement;
  confirmButton(action: ActionDescriptor, confirmation: ConfirmationDescriptor, options?: Readonly<{ tone?: "default" | "primary" | "danger" }>): HTMLButtonElement;
  iconButton(action: ActionDescriptor): HTMLButtonElement;
  badge(label: TextRef): HTMLElement;
  emptyState(empty: ContentListEmptyDescriptor): HTMLElement;
}

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

export function isSecondaryNavigationItemDescriptor(value: unknown): value is SecondaryNavigationItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SecondaryNavigationItemDescriptor> & { route?: unknown; action?: unknown };
  const hasRoute = candidate.route !== undefined;
  const hasAction = candidate.action !== undefined;
  return hasOnlyKeys(value, ["id", "label", "icon", "badge", "selected", "route", "action"])
    && typeof candidate.id === "string"
    && candidate.id.length > 0
    && isTextRef(candidate.label)
    && isIconRef(candidate.icon)
    && (candidate.badge === undefined || isTextRef(candidate.badge))
    && typeof candidate.selected === "boolean"
    && hasRoute !== hasAction
    && (!hasRoute || isRouteTarget(candidate.route))
    && (!hasAction || isActionDescriptor(candidate.action));
}

export function isSecondaryNavigationDescriptor(value: unknown): value is SecondaryNavigationDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SecondaryNavigationDescriptor>;
  return hasOnlyKeys(value, ["title", "icon", "settings", "items", "footer"])
    && isTextRef(candidate.title)
    && isIconRef(candidate.icon)
    && (candidate.settings === undefined || isActionDescriptor(candidate.settings))
    && Array.isArray(candidate.items)
    && candidate.items.every(isSecondaryNavigationItemDescriptor)
    && new Set(candidate.items.map(item => item.id)).size === candidate.items.length
    && (candidate.footer === undefined || isTextRef(candidate.footer));
}

export function isSearchResultDescriptor(value: unknown): value is SearchResultDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SearchResultDescriptor>;
  return hasOnlyKeys(value, ["title", "summary", "type", "icon", "route"])
    && isTextRef(candidate.title)
    && (candidate.summary === undefined || isTextRef(candidate.summary))
    && isTextRef(candidate.type)
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && isRouteTarget(candidate.route);
}

export function isSearchProviderDescriptor(value: unknown): value is SearchProviderDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SearchProviderDescriptor>;
  return hasOnlyKeys(value, ["label", "icon", "search"])
    && isTextRef(candidate.label)
    && isIconRef(candidate.icon)
    && typeof candidate.search === "function";
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
  return hasOnlyKeys(value, ["label", "icon", "disabled", "run", "tone"])
    && hasActionFields(candidate)
    && (candidate.tone === undefined || candidate.tone === "success");
}

export function isSidePanelDescriptor(value: unknown): value is SidePanelDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SidePanelDescriptor>;
  return hasOnlyKeys(value, ["label", "icon", "defaultOpen", "mount"])
    && isTextRef(candidate.label)
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && (candidate.defaultOpen === undefined || typeof candidate.defaultOpen === "boolean")
    && isViewMount(candidate.mount);
}

export function isActionDescriptor(value: unknown): value is ActionDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ActionDescriptor>;
  return hasOnlyKeys(value, ["label", "icon", "disabled", "run"])
    && hasActionFields(candidate);
}

function hasActionFields(candidate: Partial<ActionDescriptor>): boolean {
  return isTextRef(candidate.label)
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && (candidate.disabled === undefined || typeof candidate.disabled === "boolean")
    && typeof candidate.run === "function";
}

export function isContentListDescriptor(value: unknown): value is ContentListDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListDescriptor>;
  return hasOnlyKeys(value, ["label", "header", "state", "filter", "empty", "sections"])
    && isTextRef(candidate.label)
    && (candidate.header === undefined || isContentListHeaderDescriptor(candidate.header))
    && (candidate.state === undefined || candidate.state === "ready" || candidate.state === "loading")
    && (candidate.filter === undefined || isContentListFilterDescriptor(candidate.filter))
    && isContentListEmptyDescriptor(candidate.empty)
    && Array.isArray(candidate.sections)
    && candidate.sections.every(isContentListSectionDescriptor)
    && new Set(candidate.sections.map(section => section.id)).size === candidate.sections.length
    && new Set(candidate.sections.flatMap(section => section.items.map(item => item.id))).size
      === candidate.sections.reduce((count, section) => count + section.items.length, 0);
}

function isContentListHeaderDescriptor(value: unknown): value is ContentListHeaderDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListHeaderDescriptor>;
  return hasOnlyKeys(value, ["eyebrow", "title", "action"])
    && isTextRef(candidate.eyebrow)
    && isTextRef(candidate.title)
    && (candidate.action === undefined || isActionDescriptor(candidate.action));
}

function isContentListFilterDescriptor(value: unknown): value is ContentListFilterDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListFilterDescriptor>;
  return hasOnlyKeys(value, ["label", "placeholder", "value", "onInput"])
    && isTextRef(candidate.label)
    && (candidate.placeholder === undefined || isTextRef(candidate.placeholder))
    && (candidate.value === undefined || typeof candidate.value === "string")
    && typeof candidate.onInput === "function";
}

function isContentListItemDescriptor(value: unknown): value is ContentListItemDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListItemDescriptor> & { route?: unknown; action?: unknown };
  const hasRoute = candidate.route !== undefined;
  const hasAction = candidate.action !== undefined;
  return hasOnlyKeys(value, ["id", "title", "meta", "icon", "badge", "selected", "route", "action"])
    && typeof candidate.id === "string" && candidate.id.length > 0
    && isTextRef(candidate.title)
    && (candidate.meta === undefined || isTextRef(candidate.meta))
    && (candidate.icon === undefined || isIconRef(candidate.icon))
    && (candidate.badge === undefined || isTextRef(candidate.badge))
    && (candidate.selected === undefined || typeof candidate.selected === "boolean")
    && hasRoute !== hasAction
    && (!hasRoute || isRouteTarget(candidate.route))
    && (!hasAction || isActionDescriptor(candidate.action));
}

function isContentListSectionDescriptor(value: unknown): value is ContentListSectionDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListSectionDescriptor>;
  return hasOnlyKeys(value, ["id", "label", "items"])
    && typeof candidate.id === "string" && candidate.id.length > 0
    && (candidate.label === undefined || isTextRef(candidate.label))
    && Array.isArray(candidate.items)
    && candidate.items.every(isContentListItemDescriptor)
    && new Set(candidate.items.map(item => item.id)).size === candidate.items.length;
}

function isContentListEmptyDescriptor(value: unknown): value is ContentListEmptyDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentListEmptyDescriptor>;
  return hasOnlyKeys(value, ["title", "description"])
    && isTextRef(candidate.title)
    && (candidate.description === undefined || isTextRef(candidate.description));
}

export function isHeaderAccountDescriptor(value: unknown): value is HeaderAccountDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HeaderAccountDescriptor>;
  return hasOnlyKeys(value, ["label", "status", "action"])
    && isTextRef(candidate.label)
    && (candidate.status === undefined || isTextRef(candidate.status))
    && (candidate.action === undefined || isActionDescriptor(candidate.action));
}

export function isSidebarFooterDescriptor(value: unknown): value is SidebarFooterDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { kind?: unknown; action?: unknown; label?: unknown; status?: unknown };
  if (candidate.kind === "action") {
    return hasOnlyKeys(value, ["kind", "action"]) && isActionDescriptor(candidate.action);
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
    && isActionDescriptor(candidate.action);
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
  navigationSecondary: defineSlot<SecondaryNavigationDescriptor>()({
    name: "navigation.secondary",
    version: 1,
    kind: "single",
    scope: "page",
    render: "descriptor",
    live: true,
    validate: isSecondaryNavigationDescriptor
  }),
  contentList: defineSlot<ViewMount>()({
    name: "content.list",
    version: 1,
    kind: "single",
    scope: "page",
    render: "mount",
    validate: isViewMount
  }),
  searchProviders: defineSlot<SearchProviderDescriptor>()({
    name: "search.providers",
    version: 1,
    kind: "list",
    scope: "project",
    render: "descriptor",
    validate: isSearchProviderDescriptor
  }),
  headerTitle: defineSlot<HeaderTitleDescriptor>()({
    name: "header.title",
    version: 1,
    kind: "single",
    scope: "page",
    render: "descriptor",
    live: true,
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
  sidePanel: defineSlot<SidePanelDescriptor>()({
    name: "side.panel",
    version: 1,
    kind: "single",
    scope: "page",
    render: "mount",
    validate: isSidePanelDescriptor
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
  /** Present only after the Plugin declares theme and a supported themeVersion. */
  readonly theme?: ViewTheme;
  /** Present only after the Plugin declares ui and a supported uiVersion. */
  readonly ui?: ViewUi;
  readonly lifecycle: ViewLifecycle;
}

export interface ViewPlugin<Config = unknown> {
  readonly name?: string;
  readonly apiVersion: 1;
  readonly inject: readonly ViewServiceName[];
  readonly themeVersion?: 1;
  readonly uiVersion?: 1;
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
