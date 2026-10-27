import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { upgradeContextControlOutputs } from "../src/project/context-control-upgrade.js";
import { withProjectModelWrite } from "../src/project/model-operation.js";

test("adding archive metadata upgrades the known Run definition without rewriting Run records", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!, run = await s.start("保留版本");
  const schemaPath = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json");
  const old = JSON.parse(await readFile(new URL("./fixtures/context-control-run-before-graph.json", import.meta.url), "utf8")); delete old.properties.archived;
  await writeFile(schemaPath, JSON.stringify(old));
  const before = await s.stores.run.get({}, run.id);
  assert.equal((await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, run.id), before);
  await reopened.finish(run.id); assert.ok((await reopened.archive(run.id)).archived);
});

async function oldFixture(t: test.TestContext) {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const running = await s.start("running"), done = await s.start("done"), abandoned = await s.start("abandoned");
  const a = (await s.report(running.id, { name: "A", content: textContent("A") })).artifact;
  const b = (await s.report(running.id, { name: "B", content: textContent("B"), dependencies: [{ kind: "artifact", id: a.id }] })).artifact;
  const d = (await s.report(done.id, { name: "D", content: textContent("D") })).artifact; await s.finish(done.id, [d.id]); await s.abandon(abandoned.id);
  for (const run of [running, done, abandoned]) {
    const path = join(f.root, "data/context_control/runs", `${run.id}.json`); const row = JSON.parse(await readFile(path, "utf8"));
    row.value.finalArtifactIds = run.id === done.id ? [d.id] : []; delete row.value.outputOverrides; await writeFile(path, JSON.stringify(row, null, 2));
  }
  const oldSchema = await readFile(new URL("./fixtures/context-control-run-before-outputs.json", import.meta.url), "utf8");
  const schema = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json"); await writeFile(schema, oldSchema);
  return { ...f, running, done, abandoned, a, b, d, schema, oldSchema };
}

test("explicit upgrade preserves terminal roots and metadata, seeds running leaves once, and does not resurrect empty outputs", async t => {
  const f = await oldFixture(t);
  await assert.rejects(openContextControl(f.root), { code: "MODEL_INCOMPATIBLE" });
  const path = join(f.root, "data/context_control/runs", `${f.running.id}.json`); const before = JSON.parse(await readFile(path, "utf8"));
  const result = await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(result?.records, 3);
  const s = (await openContextControl(f.root))!; assert.deepEqual(await s.outputs(f.running.id), [f.b.id]); assert.deepEqual(await s.outputs(f.done.id), [f.d.id]); assert.deepEqual(await s.outputs(f.abandoned.id), []);
  const after = JSON.parse(await readFile(path, "utf8")); assert.equal(after.createdAt, before.createdAt); assert.equal(after.revision, before.revision + 1); assert.equal(after.value.finalArtifactIds, undefined);
  await s.updateOutputs(f.running.id, [], [f.b.id]);
  const again = await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(again?.changed, false); assert.deepEqual(await s.outputs(f.running.id), []);
});

test("interrupted model/data publication rolls back and the same explicit upgrade can redo", async t => {
  const f = await oldFixture(t); const path = join(f.root, "data/context_control/runs", `${f.running.id}.json`); const before = await readFile(path, "utf8");
  await assert.rejects(withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => { if (index === 1) throw Error("migration interruption"); } })), /migration interruption/);
  assert.equal(await readFile(f.schema, "utf8"), f.oldSchema); assert.equal(await readFile(path, "utf8"), before);
  await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root));
  const s = (await openContextControl(f.root))!; assert.deepEqual(await s.outputs(f.running.id), [f.b.id]);
});

async function storedFixture(t: test.TestContext) {
  const f = await oldFixture(t);
  const schema = await readFile(new URL("./fixtures/context-control-run-stored-outputs.json", import.meta.url), "utf8");
  await writeFile(f.schema, schema);
  for (const run of [f.running, f.done, f.abandoned]) {
    const path = join(f.root, "data/context_control/runs", `${run.id}.json`), row = JSON.parse(await readFile(path, "utf8"));
    row.value.outputArtifactIds = run.id === f.running.id ? [f.a.id] : run.id === f.done.id ? [] : row.value.finalArtifactIds;
    delete row.value.finalArtifactIds; await writeFile(path, JSON.stringify(row, null, 2));
  }
  return f;
}

test("stored-output upgrade preserves manual older roots and empty terminal choices as differences only", async t => {
  const f = await storedFixture(t);
  await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root));
  const s = (await openContextControl(f.root))!;
  assert.deepEqual(await s.outputs(f.running.id), [f.a.id]); assert.deepEqual(await s.outputs(f.done.id), []);
  assert.deepEqual((await s.findRun(f.running.id))!.outputOverrides, { addedArtifactIds: [f.a.id], removedArtifactIds: [f.b.id] });
  const before = await s.stores.run.get({}, f.running.id);
  const c = (await s.report(f.running.id, { name: "C", content: textContent("C") })).artifact;
  assert.deepEqual(new Set(await s.outputs(f.running.id)), new Set([f.a.id, c.id]));
  assert.deepEqual(await s.stores.run.get({}, f.running.id), before);
  assert.equal((await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)))?.changed, false);
});

test("model upgrade holds the same access gate as report and generic data writes", async t => {
  const f = await storedFixture(t);
  const { withContextControlAccess } = await import("../src/project/context-control-access.js");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  let entered!: () => void, release!: () => void;
  const published = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const upgrade = withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => {
    if (index === 0) { order.push("upgrading"); entered(); await resume; }
  } }));
  await published;
  const production = (async () => { const s = (await openContextControl(f.root))!; order.push("report"); return s.report(f.running.id, { name: "concurrent", content: textContent("C") }); })();
  const direct = withContextControlAccess(f.root, async () => {
    order.push("data"); const { store } = await openBusinessStore({}, f.root, "context_control/runs");
    if (store.kind !== "ValueStore") throw Error("wrong Store");
    const row = (await store.get({}, f.abandoned.id))!;
    return store.update({}, f.abandoned.id, { ...(row.value as object), name: "updated via data" }, { expectedRevision: row.revision! });
  });
  // No time-based sleeps: the publication hook controls the blocked lock boundary.
  assert.deepEqual(order, ["upgrading"]); release();
  await Promise.all([upgrade, production, direct]);
  assert.equal(order[0], "upgrading");
  assert.equal((await (await openContextControl(f.root))!.snapshot(f.running.id)).completeIds.length, 3);
});


test("upgrading an interrupted stored-output report completes its original roots before deriving differences", async t => {
  const f = await storedFixture(t);
  // The old report saved B but failed before replacing A in the Run-root record.
  const path = join(f.root, "data/context_control/steps", f.running.id, `${f.b.stepId}.json`);
  const step = JSON.parse(await readFile(path, "utf8")); step.value.status = "running"; delete step.value.endedAt;
  await writeFile(path, JSON.stringify(step, null, 2));
  await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root));
  const service = (await openContextControl(f.root))!;
  assert.deepEqual(await service.outputs(f.running.id), [f.b.id]);
  assert.equal((await service.findRun(f.running.id))!.outputOverrides, undefined);
});

test("known archivedAt candidate converts only archived rows and preserves untouched revisions", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const active = await s.start("active"), ended = await s.start("archived"); await s.finish(ended.id);
  const path = join(f.root, "data/context_control/runs", `${ended.id}.json`);
  const row = JSON.parse(await readFile(path, "utf8")); row.value.archivedAt = "2026-10-25T00:00:00.000Z";
  await writeFile(path, JSON.stringify(row));
  const activeBefore = await s.stores.run.get({}, active.id);
  const schema = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json");
  const oldSchema = await readFile(new URL("./fixtures/context-control-run-archived-at.json", import.meta.url), "utf8"); await writeFile(schema, oldSchema);
  await assert.rejects(withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => { if (index === 1) throw Error("interrupted candidate conversion"); } })), /interrupted/);
  assert.equal(await readFile(schema, "utf8"), oldSchema);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), row);
  const result = await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(result?.records, 1);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, active.id), activeBefore);
  const migrated = await reopened.stores.run.get({}, ended.id);
  assert.equal(migrated!.value.archived, true); assert.equal(migrated!.value.archivedAt, undefined);
  assert.equal(migrated!.revision, row.revision + 1); assert.equal(migrated!.createdAt, row.createdAt);
  assert.equal((await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)))?.changed, false);
});

test("graph model upgrade preserves existing records and revisions", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("existing exploration");
  const report = await service.report(run.id, { name: "Existing artifact", content: textContent("keep me") });
  const beforeRun = await service.stores.run.get({}, run.id);
  const beforeStep = await service.stores.step.get({}, `${run.id}/${report.step.id}`);
  for (const entity of ["run", "step"]) await writeFile(join(f.root, `models/json-schema/draft-07/memsphere/context_control/${entity}.json`), await readFile(new URL(`./fixtures/context-control-${entity}-before-graph.json`, import.meta.url), "utf8"));
  assert.equal((await withProjectModelWrite(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, run.id), beforeRun);
  assert.deepEqual(await reopened.stores.step.get({}, `${run.id}/${report.step.id}`), beforeStep);
  assert.deepEqual(await reopened.outputs(run.id), [report.artifact.id]);
});
