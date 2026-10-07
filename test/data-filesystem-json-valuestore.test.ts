import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import type { ModelRuntime } from "../src/data/api/model-runtime.js";
import type { TypeDescriptor } from "../src/data/api/reflection.js";
import type { ValueStore } from "../src/data/api/value-store.js";
import { FILESYSTEM_JSON_METADATA_DIRECTORY, FilesystemJsonValueStoreFactory, filesystemJsonValueStoreExtension } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { JSON_SCHEMA_DRAFT_07, JsonSchemaModelRuntimeFactory } from "../src/data/extensions/json-schema/index.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";
import { withRecordLock } from "../src/data/extensions/shared/filesystem.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";

const MODEL = "example/filesystem-json-value-v1.json";
const STORE_ID = "example/values";

async function makeRuntime(): Promise<ModelRuntime> {
  const definition = {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      count: { type: "integer", minimum: 0 },
      tags: { type: "array", items: { type: "string" } },
      details: { type: "object", properties: { active: { type: "boolean" } }, additionalProperties: false }
    },
    required: ["name", "count"],
    additionalProperties: false
  };
  return new JsonSchemaModelRuntimeFactory().createRuntime({}, {
    data: {
      id: MODEL,
      model: JSON_SCHEMA_DRAFT_07,
      payload: { contentType: "application/json", content: bytesContent(new TextEncoder().encode(JSON.stringify(definition))) }
    },
    definition
  }, { get: () => undefined, register() { throw new Error("unexpected runtime registration"); } });
}

async function withStore(action: (store: ValueStore, directory: string, runtime: ModelRuntime) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-filesystem-json-value-"));
  try {
    const runtime = await makeRuntime();
    const store = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    await action(store, directory, runtime);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("filesystem JSON ValueStore is one independent ValueStore factory", () => {
  assert.equal(filesystemJsonValueStoreExtension.id, "memsphere/filesystem-json-valuestore");
  assert.equal(filesystemJsonValueStoreExtension.version, "0.1.0");
  assert.equal(filesystemJsonValueStoreExtension.valueStoreFactories?.length, 1);
  assert.equal(filesystemJsonValueStoreExtension.valueStoreFactories?.[0].id, "memsphere/filesystem-json");
  assert.equal(new FilesystemJsonValueStoreFactory().id, "memsphere/filesystem-json");
  assert.equal("dataStoreFactories" in filesystemJsonValueStoreExtension, false);
  assert.equal("payloadSerializers" in filesystemJsonValueStoreExtension, false);
});

test("filesystem JSON ValueStore persists raw values, metadata and exact JSON across reopening", async () => {
  await withStore(async (store, directory, runtime) => {
    assert.equal(store.kind, "ValueStore");
    assert.equal(store.id, STORE_ID);
    assert.equal(store.model, MODEL);
    assert.equal("contentStore" in store, false);
    assert.equal(await store.get({}, "item"), undefined);
    assert.equal(await store.has({}, "item"), false);
    const value = { name: "first", count: 0, tags: ["a", "b"], details: { active: false } };
    const created = await store.create({}, "item", value);
    assert.equal(created.id, "item");
    assert.deepEqual(created.value, value);
    assert.notEqual(created.value, value);
    assert.equal(created.revision, 1);
    assert.equal(created.updatedAt, created.createdAt);
    assert.equal("createdBy" in created, false);
    assert.equal("updatedBy" in created, false);
    assert.equal("data" in created, false);
    runtime.reflect(created.value);
    const text = await readFile(join(directory, "item.json"), "utf8");
    assert.equal(text, `${JSON.stringify(created, null, 2)}\n`);
    assert.deepEqual(JSON.parse(text), created);
    assert.equal("model" in JSON.parse(text), false);
    assert.deepEqual(await readdir(directory), [FILESYSTEM_JSON_METADATA_DIRECTORY, "item.json"]);
    assert.equal(await store.has({}, "item"), true);
    await assert.rejects(store.create({}, "item", value), /already exists/);
    await assert.rejects(store.update({}, "missing", value), /does not exist/);
    const replacement = { name: "second", count: 2 };
    const updated = await store.update({}, "item", replacement, { expectedRevision: 1 });
    assert.deepEqual(updated.value, replacement);
    assert.equal(updated.revision, 2);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal("tags" in (updated.value as object), false);
    const reopened = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    assert.deepEqual(await reopened.get({}, "item"), updated);
    assert.deepEqual(created.value, value);
    await assert.rejects(reopened.delete({}, "item", { expectedRevision: 1 }), /revision conflict/);
    assert.equal(await reopened.delete({}, "item", { expectedRevision: 2 }), true);
    assert.equal(await store.get({}, "item"), undefined);
    assert.equal(await store.delete({}, "item"), false);
    await assert.rejects(store.delete({}, "item", { expectedRevision: 2 }), /revision conflict/);
    await assert.rejects(store.update({}, "item", value, { expectedRevision: 2 }), /revision conflict/);
  });
});

test("filesystem JSON ValueStore snapshots before awaiting and never stores caller or returned references", async () => {
  await withStore(async (store) => {
    const value = { name: "original", count: 1, tags: ["before"], details: { active: true } };
    const pending = store.create({}, "snapshot", value);
    value.name = "mutated";
    value.tags.push("after");
    value.details.active = false;
    const created = await pending;
    const expected = { name: "original", count: 1, tags: ["before"], details: { active: true } };
    assert.deepEqual(created.value, expected);
    (created.value as typeof expected).name = "also mutated";
    (created.value as typeof expected).tags.length = 0;
    const read = (await store.get({}, "snapshot"))!;
    assert.deepEqual(read.value, expected);
    (read.value as typeof expected).details.active = false;
    assert.deepEqual((await store.get({}, "snapshot"))!.value, expected);
    const replacement = { name: "update", count: 3 };
    const updating = store.update({}, "snapshot", replacement, { expectedRevision: 1 });
    replacement.name = "changed after invocation";
    assert.deepEqual((await updating).value, { name: "update", count: 3 });
    assert.deepEqual((await store.get({}, "snapshot"))!.value, { name: "update", count: 3 });
  });
});

test("filesystem JSON ValueStore enforces complete runtime validation before writing and during reads", async () => {
  await withStore(async (store, directory) => {
    const value = { name: "valid", count: 1 };
    await store.create({}, "kept", value);
    const invalid = [
      {}, { name: "missing count" }, { name: "", count: 1 }, { name: "negative", count: -1 },
      { name: "fractional", count: 1.5 }, { name: "extra", count: 1, other: true },
      { name: "nested", count: 1, details: { active: "yes" } }, { name: "coercion", count: "2" }
    ];
    for (const candidate of invalid) {
      await assert.rejects(store.update({}, "kept", candidate, { expectedRevision: 1 }));
      await assert.rejects(store.create({}, "rejected", candidate));
      assert.equal(await store.has({}, "rejected"), false);
      assert.deepEqual((await store.get({}, "kept"))!.value, value);
      assert.equal((await store.get({}, "kept"))!.revision, 1);
    }
    await writeFile(join(directory, "bad-runtime-value.json"), JSON.stringify({
      id: "bad-runtime-value", revision: 1, createdAt: 1, updatedAt: 1, value: { name: "bad", count: -1 }
    }));
    await assert.rejects(store.get({}, "bad-runtime-value"), /JSON Schema validation failed/);
    await writeFile(join(directory, "not-json.json"), new Uint8Array([0, 255]));
    await assert.rejects(store.get({}, "not-json"), /encoded data|JSON/);
    await writeFile(join(directory, "malformed-json.json"), "{");
    await assert.rejects(store.get({}, "malformed-json"), SyntaxError);
    assert.equal(await store.has({}, "not-json"), true);
  });
});

test("filesystem JSON ValueStore rejects unsupported JSON values and descriptors without changing records", async () => {
  await withStore(async (_store, directory) => {
    const runtime = createPlainRuntime({ id: "loose-json.json", root: { kind: "object", fields: [], field: () => undefined } });
    const store = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    await store.create({}, "kept", { valid: true });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const invalid = [
      { value: undefined }, { value: 1n }, { value: new Uint8Array([1]) }, { value: new Map() },
      { value: new Date() }, { value: Infinity }, { value: NaN }, { value: -0 },
      { value: Number.MAX_SAFE_INTEGER + 1 }, { value: Symbol("symbol") }, { value() {} },
      { value: [, 1] }, cyclic, { [Symbol("key")]: 1 }, { toJSON: () => ({}) },
      Object.defineProperty({}, "hidden", { value: 1 })
    ];
    for (const candidate of invalid) {
      await assert.rejects(store.update({}, "kept", candidate), /JSON|Sparse/);
      assert.deepEqual((await store.get({}, "kept"))!.value, { valid: true });
      assert.equal((await store.get({}, "kept"))!.revision, 1);
    }
    const descriptors: Array<[TypeDescriptor, unknown]> = [
      [{ kind: "scalar", scalar: "bigint" }, 1n],
      [{ kind: "scalar", scalar: "bytes" }, new Uint8Array([1])],
      [{ kind: "map", key: { kind: "scalar", scalar: "string" }, value: { kind: "scalar", scalar: "number" } }, new Map([["a", 1]])]
    ];
    for (const [index, [root, value]] of descriptors.entries()) {
      const unsupported = await new FilesystemJsonValueStoreFactory().createStore({}, `unsupported-store-${index}`, createPlainRuntime({ id: `unsupported-${index}.json`, root }), new Config({ directory }));
      await assert.rejects(unsupported.create({}, "missing", value), /JSON does not support/);
      assert.equal(await unsupported.has({}, "missing"), false);
    }
    await assert.rejects(store.create({}, "reflection-view", runtime.reflect({})), /reflection views|plain object/);
  });
});

test("filesystem JSON ValueStore rejects a runtime-incompatible round trip before publication", async () => {
  await withStore(async (_store, directory) => {
    const runtime = createPlainRuntime({ id: "null-prototype-only.json", root: { kind: "object", fields: [], field: () => undefined } }, {
      validate(value) {
        if (Object.getPrototypeOf(value) !== null) throw new Error("Only null-prototype values accepted");
      }
    });
    const store = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    const value = Object.assign(Object.create(null) as object, { value: true });
    runtime.reflect(value);
    await assert.rejects(store.create({}, "incompatible", value), /Only null-prototype/);
    assert.equal(await store.has({}, "incompatible"), false);
  });
});

test("filesystem JSON ValueStore shares per-record atomic CAS and pagination across same-realm Store instances", async () => {
  await withStore(async (first, directory, runtime) => {
    const second = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    const creates = await Promise.allSettled([
      first.create({}, "a", { name: "first", count: 1 }),
      second.create({}, "a", { name: "second", count: 2 })
    ]);
    assert.equal(creates.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(creates.filter(({ status }) => status === "rejected").length, 1);
    const updates = await Promise.allSettled([
      first.update({}, "a", { name: "first update", count: 3 }, { expectedRevision: 1 }),
      second.update({}, "a", { name: "second update", count: 4 }, { expectedRevision: 1 })
    ]);
    assert.equal(updates.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(updates.filter(({ status }) => status === "rejected").length, 1);
    assert.equal((await first.get({}, "a"))!.revision, 2);
    for (const id of ["b", "c"]) await first.create({}, id, { name: id, count: 0 });
    const page = await first.list({}, { limit: 2 });
    assert.deepEqual(page.items, [{ id: "a" }, { id: "b" }]);
    assert.ok(page.nextCursor);
    assert.deepEqual(await second.list({}, { cursor: page.nextCursor }), { items: [{ id: "c" }] });
    assert.deepEqual((await readdir(directory)).sort(), [FILESYSTEM_JSON_METADATA_DIRECTORY, "a.json", "b.json", "c.json"]);
    await assert.rejects(first.list({}, { cursor: "bad cursor" }), /Invalid.*list cursor/);
    await assert.rejects(first.list({}, { limit: 0 }), /limit/);
    await assert.rejects(first.update({}, "a", { name: "x", count: 0 }, { expectedRevision: 0 }), /expectedRevision/);
    await assert.rejects(first.delete({}, "a", { expectedRevision: 0 }), /expectedRevision/);
  });
});

test("filesystem JSON ValueStore respects cancellation and portable configuration/ID validation", async () => {
  await withStore(async (store, directory, runtime) => {
    const value = { name: "valid", count: 1 };
    await store.create({}, "kept", value);
    const controller = new AbortController();
    const updating = store.update({ signal: controller.signal }, "kept", { name: "new", count: 2 }, { expectedRevision: 1 });
    controller.abort();
    await assert.rejects(updating, { name: "AbortError" });
    assert.deepEqual((await store.get({}, "kept"))!.value, value);
    assert.equal((await store.get({}, "kept"))!.revision, 1);
    const aborted = { signal: controller.signal };
    await assert.rejects(store.get(aborted, "kept"), { name: "AbortError" });
    await assert.rejects(store.has(aborted, "kept"), { name: "AbortError" });
    await assert.rejects(store.list(aborted), { name: "AbortError" });
    await assert.rejects(store.delete(aborted, "kept"), { name: "AbortError" });
    await assert.rejects(store.create(aborted, "missing", value), { name: "AbortError" });
    await assert.rejects(new FilesystemJsonValueStoreFactory().createStore(aborted, STORE_ID, runtime, new Config({ directory })), { name: "AbortError" });
    await assert.rejects(store.create({}, "", value));
    await assert.rejects(new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({})), /directory/);
    await assert.rejects(new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory, lockTimeoutMs: 0 })), /lockTimeoutMs/);
    await assert.rejects(new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory, contentTypeExtensions: {} })), /contentTypeExtensions/);
    for (const id of ["", " ", undefined as unknown as string]) {
      await assert.rejects(new FilesystemJsonValueStoreFactory().createStore({}, id, runtime, new Config({ directory })), /store id/i);
    }
    for (const id of ["../../../value-outside", "a/b", "a\\b", ".", "..", "CON", "aux.txt", "LPT1", "x:y", "x?y", "x*y", "x|y", "x<y", "x>y", 'x"y', "trailing.", "trailing ", "bad\u0000", "bad\ud800", "e\u0301"]) {
      await assert.rejects(store.create({}, id, value), id);
    }
    for (const id of ["订单 001", "café", "already.json"]) {
      await store.create({}, id, value);
      assert.deepEqual((await store.get({}, id))!.value, value);
      assert.equal(JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")).id, id);
    }
    assert.ok((await readdir(directory)).includes("already.json.json"));
    assert.equal(await store.has({}, "missing"), false);
  });
});

test("filesystem JSON ValueStore identity is logical and pagination does not cross Store IDs", async () => {
  await withStore(async (first, directory, runtime) => {
    const second = await new FilesystemJsonValueStoreFactory().createStore({}, "another/store", runtime, new Config({ directory }));
    assert.equal(second.id, "another/store");
    assert.equal(second.model, first.model);
    for (const id of ["a", "b"]) await first.create({}, id, { name: id, count: 0 });
    assert.equal((await second.get({}, "a"))?.id, "a");
    const page = await first.list({}, { limit: 1 });
    assert.ok(page.nextCursor);
    await assert.rejects(second.list({}, { cursor: page.nextCursor }), /Invalid.*list cursor/);
    assert.deepEqual((await readdir(directory)).sort(), [FILESYSTEM_JSON_METADATA_DIRECTORY, "a.json", "b.json"]);
  });
});

test("filesystem JSON ValueStore snapshots mutable update and delete revision options", async () => {
  await withStore(async (store) => {
    const original = { name: "original", count: 1 };
    await store.create({}, "kept", original);
    await store.update({}, "kept", original, { expectedRevision: 1 });
    const updateOptions: { expectedRevision?: number } = { expectedRevision: 1 };
    const pendingUpdate = store.update({}, "kept", { name: "must not persist", count: 2 }, updateOptions);
    updateOptions.expectedRevision = 2;
    await assert.rejects(pendingUpdate, /revision conflict: expected 1, found 2/);
    for (const changedRevision of [undefined, 2]) {
      const deleteOptions: { expectedRevision?: number } = { expectedRevision: 1 };
      const pendingDelete = store.delete({}, "kept", deleteOptions);
      deleteOptions.expectedRevision = changedRevision;
      await assert.rejects(pendingDelete, /revision conflict: expected 1, found 2/);
    }
    const kept = (await store.get({}, "kept"))!;
    assert.equal(kept.revision, 2);
    assert.deepEqual(kept.value, original);
    const matchingOptions = { expectedRevision: 2 };
    const matchingDelete = store.delete({}, "kept", matchingOptions);
    matchingOptions.expectedRevision = 0;
    assert.equal(await matchingDelete, true);
  });
});

test("filesystem JSON ValueStore rejects malformed metadata and filename/id disagreement", async () => {
  await withStore(async (store, directory) => {
    const record = { id: "edited", revision: 1, createdAt: 1, updatedAt: 1, value: { name: "valid", count: 1 } };
    const path = join(directory, "edited.json");
    const cases: unknown[] = [
      null, [], true, {}, { ...record, id: "different" }, { ...record, model: MODEL },
      { ...record, revision: 0 }, { ...record, revision: 1.5 }, { ...record, revision: "1" },
      { ...record, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...record, createdAt: "now" },
      { ...record, updatedAt: -1 }, { ...record, updatedAt: null },
      { ...record, createdBy: 42 }, { ...record, updatedBy: {} },
      { ...record, unexpected: true }, JSON.parse('{"__proto__":{}}')
    ];
    for (const key of ["id", "revision", "createdAt", "updatedAt", "value"]) {
      const missing = { ...record } as Record<string, unknown>;
      delete missing[key];
      cases.push(missing);
    }
    for (const candidate of cases) {
      const text = JSON.stringify(candidate);
      await writeFile(path, text);
      await assert.rejects(store.get({}, "edited"));
      await assert.rejects(store.update({}, "edited", { name: "replacement", count: 2 }));
      assert.equal(await readFile(path, "utf8"), text);
    }
    await writeFile(path, JSON.stringify({ ...record, revision: Number.MAX_SAFE_INTEGER }));
    await assert.rejects(store.update({}, "edited", { name: "new", count: 2 }), /overflow/);
  });
});

test("filesystem JSON ValueStore preserves creator but does not attribute an update to an earlier updater", async () => {
  await withStore(async (store, directory) => {
    for (const [id, creator] of [["created-by-id", "user-1"], ["created-by-null", null]] as const) {
      const record = {
        id, revision: 5, createdAt: 10, updatedAt: 11,
        createdBy: creator, updatedBy: "previous-user", value: { name: "old", count: 1 }
      };
      await writeFile(join(directory, `${id}.json`), JSON.stringify(record));
      assert.deepEqual(await store.get({}, id), record);
      const updated = await store.update({}, id, { name: "new", count: 2 }, { expectedRevision: 5 });
      assert.equal(updated.revision, 6);
      assert.equal(updated.createdAt, 10);
      assert.equal(updated.createdBy, creator);
      assert.equal("updatedBy" in updated, false);
      assert.deepEqual(JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")), updated);
    }
  });
});

test("filesystem JSON ValueStore preserves dangerous business keys without invoking getters or JSON hooks", async () => {
  await withStore(async (_store, directory) => {
    const runtime = createPlainRuntime({ id: "opaque-fields.json", root: { kind: "object", fields: [], field: () => undefined } });
    const store = await new FilesystemJsonValueStoreFactory().createStore({}, STORE_ID, runtime, new Config({ directory }));
    const value: unknown = JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"toJSON":"ordinary field","nested":{"value":true}}');
    const stored = await store.create({}, "safe", value);
    assert.deepEqual(stored.value, value);
    assert.deepEqual((await store.get({}, "safe"))!.value, value);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    let invoked = false;
    const getter = Object.defineProperty({}, "danger", { enumerable: true, get() { invoked = true; return true; } });
    const hook = { toJSON() { invoked = true; return {}; } };
    for (const invalid of [getter, hook]) await assert.rejects(store.update({}, "safe", invalid));
    assert.equal(invoked, false);
    for (const literal of ["-0", "9007199254740992", "1e999"]) {
      await writeFile(join(directory, "invalid-number.json"), `{"id":"invalid-number","revision":1,"createdAt":1,"updatedAt":1,"value":{"number":${literal}}}`);
      await assert.rejects(store.get({}, "invalid-number"), /JSON.*(zero|integers|finite)/);
    }
  });
});

test("filesystem JSON ValueStore uses filename-only lists and portable case collision checks", async () => {
  await withStore(async (store, directory) => {
    await writeFile(join(directory, "invalid-content.json"), "not JSON");
    await writeFile(join(directory, "notes.txt"), "not a ValueStore record");
    assert.deepEqual(await store.list({}), { items: [{ id: "invalid-content" }] });
    await assert.rejects(store.get({}, "invalid-content"), SyntaxError);
    await store.create({}, "Order", { name: "upper", count: 1 });
    await assert.rejects(store.create({}, "order", { name: "lower", count: 1 }), /case|collision|alias/i);
    await assert.rejects(store.get({}, "ORDER"), /case|collision|alias/i);
  });
});

test("filesystem JSON ValueStore lock is only per record and a canceled waiter never publishes", async () => {
  await withStore(async (store, directory) => {
    const value = { name: "original", count: 1 };
    await store.create({}, "busy", value);
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const held = withRecordLock({}, directory, "busy.json", async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await enteredPromise;
    const controller = new AbortController();
    const waiting = store.update({ signal: controller.signal }, "busy", { name: "canceled", count: 2 }, { expectedRevision: 1 });
    const rejected = assert.rejects(waiting, { name: "AbortError" });
    try {
      const independent = await store.create({}, "independent", value);
      assert.equal(independent.revision, 1);
      controller.abort();
      await rejected;
      assert.deepEqual((await readdir(directory)).sort(), [FILESYSTEM_JSON_METADATA_DIRECTORY, "busy.json", "independent.json"]);
      assert.deepEqual((await store.get({}, "busy"))!.value, value);
    } finally {
      controller.abort();
      release();
      await held;
      await rejected;
    }
    assert.equal((await store.update({}, "busy", { name: "next", count: 3 }, { expectedRevision: 1 })).revision, 2);
  });
});

test("atomic upsert replaces complete records and preserves deletion revision history", async () => {
  await withStore(async (store) => {
    assert(store.upsert);
    const first = await store.upsert({}, "upsert", { name: "first", count: 1, tags: ["old"] });
    const second = await store.upsert({}, "upsert", { name: "second", count: 2 });
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.revision, 2);
    assert.deepEqual((await store.get({}, "upsert"))?.value, { name: "second", count: 2 });
    await store.delete({}, "upsert");
    assert.equal((await store.upsert({}, "upsert", { name: "reborn", count: 0 })).revision, 3);
    await assert.rejects(store.upsert({}, "upsert", { name: "invalid", count: -1 }));
    assert.equal((await store.get({}, "upsert"))?.revision, 3);
  });
});

test("concurrent upserts of a missing ID create one record with every revision retained", async () => {
  await withStore(async (store) => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, count) => store.upsert!({}, "shared", { name: "concurrent", count })));
    assert.deepEqual(results.map(result => result.revision).sort((a, b) => a! - b!), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal((await store.get({}, "shared"))?.revision, 8);
    assert.deepEqual(await store.list({}), { items: [{ id: "shared" }] });
  });
});
