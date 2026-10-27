import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { parseMemoryEntity } from "../src/memory/store.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";
import type { GraphRuntime } from "../src/context_control/graph-runtime.js";
import type { Artifact, Run, Step } from "../src/context_control/types.js";
import type { ControlPlaneConfig, RunReviewConfiguration } from "../src/control-plane/index.js";

const spec = (review?: string[]) => ({ name: "Result", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"string"}' }, payload: { contentType: "application/json" }, ...(review ? { review } : {}) });
function action(id: string, from: string | string[] = "START", when?: string): GraphAction {
  return { tag: "!action", id, description: `Produce ${id}`, dependencies: [{ tag: "!dependency", from, ...(when ? { when } : {}) }], artifact: spec() };
}
function procedure(actions: GraphAction[]): GraphProcedureMemory { return parseMemoryEntity("procedures", { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["runtime-graph"], defines: ["A graph"], actions }) as GraphProcedureMemory; }
async function fixture(t: TestContext) {
  const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
  return { root, service, use: <T>(fn: (g: GraphRuntime) => Promise<T>) => service.withGraph(fn) };
}
async function produce(g: GraphRuntime, runId: string, stepId: string, value: string, revisionSummary?: string) {
  await g.enter(runId, stepId); return g.report(runId, stepId, { text: JSON.stringify(value), ...(revisionSummary ? { revisionSummary } : {}) });
}
const byAction = (steps: Step[], id: string) => steps.filter(s => s.source?.actionId === id);

test("corrupt done-with-round submission cannot recover past its unaccepted Review", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact = spec(["approval"]);
    const start = await g.start({ name: "review integrity", procedure: procedure([A, action("B", "A")]), controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "runtime-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "runtime-graph::approval": { actorIds: ["human"] } } } });
    const id = start.steps[0].id; await g.enter(start.run.id, id);
    const create = f.service.stores.artifact.create.bind(f.service.stores.artifact);
    f.service.stores.artifact.create = async () => { throw Error("candidate creation interruption"); };
    await assert.rejects(g.report(start.run.id, id, { text: '"candidate"' }), /candidate creation interruption/);
    f.service.stores.artifact.create = create;
    const path = join(f.root, `data/context_control/steps/${start.run.id}/${id}.json`);
    const row = JSON.parse(await readFile(path, "utf8")), stage = row.value.frames[0].submissionFrame;
    assert.equal(stage.nextStatus, "awaiting_review"); assert.ok(stage.round);
    stage.nextStatus = "done"; await writeFile(path, JSON.stringify(row));
    const reopened = (await openContextControl(f.root))!;
    await assert.rejects(reopened.withGraph(g => g.advance(start.run.id)), /discriminated.*round/);
    assert.equal((await reopened.stores.artifact.list({})).items.length, 0);
    assert.equal((await reopened.stores.review.list({})).items.length, 0);
    const run = (await reopened.stores.run.get({}, start.run.id))!.value as Run;
    assert.equal(run.frames![0].graphFrame.triggers.some(t => t.actionId === "B"), false);
    assert.equal(JSON.parse(await readFile(path, "utf8")).value.status, "running");
  });
});

for (const conflict of ["different", "duplicate", "schema"] as const) test(`graph refuses ${conflict} recovery intents without creating or completing anything`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact = spec(["approval"]);
    const start = await g.start({ name: "ambiguous recovery", procedure: procedure([A, action("B", "A")]), controlPlane: cp, reviewConfiguration: bindings });
    const id = start.steps[0].id; await g.enter(start.run.id, id);
    const create = f.service.stores.artifact.create.bind(f.service.stores.artifact);
    f.service.stores.artifact.create = async () => { throw Error("staged candidate interruption"); };
    await assert.rejects(g.report(start.run.id, id, { text: '"candidate"' }), /staged candidate interruption/);
    f.service.stores.artifact.create = create;
    const key = `${start.run.id}/${id}`, path = join(f.root, `data/context_control/steps/${key}.json`);
    const row = JSON.parse(await readFile(path, "utf8")), first = structuredClone(row.value.frames[0]), second = structuredClone(first);
    first.submissionFrame.nextStatus = "done"; delete first.submissionFrame.round;
    second.id = `second-${first.id}`;
    if (conflict === "different") {
      second.submissionFrame.artifact.id = `second-${second.submissionFrame.artifact.id}`;
      second.submissionFrame.round.artifactId = second.submissionFrame.artifact.id;
    } else if (conflict === "duplicate") second.submissionFrame = structuredClone(first.submissionFrame);
    else { second.type = "schema"; delete second.submissionFrame; second.schemaFrame = { sequence: [], index: 0, decisions: [] }; }
    row.value.frames = [first, second];
    // A backend that returns values without the reserved-model validator still
    // crosses the same domain recovery guard; no silent first-frame selection.
    const get = f.service.stores.step.get.bind(f.service.stores.step);
    f.service.stores.step.get = async (...args) => {
      const found = await get(...args); return found && args[1] === key ? { ...found, value: row.value } : found;
    };
    await assert.rejects(g.snapshot(start.run.id), /sole recovery intent/);
    await assert.rejects(g.advance(start.run.id), /sole recovery intent/);
    f.service.stores.step.get = get;
    await writeFile(path, JSON.stringify(row));
    const reopened = (await openContextControl(f.root))!;
    await assert.rejects(reopened.withGraph(g => g.advance(start.run.id)), /sole recovery intent/);
    assert.equal((await reopened.stores.artifact.list({})).items.length, 0);
    assert.equal((await reopened.stores.review.list({})).items.length, 0);
    const run = (await reopened.stores.run.get({}, start.run.id))!.value as Run;
    assert.equal(run.frames![0].graphFrame.triggers.some(t => t.actionId === "B"), false);
    assert.equal(run.frames![0].graphFrame.nextCompletionSequence, 1);
    const unchanged = JSON.parse(await readFile(path, "utf8")).value;
    assert.equal(unchanged.status, "running"); assert.equal(unchanged.frames.length, 2);
  });
});

for (const boundary of ["intent", "done"] as const) test(`completion recovery preserves ${boundary === "intent" ? "a reserved gap before intent persistence" : "the sequence fixed before done persistence"}`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "completion crash", procedure: procedure([action("A"), action("B", "A")]) });
    const id = start.steps[0].id; await g.enter(start.run.id, id);
    const original = f.service.stores.step.update.bind(f.service.stores.step);
    f.service.stores.step.update = async (...args) => {
      const value = args[2] as Step;
      if (value.id === id && (boundary === "intent" ? value.frames?.[0]?.submissionFrame.completionSequence !== undefined : value.status === "done")) throw Error("completion interruption");
      return original(...args);
    };
    await assert.rejects(g.report(start.run.id, id, { text: '"a"' }), /completion interruption/);
    const staged = (await g.records.require<Step>("step", start.run.id, id)).value;
    const reserved = (await g.records.require<Run>("run", start.run.id, start.run.id)).value.frames![0].graphFrame.nextCompletionSequence;
    assert.equal(reserved, 2); assert.equal(staged.status, "running");
    assert.equal(staged.frames![0].submissionFrame.completionSequence, boundary === "intent" ? undefined : 1);
    const artifactId = staged.frames![0].submissionFrame.artifact.id;
    f.service.stores.step.update = original;
    const reopened = (await openContextControl(f.root))!;
    const recovered = await reopened.withGraph(g => g.advance(start.run.id));
    const completed = recovered.steps.find(s => s.id === id)!;
    assert.equal(completed.status, "done"); assert.equal(completed.completionSequence, boundary === "intent" ? 2 : 1);
    assert.deepEqual(completed.artifact, { mode: "produce", id: artifactId });
    assert.equal(recovered.run.frames![0].graphFrame.nextCompletionSequence, boundary === "intent" ? 3 : 2);
    assert.equal(byAction(recovered.steps, "B").length, 1); assert.equal(recovered.artifacts.length, 1);
    assert.deepEqual((await reopened.withGraph(g => g.advance(start.run.id))).steps, recovered.steps);
  });
});

for (const corruption of ["missing", "duplicate"] as const) test(`graph readonly and recovery reject ${corruption} completion sequence`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "bad sequence", procedure: procedure([action("A"), action("B")]) });
    for (const s of start.steps) await produce(g, start.run.id, s.id, "ok");
    const first = (await g.records.require<Step>("step", start.run.id, start.steps[0].id)).value;
    const row = await g.records.require<Step>("step", start.run.id, start.steps[1].id), value = structuredClone(row.value);
    if (corruption === "missing") delete value.completionSequence; else value.completionSequence = first.completionSequence;
    await g.records.update("step", start.run.id, row, value);
    await assert.rejects(g.snapshot(start.run.id), /completion sequence/);
    await assert.rejects(g.advance(start.run.id), /completion sequence/);
  });
});

for (const afterSave of [false, true]) test(`backlogged same-source completions recover in sequence ${afterSave ? "after" : "before"} dispatch persistence`, async t => {
  const f = await fixture(t);
  // Control allocation through the Store boundary: A1 sorts after A2, with the
  // same timestamp. Persisted trigger position remains the creation authority.
  const createRun = f.service.stores.run.create.bind(f.service.stores.run);
  f.service.stores.run.create = async (...args) => {
    const value = structuredClone(args[2]) as Run;
    const frame = value.frames![0].graphFrame;
    byAction(frame.pendingSteps, "A").forEach((s, i) => {
      const trigger = frame.triggers.find(t => t.stepId === s.id)!;
      s.id = i ? "step-a" : "step-z"; s.createdAt = "2026-10-27T00:00:00.000Z"; trigger.stepId = s.id;
    });
    return createRun(args[0], args[1], value);
  };
  await f.use(async g => {
    const A = action("A"); A.dependencies.push({ tag: "!dependency", from: "START" });
    const start = await g.start({ name: "backlog", procedure: procedure([A, action("B"), action("C", ["A", "B"], 'artifacts.A = "new"')]) });
    const first = await produce(g, start.run.id, "step-z", "old"), second = await produce(g, start.run.id, "step-a", "new");
    assert.ok(first.step.completionSequence! < second.step.completionSequence!);
    // Construct the durable crash precondition directly, without replaying
    // unrelated production: both completions await dispatch, no arrival saved.
    for (const id of [first.step.id, second.step.id]) {
      const row = await g.records.require<Step>("step", start.run.id, id);
      await g.records.update("step", start.run.id, row, { ...row.value, endedAt: "2026-10-27T01:00:00.000Z" });
    }
    const row = await g.records.require<Run>("run", start.run.id, start.run.id), run = structuredClone(row.value);
    const frame = run.frames![0].graphFrame; frame.processedStepIds = []; frame.joins.find(j => j.actionId === "C")!.arrivals = {};
    await g.records.update("run", start.run.id, row, run);
    const update = f.service.stores.run.update.bind(f.service.stores.run); let once = true;
    f.service.stores.run.update = async (...args) => {
      const run = args[2] as Run;
      if (once && run.frames![0].graphFrame.processedStepIds.includes(first.step.id)) {
        once = false; if (afterSave) await update(...args); throw Error("dispatch interruption");
      }
      return update(...args);
    };
    await assert.rejects(g.advance(start.run.id), /dispatch interruption/); f.service.stores.run.update = update;
    const reopened = (await openContextControl(f.root))!;
    await reopened.withGraph(async recovered => {
      const snap = await recovered.advance(start.run.id);
      assert.deepEqual(snap.run.frames![0].graphFrame.processedStepIds, [first.step.id, second.step.id]);
      assert.deepEqual(snap.run.frames![0].graphFrame.joins.find(j => j.actionId === "C")!.arrivals.A, { kind: "artifact", id: second.artifact.id });
      await produce(recovered, start.run.id, byAction(start.steps, "B")[0].id, "b");
      const child = byAction((await recovered.snapshot(start.run.id)).steps, "C");
      assert.equal(child.length, 1); assert.deepEqual(child[0].inputs!.A, [{ kind: "artifact", id: second.artifact.id }]);
    });
  });
});

for (const afterCreate of [false, true]) test(`one dispatch persists multiple same-time reverse-ID Steps and collect keeps creation order across ${afterCreate ? "post-create" : "pre-create"} recovery`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A", "seed"); A.dependencies.push({ tag: "!dependency", from: "seed" });
    const gather: GraphAction = { tag: "!action", id: "gather", description: "Collect", dependencies: [{ tag: "!dependency", from: "gate" }], collect: ["A"] };
    const start = await g.start({ name: "multi pending", procedure: procedure([action("seed"), A, action("gate"), gather]) });
    const updateRun = f.service.stores.run.update.bind(f.service.stores.run);
    f.service.stores.run.update = async (...args) => {
      const run = structuredClone(args[2]) as Run, frame = run.frames![0].graphFrame;
      if (byAction(frame.pendingSteps, "A").length === 2) byAction(frame.pendingSteps, "A").forEach((s, i) => {
        const trigger = frame.triggers.find(t => t.stepId === s.id)!;
        s.id = i ? "step-a" : "step-z"; s.createdAt = "2026-10-27T00:00:00.000Z"; trigger.stepId = s.id;
      });
      return updateRun(args[0], args[1], run, args[3]);
    };
    const create = f.service.stores.step.create.bind(f.service.stores.step); let once = true;
    f.service.stores.step.create = async (...args) => {
      if (once && (args[2] as Step).source?.actionId === "A") { once = false; if (afterCreate) await create(...args); throw Error("multi create interruption"); }
      return create(...args);
    };
    await assert.rejects(produce(g, start.run.id, byAction(start.steps, "seed")[0].id, "seed"), /multi create interruption/);
    const pending = (await g.records.require<Run>("run", start.run.id, start.run.id)).value.frames![0].graphFrame.pendingSteps;
    assert.deepEqual(pending.map(s => s.id), ["step-z", "step-a"]); assert.equal(pending[0].createdAt, pending[1].createdAt);
    f.service.stores.step.create = create; f.service.stores.run.update = updateRun;
    const reopened = (await openContextControl(f.root))!;
    await reopened.withGraph(async recovered => {
      await recovered.advance(start.run.id);
      const second = await produce(recovered, start.run.id, "step-a", "second"), first = await produce(recovered, start.run.id, "step-z", "first");
      await produce(recovered, start.run.id, byAction(start.steps, "gate")[0].id, "gate");
      const snap = await recovered.advance(start.run.id), result = byAction(snap.steps, "gather")[0].artifact;
      assert.deepEqual(result, { mode: "collect", items: { A: [first.artifact.id, second.artifact.id] } });
      assert.equal(byAction(snap.steps, "A").length, 2); assert.deepEqual(snap.run.frames![0].graphFrame.pendingSteps, []);
    });
  });
});

test("graph rejects historical failure states while the shared Step Store still accepts them", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "status isolation", procedure: procedure([action("A")]) });
    const row = await g.records.require<Step>("step", start.run.id, start.steps[0].id);
    await g.records.update("step", start.run.id, row, { ...row.value, status: "cancelled" });
    await assert.rejects(g.snapshot(start.run.id), /graph Step status/);
    await assert.rejects(g.enter(start.run.id, row.value.id), /graph Step status/);
  });
});

test("graph activation creates pending instances; repeated enter preserves the instance and start time", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const first = await g.start({ name: "entry", procedure: procedure([action("A")]) });
    assert.equal(first.steps.length, 1); assert.equal(first.steps[0].status, "pending");
    const entered = await g.enter(first.run.id, first.steps[0].id);
    const again = await g.enter(first.run.id, first.steps[0].id);
    assert.equal(entered.step.status, "running"); assert.deepEqual(again.step, entered.step);
    const done = await produce(g, first.run.id, entered.step.id, "ok");
    assert.equal(done.step.status, "done"); assert.equal(done.snapshot.completeIds[0], done.artifact.id);
    await g.advance(first.run.id); assert.equal((await g.snapshot(first.run.id)).steps.length, 1);
  });
});

test("independent incoming dependencies create two Steps instead of merging their activations", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const C = action("C", "A"); C.dependencies.push({ tag: "!dependency", from: "B" });
    const start = await g.start({ name: "fork", procedure: procedure([action("A"), action("B"), C]) });
    for (const id of ["A", "B"]) await produce(g, start.run.id, byAction(start.steps, id)[0].id, id);
    const snap = await g.snapshot(start.run.id); const children = byAction(snap.steps, "C");
    assert.equal(children.length, 2); assert.notEqual(children[0].id, children[1].id);
    assert.deepEqual(children.map(s => Object.keys(s.inputs!)[0]).sort(), ["A", "B"]);
  });
});

test("a join keeps the latest completion per source and freezes the selected inputs", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.dependencies.push({ tag: "!dependency", from: "seed" });
    const start = await g.start({ name: "join", procedure: procedure([A, action("seed"), action("B"), action("C", ["A", "B"], 'artifacts.A = "new"')]) });
    const old = await produce(g, start.run.id, byAction(start.steps, "A")[0].id, "old");
    await produce(g, start.run.id, byAction(start.steps, "seed")[0].id, "seed");
    const A2 = byAction((await g.snapshot(start.run.id)).steps, "A").find(s => s.status === "pending")!;
    const latest = await produce(g, start.run.id, A2.id, "new");
    await produce(g, start.run.id, byAction(start.steps, "B")[0].id, "b");
    const child = byAction((await g.snapshot(start.run.id)).steps, "C");
    assert.equal(child.length, 1); assert.deepEqual(child[0].inputs!.A, [{ kind: "artifact", id: latest.artifact.id }]);
    assert.notEqual(child[0].inputs!.A[0].id, old.artifact.id);
    const joins = (await g.snapshot(start.run.id)).run.frames![0].graphFrame.joins;
    assert.equal(joins.some(j => j.actionId === "C" && Object.keys(j.arrivals).length), false);
  });
});

test("false conditions consume the activation without creating a target Step", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "false", procedure: procedure([action("A"), action("C", "A", "false")]) });
    await produce(g, start.run.id, start.steps[0].id, "ok"); await g.advance(start.run.id);
    const snap = await g.snapshot(start.run.id);
    assert.equal(byAction(snap.steps, "C").length, 0);
    assert.equal(snap.run.frames![0].graphFrame.processedStepIds.length, 1);
    assert.equal(snap.run.frames![0].graphFrame.triggers.filter(t => t.actionId === "C").length, 1);
    assert.equal((await g.finish(start.run.id)).status, "done");
  });
});

test("nonboolean conditions report an error and never consume the source completion", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "error", procedure: procedure([action("A"), action("C", "A", "1")]) });
    await assert.rejects(produce(g, start.run.id, start.steps[0].id, "ok"), /must be boolean/);
    const snap = await g.snapshot(start.run.id);
    assert.equal(snap.steps[0].status, "done"); assert.equal(byAction(snap.steps, "C").length, 0);
    assert.deepEqual(snap.run.frames![0].graphFrame.processedStepIds, []);
    await assert.rejects(g.advance(start.run.id), /must be boolean/);
  });
});

test("model rejection keeps the producer running and does not save a submitted candidate", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "model", procedure: procedure([action("A")]) }); const id = start.steps[0].id;
    await g.enter(start.run.id, id);
    await assert.rejects(g.report(start.run.id, id, { text: '{}' }));
    const snap = await g.snapshot(start.run.id);
    assert.equal(snap.artifacts.length, 0); assert.equal(snap.steps[0].status, "running"); assert.equal(snap.steps[0].validation?.status, "failed");
  });
});

test("collect completes automatically in persistent creation order despite reverse completion order", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.dependencies.push({ tag: "!dependency", from: "seed" });
    const gather: GraphAction = { tag: "!action", id: "gather", description: "Collect", dependencies: [{ tag: "!dependency", from: "stop" }], collect: ["A"] };
    const start = await g.start({ name: "collect", procedure: procedure([A, action("seed"), action("stop"), gather, action("summary", "gather", "$count(artifacts.A) = 2")]) });
    const A1 = byAction(start.steps, "A")[0];
    await produce(g, start.run.id, byAction(start.steps, "seed")[0].id, "seed");
    const A2 = byAction((await g.snapshot(start.run.id)).steps, "A").find(s => s.id !== A1.id)!;
    const second = await produce(g, start.run.id, A2.id, "second"); const first = await produce(g, start.run.id, A1.id, "first");
    await produce(g, start.run.id, byAction(start.steps, "stop")[0].id, "stop");
    const snap = await g.snapshot(start.run.id); const result = byAction(snap.steps, "gather")[0];
    assert.equal(result.status, "done"); assert.equal(result.artifact?.mode, "collect");
    assert.deepEqual((result.artifact as { items: Record<string, string[]> }).items.A, [first.artifact.id, second.artifact.id]);
    assert.equal(snap.artifacts.length, 4); assert.equal(byAction(snap.steps, "summary").length, 1);
    assert.deepEqual(byAction(snap.steps, "summary")[0].inputs!.A.map(r => r.id), [first.artifact.id, second.artifact.id]);
    await assert.rejects(g.enter(start.run.id, result.id), /collect/);
  });
});

test("collect preserves an empty source array and does not create an aggregate Artifact", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const unused = action("A", "stop", "false");
    const gather: GraphAction = { tag: "!action", id: "gather", description: "Empty collect", dependencies: [{ tag: "!dependency", from: "stop" }], collect: ["A"] };
    const start = await g.start({ name: "empty", procedure: procedure([action("stop"), unused, gather, action("summary", "gather", "$count(artifacts.A) = 0")]) });
    await produce(g, start.run.id, byAction(start.steps, "stop")[0].id, "stop");
    const snap = await g.snapshot(start.run.id);
    assert.deepEqual((byAction(snap.steps, "gather")[0].artifact as { items: object }).items, { A: [] });
    assert.equal(snap.artifacts.length, 1); assert.deepEqual(byAction(snap.steps, "summary")[0].inputs, { A: [] });
  });
});

for (const afterCreate of [false, true]) test(`entry Step recovery preserves its fixed identity ${afterCreate ? "after" : "before"} Store.create`, async t => {
  const f = await fixture(t); const original = f.service.stores.step.create.bind(f.service.stores.step); let once = true;
  f.service.stores.step.create = async (...args) => { if (once) { once = false; if (afterCreate) await original(...args); throw Error("injected Step interruption"); } return original(...args); };
  let runId = "";
  await f.use(async g => {
    await assert.rejects(g.start({ name: "recover", procedure: procedure([action("A")]) }), (error: unknown) => { runId = (error as { details: { runId: string } }).details.runId; return /interruption/.test(String(error)); });
    const raw = (await g.records.require<Run>("run", runId, runId)).value; const expectedId = raw.frames![0].graphFrame.pendingSteps[0].id;
    f.service.stores.step.create = original;
    const snap = await g.advance(runId);
    assert.equal(snap.steps.length, 1); assert.equal(snap.steps[0].id, expectedId); assert.deepEqual(snap.run.frames![0].graphFrame.pendingSteps, []);
    await g.advance(runId); assert.equal((await g.snapshot(runId)).steps.length, 1);
  });
});

const cp: ControlPlaneConfig = { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, acpProviders: {}, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } };
const bindings: RunReviewConfiguration = { reviews: { "runtime-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "runtime-graph::approval": { actorIds: ["human"] } } };

test("submitted candidates do not complete a Step until Human and Runner decisions accept the round", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact!.review = ["approval"];
    const start = await g.start({ name: "review", procedure: procedure([A, action("B", "A")]), controlPlane: cp, reviewConfiguration: bindings });
    const report = await produce(g, start.run.id, start.steps[0].id, "candidate");
    assert.equal(report.step.status, "awaiting_review"); assert.equal(report.snapshot.completeIds.length, 0); assert.equal(byAction(report.snapshot.steps, "B").length, 0);
    const round = report.step.reviewRounds![0];
    const human = await g.submitReview(start.run.id, report.step.id, round.id, "human", "approve");
    assert.equal(human.steps.find(s => s.id === report.step.id)!.status, "awaiting_review");
    const accepted = await g.submitReview(start.run.id, report.step.id, round.id, "runner", "approve");
    assert.equal(accepted.steps.find(s => s.id === report.step.id)!.status, "done"); assert.equal(byAction(accepted.steps, "B").length, 1);
  });
});

test("Review revisions keep the Step identity and create a new immutable Artifact and round", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact!.review = ["approval"];
    const start = await g.start({ name: "revision", procedure: procedure([A]), controlPlane: cp, reviewConfiguration: bindings });
    const first = await produce(g, start.run.id, start.steps[0].id, "first"); const round = first.step.reviewRounds![0];
    await g.submitReview(start.run.id, first.step.id, round.id, "human", "request_changes", [{ id: "fix", body: "Fix it", createdAt: start.run.createdAt, updatedAt: start.run.createdAt }], "Fix it");
    await assert.rejects(g.report(start.run.id, first.step.id, { text: '"new"' }), { code: "REVISION_SUMMARY_REQUIRED" });
    const second = await produce(g, start.run.id, first.step.id, "second", "Fixed");
    assert.equal(second.step.id, first.step.id); assert.notEqual(second.artifact.id, first.artifact.id);
    assert.equal(second.artifact.revisedFrom, first.artifact.id); assert.equal(second.step.reviewRounds!.length, 2);
    const old = (await g.records.require<Artifact>("artifact", start.run.id, first.artifact.id)).value;
    assert.equal(old.content!.payload.content, '"first"');
    await assert.rejects(g.submitReview(start.run.id, first.step.id, round.id, "human", "approve"), { code: "REVIEW_CONFLICT" });
  });
});

for (const boundary of ["artifact-before", "artifact-after", "review-before", "review-after"]) test(`submission recovery preserves Artifact/round identity at ${boundary}`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact!.review = ["approval"];
    const start = await g.start({ name: boundary, procedure: procedure([A]), controlPlane: cp, reviewConfiguration: bindings });
    const stepId = start.steps[0].id; await g.enter(start.run.id, stepId);
    const store = boundary.startsWith("artifact") ? f.service.stores.artifact : f.service.stores.review;
    const original = store.create.bind(store); let once = true;
    store.create = async (...args) => { if (once) { once = false; if (boundary.endsWith("after")) await original(...args); throw Error("submission interruption"); } return original(...args); };
    let artifactId = "";
    await assert.rejects(g.report(start.run.id, stepId, { text: '"candidate"' }), (error: any) => { artifactId = error.details.artifactId; return /interruption/.test(error.message); });
    store.create = original;
    const snapshot = await g.advance(start.run.id);
    assert.equal(snapshot.artifacts.length, 1); assert.equal(snapshot.artifacts[0].id, artifactId);
    assert.equal(snapshot.steps[0].status, "awaiting_review"); assert.equal(snapshot.steps[0].reviewRounds!.length, 1);
    assert.equal(snapshot.reviews.length, 1); assert.equal(snapshot.reviews[0].artifactId, artifactId);
    assert.deepEqual(snapshot.completeIds, []);
    await g.advance(start.run.id); assert.equal((await g.snapshot(start.run.id)).reviews.length, 1);
  });
});

test("readonly graph snapshots reject corrupt trigger and completion identities", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const start = await g.start({ name: "corrupt", procedure: procedure([action("A"), action("B")]) });
    const step = start.steps[0], row = await g.records.require<Step>("step", start.run.id, step.id);
    await g.records.update("step", start.run.id, row, { ...row.value, source: { ...step.source!, actionId: step.source!.actionId === "A" ? "B" : "A" } });
    await assert.rejects(g.snapshot(start.run.id), /matching creation trigger/);
  });
});

test("partial joins prevent finish and terminal graph archive/restore preserves all evidence", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const B = action("B", "A", "false");
    const start = await g.start({ name: "partial", procedure: procedure([action("A"), B, action("C", ["A", "B"])]) });
    await produce(g, start.run.id, start.steps[0].id, "A");
    await assert.rejects(g.finish(start.run.id), { code: "GRAPH_INCOMPLETE" });
    await g.abandon(start.run.id, "Human cancelled");
  });
  const run = (await f.service.listRuns())[0]; const before = await f.service.snapshot(run.id);
  await f.service.archive(run.id); await f.service.archive(run.id, false);
  const after = await f.service.snapshot(run.id);
  assert.equal(after.run.status, "abandoned"); assert.deepEqual(after.steps, before.steps); assert.deepEqual(after.artifacts, before.artifacts);
});

for (const materials of [[], ["资料甲", "资料乙"]]) test(`published materials example completes with ${materials.length} materials and automatic collect`, async t => {
  const { readFile } = await import("node:fs/promises"); const { parseMemoryYaml } = await import("../src/memory/yaml.js");
  const document = (await readFile(new URL("../docs/procedure-graph-syntax.md", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const yaml = [...document.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]).find(text => text.startsWith("!procedure\n") && text.includes("mode: graph\n"))!;
  const definition = parseMemoryEntity("procedures", parseMemoryYaml(yaml)) as GraphProcedureMemory;
  const f = await fixture(t);
  await f.use(async g => {
    let snapshot = await g.start({ name: "materials", procedure: definition, reviewConfiguration: { reviews: { "analyze-materials#actions[analyze]": { policy: "artifact_acceptance.unanimous" } }, slots: { "analyze-materials::领域专家": { skip: true } } } });
    const submit = async (step: Step, value: unknown, markdown = false) => { await g.enter(snapshot.run.id, step.id); const result = await g.report(snapshot.run.id, step.id, { text: markdown ? String(value) : JSON.stringify(value) }); snapshot = result.snapshot; return result; };
    await submit(snapshot.steps[0], { remaining: materials });
    for (let iteration = 0; iteration < 10; iteration++) {
      const step = g.ready(snapshot)[0]; assert.ok(step);
      if (step.source!.actionId === "summarize") { await submit(step, materials.length ? "分析完成" : "本次没有资料", true); break; }
      const ref = Object.values(step.inputs!).flat()[0];
      const input = JSON.parse(Buffer.from((await g.readArtifact(snapshot.run.id, ref.id)).bytes).toString("utf8"));
      if (step.source!.actionId === "check") await submit(step, { remaining: input.remaining, hasMore: input.remaining.length > 0 });
      else await submit(step, { material: input.remaining[0], finding: "结论", remaining: input.remaining.slice(1) });
    }
    const analyses = byAction(snapshot.steps, "analyze"); assert.equal(analyses.length, materials.length);
    const aggregate = byAction(snapshot.steps, "gather")[0]; assert.equal(aggregate.status, "done");
    assert.equal((aggregate.artifact as { items: Record<string, string[]> }).items.analyze.length, materials.length);
    assert.ok(snapshot.steps.every(s => s.status === "done")); assert.equal((await g.finish(snapshot.run.id)).status, "done");
  });
});

test("graph preflight rejects Actor ids that collide with the Runner permission identity", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    await assert.rejects(g.start({ name: "identity collision", procedure: procedure([action("A")]), controlPlane: { ...cp, actors: { runner: cp.actors.human } } }), /Runner permission identity/);
    assert.deepEqual((await f.service.stores.run.list({}, { limit: 1000 })).items, []);
  });
});

test("binding updates apply only to new rounds and reject undeclared slots or Actors", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact!.review = ["approval"];
    const config = { ...cp, actors: { ...cp.actors, replacement: { ...cp.actors.human, name: "Replacement" } } };
    const start = await g.start({ name: "bindings", procedure: procedure([A]), controlPlane: config, reviewConfiguration: bindings });
    const first = await produce(g, start.run.id, start.steps[0].id, "first");
    await assert.rejects(g.updateBinding(start.run.id, "toString", { skip: true }), { code: "NOT_FOUND" });
    await assert.rejects(g.updateBinding(start.run.id, "runtime-graph::approval", { actorIds: ["constructor"] }), { code: "PERMISSION_DENIED" });
    await g.updateBinding(start.run.id, "runtime-graph::approval", { actorIds: ["replacement"] });
    await g.submitReview(start.run.id, first.step.id, first.step.reviewRounds![0].id, "human", "request_changes", [{ id: "revise", body: "Revise", createdAt: start.run.createdAt, updatedAt: start.run.createdAt }], "Revise");
    const revised = await produce(g, start.run.id, first.step.id, "revised", "Addressed review");
    assert.deepEqual(Object.keys(revised.step.reviewRounds![0].reviewConfig.reviewers), ["human"]);
    assert.deepEqual(Object.keys(revised.step.reviewRounds![1].reviewConfig.reviewers), ["replacement"]);
  });
});
