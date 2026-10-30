import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { withNativeFileLock } from "../src/file-lock.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import { businessFixture } from "./helpers/business-data.js";

async function runLock(root: string, runId: string) {
  await mkdir(join(root, ".runtime", "context-control"), { recursive: true });
  return join(root, ".runtime", "context-control", `${createHash("sha256").update(runId).digest("hex")}.lock`);
}

// Hold a write after its read so a second service can commit the same Run first.
async function expectRunCasConflict(service: NonNullable<Awaited<ReturnType<typeof openContextControl>>>, stale: () => Promise<unknown>, winner: () => Promise<unknown>) {
  const store = service.stores.run, update = store.update.bind(store);
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  store.update = async (...args) => { started(); await gate; return update(...args); };
  const rejected = assert.rejects(stale(), { code: "REVISION_CONFLICT" });
  try { await entered; await winner(); }
  finally { release(); store.update = update; }
  await rejected;
}

test("exploration finish bypasses the Run lock without recovering incomplete records and stays idempotent", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  const run = await service.start("readonly finish");
  const a = (await service.report(run.id, { name: "a", content: textContent("a") })).artifact;
  const b = (await service.report(run.id, { name: "b", content: textContent("b") })).artifact;
  const incomplete = await service.createArtifact(run.id, { name: "incomplete" });
  const store = service.stores.step, update = store.update.bind(store);
  store.update = async () => { throw Error("incomplete Step"); };
  try { await assert.rejects(service.report(run.id, { target: incomplete.id, content: textContent("saved") }), /incomplete Step/); }
  finally { store.update = update; }
  const key = `${run.id}/${incomplete.stepId}`, before = await store.get({}, key);
  await withNativeFileLock(await runLock(root, run.id), async () => {
    await assert.rejects(service.finish(run.id, [incomplete.id]), { code: "INCOMPLETE_ARTIFACT" });
    assert.deepEqual(await store.get({}, key), before);
    assert.equal(((await service.stores.run.get({}, run.id))!.value as { status: string }).status, "running");
    const finished = await service.finish(run.id, [a.id]);
    assert.equal(finished.status, "done");
    assert.deepEqual((await service.snapshot(run.id)).outputArtifactIds, [a.id]);
    const row = await service.stores.run.get({}, run.id);
    assert.deepEqual(await service.finish(run.id, [a.id, a.id]), finished);
    assert.deepEqual(await service.finish(run.id), finished);
    assert.deepEqual(await service.stores.run.get({}, run.id), row);
    await assert.rejects(service.finish(run.id, [b.id]), { code: "RUN_FINISHED" });
    assert.deepEqual(await store.get({}, key), before);
  });
});

test("finish accepts the same concurrent completion but rejects stale decisions and output selection", { timeout: 8000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!, other = (await openContextControl(root))!;
  for (const kind of ["same", "different", "abandon", "outputs"] as const) {
    const run = await service.start(`finish CAS ${kind}`);
    const a = (await service.report(run.id, { name: "a", content: textContent("a") })).artifact;
    const b = (await service.report(run.id, { name: "b", content: textContent("b") })).artifact;
    const store = service.stores.run, update = store.update.bind(store);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.update = async (...args) => { started(); await gate; return update(...args); };
    // Default finish must retain the revision from which its output selection was read.
    const stale = service.finish(run.id, kind === "outputs" ? undefined : [a.id]);
    const checked = kind === "same" ? stale : assert.rejects(stale, { code: "REVISION_CONFLICT" });
    let winner;
    try {
      await entered;
      if (kind === "abandon") await other.abandon(run.id, "Human stopped");
      else if (kind === "outputs") await other.updateOutputs(run.id, [b.id], [a.id]);
      else await other.finish(run.id, [kind === "same" ? a.id : b.id]);
      winner = await other.stores.run.get({}, run.id);
    } finally { release(); store.update = update; }
    const result = await checked;
    assert.deepEqual(await service.stores.run.get({}, run.id), winner);
    if (kind === "same") assert.deepEqual(result, winner!.value);
  }
});

test("exploration abandonment bypasses the Run lock without recovery and retains Run CAS", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!, other = (await openContextControl(root))!;
  const run = await service.start("abandon CAS");
  const steps = service.stores.step, create = steps.create.bind(steps);
  let orphanKey = "";
  steps.create = async (_context, key) => { orphanKey = key; throw Error("interrupted draft"); };
  try { await assert.rejects(service.createArtifact(run.id, { name: "orphan" }), /interrupted draft/); }
  finally { steps.create = create; }
  assert.ok(orphanKey); assert.equal(await steps.get({}, orphanKey), undefined);
  const artifacts = await service.stores.artifact.list({});
  const saved = await service.stores.artifact.get({}, artifacts.items[0].id);
  await withNativeFileLock(await runLock(root, run.id), async () => {
    await expectRunCasConflict(service,
      () => service.abandon(run.id, "stale reason", "cli"),
      () => other.abandon(run.id, "Human stopped", "view"));
    const row = (await service.findRun(run.id))!;
    assert.equal(row.status, "abandoned"); assert.ok(row.endedAt);
    assert.deepEqual(row.abandonment, { reason: "Human stopped", source: "view" });
    assert.equal(await steps.get({}, orphanKey), undefined);
    assert.deepEqual(await service.stores.artifact.get({}, artifacts.items[0].id), saved);
    await assert.rejects(service.abandon(run.id, "repeat"), { code: "RUN_FINISHED" });
    await assert.rejects(service.report(run.id, { name: "late", content: textContent("late") }), { code: "RUN_FINISHED" });
  });
  // A stale abandonment must also fail if finishing wins the Run record first.
  const finishing = await service.start("finish wins");
  await expectRunCasConflict(service, () => service.abandon(finishing.id), () => other.finish(finishing.id));
  assert.equal((await service.findRun(finishing.id))?.status, "done");
});

test("archive and restore bypass the Run lock and reject stale concurrent Run writes", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  const other = (await openContextControl(root))!;
  const run = await service.start("archive CAS"); await service.finish(run.id);
  await withNativeFileLock(await runLock(root, run.id), async () => {
    await expectRunCasConflict(service, () => service.archive(run.id), () => other.archive(run.id));
    assert.equal((await service.findRun(run.id))?.archived, true);
    await service.archive(run.id, false);
    assert.equal((await service.findRun(run.id))?.archived, false);
  });
});

test("output updates bypass the Run lock, retain CAS and do not recover incomplete submissions", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  const other = (await openContextControl(root))!;
  const run = await service.start("output CAS");
  const a = (await service.report(run.id, { name: "a", content: textContent("a") })).artifact;
  const b = (await service.report(run.id, { name: "b", content: textContent("b") })).artifact;
  const pending = await service.createArtifact(run.id, { name: "interrupted" });
  const store = service.stores.step, update = store.update.bind(store);
  store.update = async () => { throw Error("interrupted completion"); };
  try { await assert.rejects(service.report(run.id, { target: pending.id, content: textContent("saved") }), /interrupted completion/); }
  finally { store.update = update; }
  const stepKey = `${run.id}/${pending.stepId}`;
  const before = await store.get({}, stepKey);
  assert.equal((before!.value as { status: string }).status, "running");
  await withNativeFileLock(await runLock(root, run.id), async () => {
    await expectRunCasConflict(service,
      () => service.updateOutputs(run.id, [a.id], [b.id]),
      () => other.updateOutputs(run.id, [b.id], [a.id]));
    await assert.rejects(service.updateOutputs(run.id, [pending.id], []), { code: "INCOMPLETE_ARTIFACT" });
    assert.deepEqual(await store.get({}, stepKey), before);
    const row = await service.stores.run.get({}, run.id);
    assert.deepEqual((row!.value as { outputOverrides: unknown }).outputOverrides, { addedArtifactIds: [b.id], removedArtifactIds: [a.id] });
    assert.deepEqual(await service.updateOutputs(run.id, [a.id], [b.id]), [a.id]);
  });
  assert.deepEqual(await store.get({}, stepKey), before);
  // Explicit status recovery still completes the original durable submission.
  const recovered = await service.snapshot(run.id);
  assert.equal(recovered.steps.find(s => s.id === pending.stepId)?.status, "done");
  assert.equal(recovered.artifacts.find(item => item.id === pending.id)?.id, pending.id);
  await service.finish(run.id);
  await assert.rejects(service.updateOutputs(run.id, [b.id], []), { code: "RUN_FINISHED" });
});

test("draft creation writes only its own records without a Run lock or recovering other drafts", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  const other = (await openContextControl(root))!;
  const run = await service.start("independent drafts");
  const source = (await service.report(run.id, { name: "original", content: textContent("original") })).artifact;
  const store = service.stores.step, create = store.create.bind(store);
  let orphanKey = "";
  store.create = async (_context, key) => { orphanKey = key; throw Error("interrupted Step creation"); };
  try { await assert.rejects(service.createArtifact(run.id, { name: "orphan" }), /interrupted Step creation/); }
  finally { store.create = create; }
  assert.ok(orphanKey); assert.equal(await store.get({}, orphanKey), undefined);
  const runBefore = await service.stores.run.get({}, run.id);
  // If draft creation tries either full-Run scan, fail before it can repair the orphan.
  const artifacts = service.stores.artifact, list = artifacts.list.bind(artifacts);
  artifacts.list = async () => { throw Error("unexpected full Run scan"); };
  let created;
  try {
    created = await withNativeFileLock(await runLock(root, run.id), () => Promise.all([
      service.createArtifact(run.id, { revisedFrom: source.id, tags: ["revision"] }),
      other.createArtifact(run.id, { name: "independent" }),
    ]));
  } finally { artifacts.list = list; }
  assert.notEqual(created[0].id, created[1].id);
  assert.notEqual(created[0].stepId, created[1].stepId);
  assert.equal(created[0].name, source.name); assert.equal(created[0].revisedFrom, source.id);
  assert.ok(created[0].tags.includes("revision"));
  for (const artifact of created) {
    const step = (await store.get({}, `${run.id}/${artifact.stepId}`))!.value as { status: string; artifact: { id: string } };
    assert.equal(step.status, "running"); assert.equal(step.artifact.id, artifact.id);
  }
  assert.deepEqual(await service.stores.run.get({}, run.id), runBefore);
  assert.equal(await store.get({}, orphanKey), undefined);
  const recovered = await service.snapshot(run.id);
  const orphan = recovered.artifacts.find(a => a.name === "orphan")!;
  assert.equal(`${run.id}/${orphan.stepId}`, orphanKey);
  assert.equal(recovered.steps.find(s => s.id === orphan.stepId)?.artifact?.id, orphan.id);
  await service.finish(run.id);
  await assert.rejects(service.createArtifact(run.id, { name: "late" }), { code: "RUN_FINISHED" });
});

test("reports bypass the Run lock and resolve tag dependencies without recovering unrelated submissions", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!, other = (await openContextControl(root))!;
  const run = await service.start("targeted report");
  const source = (await service.report(run.id, { name: "source", tags: ["seed"], content: textContent("source") })).artifact;
  const incomplete = await service.createArtifact(run.id, { name: "incomplete", tags: ["seed"] });
  const store = service.stores.step, update = store.update.bind(store);
  store.update = async () => { throw Error("incomplete Step"); };
  try { await assert.rejects(service.report(run.id, { target: incomplete.id, content: textContent("saved") }), /incomplete Step/); }
  finally { store.update = update; }
  const incompleteKey = `${run.id}/${incomplete.stepId}`, before = await store.get({}, incompleteKey);
  const target = await service.createArtifact(run.id, { name: "target" });
  const runBefore = await service.stores.run.get({}, run.id);
  await withNativeFileLock(await runLock(root, run.id), async () => {
    const results = await Promise.all([
      service.report(run.id, { target: target.id, dependsOn: ["tag:seed"], content: textContent("target") }),
      other.report(run.id, { name: "direct", dependsOn: ["tag:seed"], content: textContent("direct") }),
    ]);
    for (const result of results) {
      assert.equal(result.step.status, "done");
      assert.deepEqual(result.artifact.dependencies, [{ kind: "artifact", id: source.id }]);
    }
    assert.notEqual(results[0].step.id, results[1].step.id);
    assert.deepEqual(await store.get({}, incompleteKey), before);
    await assert.rejects(service.report(run.id, { name: "invalid dependency", dependencies: [{ kind: "artifact", id: incomplete.id }], content: textContent("invalid") }), { code: "INCOMPLETE_ARTIFACT" });
  });
  assert.deepEqual(await service.stores.run.get({}, run.id), runBefore);
  assert.deepEqual(await store.get({}, incompleteKey), before);
  assert.equal((await service.snapshot(run.id)).steps.find(s => s.id === incomplete.stepId)?.status, "done");
});

test("report preserves Artifact and Step CAS conflicts and recovers a durable submission without losing reads", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!, other = (await openContextControl(root))!;
  const run = await service.start("report CAS");
  for (const entity of ["artifact", "step"] as const) {
    const target = await service.createArtifact(run.id, { name: entity });
    const store = service.stores[entity], update = store.update.bind(store);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.update = async (...args) => { started(); await gate; return update(...args); };
    const conflict = assert.rejects(service.report(run.id, { target: target.id, content: textContent("first") }), { code: "REVISION_CONFLICT" });
    try {
      await entered;
      if (entity === "artifact") await other.report(run.id, { target: target.id, content: textContent("winner") });
      else await other.productionReads(run.id, target.stepId, { "external:source": { readAt: new Date().toISOString() } });
    } finally { release(); store.update = update; }
    await conflict;
    const saved = (await service.stores.artifact.get({}, `${run.id}/${target.id}`))!.value as { content: { payload: { content: string } } };
    assert.equal(saved.content.payload.content, entity === "artifact" ? "winner" : "first");
    const recovered = (await service.snapshot(run.id)).steps.find(s => s.id === target.stepId)!;
    assert.equal(recovered.status, "done");
    if (entity === "step") assert.ok(recovered.reads?.["external:source"]);
  }
});

test("independent exploration record writes complete while the same Run lock is held", { timeout: 5000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  const run = await service.start("records");
  const submitted = await service.report(run.id, { name: "source", content: textContent("body") });
  const drafts = await Promise.all([service.createArtifact(run.id, { name: "a" }), service.createArtifact(run.id, { name: "b" })]);
  await withNativeFileLock(await runLock(root, run.id), async () => {
    const results = await Promise.all([
      service.tag(run.id, submitted.artifact.id, ["tag"]),
      service.addExternal(run.id, "source", { content: textContent("external") }),
      service.review(run.id, submitted.artifact.id, "human", ["feedback"]),
      ...drafts.map(draft => service.recordRead(run.id, draft.id, { kind: "artifact", id: submitted.artifact.id })),
    ]);
    assert.ok(results[0].tags.includes("tag"));
    assert.deepEqual(results.slice(3), [[], []]);
  });
  const snapshot = await service.snapshot(run.id);
  assert.equal(snapshot.externals.length, 1);
  assert.equal(snapshot.reviews.length, 1);
  for (const draft of drafts) assert.ok(snapshot.steps.find(s => s.id === draft.stepId)?.reads?.[`artifact:${submitted.artifact.id}`]);
});

test("Graph reads, Step entry, personal Reviews and dispositions bypass the Run lock; same-record writes retain CAS", { timeout: 10000 }, async t => {
  const { root } = await businessFixture(t, {});
  const service = (await openContextControl(root, true))!;
  await service.withGraph(async g => {
    const start = await g.start({ name: "independent graph", procedure: {
      tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["lock-graph"], defines: ["Independent Steps"],
      actions: ["A", "B"].map(id => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: id, model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" }, review: ["approval"] } })),
    }, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: {
      a: { kind: "human", name: "A", permissions: ["artifact.read", "decision.assess"] },
      b: { kind: "human", name: "B", permissions: ["artifact.read", "decision.assess"] },
    } }, reviewConfiguration: { reviews: { "lock-graph#actions[A]": { policy: "artifact_acceptance.unanimous" }, "lock-graph#actions[B]": { policy: "artifact_acceptance.unanimous" } }, slots: { "lock-graph::approval": { actorIds: ["a", "b"] } } } });
    const runId = start.run.id;
    const other = (await openContextControl(root))!;
    await withNativeFileLock(await runLock(root, runId), async () => {
      await expectRunCasConflict(service,
        () => g.updateBinding(runId, "lock-graph::approval", { actorIds: ["a"] }),
        () => other.withGraph(runtime => runtime.updateBinding(runId, "lock-graph::approval", { actorIds: ["b"] })));
      assert.deepEqual((await g.bindingSnapshot(runId)).bindings["lock-graph::approval"], { actorIds: ["b"] });
      await g.updateBinding(runId, "lock-graph::approval", { actorIds: ["a", "b"] });
    });
    await withNativeFileLock(await runLock(root, runId), async () => {
      const entered = await Promise.all([...start.steps, start.steps[0]].map(s => g.enter(runId, s.id)));
      assert.ok(entered.every(r => r.step.status === "running"));
      assert.equal(entered[0].step.startedAt, entered[2].step.startedAt);
    });
    const reports = [];
    for (const step of start.steps) reports.push(await g.report(runId, step.id, { text: step.id }));
    const first = reports[0], round = first.step.reviewRounds![0].id;
    // One personal Review is paused between reading and CAS. Another actor must proceed.
    let resume!: () => void, started!: () => void;
    const paused = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const blocked = g.mutateReview(runId, first.step.id, round, "a", async value => {
      value.comments = [{ id: "stale", body: "stale", createdAt: new Date().toISOString() }];
      started(); await gate;
    });
    const conflict = assert.rejects(blocked, { code: "REVISION_CONFLICT" });
    await paused;
    try {
      await withNativeFileLock(await runLock(root, runId), async () => {
        assert.equal((await service.findRun(runId))?.id, runId);
        assert.equal((await service.snapshot(runId)).steps.length, 2);
        assert.equal((await g.bindingSnapshot(runId)).runId, runId);
        const selected = await g.reviewSnapshot(runId, first.step.id, round);
        assert.equal(selected.steps[0].id, first.step.id);
        assert.ok(selected.reviews.some(r => r.reviewer.actorId === "a"));
        assert.equal(Buffer.from((await service.readArtifact(runId, first.artifact.id)).bytes).toString(), first.step.id);
        await g.mutateReview(runId, first.step.id, round, "b", async value => { value.comments = [{ id: "b", body: "B", createdAt: new Date().toISOString() }]; });
        // A competing write to the same record wins; the paused stale write must fail.
        await g.mutateReview(runId, first.step.id, round, "a", async value => { value.comments = [{ id: "a", body: "A", createdAt: new Date().toISOString() }]; });
      });
    } finally { resume(); }
    await conflict;
    // Prepare submitted records outside the busy-lock check, then update only their own rows.
    for (const report of reports) {
      const roundId = report.step.reviewRounds![0].id;
      await g.mutateReview(runId, report.step.id, roundId, "a", async value => {
        value.status = "submitted"; value.endedAt = new Date().toISOString(); value.vote = { value: "approve" };
        value.attempts = [{ id: "attempt", createdAt: value.createdAt, completion: { at: value.endedAt, kind: "completed" } }];
        value.comments = [{ id: "comment", body: "suggestion", severity: "suggestion", createdAt: value.createdAt }];
      });
    }
    await withNativeFileLock(await runLock(root, runId), async () => {
      await Promise.all(reports.flatMap(report => {
        const roundId = report.step.reviewRounds![0].id;
        return [g.recordReviewStop(runId, report.step.id, roundId, "a", "attempt", "done"),
          g.resolveComment(runId, report.step.id, roundId, { commentId: "comment", value: "accepted-followup", note: "follow up" })];
      }));
    });
    const snapshot = await g.snapshot(runId);
    assert.ok(snapshot.steps.every(s => s.reviewRounds![0].resolutions?.length === 1));
    assert.ok(snapshot.reviews.filter(r => r.reviewer.actorId === "a").every(r => r.attempts![0].completion?.stopReason === "done"));
  });
});
