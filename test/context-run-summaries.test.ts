import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { createContextRunReader } from "../src/project/context-run-summaries.js";
import { contextRunSummary } from "../src/context_control/view.js";
import { textContent } from "../src/context_control/types.js";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { createBusinessStore, removeBusinessStore } from "../src/project/business-stores.js";
import { mutateModel } from "../src/project/model-service.js";

test("list summaries read only Run records, include all pages and reuse unchanged summary records while detecting updates", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const a = await service.start("first"), b = await service.start("second");
  await service.report(a.id, { name: "result", content: textContent("body") });
  const before = await service.stores.run.get({}, a.id);
  const opened: string[] = [], reads: string[] = [];
  const original = FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function(this: FilesystemJsonValueStoreFactory, ...args: Parameters<typeof original>) {
    if (!args[1].startsWith("context_control/")) return original.apply(this, args);
    opened.push(args[1]);
    assert.equal(args[1], "context_control/runs", "basic lists must not open child Stores");
    const store = await original.apply(this, args);
    return new Proxy(store, { get(target, property, receiver) {
      if (property === "list") return (context: any, options: any) => target.list(context, { ...options, limit: 1 });
      if (property === "get") return (context: any, id: string) => { reads.push(id); return target.get(context, id); };
      if (["create", "update", "upsert", "delete"].includes(String(property))) return () => { throw Error("Unexpected summary write"); };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const read = createContextRunReader(f.root);
  assert.deepEqual(new Set((await read()).map(r => r.id)), new Set([a.id, b.id]));
  assert.deepEqual(opened, ["context_control/runs"]);
  const firstReads=reads.length;await read();assert.equal(reads.length,firstReads,"unchanged records must not be reread");
  const row = (await service.stores.run.get({}, b.id))!;
  await service.stores.run.update({}, b.id, { ...b, name: "renamed", status: "done", endedAt: new Date().toISOString() }, { expectedRevision: row.revision });
  const next = await read();
  assert.equal(next.find(r => r.id === b.id)!.name, "renamed");
  assert.equal(next.find(r => r.id === b.id)!.status, "done");
  assert.equal(opened.length, 1);
  assert.deepEqual(await service.stores.run.get({}, a.id), before);
  assert.ok(reads.every(id => id === a.id || id === b.id));
  const summary = contextRunSummary(next.find(r => r.id === a.id)!);
  for (const field of ["context", "contextRevision", "eventCount", "outputArtifactIds"]) assert.equal(Object.hasOwn(summary, field), false);
});

test("child corruption does not block the Run list or trigger production recovery", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("damaged child");
  const artifact = (await service.report(run.id, { name: "result", content: textContent("body") })).artifact;
  const path = join(f.root, "data/context_control/artifacts", run.id, `${artifact.id}.json`);
  await writeFile(path, "not JSON");
  const before = await service.stores.run.get({}, run.id);
  assert.equal((await createContextRunReader(f.root)())[0].id, run.id);
  assert.equal(await readFile(path, "utf8"), "not JSON");
  assert.deepEqual(await service.stores.run.get({}, run.id), before);
  await assert.rejects(service.snapshot(run.id));
});

test("View can isolate a corrupt Run using only the Run Store while configuration errors remain fatal", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const healthy = await service.start("healthy"), other = await service.start("other"), broken = await service.start("broken");
  const before = await service.stores.run.get({}, healthy.id);
  await writeFile(join(f.root, "data/context_control/runs", `${broken.id}.json`), "broken JSON");
  const original = FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function(this: FilesystemJsonValueStoreFactory, ...args: Parameters<typeof original>) {
    if (args[1].startsWith("context_control/")) assert.equal(args[1], "context_control/runs");
    return original.apply(this, args);
  });
  const read = createContextRunReader(f.root, { isolateCorruptRecords: true }), rows = await read();
  assert.equal(rows.find(r => r.id === healthy.id)!.name, "healthy");
  assert.equal(rows.find(r => r.id === other.id)!.name, "other");
  const unavailable = rows.find(r => r.id === broken.id)!;
  assert.equal(unavailable.unavailable, true); assert.ok(unavailable.error);
  assert.equal(contextRunSummary(unavailable).readOnly, true);
  assert.deepEqual(await service.stores.run.get({}, healthy.id), before);
  await removeBusinessStore({}, f.root, "context_control/runs");
  await assert.rejects(read(), { code: "INITIALIZATION_INCOMPLETE" });
});

test("cached Run resources follow binding removal and replacement without a model-operation stamp change", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const old = await service.start("old location"), read = createContextRunReader(f.root);
  assert.equal((await read())[0].id, old.id);
  await removeBusinessStore({}, f.root, "context_control/runs");
  await assert.rejects(read(), { code: "INITIALIZATION_INCOMPLETE" });
  await createBusinessStore({}, f.root, "context_control/runs", { kind: "value", factory: "memsphere/filesystem-json", model: "memsphere/context_control/run.json", config: { directory: "data/rebound-runs" } });
  assert.deepEqual(await read(), []);
  const fresh = (await openContextControl(f.root))!;
  const current = await fresh.start("new location");
  assert.deepEqual((await read()).map(r => r.id), [current.id]);
});

test("cached Run resources reject an incompatible model and recover after a controlled repair", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("model revision"), read = createContextRunReader(f.root);
  await read();
  const source = await readFile(join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json"), "utf8");
  const changed = JSON.parse(source); changed.description = "incompatible definition";
  await removeBusinessStore({}, f.root, "context_control/runs");
  await mutateModel({}, f.root, "update", "memsphere/context_control/run.json", { source: JSON.stringify(changed) });
  const binding = { kind: "value", factory: "memsphere/filesystem-json", model: "memsphere/context_control/run.json", config: { directory: "data/context_control/runs" } };
  await createBusinessStore({}, f.root, "context_control/runs", binding);
  await assert.rejects(read(), { code: "MODEL_INCOMPATIBLE" });
  await removeBusinessStore({}, f.root, "context_control/runs");
  await mutateModel({}, f.root, "update", "memsphere/context_control/run.json", { source });
  await createBusinessStore({}, f.root, "context_control/runs", binding);
  assert.equal((await read())[0].id, run.id);
});

for (const broken of ["identity", "invalid-status", "running-archived"] as const) {
  test(`a ${broken} Run record cannot be listed as valid`, async t => {
    const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!, run = await service.start("invalid");
    const path = join(f.root, "data/context_control/runs", `${run.id}.json`);
    const row = JSON.parse(await readFile(path, "utf8"));
    if (broken === "identity") row.value.id = "other";
    if (broken === "invalid-status") row.value.status = "unknown";
    if (broken === "running-archived") row.value.archived = true;
    await writeFile(path, JSON.stringify(row));
    await assert.rejects(createContextRunReader(f.root));
  });
}
