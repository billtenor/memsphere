import {
  createHostRouteActivation,
  createHostRouteTarget,
  isSlotToken,
  slots,
  type Disposer,
  type KeyedRegisterOptions,
  type HeaderActionDescriptor,
  type HeaderTitleDescriptor,
  type IconRef,
  type ModuleInstanceContext,
  type NavigationItemDescriptor,
  type RegisterOptions,
  type RouteActivation,
  type RouteDefinition,
  type RouteLocation,
  type RouteTarget,
  type RouteToken,
  type SlotKind,
  type SlotRegistry,
  type SlotToken,
  type TextRef,
  type ViewLifecycle,
  type ViewMount,
  type ViewPlugin,
  type ViewPluginContext,
  type ViewRouter,
  type ViewServiceName
} from "./view-sdk.js";

type AnySlotToken = SlotToken<string, SlotKind, unknown, string>;

type RuntimeEntry = {
  readonly token: AnySlotToken;
  readonly id: string;
  readonly key?: string;
  readonly order: number;
  readonly value: unknown;
  readonly when?: RouteActivation;
  readonly children: readonly AnySlotToken[];
  readonly identity: string;
  readonly owner: string;
};

type RuntimeRoute = {
  readonly id: string;
  readonly key: string;
  readonly path: string;
  readonly patterns: readonly { readonly path: string; readonly pattern: RegExp }[];
  readonly parameterNames: readonly string[];
  readonly activation: RouteActivation;
  readonly owner: string;
};

type RuntimeRouteMatch = {
  readonly route: RuntimeRoute;
  readonly matchedPath: string;
  readonly match: RegExpExecArray;
};

export interface ViewRouteGrant {
  readonly id: string;
  readonly path: string;
  readonly aliases?: readonly string[];
}

export interface ViewPluginInstanceOptions<Config = unknown> {
  readonly plugin: unknown;
  readonly config: Readonly<Config>;
  readonly module: Readonly<ModuleInstanceContext>;
  /** Core may use a reserved base for built-ins; user Modules use their instance base. */
  readonly routeBasePath?: string;
  /** Core-owned allowlist for reserved built-in routes. */
  readonly routeGrants?: readonly ViewRouteGrant[];
}

export interface StartViewHostOptions {
  readonly instances: readonly ViewPluginInstanceOptions[];
  readonly root: HTMLElement;
  readonly mainViewKey?: string;
  readonly location?: RouteLocation;
}

export interface ViewInstanceDiagnostic {
  readonly module: Readonly<ModuleInstanceContext>;
  readonly status: "active" | "failed";
  readonly message?: string;
}

export interface ViewHostDiagnosticSnapshot {
  readonly instances: readonly ViewInstanceDiagnostic[];
  readonly routes: readonly { key: string; path: string; owner: string }[];
  readonly entries: readonly {
    slot: string;
    id: string;
    key?: string;
    order: number;
    identity: string;
    owner: string;
  }[];
}

export interface ActiveViewHost {
  activateMainView(key?: string): Promise<void>;
  diagnostics(): ViewHostDiagnosticSnapshot;
  dispose(): Promise<void>;
}

export interface StartViewPluginOptions<Config = unknown> {
  readonly plugin: unknown;
  readonly config: Readonly<Config>;
  readonly module: Readonly<ModuleInstanceContext>;
  readonly root: HTMLElement;
  readonly mainViewKey: string;
}

export interface ActiveViewPlugin {
  dispose(): Promise<void>;
}

const supportedServices = new Set<ViewServiceName>(["slots", "router"]);

/**
 * Compose all enabled Module instances into one shared Route/Slot runtime.
 * An instance failure rolls back only that instance; healthy instances remain active.
 */
export async function startViewHost(options: StartViewHostOptions): Promise<ActiveViewHost> {
  const initialLocation = options.location ?? {
    pathname: globalThis.location?.pathname ?? "/",
    search: globalThis.location?.search ?? "",
    hash: globalThis.location?.hash ?? "",
    params: Object.freeze({})
  };
  const routeRegistry = new RuntimeRouteStore(initialLocation);
  const slotsRegistry = new RuntimeSlotStore(routeRegistry);
  const instances: RuntimePluginInstance[] = [];
  const diagnostics: ViewInstanceDiagnostic[] = [];
  let activeMount: RuntimeActiveMount | undefined;
  let disposed = false;
  let navigationQueue = Promise.resolve();
  let composeCurrentLocation: () => Promise<void> = async () => {
    throw new Error("ViewHost navigation is not ready");
  };

  routeRegistry.setNavigator(async (target, replace) => {
    const path = routeRegistry.targetPath(target);
    if (path === undefined) throw new Error("Route target was not created by this ViewHost");
    globalThis.history?.[replace ? "replaceState" : "pushState"]({}, "", path);
    await composeCurrentLocation();
    globalThis.scrollTo?.(0, 0);
  });

  for (const instanceOptions of options.instances) {
    const module = Object.freeze({ ...instanceOptions.module });
    const lifecycle = new RuntimeLifecycle();
    const owner = moduleIdentity(module);
    const slotTransaction = slotsRegistry.transaction(module, lifecycle);
    const routeTransaction = routeRegistry.transaction(
      module,
      lifecycle,
      instanceOptions.routeBasePath ?? moduleRouteBase(module),
      instanceOptions.routeGrants
    );

    try {
      const plugin = validatePlugin(instanceOptions.plugin);
      validateServices(plugin);
      const context = Object.freeze({
        module,
        lifecycle,
        ...(plugin.inject.includes("slots") ? { slots: slotTransaction } : {}),
        ...(plugin.inject.includes("router") ? { router: routeTransaction } : {})
      }) as unknown as ViewPluginContext;
      const applyDisposer = await plugin.apply(context, instanceOptions.config);
      if (applyDisposer !== undefined) {
        if (typeof applyDisposer !== "function") {
          throw new Error("View Plugin apply() must return void or a disposer");
        }
        lifecycle.own(applyDisposer);
      }

      // Both registries validate against the same shared snapshot before either becomes visible.
      const preparedRoutes = routeTransaction.prepare();
      const preparedEntries = slotTransaction.prepare();
      routeTransaction.commit(preparedRoutes);
      try {
        slotTransaction.commit(preparedEntries);
      } catch (error) {
        routeTransaction.rollbackCommit(preparedRoutes);
        throw error;
      }
      instances.push({ owner, module, lifecycle });
      diagnostics.push(Object.freeze({ module, status: "active" }));
    } catch (error) {
      const cleanupErrors = await lifecycle.disposeCollectingErrors();
      const message = diagnosticMessage(error, cleanupErrors);
      diagnostics.push(Object.freeze({
        module,
        status: "failed",
        message
      }));
      if (instanceOptions.routeGrants?.length) {
        const failureLifecycle = new RuntimeLifecycle();
        const failureRoutes = routeRegistry.transaction(module, failureLifecycle, moduleRouteBase(module), instanceOptions.routeGrants);
        const failureSlots = slotsRegistry.transaction(module, failureLifecycle);
        try {
          for (const grant of instanceOptions.routeGrants) {
            const route = failureRoutes.register({ id: grant.id, path: grant.path });
            failureSlots.register(slots.mainView, {
              id: `view-host-failure.${grant.id}`,
              key: route.key,
              when: route.activation,
              value: failureMount(module, message)
            });
          }
          const preparedRoutes = failureRoutes.prepare();
          const preparedEntries = failureSlots.prepare();
          failureRoutes.commit(preparedRoutes);
          try {
            failureSlots.commit(preparedEntries);
          } catch (commitError) {
            failureRoutes.rollbackCommit(preparedRoutes);
            throw commitError;
          }
          instances.push({ owner, module, lifecycle: failureLifecycle });
        } catch (fallbackError) {
          cleanupErrors.push(fallbackError, ...await failureLifecycle.disposeCollectingErrors());
        }
      }
    }
  }

  const activeHost: ActiveViewHost = Object.freeze({
    async activateMainView(key?: string): Promise<void> {
      if (disposed) throw new Error("ViewHost is already disposed");
      const location = routeRegistry.location;
      const selectedKey = key ?? options.mainViewKey ?? location.routeKey;
      if (!selectedKey) {
        renderRuntimePageFailure(options.root, undefined, `No View Route matches: ${location.pathname}`, () => activeHost.activateMainView(key));
        return;
      }
      const entry = slotsRegistry.entry(slots.mainView, selectedKey, location);
      if (!entry) {
        const owner = routeRegistry.owner(location.pathname);
        renderRuntimePageFailure(options.root, owner ? moduleForOwner(instances, owner) : undefined, `ViewHost has no main.view for key: ${selectedKey}`, () => activeHost.activateMainView(key));
        return;
      }

      const locationIdentity = routeLocationIdentity(location);
      if (activeMount?.entry === entry && activeMount.locationIdentity === locationIdentity) return;
      const previousMount = activeMount;
      const element = document.createElement("div");
      element.className = "view-host-mount";
      element.dataset.viewMount = entry.identity;
      element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
      const portal = document.createElement("div");
      portal.dataset.viewPortal = entry.identity;
      document.body.append(portal);
      try {
        const mount = entry.value as ViewMount;
        const disposer = await mount.mount(
          { element, portal },
          { module: moduleForOwner(instances, entry.owner), route: location }
        );
        if (disposer !== undefined && typeof disposer !== "function") {
          throw new Error("View Mount must return void or a disposer");
        }
        await disposeActiveMount(previousMount);
        if (activeMount === previousMount) activeMount = undefined;
        options.root.replaceChildren(element);
        activeMount = {
          entry,
          element,
          portal,
          locationIdentity,
          ...(disposer === undefined ? {} : { disposer: disposer as Disposer })
        };
      } catch (error) {
        portal.remove();
        element.remove();
        if (activeMount === previousMount) {
          await disposeActiveMount(previousMount).catch(() => undefined);
          activeMount = undefined;
        }
        renderRuntimePageFailure(options.root, moduleForOwner(instances, entry.owner), errorMessage(error), () => activeHost.activateMainView(key));
      }
      renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
    },
    diagnostics(): ViewHostDiagnosticSnapshot {
      return Object.freeze({
        instances: Object.freeze(diagnostics.map(value => Object.freeze({ ...value }))),
        routes: routeRegistry.snapshot(),
        entries: slotsRegistry.snapshot()
      });
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        await disposeActiveMount(activeMount);
      } catch (error) {
        errors.push(error);
      }
      activeMount = undefined;
      globalThis.removeEventListener?.("popstate", handlePopstate);
      for (const instance of [...instances].reverse()) {
        errors.push(...await instance.lifecycle.disposeCollectingErrors());
      }
      if (errors.length) throw new AggregateError(errors, "ViewHost cleanup failed");
    }
  });

  const compose = async (): Promise<void> => {
    if (disposed) return;
    routeRegistry.updateLocation(browserLocation());
    await activeHost.activateMainView();
    renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
  };
  composeCurrentLocation = () => {
    const operation = navigationQueue.then(compose);
    navigationQueue = operation.catch(() => undefined);
    return operation;
  };
  const handlePopstate = () => {
    void composeCurrentLocation().catch(error => renderShellNavigationError(options.root, error));
  };
  globalThis.addEventListener?.("popstate", handlePopstate);

  if (instances.length === 0) {
    const failure = diagnostics.find(instance => instance.status === "failed");
    throw new Error(failure?.message ?? "ViewHost has no active Module instances");
  }
  try {
    routeRegistry.updateLocation(initialLocation);
    await activeHost.activateMainView();
    renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
  } catch (error) {
    try {
      await activeHost.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], errorMessage(error));
    }
    throw error;
  }
  return activeHost;
}

/** Compatibility wrapper for the first single-Plugin Host contract. */
export async function startViewPlugin<Config>(
  options: StartViewPluginOptions<Config>,
): Promise<ActiveViewPlugin> {
  const host = await startViewHost({
    instances: [{
      plugin: options.plugin,
      config: options.config,
      module: options.module,
      routeBasePath: "/"
    }],
    root: options.root,
    mainViewKey: options.mainViewKey
  });
  const failed = host.diagnostics().instances.find(instance => instance.status === "failed");
  if (failed) {
    await host.dispose();
    throw new Error(failed.message ?? "View Plugin failed to start");
  }
  return Object.freeze({ dispose: () => host.dispose() });
}

function validatePlugin<Config>(value: unknown): ViewPlugin<Config> {
  if (!value || typeof value !== "object") {
    throw new Error("View bundle does not default export a View Plugin");
  }
  const plugin = value as Partial<ViewPlugin<Config>>;
  if ("__viewBundleLoadError" in plugin) {
    throw new Error(`View bundle could not be imported: ${errorMessage(plugin.__viewBundleLoadError)}`);
  }
  if (plugin.apiVersion !== 1) {
    throw new Error(`Unsupported View Plugin API version: ${String(plugin.apiVersion)}`);
  }
  if (!Array.isArray(plugin.inject) || plugin.inject.some(service => typeof service !== "string")) {
    throw new Error("View Plugin inject must be an array of service names");
  }
  if (typeof plugin.apply !== "function") {
    throw new Error("View Plugin does not provide apply()");
  }
  return plugin as ViewPlugin<Config>;
}

function failureMount(module: Readonly<ModuleInstanceContext>, message: string): ViewMount {
  return Object.freeze({
    mount({ element }: { element: HTMLElement }) {
      const chinese = document.documentElement.lang.toLowerCase().startsWith("zh");
      const panel = document.createElement("section");
      panel.className = "view-host-module-error";
      panel.dataset.viewFailedModule = module.moduleId;
      const heading = document.createElement("h2");
      heading.textContent = chinese ? `${module.moduleId} 加载失败` : `${module.moduleId} failed to load`;
      const detail = document.createElement("p");
      detail.textContent = message;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = chinese ? "重试" : "Retry";
      retry.addEventListener("click", () => globalThis.location?.reload());
      panel.append(heading, detail, retry);
      element.replaceChildren(panel);
      return () => panel.remove();
    }
  });
}

function renderRuntimePageFailure(
  element: HTMLElement,
  module: Readonly<ModuleInstanceContext> | undefined,
  message: string,
  retry: () => Promise<void>
): void {
  const chinese = document.documentElement.lang.toLowerCase().startsWith("zh");
  const panel = document.createElement("section");
  panel.className = "view-host-module-error";
  if (module) panel.dataset.viewFailedModule = module.moduleId;
  const heading = document.createElement("h2");
  heading.textContent = module
    ? (chinese ? `${module.moduleId} 页面加载失败` : `${module.moduleId} page failed to load`)
    : (chinese ? "页面加载失败" : "Page failed to load");
  const detail = document.createElement("p");
  detail.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = chinese ? "重试" : "Retry";
  button.addEventListener("click", () => {
    button.disabled = true;
    void retry().finally(() => { button.disabled = false; });
  });
  panel.append(heading, detail, button);
  element.replaceChildren(panel);
}

function validateServices(plugin: ViewPlugin<unknown>): void {
  for (const service of plugin.inject) {
    if (!supportedServices.has(service)) {
      throw new Error(`View Plugin requests unsupported service: ${service}`);
    }
  }
}

class RuntimeLifecycle implements ViewLifecycle {
  readonly #owned: Disposer[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  own(disposer: Disposer): Disposer {
    if (typeof disposer !== "function") throw new TypeError("View disposer must be a function");
    if (this.#disposed) throw new Error("View Plugin instance is already disposed");
    let active = true;
    const wrapped = async () => {
      if (!active) return;
      active = false;
      await disposer();
    };
    this.#owned.push(wrapped);
    return wrapped;
  }

  async disposeCollectingErrors(): Promise<unknown[]> {
    if (this.#disposed) return [];
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const disposer of [...this.#owned].reverse()) {
      try {
        await disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#owned.length = 0;
    return errors;
  }
}

class RuntimeSlotStore {
  readonly #entries: RuntimeEntry[] = [];
  readonly #declared = new Map<string, AnySlotToken>();
  readonly #routes: RuntimeRouteStore;

  constructor(routes: RuntimeRouteStore) {
    this.#routes = routes;
    for (const token of Object.values(slots) as AnySlotToken[]) {
      this.#declared.set(slotIdentity(token), token);
    }
  }

  transaction(module: Readonly<ModuleInstanceContext>, lifecycle: RuntimeLifecycle): RuntimeSlotTransaction {
    return new RuntimeSlotTransaction(this, module, lifecycle);
  }

  prepare(staged: readonly RuntimeEntry[]): readonly RuntimeEntry[] {
    const candidateEntries = [...this.#entries];
    const candidateDeclarations = new Map(this.#declared);
    for (const entry of staged) {
      const identity = slotIdentity(entry.token);
      const declared = candidateDeclarations.get(identity);
      if (!declared || declared !== entry.token) {
        throw new Error(`Slot is not declared by ViewHost or an owning Entry: ${identity}`);
      }
      assertNoSlotConflict(candidateEntries, entry);
      candidateEntries.push(entry);
      for (const child of entry.children) {
        validateChildSlot(entry, child, candidateDeclarations);
        candidateDeclarations.set(slotIdentity(child), child);
      }
    }
    return staged;
  }

  commit(entries: readonly RuntimeEntry[]): void {
    for (const entry of entries) {
      this.#entries.push(entry);
      for (const child of entry.children) this.#declared.set(slotIdentity(child), child);
    }
  }

  remove(entry: RuntimeEntry): void {
    for (const child of entry.children) this.#removeSlotTree(child);
    const index = this.#entries.indexOf(entry);
    if (index >= 0) this.#entries.splice(index, 1);
  }

  entry(token: AnySlotToken, key: string, location: RouteLocation): RuntimeEntry | undefined {
    return this.#entries
      .filter(candidate => (
        candidate.token === token
        && candidate.key === key
        && this.#routes.isActive(candidate.when, location)
      ))
      .sort(compareEntries)[0];
  }

  entries(token: AnySlotToken, location: RouteLocation): readonly RuntimeEntry[] {
    return this.#entries
      .filter(candidate => candidate.token === token && this.#routes.isActive(candidate.when, location))
      .sort(compareEntries);
  }

  snapshot(): ViewHostDiagnosticSnapshot["entries"] {
    return Object.freeze([...this.#entries].sort(compareEntries).map(entry => Object.freeze({
      slot: slotIdentity(entry.token),
      id: entry.id,
      ...(entry.key === undefined ? {} : { key: entry.key }),
      order: entry.order,
      identity: entry.identity,
      owner: entry.owner
    })));
  }

  #removeSlotTree(token: AnySlotToken): void {
    const entries = this.#entries.filter(entry => entry.token === token);
    for (const entry of entries) this.remove(entry);
    this.#declared.delete(slotIdentity(token));
  }
}

class RuntimeSlotTransaction implements SlotRegistry {
  readonly #store: RuntimeSlotStore;
  readonly #module: Readonly<ModuleInstanceContext>;
  readonly #lifecycle: RuntimeLifecycle;
  readonly #staged: RuntimeEntry[] = [];
  #state: "open" | "committed" | "rolled-back" = "open";

  constructor(
    store: RuntimeSlotStore,
    module: Readonly<ModuleInstanceContext>,
    lifecycle: RuntimeLifecycle,
  ) {
    this.#store = store;
    this.#module = module;
    this.#lifecycle = lifecycle;
  }

  register(
    token: AnySlotToken,
    options: RegisterOptions<unknown> | KeyedRegisterOptions<unknown, string>,
  ): Disposer {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    validateSlotRegistration(token, options);
    const extended = options as typeof options & { readonly when?: RouteActivation };
    const key = "key" in options ? options.key : undefined;
    const owner = moduleIdentity(this.#module);
    const entry: RuntimeEntry = {
      token,
      id: options.id,
      ...(key === undefined ? {} : { key }),
      order: options.order ?? 0,
      value: options.value,
      ...(extended.when === undefined ? {} : { when: extended.when }),
      children: Object.freeze([...(options.children ?? [])]),
      identity: [owner, slotIdentity(token), options.id, key]
        .filter(value => value !== undefined).join(":"),
      owner
    };
    assertNoSlotConflict(this.#staged, entry);
    this.#staged.push(entry);
    return this.#lifecycle.own(() => {
      if (this.#state === "committed") this.#store.remove(entry);
      else {
        const index = this.#staged.indexOf(entry);
        if (index >= 0) this.#staged.splice(index, 1);
      }
    });
  }

  prepare(): readonly RuntimeEntry[] {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    return this.#store.prepare(this.#staged);
  }

  commit(prepared: readonly RuntimeEntry[]): void {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    this.#store.commit(prepared);
    this.#state = "committed";
  }
}

class RuntimeRouteStore {
  readonly #routes: RuntimeRoute[] = [];
  #location: RouteLocation;
  readonly #activationKeys = new WeakMap<RouteActivation, string>();
  readonly #targetPaths = new WeakMap<RouteTarget, string>();
  #navigate: ((target: RouteTarget, replace: boolean) => Promise<void>) | undefined;

  constructor(location: RouteLocation) {
    this.#location = freezeLocation(location);
  }

  get location(): RouteLocation {
    return this.#location;
  }

  setNavigator(navigate: (target: RouteTarget, replace: boolean) => Promise<void>): void {
    this.#navigate = navigate;
  }

  navigate(target: RouteTarget, replace = false): Promise<void> {
    if (!this.#navigate) throw new Error("ViewHost navigation is not ready");
    return this.#navigate(target, replace);
  }

  updateLocation(location: RouteLocation): void {
    const matched = this.match(location.pathname);
    const route = matched?.route;
    const params = matched ? matchRouteParams(matched) : Object.freeze({});
    this.#location = freezeLocation({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      params,
      ...(route ? { routeKey: route.key } : {})
    });
    if (matched && matched.matchedPath !== route?.path) {
      const canonicalPath = fillRoutePath(route!, params);
      globalThis.history?.replaceState({}, "", canonicalPath + location.search + location.hash);
      this.#location = freezeLocation({
        pathname: canonicalPath,
        search: location.search,
        hash: location.hash,
        params,
        routeKey: route!.key
      });
    }
  }

  transaction(
    module: Readonly<ModuleInstanceContext>,
    lifecycle: RuntimeLifecycle,
    basePath: string,
    grants?: readonly ViewRouteGrant[],
  ): RuntimeRouteTransaction {
    return new RuntimeRouteTransaction(this, module, lifecycle, basePath, grants);
  }

  prepare(staged: readonly RuntimeRoute[]): readonly RuntimeRoute[] {
    const candidates = [...this.#routes];
    for (const route of staged) {
      if (candidates.some(candidate => candidate.key === route.key)) {
        throw new Error(`Route key conflicts: ${route.key}`);
      }
      const candidatePaths = new Set(candidates.flatMap(candidate => candidate.patterns.map(pattern => pattern.path)));
      const conflict = route.patterns.find(pattern => candidatePaths.has(pattern.path));
      if (conflict) {
        throw new Error(`Route path conflicts: ${conflict.path}`);
      }
      candidates.push(route);
    }
    return staged;
  }

  commit(routes: readonly RuntimeRoute[]): void {
    this.#routes.push(...routes);
  }

  remove(route: RuntimeRoute): void {
    const index = this.#routes.indexOf(route);
    if (index >= 0) this.#routes.splice(index, 1);
  }

  match(pathname: string): RuntimeRouteMatch | undefined {
    for (const route of [...this.#routes].sort(compareRoutes)) {
      for (const candidate of route.patterns) {
        const match = candidate.pattern.exec(pathname);
        if (match) return { route, matchedPath: candidate.path, match };
      }
    }
    return undefined;
  }

  isActive(activation: RouteActivation | undefined, location: RouteLocation): boolean {
    if (activation === undefined) return true;
    const key = this.#activationKeys.get(activation);
    return key !== undefined && this.match(location.pathname)?.route.key === key;
  }

  createActivation(key: string): RouteActivation {
    const activation = createHostRouteActivation();
    this.#activationKeys.set(activation, key);
    return activation;
  }

  createTarget(path: string): RouteTarget {
    const target = createHostRouteTarget();
    this.#targetPaths.set(target, path);
    return target;
  }

  targetPath(target: RouteTarget): string | undefined {
    return this.#targetPaths.get(target);
  }

  snapshot(): ViewHostDiagnosticSnapshot["routes"] {
    return Object.freeze([...this.#routes].sort(compareRoutes).map(route => Object.freeze({
      key: route.key,
      path: route.path,
      owner: route.owner
    })));
  }

  owner(pathname: string): string | undefined {
    return this.match(pathname)?.route.owner;
  }
}

class RuntimeRouteTransaction implements ViewRouter {
  readonly #store: RuntimeRouteStore;
  readonly #module: Readonly<ModuleInstanceContext>;
  readonly #lifecycle: RuntimeLifecycle;
  readonly #basePath: string;
  readonly #grants: ReadonlyMap<string, ViewRouteGrant> | undefined;
  readonly #staged: RuntimeRoute[] = [];
  #state: "open" | "committed" = "open";

  constructor(
    store: RuntimeRouteStore,
    module: Readonly<ModuleInstanceContext>,
    lifecycle: RuntimeLifecycle,
    basePath: string,
    grants?: readonly ViewRouteGrant[],
  ) {
    this.#store = store;
    this.#module = module;
    this.#lifecycle = lifecycle;
    this.#basePath = normalizeBasePath(basePath);
    this.#grants = grants === undefined ? undefined : validateRouteGrants(grants);
  }

  get location(): RouteLocation {
    return this.#store.location;
  }

  register(definition: RouteDefinition): RouteToken {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    validateRouteDefinition(definition);
    if (this.#staged.some(route => route.id === definition.id)) {
      throw new Error(`Route id conflicts in Module instance: ${definition.id}`);
    }
    const owner = moduleIdentity(this.#module);
    const key = `${owner}:route:${definition.id}`;
    const grant = this.#grants?.get(definition.id);
    if (this.#grants && !grant) throw new Error(`Route is not granted to built-in Module: ${definition.id}`);
    if (grant && definition.path !== grant.path) {
      throw new Error(`Route path does not match built-in grant ${definition.id}: ${definition.path}`);
    }
    const template = grant?.path ?? joinRoutePath(this.#basePath, definition.path);
    const compiled = compileRoute(template);
    const aliases = (grant?.aliases ?? []).map(alias => ({ path: alias, ...compileRoute(alias) }));
    for (const alias of aliases) {
      if (alias.parameterNames.join("\0") !== compiled.parameterNames.join("\0")) {
        throw new Error(`Route alias parameters must match canonical route ${definition.id}: ${alias.path}`);
      }
    }
    const activation = this.#store.createActivation(key);
    const route: RuntimeRoute = {
      id: definition.id,
      key,
      path: template,
      patterns: Object.freeze([
        Object.freeze({ path: template, pattern: compiled.pattern }),
        ...aliases.map(alias => Object.freeze({ path: alias.path, pattern: alias.pattern }))
      ]),
      parameterNames: compiled.parameterNames,
      activation,
      owner
    };
    this.#staged.push(route);
    this.#lifecycle.own(() => this.#store.remove(route));
    return Object.freeze({
      key,
      activation,
      to: (params: Readonly<Record<string, string>> = {}) => (
        this.#store.createTarget(fillRoutePath(route, params))
      )
    });
  }

  async navigate(target: RouteTarget): Promise<void> {
    await this.#store.navigate(target);
  }

  prepare(): readonly RuntimeRoute[] {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    return this.#store.prepare(this.#staged);
  }

  commit(prepared: readonly RuntimeRoute[]): void {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    this.#store.commit(prepared);
    this.#state = "committed";
  }

  rollbackCommit(prepared: readonly RuntimeRoute[]): void {
    for (const route of prepared) this.#store.remove(route);
  }
}

type RuntimePluginInstance = {
  readonly owner: string;
  readonly module: Readonly<ModuleInstanceContext>;
  readonly lifecycle: RuntimeLifecycle;
};

type RuntimeActiveMount = {
  readonly entry: RuntimeEntry;
  readonly element: HTMLElement;
  readonly portal: HTMLElement;
  readonly locationIdentity: string;
  readonly disposer?: Disposer;
};

function routeLocationIdentity(location: Readonly<RouteLocation>): string {
  return `${location.pathname}\u0000${location.search}\u0000${location.hash}\u0000${JSON.stringify(location.params)}`;
}

async function disposeActiveMount(mount: RuntimeActiveMount | undefined): Promise<void> {
  if (!mount) return;
  try {
    await mount.disposer?.();
  } finally {
    mount.element.remove();
    mount.portal.remove();
  }
}

function moduleForOwner(
  instances: readonly RuntimePluginInstance[],
  owner: string,
): Readonly<ModuleInstanceContext> {
  const instance = instances.find(candidate => candidate.owner === owner);
  if (!instance) throw new Error(`ViewHost cannot resolve owner for Mount: ${owner}`);
  return instance.module;
}

function renderShellDescriptors(
  root: HTMLElement,
  slotStore: RuntimeSlotStore,
  routeStore: RuntimeRouteStore,
): void {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  if (!shell) return;
  const location = routeStore.location;
  const navigation = shell.querySelector<HTMLElement>('[data-view-slot="navigation.primary"]');
  const title = shell.querySelector<HTMLElement>('[data-view-slot="header.title"]');
  const actions = shell.querySelector<HTMLElement>('[data-view-slot="header.actions"]');

  if (navigation) {
    navigation.replaceChildren(...slotStore.entries(slots.navigationPrimary, location).map(entry => {
      const descriptor = entry.value as NavigationItemDescriptor;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "view-shell-navigation-item";
      button.dataset.viewEntry = entry.identity;
      button.append(renderIcon(descriptor.icon), textNode(descriptor.label));
      if (descriptor.badge) {
        const badge = document.createElement("span");
        badge.className = "view-shell-navigation-badge";
        badge.textContent = textValue(descriptor.badge);
        button.append(badge);
      }
      const targetPath = routeStore.targetPath(descriptor.route);
      const active = targetPath !== undefined && routePathname(targetPath) === location.pathname;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
      button.addEventListener("click", () => {
        void routeStore.navigate(descriptor.route).catch(error => renderShellNavigationError(root, error));
      });
      return button;
    }));
  }

  if (title) {
    const entry = slotStore.entries(slots.headerTitle, location)[0];
    title.replaceChildren();
    if (entry) title.append(renderHeaderTitle(entry.value as HeaderTitleDescriptor, root, routeStore));
  }

  if (actions) {
    actions.replaceChildren(...slotStore.entries(slots.headerActions, location).map(entry => (
      renderHeaderAction(entry.value as HeaderActionDescriptor, entry.identity)
    )));
  }
}

function renderHeaderTitle(
  descriptor: HeaderTitleDescriptor,
  root: HTMLElement,
  routeStore: RuntimeRouteStore,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "view-shell-heading";
  if (descriptor.breadcrumbs?.length) {
    const breadcrumbs = document.createElement("nav");
    breadcrumbs.className = "view-shell-breadcrumbs";
    breadcrumbs.setAttribute("aria-label", "Breadcrumb");
    for (const [index, breadcrumb] of descriptor.breadcrumbs.entries()) {
      if (index > 0) breadcrumbs.append(document.createTextNode(" / "));
      if (breadcrumb.route) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = textValue(breadcrumb.label);
        button.addEventListener("click", () => {
          void routeStore.navigate(breadcrumb.route!).catch(error => renderShellNavigationError(root, error));
        });
        breadcrumbs.append(button);
      } else {
        breadcrumbs.append(textNode(breadcrumb.label));
      }
    }
    container.append(breadcrumbs);
  }
  const heading = document.createElement("h1");
  heading.textContent = textValue(descriptor.title);
  container.append(heading);
  if (descriptor.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.textContent = textValue(descriptor.subtitle);
    container.append(subtitle);
  }
  return container;
}

function renderHeaderAction(descriptor: HeaderActionDescriptor, identity: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "view-shell-action";
  button.dataset.viewEntry = identity;
  button.disabled = descriptor.disabled === true;
  if (descriptor.icon) button.append(renderIcon(descriptor.icon));
  button.append(textNode(descriptor.label));
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.removeAttribute("data-view-action-error");
    button.removeAttribute("title");
    try {
      await descriptor.run();
    } catch (error) {
      const message = errorMessage(error);
      button.dataset.viewActionError = message;
      button.title = message;
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = descriptor.disabled === true;
    }
  });
  return button;
}

function renderIcon(icon: IconRef): HTMLElement {
  if (icon.kind === "asset") {
    const image = document.createElement("img");
    image.className = "view-shell-icon";
    image.src = icon.url;
    image.alt = textValue(icon.alt);
    return image;
  }
  const span = document.createElement("span");
  span.className = "view-shell-icon";
  span.dataset.systemIcon = icon.name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function textNode(value: TextRef): Text {
  return document.createTextNode(textValue(value));
}

function textValue(value: TextRef): string {
  if ("text" in value) return value.text;
  return value.key.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(value.params?.[name] ?? `{${name}}`));
}

function renderShellNavigationError(root: HTMLElement, error: unknown): void {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  const actions = shell?.querySelector<HTMLElement>('[data-view-slot="header.actions"]');
  if (!actions) {
    console.error("ViewHost navigation failed", error);
    return;
  }
  let status = actions.querySelector<HTMLElement>("[data-view-navigation-error]");
  if (!status) {
    status = document.createElement("span");
    status.dataset.viewNavigationError = "true";
    status.className = "view-shell-navigation-error";
    status.setAttribute("role", "alert");
    actions.append(status);
  }
  status.textContent = errorMessage(error);
}

function validateSlotRegistration(
  token: AnySlotToken,
  options: RegisterOptions<unknown> | KeyedRegisterOptions<unknown, string>,
): void {
  if (!isSlotToken(token)) throw new Error("Slot registration requires a valid Slot Token");
  if (!options || typeof options !== "object") throw new Error("Slot registration options are required");
  if (typeof options.id !== "string" || !options.id.trim()) throw new Error("Slot Entry id must be non-empty");
  if (options.order !== undefined && !Number.isFinite(options.order)) throw new Error("Slot Entry order must be finite");
  if (!token.definition.validate(options.value)) {
    throw new Error(`Slot ${slotIdentity(token)} rejected Entry value`);
  }
  for (const child of options.children ?? []) {
    if (!isSlotToken(child)) throw new Error("Child Slot declaration requires a valid Slot Token");
  }

  const key = "key" in options ? options.key : undefined;
  if (token.definition.kind === "keyed") {
    if (typeof key !== "string" || !key.trim()) throw new Error(`Slot ${slotIdentity(token)} requires a key`);
  } else if (key !== undefined) {
    throw new Error(`Slot ${slotIdentity(token)} does not accept a key`);
  }
}

function assertNoSlotConflict(entries: readonly RuntimeEntry[], candidate: RuntimeEntry): void {
  const sameSlot = entries.filter(entry => entry.token === candidate.token);
  const conflict = candidate.token.definition.kind === "single"
    ? sameSlot.some(entry => (
      entry.when === undefined || candidate.when === undefined || entry.when === candidate.when
    ))
    : candidate.token.definition.kind === "keyed"
      ? sameSlot.some(entry => entry.key === candidate.key)
      : sameSlot.some(entry => entry.owner === candidate.owner && entry.id === candidate.id);
  if (conflict) {
    throw new Error(`Slot Entry conflicts in ${slotIdentity(candidate.token)}: ${candidate.key ?? candidate.id}`);
  }
}

function validateChildSlot(
  parent: RuntimeEntry,
  child: AnySlotToken,
  declarations: ReadonlyMap<string, AnySlotToken>,
): void {
  const identity = slotIdentity(child);
  if (!child.definition.name.startsWith(`${parent.owner.split("@")[0]}.`)) {
    throw new Error(`Child Slot name must use owner Module id prefix: ${identity}`);
  }
  if (declarations.has(identity)) throw new Error(`Slot is already declared: ${identity}`);
}

function compareEntries(left: RuntimeEntry, right: RuntimeEntry): number {
  return left.order - right.order || left.identity.localeCompare(right.identity);
}

function compareRoutes(left: RuntimeRoute, right: RuntimeRoute): number {
  return routeSpecificity(right.path) - routeSpecificity(left.path) || left.key.localeCompare(right.key);
}

function routeSpecificity(path: string): number {
  return path.split("/").filter(Boolean).reduce((score, segment) => score + (segment.startsWith(":") ? 1 : 10), 0);
}

function validateRouteDefinition(definition: RouteDefinition): void {
  if (!definition || typeof definition !== "object") throw new Error("Route definition is required");
  if (typeof definition.id !== "string" || !definition.id.trim()) throw new Error("Route id must be non-empty");
  if (typeof definition.path !== "string" || !definition.path.startsWith("/")) {
    throw new Error("Route path must start with /");
  }
  if (definition.path.includes("?") || definition.path.includes("#") || definition.path.split("/").includes("..")) {
    throw new Error(`Route path is not a safe relative path: ${definition.path}`);
  }
}

function normalizeBasePath(path: string): string {
  if (!path.startsWith("/")) throw new Error(`Route base path must be absolute: ${path}`);
  return path === "/" ? "/" : path.replace(/\/+$/, "");
}

function joinRoutePath(base: string, relative: string): string {
  const suffix = relative === "/" ? "" : relative;
  return base === "/" ? (suffix || "/") : `${base}${suffix}`;
}

function compileRoute(path: string): { pattern: RegExp; parameterNames: readonly string[] } {
  const parameterNames: string[] = [];
  const source = path.split("/").map(segment => {
    if (!segment.startsWith(":")) return escapeRegExp(segment);
    const name = segment.slice(1);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid Route parameter: ${segment}`);
    parameterNames.push(name);
    return "([^/]+)";
  }).join("/");
  return { pattern: new RegExp(`^${source}/?$`), parameterNames: Object.freeze(parameterNames) };
}

function fillRoutePath(route: RuntimeRoute, params: Readonly<Record<string, string>>): string {
  let result = route.path;
  for (const name of route.parameterNames) {
    const value = params[name];
    if (value === undefined) throw new Error(`Route parameter is required: ${name}`);
    result = result.replace(`:${name}`, encodeURIComponent(value));
  }
  return result;
}

function matchRouteParams(matched: RuntimeRouteMatch): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  matched.route.parameterNames.forEach((name, index) => {
    const raw = matched.match[index + 1] ?? "";
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  });
  return Object.freeze(params);
}

function validateRouteGrants(grants: readonly ViewRouteGrant[]): ReadonlyMap<string, ViewRouteGrant> {
  const result = new Map<string, ViewRouteGrant>();
  const paths = new Set<string>();
  for (const grant of grants) {
    if (!grant || typeof grant !== "object") throw new Error("Built-in Route grant must be an object");
    if (typeof grant.id !== "string" || !grant.id.trim()) throw new Error("Built-in Route grant id must be non-empty");
    if (result.has(grant.id)) throw new Error(`Built-in Route grant id conflicts: ${grant.id}`);
    validateGrantedRoutePath(grant.path);
    for (const path of [grant.path, ...(grant.aliases ?? [])]) {
      validateGrantedRoutePath(path);
      if (paths.has(path)) throw new Error(`Built-in Route grant path conflicts: ${path}`);
      paths.add(path);
    }
    result.set(grant.id, Object.freeze({
      id: grant.id,
      path: grant.path,
      ...(grant.aliases === undefined ? {} : { aliases: Object.freeze([...grant.aliases]) })
    }));
  }
  return result;
}

function validateGrantedRoutePath(path: string): void {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error(`Built-in Route grant must be an absolute pathname: ${String(path)}`);
  }
  compileRoute(path);
}

function freezeLocation(location: RouteLocation): RouteLocation {
  return Object.freeze({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    params: Object.freeze({ ...location.params }),
    ...(location.routeKey === undefined ? {} : { routeKey: location.routeKey })
  });
}

function browserLocation(): RouteLocation {
  return {
    pathname: globalThis.location?.pathname ?? "/",
    search: globalThis.location?.search ?? "",
    hash: globalThis.location?.hash ?? "",
    params: Object.freeze({})
  };
}

function routePathname(path: string): string {
  try {
    return new URL(path, globalThis.location?.href ?? "http://localhost/").pathname;
  } catch {
    return path.split(/[?#]/, 1)[0] ?? path;
  }
}

function moduleRouteBase(module: Readonly<ModuleInstanceContext>): string {
  return `/projects/${encodeURIComponent(module.projectId)}/modules/${encodeURIComponent(module.instanceId)}`;
}

function moduleIdentity(module: Readonly<ModuleInstanceContext>): string {
  return `${module.moduleId}@${module.moduleVersion}:${module.instanceId}`;
}

function slotIdentity(token: AnySlotToken): string {
  return `${token.definition.name}@${token.definition.version}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function diagnosticMessage(error: unknown, cleanupErrors: readonly unknown[]): string {
  const primary = errorMessage(error);
  if (!cleanupErrors.length) return primary;
  return `${primary}; cleanup failed: ${cleanupErrors.map(errorMessage).join("; ")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
