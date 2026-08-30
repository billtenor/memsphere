import {
  isSlotToken,
  slots,
  type Disposer,
  type KeyedRegisterOptions,
  type ModuleInstanceContext,
  type RegisterOptions,
  type SlotKind,
  type SlotRegistry,
  type SlotToken,
  type ViewLifecycle,
  type ViewMount,
  type ViewPlugin,
  type ViewPluginContext,
  type ViewServiceName
} from "./view-sdk.js";

type AnySlotToken = SlotToken<string, SlotKind, unknown, string>;

type RuntimeEntry = {
  readonly token: AnySlotToken;
  readonly id: string;
  readonly key?: string;
  readonly order: number;
  readonly value: unknown;
  readonly identity: string;
};

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

const supportedServices = new Set<ViewServiceName>(["slots"]);

export async function startViewPlugin<Config>(
  options: StartViewPluginOptions<Config>,
): Promise<ActiveViewPlugin> {
  const plugin = validatePlugin<Config>(options.plugin);
  for (const service of plugin.inject) {
    if (!supportedServices.has(service)) {
      throw new Error(`View Plugin requests unsupported service: ${service}`);
    }
  }

  const lifecycle = new RuntimeLifecycle();
  const registry = new RuntimeSlotRegistry(options.module, disposer => lifecycle.own(disposer));
  const context: ViewPluginContext = Object.freeze({
    module: Object.freeze({ ...options.module }),
    slots: registry,
    lifecycle
  });

  try {
    const applyDisposer = await plugin.apply(context, options.config);
    if (applyDisposer !== undefined) {
      if (typeof applyDisposer !== "function") {
        throw new Error("View Plugin apply() must return void or a disposer");
      }
      lifecycle.own(applyDisposer);
    }

    registry.commit();
    const entry = registry.entry(slots.mainView, options.mainViewKey);
    if (!entry) {
      throw new Error(`View Plugin did not register main.view key: ${options.mainViewKey}`);
    }

    const mount = entry.value as ViewMount;
    const portal = document.createElement("div");
    portal.dataset.viewPortal = entry.identity;
    document.body.append(portal);
    lifecycle.own(() => portal.remove());

    const mountDisposer = await mount.mount(
      { element: options.root, portal },
      { module: context.module }
    );
    if (mountDisposer !== undefined) {
      if (typeof mountDisposer !== "function") {
        throw new Error("View Mount must return void or a disposer");
      }
      lifecycle.own(mountDisposer);
    }

    return Object.freeze({ dispose: () => lifecycle.dispose() });
  } catch (error) {
    const cleanupErrors = await lifecycle.disposeCollectingErrors();
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], errorMessage(error));
    }
    throw error;
  }
}

function validatePlugin<Config>(value: unknown): ViewPlugin<Config> {
  if (!value || typeof value !== "object") {
    throw new Error("View bundle does not default export a View Plugin");
  }
  const plugin = value as Partial<ViewPlugin<Config>>;
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

  async dispose(): Promise<void> {
    const errors = await this.disposeCollectingErrors();
    if (errors.length) throw new AggregateError(errors, "View Plugin cleanup failed");
  }

  async disposeCollectingErrors(): Promise<unknown[]> {
    if (this.#disposed) return [];
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const disposer of this.#owned.reverse()) {
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

class RuntimeSlotRegistry implements SlotRegistry {
  readonly #module: Readonly<ModuleInstanceContext>;
  readonly #own: (disposer: Disposer) => Disposer;
  readonly #entries: RuntimeEntry[] = [];
  #committed = false;

  constructor(
    module: Readonly<ModuleInstanceContext>,
    own: (disposer: Disposer) => Disposer,
  ) {
    this.#module = module;
    this.#own = own;
  }

  register(
    token: AnySlotToken,
    options: RegisterOptions<unknown> | KeyedRegisterOptions<unknown, string>,
  ): Disposer {
    if (this.#committed) throw new Error("View Plugin registration transaction is already committed");
    this.#validateToken(token);
    if (!options || typeof options !== "object") throw new Error("Slot registration options are required");
    if (typeof options.id !== "string" || !options.id.trim()) throw new Error("Slot Entry id must be non-empty");
    if (options.order !== undefined && !Number.isFinite(options.order)) throw new Error("Slot Entry order must be finite");
    if (options.children?.length) throw new Error("Custom child Slots are not supported by the current ViewHost");
    if (!token.definition.validate(options.value)) {
      throw new Error(`Slot ${slotIdentity(token)} rejected Entry value`);
    }

    const key = "key" in options ? options.key : undefined;
    if (token.definition.kind === "keyed") {
      if (typeof key !== "string" || !key.trim()) throw new Error(`Slot ${slotIdentity(token)} requires a key`);
    } else if (key !== undefined) {
      throw new Error(`Slot ${slotIdentity(token)} does not accept a key`);
    }

    const identity = [
      this.#module.moduleId,
      this.#module.moduleVersion,
      this.#module.instanceId,
      slotIdentity(token),
      options.id,
      key
    ].filter(value => value !== undefined).join(":");

    this.#assertNoConflict(token, options.id, key);
    const entry: RuntimeEntry = {
      token,
      id: options.id,
      ...(key === undefined ? {} : { key }),
      order: options.order ?? 0,
      value: options.value,
      identity
    };
    this.#entries.push(entry);
    return this.#own(() => {
      const index = this.#entries.indexOf(entry);
      if (index >= 0) this.#entries.splice(index, 1);
    });
  }

  commit(): void {
    this.#committed = true;
  }

  entry(token: AnySlotToken, key: string): RuntimeEntry | undefined {
    if (!this.#committed) throw new Error("View Plugin registration transaction is not committed");
    return this.#entries.find(candidate => candidate.token === token && candidate.key === key);
  }

  #validateToken(token: AnySlotToken): void {
    if (!isSlotToken(token)) throw new Error("Slot registration requires a valid Slot Token");
    if (token !== slots.mainView) throw new Error(`Slot is not declared by ViewHost: ${slotIdentity(token)}`);
  }

  #assertNoConflict(token: AnySlotToken, id: string, key: string | undefined): void {
    const sameSlot = this.#entries.filter(entry => entry.token === token);
    const conflict = token.definition.kind === "single"
      ? sameSlot.length > 0
      : token.definition.kind === "keyed"
        ? sameSlot.some(entry => entry.key === key)
        : sameSlot.some(entry => entry.id === id);
    if (conflict) {
      throw new Error(`Slot Entry conflicts in ${slotIdentity(token)}: ${key ?? id}`);
    }
  }
}

function slotIdentity(token: AnySlotToken): string {
  return `${token.definition.name}@${token.definition.version}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
