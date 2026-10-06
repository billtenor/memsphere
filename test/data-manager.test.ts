import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import type { DataStore } from "../src/data/api/data-store.js";
import type { DataExtension } from "../src/data/api/extension.js";
import type { Model } from "../src/data/api/model.js";
import type { ModelRuntime } from "../src/data/api/model-runtime.js";
import type { ValueStore } from "../src/data/api/value-store.js";
import {
  filesystemDataStoreExtension, filesystemJsonValueStoreExtension,
  jsonSchemaExtension, jsonSerializerExtension, JSON_SCHEMA_DRAFT_07
} from "../src/data/extensions/index.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { DefaultDataManager } from "../src/data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../src/data/management/extension-registry.js";

function model(id: string, metaModel = "test/schema.json", definition: unknown = {}): Model {
  return {
    data: {
      id, model: metaModel,
      payload: {
        contentType: "application/json",
        content: bytesContent(new TextEncoder().encode(JSON.stringify(definition)))
      }
    },
    definition
  };
}

function runtime(id: string): ModelRuntime {
  return createPlainRuntime({ id, root: { kind: "object", fields: [], field: () => undefined } });
}

function extension(capabilities: Omit<DataExtension, "id" | "version">, id = "test/manager"): DataExtension {
  return { id, version: "1", ...capabilities };
}

function dataStore(id: string, model = id): DataStore {
  return {
    id, kind: "DataStore", model,
    async get() { return undefined; }, async has() { return false; },
    async create() {}, async update() {},
    async delete() { return false; }, async list() { return { items: [] }; }
  };
}

function valueStore(id: string, model = id): ValueStore {
  return {
    id, kind: "ValueStore", model,
    async get() { return undefined; }, async has() { return false; },
    async create(_context, itemId, value) { return { id: itemId, value }; },
    async update(_context, itemId, value) { return { id: itemId, value }; },
    async delete() { return false; }, async list() { return { items: [] }; }
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

test("DataManager constructs lazily and coalesces concurrent runtime and value store preparation", async () => {
  const calls: string[] = [];
  const entered = deferred();
  const release = deferred();
  const extensions = new DefaultDataExtensionRegistry([extension({
    modelRuntimeFactories: [{ target: { metaModel: "test/schema.json" }, async createRuntime(_context, input, registry) {
      calls.push("runtime");
      assert.equal(registry.get(input.data.id), undefined);
      entered.resolve();
      await release.promise;
      return runtime(input.data.id);
    } }],
    valueStoreFactories: [{ id: "test/values", async createStore(_context, id, input) {
      calls.push("store");
      return valueStore(id, input.descriptor.id);
    } }]
  })]);
  const manager = new DefaultDataManager({
    extensions, models: [{ model: model("order.json") }],
    stores: [{ id: "orders", model: "order.json", kind: "ValueStore", factory: "test/values", config: new Config({}) }]
  });
  assert.deepEqual(calls, []);
  assert.equal((await manager.getModel({}, "order.json")).data.id, "order.json");
  assert.deepEqual(calls, []);
  const runtimes = [manager.getRuntime({}, "order.json"), manager.getRuntime({}, "order.json")];
  const stores = [manager.getStore({}, "orders"), manager.getStore({}, "orders")];
  await entered.promise;
  assert.deepEqual(calls, ["runtime"]);
  release.resolve();
  const [firstRuntime, secondRuntime] = await Promise.all(runtimes);
  const [firstStore, secondStore] = await Promise.all(stores);
  assert.equal(firstRuntime, secondRuntime);
  assert.equal(firstStore, secondStore);
  assert.equal(await manager.getRuntime({}, "order.json"), firstRuntime);
  assert.equal(await manager.getStore({}, "orders"), firstStore);
  assert.equal(firstStore.id, "orders");
  assert.equal(firstStore.model, "order.json");
  assert.deepEqual(calls, ["runtime", "store"]);
});

test("DataManager prepares declared cross-standard dependencies and prefers an exact model factory", async () => {
  const calls: string[] = [];
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [
    { target: { metaModel: "test/schema.json" }, async createRuntime(_context, input) {
      calls.push(`fallback:${input.data.id}`);
      return runtime(input.data.id);
    } },
    { target: { metaModel: "other/schema.json" }, async createRuntime(_context, input) {
      calls.push(`other:${input.data.id}`);
      return runtime(input.data.id);
    } },
    { target: { model: "order.json" }, async createRuntime(_context, input, registry) {
      assert.equal(registry.get("address.json")?.descriptor.id, "address.json");
      assert.equal(registry.get("order.json"), undefined);
      calls.push("exact:order");
      return runtime(input.data.id);
    } }
  ] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("order.json"), dependencies: ["address.json"] },
    { model: model("address.json", "other/schema.json") },
    { model: model("fallback.json") }
  ] });
  await manager.getRuntime({}, "order.json");
  await manager.getRuntime({}, "fallback.json");
  assert.deepEqual(calls, ["other:address.json", "exact:order", "fallback:fallback.json"]);
});

test("DataManager decodes raw models with the metamodel runtime without creating their own runtime", async () => {
  const calls: string[] = [];
  const definition = { type: "object", properties: { title: { type: "string" } } };
  const extensions = new DefaultDataExtensionRegistry([
    jsonSerializerExtension,
    extension({ modelRuntimeFactories: [
      { target: { model: "test/schema.json" }, async createRuntime(_context, input) {
        calls.push("metamodel");
        return runtime(input.data.id);
      } },
      { target: { metaModel: "test/schema.json" }, async createRuntime(_context, input) {
        calls.push("model runtime");
        return runtime(input.data.id);
      } }
    ] })
  ]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema.json", "test/bootstrap.json") },
    { ref: "order.json", async loadData() { calls.push("load"); return model("order.json", "test/schema.json", definition).data; } }
  ] });
  assert.deepEqual(calls, []);
  const [first, second] = await Promise.all([manager.getModel({}, "order.json"), manager.getModel({}, "order.json")]);
  assert.equal(first, second);
  assert.deepEqual(first.definition, definition);
  assert.equal(first.data.id, "order.json");
  assert.deepEqual(calls, ["load", "metamodel"]);
  await manager.getRuntime({}, "order.json");
  assert.deepEqual(calls, ["load", "metamodel", "model runtime"]);
});

test("DataManager raw DataStore binding does not require any model loader or runtime factory", async () => {
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ dataStoreFactories: [{
    id: "test/raw", async createStore(_context, id, model, config) {
      creations += 1;
      assert.deepEqual(config.json, { directory: "host-owned" });
      return dataStore(id, model);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, stores: [{
    id: "raw-data", model: "unloaded/model.json", kind: "DataStore", factory: "test/raw", config: new Config({ directory: "host-owned" })
  }] });
  const [first, second] = await Promise.all([manager.getStore({}, "raw-data"), manager.getStore({}, "raw-data")]);
  assert.equal(first.kind, "DataStore");
  assert.equal(first, second);
  assert.equal(creations, 1);
  assert.equal(first.id, "raw-data");
  assert.equal(first.model, "unloaded/model.json");
  await assert.rejects(manager.getStore({}, "unloaded/model.json"), /store|binding/i);
  await assert.rejects(manager.getModel({}, "unloaded/model.json"), /model|binding|locat/i);
});

test("DataManager snapshots bindings, dependency lists, nested Config JSON, and the extension catalog", async () => {
  const calls: string[] = [];
  const extensions = new DefaultDataExtensionRegistry([extension({
    modelRuntimeFactories: [{ target: { metaModel: "test/schema.json" }, async createRuntime(_context, input, registry) {
      if (input.data.id === "order.json") assert.equal(registry.get("dependency.json")?.descriptor.id, "dependency.json");
      calls.push(input.data.id);
      return runtime(input.data.id);
    } }],
    dataStoreFactories: [{ id: "test/raw", async createStore(_context, id, model, config) {
      assert.deepEqual(config.json, { directory: "original", nested: { items: ["original"] } });
      return dataStore(id, model);
    } }]
  })]);
  const dependencies = ["dependency.json"];
  const models = [{ model: model("order.json"), dependencies }, { model: model("dependency.json"), dependencies: [] as string[] }];
  const config = new Config({ directory: "original", nested: { items: ["original"] } });
  const stores = [{ id: "order", model: "order.json", kind: "DataStore" as const, factory: "test/raw", config }];
  const manager = new DefaultDataManager({ extensions, models, stores });
  dependencies.splice(0, 1, "missing");
  models.length = 0;
  stores[0].id = "changed-store";
  stores[0].model = "changed-model.json";
  stores[0].factory = "missing";
  stores.length = 0;
  config.json.directory = "changed";
  (config.json.nested as { items: string[] }).items[0] = "changed";
  extensions.register(extension({ modelRuntimeFactories: [{ target: { model: "order.json" }, async createRuntime() {
    throw new Error("Late extension must not enter this manager's snapshot");
  } }] }, "test/late"));
  await manager.getRuntime({}, "order.json");
  assert.deepEqual(calls, ["dependency.json", "order.json"]);
  assert.equal((await manager.getStore({}, "order")).model, "order.json");
});

test("DataManager snapshots model, Payload, and store bindings supplied through prototype getters", async () => {
  class ModelPayload {
    constructor(private readonly definition: unknown) {}
    get contentType() { return "application/json"; }
    get content() { return bytesContent(new TextEncoder().encode(JSON.stringify(this.definition))); }
  }
  class RawStoreBinding {
    constructor(private readonly modelId: string, private readonly settings: Config) {}
    get id() { return "orders"; }
    get model() { return this.modelId; }
    get kind() { return "DataStore" as const; }
    get factory() { return "test/raw"; }
    get config() { return this.settings; }
  }
  class DecodedModel {
    constructor(private readonly input: Model) {}
    get data() { return this.input.data; }
    get definition() { return this.input.definition; }
  }
  class DecodedModelBinding {
    constructor(private readonly input: Model) {}
    get model() { return this.input; }
  }
  const definition = { title: "class-backed payload" };
  const payload = new ModelPayload(definition);
  const extensions = new DefaultDataExtensionRegistry([jsonSerializerExtension, extension({
    modelRuntimeFactories: [{ target: { model: "test/schema.json" }, async createRuntime(_context, input) {
      return runtime(input.data.id);
    } }],
    dataStoreFactories: [{ id: "test/raw", async createStore(_context, id, model, config) {
      assert.equal(id, "orders");
      assert.equal(model, "order.json");
      assert.deepEqual(config.json, { source: "prototype getters" });
      return dataStore(id, model);
    } }]
  })]);
  const seed = new DecodedModel(model("test/schema.json", "test/bootstrap.json", { seed: true }));
  const manager = new DefaultDataManager({ extensions, models: [
    new DecodedModelBinding(seed),
    { ref: "order.json", async loadData() { return { id: "order.json", model: "test/schema.json", payload }; } }
  ], stores: [new RawStoreBinding("order.json", new Config({ source: "prototype getters" }))] });
  const copiedSeed = await manager.getModel({}, "test/schema.json");
  assert.equal(copiedSeed.data.id, "test/schema.json");
  assert.deepEqual(copiedSeed.definition, { seed: true });
  const decoded = await manager.getModel({}, "order.json");
  assert.equal(decoded.data.payload.contentType, "application/json");
  assert.equal(typeof decoded.data.payload.content.stream, "function");
  assert.deepEqual(decoded.definition, definition);
  const prepared = await manager.getStore({}, "orders");
  assert.equal(prepared.id, "orders");
  assert.equal(prepared.model, "order.json");
  assert.equal(prepared.kind, "DataStore");
});

test("DataManager rejects missing bindings and capabilities instead of guessing defaults", async () => {
  const extensions = new DefaultDataExtensionRegistry([filesystemDataStoreExtension]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order.json") }], stores: [
    { id: "order", model: "order.json", kind: "ValueStore", factory: "missing", config: new Config({}) },
    { id: "raw", model: "raw.json", kind: "DataStore", factory: "missing", config: new Config({}) }
  ] });
  await assert.rejects(manager.getModel({}, "missing"), /model|binding|locat/i);
  await assert.rejects(manager.getRuntime({}, "order.json"), /factory|runtime/i);
  await assert.rejects(manager.getStore({}, "unbound"), /store|binding/i);
  await assert.rejects(manager.getStore({}, "order"), /factory|runtime/i);
  await assert.rejects(manager.getStore({}, "raw"), /factory/i);
  for (const invalid of ["", " "]) {
    await assert.rejects(manager.getModel({}, invalid));
    await assert.rejects(manager.getRuntime({}, invalid));
    await assert.rejects(manager.getStore({}, invalid));
  }
});

test("DataManager rejects invalid and duplicate input bindings before any factory call", () => {
  const extensions = new DefaultDataExtensionRegistry();
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("") }] }));
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order.json", "") }] }));
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order.json") }, { model: model("order.json") }] }));
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order.json"), dependencies: [""] }] }));
  const binding = { id: "orders", model: "order.json", kind: "DataStore" as const, factory: "raw", config: new Config({}) };
  assert.throws(() => new DefaultDataManager({ extensions, stores: [binding, binding] }));
  assert.throws(() => new DefaultDataManager({ extensions, stores: [binding, { ...binding, model: "other", kind: "ValueStore" }] }), /duplicate/i);
  for (const id of ["", " ", undefined as unknown as string]) {
    assert.throws(() => new DefaultDataManager({ extensions, stores: [{ ...binding, id }] }), /store id/i);
  }
  assert.throws(() => new DefaultDataManager({ extensions, stores: [{ ...binding, model: "" }] }));
  assert.throws(() => new DefaultDataManager({ extensions, stores: [{ ...binding, factory: "" }] }));
});

test("DataManager model load failures and mismatched Data identity are not cached as success", async () => {
  let loads = 0;
  const extensions = new DefaultDataExtensionRegistry([jsonSerializerExtension, extension({ modelRuntimeFactories: [{
    target: { model: "test/schema.json" }, async createRuntime(_context, input) { return runtime(input.data.id); }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema.json", "test/bootstrap.json") },
    { ref: "order.json", async loadData() {
      loads += 1;
      if (loads === 1) return undefined;
      if (loads === 2) return model("wrong").data;
      return model("order.json").data;
    } }
  ] });
  await assert.rejects(manager.getModel({}, "order.json"), /model|missing|found|load/i);
  await assert.rejects(manager.getModel({}, "order.json"), /identity|id|match/i);
  assert.equal((await manager.getModel({}, "order.json")).data.id, "order.json");
  assert.equal(loads, 3);
  await manager.getModel({}, "order.json");
  assert.equal(loads, 3);
});

test("DataManager raw model decoding requires both a matching serializer and a locatable metamodel", async () => {
  const unsupported = model("unsupported.json").data;
  unsupported.payload.contentType = "application/x-test-schema";
  const manager = new DefaultDataManager({
    extensions: new DefaultDataExtensionRegistry([jsonSerializerExtension]),
    models: [
      { ref: "unsupported.json", async loadData() { return unsupported; } },
      { ref: "missing-meta.json", async loadData() { return model("missing-meta.json", "unbound/schema.json").data; } }
    ]
  });
  await assert.rejects(manager.getModel({}, "unsupported.json"), /serializer|content.?type/i);
  await assert.rejects(manager.getModel({}, "missing-meta.json"), /unbound\/schema/);
});

test("DataManager validates decoded definitions with the metamodel and retries without retaining invalid models", async () => {
  let loads = 0;
  let metaCreations = 0;
  const extensions = new DefaultDataExtensionRegistry([jsonSerializerExtension, extension({ modelRuntimeFactories: [{
    target: { model: "test/schema.json" }, async createRuntime(_context, input) {
      metaCreations += 1;
      return createPlainRuntime({ id: input.data.id, root: { kind: "object", fields: [], field: () => undefined } }, {
        validate(value) {
          if ((value as { supported?: boolean }).supported !== true) throw new Error("unsupported definition");
        }
      });
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema.json", "test/bootstrap.json") },
    { ref: "order.json", async loadData() {
      loads += 1;
      return model("order.json", "test/schema.json", { supported: loads > 1 }).data;
    } }
  ] });
  await assert.rejects(manager.getModel({}, "order.json"), /unsupported definition/);
  assert.deepEqual((await manager.getModel({}, "order.json")).definition, { supported: true });
  assert.equal(loads, 2);
  assert.equal(metaCreations, 1);
});

test("DataManager runtime failures and incorrect identities are never published and remain retryable", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema.json" }, async createRuntime(_context, input, registry) {
      assert.equal(registry.get(input.data.id), undefined);
      attempts += 1;
      if (attempts === 1) throw new Error("transient runtime failure");
      return runtime(attempts === 2 ? "wrong" : input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order.json") }] });
  await assert.rejects(manager.getRuntime({}, "order.json"), /transient runtime failure/);
  await assert.rejects(manager.getRuntime({}, "order.json"), /identity|id|match/i);
  const prepared = await manager.getRuntime({}, "order.json");
  assert.equal(prepared.descriptor.id, "order.json");
  assert.equal(await manager.getRuntime({}, "order.json"), prepared);
  assert.equal(attempts, 3);
});

test("DataManager does not publish malformed runtime roots and can retry with a valid descriptor", async () => {
  const malformedRoots = [42, null, { kind: "unsupported.json" }];
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema.json" }, async createRuntime(_context, input, registry) {
      assert.equal(registry.get(input.data.id), undefined);
      const prepared = runtime(input.data.id);
      const attempt = attempts++;
      if (attempt >= malformedRoots.length) return prepared;
      return {
        descriptor: { id: input.data.id, root: malformedRoots[attempt] },
        reflect: prepared.reflect.bind(prepared)
      } as unknown as ModelRuntime;
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order.json") }] });
  for (const _root of malformedRoots) await assert.rejects(manager.getRuntime({}, "order.json"), /runtime|descriptor|root/i);
  const prepared = await manager.getRuntime({}, "order.json");
  assert.equal(prepared.descriptor.root.kind, "object");
  assert.equal(await manager.getRuntime({}, "order.json"), prepared);
  assert.equal(attempts, malformedRoots.length + 1);
});

test("DataManager forbids factories from publishing runtime instances through the dependency registry", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema.json" }, async createRuntime(_context, input, registry) {
      attempts += 1;
      assert.equal(registry.get("rogue.json"), undefined);
      assert.equal(registry.get(input.data.id), undefined);
      if (attempts === 1) registry.register(runtime("rogue.json"));
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order.json") }] });
  await assert.rejects(manager.getRuntime({}, "order.json"), /regist|owned|manager/i);
  assert.equal((await manager.getRuntime({}, "order.json")).descriptor.id, "order.json");
  assert.equal(attempts, 2);
});

test("DataManager store failures and incorrect ID, model or kind are never published and remain retryable", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ dataStoreFactories: [{
    id: "test/raw", async createStore(_context, id, model) {
      attempts += 1;
      if (attempts === 1) throw new Error("transient store failure");
      if (attempts === 2) return dataStore("wrong", model);
      if (attempts === 3) return dataStore(id, "wrong");
      if (attempts === 4) return valueStore(id, model) as unknown as DataStore;
      return dataStore(id, model);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, stores: [{
    id: "orders", model: "order.json", kind: "DataStore", factory: "test/raw", config: new Config({})
  }] });
  await assert.rejects(manager.getStore({}, "orders"), /transient store failure/);
  await assert.rejects(manager.getStore({}, "orders"), /identity|id|match/i);
  await assert.rejects(manager.getStore({}, "orders"), /model|match/i);
  await assert.rejects(manager.getStore({}, "orders"), /kind|DataStore|match/i);
  const prepared = await manager.getStore({}, "orders");
  assert.equal(prepared.kind, "DataStore");
  assert.equal(prepared.id, "orders");
  assert.equal(prepared.model, "order.json");
  assert.equal(await manager.getStore({}, "orders"), prepared);
  assert.equal(attempts, 5);
});

test("DataManager prepares independent stores for one model and shares only its Runtime", async () => {
  const storeCalls: string[] = [];
  const runtimeInputs: ModelRuntime[] = [];
  let runtimeCalls = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({
    modelRuntimeFactories: [{ target: { metaModel: "test/schema.json" }, async createRuntime(_context, input) {
      runtimeCalls += 1;
      return runtime(input.data.id);
    } }],
    dataStoreFactories: [{ id: "test/raw", async createStore(_context, id, model, config) {
      storeCalls.push(id);
      assert.equal(config.json.directory, id);
      return dataStore(id, model);
    } }],
    valueStoreFactories: [{ id: "test/values", async createStore(_context, id, input, config) {
      storeCalls.push(id);
      runtimeInputs.push(input);
      assert.equal(config.json.directory, id);
      return valueStore(id, input.descriptor.id);
    } }]
  })]);
  const manager = new DefaultDataManager({
    extensions, models: [{ model: model("order.json") }], stores: [
      ...["current", "archived"].map(id => ({
        id, model: "order.json", kind: "DataStore" as const, factory: "test/raw", config: new Config({ directory: id })
      })),
      ...["primary", "replica"].map(id => ({
        id, model: "order.json", kind: "ValueStore" as const, factory: "test/values", config: new Config({ directory: id })
      }))
    ]
  });
  const ids = ["current", "archived", "primary", "replica"];
  const stores = await Promise.all(ids.map(id => manager.getStore({}, id)));
  assert.deepEqual(stores.map(store => store.id), ids);
  assert.deepEqual(stores.map(store => store.model), ids.map(() => "order.json"));
  assert.equal(new Set(stores).size, 4);
  assert.equal(runtimeCalls, 1);
  assert.equal(runtimeInputs[0], runtimeInputs[1]);
  assert.equal(runtimeInputs[0], await manager.getRuntime({}, "order.json"));
  assert.deepEqual([...storeCalls].sort(), [...ids].sort());
  for (const [index, id] of ids.entries()) assert.equal(await manager.getStore({}, id), stores[index]);
  assert.equal(storeCalls.length, 4);
  await assert.rejects(manager.getStore({}, "order"), /store|binding/i);
});

test("DataManager rejects declared dependency cycles before invoking runtime factories", { timeout: 2000 }, async () => {
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema.json" }, async createRuntime(_context, input) {
      creations += 1;
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("a.json"), dependencies: ["b.json"] }, { model: model("b.json"), dependencies: ["a.json"] }
  ] });
  await assert.rejects(manager.getRuntime({}, "a.json"), /cycl/i);
  await assert.rejects(manager.getRuntime({}, "a.json"), /cycl/i);
  assert.equal(creations, 0);
});

test("DataManager cancellation stops one waiter without poisoning shared runtime preparation", { timeout: 2000 }, async () => {
  const started = deferred();
  const release = deferred();
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema.json" }, async createRuntime(context, input) {
      creations += 1;
      started.resolve();
      await release.promise;
      assert.notEqual(context.signal?.aborted, true);
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order.json") }] });
  const abort = new AbortController();
  const cancelled = manager.getRuntime({ signal: abort.signal }, "order.json");
  const rejected = assert.rejects(cancelled, /abort|cancel|stop/i);
  const survivor = manager.getRuntime({}, "order.json");
  await started.promise;
  abort.abort(new Error("stop this caller"));
  await rejected;
  release.resolve();
  const prepared = await survivor;
  assert.equal(prepared.descriptor.id, "order.json");
  assert.equal(await manager.getRuntime({}, "order.json"), prepared);
  assert.equal(creations, 1);
  await assert.rejects(manager.getRuntime({ signal: abort.signal }, "order.json"), /abort|cancel|stop/i);
});

test("DataManager integrates JSON Schema and filesystem JSON value stores with per-project isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-data-manager-"));
  try {
    const firstDirectory = join(directory, "first");
    const secondDirectory = join(directory, "second");
    const extensions = new DefaultDataExtensionRegistry([jsonSchemaExtension, filesystemJsonValueStoreExtension]);
    const order = model("order.json", JSON_SCHEMA_DRAFT_07, {
      type: "object", properties: { title: { type: "string", minLength: 1 } },
      required: ["title"], additionalProperties: false
    });
    const createManager = (storeDirectory: string) => new DefaultDataManager({
      extensions, models: [{ model: order }], stores: [{
        id: "orders", model: "order.json", kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory: storeDirectory })
      }]
    });
    const first = createManager(firstDirectory);
    const second = createManager(secondDirectory);
    assert.deepEqual(await readdir(directory), []);
    const [firstStore, sameStore, secondStore] = await Promise.all([
      first.getStore({}, "orders"), first.getStore({}, "orders"), second.getStore({}, "orders")
    ]);
    assert.equal(firstStore, sameStore);
    assert.equal(firstStore.id, "orders");
    assert.notEqual(firstStore, secondStore);
    assert.notEqual(await first.getRuntime({}, "order.json"), await second.getRuntime({}, "order.json"));
    if (firstStore.kind !== "ValueStore" || secondStore.kind !== "ValueStore") throw new Error("Expected ValueStores");
    const created = await firstStore.create({}, "item", { title: "first project" });
    assert.equal(await secondStore.get({}, "item"), undefined);
    await secondStore.create({}, "item", { title: "second project" });
    assert.deepEqual((await firstStore.get({}, "item"))?.value, { title: "first project" });
    assert.deepEqual((await secondStore.get({}, "item"))?.value, { title: "second project" });
    const text = await readFile(join(firstDirectory, "item.json"), "utf8");
    assert.equal(text, `${JSON.stringify(created, null, 2)}\n`);
    assert.deepEqual(JSON.parse(text), created);
    assert.equal(Object.hasOwn(JSON.parse(text), "model"), false);
    await assert.rejects(firstStore.create({}, "invalid", { title: "" }), /minLength|fewer than 1/);
    assert.equal(await firstStore.has({}, "invalid"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
