import { pathToFileURL } from "node:url";
import { AppError } from "./contracts.js";
import { packageDigest, packagePath } from "./files.js";
import { readAppState, requireApp, type AppProject, type AppInstallation } from "./state.js";
import type { AppBackend } from "./index.js";
import { createProjectModelHost } from "../project/models.js";
import { withSharedStoreLock } from "../project/shared-store-lock.js";
import { projectStoreBinding } from "./project-stores.js";
import type { Context } from "../data/api/context.js";
import type { StoredData } from "../data/api/data-store.js";
import { readBusinessProject } from "../project/business-stores.js";

class ObservablePromise<T> extends Promise<T> {
  static get [Symbol.species]() { return Promise; }
  constructor(task: Promise<T>, private readonly observed: () => void, private readonly follow: (task: Promise<unknown>) => void) {
    super((resolve, reject) => { void task.then(resolve, reject); });
  }
  override then<TResult1 = T, TResult2 = never>(
    onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const handleRejection = typeof onRejected === "function" ? (reason: unknown) => {
      return Promise.resolve(onRejected(reason)).then(value => { this.observed(); return value; });
    } : onRejected;
    const task = super.then(onFulfilled, handleRejection);
    this.follow(task);
    const next = new ObservablePromise(task, this.observed, this.follow);
    void Promise.prototype.then.call(next, undefined, () => undefined);
    return next;
  }
  override finally(onFinally?: (() => void) | null): Promise<T> {
    if (typeof onFinally !== "function") return this.then();
    const task = super.then(
      value => Promise.resolve(onFinally()).then(() => value),
      error => Promise.resolve(onFinally()).then(() => { throw error; })
    );
    this.follow(task);
    const next = new ObservablePromise(task, this.observed, this.follow);
    void Promise.prototype.then.call(next, undefined, () => undefined);
    return next;
  }
}

export async function loadAppBackend(app: AppInstallation): Promise<AppBackend | undefined> {
  const spec = app.manifest.backend;
  if (!spec) return undefined;
  if (await packageDigest(app.packageRoot) !== app.packageDigest) throw new AppError("APP_CACHE_INVALID", `Modified App cache: ${app.manifest.id}`);
  const backend: AppBackend = (await import(pathToFileURL(await packagePath(app.packageRoot, spec.entry)).href)).default;
  if (!backend?.operations || Object.keys(backend.operations).sort().join("\0") !== Object.keys(spec.operations).sort().join("\0"))
    throw new AppError("APP_BACKEND_INVALID", "Backend operations do not match the manifest");
  for (const [name, entry] of Object.entries(backend.operations)) if (entry.kind !== spec.operations[name] || typeof entry.execute !== "function")
    throw new AppError("APP_BACKEND_INVALID", `Invalid backend operation: ${name}`);
  return backend;
}
export async function invokeAppOperation(project: AppProject, id: string, operation: string, input: unknown, signal?: AbortSignal) {
  const initial = requireApp(await readAppState(project), id);
  if (initial.manifest.projectStores.length) return withSharedStoreLock(project.paths.root, () => invoke(project, id, operation, input, signal), signal, true);
  return invoke(project, id, operation, input, signal);
}

async function invoke(project: AppProject, id: string, operation: string, input: unknown, signal?: AbortSignal) {
  const app = requireApp(await readAppState(project), id);
  if (!app.enabled) throw new AppError("APP_DISABLED", `App is disabled: ${id}`);
  const spec = app.manifest.backend;
  if (!spec || !Object.hasOwn(spec.operations, operation)) throw new AppError("APP_OPERATION_NOT_FOUND", `Undeclared operation: ${operation}`);
  const backend = (await loadAppBackend(app))!;
  const current = requireApp(await readAppState(project), id);
  if (!current.enabled) throw new AppError("APP_DISABLED", `App is disabled: ${id}`);
  const config = app.manifest.projectStores.length ? await readBusinessProject(project.paths.root) : project.config;
  const host = await createProjectModelHost({ signal }, { root: project.paths.root, memoryRoot: project.memoryRoot,
    modelsDirectory: config.modelsDirectory, modelRegistration: config.modelRegistration });
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const inFlight = new Set<Promise<unknown>>();
  const failures: Array<{ error: unknown; observed: boolean }> = [];
  let closing = controller.signal.aborted;
  controller.signal.addEventListener("abort", () => { closing = true; }, { once: true });
  const deadline = app.manifest.projectStores.length ? setTimeout(() => controller.abort(new Error("App operation deadline exceeded")), 300_000) : undefined;
  deadline?.unref();
  const writes = new Set(["create", "update", "upsert", "delete", "append"]);
  const follow = (task: Promise<unknown>) => {
    inFlight.add(task);
    void task.then(() => inFlight.delete(task), () => inFlight.delete(task));
  };
  const observable = <T>(task: Promise<T>, observed: () => void): Promise<T> => {
    const result = new ObservablePromise(task, observed, follow);
    void Promise.prototype.then.call(result, undefined, () => undefined);
    return result;
  };
  const track = <T>(task: Promise<T>, exposeObserver?: (observe: () => void) => void): Promise<T> => {
    const state = { error: undefined as unknown, observed: false };
    const observe = () => { state.observed = true; };
    exposeObserver?.(observe);
    inFlight.add(task);
    void task.then(() => inFlight.delete(task), error => { inFlight.delete(task); state.error = error; failures.push(state); });
    // Awaiting a Promise subclass calls its then method, unlike an ordinary
    // native Promise. This records when the App observes an expected error.
    return observable(task, observe);
  };
  const wrapDataStream = (record: StoredData | undefined): StoredData | undefined => {
    if (!record) return record;
    const content = record.data.payload.content;
    return { ...record, data: { ...record.data, payload: { ...record.data.payload, content: {
      stream() {
        if (closing) throw new AppError("APP_OPERATION_CLOSED", "Operation is closed");
        const reader = content.stream().getReader();
        let resolveDone!: () => void;
        let rejectDone!: (reason: unknown) => void;
        let settled = false;
        let observeStream = () => {};
        const done = track(new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }), observe => { observeStream = observe; });
        void Promise.prototype.then.call(done, undefined, () => undefined);
        const finish = (error?: unknown, rejected = false) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", cancel);
          if (rejected) rejectDone(error); else resolveDone();
        };
        const cancel = () => { void reader.cancel(controller.signal.reason).then(() => finish(), error => finish(error, true)); };
        controller.signal.addEventListener("abort", cancel, { once: true });
        const stream = new ReadableStream<Uint8Array>({
          async pull(stream) {
            try {
              const item = await reader.read();
              if (item.done) { finish(); stream.close(); } else stream.enqueue(item.value);
            } catch (error) { finish(error, true); stream.error(error); }
          },
          async cancel(reason) { try { await reader.cancel(reason); finish(); } catch (error) { finish(error, true); throw error; } }
        });
        const instrument = (output: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
          const getReader = output.getReader.bind(output);
          const pipeTo = output.pipeTo.bind(output);
          const pipeThrough = output.pipeThrough.bind(output);
          const tee = output.tee.bind(output);
          const values = (output as unknown as { values(options?: { preventCancel?: boolean }): AsyncIterableIterator<Uint8Array> }).values.bind(output);
          const iterator = (options?: { preventCancel?: boolean }) => {
            const source = values(options);
            return {
              next: (...args: [] | [undefined]) => observable(source.next(...args), observeStream),
              return: (value?: unknown) => observable(source.return!(value as never), observeStream),
              [Symbol.asyncIterator]() { return this; }
            };
          };
          Object.defineProperties(output, {
            getReader: { value: (...args: unknown[]) => {
              const reader = (getReader as (...args: unknown[]) => ReadableStreamDefaultReader<Uint8Array>)(...args);
              return new Proxy(reader, { get(target, property) {
                if (property === "read") return (...readArgs: unknown[]) => observable(
                  (target.read as (...args: unknown[]) => Promise<ReadableStreamReadResult<Uint8Array>>).apply(target, readArgs), observeStream);
                if (property === "closed") return observable(target.closed, observeStream);
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              } });
            } },
            pipeTo: { value: (destination: WritableStream<Uint8Array>, options?: StreamPipeOptions) => observable(pipeTo(destination, options), observeStream) },
            pipeThrough: { value: (transform: ReadableWritablePair<Uint8Array, Uint8Array>, options?: StreamPipeOptions) => instrument(pipeThrough(transform, options)) },
            tee: { value: () => { const [left, right] = tee(); return [instrument(left), instrument(right)]; } },
            values: { value: iterator },
            [Symbol.asyncIterator]: { value: iterator }
          });
          return output;
        };
        return instrument(stream);
      }
    } } } };
  };
  try {
    let result: unknown;
    let failure: unknown;
    let failed = false;
    try {
      controller.signal.throwIfAborted();
      result = await backend.operations[operation].execute({ project: project.name, app: id, config: Object.freeze(structuredClone(app.config)), signal: controller.signal,
        getProjectStoreBinding: async key => {
          if (closing) throw new AppError("APP_OPERATION_CLOSED", "Operation is closed");
          const binding = await projectStoreBinding(project, app, key, controller.signal);
          return { storeId: binding.storeId, token: binding.token };
        },
        getStore: async (key, options) => {
          if (closing) throw new AppError("APP_OPERATION_CLOSED", "Operation is closed");
          if (app.manifest.stores.some(store => store.key === key)) return host.manager.getStore({ signal: controller.signal }, `apps/${id}/${key}`);
          const binding = await projectStoreBinding(project, app, key, controller.signal);
          if (options?.expectedBinding !== binding.token)
            throw new AppError("APP_STORE_BINDING_CHANGED", `Project Store binding changed or token missing: ${key}`);
          const store = binding.store;
          return new Proxy(store, { get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (closing) throw new AppError("APP_OPERATION_CLOSED", "Operation is closed");
              if (typeof property === "string" && writes.has(property) && options?.expectedBinding !== binding.token)
                throw new AppError("APP_STORE_BINDING_CHANGED", `Project Store binding changed or token missing: ${key}`);
              const context = args[0] as Context | undefined;
              const signals = [controller.signal, context?.signal].filter((item): item is AbortSignal => Boolean(item));
              args[0] = { ...context, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] };
              return track(Promise.resolve().then(() => value.apply(target, args)).then(result =>
                target.kind === "DataStore" && property === "get" ? wrapDataStream(result as StoredData | undefined) : result));
            };
          } });
        }
      }, input);
    } catch (error) { failed = true; failure = error; controller.abort(error); }
    closing = true;
    while (inFlight.size) await Promise.allSettled([...inFlight]);
    if (failed) throw failure;
    const unobserved = failures.find(item => !item.observed);
    if (unobserved) throw unobserved.error;
    controller.signal.throwIfAborted();
    return result;
  } finally { closing = true; if (deadline) clearTimeout(deadline); signal?.removeEventListener("abort", abort); }
}
