import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runArtifactReviewAgentWorker } from "../src/acp/review-worker.js";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
import * as reviews from "../src/context_control/review-repository.js";

async function fixture(t: test.TestContext, agent = false, advisory = false, mixed = false) {
  const f = await businessFixture(t, {}); const service = (await openContextControl(f.root, true))!;
  const actor = agent ? { kind: "agent" as const, name: "Agent", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "traex" as const, command: process.execPath, args: [fileURLToPath(new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url)), "approve"], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: 10000 } } : { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, ...(advisory ? ["decision.assess" as const] : ["decision.decide" as const])] };
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["review-graph"], defines: ["Review"], actions: [{ tag: "!action", id: "A", description: "Deliver", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["approval"] } }] };
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "review", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reviewer: actor, ...(mixed ? { human: { kind: "human" as const, name: "Human", permissions: ["artifact.read" as const, "decision.decide" as const] } } : {}) }, acpProviders: {} }, reviewConfiguration: { reviews: { "review-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "review-graph::approval": { actorIds: mixed ? ["reviewer", "human"] : ["reviewer"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "# Candidate" });
  });
  return { ...f, service, result, input: { runsRoot: join(f.root, "runs"), reviewId: reviews.graphReviewHandle(result.snapshot.run.id, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "reviewer" } };
}

test("graph Review adapter preserves Human drafts, checks revisions and never stores legacy Review DTOs", async t => {
  const f = await fixture(t);
  const initial = await reviews.readArtifactReviewForActor(f.input);
  const saved = await reviews.updateArtifactReviewDraft({ ...f.input, expectedRevision: initial.round.revision, draft: { comments: [], vote: "approve" } });
  await assert.rejects(reviews.submitArtifactReviewAssignment({ ...f.input, expectedRevision: initial.round.revision }));
  await reviews.submitArtifactReviewAssignment({ ...f.input, expectedRevision: saved.round.revision });
  assert.equal((await reviews.readArtifactReviewForRunner(f.input)).round.status, "awaiting_runner_vote");
  await reviews.submitArtifactReviewRunnerVote({ ...f.input, vote: "approve" });
  const snapshot = await f.service.snapshot(f.result.snapshot.run.id);
  assert.equal(snapshot.steps[0].status, "done"); assert.equal((snapshot.run as any).artifactReviews, undefined);
  assert.equal(snapshot.reviews.filter(r => r.status === "submitted").length, 2);
});

for (const advisory of [false, true]) for (const vote of ["request_changes", "abstain"] as const) test(`delegated ${advisory ? "advisory" : "decision"} Human ${vote} requires actionable Comments`, async t => {
  const f = await fixture(t, false, advisory);
  const input = { ...f.input, runId: f.result.snapshot.run.id, assignmentId: "reviewer", authorizationNote: "Explicit authorization in isolated fixture", vote, summary: "Summary cannot replace a Comment" };
  const before = await f.service.snapshot(input.runId);
  await assert.rejects(reviews.submitArtifactReviewHumanAssignmentForRunner({ ...input, comments: [] }), /at least one Comment/);
  if (advisory) {
    for (const severity of [undefined, "unknown"]) await assert.rejects(reviews.submitArtifactReviewHumanAssignmentForRunner({ ...input, comments: [{ body: "Reason", ...(severity ? { severity } : {}) }] as any }), /severity/);
  }
  assert.deepEqual(await f.service.snapshot(input.runId), before);
  const submitted = await reviews.submitArtifactReviewHumanAssignmentForRunner({ ...input, comments: [{ body: "Explain the missing requirement", ...(advisory ? { severity: "risk" as const } : {}) }] });
  assert.equal(submitted.assignment.binding, advisory ? "advisory" : "decision");
  assert.equal(submitted.assignment.submitted?.vote, vote); assert.equal(submitted.assignment.submitted?.comments.length, 1);
  assert.equal(submitted.assignment.status, "submitted");
  if (advisory) {
    await reviews.submitArtifactReviewRunnerVote({ ...f.input, vote: "approve" });
    assert.equal((await f.service.snapshot(input.runId)).steps[0].status, "done");
  } else if (vote === "request_changes") assert.equal(submitted.review.status, "awaiting_revision");
});

test("Agent claims once, requires handshake, and submits only its current attempt", async t => {
  const f = await fixture(t, true);
  const claimed = await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }); assert.ok(claimed);
  assert.equal(await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }), undefined);
  const input = { ...f.input, attemptId: claimed.attempt.id };
  await assert.rejects(reviews.submitArtifactReviewAgentAssignment({ ...input, vote: "approve" }), /handshake/);
  await reviews.markArtifactReviewAgentCliReady(input);
  await reviews.submitArtifactReviewAgentAssignment({ ...input, vote: "approve" });
  assert.equal((await reviews.readArtifactReviewForActor(f.input)).assignment.status, "submitted");
  assert.equal((await f.service.snapshot(f.result.snapshot.run.id)).steps[0].status, "awaiting_review");
});

test("failed Agent Review remains undecided until explicit retry; retry invalidates old attempt", async t => {
  const f = await fixture(t, true);
  const first = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }))!;
  await reviews.failArtifactReviewAgentAssignment({ ...f.input, attemptId: first.attempt.id, failure: { stage: "process", code: "failed", message: "test failure" } });
  assert.equal((await reviews.waitForArtifactReview(f.input)).round.assignments[0].status, "failed");
  await assert.rejects(reviews.submitArtifactReviewRunnerVote({ ...f.input, vote: "approve" }));
  await reviews.retryArtifactReviewAgentAssignment(f.input);
  const next = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }))!;
  assert.notEqual(next.attempt.id, first.attempt.id);
  await assert.rejects(reviews.markArtifactReviewAgentCliReady({ ...f.input, attemptId: first.attempt.id }));
  await reviews.markArtifactReviewAgentCliReady({ ...f.input, attemptId: next.attempt.id });
});


test("graph ACP worker uses the real Session CLI to read the candidate and submit its assigned Review", { timeout: 60000 }, async t => {
  const f = await fixture(t, true);
  const oldHome = process.env.MEMSPHERE_HOME;
  process.env.MEMSPHERE_HOME = f.home;
  try {
    const initial = await reviews.readArtifactReviewForActor(f.input);
    await runArtifactReviewAgentWorker({ config: join(f.root, "config.json"), review: f.input.reviewId, round: f.input.roundId, assignment: initial.assignment.id!, nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL("../dist/cli.js", import.meta.url)), providerResolver: () => ({ id: "traex", buildLaunch: ({ actor, workspaceRoot, sessionEnv }) => ({ provider: "fake-test-provider", command: actor.agent.command, args: actor.agent.args, cwd: workspaceRoot, env: { ...process.env, MEMSPHERE_HOME: f.home, ...sessionEnv }, startupTimeoutMs: 10000, idleTimeoutMs: 10000, maxRuntimeMs: null, promptVersion: "artifact-review-v1" }) }) });
    const result = await reviews.readArtifactReviewForActor(f.input);
    assert.equal(result.assignment.status, "submitted", JSON.stringify(result.assignment.attempts));
    assert.equal(result.assignment.submitted?.vote, "approve");
    assert.ok(result.assignment.attempts?.[0].cliReadyAt);
    assert.equal(result.round.status, "awaiting_runner_vote");
  } finally { if (oldHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = oldHome; }
});

test("graph Review adapter restores omitted idle timeout as null", async t => {
  const f = await fixture(t, true);
  const runId = f.result.snapshot.run.id;
  const row = (await f.service.stores.run.get({}, runId))!;
  const value = structuredClone(row.value) as any;
  delete value.permissionConfig.actors.reviewer.agent.idleTimeoutMs;
  await f.service.stores.run.update({}, runId, value, { expectedRevision: row.revision });
  const context = await reviews.readArtifactReviewForActor(f.input);
  const actor = context.run.controlPlane!.actors.reviewer;
  assert.equal(actor.kind, "agent");
  if (actor.kind === "agent") assert.equal(actor.agent.idleTimeoutMs, null);
});

for (const vote of ["approve", "request_changes"] as const) test(`Agent processing and Runner ${vote} do not wait for Human`, async t => {
  const f = await fixture(t, true, false, true);
  const { reviewReady } = await import("../src/daemon/review.js");
  const { buildArtifactReviewNextActionPromptModel } = await import("../src/prompts/review.js");
  let context = await reviews.readArtifactReviewForRunner(f.input);
  assert.equal(reviewReady(context), false);
  assert.equal(buildArtifactReviewNextActionPromptModel(context.review, context.round, context.run.id).kind, "wait");
  const abort = new AbortController();
  let returned = false;
  const waiting = reviews.waitForArtifactReview({ ...f.input, pollIntervalMs: 5, signal: abort.signal }).then(v => { returned = true; return v; });
  t.after(() => abort.abort());
  const human = { ...f.input, actorId: "human" };
  const draft = await reviews.readArtifactReviewForActor(human);
  await reviews.updateArtifactReviewDraft({ ...human, expectedRevision: draft.round.revision, draft: { comments: [], vote: "approve" } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(returned, false, "Human activity must not release an unfinished Agent wait");
  await assert.rejects(reviews.submitArtifactReviewRunnerVote({ ...f.input, vote }), /Agent opinions/);
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }))!;
  const agent = { ...f.input, attemptId: claimed.attempt.id };
  await reviews.markArtifactReviewAgentCliReady(agent);
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
