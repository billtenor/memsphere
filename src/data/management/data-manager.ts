import { Config, type JsonObject, type JsonValue } from "../api/config.js";
import type { Context } from "../api/context.js";
import type { Data, ModelRef } from "../api/data.js";
import type { DataManager } from "../api/data-manager.js";
import type { DataStore } from "../api/data-store.js";
import type { DataExtensionRegistry } from "../api/extension-registry.js";
import type { Model } from "../api/model.js";
import type { ModelRuntime, ModelRuntimeRegistry } from "../api/model-runtime.js";
import type { StoreRegistry } from "../api/store.js";
import type { ValueStore } from "../api/value-store.js";
import { DefaultDataExtensionRegistry } from "./extension-registry.js";
import { PreparationCache } from "./preparation.js";

/**
 * 已解码的模型可直接提供，尤其适合内置元模型的启动定义。
 * loadData 只负责定位和读取原始 Data；元模型准备和反序列化由 Manager 完成。
 * dependencies 是创建此模型 Runtime 前需准备的其他模型，不包含定义内部的局部递归。
 */
export type ModelBinding = (
  | { readonly model: Model; readonly ref?: never; readonly loadData?: never }
  | {
      readonly ref: ModelRef;
      readonly loadData: (context: Context) => Promise<Data | undefined>;
      readonly model?: never;
    }
) & { readonly dependencies?: readonly ModelRef[] };

/** 一个模型在当前 Project 中的存储绑定；Config 的含义由所选 Factory 决定。 */
export type StoreBinding = {
  readonly model: ModelRef;
  readonly kind: "DataStore" | "ValueStore";
  readonly factory: string;
  readonly config: Config;
};

/**
 * 宿主解析 Project 配置后提供装配输入，不读取 CLI、环境变量或全局 Project 状态。
 * 文件型配置的相对路径基准由宿主决定；传入绝对 directory 可避免依赖进程 cwd。
 */
export type DataManagerOptions = {
  readonly extensions: DataExtensionRegistry;
  readonly models?: readonly ModelBinding[];
  readonly stores?: readonly StoreBinding[];
};

type RegisteredModel = {
  readonly ref: ModelRef;
  readonly definition?: Model;
  readonly loadData?: (context: Context) => Promise<Data | undefined>;
  readonly dependencies: readonly ModelRef[];
};

/**
 * 单个 Project 的装配实现。构造时复制绑定和 JSON 配置，不执行加载或 Factory 调用。
 * Model.definition 可能是任意标准的内存类型，按只读共享，不做通用深拷贝。
 * 调用方取消只停止该次等待；共享准备工作可以继续完成并缓存，失败可重试。
 */
export class DefaultDataManager implements DataManager {
  private readonly extensions: DataExtensionRegistry;
  private readonly models = new Map<ModelRef, RegisteredModel>();
  private readonly bindings = new Map<ModelRef, StoreBinding>();
  private readonly preparation = new PreparationCache();
  private readonly sharedContext: Context = Object.freeze({});
  private readonly runtimes: ModelRuntimeRegistry = new RuntimeRegistry();
  private readonly stores: StoreRegistry = new InstanceStoreRegistry();
  private readonly factoryRuntimes: ModelRuntimeRegistry;

  constructor(options: DataManagerOptions) {
    // Keep this Manager on the selected catalog even if its caller later registers more extensions.
    this.extensions = new DefaultDataExtensionRegistry(options.extensions.list());
    for (const binding of options.models ?? []) {
      const registered = copyModelBinding(binding);
      if (this.models.has(registered.ref)) throw new Error(`Duplicate model binding: ${registered.ref}`);
      this.models.set(registered.ref, registered);
    }
    for (const binding of options.stores ?? []) {
      const { model, kind, factory, config: sourceConfig } = binding;
      requireId(model, "Store model");
      requireId(factory, "Store factory");
      if (kind !== "DataStore" && kind !== "ValueStore") throw new TypeError("Invalid Store kind");
      if (this.bindings.has(model)) throw new Error(`Duplicate Store binding: ${model}`);
      const config = new Config(copyJsonObject(sourceConfig.json));
      this.bindings.set(model, Object.freeze({ model, kind, factory, config }));
    }
    // Factories consume prepared dependencies; only the Manager may publish new instances.
    this.factoryRuntimes = Object.freeze({
      get: (ref: ModelRef) => this.runtimes.get(ref),
      register() { throw new Error("Runtime registration is owned by DataManager"); }
    });
  }

  getModel(context: Context, ref: ModelRef): Promise<Model> {
    return this.prepareModel(context, ref);
  }

  getRuntime(context: Context, ref: ModelRef): Promise<ModelRuntime> {
    return this.prepareRuntime(context, ref);
  }

  async getStore(context: Context, model: ModelRef): Promise<DataStore | ValueStore> {
    context.signal?.throwIfAborted();
    requireId(model, "Model ID");
    const key = `store:${model}`;
    return this.preparation.get(context, key, async () => {
      const binding = this.bindings.get(model);
      if (!binding) throw new Error(`No Store binding for model: ${model}`);
      let store: DataStore | ValueStore;
      // Give each attempt its own copy; a Factory cannot mutate the binding or a future retry.
      const config = new Config(copyJsonObject(binding.config.json));
      if (binding.kind === "DataStore") {
        const factory = this.extensions.getDataStoreFactory(binding.factory);
        if (!factory) throw new Error(`DataStoreFactory is not registered: ${binding.factory}`);
        store = await factory.createStore(this.sharedContext, model, config);
      } else {
        const factory = this.extensions.getValueStoreFactory(binding.factory);
        if (!factory) throw new Error(`ValueStoreFactory is not registered: ${binding.factory}`);
        const runtime = await this.prepareRuntime(this.sharedContext, model, key);
        store = await factory.createStore(this.sharedContext, runtime, config);
      }
      assertStore(store, binding);
      this.stores.register(store);
      return store;
    });
  }

  private async prepareModel(context: Context, ref: ModelRef, parent?: string): Promise<Model> {
    context.signal?.throwIfAborted();
    requireId(ref, "Model ID");
    const key = `model:${ref}`;
    return this.preparation.get(context, key, async () => {
      const binding = this.requireModel(ref);
      if (binding.definition) return binding.definition;
      const loaded = await binding.loadData!(this.sharedContext);
      if (loaded === undefined) throw new Error(`Model does not exist: ${ref}`);
      const data = copyModelData(loaded, ref);
      const serializer = this.extensions.getPayloadSerializer(data.payload.contentType);
      if (!serializer) throw new Error(`PayloadSerializer is not registered: ${data.payload.contentType}`);
      const metaRuntime = await this.prepareRuntime(this.sharedContext, data.model, key);
      const definition = await serializer.deserialize(this.sharedContext, metaRuntime.descriptor, data.payload.content);
      metaRuntime.reflect(definition);
      return Object.freeze({ data, definition });
    }, parent);
  }

  private async prepareRuntime(context: Context, ref: ModelRef, parent?: string): Promise<ModelRuntime> {
    context.signal?.throwIfAborted();
    requireId(ref, "Model ID");
    const key = `runtime:${ref}`;
    return this.preparation.get(context, key, async () => {
      const model = await this.prepareModel(this.sharedContext, ref, key);
      const factory = this.extensions.getModelRuntimeFactory({ model: ref })
        ?? this.extensions.getModelRuntimeFactory({ metaModel: model.data.model });
      if (!factory) throw new Error(`ModelRuntimeFactory is not registered for model ${ref} or meta-model ${model.data.model}`);
      const binding = this.requireModel(ref);
      for (const dependency of binding.dependencies) {
        await this.prepareRuntime(this.sharedContext, dependency, key);
      }
      const runtime = await factory.createRuntime(this.sharedContext, model, this.factoryRuntimes);
      const root = runtime?.descriptor?.root;
      if (!runtime || runtime.descriptor?.id !== ref || !root || typeof root !== "object"
        || !["object", "array", "scalar", "map"].includes(root.kind) || typeof runtime.reflect !== "function") {
        throw new TypeError(`Factory returned an invalid Runtime for model: ${ref}`);
      }
      this.runtimes.register(runtime);
      return runtime;
    }, parent);
  }

  private requireModel(ref: ModelRef): RegisteredModel {
    const binding = this.models.get(ref);
    if (!binding) throw new Error(`No model binding: ${ref}`);
    return binding;
  }
}

/** Private instance registries have no loading or creation behavior. */
class RuntimeRegistry implements ModelRuntimeRegistry {
  private readonly values = new Map<ModelRef, ModelRuntime>();
  get(ref: ModelRef): ModelRuntime | undefined { return this.values.get(ref); }
  register(runtime: ModelRuntime): void {
    if (this.values.has(runtime.descriptor.id)) throw new Error(`Runtime already registered: ${runtime.descriptor.id}`);
    this.values.set(runtime.descriptor.id, runtime);
  }
}

class InstanceStoreRegistry implements StoreRegistry {
  private readonly values = new Map<ModelRef, DataStore | ValueStore>();
  get(ref: ModelRef): DataStore | ValueStore | undefined { return this.values.get(ref); }
  register(store: DataStore | ValueStore): void {
    if (this.values.has(store.model)) throw new Error(`Store already registered: ${store.model}`);
    this.values.set(store.model, store);
  }
}

function requireId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

function copyModelData(data: Data, ref: ModelRef): Data {
  if (!data || data.id !== ref) throw new TypeError(`Model Data ID must match: ${ref}`);
  const { model, payload } = data;
  requireId(model, "Meta-model ID");
  if (!payload) throw new TypeError(`Invalid model Payload: ${ref}`);
  const { contentType, content } = payload;
  if (typeof content?.stream !== "function") throw new TypeError(`Invalid model Payload: ${ref}`);
  requireId(contentType, "Payload contentType");
  return Object.freeze({ id: ref, model, payload: Object.freeze({ contentType, content }) });
}

function copyModelBinding(binding: ModelBinding): RegisteredModel {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new TypeError("Invalid model binding");
  let ref: ModelRef;
  let definition: Model | undefined;
  let loadData: RegisteredModel["loadData"];
  if ("model" in binding) {
    if ("ref" in binding || "loadData" in binding) throw new TypeError("Model binding must choose model or loadData, not both");
    const model = binding.model;
    if (!model?.data || !("definition" in model)) throw new TypeError("Model binding requires a Model with data and definition");
    ref = model.data.id;
    requireId(ref, "Model ID");
    definition = Object.freeze({ data: copyModelData(model.data, ref), definition: model.definition });
  } else {
    ref = binding.ref!;
    requireId(ref, "Model ID");
    if (typeof binding.loadData !== "function") throw new TypeError(`Model binding requires loadData: ${ref}`);
    loadData = binding.loadData.bind(binding);
  }
  const dependencies = binding.dependencies ?? [];
  if (!Array.isArray(dependencies)) throw new TypeError(`Model dependencies must be an array: ${ref}`);
  for (const dependency of dependencies) requireId(dependency, "Dependency model ID");
  if (new Set(dependencies).size !== dependencies.length) throw new TypeError(`Duplicate model dependency: ${ref}`);
  return Object.freeze({ ref, definition, loadData, dependencies: Object.freeze([...dependencies]) });
}

function assertStore(store: DataStore | ValueStore, binding: StoreBinding): void {
  if (!store || store.model !== binding.model || store.kind !== binding.kind) {
    throw new TypeError(`Factory returned a Store with mismatched model or kind: ${binding.model}`);
  }
  for (const method of ["get", "has", "create", "update", "delete", "list"] as const) {
    if (typeof store[method] !== "function") throw new TypeError(`Factory returned an invalid Store method: ${method}`);
  }
}

function copyJsonObject(value: JsonObject): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Store config must be a JSON object");
  return copyJson(value, new Set()) as JsonObject;
}

/** Config snapshots must not invoke toJSON, accessors, or silently drop invalid values. */
function copyJson(value: JsonValue, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new TypeError("Store config must contain only JSON values");
  if (ancestors.has(value)) throw new TypeError("Store config must not contain cycles");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw new TypeError("Store config must contain plain JSON objects and arrays");
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Store config must not contain symbol properties");
  ancestors.add(value);
  try {
    const result: JsonObject | JsonValue[] = array ? [] : {};
    const names = Object.getOwnPropertyNames(value);
    if (array && names.length !== value.length + 1) throw new TypeError("Store config must contain dense JSON arrays");
    for (const name of names) {
      if (array && name === "length") continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length)) throw new TypeError("Store config arrays must not contain named properties");
      const property = Object.getOwnPropertyDescriptor(value, name)!;
      if (!property.enumerable || !("value" in property)) throw new TypeError("Store config must not contain hidden properties or accessors");
      Object.defineProperty(result, name, {
        value: copyJson(property.value as JsonValue, ancestors), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
