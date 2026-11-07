import assert from "node:assert/strict";
import test from "node:test";
import { checkModelDefinition } from "../src/project/model-validation.js";
import { readContextControlModels } from "../src/context_control/model-assets.js";


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


test('collect membership evidence refers only to other triggers in its own Run', async () => {
  const asset = readContextControlModels().find(a => a.entity === 'run')!;
  const { runtime } = await checkModelDefinition({}, { modelRef: asset.id, definition: asset.definition });
  const source = { id: 'source', actionId: 'B', dependencyIndex: 0, inputs: {}, arrivals: { START: { kind: 'start' } } };
  const collect = { id: 'collect', actionId: 'gather', dependencyIndex: 0, stepId: 's', arrivals: { START: { kind: 'start' } }, collection: { items: { B: [] }, triggerIds: ['source'] } };
  const record = (trigger: unknown) => ({ ...run(), frames: [{ id: 'f', type: 'graph', graphFrame: { ...graph(), triggers: [source, trigger] } }] });
  assert.doesNotThrow(() => runtime!.reflect(record(collect)));
  for (const id of ['collect', 'foreign-trigger']) assert.throws(() => runtime!.reflect(record({ ...collect, collection: { ...collect.collection, triggerIds: [id] } })), /discriminated.*collection/);
  const { stepId: _id, ...withoutStep } = collect;
  assert.throws(() => runtime!.reflect(record({ ...withoutStep, inputs: {} })), /discriminated.*collection/);
});
