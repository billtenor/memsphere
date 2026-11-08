import assert from "node:assert/strict";

import test from "node:test";

import { checkModelDefinition } from "../src/project/model-validation.js";

import { readContextControlModels } from "../src/context_control/model-assets.js";

const time = "2026-10-27T00:00:00.000Z";

const graph = () => ({ memoryRef: "procedures/a", triggers: [], joins: [], pendingSteps: [], processedStepIds: [], nextCompletionSequence: 1 });

const run = () => ({ id: "r", name: "R", status: "running", createdAt: time, language: "en" });

const step = () => ({ id: "s", runId: "r", status: "pending", createdAt: time });

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
