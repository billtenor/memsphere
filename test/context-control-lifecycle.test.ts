import assert from "node:assert/strict";
import test from "node:test";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";

test("finish adopts current derived outputs, and archiving/restoring preserves evidence and terminal status", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!, run = await s.start("完成与归档");
  await assert.rejects(s.archive(run.id), { code: "RUN_RUNNING" });
  const a = (await s.report(run.id, { name: "A", content: textContent("A") })).artifact;
  await s.report(run.id, { name: "隐藏", content: textContent("hide") });
  await s.updateOutputs(run.id, [a.id], (await s.outputs(run.id)).filter(id => id !== a.id));
  await s.review(run.id, a.id, "human", ["确认"]);
  await s.finish(run.id);
  const evidence = await s.snapshot(run.id); evidence.run.archived = false; const finished = await s.stores.run.get({}, run.id);
  await s.finish(run.id); assert.deepEqual(await s.stores.run.get({}, run.id), finished);
  const archived = await s.archive(run.id); assert.equal(archived.status, "done"); assert.ok(archived.archived);
  const archivedRow = await s.stores.run.get({}, run.id);
  await s.archive(run.id); assert.deepEqual(await s.stores.run.get({}, run.id), archivedRow);
  await s.archive(run.id, false); assert.deepEqual(await s.snapshot(run.id), evidence);
  await s.archive(run.id, false); assert.deepEqual(await s.snapshot(run.id), evidence);
  await assert.rejects(s.report(run.id, { name: "late", content: textContent("late") }), { code: "RUN_FINISHED" });
});

test("empty and abandoned explorations can be archived without inventing an output or resuming production", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const empty = await s.start("empty"); await s.finish(empty.id);
  assert.deepEqual((await s.snapshot(empty.id)).outputArtifactIds, []);
  await s.archive(empty.id);
  const abandoned = await s.start("abandoned"); await s.abandon(abandoned.id, "停止", "view");
  await s.archive(abandoned.id); const restored = await s.archive(abandoned.id, false);
  assert.equal(restored.status, "abandoned"); assert.equal(restored.abandonment?.source, "view");
  await assert.rejects(s.finish(abandoned.id), { code: "RUN_FINISHED" });
});

test("explicit empty delivery excludes current outputs and finish validates selected evidence", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!, run = await s.start("明确空交付");
  const a = (await s.report(run.id, { name: "A", content: textContent("A") })).artifact;
  await assert.rejects(s.finish(run.id, ["missing"])); assert.equal((await s.findRun(run.id))!.status, "running");
  assert.deepEqual(await s.outputs(run.id), [a.id]);
  await s.finish(run.id, []); assert.deepEqual(await s.outputs(run.id), []);
  const before = await s.stores.run.get({}, run.id); await s.finish(run.id, []); assert.deepEqual(await s.stores.run.get({}, run.id), before);
});


test("Context Control finish keeps Graph completion checks and explicit output selection", async t => {
  const { root } = await businessFixture(t, {}), service = (await openContextControl(root, true))!;
  const start = await service.withGraph(g => g.start({ name: "Graph finish routing", procedure: {
    tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["finish-route"], defines: ["Completion routing"],
    actions: [{ tag: "!action", id: "A", description: "Produce", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } }],
  } }));
  await assert.rejects(service.finish(start.run.id, []), { code: "GRAPH_INCOMPLETE" });
  const report = await service.withGraph(async g => {
    await g.enter(start.run.id, start.steps[0].id);
    return g.report(start.run.id, start.steps[0].id, { text: "result" });
  });
  assert.equal((await service.finish(start.run.id, [report.artifact.id])).status, "done");
  const before = await service.stores.run.get({}, start.run.id);
  await service.finish(start.run.id);
  assert.deepEqual(await service.stores.run.get({}, start.run.id), before);
  assert.deepEqual((await service.snapshot(start.run.id)).outputArtifactIds, [report.artifact.id]);
});
