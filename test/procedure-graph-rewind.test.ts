import assert from "node:assert/strict";

import test from "node:test";

import { graphDomainFixture as fixture } from "./helpers/graph-domain.js";

import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";

import type { GraphRuntime } from "../src/context_control/graph-runtime.js";

import type { Snapshot } from "../src/context_control/types.js";

import { effectiveStep } from "../src/context_control/graph-rewind.js";

const artifact = { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } };

const action = (id: string, from: string | string[] = "START", when?: string): GraphAction => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from, ...(when ? { when } : {}) }], artifact });

const procedure = (actions: GraphAction[]): GraphProcedureMemory => ({ tag: "!procedure", syntax: "memsphere-20261027-stable", names: ["rewind-test"], defines: ["Rewind"], mode: "graph", actions });

async function produce(g: GraphRuntime, run: string, step: string, text = "body") { await g.enter(run, step); return g.report(run, step, { text }); }

const latest = (snapshot: Snapshot, id: string) => {
 const order=snapshot.run.frames![0].graphFrame.triggers.flatMap(t=>t.stepId?[t.stepId]:[]);
 const step=[...order].reverse().map(stepId=>snapshot.steps.find(s=>s.id===stepId)).find(s=>s?.source?.actionId===id);
 assert.ok(step,`No triggered Step for ${id}`);return step;
};

const collectAction = (id: string, from: string, members: string[]): GraphAction => ({ tag: '!action', id, description: id, dependencies: [{ tag: '!dependency', from }], collect: members });

const current = (snapshot: Awaited<ReturnType<GraphRuntime['snapshot']>>, id: string) => snapshot.steps.filter(s => s.source?.actionId === id && effectiveStep(snapshot.run, s.id));

test("rewind creates a pending product version and retains exact old dependencies while replacing downstream", async t => {
  const f = await fixture(t, true);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: "versions", procedure: procedure([action("product"), action("technical", "product")]) });
    const old = await produce(g, start.run.id, start.steps[0].id, "P1");
    const technical = latest(old.snapshot, "technical"); await g.enter(start.run.id, technical.id);
    const before = await g.snapshot(start.run.id);
    const preview = await g.rewindPreview(start.run.id, old.step.id);
    assert.deepEqual(await g.snapshot(start.run.id), before); assert.ok(preview.affectedStepIds.includes(technical.id));
    const result = await g.rewind(start.run.id, old.step.id, "P1 is wrong");
    assert.equal(latest(result.snapshot, "product").status, "pending");
    await assert.rejects(g.report(start.run.id, technical.id, { text: "old T" }), { code: "STEP_SUPERSEDED" });
    assert.equal(Buffer.from((await g.readArtifact(start.run.id, old.artifact.id)).bytes).toString(), "P1");
    const fresh = await produce(g, start.run.id, result.replacementStepId, "P2");
    assert.equal(fresh.artifact.revisedFrom, old.artifact.id);
    assert.deepEqual(fresh.snapshot.steps.find(s => s.source?.actionId === "technical" && effectiveStep(fresh.snapshot.run, s.id))!.inputs, { product: [{ kind: "artifact", id: fresh.artifact.id }] });
    assert.deepEqual(fresh.snapshot.artifacts.find(a => a.id === old.artifact.id), old.artifact);
    assert.ok(!fresh.snapshot.completeIds.includes(old.artifact.id));
  });
});

test("a saved rewind recovers the same target after materialization interruption", async t => {
  const f = await fixture(t, true);
  await f.service.withGraph(async g => {
    const start = await g.start({ name: "recovery", procedure: procedure([action("A")]) });
    const old = await produce(g, start.run.id, start.steps[0].id);
    const create = f.service.stores.step.create.bind(f.service.stores.step);
    f.service.stores.step.create = async () => { throw Error("interrupted materialization"); };
    await assert.rejects(g.rewind(start.run.id, old.step.id, "fix"), /interrupted materialization/);
    f.service.stores.step.create = create;
    const expected = (await g.snapshot(start.run.id)).run.frames![0].graphFrame.rewinds![0].replacementStepId;
    const recovered = await g.advance(start.run.id);
    assert.equal(recovered.steps.filter(s => s.id === expected).length, 1);
    assert.equal(latest(recovered, "A").status, "pending");
    assert.deepEqual((await g.advance(start.run.id)).steps, recovered.steps);
    await assert.rejects(g.rewind(start.run.id, old.step.id, "duplicate"), { code: "STEP_SUPERSEDED" });
  });
});
