// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import { currentReviewNode } from "../src/review-nodes.js";

import assert from "node:assert/strict";

import test from "node:test";

import { join } from "node:path";

import { fileURLToPath } from "node:url";



import { graphDomainFixture } from "./helpers/graph-domain.js";

import { businessFixture } from "./helpers/business-data.js";

import { initializedContextFixture } from "./helpers/initialized-context.js";

import { openContextControl } from "../src/project/context-control.js";

import { graphMemorySyntax } from "../src/memory/syntax.js";

import type { GraphProcedureMemory } from "../src/memory/ast.js";

import * as reviews from "../src/context_control/review-repository.js";

async function fixture(t: test.TestContext, agent = false, advisory = false, mixed = false, filesystem = false) {
  const f = filesystem ? await initializedContextFixture(t) : await businessFixture(t, {});
  const service = filesystem ? (await openContextControl(f.root))! : (await graphDomainFixture(t)).service;
  const actor = agent ? { kind: "agent" as const, name: "Agent", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "traex" as const, command: process.execPath, args: [fileURLToPath(new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url)), "approve"], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: 10000 } } : { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, ...(advisory ? ["decision.assess" as const] : ["decision.decide" as const])] };
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["review-graph"], defines: ["Review"], actions: [{ tag: "!action", id: "A", description: "Deliver", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["approval"] } }] };
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "review", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reviewer: actor, ...(mixed ? { human: { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, "decision.decide" as const] } } : {}) }, acpProviders: {} }, reviewConfiguration: { reviews: { "review-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "review-graph::approval": { actorIds: mixed ? ["reviewer", "human"] : ["reviewer"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "# Candidate" });
  });
  return { ...f, service, result, input: { service, runsRoot: join(f.root, "runs"), reviewId: reviews.graphReviewHandle(result.snapshot.run.id, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "reviewer" } };
}

for (const vote of ["approve", "request_changes"] as const) test(`Agent processing and Runner ${vote} do not wait for Human`, { timeout: 15000 }, async t => {
  const f = await fixture(t, true, false, true, true);
  const { reviewReady } = await import("../src/daemon/review.js");
  const { buildArtifactReviewNextActionPromptModel } = await import("../src/prompts/review.js");
  let context = await reviews.readArtifactReviewForRunner(f.input);
  assert.equal(reviewReady(context), false);
  assert.equal(buildArtifactReviewNextActionPromptModel(context.review, context.round, context.run.id).kind, "wait");
  const abort = new AbortController();
  let returned = false;
  let humanDraftSaved = false;
  let observed = () => {};
  const polledAfterDraft = new Promise<void>(resolve => { observed = resolve; });
  const waitingService = new Proxy(f.service, { get(target, property, receiver) {
    if (property !== "withGraph") return Reflect.get(target, property, receiver);
    return async (action: Parameters<typeof target.withGraph>[0]) => {
      const result = await target.withGraph(action);
      if (humanDraftSaved && result && typeof result === "object" && "artifactReviews" in result &&
        (result as typeof context.run).artifactReviews?.some(review => review.rounds.at(-1)?.assignments.some(
          assignment => assignment.actorId === "human" && assignment.draft.vote === "approve"))) observed();
      return result;
    };
  } });
  const waiting = reviews.waitForArtifactReview({ ...f.input, service: waitingService, pollIntervalMs: 0, signal: abort.signal }).then(v => { returned = true; return v; });
  t.after(async () => { abort.abort(); await waiting.catch(() => undefined); });
  const human = { ...f.input, actorId: "human" };
  const draft = await reviews.readArtifactReviewForActor(human);
  await reviews.updateArtifactReviewDraft({ ...human, expectedRevision: draft.round.revision, draft: { comments: [], vote: "approve" } });
  humanDraftSaved = true;
  await Promise.race([polledAfterDraft, waiting.then(() => { throw Error("Wait returned before an Agent completed"); })]);
  // Finish the observed poll's promise chain; no elapsed-time assumption.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(returned, false, "Human activity must not release an unfinished Agent wait");
  await assert.rejects(reviews.submitArtifactReviewRunnerVote({ ...f.input, vote }), /Agent opinions/);
  // This scenario drives a logical Reviewer directly; it starts no OS worker.
  // Native worker identity and cleanup are covered by process integration tests.
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input }))!;
  const agent = { ...f.input, attemptId: claimed.attempt.id };
  await reviews.markArtifactReviewAgentCliReady(agent);
  let pending = await reviews.readArtifactReviewForActor(agent);
  while (currentReviewNode(pending.assignment)) pending = await reviews.mutateArtifactReviewNodes({ ...agent, mutation: { operation: "report", artifact: { applicable: true }, expectedNodeId: currentReviewNode(pending.assignment)!.nodeId } });
  await reviews.submitArtifactReviewAgentAssignment({ ...agent, vote: "approve" });
  context = await waiting;
  assert.equal(reviewReady(context), true);
  assert.equal(context.round.assignments.find(a => a.actorId === "human")!.status, "draft");
  assert.equal(buildArtifactReviewNextActionPromptModel(context.review, context.round, context.run.id).kind, "runner_vote");
  await reviews.submitArtifactReviewRunnerVote({ ...f.input, vote, comment: vote === "request_changes" ? "Revise before Human acceptance" : undefined });
  context = await reviews.readArtifactReviewForRunner(f.input);
  if (vote === "approve") {
    assert.equal(context.review.status, "pending", "Human acceptance remains a separate final gate");
    assert.equal(buildArtifactReviewNextActionPromptModel(context.review, context.round, context.run.id).kind, "human_vote");
    const current = await reviews.readArtifactReviewForActor(human);
    await reviews.submitArtifactReviewAssignment({ ...human, expectedRevision: current.round.revision });
    assert.equal((await f.service.snapshot(context.run.id)).steps[0].status, "done");
  } else {
    assert.equal(context.review.status, "awaiting_revision");
    const next = await f.service.withGraph(g => g.report(context.run.id, f.result.step.id, { text: "# Revised candidate", revisionSummary: "Runner addressed Agent feedback" }));
    assert.equal(next.step.reviewRounds!.length, 2);
    await assert.rejects(reviews.submitArtifactReviewAssignment({ ...human, expectedRevision: context.round.revision }), /no longer current/);
  }
});