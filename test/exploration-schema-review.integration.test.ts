import assert from "node:assert/strict";
import test from "node:test";
import { ExplorationReviews, mutateModelReviewNode } from "../src/context_control/exploration-review.js";
import { textContent } from "../src/context_control/types.js";
import { explorationFixture as fixture, writeFixtureSchema } from "./helpers/exploration.js";
import { freezeExplorationSchema } from "../src/context_control/exploration-contract.js";
import type { ContextControl } from "../src/context_control/service.js";
import { currentReviewNode } from "../src/review-nodes.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

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

for (const schema of [false, true]) {
  test(`${schema ? "Schema" : "ordinary"} revision recovers its original Step and distinct Review inputs`, { timeout: 30000 }, async t => {
    const f = await fixture(t), { service } = f, R = (await service.start("revision recovery")).id;
    const first = await service.addExternal(R, "first", { content: textContent("first reference") });
    const second = await service.addExternal(R, "second", { content: textContent("second reference") });
    let A1: Awaited<ReturnType<ContextControl["report"]>>;
    if (schema) {
      const contract = await freezeExplorationSchema(f.config, "Report", "report", "text/markdown");
      const draft = await service.enterExplorationSchema(R, { name: "Report", contentType: "text/markdown", contract });
      await writeFixtureSchema(service, draft);
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
    if (schema) await f.writePublishedMemory(f.schema, withCurrentMemorySyntax("!schema\nnames: [report]\ntype: boolean\n"));
    const partial = await service.inspect(R);
    assert.ok(partial.artifacts.some(a => a.id === ids.artifactId));
    assert.ok(!partial.steps.some(step => step.id === ids.stepId));
    if (schema) {
      const draft = await service.enterExplorationSchema(R, { stepId: ids.stepId });
      assert.equal(draft.artifactId, ids.artifactId);
      assert.deepEqual(draft.draft.schemaContract, A1.artifact.schemaContract);
      await writeFixtureSchema(service, draft);
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
