import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkModelDefinition } from "../src/project/model-validation.js";
import { readContextControlModels } from "../src/context_control/model-assets.js";
import { openContextControl } from "../src/project/context-control.js";
import { businessFixture } from "./helpers/business-data.js";
import { withModelMaintenance } from "../src/project/model-operation.js";
import { upgradeContextControlOutputs } from "../src/project/context-control-upgrade.js";

const time = "2026-10-27T00:00:00.000Z";
const graph = () => ({ memoryRef: "procedures/a", triggers: [], joins: [], pendingSteps: [], processedStepIds: [], nextCompletionSequence: 1 });
const run = () => ({ id: "r", name: "R", status: "running", createdAt: time, language: "en" });
const step = () => ({ id: "s", runId: "r", status: "pending", createdAt: time });

test("reserved model Runtime rejects missing, wrong and duplicate discriminator payloads", async () => {
  for (const entity of ["run", "step"] as const) {
    const asset = readContextControlModels().find(a => a.entity === entity)!;
    const { runtime } = await checkModelDefinition({}, { modelRef: asset.id, definition: asset.definition });
    for (const example of (asset.definition as any).examples ?? []) assert.doesNotThrow(() => runtime!.reflect(example));
    const base = entity === "run" ? run() : step();
    for (const type of entity === "run" ? ["graph", "procedure"] : ["submission", "schema"]) {
      assert.throws(() => runtime!.reflect({ ...base, frames: [{ id: "f", type }] }), /discriminated/);
    }
    if (entity === "run") {
      const frame = { id: "f", type: "graph", graphFrame: graph() };
      assert.doesNotThrow(() => runtime!.reflect({ ...base, frames: [frame] }));
      const procedureFrame = { memoryRef: "procedures/a", sequence: [], index: 0 };
      for (const extra of [{ ...frame, type: "procedure" }, { ...frame, procedureFrame }]) assert.throws(() => runtime!.reflect({ ...base, frames: [extra] }), /discriminated/);
      for (const arrival of [{ kind: "artifact" }, { kind: "collect" }, { kind: "start", id: "a" }, { kind: "artifact", id: "a", items: {} }]) {
        assert.throws(() => runtime!.reflect({ ...base, frames: [{ ...frame, graphFrame: { ...graph(), joins: [{ actionId: "A", dependencyIndex: 0, arrivals: { A: arrival } }] } }] }), /discriminated/);
      }
      for (const trigger of [{}, { stepId: "s", inputs: {} }]) assert.throws(() => runtime!.reflect({ ...base, frames: [{ ...frame, graphFrame: { ...graph(), triggers: [{ id: "t", actionId: "A", dependencyIndex: 0, ...trigger }] } }] }), /discriminated/);
    } else {
      for (const artifact of [{ mode: "produce" }, { mode: "collect" }, { mode: "produce", items: {} }, { mode: "collect", id: "a", items: {} }]) assert.throws(() => runtime!.reflect({ ...base, artifact }), /discriminated/);
      const schemaFrame = { sequence: [], index: 0, decisions: [] };
      assert.doesNotThrow(() => runtime!.reflect({ ...base, frames: [{ id: "schema-1", type: "schema", schemaFrame }, { id: "schema-2", type: "schema", schemaFrame }] }));
      const submissionFrame = { artifact: { id: "a", stepId: "s", name: "A", status: "submitted", tags: ["default"], dependencies: [], content: { model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain", content: "a" } } }, nextStatus: "done" };
      assert.doesNotThrow(() => runtime!.reflect({ ...base, frames: [{ id: "f", type: "submission", submissionFrame }] }));
      for (const frame of [{ id: "f", type: "schema", submissionFrame }, { id: "f", type: "submission", schemaFrame }, { id: "f", type: "submission", schemaFrame, submissionFrame }]) assert.throws(() => runtime!.reflect({ ...base, frames: [frame] }), /discriminated/);

    }
  }
});

for (const status of ["failed", "cancelled"]) test(`known model upgrade preserves old ${status} Step and its revision`, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const r = await service.start("historical");
  const value = { ...step(), runId: r.id, status };
  await service.stores.step.create({}, `${r.id}/s`, value);
  const before = await service.stores.step.get({}, `${r.id}/s`);
  for (const entity of ["run", "step"]) await writeFile(join(f.root, `models/json-schema/draft-07/memsphere/context_control/${entity}.json`), await readFile(new URL(`./fixtures/context-control-${entity}-before-graph.json`, import.meta.url), "utf8"));
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  const reopened = (await openContextControl(f.root))!;
  assert.deepEqual(await reopened.stores.step.get({}, `${r.id}/s`), before);
  assert.equal((await reopened.snapshot(r.id)).steps[0].status, status);
});

for (const entity of ["run", "step"] as const) test(`generic ${entity} writes, corrupted reads and explicit upgrade reject invalid frames`, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const r = await service.start("invalid frame"), store = service.stores[entity];
  const key = entity === "run" ? r.id : `${r.id}/s`;
  const value = entity === "run" ? r : { ...step(), runId: r.id };
  const bad = { ...value, frames: [{ id: "f", type: entity === "run" ? "procedure" : "schema" }] };
  await assert.rejects(store.create({}, entity === "run" ? "bad" : `${r.id}/bad`, { ...bad, id: "bad" }), /discriminated/);
  if (entity === "step") await store.create({}, key, value);
  const row = (await store.get({}, key))!;
  const recordPath = join(f.root, `data/context_control/${entity}s/${key}.json`);
  await writeFile(recordPath, JSON.stringify({ ...row, value: bad }));
  await assert.rejects(store.get({}, key), /discriminated/);
  const path = join(f.root, `models/json-schema/draft-07/memsphere/context_control/${entity}.json`);
  const old = await readFile(new URL(`./fixtures/context-control-${entity}-before-graph.json`, import.meta.url), "utf8");
  await writeFile(path, old);
  await assert.rejects(withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)));
  assert.equal(await readFile(path, "utf8"), old);
});

for (const nextStatus of ["done", "awaiting_review"] as const) test(`submission ${nextStatus} rejects the opposite round presence on writes, reads and explicit upgrade`, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const r = await service.start("review gate");
  const artifact = { id: "a", stepId: "s", name: "A", status: "submitted", tags: ["default"], dependencies: [] };
  const round = { id: "round", artifactId: "a", createdAt: time, reviewConfig: { policy: { id: "unanimous", kind: "artifact_acceptance", completion: "all_assigned", resolution: "unanimous" }, bindings: {}, reviewers: {}, runner: { permissions: [] } } };
  const valid = { ...step(), runId: r.id, frames: [{ id: "f", type: "submission", submissionFrame: { artifact, nextStatus, ...(nextStatus === "awaiting_review" ? { round } : {}) } }] };
  const bad = { ...valid, frames: [{ id: "f", type: "submission", submissionFrame: { artifact, nextStatus, ...(nextStatus === "done" ? { round } : {}) } }] };
  const key = `${r.id}/s`, store = service.stores.step;
  await assert.rejects(store.create({}, key, bad), /discriminated.*round/);
  await store.create({}, key, valid); const before = (await store.get({}, key))!;
  const path = join(f.root, `data/context_control/steps/${key}.json`);
  await writeFile(path, JSON.stringify({ ...before, value: bad }));
  await assert.rejects(store.get({}, key), /discriminated.*round/);
  const schemaPath = join(f.root, "models/json-schema/draft-07/memsphere/context_control/step.json");
  const prior = await readFile(new URL("./fixtures/context-control-step-before-review-invariant.json", import.meta.url), "utf8");
  await writeFile(schemaPath, prior);
  await assert.rejects(withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)), /discriminated.*round/);
  assert.equal(await readFile(schemaPath, "utf8"), prior);
  await writeFile(path, JSON.stringify(before));
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  assert.deepEqual(await (await openContextControl(f.root))!.stores.step.get({}, key), before);
});

for (const conflict of ["different", "duplicate", "schema"] as const) test(`submission intent excludes ${conflict} second frame on Store write, corrupt read and upgrade`, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const r = await service.start("single recovery intent"), store = service.stores.step, key = `${r.id}/s`;
  const first = { id: "first", type: "submission", submissionFrame: { artifact: { id: "a", stepId: "s", name: "A", status: "submitted", tags: ["default"], dependencies: [] }, nextStatus: "done" } };
  const second = conflict === "schema" ? { id: "second", type: "schema", schemaFrame: { sequence: [], index: 0, decisions: [] } }
    : { ...structuredClone(first), id: "second", submissionFrame: { ...first.submissionFrame, artifact: { ...first.submissionFrame.artifact, id: conflict === "different" ? "b" : "a" } } };
  const valid = { ...step(), runId: r.id, frames: [first] }, bad = { ...valid, frames: [first, second] };
  await assert.rejects(store.create({}, key, bad), /sole recovery intent/);
  await store.create({}, key, valid); const before = (await store.get({}, key))!;
  const path = join(f.root, `data/context_control/steps/${key}.json`); await writeFile(path, JSON.stringify({ ...before, value: bad }));
  await assert.rejects(store.get({}, key), /sole recovery intent/);
  const schemaPath = join(f.root, "models/json-schema/draft-07/memsphere/context_control/step.json");
  const previous = await readFile(new URL("./fixtures/context-control-step-before-review-invariant.json", import.meta.url), "utf8"); await writeFile(schemaPath, previous);
  await assert.rejects(withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)), /sole recovery intent/);
  assert.equal(await readFile(schemaPath, "utf8"), previous);
  await writeFile(path, JSON.stringify(before));
  assert.equal((await withModelMaintenance(f.root, () => upgradeContextControlOutputs(f.root)))?.records, 0);
  assert.deepEqual(await (await openContextControl(f.root))!.stores.step.get({}, key), before);
});
