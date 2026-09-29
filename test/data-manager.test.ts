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

function model(id: string, metaModel = "test/schema", definition: unknown = {}): Model {
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

function dataStore(id: string): DataStore {
  return {
    kind: "DataStore", model: id,
    async get() { return undefined; }, async has() { return false; },
    async create(_context, data) { return { data }; },
    async update(_context, data) { return { data }; },
    async delete() { return false; }, async list() { return { items: [] }; }
  };
}

function valueStore(id: string): ValueStore {
  return {
    kind: "ValueStore", model: id,
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
    modelRuntimeFactories: [{ target: { metaModel: "test/schema" }, async createRuntime(_context, input, registry) {
      calls.push("runtime");
      assert.equal(registry.get(input.data.id), undefined);
      entered.resolve();
      await release.promise;
      return runtime(input.data.id);
    } }],
    valueStoreFactories: [{ id: "test/values", async createStore(_context, input) {
      calls.push("store");
      return valueStore(input.descriptor.id);
    } }]
  })]);
  const manager = new DefaultDataManager({
    extensions, models: [{ model: model("order") }],
    stores: [{ model: "order", kind: "ValueStore", factory: "test/values", config: new Config({}) }]
  });
  assert.deepEqual(calls, []);
  assert.equal((await manager.getModel({}, "order")).data.id, "order");
  assert.deepEqual(calls, []);
  const runtimes = [manager.getRuntime({}, "order"), manager.getRuntime({}, "order")];
  const stores = [manager.getStore({}, "order"), manager.getStore({}, "order")];
  await entered.promise;
  assert.deepEqual(calls, ["runtime"]);
  release.resolve();
  const [firstRuntime, secondRuntime] = await Promise.all(runtimes);
  const [firstStore, secondStore] = await Promise.all(stores);
  assert.equal(firstRuntime, secondRuntime);
  assert.equal(firstStore, secondStore);
  assert.equal(await manager.getRuntime({}, "order"), firstRuntime);
  assert.equal(await manager.getStore({}, "order"), firstStore);
  assert.deepEqual(calls, ["runtime", "store"]);
});

test("DataManager prepares declared cross-standard dependencies and prefers an exact model factory", async () => {
  const calls: string[] = [];
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [
    { target: { metaModel: "test/schema" }, async createRuntime(_context, input) {
      calls.push(`fallback:${input.data.id}`);
      return runtime(input.data.id);
    } },
    { target: { metaModel: "other/schema" }, async createRuntime(_context, input) {
      calls.push(`other:${input.data.id}`);
      return runtime(input.data.id);
    } },
    { target: { model: "order" }, async createRuntime(_context, input, registry) {
      assert.equal(registry.get("address")?.descriptor.id, "address");
      assert.equal(registry.get("order"), undefined);
      calls.push("exact:order");
      return runtime(input.data.id);
    } }
  ] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("order"), dependencies: ["address"] },
    { model: model("address", "other/schema") },
    { model: model("fallback") }
  ] });
  await manager.getRuntime({}, "order");
  await manager.getRuntime({}, "fallback");
  assert.deepEqual(calls, ["other:address", "exact:order", "fallback:fallback"]);
});

test("DataManager decodes raw models with the metamodel runtime without creating their own runtime", async () => {
  const calls: string[] = [];
  const definition = { type: "object", properties: { title: { type: "string" } } };
  const extensions = new DefaultDataExtensionRegistry([
    jsonSerializerExtension,
    extension({ modelRuntimeFactories: [
      { target: { model: "test/schema" }, async createRuntime(_context, input) {
        calls.push("metamodel");
        return runtime(input.data.id);
      } },
      { target: { metaModel: "test/schema" }, async createRuntime(_context, input) {
        calls.push("model runtime");
        return runtime(input.data.id);
      } }
    ] })
  ]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema", "test/bootstrap") },
    { ref: "order", async loadData() { calls.push("load"); return model("order", "test/schema", definition).data; } }
  ] });
  assert.deepEqual(calls, []);
  const [first, second] = await Promise.all([manager.getModel({}, "order"), manager.getModel({}, "order")]);
  assert.equal(first, second);
  assert.deepEqual(first.definition, definition);
  assert.equal(first.data.id, "order");
  assert.deepEqual(calls, ["load", "metamodel"]);
  await manager.getRuntime({}, "order");
  assert.deepEqual(calls, ["load", "metamodel", "model runtime"]);
});

test("DataManager raw DataStore binding does not require any model loader or runtime factory", async () => {
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ dataStoreFactories: [{
    id: "test/raw", async createStore(_context, id, config) {
      creations += 1;
      assert.deepEqual(config.json, { directory: "host-owned" });
      return dataStore(id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, stores: [{
    model: "unloaded/model", kind: "DataStore", factory: "test/raw", config: new Config({ directory: "host-owned" })
  }] });
  const [first, second] = await Promise.all([manager.getStore({}, "unloaded/model"), manager.getStore({}, "unloaded/model")]);
  assert.equal(first.kind, "DataStore");
  assert.equal(first, second);
  assert.equal(creations, 1);
  await assert.rejects(manager.getModel({}, "unloaded/model"), /model|binding|locat/i);
});

test("DataManager snapshots bindings, dependency lists, nested Config JSON, and the extension catalog", async () => {
  const calls: string[] = [];
  const extensions = new DefaultDataExtensionRegistry([extension({
    modelRuntimeFactories: [{ target: { metaModel: "test/schema" }, async createRuntime(_context, input, registry) {
      if (input.data.id === "order") assert.equal(registry.get("dependency")?.descriptor.id, "dependency");
      calls.push(input.data.id);
      return runtime(input.data.id);
    } }],
    dataStoreFactories: [{ id: "test/raw", async createStore(_context, id, config) {
      assert.deepEqual(config.json, { directory: "original", nested: { items: ["original"] } });
      return dataStore(id);
    } }]
  })]);
  const dependencies = ["dependency"];
  const models = [{ model: model("order"), dependencies }, { model: model("dependency"), dependencies: [] as string[] }];
  const config = new Config({ directory: "original", nested: { items: ["original"] } });
  const stores = [{ model: "order", kind: "DataStore" as const, factory: "test/raw", config }];
  const manager = new DefaultDataManager({ extensions, models, stores });
  dependencies.splice(0, 1, "missing");
  models.length = 0;
  stores[0].factory = "missing";
  stores.length = 0;
  config.json.directory = "changed";
  (config.json.nested as { items: string[] }).items[0] = "changed";
  extensions.register(extension({ modelRuntimeFactories: [{ target: { model: "order" }, async createRuntime() {
    throw new Error("Late extension must not enter this manager's snapshot");
  } }] }, "test/late"));
  await manager.getRuntime({}, "order");
  assert.deepEqual(calls, ["dependency", "order"]);
  assert.equal((await manager.getStore({}, "order")).model, "order");
});

test("DataManager snapshots model, Payload, and store bindings supplied through prototype getters", async () => {
  class ModelPayload {
    constructor(private readonly definition: unknown) {}
    get contentType() { return "application/json"; }
    get content() { return bytesContent(new TextEncoder().encode(JSON.stringify(this.definition))); }
  }
  class RawStoreBinding {
    constructor(private readonly modelId: string, private readonly settings: Config) {}
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
    modelRuntimeFactories: [{ target: { model: "test/schema" }, async createRuntime(_context, input) {
      return runtime(input.data.id);
    } }],
    dataStoreFactories: [{ id: "test/raw", async createStore(_context, id, config) {
      assert.equal(id, "order");
      assert.deepEqual(config.json, { source: "prototype getters" });
      return dataStore(id);
    } }]
  })]);
  const seed = new DecodedModel(model("test/schema", "test/bootstrap", { seed: true }));
  const manager = new DefaultDataManager({ extensions, models: [
    new DecodedModelBinding(seed),
    { ref: "order", async loadData() { return { id: "order", model: "test/schema", payload }; } }
  ], stores: [new RawStoreBinding("order", new Config({ source: "prototype getters" }))] });
  const copiedSeed = await manager.getModel({}, "test/schema");
  assert.equal(copiedSeed.data.id, "test/schema");
  assert.deepEqual(copiedSeed.definition, { seed: true });
  const decoded = await manager.getModel({}, "order");
  assert.equal(decoded.data.payload.contentType, "application/json");
  assert.equal(typeof decoded.data.payload.content.stream, "function");
  assert.deepEqual(decoded.definition, definition);
  const prepared = await manager.getStore({}, "order");
  assert.equal(prepared.model, "order");
  assert.equal(prepared.kind, "DataStore");
});

test("DataManager rejects missing bindings and capabilities instead of guessing defaults", async () => {
  const extensions = new DefaultDataExtensionRegistry([filesystemDataStoreExtension]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order") }], stores: [
    { model: "order", kind: "ValueStore", factory: "missing", config: new Config({}) },
    { model: "raw", kind: "DataStore", factory: "missing", config: new Config({}) }
  ] });
  await assert.rejects(manager.getModel({}, "missing"), /model|binding|locat/i);
  await assert.rejects(manager.getRuntime({}, "order"), /factory|runtime/i);
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
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order", "") }] }));
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order") }, { model: model("order") }] }));
  assert.throws(() => new DefaultDataManager({ extensions, models: [{ model: model("order"), dependencies: [""] }] }));
  const binding = { model: "order", kind: "DataStore" as const, factory: "raw", config: new Config({}) };
  assert.throws(() => new DefaultDataManager({ extensions, stores: [binding, binding] }));
  assert.throws(() => new DefaultDataManager({ extensions, stores: [{ ...binding, model: "" }] }));
  assert.throws(() => new DefaultDataManager({ extensions, stores: [{ ...binding, factory: "" }] }));
});

test("DataManager model load failures and mismatched Data identity are not cached as success", async () => {
  let loads = 0;
  const extensions = new DefaultDataExtensionRegistry([jsonSerializerExtension, extension({ modelRuntimeFactories: [{
    target: { model: "test/schema" }, async createRuntime(_context, input) { return runtime(input.data.id); }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema", "test/bootstrap") },
    { ref: "order", async loadData() {
      loads += 1;
      if (loads === 1) return undefined;
      if (loads === 2) return model("wrong").data;
      return model("order").data;
    } }
  ] });
  await assert.rejects(manager.getModel({}, "order"), /model|missing|found|load/i);
  await assert.rejects(manager.getModel({}, "order"), /identity|id|match/i);
  assert.equal((await manager.getModel({}, "order")).data.id, "order");
  assert.equal(loads, 3);
  await manager.getModel({}, "order");
  assert.equal(loads, 3);
});

test("DataManager raw model decoding requires both a matching serializer and a locatable metamodel", async () => {
  const unsupported = model("unsupported").data;
  unsupported.payload.contentType = "application/x-test-schema";
  const manager = new DefaultDataManager({
    extensions: new DefaultDataExtensionRegistry([jsonSerializerExtension]),
    models: [
      { ref: "unsupported", async loadData() { return unsupported; } },
      { ref: "missing-meta", async loadData() { return model("missing-meta", "unbound/schema").data; } }
    ]
  });
  await assert.rejects(manager.getModel({}, "unsupported"), /serializer|content.?type/i);
  await assert.rejects(manager.getModel({}, "missing-meta"), /unbound\/schema/);
});

test("DataManager validates decoded definitions with the metamodel and retries without retaining invalid models", async () => {
  let loads = 0;
  let metaCreations = 0;
  const extensions = new DefaultDataExtensionRegistry([jsonSerializerExtension, extension({ modelRuntimeFactories: [{
    target: { model: "test/schema" }, async createRuntime(_context, input) {
      metaCreations += 1;
      return createPlainRuntime({ id: input.data.id, root: { kind: "object", fields: [], field: () => undefined } }, {
        validate(value) {
          if ((value as { supported?: boolean }).supported !== true) throw new Error("unsupported definition");
        }
      });
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("test/schema", "test/bootstrap") },
    { ref: "order", async loadData() {
      loads += 1;
      return model("order", "test/schema", { supported: loads > 1 }).data;
    } }
  ] });
  await assert.rejects(manager.getModel({}, "order"), /unsupported definition/);
  assert.deepEqual((await manager.getModel({}, "order")).definition, { supported: true });
  assert.equal(loads, 2);
  assert.equal(metaCreations, 1);
});

test("DataManager runtime failures and incorrect identities are never published and remain retryable", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema" }, async createRuntime(_context, input, registry) {
      assert.equal(registry.get(input.data.id), undefined);
      attempts += 1;
      if (attempts === 1) throw new Error("transient runtime failure");
      return runtime(attempts === 2 ? "wrong" : input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order") }] });
  await assert.rejects(manager.getRuntime({}, "order"), /transient runtime failure/);
  await assert.rejects(manager.getRuntime({}, "order"), /identity|id|match/i);
  const prepared = await manager.getRuntime({}, "order");
  assert.equal(prepared.descriptor.id, "order");
  assert.equal(await manager.getRuntime({}, "order"), prepared);
  assert.equal(attempts, 3);
});

test("DataManager does not publish malformed runtime roots and can retry with a valid descriptor", async () => {
  const malformedRoots = [42, null, { kind: "unsupported" }];
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema" }, async createRuntime(_context, input, registry) {
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
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order") }] });
  for (const _root of malformedRoots) await assert.rejects(manager.getRuntime({}, "order"), /runtime|descriptor|root/i);
  const prepared = await manager.getRuntime({}, "order");
  assert.equal(prepared.descriptor.root.kind, "object");
  assert.equal(await manager.getRuntime({}, "order"), prepared);
  assert.equal(attempts, malformedRoots.length + 1);
});

test("DataManager forbids factories from publishing runtime instances through the dependency registry", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema" }, async createRuntime(_context, input, registry) {
      attempts += 1;
      assert.equal(registry.get("rogue"), undefined);
      assert.equal(registry.get(input.data.id), undefined);
      if (attempts === 1) registry.register(runtime("rogue"));
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order") }] });
  await assert.rejects(manager.getRuntime({}, "order"), /regist|owned|manager/i);
  assert.equal((await manager.getRuntime({}, "order")).descriptor.id, "order");
  assert.equal(attempts, 2);
});

test("DataManager store failures and incorrect model or kind are never published and remain retryable", async () => {
  let attempts = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ dataStoreFactories: [{
    id: "test/raw", async createStore(_context, id) {
      attempts += 1;
      if (attempts === 1) throw new Error("transient store failure");
      if (attempts === 2) return dataStore("wrong");
      if (attempts === 3) return valueStore(id) as unknown as DataStore;
      return dataStore(id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, stores: [{
    model: "order", kind: "DataStore", factory: "test/raw", config: new Config({})
  }] });
  await assert.rejects(manager.getStore({}, "order"), /transient store failure/);
  await assert.rejects(manager.getStore({}, "order"), /identity|model|match/i);
  await assert.rejects(manager.getStore({}, "order"), /kind|DataStore|match/i);
  const prepared = await manager.getStore({}, "order");
  assert.equal(prepared.kind, "DataStore");
  assert.equal(prepared.model, "order");
  assert.equal(await manager.getStore({}, "order"), prepared);
  assert.equal(attempts, 4);
});

test("DataManager rejects declared dependency cycles before invoking runtime factories", { timeout: 2000 }, async () => {
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema" }, async createRuntime(_context, input) {
      creations += 1;
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [
    { model: model("a"), dependencies: ["b"] }, { model: model("b"), dependencies: ["a"] }
  ] });
  await assert.rejects(manager.getRuntime({}, "a"), /cycl/i);
  await assert.rejects(manager.getRuntime({}, "a"), /cycl/i);
  assert.equal(creations, 0);
});

test("DataManager cancellation stops one waiter without poisoning shared runtime preparation", { timeout: 2000 }, async () => {
  const started = deferred();
  const release = deferred();
  let creations = 0;
  const extensions = new DefaultDataExtensionRegistry([extension({ modelRuntimeFactories: [{
    target: { metaModel: "test/schema" }, async createRuntime(context, input) {
      creations += 1;
      started.resolve();
      await release.promise;
      assert.notEqual(context.signal?.aborted, true);
      return runtime(input.data.id);
    }
  }] })]);
  const manager = new DefaultDataManager({ extensions, models: [{ model: model("order") }] });
  const abort = new AbortController();
  const cancelled = manager.getRuntime({ signal: abort.signal }, "order");
  const rejected = assert.rejects(cancelled, /abort|cancel|stop/i);
  const survivor = manager.getRuntime({}, "order");
  await started.promise;
  abort.abort(new Error("stop this caller"));
  await rejected;
  release.resolve();
  const prepared = await survivor;
  assert.equal(prepared.descriptor.id, "order");
  assert.equal(await manager.getRuntime({}, "order"), prepared);
  assert.equal(creations, 1);
  await assert.rejects(manager.getRuntime({ signal: abort.signal }, "order"), /abort|cancel|stop/i);
});

test("DataManager integrates JSON Schema and filesystem JSON value stores with per-project isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-data-manager-"));
  try {
    const firstDirectory = join(directory, "first");
    const secondDirectory = join(directory, "second");
    const extensions = new DefaultDataExtensionRegistry([jsonSchemaExtension, filesystemJsonValueStoreExtension]);
    const order = model("order", JSON_SCHEMA_DRAFT_07, {
      type: "object", properties: { title: { type: "string", minLength: 1 } },
      required: ["title"], additionalProperties: false
    });
    const createManager = (storeDirectory: string) => new DefaultDataManager({
      extensions, models: [{ model: order }], stores: [{
        model: "order", kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory: storeDirectory })
      }]
    });
    const first = createManager(firstDirectory);
    const second = createManager(secondDirectory);
    assert.deepEqual(await readdir(directory), []);
    const [firstStore, sameStore, secondStore] = await Promise.all([
      first.getStore({}, "order"), first.getStore({}, "order"), second.getStore({}, "order")
    ]);
    assert.equal(firstStore, sameStore);
    assert.notEqual(firstStore, secondStore);
    assert.notEqual(await first.getRuntime({}, "order"), await second.getRuntime({}, "order"));
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
