import {
  createHostRouteActivation,
  createHostRouteProjection,
  createHostRouteTarget,
  isSearchResultDescriptor,
  isSlotToken,
  slots,
  type Disposer,
  type ConfirmationDescriptor,
  type KeyedRegisterOptions,
  type HeaderActionDescriptor,
  type HeaderAccountDescriptor,
  type HeaderTitleDescriptor,
  type HomeAttentionItemDescriptor,
  type HomeContinueItemDescriptor,
  type HomeModuleItemDescriptor,
  type IconRef,
  type ModuleInstanceContext,
  type NavigationItemDescriptor,
  type OverlayMountDescriptor,
  type RegisterOptions,
  type RouteActivation,
  type RouteDefinition,
  type RouteLocation,
  type RouteProjection,
  type RouteProjectionOptions,
  type RouteTarget,
  type RouteTargetOptions,
  type RouteToken,
  type SlotKind,
  type SlotRegistry,
  type SlotToken,
  type SearchProviderDescriptor,
  type SearchResultDescriptor,
  type SecondaryNavigationDescriptor,
  type SidePanelDescriptor,
  type SidebarFooterDescriptor,
  type TextRef,
  type ViewLifecycle,
  type ViewMount,
  type ViewPlugin,
  type ViewPluginContext,
  type ViewRouter,
  type ViewServiceName
} from "./view-sdk.js";
import { applyViewThemeRoots, RuntimeThemeStore } from "./theme.js";
import { createCorePlugin } from "./core-plugin.js";
import { coreViewRoutes } from "./core-routes.js";
import { createHomeMount, type HomeSnapshotReader } from "./shell/home.js";
import { createPrimitiveButton, createViewUi, renderPrimitiveIcon } from "./ui-primitives.js";

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
  readonly epoch?: number;
};

type RuntimeRouteProjection = {
  readonly from: RuntimeRoute;
  readonly to: RuntimeRoute;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly hash: "discard" | "preserve";
  readonly owner: string;
};

type RuntimeRoute = {
  readonly id: string;
  readonly key: string;
  readonly path: string;
  readonly patterns: readonly { readonly path: string; readonly pattern: RegExp }[];
  readonly parameterNames: readonly string[];
  readonly queryKeys: readonly string[];
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
  readonly query?: readonly string[];
}

export interface ViewPluginInstanceOptions<Config = unknown> {
  readonly plugin: unknown;
  readonly config: Readonly<Config>;
  readonly module: Readonly<ModuleInstanceContext>;
  /** Core may use a reserved base for built-ins; user Modules use their instance base. */
  readonly routeBasePath?: string;
  /** Core-owned allowlist for reserved built-in routes. */
  readonly routeGrants?: readonly ViewRouteGrant[];
  readonly home?: {
    readonly title: string;
    readonly summary: string;
    readonly icon: string;
    readonly routeId: string;
    readonly routeParams?: Readonly<Record<string, string>>;
  };
}

export interface StartViewHostOptions {
  readonly instances: readonly ViewPluginInstanceOptions[];
  readonly root: HTMLElement;
  readonly mainViewKey?: string;
  readonly location?: RouteLocation;
  readonly coreConfig?: {
    readonly locale?: string;
    readonly messages?: Readonly<Record<string, unknown>>;
  };
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
  confirm(confirmation: ConfirmationDescriptor): Promise<boolean>;
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

const supportedServices = new Set<ViewServiceName>(["slots", "router", "theme", "ui"]);

/**
 * Compose all enabled Module instances into one shared Route/Slot runtime.
 * An instance failure rolls back only that instance; healthy instances remain active.
 */
export async function startViewHost(options: StartViewHostOptions): Promise<ActiveViewHost> {
  const initialLocation = options.location ?? {
    pathname: globalThis.location?.pathname ?? "/",
    search: globalThis.location?.search ?? "",
    hash: globalThis.location?.hash ?? "",
    params: Object.freeze({}),
    query: Object.freeze({})
  };
  const routeRegistry = new RuntimeRouteStore(initialLocation);
  const slotsRegistry = new RuntimeSlotStore(routeRegistry);
  const themeStore = new RuntimeThemeStore();
  const hostThemeLifecycle = new RuntimeLifecycle();
  const hostThemeCleanup = applyViewThemeRoots(
    themeStore.scoped(hostThemeLifecycle),
    options.root.closest<HTMLElement>("[data-view-shell]") ?? options.root,
  );
  const instances: RuntimePluginInstance[] = [];
  const diagnostics: ViewInstanceDiagnostic[] = [];
  let activeListMount: RuntimeActiveMount | undefined;
  let activeMainMount: RuntimeActiveMount | undefined;
  let activeOverlayMount: RuntimeActiveMount | undefined;
  let pendingOverlayRestore: Disposer | undefined;
  let navigationInProgress = false;
  let disposed = false;
  let disposeSearch: Disposer = () => undefined;
  let disposeLiveSlots: Disposer = () => undefined;
  let navigationQueue = Promise.resolve();
  let composeCurrentLocation: () => Promise<void> = async () => {
    throw new Error("ViewHost navigation is not ready");
  };

  const flushPendingOverlayRestore = async (): Promise<void> => {
    const restore = pendingOverlayRestore;
    pendingOverlayRestore = undefined;
    await restore?.();
  };

  routeRegistry.setNavigator(async (target, replace, preserveScroll) => {
    const path = routeRegistry.targetPath(target);
    if (path === undefined) throw new Error("Route target was not created by this ViewHost");
    globalThis.history?.[replace ? "replaceState" : "pushState"]({}, "", path);
    navigationInProgress = true;
    try {
      await composeCurrentLocation();
      if (preserveScroll) await flushPendingOverlayRestore();
      else {
        pendingOverlayRestore = undefined;
        globalThis.scrollTo?.(0, 0);
      }
    } finally {
      navigationInProgress = false;
    }
  });

  const coreMessages = options.coreConfig?.messages ?? {};
  const homeReader: HomeSnapshotReader = Object.freeze({
    snapshot: () => Object.freeze({
      attention: Object.freeze(slotsRegistry.entries(slots.homeAttention, routeRegistry.location).map(entry => entry.value as HomeAttentionItemDescriptor)),
      continueItems: Object.freeze(slotsRegistry.entries(slots.homeContinue, routeRegistry.location).map(entry => entry.value as HomeContinueItemDescriptor)),
      modules: Object.freeze(options.instances.flatMap(instance => {
        if (!instance.home) return [];
        const owner = moduleIdentity(instance.module);
        const target = routeRegistry.targetFor(owner, instance.home.routeId, instance.home.routeParams ?? {});
        if (!target) return [];
        const diagnosticStatus = diagnostics.find(item => moduleIdentity(item.module) === owner)?.status;
        const status = diagnosticStatus === "active" ? "ready" as const : "failed" as const;
        return [Object.freeze({
          title: { text: instance.home.title },
          summary: { text: instance.home.summary },
          icon: { kind: "system" as const, name: instance.home.icon },
          route: target,
          status
        })];
      }))
    }),
    subscribe: (listener: () => void) => slotsRegistry.subscribe(listener),
    navigate: (target: RouteTarget) => routeRegistry.navigate(target)
  });
  const coreProjectId = options.instances[0]?.module.projectId ?? "memsphere";
  const coreModule: Readonly<ModuleInstanceContext> = Object.freeze({
    projectId: coreProjectId,
    moduleId: "org.memsphere.core",
    moduleVersion: "1.0.0",
    instanceId: "core"
  });
  const coreInstance: ViewPluginInstanceOptions = {
    plugin: createCorePlugin({
      homeMount: createHomeMount(homeReader, coreMessages),
      messages: coreMessages,
      projectName: coreProjectId
    }),
    config: Object.freeze({}),
    module: coreModule,
    routeBasePath: `/projects/${encodeURIComponent(coreProjectId)}`,
    routeGrants: coreViewRoutes
  };
  const allInstances: readonly ViewPluginInstanceOptions[] = options.coreConfig
    ? [coreInstance, ...options.instances]
    : options.instances;
  const hostUi = createViewUi(target => routeRegistry.navigate(target));

  for (const instanceOptions of allInstances) {
    const module = Object.freeze({ ...instanceOptions.module });
    const lifecycle = new RuntimeLifecycle();
    const theme = themeStore.scoped(lifecycle);
    const ui = hostUi;
    const owner = moduleIdentity(module);
    const slotTransaction = slotsRegistry.transaction(module, lifecycle);
    const routeTransaction = routeRegistry.transaction(
      module,
      lifecycle,
      instanceOptions.routeBasePath ?? moduleRouteBase(module),
      instanceOptions.routeGrants,
      instanceOptions.routeBasePath !== undefined
    );

    try {
      const plugin = validatePlugin(instanceOptions.plugin);
      validateServices(plugin);
      validateThemeVersion(plugin);
      validateUiVersion(plugin);
      const context = Object.freeze({
        module,
        lifecycle,
        ...(plugin.inject.includes("slots") ? { slots: slotTransaction } : {}),
        ...(plugin.inject.includes("router") ? { router: routeTransaction } : {}),
        ...(plugin.inject.includes("theme") ? { theme } : {}),
        ...(plugin.inject.includes("ui") ? { ui } : {})
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
      instances.push({ owner, module, lifecycle, theme });
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
        const failureRoutes = routeRegistry.transaction(
          module,
          failureLifecycle,
          instanceOptions.routeBasePath ?? moduleRouteBase(module),
          instanceOptions.routeGrants,
          instanceOptions.routeBasePath !== undefined
        );
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
          instances.push({ owner, module, lifecycle: failureLifecycle, theme: themeStore.scoped(failureLifecycle) });
        } catch (fallbackError) {
          cleanupErrors.push(fallbackError, ...await failureLifecycle.disposeCollectingErrors());
        }
      }
    }
  }

  const activateMainEntry = async (entry: RuntimeEntry, location: RouteLocation): Promise<void> => {
    const locationIdentity = routeLocationIdentity(location);
    if (activeMainMount?.entry === entry && activeMainMount.locationIdentity === locationIdentity) return;
    const mount = entry.value as ViewMount;
    const current = activeMainMount;
    if (current && current.entry.value === entry.value && mount.update) {
      await mount.update({ module: moduleForOwner(instances, entry.owner), route: location, theme: themeForOwner(instances, entry.owner) });
      current.entry = entry;
      current.locationIdentity = locationIdentity;
      current.element.dataset.viewMount = entry.identity;
      current.element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
      return;
    }
    const previous = activeMainMount;
    const element = document.createElement("div");
    element.className = "view-host-mount";
    element.dataset.viewMount = entry.identity;
    element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
    const portal = document.createElement("div");
    portal.className = "view-host-nested-portal";
    portal.dataset.viewPortal = entry.identity;
    const pagePortalRoot = options.root.closest<HTMLElement>("[data-view-shell]")?.querySelector<HTMLElement>("[data-view-page-portals]");
    (pagePortalRoot ?? document.body).append(portal);
    const themeCleanup = applyViewThemeRoots(themeForOwner(instances, entry.owner), element, portal);
    try {
      const disposer = await mount.mount(
        { element, portal },
        { module: moduleForOwner(instances, entry.owner), route: location, theme: themeForOwner(instances, entry.owner) }
      );
      if (disposer !== undefined && typeof disposer !== "function") throw new Error("View Mount must return void or a disposer");
      activeMainMount = undefined;
      await disposeActiveMount(previous);
      options.root.replaceChildren(element);
      activeMainMount = { entry, element, portal, locationIdentity, themeCleanup, ...(disposer ? { disposer } : {}) };
    } catch (error) {
      themeCleanup();
      portal.remove();
      element.remove();
      activeMainMount = undefined;
      await disposeActiveMount(previous);
      renderRuntimePageFailure(options.root, moduleForOwner(instances, entry.owner), errorMessage(error), () => activeHost.activateMainView());
    }
  };

  const activateListEntry = async (entry: RuntimeEntry, location: RouteLocation): Promise<void> => {
    const shell = options.root.closest<HTMLElement>("[data-view-shell]");
    const host = shell?.querySelector<HTMLElement>('[data-view-slot="content.list"]');
    if (!host) throw new Error("ViewHost Shell does not provide the content.list Slot container");
    const locationIdentity = routeLocationIdentity(location);
    if (activeListMount?.entry === entry && activeListMount.locationIdentity === locationIdentity) return;
    const mount = entry.value as ViewMount;
    const current = activeListMount;
    if (current && current.entry.value === entry.value && mount.update) {
      try {
        await mount.update({ module: moduleForOwner(instances, entry.owner), route: location, theme: themeForOwner(instances, entry.owner) });
        current.entry = entry;
        current.locationIdentity = locationIdentity;
        current.element.dataset.viewMount = entry.identity;
        current.element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
      } catch (error) {
        activeListMount = undefined;
        await disposeActiveMount(current);
        renderRuntimePageFailure(host, moduleForOwner(instances, entry.owner), errorMessage(error), () => activeHost.activateMainView());
      }
      return;
    }
    const element = document.createElement("div");
    element.className = "view-host-list-mount";
    element.dataset.viewMount = entry.identity;
    element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
    const portal = document.createElement("div");
    portal.className = "view-host-list-portal";
    portal.dataset.viewPortal = entry.identity;
    const pagePortalRoot = shell?.querySelector<HTMLElement>("[data-view-page-portals]");
    (pagePortalRoot ?? document.body).append(portal);
    const themeCleanup = applyViewThemeRoots(themeForOwner(instances, entry.owner), element, portal);
    try {
      const disposer = await mount.mount(
        { element, portal },
        { module: moduleForOwner(instances, entry.owner), route: location, theme: themeForOwner(instances, entry.owner) }
      );
      if (disposer !== undefined && typeof disposer !== "function") throw new Error("View Mount must return void or a disposer");
      const previous = activeListMount;
      activeListMount = undefined;
      await disposeActiveMount(previous);
      host.replaceChildren(element);
      activeListMount = { entry, element, portal, locationIdentity, themeCleanup, ...(disposer ? { disposer } : {}) };
    } catch (error) {
      themeCleanup();
      portal.remove();
      element.remove();
      const previous = activeListMount;
      activeListMount = undefined;
      await disposeActiveMount(previous);
      renderRuntimePageFailure(host, moduleForOwner(instances, entry.owner), errorMessage(error), () => activeHost.activateMainView());
    }
  };

  const clearListMount = async (): Promise<void> => {
    const previous = activeListMount;
    activeListMount = undefined;
    await disposeActiveMount(previous);
    options.root.closest<HTMLElement>("[data-view-shell]")
      ?.querySelector<HTMLElement>('[data-view-slot="content.list"]')
      ?.replaceChildren();
  };

  const dismissOverlay = async (descriptor: OverlayMountDescriptor, source: RouteLocation): Promise<void> => {
    await routeRegistry.navigate(routeRegistry.projectedTarget(descriptor.background, source), true, true);
  };

  const activateOverlayEntry = async (
    entry: RuntimeEntry,
    location: RouteLocation,
    backgroundScroll: readonly RuntimeScrollSnapshot[],
  ): Promise<void> => {
    const locationIdentity = routeLocationIdentity(location);
    if (activeOverlayMount?.entry === entry && activeOverlayMount.locationIdentity === locationIdentity) return;
    const previous = activeOverlayMount;
    activeOverlayMount = undefined;
    await disposeActiveMount(previous);
    const descriptor = entry.value as OverlayMountDescriptor;
    const host = options.root.closest<HTMLElement>("[data-view-shell]")?.querySelector<HTMLElement>('[data-view-slot="overlay"]');
    if (!host) throw new Error("ViewHost Shell does not provide the overlay Slot container");
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const restoreBackground = () => {
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
      for (const snapshot of backgroundScroll) {
        if (snapshot.element.isConnected) snapshot.element.scrollTo({ top: snapshot.top, left: snapshot.left });
      }
    };
    const layer = document.createElement("div");
    layer.className = `view-overlay-layer view-overlay-${descriptor.presentation}`;
    layer.dataset.viewOverlay = entry.identity;
    layer.dataset.size = descriptor.size ?? "wide";
    const surface = document.createElement("section");
    surface.className = "view-overlay-surface";
    surface.setAttribute("role", "dialog");
    surface.setAttribute("aria-modal", "true");
    surface.setAttribute("aria-label", textValue(descriptor.label));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "view-overlay-close";
    close.setAttribute("aria-label", messageValue(coreMessages, "overlay.close"));
    close.append(renderIcon({ kind: "system", name: "x" }));
    close.hidden = descriptor.dismissible === false;
    const element = document.createElement("div");
    element.className = "view-overlay-mount";
    const portal = document.createElement("div");
    portal.className = "view-overlay-nested-portal";
    surface.append(close, element, portal);
    const themeCleanup = applyViewThemeRoots(themeForOwner(instances, entry.owner), element, portal);
    layer.append(surface);
    host.replaceChildren(layer);
    const dismiss = () => dismissOverlay(descriptor, location).catch(error => renderShellNavigationError(options.root, error));
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && descriptor.dismissible !== false) {
        event.preventDefault();
        void dismiss();
      }
      if (event.key !== "Tab") return;
      const focusable = [...surface.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    close.addEventListener("click", dismiss);
    layer.addEventListener("mousedown", event => {
      if (event.target === layer && descriptor.dismissible !== false) void dismiss();
    });
    document.addEventListener("keydown", onKeydown);
    try {
      const mountDisposer = await descriptor.mount.mount(
        { element, portal },
        { module: moduleForOwner(instances, entry.owner), route: location, theme: themeForOwner(instances, entry.owner) }
      );
      if (mountDisposer !== undefined && typeof mountDisposer !== "function") throw new Error("Overlay Mount must return void or a disposer");
      queueMicrotask(() => (surface.querySelector<HTMLElement>("[autofocus]") ?? close).focus());
      activeOverlayMount = {
        entry,
        element,
        portal,
        container: layer,
        locationIdentity,
        disposer: async () => {
          try { await mountDisposer?.(); }
          finally { document.removeEventListener("keydown", onKeydown); themeCleanup(); }
        },
        afterDispose: () => { pendingOverlayRestore = restoreBackground; }
      };
    } catch (error) {
      themeCleanup();
      document.removeEventListener("keydown", onKeydown);
      element.replaceChildren();
      const panel = document.createElement("section");
      panel.className = "view-host-module-error";
      const heading = document.createElement("h2");
      heading.textContent = messageValue(coreMessages, "overlay.failed");
      const detail = document.createElement("p");
      detail.textContent = errorMessage(error);
      panel.append(heading, detail);
      element.append(panel);
      activeOverlayMount = {
        entry, element, portal, container: layer, locationIdentity,
        afterDispose: () => { pendingOverlayRestore = restoreBackground; }
      };
    }
  };

  const sidePanelRuntime = createSidePanelRuntime(options.root, slotsRegistry, instances);

  const activeHost: ActiveViewHost = Object.freeze({
    async activateMainView(key?: string): Promise<void> {
      if (disposed) throw new Error("ViewHost is already disposed");
      const location = routeRegistry.location;
      syncShellLayout(options.root, location, slotsRegistry);
      const selectedKey = key ?? options.mainViewKey ?? location.routeKey;
      if (!selectedKey) {
        renderRuntimePageFailure(options.root, undefined, `No View Route matches: ${location.pathname}`, () => activeHost.activateMainView(key));
        return;
      }
      const overlayEntry = key === undefined ? slotsRegistry.entry(slots.overlay, selectedKey, location) : undefined;
      if (overlayEntry) {
        const backgroundScroll = captureBackgroundScroll(options.root);
        const descriptor = overlayEntry.value as OverlayMountDescriptor;
        const background = routeRegistry.projectedLocation(descriptor.background, location);
        const backgroundListEntry = slotsRegistry.entries(slots.contentList, background)[0];
        const backgroundEntry = background.routeKey
          ? slotsRegistry.entry(slots.mainView, background.routeKey, background)
          : undefined;
        if (!backgroundEntry) throw new Error("Overlay background Route does not provide main.view");
        const currentListMount = activeListMount;
        if (backgroundListEntry && currentListMount && currentListMount.entry.value === backgroundListEntry.value) {
          adoptMountLocation(currentListMount, backgroundListEntry, background);
        } else if (backgroundListEntry) await activateListEntry(backgroundListEntry, background);
        else await clearListMount();
        const currentMainMount = activeMainMount;
        if (currentMainMount && currentMainMount.entry.value === backgroundEntry.value) {
          adoptMountLocation(currentMainMount, backgroundEntry, background);
        } else await activateMainEntry(backgroundEntry, background);
        await activateOverlayEntry(overlayEntry, location, backgroundScroll);
        renderShellDescriptors(options.root, slotsRegistry, routeRegistry, background);
        syncShellLayout(options.root, background, slotsRegistry);
        await sidePanelRuntime.sync(background);
        if (!navigationInProgress) await flushPendingOverlayRestore();
        return;
      }
      const previousOverlay = activeOverlayMount;
      activeOverlayMount = undefined;
      const entry = slotsRegistry.entry(slots.mainView, selectedKey, location);
      if (!entry) {
        const owner = routeRegistry.owner(location.pathname);
        renderRuntimePageFailure(options.root, owner ? moduleForOwner(instances, owner) : undefined, `ViewHost has no main.view for key: ${selectedKey}`, () => activeHost.activateMainView(key));
        await disposeActiveMount(previousOverlay);
        if (!navigationInProgress) await flushPendingOverlayRestore();
        return;
      }
      const listEntry = slotsRegistry.entries(slots.contentList, location)[0];
      if (listEntry) await activateListEntry(listEntry, location);
      else await clearListMount();
      await activateMainEntry(entry, location);
      renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
      syncShellLayout(options.root, location, slotsRegistry);
      await sidePanelRuntime.sync(location);
      await disposeActiveMount(previousOverlay);
      if (!navigationInProgress) await flushPendingOverlayRestore();
    },
    confirm(confirmation: ConfirmationDescriptor): Promise<boolean> {
      return hostUi.confirm(confirmation);
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
        await disposeActiveMount(activeOverlayMount);
      } catch (error) {
        errors.push(error);
      }
      activeOverlayMount = undefined;
      pendingOverlayRestore = undefined;
      try {
        await disposeActiveMount(activeMainMount);
      } catch (error) {
        errors.push(error);
      }
      activeMainMount = undefined;
      try {
        await disposeActiveMount(activeListMount);
      } catch (error) {
        errors.push(error);
      }
      activeListMount = undefined;
      try {
        await sidePanelRuntime.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await disposeSearch();
      } catch (error) {
        errors.push(error);
      }
      try {
        await disposeLiveSlots();
      } catch (error) {
        errors.push(error);
      }
      globalThis.removeEventListener?.("popstate", handlePopstate);
      for (const instance of [...instances].reverse()) {
        errors.push(...await instance.lifecycle.disposeCollectingErrors());
      }
      try {
        await hostThemeCleanup();
        errors.push(...await hostThemeLifecycle.disposeCollectingErrors());
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "ViewHost cleanup failed");
    }
  });

  disposeSearch = setupSearchRuntime(options.root, slotsRegistry, routeRegistry);

  const compose = async (): Promise<void> => {
    if (disposed) return;
    routeRegistry.updateLocation(browserLocation());
    await activeHost.activateMainView();
    renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
    await sidePanelRuntime.sync(routeRegistry.location);
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
    await sidePanelRuntime.sync(routeRegistry.location);
  } catch (error) {
    try {
      await activeHost.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], errorMessage(error));
    }
    throw error;
  }
  disposeLiveSlots = slotsRegistry.subscribe(() => {
    if (disposed) return;
    renderShellDescriptors(options.root, slotsRegistry, routeRegistry);
    syncShellLayout(options.root, routeRegistry.location, slotsRegistry);
    void sidePanelRuntime.sync(routeRegistry.location).catch(error => renderShellNavigationError(options.root, error));
  });
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

function validateThemeVersion(plugin: ViewPlugin<unknown>): void {
  const injectsTheme = plugin.inject.includes("theme");
  if (injectsTheme && plugin.themeVersion !== 1) {
    throw new Error(`View Plugin requests theme but does not support Host Theme version 1`);
  }
  if (!injectsTheme && plugin.themeVersion !== undefined) {
    throw new Error("View Plugin declares themeVersion without injecting theme");
  }
}

function validateUiVersion(plugin: ViewPlugin<unknown>): void {
  const injectsUi = plugin.inject.includes("ui");
  if (injectsUi && plugin.uiVersion !== 1) {
    throw new Error("View Plugin requests ui but does not support Host UI version 1");
  }
  if (!injectsUi && plugin.uiVersion !== undefined) {
    throw new Error("View Plugin declares uiVersion without injecting ui");
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
  readonly #listeners = new Set<() => void>();
  #notifyQueued = false;

  constructor(routes: RuntimeRouteStore) {
    this.#routes = routes;
    for (const token of Object.values(slots) as AnySlotToken[]) {
      this.#declared.set(slotIdentity(token), token);
    }
  }

  transaction(module: Readonly<ModuleInstanceContext>, lifecycle: RuntimeLifecycle): RuntimeSlotTransaction {
    return new RuntimeSlotTransaction(this, module, lifecycle);
  }

  location(): RouteLocation {
    return this.#routes.location;
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
    this.#notify();
  }

  remove(entry: RuntimeEntry): void {
    for (const child of entry.children) this.#removeSlotTree(child);
    const index = this.#entries.indexOf(entry);
    if (index >= 0) {
      this.#entries.splice(index, 1);
      this.#notify();
    }
  }

  upsert(entry: RuntimeEntry): RuntimeEntry {
    const index = this.#entries.findIndex(candidate => (
      candidate.token === entry.token && candidate.owner === entry.owner && candidate.id === entry.id
    ));
    const candidates = index < 0
      ? [...this.#entries]
      : this.#entries.filter((_, candidateIndex) => candidateIndex !== index);
    assertNoSlotConflict(candidates, entry);
    if (index < 0) this.#entries.push(entry);
    else this.#entries.splice(index, 1, entry);
    this.#notify();
    return entry;
  }

  subscribe(listener: () => void): Disposer {
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
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

  #notify(): void {
    if (this.#notifyQueued) return;
    this.#notifyQueued = true;
    queueMicrotask(() => {
      this.#notifyQueued = false;
      for (const listener of [...this.#listeners]) listener();
    });
  }
}

class RuntimeSlotTransaction implements SlotRegistry {
  readonly #store: RuntimeSlotStore;
  readonly #module: Readonly<ModuleInstanceContext>;
  readonly #lifecycle: RuntimeLifecycle;
  readonly #staged: RuntimeEntry[] = [];
  readonly #liveEpochs = new Map<string, number>();
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

  upsert(
    token: AnySlotToken,
    options: RegisterOptions<unknown>,
  ): Disposer {
    if (this.#state !== "committed") throw new Error("Live Slot updates require a committed Plugin instance");
    if (this.#lifecycle.disposed) throw new Error("View Plugin instance is already disposed");
    if (token !== slots.navigationSecondary && token !== slots.headerTitle && token !== slots.headerActions && token !== slots.homeAttention && token !== slots.homeContinue) {
      throw new Error(`Slot ${slotIdentity(token)} does not allow live Module updates`);
    }
    validateSlotRegistration(token, options);
    if ((token === slots.navigationSecondary || token === slots.headerTitle) && options.when === undefined) {
      throw new Error(`${slotIdentity(token)} live updates require a Route activation`);
    }
    const owner = moduleIdentity(this.#module);
    const liveIdentity = [owner, slotIdentity(token), options.id].join(":");
    const epoch = (this.#liveEpochs.get(liveIdentity) ?? 0) + 1;
    const entry: RuntimeEntry = {
      token,
      id: options.id,
      order: options.order ?? 0,
      value: options.value,
      ...(options.when === undefined ? {} : { when: options.when }),
      children: Object.freeze([]),
      identity: liveIdentity,
      owner,
      epoch
    };
    this.#store.upsert(entry);
    this.#liveEpochs.set(liveIdentity, epoch);
    return this.#lifecycle.own(() => {
      const current = this.#store.entries(token, this.#storeLocation()).find(candidate => (
        candidate.owner === owner && candidate.id === options.id
      ));
      if (current?.epoch === epoch) this.#store.remove(current);
    });
  }

  #storeLocation(): RouteLocation {
    return this.#store.location();
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
  readonly #tokens = new WeakMap<RouteToken, RuntimeRoute>();
  readonly #projections = new WeakMap<RouteProjection, RuntimeRouteProjection>();
  #navigate: ((target: RouteTarget, replace: boolean, preserveScroll: boolean) => Promise<void>) | undefined;

  constructor(location: RouteLocation) {
    this.#location = freezeLocation(location);
  }

  get location(): RouteLocation {
    return this.#location;
  }

  setNavigator(navigate: (target: RouteTarget, replace: boolean, preserveScroll: boolean) => Promise<void>): void {
    this.#navigate = navigate;
  }

  navigate(target: RouteTarget, replace = false, preserveScroll = false): Promise<void> {
    if (!this.#navigate) throw new Error("ViewHost navigation is not ready");
    return this.#navigate(target, replace, preserveScroll);
  }

  updateLocation(location: RouteLocation): void {
    const matched = this.match(location.pathname);
    const route = matched?.route;
    const params = matched ? matchRouteParams(matched) : Object.freeze({});
    const query = route ? parseRouteQuery(location.search, route.queryKeys) : Object.freeze({});
    const canonicalSearch = route ? formatRouteQuery(query, route.queryKeys) : "";
    const canonicalPath = route && matched ? fillRoutePath(route, params) : location.pathname;
    this.#location = freezeLocation({
      pathname: canonicalPath,
      search: canonicalSearch,
      hash: location.hash,
      params,
      query,
      ...(route ? { routeKey: route.key } : {})
    });
    if (matched && (matched.matchedPath !== route?.path || location.pathname !== canonicalPath || location.search !== canonicalSearch)) {
      globalThis.history?.replaceState({}, "", canonicalPath + canonicalSearch + location.hash);
    }
  }

  transaction(
    module: Readonly<ModuleInstanceContext>,
    lifecycle: RuntimeLifecycle,
    basePath: string,
    grants?: readonly ViewRouteGrant[],
    scopeGrants = false,
  ): RuntimeRouteTransaction {
    return new RuntimeRouteTransaction(this, module, lifecycle, basePath, grants, scopeGrants);
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

  rememberToken(token: RouteToken, route: RuntimeRoute): void {
    this.#tokens.set(token, route);
  }

  createProjection(
    options: RouteProjectionOptions,
    owner: string,
  ): RouteProjection {
    const { from: fromToken, to: toToken, params } = options;
    const from = this.#tokens.get(fromToken);
    const to = this.#tokens.get(toToken);
    if (!from || !to) throw new Error("Route projection requires Route Tokens created by this ViewHost");
    if (from.owner !== owner || to.owner !== owner) throw new Error("Cross-instance Route projections are not supported");
    const sourceNames = new Set(from.parameterNames);
    for (const targetName of to.parameterNames) {
      const sourceName = params[targetName];
      if (!sourceName || !sourceNames.has(sourceName)) {
        throw new Error(`Route projection does not map target parameter: ${targetName}`);
      }
    }
    if (Object.keys(params).some(name => !to.parameterNames.includes(name))) {
      throw new Error("Route projection maps an unknown target parameter");
    }
    const query = options.query ?? {};
    const sourceQueryKeys = new Set(from.queryKeys);
    const targetQueryKeys = new Set(to.queryKeys);
    for (const [targetName, sourceName] of Object.entries(query)) {
      if (!targetQueryKeys.has(targetName)) {
        throw new Error(`Route projection maps an unknown target query: ${targetName}`);
      }
      if (!sourceQueryKeys.has(sourceName)) {
        throw new Error(`Route projection maps an unknown source query: ${sourceName}`);
      }
    }
    if (options.hash !== undefined && options.hash !== "discard" && options.hash !== "preserve") {
      throw new Error("Route projection hash must be discard or preserve");
    }
    const projection = createHostRouteProjection();
    this.#projections.set(projection, {
      from,
      to,
      params: Object.freeze({ ...params }),
      query: Object.freeze({ ...query }),
      hash: options.hash ?? "discard",
      owner
    });
    return projection;
  }

  projectedLocation(projection: RouteProjection, source: RouteLocation): RouteLocation {
    const value = this.#projections.get(projection);
    if (!value) throw new Error("Route projection was not created by this ViewHost");
    if (source.routeKey !== value.from.key) throw new Error("Overlay Route projection source does not match current Route");
    const params: Record<string, string> = {};
    for (const targetName of value.to.parameterNames) {
      const sourceName = value.params[targetName]!;
      const parameter = source.params[sourceName];
      if (parameter === undefined) throw new Error(`Overlay Route parameter is missing: ${sourceName}`);
      params[targetName] = parameter;
    }
    const query: Record<string, string> = {};
    for (const [targetName, sourceName] of Object.entries(value.query)) {
      const queryValue = source.query[sourceName];
      if (queryValue !== undefined) query[targetName] = queryValue;
    }
    const frozenQuery = Object.freeze(query);
    return freezeLocation({
      pathname: fillRoutePath(value.to, params),
      search: formatRouteQuery(frozenQuery, value.to.queryKeys),
      hash: value.hash === "preserve" ? source.hash : "",
      params: Object.freeze(params),
      query: frozenQuery,
      routeKey: value.to.key,
      projected: true
    });
  }

  projectedTarget(projection: RouteProjection, source: RouteLocation): RouteTarget {
    const location = this.projectedLocation(projection, source);
    return this.createTarget(location.pathname + location.search + location.hash);
  }

  targetPath(target: RouteTarget): string | undefined {
    return this.#targetPaths.get(target);
  }

  targetFor(owner: string, routeId: string, params: Readonly<Record<string, string>> = {}): RouteTarget | undefined {
    const route = this.#routes.find(candidate => candidate.owner === owner && candidate.id === routeId);
    return route ? this.createTarget(fillRoutePath(route, params)) : undefined;
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
  readonly #scopeGrants: boolean;
  readonly #staged: RuntimeRoute[] = [];
  #state: "open" | "committed" = "open";

  constructor(
    store: RuntimeRouteStore,
    module: Readonly<ModuleInstanceContext>,
    lifecycle: RuntimeLifecycle,
    basePath: string,
    grants?: readonly ViewRouteGrant[],
    scopeGrants = false,
  ) {
    this.#store = store;
    this.#module = module;
    this.#lifecycle = lifecycle;
    this.#basePath = normalizeBasePath(basePath);
    this.#grants = grants === undefined ? undefined : validateRouteGrants(grants);
    this.#scopeGrants = scopeGrants;
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
    if (grant && definition.query !== undefined && !sameStrings(definition.query, grant.query ?? [])) {
      throw new Error(`Route query allowlist does not match built-in grant ${definition.id}`);
    }
    const template = grant && !this.#scopeGrants ? grant.path : joinRoutePath(this.#basePath, grant?.path ?? definition.path);
    const compiled = compileRoute(template);
    const aliases = (grant?.aliases ?? []).map(alias => {
      const path = this.#scopeGrants ? joinRoutePath(this.#basePath, alias) : alias;
      return { path, ...compileRoute(path) };
    });
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
      queryKeys: Object.freeze([...(definition.query ?? grant?.query ?? [])]),
      activation,
      owner
    };
    this.#staged.push(route);
    this.#lifecycle.own(() => this.#store.remove(route));
    const token = Object.freeze({
      key,
      activation,
      to: (params: Readonly<Record<string, string>> = {}, options: RouteTargetOptions = {}) => (
        this.#store.createTarget(routeTargetPath(route, params, options))
      )
    });
    this.#store.rememberToken(token, route);
    return token;
  }

  project(options: RouteProjectionOptions): RouteProjection {
    if (this.#state !== "open") throw new Error("View Plugin registration transaction is already closed");
    return this.#store.createProjection(options, moduleIdentity(this.#module));
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
  readonly theme: import("./view-sdk.js").ViewTheme;
};

type RuntimeActiveMount = {
  entry: RuntimeEntry;
  readonly element: HTMLElement;
  readonly portal: HTMLElement;
  readonly container?: HTMLElement;
  locationIdentity: string;
  readonly disposer?: Disposer;
  readonly afterDispose?: Disposer;
  readonly themeCleanup?: Disposer;
};

type RuntimeScrollSnapshot = {
  readonly element: Element;
  readonly top: number;
  readonly left: number;
};

function captureBackgroundScroll(root: HTMLElement): readonly RuntimeScrollSnapshot[] {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  const candidates: Array<Element | null> = [
    root,
    shell?.querySelector<HTMLElement>('[data-view-slot="content.list"]') ?? null,
    shell?.querySelector<HTMLElement>('[data-view-slot="navigation.secondary"]') ?? null,
    document.scrollingElement,
  ];
  return candidates
    .filter((element): element is Element => element instanceof Element)
    .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
}

function routeLocationIdentity(location: Readonly<RouteLocation>): string {
  return `${location.pathname}\u0000${location.search}\u0000${location.hash}\u0000${JSON.stringify(location.params)}`;
}

function adoptMountLocation(mount: RuntimeActiveMount, entry: RuntimeEntry, location: RouteLocation): void {
  mount.entry = entry;
  mount.locationIdentity = routeLocationIdentity(location);
  mount.element.dataset.viewMount = entry.identity;
  mount.element.dataset.viewLocation = `${location.pathname}${location.search}${location.hash}`;
}

async function disposeActiveMount(mount: RuntimeActiveMount | undefined): Promise<void> {
  if (!mount) return;
  try {
    await mount.disposer?.();
  } finally {
    await mount.themeCleanup?.();
    (mount.container ?? mount.element).remove();
    mount.portal.remove();
    await mount.afterDispose?.();
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

function themeForOwner(
  instances: readonly RuntimePluginInstance[],
  owner: string,
): import("./view-sdk.js").ViewTheme {
  const instance = instances.find(candidate => candidate.owner === owner);
  if (!instance) throw new Error(`ViewHost cannot resolve Theme owner for Mount: ${owner}`);
  return instance.theme;
}

function createSidePanelRuntime(
  root: HTMLElement,
  slotStore: RuntimeSlotStore,
  instances: readonly RuntimePluginInstance[],
): { sync(location: RouteLocation): Promise<void>; dispose(): Promise<void> } {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  const panel = shell?.querySelector<HTMLElement>("[data-view-side-panel-container]");
  const title = panel?.querySelector<HTMLElement>("[data-view-side-panel-title]");
  const closeButton = panel?.querySelector<HTMLButtonElement>("[data-view-side-panel-close]");
  const host = panel?.querySelector<HTMLElement>('[data-view-slot="side.panel"]');
  let entry: RuntimeEntry | undefined;
  let activeMount: RuntimeActiveMount | undefined;
  let open = false;
  let trigger: HTMLButtonElement | undefined;
  let currentLocation: RouteLocation | undefined;

  const updateVisibility = () => {
    if (!panel || !shell) return;
    panel.hidden = !open || !entry;
    shell.dataset.viewSidePanel = String(Boolean(open && entry));
    trigger?.setAttribute("aria-expanded", String(Boolean(open && entry)));
  };

  const mountCurrent = async (): Promise<void> => {
    if (!entry || !host || !currentLocation) return;
    const descriptor = entry.value as SidePanelDescriptor;
    const locationIdentity = routeLocationIdentity(currentLocation);
    if (activeMount?.entry === entry && activeMount.locationIdentity === locationIdentity) return;
    if (activeMount && (activeMount.entry.value as SidePanelDescriptor).mount === descriptor.mount && descriptor.mount.update) {
      await descriptor.mount.update({
        module: moduleForOwner(instances, entry.owner),
        route: currentLocation,
        theme: themeForOwner(instances, entry.owner)
      });
      adoptMountLocation(activeMount, entry, currentLocation);
      return;
    }
    const previous = activeMount;
    const element = document.createElement("div");
    element.className = "view-host-side-panel-mount";
    element.dataset.viewMount = entry.identity;
    element.dataset.viewLocation = `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`;
    const portal = document.createElement("div");
    portal.className = "view-host-side-panel-portal";
    portal.dataset.viewPortal = entry.identity;
    shell?.querySelector<HTMLElement>("[data-view-page-portals]")?.append(portal);
    const themeCleanup = applyViewThemeRoots(themeForOwner(instances, entry.owner), element, portal);
    try {
      const disposer = await descriptor.mount.mount(
        { element, portal },
        { module: moduleForOwner(instances, entry.owner), route: currentLocation, theme: themeForOwner(instances, entry.owner) }
      );
      if (disposer !== undefined && typeof disposer !== "function") throw new Error("View Mount must return void or a disposer");
      activeMount = undefined;
      await disposeActiveMount(previous);
      host.replaceChildren(element);
      activeMount = { entry, element, portal, locationIdentity, themeCleanup, ...(disposer ? { disposer } : {}) };
    } catch (error) {
      themeCleanup();
      portal.remove();
      element.remove();
      activeMount = undefined;
      await disposeActiveMount(previous);
      renderRuntimePageFailure(host, moduleForOwner(instances, entry.owner), errorMessage(error), () => mountCurrent());
    }
  };

  const setOpen = async (next: boolean) => {
    open = next;
    if (open) await mountCurrent();
    updateVisibility();
  };
  const close = () => { void setOpen(false).then(() => trigger?.focus()); };
  closeButton?.addEventListener("click", close);

  return {
    async sync(location) {
      currentLocation = location;
      const next = slotStore.entries(slots.sidePanel, location)[0];
      if (next !== entry) {
        entry = next;
        open = Boolean(next && (next.value as SidePanelDescriptor).defaultOpen);
        const previous = activeMount;
        activeMount = undefined;
        await disposeActiveMount(previous);
        host?.replaceChildren();
      }
      trigger = undefined;
      if (!entry) {
        title?.replaceChildren();
        updateVisibility();
        return;
      }
      const descriptor = entry.value as SidePanelDescriptor;
      if (title) title.textContent = textValue(descriptor.label);
      const actions = shell?.querySelector<HTMLElement>('[data-view-slot="header.actions"]');
      if (actions) {
        trigger = renderHeaderAction({
          label: descriptor.label,
          ...(descriptor.icon ? { icon: descriptor.icon } : {}),
          run: () => setOpen(!open)
        }, `${entry.identity}:trigger`);
        trigger.dataset.viewSidePanelTrigger = "true";
        trigger.setAttribute("aria-controls", "memsphere-view-side-panel");
        actions.append(trigger);
      }
      panel?.setAttribute("id", "memsphere-view-side-panel");
      if (open) await mountCurrent();
      updateVisibility();
    },
    async dispose() {
      closeButton?.removeEventListener("click", close);
      const previous = activeMount;
      activeMount = undefined;
      await disposeActiveMount(previous);
      host?.replaceChildren();
      entry = undefined;
      open = false;
      updateVisibility();
    }
  };
}

function renderShellDescriptors(
  root: HTMLElement,
  slotStore: RuntimeSlotStore,
  routeStore: RuntimeRouteStore,
  renderedLocation?: RouteLocation,
): void {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  if (!shell) return;
  const location = renderedLocation ?? routeStore.location;
  const navigation = shell.querySelector<HTMLElement>('[data-view-slot="navigation.primary"]');
  const secondary = shell.querySelector<HTMLElement>('[data-view-slot="navigation.secondary"]');
  const title = shell.querySelector<HTMLElement>('[data-view-slot="header.title"]');
  const actions = shell.querySelector<HTMLElement>('[data-view-slot="header.actions"]');
  const account = shell.querySelector<HTMLElement>('[data-view-slot="header.account"]');
  const footer = shell.querySelector<HTMLElement>('[data-view-slot="sidebar.footer"]');

  if (navigation) {
    const activeOwner = routeStore.owner(location.pathname);
    navigation.replaceChildren(...slotStore.entries(slots.navigationPrimary, location).map(entry => {
      const descriptor = entry.value as NavigationItemDescriptor;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "view-shell-navigation-item";
      button.dataset.viewEntry = entry.identity;
      const targetPath = routeStore.targetPath(descriptor.route);
      const active = entry.owner === activeOwner;
      button.setAttribute("aria-label", textValue(descriptor.label));
      const iconTile = document.createElement("span");
      iconTile.className = "view-shell-module-icon";
      iconTile.append(renderIcon(descriptor.icon));
      button.append(iconTile, textNode(descriptor.label));
      if (descriptor.badge) {
        const badge = document.createElement("span");
        badge.className = "view-shell-navigation-badge";
        badge.textContent = textValue(descriptor.badge);
        button.append(badge);
      }
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
      button.addEventListener("click", () => {
        void routeStore.navigate(descriptor.route).catch(error => renderShellNavigationError(root, error));
      });
      return button;
    }));
  }

  if (secondary) {
    secondary.replaceChildren();
    const entry = slotStore.entries(slots.navigationSecondary, location)[0];
    if (entry) secondary.append(renderSecondaryNavigation(entry.value as SecondaryNavigationDescriptor, root, routeStore));
  }

  if (title) {
    const entry = slotStore.entries(slots.headerTitle, location)[0];
    title.replaceChildren();
    if (entry) title.append(renderHeaderTitle(entry.value as HeaderTitleDescriptor, entry.identity, root, routeStore));
  }

  if (actions) {
    actions.replaceChildren(...slotStore.entries(slots.headerActions, location).map(entry => (
      renderHeaderAction(entry.value as HeaderActionDescriptor, entry.identity)
    )));
  }

  if (account) {
    account.replaceChildren();
    const entry = slotStore.entries(slots.headerAccount, location)[0];
    if (entry) account.append(renderHeaderAccount(entry.value as HeaderAccountDescriptor, entry.identity));
  }

  if (footer) {
    footer.replaceChildren(...slotStore.entries(slots.sidebarFooter, location).map(entry => (
      renderSidebarFooter(entry.value as SidebarFooterDescriptor, entry.identity)
    )));
  }
}

function setupSearchRuntime(
  root: HTMLElement,
  slotStore: RuntimeSlotStore,
  routeStore: RuntimeRouteStore,
): Disposer {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  const trigger = shell?.querySelector<HTMLButtonElement>("[data-view-search-trigger]");
  const overlay = shell?.querySelector<HTMLElement>("[data-view-search-overlay]");
  const input = shell?.querySelector<HTMLInputElement>("[data-view-search-input]");
  const closeButton = shell?.querySelector<HTMLButtonElement>("[data-view-search-close]");
  const categories = shell?.querySelector<HTMLElement>('[data-view-slot="search.providers"]');
  const results = shell?.querySelector<HTMLElement>("[data-view-search-results]");
  const empty = shell?.querySelector<HTMLElement>("[data-view-search-empty]");
  const status = shell?.querySelector<HTMLElement>("[data-view-search-status]");
  if (!trigger || !overlay || !input || !closeButton || !categories || !results || !empty || !status) {
    return () => undefined;
  }

  type CachedProviderResult = Readonly<{
    entry: RuntimeEntry;
    results?: readonly SearchResultDescriptor[];
    error?: string;
  }>;
  let open = false;
  let selectedOwner = "*";
  let session = 0;
  let epoch = 0;
  let debounceTimer = 0;
  let restoreFocus: HTMLElement | undefined;
  const cache = new Map<string, CachedProviderResult>();
  const pending = new Map<string, AbortController>();
  const chinese = document.documentElement.lang.toLowerCase().startsWith("zh");
  const allLabel = chinese ? "全部" : "All";

  const providerEntries = (): readonly RuntimeEntry[] => slotStore.entries(slots.searchProviders, routeStore.location);
  const eligibleEntries = (): readonly RuntimeEntry[] => providerEntries().filter(entry => selectedOwner === "*" || entry.owner === selectedOwner);
  const cacheKey = (entry: RuntimeEntry, query: string) => `${entry.identity}\u0000${query}`;
  const abortAll = () => {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
  const isEditable = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])")
      || target.closest("[contenteditable]:not([contenteditable=\"false\"])") !== null;
  };
  const validResults = (value: unknown): readonly SearchResultDescriptor[] => {
    if (!Array.isArray(value)) throw new Error("Search Provider must return an array");
    for (const result of value) {
      if (!isSearchResultDescriptor(result)) throw new Error("Search Provider returned an invalid result");
    }
    return Object.freeze([...value]) as readonly SearchResultDescriptor[];
  };
  const renderResults = () => {
    const query = input.value.trim();
    results.replaceChildren();
    status.textContent = "";
    if (!query) {
      empty.hidden = false;
      results.hidden = true;
      return;
    }
    const cached = eligibleEntries().map(entry => cache.get(cacheKey(entry, query))).filter((value): value is CachedProviderResult => value !== undefined);
    const rows = cached.flatMap(value => (value.results ?? []).map(result => ({ entry: value.entry, result })));
    const errors = cached.filter(value => value.error !== undefined);
    for (const { result } of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "view-shell-search-result";
      if (result.icon) button.append(renderIcon(result.icon));
      const copy = document.createElement("span");
      copy.className = "view-shell-search-result-copy";
      const title = document.createElement("strong");
      title.textContent = textValue(result.title);
      const meta = document.createElement("small");
      meta.textContent = [textValue(result.type), result.summary ? textValue(result.summary) : ""].filter(Boolean).join(" · ");
      copy.append(title, meta);
      button.append(copy);
      button.addEventListener("click", () => {
        void routeStore.navigate(result.route)
          .then(() => closeSearch(false))
          .catch(error => { status.textContent = errorMessage(error); });
      });
      button.addEventListener("keydown", event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const buttons = [...results.querySelectorAll<HTMLButtonElement>(".view-shell-search-result")];
        const index = buttons.indexOf(button);
        const next = event.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
        if (next !== index) { event.preventDefault(); buttons[next]?.focus(); }
      });
      results.append(button);
    }
    for (const failure of errors) {
      const panel = document.createElement("p");
      panel.className = "view-shell-search-provider-error";
      const descriptor = failure.entry.value as SearchProviderDescriptor;
      panel.textContent = `${textValue(descriptor.label)} · ${failure.error}`;
      results.append(panel);
    }
    const loading = eligibleEntries().some(entry => pending.has(entry.identity));
    status.textContent = loading ? (chinese ? "搜索中…" : "Searching…") : "";
    empty.hidden = rows.length > 0 || errors.length > 0;
    results.hidden = rows.length === 0 && errors.length === 0;
    if (!loading && rows.length === 0 && errors.length === 0) {
      status.textContent = chinese ? "没有找到结果" : "No results";
    }
  };
  const runSearch = () => {
    if (!open) return;
    const query = input.value.trim();
    if (!query) { abortAll(); cache.clear(); renderResults(); return; }
    const runSession = session;
    const runEpoch = epoch;
    const eligible = new Set(eligibleEntries().map(entry => entry.identity));
    for (const [identity, controller] of pending) {
      if (!eligible.has(identity)) { controller.abort(); pending.delete(identity); }
    }
    for (const entry of eligibleEntries()) {
      const key = cacheKey(entry, query);
      if (cache.has(key) || pending.has(entry.identity)) continue;
      const controller = new AbortController();
      pending.set(entry.identity, controller);
      const descriptor = entry.value as SearchProviderDescriptor;
      Promise.resolve(descriptor.search({ query, signal: controller.signal })).then(value => {
        if (!open || session !== runSession || epoch !== runEpoch || controller.signal.aborted || input.value.trim() !== query) return;
        cache.set(key, Object.freeze({ entry, results: validResults(value) }));
      }).catch(error => {
        if (!open || session !== runSession || epoch !== runEpoch || controller.signal.aborted || errorName(error) === "AbortError") return;
        cache.set(key, Object.freeze({ entry, error: errorMessage(error) }));
      }).finally(() => {
        if (pending.get(entry.identity) === controller) pending.delete(entry.identity);
        if (open && session === runSession && epoch === runEpoch && input.value.trim() === query) renderResults();
      });
    }
    renderResults();
  };
  const scheduleSearch = (reset: boolean) => {
    if (reset) {
      epoch += 1;
      abortAll();
      cache.clear();
    }
    globalThis.clearTimeout(debounceTimer);
    debounceTimer = globalThis.setTimeout(runSearch, 180) as unknown as number;
    renderResults();
  };
  const renderCategories = () => {
    const groups = new Map<string, RuntimeEntry>();
    for (const entry of providerEntries()) if (!groups.has(entry.owner)) groups.set(entry.owner, entry);
    if (selectedOwner !== "*" && !groups.has(selectedOwner)) selectedOwner = "*";
    const definitions: readonly [string, string][] = [["*", allLabel], ...[...groups].map(([owner, entry]) => [owner, textValue((entry.value as SearchProviderDescriptor).label)] as [string, string])];
    categories.replaceChildren(...definitions.map(([owner, label], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.textContent = label;
      button.dataset.searchProvider = owner;
      const selected = owner === selectedOwner;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener("click", () => selectOwner(owner));
      button.addEventListener("keydown", event => {
        const buttons = [...categories.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        const current = buttons.indexOf(button);
        let next = current;
        if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
        else if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectOwner(owner); return; }
        else return;
        event.preventDefault();
        buttons[next]?.focus();
      });
      return button;
    }));
  };
  const selectOwner = (owner: string) => {
    if (selectedOwner === owner) return;
    selectedOwner = owner;
    renderCategories();
    scheduleSearch(false);
  };
  const openSearch = (opener?: HTMLElement) => {
    if (open) { input.focus(); return; }
    open = true;
    session += 1;
    epoch = 0;
    selectedOwner = "*";
    restoreFocus = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : trigger);
    cache.clear();
    abortAll();
    input.value = "";
    overlay.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    renderCategories();
    renderResults();
    queueMicrotask(() => input.focus());
  };
  const closeSearch = (restore = true) => {
    if (!open) return;
    open = false;
    session += 1;
    epoch += 1;
    globalThis.clearTimeout(debounceTimer);
    abortAll();
    cache.clear();
    overlay.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restore && restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  };
  const onInput = () => scheduleSearch(true);
  const onTrigger = () => openSearch(trigger);
  const onClose = () => closeSearch();
  const onGlobalKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) { event.preventDefault(); closeSearch(); return; }
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
    event.preventDefault();
    openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : trigger);
  };
  const onInputKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown") return;
    const first = results.querySelector<HTMLButtonElement>(".view-shell-search-result");
    if (first) { event.preventDefault(); first.focus(); }
  };
  trigger.addEventListener("click", onTrigger);
  closeButton.addEventListener("click", onClose);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onInputKey);
  document.addEventListener("keydown", onGlobalKey);
  return () => {
    closeSearch(false);
    trigger.removeEventListener("click", onTrigger);
    closeButton.removeEventListener("click", onClose);
    input.removeEventListener("input", onInput);
    input.removeEventListener("keydown", onInputKey);
    document.removeEventListener("keydown", onGlobalKey);
  };
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

function renderSecondaryNavigation(
  descriptor: SecondaryNavigationDescriptor,
  root: HTMLElement,
  routeStore: RuntimeRouteStore,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "view-shell-secondary-navigation";
  const header = document.createElement("header");
  header.className = "view-shell-secondary-header";
  const headingCopy = document.createElement("div");
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "MODULE";
  const heading = document.createElement("h2");
  heading.append(textNode(descriptor.title));
  headingCopy.append(eyebrow, heading);
  header.append(headingCopy);
  if (descriptor.settings) {
    const settings = renderHeaderAction(descriptor.settings, "secondary.settings");
    settings.classList.add("view-shell-secondary-settings");
    header.append(settings);
  }
  const list = document.createElement("nav");
  list.className = "view-shell-secondary-items";
  for (const item of descriptor.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "view-shell-secondary-item";
    button.dataset.secondaryId = item.id;
    button.setAttribute("aria-label", textValue(item.label));
    button.classList.toggle("active", item.selected);
    button.setAttribute("aria-current", item.selected ? "page" : "false");
    button.append(renderIcon(item.icon), textNode(item.label));
    if (item.badge) {
      const badge = document.createElement("span");
      badge.className = "view-shell-secondary-badge";
      badge.textContent = textValue(item.badge);
      button.append(badge);
    }
    button.addEventListener("click", () => {
      const operation = item.route ? routeStore.navigate(item.route) : Promise.resolve(item.action.run());
      void operation.catch(error => renderShellNavigationError(root, error));
    });
    list.append(button);
  }
  container.append(header, list);
  if (descriptor.footer) {
    const footer = document.createElement("p");
    footer.className = "view-shell-secondary-footer";
    footer.append(textNode(descriptor.footer));
    container.append(footer);
  }
  return container;
}

function syncShellLayout(root: HTMLElement, location: RouteLocation, slotStore: RuntimeSlotStore): void {
  const shell = root.closest<HTMLElement>("[data-view-shell]");
  if (!shell) return;
  shell.dataset.viewLayout = location.pathname === "/" ? "home" : "module";
  shell.dataset.viewContentList = String(Boolean(slotStore.entries(slots.contentList, location)[0]));
}

function renderHeaderAccount(descriptor: HeaderAccountDescriptor, identity: string): HTMLElement {
  const container = document.createElement(descriptor.action ? "button" : "div");
  container.className = "view-shell-account";
  container.dataset.viewEntry = identity;
  const avatar = document.createElement("span");
  avatar.className = "view-shell-account-avatar";
  avatar.textContent = textValue(descriptor.label);
  container.append(avatar);
  if (descriptor.status) {
    container.title = textValue(descriptor.status);
  }
  const userIcon = document.createElement("img");
  userIcon.className = "view-shell-account-user-icon";
  userIcon.src = "/assets/system-icons/user.svg";
  userIcon.alt = "";
  userIcon.setAttribute("aria-hidden", "true");
  const caret = document.createElement("img");
  caret.className = "view-shell-account-caret";
  caret.src = "/assets/system-icons/caret-down.svg";
  caret.alt = "";
  caret.setAttribute("aria-hidden", "true");
  container.append(userIcon, caret);
  if (descriptor.action && container instanceof HTMLButtonElement) {
    container.type = "button";
    container.addEventListener("click", () => void descriptor.action!.run());
  }
  return container;
}

function renderSidebarFooter(descriptor: SidebarFooterDescriptor, identity: string): HTMLElement {
  if (descriptor.kind === "action") {
    const button = renderHeaderAction(descriptor.action, identity);
    button.classList.add("view-shell-settings");
    return button;
  }
  const status = document.createElement("div");
  status.className = "view-shell-service-status";
  status.dataset.status = descriptor.status;
  status.dataset.viewEntry = identity;
  const icon = document.createElement("img");
  icon.className = "view-shell-status-icon";
  icon.src = "/assets/system-icons/circle-fill.svg";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  status.append(icon, document.createTextNode(textValue(descriptor.label)));
  return status;
}

function renderHeaderTitle(
  descriptor: HeaderTitleDescriptor,
  identity: string,
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
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "view-shell-breadcrumb-separator";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "/";
        breadcrumbs.append(separator);
      }
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
  if (identity.includes("org.memsphere.memory")) heading.classList.add("memory-title");
  if (identity.includes("org.memsphere.run")) heading.classList.add("run-title");
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
  const button = createPrimitiveButton(descriptor, "default");
  button.className = "view-shell-action";
  button.dataset.viewEntry = identity;
  if (descriptor.tone) button.dataset.tone = descriptor.tone;
  button.querySelector(".mem-view-icon")?.classList.add("view-shell-icon");
  const label = button.querySelector(":scope > span:not(.mem-view-icon)");
  if (label) label.className = "view-shell-action-label";
  return button;
}

function renderIcon(icon: IconRef): HTMLElement {
  const rendered = renderPrimitiveIcon(icon);
  rendered.classList.add("view-shell-icon");
  return rendered;
}

function textNode(value: TextRef): Text {
  return document.createTextNode(textValue(value));
}

function textValue(value: TextRef): string {
  if ("text" in value) return value.text;
  return value.key.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(value.params?.[name] ?? `{${name}}`));
}

function messageValue(messages: Readonly<Record<string, unknown>>, key: string): string {
  const value = messages[key];
  return typeof value === "string" ? value : key;
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
  validateRouteQueryKeys(definition.query, "Route definition");
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

function routeTargetPath(
  route: RuntimeRoute,
  params: Readonly<Record<string, string>>,
  options: RouteTargetOptions,
): string {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Route target options must be an object");
  }
  const unknownOptions = Object.keys(options).filter(key => key !== "query" && key !== "hash");
  if (unknownOptions.length) throw new Error(`Route target options contain unknown field: ${unknownOptions[0]}`);
  const query = options.query ?? {};
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("Route target query must be an object");
  }
  const allowed = new Set(route.queryKeys);
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key)) throw new Error(`Route target query is not declared: ${key}`);
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Route target query value must be a string or undefined: ${key}`);
    }
  }
  if (options.hash !== undefined && (typeof options.hash !== "string" || options.hash.includes("#"))) {
    throw new Error("Route target hash must be a string without #");
  }
  const normalizedQuery = Object.freeze(Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ));
  const search = formatRouteQuery(normalizedQuery, route.queryKeys);
  const hash = options.hash === undefined || options.hash === "" ? "" : `#${encodeURIComponent(options.hash)}`;
  return fillRoutePath(route, params) + search + hash;
}

function parseRouteQuery(search: string, allowlist: readonly string[]): Readonly<Record<string, string>> {
  const allowed = new Set(allowlist);
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (allowed.has(key)) query[key] = value;
  }
  return Object.freeze(query);
}

function formatRouteQuery(query: Readonly<Record<string, string>>, order: readonly string[]): string {
  const params = new URLSearchParams();
  for (const key of order) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function validateRouteQueryKeys(keys: readonly string[] | undefined, source: string): void {
  if (keys === undefined) return;
  if (!Array.isArray(keys)) throw new Error(`${source} query allowlist must be an array`);
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
      throw new Error(`${source} query key is invalid: ${String(key)}`);
    }
    if (seen.has(key)) throw new Error(`${source} query key conflicts: ${key}`);
    seen.add(key);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    validateRouteQueryKeys(grant.query, `Built-in Route grant ${grant.id}`);
    for (const path of [grant.path, ...(grant.aliases ?? [])]) {
      validateGrantedRoutePath(path);
      if (paths.has(path)) throw new Error(`Built-in Route grant path conflicts: ${path}`);
      paths.add(path);
    }
    result.set(grant.id, Object.freeze({
      id: grant.id,
      path: grant.path,
      ...(grant.aliases === undefined ? {} : { aliases: Object.freeze([...grant.aliases]) }),
      ...(grant.query === undefined ? {} : { query: Object.freeze([...grant.query]) })
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
    query: Object.freeze({ ...(location.query ?? {}) }),
    ...(location.routeKey === undefined ? {} : { routeKey: location.routeKey }),
    ...(location.projected === true ? { projected: true as const } : {})
  });
}

function browserLocation(): RouteLocation {
  return {
    pathname: globalThis.location?.pathname ?? "/",
    search: globalThis.location?.search ?? "",
    hash: globalThis.location?.hash ?? "",
    params: Object.freeze({}),
    query: Object.freeze({})
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
