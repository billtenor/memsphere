import assert from "node:assert/strict";
import test from "node:test";
import { openContextControl } from "../src/project/context-control.js";
import { businessFixture } from "./helpers/business-data.js";
import { textContent } from "../src/context_control/types.js";

test("outputs track parallel leaves, revisions, real dependencies and manual roots", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const r = await s.start("roots"); const a = (await s.report(r.id, { name: "A", content: textContent("A") })).artifact;
  const b = (await s.report(r.id, { name: "B", content: textContent("B"), dependencies: [{ kind: "artifact", id: a.id }] })).artifact;
  const c = (await s.report(r.id, { name: "C", content: textContent("C") })).artifact;
  assert.deepEqual(new Set(await s.outputs(r.id)), new Set([b.id, c.id]));
  const c2 = (await s.report(r.id, { revisedFrom: c.id, content: textContent("C2") })).artifact;
  assert.deepEqual(new Set(await s.outputs(r.id)), new Set([b.id, c2.id]));
  await s.updateOutputs(r.id, [], [b.id]);
  await s.report(r.id, { name: "unrelated", content: textContent("D") });
  assert.ok(!(await s.outputs(r.id)).includes(b.id));
  await s.updateOutputs(r.id, [b.id, b.id], []); await s.updateOutputs(r.id, [], [a.id]);
  assert.ok((await s.outputs(r.id)).includes(b.id));
  await assert.rejects(s.updateOutputs(r.id, [a.id], [a.id]), { code: "INVALID_ARGUMENT" });
  await assert.rejects(s.updateOutputs(r.id, ["missing"], []), { code: "NOT_FOUND" });
});

for (const read of ["snapshot", "listRuns", "findRun", "outputs"] as const) {
  test(`${read} repairs the pending Step before deriving outputs and fails clearly while Step storage is broken`, async t => {
    const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
    const r = await s.start("recovery"); const update = s.stores.step.update.bind(s.stores.step);
    s.stores.step.update = async () => { throw Error("injected completion failure"); };
    await assert.rejects(s.report(r.id, { name: "A", content: textContent("A") }), (error: any) => !!error.details.artifactId);
    const request = () => read === "listRuns" ? s.listRuns() : s[read](r.id);
    await assert.rejects(request(), { code: "RECOVERY_REQUIRED" });
    s.stores.step.update = update; await request();
    const snap = await s.snapshot(r.id); assert.equal(snap.completeIds.length, 1); assert.deepEqual(snap.outputArtifactIds, snap.completeIds);
    await s.updateOutputs(r.id, [], snap.completeIds); await request(); assert.deepEqual(await s.outputs(r.id), []);
  });
}

test("reports, revisions, read recovery and parallel producers never update the Run record", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!;
  const run = await s.start("independent production");
  const before = await s.stores.run.get({}, run.id);
  s.stores.run.update = async () => { throw Error("unexpected Run write during production"); };
  const a = (await s.report(run.id, { name: "A", content: textContent("A") })).artifact;
  const other = (await openContextControl(f.root))!;
  const [b, c] = await Promise.all([
    s.report(run.id, { name: "B", content: textContent("B"), dependencies: [{ kind: "artifact", id: a.id }] }),
    other.report(run.id, { name: "C", content: textContent("C") })
  ]);
  const c2 = (await s.report(run.id, { revisedFrom: c.artifact.id, content: textContent("C2") })).artifact;
  const complete = s.stores.step.update.bind(s.stores.step);
  s.stores.step.update = async () => { throw Error("interrupted Step"); };
  await assert.rejects(s.report(run.id, { name: "D", content: textContent("D") }), /interrupted Step/);
  s.stores.step.update = complete;
  const snap = await s.snapshot(run.id);
  assert.equal(snap.completeIds.length, 5);
  assert.ok(snap.outputArtifactIds.includes(b.artifact.id)); assert.ok(snap.outputArtifactIds.includes(c2.id));
  assert.ok(!snap.outputArtifactIds.includes(a.id)); assert.ok(!snap.outputArtifactIds.includes(c.artifact.id));
  assert.deepEqual(await s.stores.run.get({}, run.id), before);
  assert.equal(Object.hasOwn(snap.run, "outputArtifactIds"), false);
  assert.equal(Object.hasOwn(snap.run, "outputOverrides"), false);
});

test("only explicit edits persist overrides, manual choices survive derivation, and finish freezes exact roots", async t => {
  const f = await businessFixture(t, {}), s = (await openContextControl(f.root, true))!, r = await s.start("overrides");
  const a = (await s.report(r.id, { name: "A", content: textContent("A") })).artifact;
  const b = (await s.report(r.id, { name: "B", content: textContent("B"), dependencies: [{ kind: "artifact", id: a.id }] })).artifact;
  await s.updateOutputs(r.id, [a.id], [b.id]);
  const edited = await s.stores.run.get({}, r.id);
  assert.deepEqual((edited!.value as typeof r).outputOverrides, { addedArtifactIds: [a.id], removedArtifactIds: [b.id] });
  await s.updateOutputs(r.id, [a.id], [b.id]); assert.equal((await s.stores.run.get({}, r.id))!.revision, edited!.revision);
  const a2 = (await s.report(r.id, { revisedFrom: a.id, content: textContent("A2") })).artifact;
  const snap = await s.snapshot(r.id);
  assert.deepEqual(new Set(snap.outputArtifactIds), new Set([a.id, a2.id]));
  assert.deepEqual(await s.stores.run.get({}, r.id), edited);
  // Selecting an earlier complete Artifact is legitimate; other graph leaves stay hidden after finish.
  await s.finish(r.id, [b.id]); const final = await s.stores.run.get({}, r.id);
  assert.deepEqual(await s.outputs(r.id), [b.id]);
  await s.finish(r.id, [b.id]); assert.deepEqual(await s.stores.run.get({}, r.id), final);
  await assert.rejects(s.finish(r.id, [a.id]), { code: "RUN_FINISHED" });
  await assert.rejects(s.updateOutputs(r.id, [a.id], []), { code: "RUN_FINISHED" });
  assert.equal(Object.hasOwn(final!.value as object, "outputArtifactIds"), false);
});
