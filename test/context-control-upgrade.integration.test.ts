// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture, publishFixtureDefinition } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { upgradeContextControlOutputs } from "../src/project/context-control-upgrade.js";
import { withModelMaintenance } from "../src/project/model-operation.js";

test("adding archive metadata upgrades the known Run definition without rewriting Run records", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!, run = await s.start("保留版本");
  const schemaPath = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json");
  const old = JSON.parse(await readFile(new URL("./fixtures/context-control-run-before-graph.json", import.meta.url), "utf8")); delete old.properties.archived;
  await publishFixtureDefinition(f.root, "memsphere/context_control/run.json", JSON.stringify(old));
  const before = await s.stores.run.get({}, run.id);
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
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
  const schema = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json"); await publishFixtureDefinition(f.root, "memsphere/context_control/run.json", oldSchema);
  return { ...f, running, done, abandoned, a, b, d, schema, oldSchema };
}

test("explicit upgrade preserves terminal roots and metadata, seeds running leaves once, and does not resurrect empty outputs", async t => {
  const f = await oldFixture(t);
  await assert.rejects(openContextControl(f.root), { code: "MODEL_INCOMPATIBLE" });
  const path = join(f.root, "data/context_control/runs", `${f.running.id}.json`); const before = JSON.parse(await readFile(path, "utf8"));
  const result = await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(result?.records, 3);
  const s = (await openContextControl(f.root))!; assert.deepEqual(await s.outputs(f.running.id), [f.b.id]); assert.deepEqual(await s.outputs(f.done.id), [f.d.id]); assert.deepEqual(await s.outputs(f.abandoned.id), []);
  const after = JSON.parse(await readFile(path, "utf8")); assert.equal(after.createdAt, before.createdAt); assert.equal(after.revision, before.revision + 1); assert.equal(after.value.finalArtifactIds, undefined);
  await s.updateOutputs(f.running.id, [], [f.b.id]);
  const again = await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(again?.changed, false); assert.deepEqual(await s.outputs(f.running.id), []);
});

test("interrupted model/data publication rolls back and the same explicit upgrade can redo", async t => {
  const f = await oldFixture(t); const path = join(f.root, "data/context_control/runs", `${f.running.id}.json`); const before = await readFile(path, "utf8");
  await assert.rejects(withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => { if (index === 1) throw Error("migration interruption"); } })), /migration interruption/);
  assert.equal(await readFile(f.schema, "utf8"), f.oldSchema); assert.equal(await readFile(path, "utf8"), before);
  await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root));
  const s = (await openContextControl(f.root))!; assert.deepEqual(await s.outputs(f.running.id), [f.b.id]);
});

async function storedFixture(t: test.TestContext) {
  const f = await oldFixture(t);
  const schema = await readFile(new URL("./fixtures/context-control-run-stored-outputs.json", import.meta.url), "utf8");
  await publishFixtureDefinition(f.root, "memsphere/context_control/run.json", schema);
  for (const run of [f.running, f.done, f.abandoned]) {
    const path = join(f.root, "data/context_control/runs", `${run.id}.json`), row = JSON.parse(await readFile(path, "utf8"));
    row.value.outputArtifactIds = run.id === f.running.id ? [f.a.id] : run.id === f.done.id ? [] : row.value.finalArtifactIds;
    delete row.value.finalArtifactIds; await writeFile(path, JSON.stringify(row, null, 2));
  }
  return f;
}

test("stored-output upgrade preserves manual older roots and empty terminal choices as differences only", async t => {
  const f = await storedFixture(t);
  await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root));
  const s = (await openContextControl(f.root))!;
  assert.deepEqual(await s.outputs(f.running.id), [f.a.id]); assert.deepEqual(await s.outputs(f.done.id), []);
  assert.deepEqual((await s.findRun(f.running.id))!.outputOverrides, { addedArtifactIds: [f.a.id], removedArtifactIds: [f.b.id] });
  const before = await s.stores.run.get({}, f.running.id);
  const c = (await s.report(f.running.id, { name: "C", content: textContent("C") })).artifact;
  assert.deepEqual(new Set(await s.outputs(f.running.id)), new Set([f.a.id, c.id]));
  assert.deepEqual(await s.stores.run.get({}, f.running.id), before);
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.changed, false);
});

test("pending model publication rejects ordinary access until the explicit upgrade completes", async t => {
  const f = await storedFixture(t);
  const { withContextControlAccess } = await import("../src/project/context-control-access.js");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  let entered!: () => void, release!: () => void;
  const published = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const upgrade = withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => {
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
  // Publication is not a Project mutex: access fails explicitly on the pending stamp.
  try {
    await Promise.all([
      assert.rejects(production, { code: "MODEL_OPERATION_PENDING" }),
      assert.rejects(direct, { code: "MODEL_OPERATION_PENDING" })
    ]);
    assert.deepEqual(order, ["upgrading"]);
  } finally { release(); await upgrade; }
  await (await openContextControl(f.root))!.report(f.running.id, { name: "after upgrade", content: textContent("C") });
  assert.equal(order[0], "upgrading");
  assert.equal((await (await openContextControl(f.root))!.snapshot(f.running.id)).completeIds.length, 3);
});


test("upgrading an interrupted stored-output report completes its original roots before deriving differences", async t => {
  const f = await storedFixture(t);
  // The old report saved B but failed before replacing A in the Run-root record.
  const path = join(f.root, "data/context_control/steps", f.running.id, `${f.b.stepId}.json`);
  const step = JSON.parse(await readFile(path, "utf8")); step.value.status = "running"; delete step.value.endedAt;
  await writeFile(path, JSON.stringify(step, null, 2));
  await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root));
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
  const oldSchema = await readFile(new URL("./fixtures/context-control-run-archived-at.json", import.meta.url), "utf8"); await publishFixtureDefinition(f.root, "memsphere/context_control/run.json", oldSchema);
  await assert.rejects(withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root, { afterFile: async index => { if (index === 1) throw Error("interrupted candidate conversion"); } })), /interrupted/);
  assert.equal(await readFile(schema, "utf8"), oldSchema);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), row);
  const result = await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)); assert.equal(result?.records, 1);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, active.id), activeBefore);
  const migrated = await reopened.stores.run.get({}, ended.id);
  assert.equal(migrated!.value.archived, true); assert.equal(migrated!.value.archivedAt, undefined);
  assert.equal(migrated!.revision, String(row.revision + 1)); assert.equal(migrated!.createdAt, row.createdAt);
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.changed, false);
});

test("graph model upgrade preserves existing records and revisions", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("existing exploration");
  const report = await service.report(run.id, { name: "Existing artifact", content: textContent("keep me") });
  const beforeRun = await service.stores.run.get({}, run.id);
  const beforeStep = await service.stores.step.get({}, `${run.id}/${report.step.id}`);
  for (const entity of ["run", "step"]) await publishFixtureDefinition(f.root, `memsphere/context_control/${entity}.json`, await readFile(new URL(`./fixtures/context-control-${entity}-before-graph.json`, import.meta.url), "utf8"));
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, run.id), beforeRun);
  assert.deepEqual(await reopened.stores.step.get({}, `${run.id}/${report.step.id}`), beforeStep);
  assert.deepEqual(await reopened.outputs(run.id), [report.artifact.id]);
});


test("making idle timeout optional upgrades the known definition without rewriting Runs", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const run = await s.start("idle timeout migration");
  const path = join(f.root, "models/json-schema/draft-07/memsphere/context_control/run.json");
  const old = JSON.parse(await readFile(new URL("./fixtures/context-control-run-before-rewind.json", import.meta.url), "utf8"));
  const agent = old.definitions.PermissionConfig.properties.actors.additionalProperties.properties.agent;
  agent.required.push("idleTimeoutMs");
  agent.properties.idleTimeoutMs.description = "空闲超时的毫秒数。";
  await publishFixtureDefinition(f.root, "memsphere/context_control/run.json", JSON.stringify(old));
  const before = await s.stores.run.get({}, run.id);
  const result = await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root));
  assert.equal(result?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, run.id), before);
});

for (const [entity, version] of [["run", "before-rewind"], ["review", "before-rewind"], ["run", "before-job"]] as const) test(`rewind upgrade preserves ${entity} ${version} records and revisions`, async t => {
 const f = await businessFixture(t, {}), s = (await openContextControl(f.root,true))!;
 const run = await s.start("prior rewind model");
 const artifact=(await s.report(run.id,{name:"old",content:textContent("before rewind")})).artifact;
 const review={id:"historical-review",artifactId:artifact.id,reviewer:{role:"reviewer",source:"human"},status:"submitted",createdAt:new Date().toISOString(),comments:[{id:"historical-comment",body:"preserve this comment",createdAt:new Date().toISOString()}]};
 await s.stores.review.create({},`${run.id}/${review.id}`,review);
 const before = await s.stores.run.get({},run.id), beforeReview=await s.stores.review.get({},`${run.id}/${review.id}`);
 await publishFixtureDefinition(f.root,`memsphere/context_control/${entity}.json`, await readFile(new URL(`./fixtures/context-control-${entity}-${version}.json`,import.meta.url),"utf8"));
 await assert.rejects(openContextControl(f.root),{code:"MODEL_INCOMPATIBLE"});
 assert.equal((await withModelMaintenance(f.root,()=>upgradeContextControlOutputs(f.root)))?.records,0);
 const reopened=(await openContextControl(f.root))!;
 assert.deepEqual(await reopened.stores.run.get({},run.id),before);
 assert.deepEqual(await reopened.stores.review.get({},`${run.id}/${review.id}`),beforeReview);
});

for (const fixtureName of ["context-control-review-before-job.json", "context-control-review-before-members.json", "context-control-review-before-nodes.json", "context-control-review-master-release.json", "context-control-review-rewind-release.json"]) test(`known Review upgrade from ${fixtureName} preserves historical Comment IDs and revisions`, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("historical review"), artifact = (await service.report(run.id, { name: "A", content: textContent("A") })).artifact;
  const id = "review-history", key = `${run.id}/${id}`;
  await service.stores.review.create({}, key, { id, roundId: "historical-round", artifactId: artifact.id, reviewer: { role: "runner" }, status: "submitted", createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), comments: [{ id: "comment-original", body: "Keep history", createdAt: new Date().toISOString(), severity: "suggestion" }], vote: { value: "approve" } });
  const before = await service.stores.review.get({}, key), path = join(f.root, "data/context_control/reviews", run.id, `${id}.json`), bytes = await readFile(path, "utf8");
  await publishFixtureDefinition(f.root, "memsphere/context_control/review.json", await readFile(new URL(`./fixtures/${fixtureName}`, import.meta.url), "utf8"));
  await assert.rejects(openContextControl(f.root), { code: "MODEL_INCOMPATIBLE" });
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.review.get({}, key), before);
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.changed, false);
});


for(const entity of ["run","review"] as const)test(`Tracked Job name upgrade preserves ${entity} records from the preceding enrolled-Job schema`,async t=>{
 const f=await businessFixture(t,{}),service=(await openContextControl(f.root,true))!,run=await service.start("enrolled job model");
 const before=await service.stores.run.get({},run.id),path=join(f.root,"data/context_control/runs",`${run.id}.json`),bytes=await readFile(path,"utf8");
 const model=JSON.parse(await readFile(new URL(`../reserved-models/context-control/${entity}.json`,import.meta.url),"utf8"));
 // Reconstruct the enrolled-Job release, which predates Schema contracts.
 if(entity==="run")delete model.properties.schemaContracts;
 if(entity==="review")delete model.definitions.ReviewNode.properties.requiresReport;
 const restore=(v:any)=>{if(v&&typeof v==="object"){if(typeof v.pattern==="string"&&v.pattern.includes("Reviewer"))v.pattern="^(Global|Local)\\\\Memsphere\\.Reviewer\\.[0-9a-f-]{36}$";Object.values(v).forEach(restore);}};restore(model);
 const {definitionHash}=await import("../src/context_control/model-assets.js");
 assert.equal(definitionHash(model),entity==="run"?"edc72333e9994d3af34efb5c214c94cccaadf868bd25cc6fc243d3b7901696c3":"099b094d127fcfa7966ae78965c4f481fa1de837d2f888cbad4a8d7ea286173d");
 await publishFixtureDefinition(f.root,`memsphere/context_control/${entity}.json`,JSON.stringify(model));
 assert.equal((await withModelMaintenance(f.root,()=>upgradeContextControlOutputs(f.root)))?.records,0);
 const reopened=(await openContextControl(f.root))!;assert.deepEqual(await reopened.stores.run.get({},run.id),before);assert.equal(await readFile(path,"utf8"),bytes);
});

test("explicit Schema model upgrade preserves existing records and rejects implicit upgrades", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("before Schema support");
  const reported = await service.report(run.id, { name: "Existing", content: textContent("Keep exact history") });
  const { readContextControlModels, definitionHash } = await import("../src/context_control/model-assets.js");
  const previous = { review: "e839d8a0c16e1b668bb03063cab252eed95bc48cfeb02f91543a67eba2a40407", run: "5b99d424f1e60d2ecc6e49c0c85cf175166d2561ceb0fd40e66ec69ece51fdfc", step: "521778e1ee71afeccb41eaa5f07e3b11479baaf676b6a745f70119e463be4b12", artifact: "875e20287dd6cdfb151b9acc569990c0b7da9bd0a3472a05c08fb71de9fabc20" };
  const before = { run: await service.stores.run.get({}, run.id), step: await service.stores.step.get({}, `${run.id}/${reported.step.id}`), artifact: await service.stores.artifact.get({}, `${run.id}/${reported.artifact.id}`) };
  for (const asset of readContextControlModels()) {
    if (!(asset.entity in previous)) continue;
    const model = structuredClone(asset.definition) as any;
    if (asset.entity === "review") delete model.definitions.ReviewNode.properties.requiresReport;
    else if (asset.entity === "run") delete model.properties.schemaContracts;
    else { delete model.properties.writing; if (asset.entity === "step") { delete model.definitions.SubmissionFrame.properties.draft; delete model.definitions.Validation.properties.draftRevision; delete model.definitions.Validation.allOf; model.definitions.Validation.required.unshift("sha256"); model.definitions.Validation.properties.artifactId.description = "被检查的 Artifact 标识；sha256 对应本次实际检查的内容。"; } }
    assert.equal(definitionHash(model), previous[asset.entity as keyof typeof previous]);
    await publishFixtureDefinition(f.root, asset.id, JSON.stringify(model));
  }
  await assert.rejects(openContextControl(f.root), { code: "MODEL_INCOMPATIBLE" });
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.run.get({}, run.id), before.run);
  assert.deepEqual(await reopened.stores.step.get({}, `${run.id}/${reported.step.id}`), before.step);
  assert.deepEqual(await reopened.stores.artifact.get({}, `${run.id}/${reported.artifact.id}`), before.artifact);
});

test("known numeric draft revision is converted by the explicit context model upgrade", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const run = await service.start("legacy draft revision");
  const reported = await service.report(run.id, { name: "draft", content: textContent("draft") });
  const id = `${run.id}/${reported.artifact.stepId}`;
  const path = join(f.root, "data/context_control/steps", `${id}.json`);
  const persisted = JSON.parse(await readFile(path, "utf8"));
  persisted.value.validation = { checkedAt: new Date().toISOString(), status: "failed", issues: [], draftRevision: 7 };
  await writeFile(path, JSON.stringify(persisted));
  await publishFixtureDefinition(f.root, "memsphere/context_control/step.json", await readFile(new URL("./fixtures/context-control-step-before-string-revision.json", import.meta.url), "utf8"));
  await assert.rejects(openContextControl(f.root), { code: "MODEL_INCOMPATIBLE" });
  assert.equal((await upgradeContextControlOutputs(f.root))?.records, 1);
  const updated = JSON.parse(await readFile(path, "utf8"));
  assert.equal(updated.value.validation.draftRevision, "7");
  assert.equal(updated.revision, persisted.revision + 1);
  assert.ok(await openContextControl(f.root));
});
