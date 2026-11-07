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
