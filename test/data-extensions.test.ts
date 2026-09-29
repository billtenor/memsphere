import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config, type Model, type ModelRuntime, type ModelRuntimeRegistry } from "../src/data/index.js";
import {
  FilesystemDataStoreFactory, FilesystemJsonValueStoreFactory, JsonPayloadSerializer,
  JsonSchemaModelRuntimeFactory, JSON_SCHEMA_DRAFT_07,
  filesystemDataStoreExtension, filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSerializerExtension, rawExtension
} from "../src/data/extensions/index.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";

const definition = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object", required: ["orderNo", "lines"], additionalProperties: false,
  properties: {
    orderNo: { type: "string" },
    lines: {
      type: "array", minItems: 1,
      items: {
        type: "object", required: ["quantity"], additionalProperties: false,
        properties: { quantity: { type: "integer", minimum: 1 } }
      }
    }
  }
};

async function orderRuntime() {
  const registered = new Map<string, ModelRuntime>();
  const registry: ModelRuntimeRegistry = {
    get: id => registered.get(id),
    register(runtime) {
      assert.equal(registered.has(runtime.descriptor.id), false);
      registered.set(runtime.descriptor.id, runtime);
    }
  };
  const model: Model = {
    data: {
      id: "order-model", model: JSON_SCHEMA_DRAFT_07,
      payload: { contentType: "application/json", content: bytesContent(new TextEncoder().encode(JSON.stringify(definition))) }
    },
    definition
  };
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, model, registry);
  registry.register(runtime);
  return runtime;
}

test("built-ins expose five independently selectable single-capability extensions", () => {
  const extensions = [filesystemDataStoreExtension, filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSerializerExtension, rawExtension];
  assert.equal(new Set(extensions.map(extension => extension.id)).size, 5);
  for (const extension of extensions) {
    const capabilities = [extension.dataStoreFactories, extension.valueStoreFactories, extension.modelRuntimeFactories, extension.payloadSerializers];
    assert.equal(capabilities.filter(Boolean).length, 1);
    assert.equal(capabilities.reduce((count, value) => count + (value?.length ?? 0), 0), 1);
  }
});

test("schema reflection composes with readable raw files and independent JSON value records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-data-integration-"));
  try {
    const rawDirectory = join(directory, "raw 文件");
    const valueDirectory = join(directory, "value records");
    const rawConfig = new Config({ directory: rawDirectory });
    const valueConfig = new Config({ directory: valueDirectory });
    const rawId = "a/b/c/order-001.json";
    const rawPath = join(rawDirectory, "a", "b", "c", "order-001.json");
    const runtime = await orderRuntime();
    const serializer = new JsonPayloadSerializer();
    const dataStore = await new FilesystemDataStoreFactory().createStore({}, runtime.descriptor.id, rawConfig);
    const original = { orderNo: "O-001", lines: [{ quantity: 2 }] };
    const content = await serializer.serialize({}, runtime.descriptor, original);
    const written = await dataStore.create({}, {
      id: rawId, model: runtime.descriptor.id, payload: { contentType: serializer.contentType, content }
    });
    assert.deepEqual(JSON.parse(await readFile(rawPath, "utf8")), original);
    assert.equal(written.data.id, rawId);
    assert.equal(written.revision, undefined);
    const rawReopened = await new FilesystemDataStoreFactory().createStore({}, runtime.descriptor.id, rawConfig);
    const rawRecord = await rawReopened.get({}, rawId);
    const decoded = await serializer.deserialize({}, runtime.descriptor, rawRecord!.data.payload.content);
    const valueStore = await new FilesystemJsonValueStoreFactory().createStore({}, runtime, valueConfig);
    const created = await valueStore.create({}, "order-001", decoded);
    const reopened = await new FilesystemJsonValueStoreFactory().createStore({}, await orderRuntime(), valueConfig);
    const stored = await reopened.get({}, "order-001");
    assert.deepEqual(stored?.value, original);
    assert.equal(stored?.revision, 1);
    const recordText = await readFile(join(valueDirectory, "order-001.json"), "utf8");
    assert.deepEqual(JSON.parse(recordText), created);
    assert.match(recordText, /\n  "id": "order-001"/);
    assert.ok(recordText.endsWith("\n"));
    const value = runtime.reflect(stored!.value);
    if (value.kind !== "object") throw new Error("Expected order object");
    const lines = value.get(value.descriptor.field("lines")!);
    if (lines?.kind !== "array") throw new Error("Expected lines array");
    const line = lines.get(0);
    if (line?.kind !== "object") throw new Error("Expected line object");
    const quantity = line.get(line.descriptor.field("quantity")!);
    if (quantity?.kind !== "scalar") throw new Error("Expected quantity scalar");
    assert.throws(() => quantity.set(0), /minimum|>= 1/);
    quantity.set(3);
    const updated = await reopened.update({}, stored!.id, value.value, { expectedRevision: stored!.revision });
    assert.equal(updated.revision, 2);
    const expected = {
      orderNo: "O-001", lines: [{ quantity: 3 }]
    };
    const envelope = JSON.parse(await readFile(join(valueDirectory, "order-001.json"), "utf8"));
    assert.deepEqual(envelope.value, expected);
    assert.equal(envelope.id, "order-001");
    assert.equal(envelope.revision, 2);
    assert.equal(envelope.createdAt, created.createdAt);
    assert.equal(Object.hasOwn(envelope, "model"), false);
    assert.deepEqual((await valueStore.get({}, "order-001"))?.value, expected);
    assert.deepEqual(JSON.parse(await readFile(rawPath, "utf8")), original);
    await assert.rejects(reopened.update({}, stored!.id, original, { expectedRevision: stored!.revision }), /revision|conflict/i);
    await assert.rejects(reopened.create({}, "bad-order", { orderNo: "bad", lines: [] }), /minItems|fewer than 1/);
    assert.equal(await reopened.has({}, "bad-order"), false);
    assert.deepEqual((await reopened.list({})).items, [{ id: "order-001" }]);
    assert.deepEqual((await rawReopened.list({})).items, [{ id: rawId }]);
    assert.deepEqual(await readdir(join(rawDirectory, "a", "b", "c")), ["order-001.json"]);
    assert.deepEqual(await readdir(valueDirectory), ["order-001.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reflection replacement invalidates descendants across independent reflect calls", async () => {
  const runtime = await orderRuntime();
  const raw = { orderNo: "O-001", lines: [{ quantity: 2 }] };
  const first = runtime.reflect(raw);
  const second = runtime.reflect(raw);
  if (first.kind !== "object" || second.kind !== "object") throw new Error();
  const field = first.descriptor.field("lines")!;
  const lines = first.get(field);
  if (lines?.kind !== "array") throw new Error();
  const line = lines.get(0);
  if (line?.kind !== "object") throw new Error();
  const quantity = line.get(line.descriptor.field("quantity")!);
  if (quantity?.kind !== "scalar") throw new Error();
  second.set(field, [{ quantity: 3 }]);
  assert.throws(() => lines.value, /stale/);
  assert.throws(() => quantity.value, /stale/);
  assert.throws(() => quantity.set(4), /stale/);
  assert.deepEqual(raw.lines, [{ quantity: 3 }]);
});
