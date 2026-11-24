import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { dispatchArtifactReviewAgents } from "../src/acp/dispatcher.js";
import { ExplorationReviews, explorationReviewHandle, mutateModelReviewNode } from "../src/context_control/exploration-review.js";
import * as reviews from "../src/context_control/review-repository.js";
import { textContent } from "../src/context_control/types.js";
import { explorationFixture as fixture, explorationTestCli as cli } from "./helpers/exploration.js";
import { freezeExplorationSchema } from "../src/context_control/exploration-contract.js";
import { ContextControl } from "../src/context_control/service.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import { currentReviewNode, reviewNodeProgress } from "../src/review-nodes.js";
import { inspectReview, renderReviewResult, reviewResumeNotification } from "../src/daemon/review.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { captureProcessIdentity, stopRewindWorker } from "../src/context_control/review-process.js";
import { stopFixtureJob, untilFixture } from "./helpers/fixture-process.js";

test("simultaneous Review starts converge and cancellation during preparation creates no Review", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("race")).id;
  const { artifact, step } = await f.service.report(R, { name: "candidate", content: textContent("body") });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "runner" });
  const repository = new ExplorationReviews(f.service);
  const baseline = repository.records.create.bind(repository.records);
  let arrivals = 0, ready!: () => void;
  const competing = new Promise<void>(resolve => { ready = resolve; });
  f.beforeCleanup(async () => { ready(); await Promise.allSettled(starts); });
  repository.records.create = async (...args: Parameters<typeof baseline>) => {
    if (++arrivals === 2) ready();
    await competing;
    return baseline(...args);
  };
  const starts = [repository.start(f.config, R, artifact.id, t.signal), repository.start(f.config, R, artifact.id, t.signal)];
  const [first, second] = await Promise.all(starts);
  assert.equal(first.id, second.id);
  await f.service.configureExplorationStep(R, step.id, { suggests: ["statements/fact"] });
  const controller = new AbortController();
  let readStarted!: () => void, readResume!: () => void;
  const reading = new Promise<void>(resolve => { readStarted = resolve; }), resumed = new Promise<void>(resolve => { readResume = resolve; });
  const body = f.service.body.bind(f.service);
  const intercepted = new Proxy(f.service, { get(target, property) {
    if (property !== "body") return Reflect.get(target, property);
    return async (...args: Parameters<typeof body>) => { readStarted(); await resumed; return body(...args); };
  } });
  const cancelled = new ExplorationReviews(intercepted).start(f.config, R, artifact.id, controller.signal);
  f.beforeCleanup(async () => { controller.abort(); readResume(); await Promise.allSettled([cancelled]); });
  await reading;
  controller.abort();
  readResume();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual((await repository.list(R)).map(r => r.id), [first.id]);
});

test("delegated exploration Review launches a restricted ACP Session and retries the same assignment", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("delegated")).id;
  const attached = await f.service.addExternal(R, "used", { content: textContent("authorized source") });
  const unattached = await f.service.addExternal(R, "not used", { content: textContent("unattached source") });
  const { artifact, step } = await f.service.report(R, { name: "candidate", content: textContent("review this"), dependencies: [{ kind: "external", id: attached.id }] });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const repository = new ExplorationReviews(f.service);
  const cfg = { ...f.config, controlPlane: { runner: { permissions: ["artifact.read" as const] }, actors: {
    reader: { kind: "agent" as const, name: "Reader", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "codex" as const, command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url)), "approve"],
      env: { EXPLORATION_TEST_EXTERNAL: attached.id, EXPLORATION_TEST_UNATTACHED: unattached.id, EXPLORATION_TEST_CRASH_MARKER: join(f.directory, "node-saved") }, startupTimeoutMs: 10000, idleTimeoutMs: 20000 } }
  }, acpProviders: {} } };
  const value = await repository.start(cfg, R, artifact.id), reviewId = explorationReviewHandle(R, value.id);
  const common = { runsRoot: cfg.runsRoot, reviewId, roundId: value.roundId!, actorId: "reader" };
  let dispatchWork: Promise<number> | undefined;
  const attempts = async () => (await repository.locate(R, value.id)).row.value.attempts ?? [];
  const ownWorkerExited = async (attempt: Awaited<ReturnType<typeof attempts>>[number]) => {
    if (!attempt.workerPid || !attempt.workerIdentity) return true;
    const live = await captureProcessIdentity(attempt.workerPid);
    return live?.started !== attempt.workerIdentity.started;
  };
  f.beforeCleanup(async () => {
    await dispatchWork?.catch(() => undefined);
    for (const attempt of await attempts()) {
      if (!attempt.workerPid || await ownWorkerExited(attempt)) continue;
      if (attempt.workerJob) await stopFixtureJob(attempt.workerJob);
      else await stopRewindWorker({ reviewId, attemptId: attempt.id, pid: attempt.workerPid, identity: attempt.workerIdentity, members: attempt.workerMembers });
      await untilFixture(() => ownWorkerExited(attempt), "owned exploration Review worker exit");
    }
  });
  const oldHome = process.env.MEMSPHERE_HOME; process.env.MEMSPHERE_HOME = f.home;
  try {
    const dispatch = async () => dispatchArtifactReviewAgents({ config: cfg, run: await reviews.readRun(cfg.runsRoot, R),
      workspaceRoot: f.cwd, runtime: { nodeExecutable: process.execPath, cliEntrypoint: cli } });
    assert.equal(await (dispatchWork = dispatch()), 1);
    const wait = () => reviews.waitForArtifactReview({ runsRoot: cfg.runsRoot, reviewId, signal: t.signal, pollIntervalMs: 150 });
    await wait();
    const failed = await reviews.readArtifactReviewForActor(common);
    assert.equal(failed.assignment.status, "failed");
    const first = (await attempts())[0];
    assert.ok(first.workerPid && first.workerPid !== process.pid && first.workerIdentity);
    await untilFixture(() => ownWorkerExited(first), "first exploration Review worker exit");
    assert.equal(reviewNodeProgress(failed.assignment)?.processed, 1);
    const attemptId = failed.assignment.attempts![0].id;
    const retried = await reviews.retryArtifactReviewAgentAssignment(common);
    assert.notEqual(retried.attempt.id, attemptId);
    await assert.rejects(reviews.assertArtifactReviewAgentAttemptRunning({ ...common, attemptId }), /no longer current/);
    assert.deepEqual(retried.assignment.nodeStates, failed.assignment.nodeStates);
    await assert.rejects(reviews.mutateArtifactReviewNodes({ ...common, attemptId, mutation: { operation: "report", expectedNodeId: currentReviewNode(retried.assignment)!.nodeId, artifact: { applicable: true } } }), /not current and running/);
    assert.equal(await (dispatchWork = dispatch()), 1);
    const draft = await f.call("run", "enter-schema", "report", "--run", R, "--name", "Unrelated draft", "--content-type", "text/markdown");
    const home = (await openCommandStates(false, f.home))!, session = "codex-free-schema-review";
    const target = await home.get({}, session);
    const result = await wait();
    assert.equal(result.round.assignments[0].submitted?.vote, "approve", JSON.stringify(result.round.assignments[0].attempts));
    const second = (await attempts())[1];
    assert.ok(second.workerPid && second.workerPid !== process.pid && second.workerIdentity);
    await untilFixture(() => ownWorkerExited(second), "retried exploration Review worker exit");
    const before = await f.service.inspect(R);
    const note = reviewResumeNotification("test-project", reviewId);
    assert.ok(note.includes(reviewId));
    assert.match(await renderReviewResult(cfg, await inspectReview(cfg, reviewId)), /approve|通过/);
    assert.match((await f.invoke("run", "review", "wait", "--review", reviewId)).stdout, /approve|通过/);
    assert.deepEqual(await home.get({}, session), target);
    assert.equal((await f.call("continue", "schema", "show")).stepId, draft.stepId);
    assert.deepEqual(await f.service.inspect(R), before);
    assert.equal((await repository.list(R)).length, 1);
  } finally {
    if (oldHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = oldHome;
  }
});

async function writeSchema(service: ContextControl, draft: Awaited<ReturnType<ContextControl["enterExplorationSchema"]>>) {
  const title = await service.writeExplorationSchema(draft.runId, draft.stepId, "report", draft.position, "# Report");
  const notes = await service.writeExplorationSchema(draft.runId, draft.stepId, "skip", title.position);
  const written = await service.writeExplorationSchema(draft.runId, draft.stepId, "report", notes.position, "42");
  assert.equal(written.phase, "awaiting_finalization");
}

for (const schema of [false, true]) {
  test(`${schema ? "Schema" : "ordinary"} revision recovers its original Step and distinct Review inputs`, { timeout: 30000 }, async t => {
    const f = await fixture(t), { service } = f, R = (await service.start("revision recovery")).id;
    const first = await service.addExternal(R, "first", { content: textContent("first reference") });
    const second = await service.addExternal(R, "second", { content: textContent("second reference") });
    let A1: Awaited<ReturnType<ContextControl["report"]>>;
    if (schema) {
      const contract = await freezeExplorationSchema(f.config, "Report", "report", "text/markdown");
      const draft = await service.enterExplorationSchema(R, { name: "Report", contentType: "text/markdown", contract });
      await writeSchema(service, draft);
      A1 = { ...await service.submitExplorationSchema(R, draft.stepId, { dependsOn: [`external:${first.id}`] }), candidates: [] };
    } else {
      A1 = await service.report(R, { name: "Report", content: textContent("First body"), dependsOn: [`external:${first.id}`] });
    }
    const repository = new ExplorationReviews(service);
    await service.configureExplorationStep(R, A1.step.id, { asserts: ["statements/fact"], reviewer: "runner" });
    const oldReview = await repository.start(f.config, R, A1.artifact.id);
    const store = service.stores.step, create = store.create;
    let ids!: { artifactId: string; stepId: string };
    store.create = async () => { throw new Error("Step create interrupted"); };
    try {
      const revision = schema ? service.enterExplorationSchema(R, { revisedFrom: A1.artifact.id })
        : service.report(R, { revisedFrom: A1.artifact.id, content: textContent("Second body"), dependsOn: [`external:${second.id}`] });
      await assert.rejects(revision, (error: unknown) => {
        const receipt = error as Error & { details: typeof ids };
        ids = receipt.details;
        return /Step create interrupted/.test(receipt.message) && Boolean(ids?.artifactId && ids.stepId);
      });
    } finally { store.create = create; }
    await service.configureExplorationStep(R, A1.step.id, { asserts: [], suggests: ["statements/fact"] });
    if (schema) await writeFile(f.schema, withCurrentMemorySyntax("!schema\nnames: [report]\ntype: boolean\n"));
    const partial = await service.inspect(R);
    assert.ok(partial.artifacts.some(a => a.id === ids.artifactId));
    assert.ok(!partial.steps.some(step => step.id === ids.stepId));
    if (schema) {
      const draft = await service.enterExplorationSchema(R, { stepId: ids.stepId });
      assert.equal(draft.artifactId, ids.artifactId);
      assert.deepEqual(draft.draft.schemaContract, A1.artifact.schemaContract);
      await writeSchema(service, draft);
      const result = await service.submitExplorationSchema(R, ids.stepId, { dependsOn: [`external:${second.id}`] });
      assert.equal(result.artifact.id, ids.artifactId);
    } else {
      assert.ok((await service.snapshot(R)).steps.some(step => step.id === ids.stepId));
    }
    const snapshot = await service.inspect(R);
    assert.equal(snapshot.artifacts.filter(artifact => artifact.revisedFrom === A1.artifact.id).length, 1);
    assert.equal(snapshot.steps.filter(step => step.id === ids.stepId).length, 1);
    const config = (await service.explorationStep(R, ids.stepId)).reviewConfiguration!;
    assert.deepEqual(config.asserts, ["statements/fact"]);
    assert.deepEqual(config.inheritedFrom, { artifactId: A1.artifact.id, stepId: A1.step.id });
    const newReview = await repository.start(f.config, R, ids.artifactId);
    assert.deepEqual(oldReview.exploration!.materials.map(ref => ref.id), [A1.artifact.id, first.id]);
    assert.deepEqual(newReview.exploration!.materials.map(ref => ref.id), [ids.artifactId, second.id]);
  });
}

test("interrupted Schema submission resumes within its original Artifact and releases the completed Continue target", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Resume submission")).id;
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Report", "--content-type", "text/markdown");
  await writeSchema(f.service, draft);
  const store = f.service.stores.step, update = store.update;
  store.update = async () => { throw new Error("Step update interrupted"); };
  try {
    await assert.rejects(f.service.submitExplorationSchema(R, draft.stepId, {}), { code: "SCHEMA_RECOVERY_REQUIRED" });
  } finally { store.update = update; }
  const saved = await f.service.inspect(R);
  assert.equal(saved.artifacts.find(a => a.id === draft.artifactId)?.status, "submitted");
  assert.equal(saved.steps.find(step => step.id === draft.stepId)?.status, "running");
  const result = await f.call("run", "enter-schema", "--run", R, "--step", draft.stepId);
  assert.equal(result.phase, "submitted");
  assert.equal(result.artifactId, draft.artifactId);
  const next = await f.call("continue", "report", "--name", "Follow-up", "--artifact", "Next artifact");
  assert.notEqual(next.artifactId, draft.artifactId);
  assert.ok((await f.service.inspect(R)).completeIds.includes(draft.artifactId));
});

test("a late Schema submission cannot release a newer Home target", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Home race")).id;
  const draft = await f.call("continue", "enter-schema", "report", "--name", "First", "--content-type", "text/markdown");
  const another = await f.service.enterExplorationSchema(R, { name: "Second", contentType: "text/markdown", contract: draft.draft.schemaContract });
  await writeSchema(f.service, draft);
  const original = ContextControl.prototype.submitExplorationSchema;
  let saved!: () => void, resume!: () => void;
  const persisted = new Promise<void>(resolve => { saved = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  t.signal.addEventListener("abort", resume, { once: true });
  ContextControl.prototype.submitExplorationSchema = async function (...args) {
    const result = await original.apply(this, args);
    saved();
    await gate;
    return result;
  };
  const late = f.call("continue", "report");
  f.beforeCleanup(async () => { resume(); ContextControl.prototype.submitExplorationSchema = original; await late.catch(() => undefined); });
  const home = (await openCommandStates(false, f.home))!, session = "codex-free-schema-review";
  try {
    await Promise.race([persisted, late.then(() => assert.fail("Submission was not paused after persistence"))]);
    const row = (await home.get({}, session))!;
    await home.update({}, session, { ...(row.value as object), parameters: { project: "test-project", step: another.stepId } }, { expectedRevision: row.revision });
  } finally { resume(); ContextControl.prototype.submitExplorationSchema = original; }
  assert.equal((await late).artifactId, draft.artifactId);
  assert.equal((await f.call("continue", "schema", "show")).stepId, another.stepId);
  assert.ok((await f.service.inspect(R)).completeIds.includes(draft.artifactId));
});

test("start overlapping submission returns the observed round and allows a later independent round", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("Review submit race")).id;
  const { artifact, step } = await f.service.report(R, { name: "Candidate", content: textContent("Body") });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "runner" });
  const writer = new ExplorationReviews(f.service);
  const original = await writer.start(f.config, R, artifact.id);
  await writer.mutate(R, original.id, original.roundId!, "runner", async review => {
    for (let next = currentReviewNode(review); next; next = currentReviewNode(review)) {
      mutateModelReviewNode(review, { operation: "report", expectedNodeId: next.nodeId, artifact: { applicable: true } }, new Set(), () => "", () => "");
    }
  });
  const competing = new ExplorationReviews(f.service), listRows = competing.records.listRows.bind(competing.records);
  let captured!: () => void, resume!: () => void;
  const observed = new Promise<void>(resolve => { captured = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  competing.records.listRows = async (...args) => {
    const rows = await listRows(...args);
    captured();
    await gate;
    return rows;
  };
  const pending = competing.start(f.config, R, artifact.id, t.signal);
  f.beforeCleanup(async () => { resume(); await pending.catch(() => undefined); });
  await Promise.race([observed, pending.then(() => assert.fail("Start did not observe its initial snapshot"))]);
  try {
    await writer.submit(R, original.id, original.roundId!, "runner", "approve");
  } finally { resume(); }
  const returned = await pending;
  assert.equal(returned.id, original.id);
  assert.equal(returned.status, "submitted");
  assert.equal((await writer.list(R)).length, 1);
  assert.notEqual((await writer.start(f.config, R, artifact.id)).id, original.id);
});
