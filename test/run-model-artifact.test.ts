import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { archiveRun, restoreRun } from "../src/archive/store.js";
import { buildRunCurrentStepPromptModel } from "../src/prompts/run.js";
import { renderPrompt } from "../src/prompts/index.js";
import { businessFixture } from "./helpers/business-data.js";
import { initializeProjectModelRegistrations } from "../src/project/model-registration.js";
import { readData, listData, upsertData } from "../src/project/data-service.js";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { abandonRun, startRun, reportRun, readRun, currentStep, currentArtifactReview, submitArtifactReviewHumanAssignmentForRunner, submitArtifactReviewRunnerVote } from "../src/run/store.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { reviewConfiguration } from "./helpers/review.js";
import { procedureMemorySchema } from "../src/memory/schema.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";

const action = (review = false, type = "object", format = "json") => `  - !action
    action: Produce a model value.
    artifact: !artifact
      name: result
      type: ${type}
      format: ${format}
      store: records
${review ? '      review: [owner]\n' : ''}`;
async function fixture(t: TestContext, flow = action(), schemas?: Record<string, unknown>) {
  const f = await businessFixture(t, schemas); await f.createStore();
  await initializeProjectModelRegistrations({}, { root: f.root });
  const memoryRoot = join(f.root, "memory"); const runsRoot = join(f.root, "runs");
  await fs.mkdir(join(memoryRoot, "procedures"), { recursive: true });
  const save = (name: string, body: string) => fs.writeFile(join(memoryRoot, "procedures", `${name}.yaml`), `!procedure\nsyntax: memsphere-20260721-stable\nname: ${name}\nflow:\n${body}`);
  await save("model-flow", flow);
  const start = (review = false) => startRun({ memoryRoot, runsRoot, projectRoot: f.root, procedureName: "model-flow", name: "Model test", ...(review ? {
    controlPlane: parseControlPlaneConfig({ runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Owner", permissions: ["artifact.read", "decision.decide"] } } }),
    reviewConfiguration: reviewConfiguration({ procedure: "model-flow", slots: { owner: ["human"] } })
  } : {}) });
  const report = (runId: string, value = '{"name":"original","count":1}', revisionSummary?: string) => reportRun({ runsRoot, runId, artifact: { kind: "inline", value }, revisionSummary });
  return { ...f, memoryRoot, runsRoot, save, start, report };
}

test("model Artifact retains immutable full snapshot independently of business upsert", async t => {
  const f = await fixture(t); const run = await f.start(); const done = await f.report(run.id);
  assert.equal(done.status, "done");
  const artifact = done.events[0].artifact; const receipt = artifact.modelData!;
  assert(receipt.dataId.startsWith(`${run.id}--`)); assert.equal(receipt.revision, 1);
  const snapshot = await fs.readFile(join(f.runsRoot, artifact.path!), "utf8");
  assert.deepEqual(JSON.parse(snapshot), (await readData({}, f.root, "records", receipt.dataId)).value);
  await upsertData({}, f.root, "records", receipt.dataId, { kind: "value", value: { name: "later", count: 2 } });
  assert.equal(await fs.readFile(join(f.runsRoot, artifact.path!), "utf8"), snapshot);
  await assert.rejects(f.report(run.id));
});

test("model validation failure keeps execution identity stable for corrected report", async t => {
  const f = await fixture(t); const run = await f.start();
  await assert.rejects(f.report(run.id, '{"name":"invalid","count":-1}'));
  const failed = await readRun(f.runsRoot, run.id); const executionId = currentStep(failed)!.stepExecutionId;
  assert(executionId); assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  const done = await f.report(run.id); assert.equal(done.events[0].artifact.modelData!.stepExecutionId, executionId);
});

test("repeated Calls and loop iterations allocate distinct data identities", async t => {
  const flow = `  - !call\n    target: child\n  - !call\n    target: child\n  - !while\n    condition: !action\n      action: Continue?\n      artifact: !artifact\n        name: condition\n        type: boolean\n    do:\n${action().split('\n').map(line => line ? '    '+line : line).join('\n')}`;
  const f = await fixture(t, flow); await f.save("child", action()); let run = await f.start();
  run = await f.report(run.id); run = await f.report(run.id);
  run = await f.report(run.id, "true"); run = await f.report(run.id);
  run = await f.report(run.id, "true"); run = await f.report(run.id);
  run = await f.report(run.id, "false");
  assert.equal(run.status, "done");
  const ids = run.events.flatMap(event => event.artifact.modelData ? [event.artifact.modelData.dataId] : []);
  assert.equal(ids.length, 4); assert.equal(new Set(ids).size, 4);
  const next = await f.start(); const another = await f.report(next.id);
  assert(!ids.includes(another.events[0].artifact.modelData!.dataId));
});

test("model changes before report are rejected and restoring model allows same-run retry", async t => {
  const f = await fixture(t); const run = await f.start(); const path = join(f.root, "models/json-schema/draft-07/record.json");
  const previous = await fs.readFile(path); await fs.writeFile(path, '{"type":"string"}');
  await assert.rejects(f.report(run.id), { code: "MODEL_ARTIFACT_TARGET_CHANGED" });
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  await fs.writeFile(path, previous); assert.equal((await f.report(run.id)).status, "done");
});

test("model scalar values preserve type in both snapshot and business Store", async t => {
  for (const [type, value] of [["string", '"quoted\\nvalue"'], ["number", "2.5"], ["boolean", "false"]]) {
    for (const format of ["json", "yaml", "plain"]) {
      await t.test(`${type}/${format}`, async sub => {
        const f = await fixture(sub, action(false, type, format), { "record.json": { type } });
        const raw = format === "plain" && type === "string" ? "quoted\nvalue" : value;
        const done = await f.report((await f.start()).id, raw);
        const artifact = done.events[0].artifact;
        assert.equal(await fs.readFile(join(f.runsRoot, artifact.path!), "utf8"), raw);
        assert.deepEqual((await readData({}, f.root, "records", artifact.modelData!.dataId)).value, JSON.parse(value));
      });
    }
  }
});

test("review revisions retain full snapshots but never write business data until accepted", async t => {
  const f = await fixture(t, action(true)); const start = await f.start(true); let run = await f.report(start.id);
  let review = currentArtifactReview(run)!;
  const firstPath = review.submissions[0].artifact.path!;
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  await submitArtifactReviewHumanAssignmentForRunner({ runsRoot: f.runsRoot, runId: run.id, reviewId: review.id, roundId: review.currentRoundId, assignmentId: "human", vote: "request_changes", comments: [{ body: "Change the name." }], authorizationNote: "Fixture Human requests changes." });
  run = await f.report(run.id, '{"name":"revised","count":2}', "Changed name."); review = currentArtifactReview(run)!;
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  const id = currentStep(run)!.stepExecutionId;
  await submitArtifactReviewHumanAssignmentForRunner({ runsRoot: f.runsRoot, runId: run.id, reviewId: review.id, roundId: review.currentRoundId, assignmentId: "human", vote: "approve", comments: [], authorizationNote: "Fixture Human approves." });
  await submitArtifactReviewRunnerVote({ runsRoot: f.runsRoot, reviewId: review.id, roundId: review.currentRoundId, vote: "approve" });
  run = await readRun(f.runsRoot, run.id); assert.equal(run.status, "done");
  assert.equal(run.events[0].artifact.modelData!.stepExecutionId, id);
  assert.deepEqual((await readData({}, f.root, "records", run.events[0].artifact.modelData!.dataId)).value, { name: "revised", count: 2 });
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.runsRoot, firstPath), "utf8")), { name: "original", count: 1 });
});

test("business upsert failure does not advance the Run and retry reuses identity", async t => {
  const f = await fixture(t); const start = await f.start();
  const original = FilesystemJsonValueStoreFactory.prototype.openExisting;
  const mocked = t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function (...args: Parameters<typeof original>) {
    const store = await original.apply(this, args); store.upsert = async () => { throw new Error("Injected write failure"); }; return store;
  });
  await assert.rejects(f.report(start.id), /Injected write failure/);
  const id = currentStep(await readRun(f.runsRoot, start.id))!.stepExecutionId;
  mocked.mock.restore();
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  assert.equal((await f.report(start.id)).events[0].artifact.modelData!.stepExecutionId, id);
});

test("business write followed by Run-save failure is safely redone at the same data ID", async t => {
  const f = await fixture(t); const run = await f.start(); const statePath = join(f.runsRoot, run.id, `${run.id}.json`);
  const original = FilesystemJsonValueStoreFactory.prototype.openExisting;
  let backup: Buffer | undefined;
  const mocked = t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function (...args: Parameters<typeof original>) {
    const store = await original.apply(this, args); const upsert = store.upsert!.bind(store);
    store.upsert = async (...input) => {
      const result = await upsert(...input); backup = await fs.readFile(statePath);
      await fs.rm(statePath); await fs.mkdir(statePath); return result;
    }; return store;
  });
  await assert.rejects(f.report(run.id)); mocked.mock.restore();
  assert(backup); await fs.rm(statePath, { recursive: true }); await fs.writeFile(statePath, backup);
  const before = await listData({}, f.root, "records"); assert.equal(before.items.length, 1);
  const done = await f.report(run.id); assert.equal(done.status, "done");
  assert.equal(done.events[0].artifact.modelData!.dataId, before.items[0].id);
  assert.equal(done.events[0].artifact.modelData!.revision, 2);
});

test("model Artifact syntax round-trips while unsupported combinations fail", () => {
  const source = `!procedure\nsyntax: memsphere-20260721-stable\nname: model-flow\nflow:\n${action(false, "boolean")}`;
  const parsed = procedureMemorySchema.parse(parseMemoryYaml(source));
  assert.deepEqual(procedureMemorySchema.parse(parseMemoryYaml(serializeMemoryYaml(parsed))), parsed);
  for (const invalid of [source.replace('      store: records\n', ''), source.replace('      store: records', '      model: record.json'), source.replace('      format: json', '      format: markdown')])
    assert.throws(() => procedureMemorySchema.parse(parseMemoryYaml(invalid)));
});


test("Run prompt exposes the frozen model and Store for a model Artifact", async t => {
  const f = await fixture(t); const run = await f.start();
  const model = buildRunCurrentStepPromptModel(run, "zh-CN", f.runsRoot)!;
  for (const locale of ["zh-CN", "en"] as const) {
    const text = renderPrompt("run.current-step", locale, model);
    assert.match(text, /Store: records/); assert.match(text, /Model: record.json/);
  }
});

test("model change while review is pending blocks acceptance until the original definition returns", async t => {
  const f = await fixture(t, action(true)); let run = await f.report((await f.start(true)).id);
  const review = currentArtifactReview(run)!;
  await submitArtifactReviewHumanAssignmentForRunner({ runsRoot: f.runsRoot, runId: run.id, reviewId: review.id, roundId: review.currentRoundId, assignmentId: "human", vote: "approve", comments: [], authorizationNote: "Fixture Human approves." });
  const path = join(f.root, "models/json-schema/draft-07/record.json");
  const original = await fs.readFile(path); await fs.writeFile(path, JSON.stringify({ ...JSON.parse(original.toString()), description: "changed" }));
  await assert.rejects(submitArtifactReviewRunnerVote({ runsRoot: f.runsRoot, reviewId: review.id, roundId: review.currentRoundId, vote: "approve" }), { code: "MODEL_ARTIFACT_TARGET_CHANGED" });
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
  assert.equal((await readRun(f.runsRoot, run.id)).status, "running");
  await fs.writeFile(path, original);
  await submitArtifactReviewRunnerVote({ runsRoot: f.runsRoot, reviewId: review.id, roundId: review.currentRoundId, vote: "approve" });
  assert.equal((await readRun(f.runsRoot, run.id)).status, "done");
});

test("business data survives Run abandonment, archive, restoration and deletion without rewriting", async t => {
  const flow = action()+`  - !action\n    action: Continue.\n    artifact: !artifact\n      name: next\n`;
  const f = await fixture(t, flow); let run = await f.report((await f.start()).id);
  const receipt = run.events[0].artifact.modelData!;
  await abandonRun({ runsRoot: f.runsRoot, runId: run.id, source: "cli", reason: "Human cancels." });
  const archiveRoot = join(f.root, "archives");
  await archiveRun({ runsRoot: f.runsRoot, archiveRoot, id: run.id });
  await restoreRun({ runsRoot: f.runsRoot, archiveRoot, id: run.id });
  await fs.rm(join(f.runsRoot, run.id), { recursive: true });
  const data = await readData({}, f.root, "records", receipt.dataId);
  assert.deepEqual(data.value, { name: "original", count: 1 }); assert.equal(data.revision, receipt.revision);
});

test("start rejects unsupported DataStore and an explicit model mismatch without business writes", async t => {
  const f = await fixture(t);
  await f.createStore("files", "record.json", "data");
  await f.save("model-flow", action().replace('store: records', 'store: files'));
  await assert.rejects(f.start(), { code: "UNSUPPORTED_CAPABILITY" });
  await f.save("model-flow", action().replace('store: records', 'store: records\n      model: other.json'));
  await assert.rejects(f.start(), { code: "STORE_MODEL_MISMATCH" });
  assert.deepEqual(await listData({}, f.root, "records"), { items: [] });
});

test("Store directory changes before report are rejected without following the new target", async t => {
  const f = await fixture(t); const run = await f.start(); const path = join(f.root, "config.json");
  const original = await fs.readFile(path); const config = JSON.parse(original.toString());
  await fs.mkdir(join(f.root, "other-data")); config.dataStores.records.config.directory = "other-data";
  await fs.writeFile(path, JSON.stringify(config));
  await assert.rejects(f.report(run.id), { code: "MODEL_ARTIFACT_TARGET_CHANGED" });
  assert.deepEqual(await fs.readdir(join(f.root, "other-data")), []);
  await fs.writeFile(path, original); assert.equal((await f.report(run.id)).status, "done");
});
