import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Config } from "../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { filesystemWorker } from "./helpers/filesystem-process.js";

test("full hierarchical keys coordinate CAS across processes without locking equal leaf names in other Runs", { timeout: 15000 }, async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-hierarchy-process-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
  const store = await new FilesystemJsonValueStoreFactory().openExisting({}, "records", runtime, new Config({ directory }));
  await store.create({}, "run-a/item", { value: "old" }); await store.create({}, "run-b/item", { value: "independent" });
  const first = await filesystemWorker(t, directory, { operation: "update", id: "run-a/item", expectedRevision: 1, pause: "before-publish", value: { value: "first" } });
  first.send("start"); await first.next("paused");
  const stale = await filesystemWorker(t, directory, { operation: "update", id: "run-a/item", expectedRevision: 1, value: { value: "stale" } });
  stale.send("start"); await stale.next("waiting");
  const independent = await filesystemWorker(t, directory, { operation: "update", id: "run-b/item", expectedRevision: 1, value: { value: "other" } });
  independent.send("start"); assert.equal((await independent.next("result")).ok, true);
  first.send("continue"); assert.equal((await first.next("result")).ok, true);
  assert.equal((await stale.next("result")).code, "REVISION_CONFLICT");
  assert.deepEqual((await store.get({}, "run-a/item"))!.value, { value: "first" });
});

for (const [parent, alias] of [["Run", "run"], ["Σ", "σ"]]) {
  test(`concurrent processes arbitrate alias parents ${parent}/${alias} before mkdir`, { timeout: 15000 }, async t => {
    const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-parent-alias-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
    const store = await new FilesystemJsonValueStoreFactory().openExisting({}, "records", runtime, new Config({ directory }));
    const first = await filesystemWorker(t, directory, { operation: "create", id: `${parent}/x`, pause: "before-parent-mkdir" });
    first.send("start"); await first.next("paused");
    const second = await filesystemWorker(t, directory, { operation: "create", id: `${alias}/y` });
    second.send("start"); await second.next("waiting");
    first.send("continue"); assert.equal((await first.next("result")).ok, true);
    const rejected = await second.next("result"); assert.equal(rejected.ok, false); assert.match(rejected.message!, /alias/i);
    assert.deepEqual((await fs.readdir(directory)).filter(name => !name.startsWith(".memsphere-")), [parent]);
    assert.deepEqual((await store.list({})).items.map(x => x.id), [`${parent}/x`]);
    assert.ok(await store.get({}, `${parent}/x`));
    await store.create({}, `${parent}/next`, { value: "still writable" });
  });
}

test("concurrent Store instances reject parent aliases without poisoning later reads or writes", async t => {
  for (const [parent, alias] of [["Run", "run"], ["Σ", "σ"]]) {
    const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-parent-inprocess-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
    const factory = new FilesystemJsonValueStoreFactory();
    const a = await factory.openExisting({}, "records", runtime, new Config({ directory }));
    const b = await factory.openExisting({}, "records", runtime, new Config({ directory }));
    const ids = [`${parent}/x`, `${alias}/y`];
    const results = await Promise.allSettled([a.create({}, ids[0], {}), b.create({}, ids[1], {})]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
    const winner = ids[results.findIndex(x => x.status === "fulfilled")];
    assert.deepEqual((await a.list({})).items.map(x => x.id), [winner]);
    assert.ok(await b.get({}, winner));
    await b.create({}, `${winner.split("/")[0]}/next`, {});
  }
});

test("a failed first publication removes only its newly created empty parent directories", async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-parent-cleanup-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
  const store = await new FilesystemJsonValueStoreFactory().openExisting({}, "records", runtime, new Config({ directory }));
  const link = fs.link.bind(fs);
  fs.link = async (source, destination) => { if (String(destination) === join(directory, "Run/nested/x.json")) throw Error("injected publication failure"); return link(source, destination); };
  try { await assert.rejects(store.create({}, "Run/nested/x", {}), /publication failure/); } finally { fs.link = link; }
  assert.deepEqual((await fs.readdir(directory)).filter(name => !name.startsWith(".memsphere-")), []);
  assert.deepEqual((await store.list({})).items, []);
  await store.create({}, "run/next", {});
  assert.ok(await store.get({}, "run/next"));
});
