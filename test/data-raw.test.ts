import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import type { Model } from "../src/data/api/model.js";
import type { ModelRuntimeRegistry } from "../src/data/api/model-runtime.js";
import type { Scalar } from "../src/data/api/reflection.js";
import {
  RAW_MODEL, RawModelRuntime, RawModelRuntimeFactory, rawExtension,
  type RawModelDefinition
} from "../src/data/extensions/raw/index.js";
import { filesystemDataStoreExtension } from "../src/data/extensions/filesystem-datastore/index.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
import { DefaultDataManager } from "../src/data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../src/data/management/extension-registry.js";

function model(definition: unknown = {}, id = "tests/artifact.json", metaModel = RAW_MODEL): Model {
  return {
    data: {
      id, model: metaModel,
      payload: {
        contentType: "application/json",
        content: { stream() { throw new Error("Raw runtime must use the decoded definition, not read Payload"); } }
      }
    },
    definition
  };
}

const noDependencies: ModelRuntimeRegistry = {
  get() { throw new Error("Raw runtime must not look up dependencies"); },
  register() { throw new Error("Runtime registration belongs to the caller"); }
};

function compile(definition: unknown = {}, id?: string) {
  return new RawModelRuntimeFactory().createRuntime({}, model(definition, id), noDependencies);
}

test("raw is an independent, meta-model-targeted Runtime extension without storage or serialization", () => {
  assert.equal(RAW_MODEL, "raw.json");
  assert.equal(rawExtension.id, "memsphere/raw");
  assert.equal(rawExtension.version, "0.1.0");
  assert.equal(rawExtension.modelRuntimeFactories?.length, 1);
  assert.ok(rawExtension.modelRuntimeFactories?.[0] instanceof RawModelRuntimeFactory);
  assert.deepEqual(new RawModelRuntimeFactory().target, { metaModel: RAW_MODEL });
  assert.equal(rawExtension.dataStoreFactories, undefined);
  assert.equal(rawExtension.valueStoreFactories, undefined);
  assert.equal(rawExtension.payloadSerializers, undefined);
});

test("raw exposes a stable, frozen bytes scalar descriptor for the concrete model", async () => {
  const definition: RawModelDefinition = { description: "Opaque artifact bytes" };
  const input = model(definition);
  const runtime = new RawModelRuntime(input);
  assert.deepEqual(runtime.descriptor, {
    id: "tests/artifact.json", root: { kind: "scalar", scalar: "bytes", description: "Opaque artifact bytes" }
  });
  assert.equal(Object.isFrozen(runtime.descriptor), true);
  assert.equal(Object.isFrozen(runtime.descriptor.root), true);
  assert.strictEqual(runtime.reflect(new Uint8Array()).descriptor, runtime.descriptor.root);
  assert.strictEqual(runtime.reflect(Buffer.from([1])).descriptor, runtime.descriptor.root);
  assert.deepEqual((await compile()).descriptor.root, { kind: "scalar", scalar: "bytes" });
  assert.deepEqual((await compile({ description: "" })).descriptor.root, {
    kind: "scalar", scalar: "bytes", description: ""
  });
  assert.deepEqual((await compile(Object.create(null))).descriptor.root, { kind: "scalar", scalar: "bytes" });
  const nullPrototype = Object.assign(Object.create(null), { description: "Null-prototype definition" });
  assert.equal((await compile(nullPrototype)).descriptor.root.description, nullPrototype.description);
  (definition as { description: string }).description = "Changed later";
  assert.equal(runtime.descriptor.root.description, "Opaque artifact bytes");
});

test("raw reflection reads and replaces Uint8Array and Buffer as whole scalar values", async () => {
  const runtime = await compile();
  const initial = Uint8Array.of(0, 128, 255);
  const first = runtime.reflect(initial);
  const second = runtime.reflect(initial);
  assert.equal(first.kind, "scalar");
  if (first.kind !== "scalar") throw new Error("Expected raw bytes scalar");
  assert.strictEqual(first.value, initial);
  for (const name of ["get", "has", "delete", "push", "clear", "length"]) assert.equal(name in first, false);
  assert.equal(Symbol.iterator in first, false);
  for (const name of ["fields", "field", "element", "key"]) assert.equal(name in first.descriptor, false);
  const replacement = Buffer.from([5, 6]);
  first.set(replacement);
  assert.strictEqual(first.value, replacement);
  assert.strictEqual(second.value, initial);
  assert.deepEqual(initial, Uint8Array.of(0, 128, 255));
  const empty = new Uint8Array();
  first.set(empty);
  assert.strictEqual(first.value, empty);
  assert.strictEqual(runtime.reflect(replacement).value, replacement);
});

test("raw reflection refuses coercion and keeps failed writes atomic", async () => {
  const runtime = await compile();
  const original = Uint8Array.of(1, 2, 3);
  const reflected = runtime.reflect(original);
  if (reflected.kind !== "scalar") throw new Error("Expected raw bytes scalar");
  const invalid: unknown[] = [
    undefined, null, "hello", 12, false, 2n, [], [1, 2, 3], {},
    new ArrayBuffer(3), new DataView(new ArrayBuffer(3)), new Uint16Array([1, 2]),
    Object.create(Uint8Array.prototype), new Proxy(new Uint8Array([1, 2, 3]), {}),
    { type: "Buffer", data: [1, 2, 3] }, bytesContent(original), reflected
  ];
  for (const value of invalid) {
    assert.throws(() => runtime.reflect(value), TypeError);
    assert.throws(() => reflected.set(value as Scalar), TypeError);
    assert.strictEqual(reflected.value, original);
    assert.deepEqual(original, Uint8Array.of(1, 2, 3));
  }
});

test("raw accepts only an empty definition or an optional JSON description", async () => {
  const invalid: unknown[] = [
    undefined, null, false, "raw", 1, 2n, [], new Uint8Array(), new Date(),
    () => ({}), Object.create({ description: "inherited" }),
    { type: "bytes" }, { fields: [] }, { contentType: "image/png" }, { description: "ok", unknown: true },
    { description: undefined }, { description: null }, { description: 1 }, { description: {} },
    { [Symbol("unsupported")]: true },
    Object.defineProperty({}, "description", { value: "hidden", enumerable: false }),
    Object.defineProperty({}, "hidden", { value: true, enumerable: false }),
    JSON.parse('{"__proto__":{}}')
  ];
  for (const definition of invalid) {
    await assert.rejects(new RawModelRuntimeFactory().createRuntime({}, {
      ...model(), definition
    }, noDependencies), TypeError);
  }
  let accessorReads = 0;
  for (const name of ["description", "unknown"]) {
    const definition = Object.defineProperty({}, name, {
      enumerable: true, get() { accessorReads += 1; return "do not read"; }
    });
    await assert.rejects(compile(definition), TypeError);
  }
  assert.equal(accessorReads, 0);
  let proxyTraps = 0;
  const proxy = new Proxy({}, {
    getPrototypeOf() { proxyTraps += 1; return Object.prototype; },
    ownKeys() { proxyTraps += 1; return []; }
  });
  await assert.rejects(compile(proxy), TypeError);
  assert.equal(proxyTraps, 0);
});

test("raw factory checks model identity and cancellation without Payload or registry access", async () => {
  const factory = new RawModelRuntimeFactory();
  for (const id of ["", " "]) {
    await assert.rejects(factory.createRuntime({}, model({}, id), noDependencies), TypeError);
  }
  await assert.rejects(factory.createRuntime({}, model({}, "tests/artifact.json", "other/standard"), noDependencies), TypeError);
  const controller = new AbortController();
  const reason = new Error("cancel raw creation");
  controller.abort(reason);
  await assert.rejects(factory.createRuntime({ signal: controller.signal }, model(), noDependencies), error => error === reason);
  const runtime = await factory.createRuntime({}, model(), noDependencies);
  assert.equal(runtime.descriptor.id, "tests/artifact.json");
});

test("DataManager creates and caches distinct raw runtimes for Artifact and Log models", async () => {
  const manager = new DefaultDataManager({
    extensions: new DefaultDataExtensionRegistry([rawExtension]),
    models: [
      { model: model({ description: "Artifacts" }, "Artifact") },
      { model: model({ description: "Logs" }, "Log") }
    ]
  });
  const [artifact, sameArtifact, log] = await Promise.all([
    manager.getRuntime({}, "Artifact"), manager.getRuntime({}, "Artifact"), manager.getRuntime({}, "Log")
  ]);
  assert.strictEqual(artifact, sameArtifact);
  assert.notStrictEqual(artifact, log);
  assert.deepEqual(artifact.descriptor, {
    id: "Artifact", root: { kind: "scalar", scalar: "bytes", description: "Artifacts" }
  });
  assert.deepEqual(log.descriptor, {
    id: "Log", root: { kind: "scalar", scalar: "bytes", description: "Logs" }
  });
  assert.strictEqual(await manager.getRuntime({}, "Log"), log);
});

test("raw models share a Runtime standard while retaining separate Stores and explicit persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-raw-models-"));
  try {
    const manager = new DefaultDataManager({
      extensions: new DefaultDataExtensionRegistry([rawExtension, filesystemDataStoreExtension]),
      models: [{ model: model({}, "Artifact") }, { model: model({}, "Log") }],
      stores: ["Artifact", "Log"].map(id => ({
        id: `${id}-store`, model: id, kind: "DataStore" as const, factory: "memsphere/filesystem",
        config: new Config({ directory: join(directory, id) })
      }))
    });
    const artifactStore = await manager.getStore({}, "Artifact-store");
    const logStore = await manager.getStore({}, "Log-store");
    if (artifactStore.kind !== "DataStore" || logStore.kind !== "DataStore") throw new Error("Expected raw Stores");
    const id = "same.txt";
    for (const [store, text] of [[artifactStore, "artifact"], [logStore, "log"]] as const) {
      await store.create({}, {
        id, model: store.model,
        payload: { contentType: "text/plain", content: bytesContent(new TextEncoder().encode(text)) }
      });
    }
    const stored = await artifactStore.get({}, id);
    assert.equal(stored?.data.model, "Artifact");
    assert.equal((await logStore.get({}, id))?.data.model, "Log");
    const artifact = await manager.getRuntime({}, "Artifact");
    const value = artifact.reflect(await readAll({}, stored!.data.payload.content));
    if (value.kind !== "scalar") throw new Error("Expected raw bytes scalar");
    const replacement = new TextEncoder().encode("changed artifact");
    value.set(replacement);
    assert.equal(await readFile(join(directory, "Artifact", id), "utf8"), "artifact");
    await artifactStore.update({}, {
      id, model: artifactStore.model,
      payload: { contentType: "text/plain", content: bytesContent(value.value as Uint8Array) }
    });
    assert.equal(await readFile(join(directory, "Artifact", id), "utf8"), "changed artifact");
    assert.equal(await readFile(join(directory, "Log", id), "utf8"), "log");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
