import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { withNativeFileLock } from "../src/file-lock.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
import type { GraphRuntime } from "../src/context_control/graph-runtime.js";
import type { Run, Step } from "../src/context_control/types.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import { businessFixture } from "./helpers/business-data.js";

type PreparedFixture = Awaited<ReturnType<typeof businessFixture>> & {
  service: NonNullable<Awaited<ReturnType<typeof openContextControl>>>;
};
const fixtures = new Map<string, PreparedFixture>();
beforeEach(async t => {
  const f = await businessFixture(t, {});
  const service = (await openContextControl(f.root, true))!;
  fixtures.set(t.name, { ...f, service });
  t.after(() => { fixtures.delete(t.name); });
});
function preparedFixture(t: TestContext) { return fixtures.get(t.name)!; }

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

test("findRun and listRuns are readonly under a held Run lock while native status still recovers", { timeout: 10000 }, async t => {
  const f = preparedFixture(t);
  const service = preparedFixture(t).service;
  const run = await service.start("readonly lookup"), other = await service.start("other Run");
  const steps = service.stores.step, create = steps.create.bind(steps);
  let missingKey = "";
  steps.create = async (_context, key) => { missingKey = key; throw Error("interrupted draft"); };
  try { await assert.rejects(service.createArtifact(run.id, { name: "unfinished" }), /interrupted draft/); }
  finally { steps.create = create; }
  const before = await service.stores.run.get({}, run.id);
  const artifacts = await service.stores.artifact.list({});
  const saved = await service.stores.artifact.get({}, artifacts.items[0].id);
  await withNativeFileLock(await runLock(f.root, run.id), async () => {
    assert.deepEqual(await service.findRun(run.id), run);
    assert.equal(await service.findRun("missing"), undefined);
    assert.deepEqual((await service.listRuns()).map(r => r.id).sort(), [run.id, other.id].sort());
    assert.equal(await steps.get({}, missingKey), undefined);
    assert.deepEqual(await service.stores.run.get({}, run.id), before);
    assert.deepEqual(await service.stores.artifact.get({}, artifacts.items[0].id), saved);
  });
  // Invoke the current source CLI without rebuilding the running daemon's dist.
  const result = await promisify(execFile)(process.execPath, [
    "--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
    "--project", "test-project", "run", "status", "--run", run.id, "--output", "json",
  ], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home } });
  const status = JSON.parse(result.stdout);
  const step = status.steps.find((s: { id: string }) => `${run.id}/${s.id}` === missingKey);
  assert.equal(step.status, "running");
  assert.equal(step.artifact.id, (saved!.value as { id: string }).id);
  assert.deepEqual(await service.stores.run.get({}, run.id), before);
});

test("exploration recovery bypasses the Run lock and preserves concurrent Step edits with CAS", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
  const run = await service.start("recovery CAS"), target = await service.createArtifact(run.id, { name: "pending" });
  const store = service.stores.step, update = store.update.bind(store);
  store.update = async () => { throw Error("interrupted submission"); };
  try { await assert.rejects(service.report(run.id, { target: target.id, content: textContent("saved") }), /interrupted submission/); }
  finally { store.update = update; }
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; }), gate = new Promise<void>(r => { release = r; });
  store.update = async (...args) => { started(); await gate; return update(...args); };
  const rejected = assert.rejects(service.snapshot(run.id), (error: unknown) => {
    const e = error as { code: string; cause: { code: string } };
    return e.code === "RECOVERY_REQUIRED" && e.cause.code === "REVISION_CONFLICT";
  });
  try {
    await entered;
    await other.productionReads(run.id, target.stepId, { "external:source": { readAt: new Date().toISOString() } });
  } finally { release(); store.update = update; }
  await rejected;
  await withNativeFileLock(await runLock(root, run.id), async () => {
    const recovered = await service.snapshot(run.id), step = recovered.steps.find(s => s.id === target.stepId)!;
    assert.equal(step.status, "done"); assert.ok(step.reads?.["external:source"]);
    assert.equal(Buffer.from((await service.readArtifact(run.id, target.id)).bytes).toString(), "saved");
  });
});

test("concurrent recovery creates one missing Step and a retry reuses its identity", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
  const run = await service.start("recovery create"), store = service.stores.step, create = store.create.bind(store);
  store.create = async () => { throw Error("missing Step"); };
  try { await assert.rejects(service.createArtifact(run.id, { name: "draft" }), /missing Step/); }
  finally { store.create = create; }
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; }), gate = new Promise<void>(r => { release = r; });
  store.create = async (...args) => { started(); await gate; return create(...args); };
  const rejected = assert.rejects(service.snapshot(run.id), (error: unknown) => {
    const e = error as { code: string; cause: { code: string } };
    return e.code === "RECOVERY_REQUIRED" && e.cause.code === "ALREADY_EXISTS";
  });
  try { await entered; await other.snapshot(run.id); }
  finally { release(); store.create = create; }
  await rejected;
  const recovered = await service.snapshot(run.id);
  assert.equal(recovered.steps.length, 1); assert.equal(recovered.artifacts.length, 1);
  assert.equal(recovered.artifacts[0].stepId, recovered.steps[0].id);
});

test("exploration finish bypasses the Run lock without recovering incomplete records and stays idempotent", { timeout: 5000 }, async t => {
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service, other = (await openContextControl(root))!;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
  const { root } = preparedFixture(t);
  const service = preparedFixture(t).service;
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
        assert.equal((await service.findViewRun(runId))?.id, runId);
        assert.equal(Buffer.from((await service.readViewArtifact(runId, first.artifact.id)).bytes).toString(), first.step.id);
        const overview = await service.viewProjection(runId, "overview");
        assert.deepEqual(overview?.artifacts, []); assert.deepEqual(overview?.reviews, []);
        for (const surface of ["artifacts", "action"] as const) {
          const projection = await service.viewProjection(runId, surface, first.step.source!.actionId);
          assert.ok(projection?.artifacts.some(a => a.id === first.artifact.id));
          assert.ok(projection.artifacts.every(a => a.content === undefined && a.contentRef === undefined));
          assert.deepEqual(projection.reviews, []);
        }
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

const action = (id: string, from = "START", review = false) => ({
  tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from }],
  artifact: { name: id, model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" }, ...(review ? { review: ["approval"] } : {}) },
});
const procedure = (actions: ReturnType<typeof action>[]): GraphProcedureMemory => ({
  tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["concurrent-graph"], defines: ["Concurrency"], actions,
} as GraphProcedureMemory);
const gate = () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; }), waiting = new Promise<void>(r => { release = r; });
  return { entered, release, pause: async () => { started(); await waiting; } };
};

// Exercises actual native lock occupation, not elapsed-time comparisons.
test("Graph report, vote, advance, finish and abandon work while the former Run lock is held", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service;
  await service.withGraph(async g => {
    const start = await g.start({ name: "held lock", procedure: procedure([action("A", "START", true), action("B", "A")]),
      controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } },
      reviewConfiguration: { reviews: { "concurrent-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "concurrent-graph::approval": { actorIds: ["human"] } } } });
    const id = start.run.id, dir = join(root, ".runtime/context-control"); await mkdir(dir, { recursive: true });
    await withNativeFileLock(join(dir, `${createHash("sha256").update(id).digest("hex")}.lock`), async () => {
      await g.enter(id, start.steps[0].id);
      const candidate = await g.report(id, start.steps[0].id, { text: "A" });
      const round = candidate.step.reviewRounds![0].id;
      await g.submitReview(id, candidate.step.id, round, "human", "approve");
      const voted = await g.submitReview(id, candidate.step.id, round, "runner", "approve");
      const b = voted.steps.find(s => s.source!.actionId === "B")!; await g.enter(id, b.id);
      const report = await g.report(id, b.id, { text: "B" }); await g.advance(id);
      assert.equal((await service.finish(id, [report.artifact.id])).status, "done");
      assert.equal((await g.finish(id)).status, "done");
    });
    const another = await g.start({ name: "abandon", procedure: procedure([action("A")]) });
    await withNativeFileLock(join(dir, `${createHash("sha256").update(another.run.id).digest("hex")}.lock`), async () => {
      assert.equal((await g.abandon(another.run.id)).status, "abandoned");
      assert.equal((await g.abandon(another.run.id)).status, "abandoned");
    });
  });
});

test("parallel Graph reports keep both saved submissions and recover shared Run CAS conflicts", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service;
  await service.withGraph(async g => {
    const start = await g.start({ name: "parallel", procedure: procedure([action("A"), action("B"), action("C", "A"), action("D", "B")]) });
    for (const step of start.steps) await g.enter(start.run.id, step.id);
    const store = service.stores.step, update = store.update.bind(store), barrier = gate(); let saved = 0;
    store.update = async (...args) => {
      const result = await update(...args);
      if ((args[2] as Step).frames?.length && ++saved <= 2) {
        if (saved === 2) barrier.release();
        await barrier.pause();
      }
      return result;
    };
    let results;
    try { results = await Promise.allSettled(start.steps.map(s => g.report(start.run.id, s.id, { text: s.source!.actionId }))); }
    finally { store.update = update; }
    for (const r of results) if (r.status === "rejected") {
      assert.ok(["REVISION_CONFLICT", "ALREADY_EXISTS"].includes(r.reason.code));
      assert.equal(r.reason.details.runId, start.run.id); assert.ok(r.reason.details.artifactId);
    }
    const recovered = await g.advance(start.run.id);
    assert.equal(recovered.artifacts.length, 2);
    assert.equal(recovered.steps.filter(s => s.status === "done").length, 2);
    assert.deepEqual(recovered.steps.filter(s => s.status === "pending").map(s => s.source!.actionId).sort(), ["C", "D"]);
    assert.equal(new Set(recovered.steps.filter(s => s.status === "done").map(s => s.completionSequence)).size, 2);
  });
});

test("two reports for the same Graph Step cannot overwrite the winning submission", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service, other = (await openContextControl(root))!;
  await service.withGraph(async g => {
    const start = await g.start({ name: "same Step", procedure: procedure([action("A")]) }), id = start.run.id, step = start.steps[0];
    await g.enter(id, step.id);
    const store = service.stores.step, update = store.update.bind(store), barrier = gate();
    store.update = async (...args) => { await barrier.pause(); return update(...args); };
    const rejected = assert.rejects(g.report(id, step.id, { text: "stale" }), { code: "REVISION_CONFLICT" });
    try { await barrier.entered; await other.withGraph(h => h.report(id, step.id, { text: "winner" })); }
    finally { barrier.release(); store.update = update; }
    await rejected;
    const snapshot = await g.advance(id); assert.equal(snapshot.artifacts.length, 1);
    assert.equal(Buffer.from((await g.readArtifact(id, snapshot.artifacts[0].id)).bytes).toString(), "winner");
  });
});

async function interrupted(g: GraphRuntime, service: NonNullable<Awaited<ReturnType<typeof openContextControl>>>) {
  const start = await g.start({ name: "recovery", procedure: procedure([action("A"), action("B", "A")]) });
  await g.enter(start.run.id, start.steps[0].id);
  const store = service.stores.artifact, create = store.create.bind(store);
  store.create = async () => { throw Error("saved frame"); };
  try { await assert.rejects(g.report(start.run.id, start.steps[0].id, { text: "A" }), /saved frame/); }
  finally { store.create = create; }
  const saved = await g.records.require<Step>("step", start.run.id, start.steps[0].id);
  await assert.rejects(g.report(start.run.id, start.steps[0].id, { text: "replacement" }), { code: "RECOVERY_REQUIRED" });
  assert.deepEqual(await g.records.require<Step>("step", start.run.id, start.steps[0].id), saved);
  return start;
}

test("concurrent recovery finishing the same submission does not overwrite a removed frame", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service, other = (await openContextControl(root))!;
  await service.withGraph(async g => {
    const start = await interrupted(g, service), id = start.run.id, store = service.stores.run, update = store.update.bind(store), barrier = gate();
    let paused = false;
    store.update = async (...args) => {
      const result = await update(...args);
      if (!paused && (args[2] as Run).frames![0].graphFrame.nextCompletionSequence > 1) { paused = true; await barrier.pause(); }
      return result;
    };
    const recovery = g.advance(id);
    try { await barrier.entered; await other.withGraph(h => h.advance(id)); }
    finally { barrier.release(); store.update = update; }
    await recovery;
    const snapshot = await g.advance(id);
    assert.equal(snapshot.steps.filter(s => s.source!.actionId === "B").length, 1);
    assert.equal(snapshot.run.frames![0].graphFrame.processedStepIds.length, 1);
    assert.equal(snapshot.steps.find(s => s.source!.actionId === "A")!.frames?.length, 0);
  });
});

test("a stale advance does not dispatch a completion already processed by another advance", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service, other = (await openContextControl(root))!;
  await service.withGraph(async g => {
    const start = await interrupted(g, service), id = start.run.id;
    const update = g.records.update.bind(g.records);
    // Leave a completed source whose downstream dispatch has not yet committed.
    g.records.update = async (...args) => {
      if (args[0] === "run" && (args[3] as Run).frames![0].graphFrame.processedStepIds.length) throw Error("dispatch interrupted");
      return update(...args);
    };
    try { await assert.rejects(g.advance(id), /dispatch interrupted/); }
    finally { g.records.update = update; }
    const require = g.records.require.bind(g.records), barrier = gate(); let reads = 0;
    g.records.require = async (...args) => {
      // Initial Run, materialization, loop snapshot, then the fresh dispatch row.
      if (args[0] === "run" && ++reads === 4) await barrier.pause();
      return require(...args);
    };
    const advancing = g.advance(id);
    try { await barrier.entered; await other.withGraph(h => h.advance(id)); }
    finally { barrier.release(); g.records.require = require; }
    await advancing;
    const snapshot = await g.advance(id);
    assert.equal(snapshot.steps.filter(s => s.source!.actionId === "B").length, 1);
    assert.deepEqual(snapshot.run.frames![0].graphFrame.processedStepIds, [start.steps[0].id]);
  });
});

test("another Reviewer can submit while one saved vote is paused before settlement", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service, other = (await openContextControl(root))!;
  await service.withGraph(async g => {
    const start = await g.start({ name: "independent votes", procedure: procedure([action("A", "START", true)]),
      controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: {
        a: { kind: "human", name: "A", permissions: ["artifact.read", "decision.decide"] },
        b: { kind: "human", name: "B", permissions: ["artifact.read", "decision.decide"] },
      } }, reviewConfiguration: { reviews: { "concurrent-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "concurrent-graph::approval": { actorIds: ["a", "b"] } } } });
    const id = start.run.id; await g.enter(id, start.steps[0].id);
    const candidate = await g.report(id, start.steps[0].id, { text: "A" }), round = candidate.step.reviewRounds![0].id;
    const store = service.stores.review, update = store.update.bind(store), barrier = gate();
    store.update = async (...args) => { const result = await update(...args); await barrier.pause(); return result; };
    const first = g.submitReview(id, candidate.step.id, round, "a", "approve");
    try { await barrier.entered; await other.withGraph(h => h.submitReview(id, candidate.step.id, round, "b", "approve")); }
    finally { barrier.release(); store.update = update; }
    await first;
    const snapshot = await g.submitReview(id, candidate.step.id, round, "runner", "approve");
    assert.equal(snapshot.reviews.filter(r => r.status === "submitted").length, 3);
    assert.equal(snapshot.steps[0].status, "done");
  });
});

test("Graph finish and abandon retain Run CAS instead of overwriting a concurrent Run edit", { timeout: 10000 }, async t => {
  const { root } = preparedFixture(t), service = preparedFixture(t).service, other = (await openContextControl(root))!;
  await service.withGraph(async g => {
    for (const terminal of ["finish", "abandon"] as const) {
      const start = await g.start({ name: terminal, procedure: procedure([action("A")]) }), id = start.run.id;
      if (terminal === "finish") { await g.enter(id, start.steps[0].id); await g.report(id, start.steps[0].id, { text: "A" }); }
      const store = service.stores.run, update = store.update.bind(store), barrier = gate();
      store.update = async (...args) => { await barrier.pause(); return update(...args); };
      const rejected = assert.rejects(g[terminal](id), { code: "REVISION_CONFLICT" });
      try {
        await barrier.entered;
        const row = (await other.stores.run.get({}, id))!;
        await other.stores.run.update({}, id, { ...row.value as Run, name: "winning edit" }, { expectedRevision: row.revision });
      } finally { barrier.release(); store.update = update; }
      await rejected;
      const result = await g[terminal](id);
      assert.equal(result.name, "winning edit"); assert.equal(result.status, terminal === "finish" ? "done" : "abandoned");
    }
  });
});
