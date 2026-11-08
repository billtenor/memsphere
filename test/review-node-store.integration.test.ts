// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import * as flow from "../src/run/store.js";
import * as reviews from "../src/context_control/review-repository.js";
import { createFlowReviewNodes } from "../src/run/review-nodes.js";
import { allReviewNodes, currentReviewNode, reviewNodeProgress, reviewCommentId } from "../src/review-nodes.js";

import { reviewNodeFixture as fixture } from "./helpers/review-nodes.js";
for (const graph of [false, true]) {
  const mode = graph ? "graph" : "flow";
  test(`${mode}: sparse reports retain saved IDs and open findings survive final submission`, async t => {
    const f = await fixture(t, graph); const n = currentReviewNode(f.claimed.assignment)!;
    const rulePath = n.asserts[0].rulePath;
    let c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { rulePath, result: "undetermined", body: "Need execution evidence", severity: "risk" } } });
    const commentId = reviewCommentId(c.assignment.draft.comments[0]);
    c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "report", expectedNodeId: n.nodeId, artifact: { applicable: true } } });
    assert.equal(reviewCommentId(c.assignment.draft.comments[0]), commentId); assert.equal(currentReviewNode(c.assignment)?.kind, "open_review");
    await assert.rejects(reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote: "approve" }), /incomplete/);
    c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { body: "An additional issue", severity: "suggestion" } } });
    c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "report", expectedNodeId: currentReviewNode(c.assignment)!.nodeId, artifact: { applicable: true } } });
    const before = structuredClone(c.assignment.draft.comments);
    const submitted = await reviews.submitArtifactReviewAgentAssignment({ ...f.bound, vote: "approve" });
    assert.deepEqual(submitted.assignment.submitted!.comments, before);
    assert.equal(submitted.assignment.submitted!.comments.length, 2); assert.equal(reviewNodeProgress(submitted.assignment, submitted.assignment.status)?.phase, "submitted");
  });
  test(`${mode}: retry retains tree/progress and invalidates the previous Attempt`, async t => {
    const f = await fixture(t, graph), n = currentReviewNode(f.claimed.assignment)!;
    const c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "report", expectedNodeId: n.nodeId, artifact: { applicable: true, comments: [{ rulePath: n.asserts[0].rulePath, result: "not_satisfied", body: "Missing", severity: "risk" }] } } });
    await reviews.failArtifactReviewAgentAssignment({ ...f.bound, failure: { stage: "process", code: "fixture", message: "failed" } }); await reviews.retryArtifactReviewAgentAssignment(f.input);
    const next = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }))!;
    assert.deepEqual(next.assignment.nodeTree, c.assignment.nodeTree); assert.deepEqual(next.assignment.nodeStates, c.assignment.nodeStates); assert.deepEqual(next.assignment.draft.comments, JSON.parse(JSON.stringify(c.assignment.draft.comments)));
    await assert.rejects(reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-delete", commentId: reviewCommentId(c.assignment.draft.comments[0]) } }));
    assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment.nodeStates, c.assignment.nodeStates);
  });
  test(`${mode}: two Agent Reviewers keep separate progress, judgments and comments`, async t => {
    const f = await fixture(t, graph, true), otherInput = { ...f.input, actorId: "agent2" };
    const other = (await reviews.readArtifactReviewForActor(otherInput)).assignment;
    const n = currentReviewNode(f.claimed.assignment)!;
    await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "report", expectedNodeId: n.nodeId, artifact: { applicable: true, comments: [{ rulePath: n.asserts[0].rulePath, result: "not_satisfied", body: "Specific finding", severity: "risk" }] } } });
    assert.deepEqual((await reviews.readArtifactReviewForActor(otherInput)).assignment, other);
    assert.equal(reviewNodeProgress(other)?.processed, 0); assert.equal(other.draft.comments.length, 0);
  });
  test(`${mode}: simultaneous reports confirm only their fixed node`, async t => {
    const f = await fixture(t, graph), nodeId = currentReviewNode(f.claimed.assignment)!.nodeId;
    const input = { ...f.bound, mutation: { operation: "report" as const, expectedNodeId: nodeId, artifact: { applicable: true } } };
    const results = await Promise.allSettled([reviews.mutateArtifactReviewNodes(input), reviews.mutateArtifactReviewNodes(input)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(reviewNodeProgress((await reviews.readArtifactReviewForActor(f.input)).assignment)?.processed, 1);
  });
  test(`${mode}: Human writes canonical commentId and historical reads preserve file bytes`, async t => {
    const f = await fixture(t, graph), humanInput = { ...f.input, actorId: "human" };
    const before = await reviews.readArtifactReviewForActor(humanInput);
    const saved = await reviews.updateArtifactReviewDraft({ ...humanInput, expectedRevision: before.round.revision, draft: { vote: "approve", comments: [{ body: "Human finding", severity: "suggestion" }] } });
    const comment = saved.assignment.draft.comments[0]; assert.ok(comment.commentId); assert.equal(comment.id, undefined);
    const path = graph ? join(f.root, "data/context_control/reviews", f.runId, `${saved.assignment.id}.json`) : join(f.root, "runs", f.runId, `${f.runId}.json`);
    const row = JSON.parse(await readFile(path, "utf8"));
    const historical = graph ? row.value.comments[0] : row.artifactReviews[0].rounds[0].assignments.find((a: {actorId: string}) => a.actorId === "human").draft.comments[0];
    historical.id = historical.commentId; delete historical.commentId;
    await writeFile(path, JSON.stringify(row)); const bytes = await readFile(path, "utf8");
    const read = await reviews.readArtifactReviewForActor(humanInput);
    assert.equal(reviewCommentId(read.assignment.draft.comments[0]), comment.commentId);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
  test(`${mode}: stale report cannot confirm the successor node`, async t => {
    const f = await fixture(t, graph), nodeId = currentReviewNode(f.claimed.assignment)!.nodeId;
    const input = { ...f.bound, mutation: { operation: "report" as const, expectedNodeId: nodeId, artifact: { applicable: true } } };
    await reviews.mutateArtifactReviewNodes(input);
    await assert.rejects(reviews.mutateArtifactReviewNodes(input), /conflict/);
    assert.equal(reviewNodeProgress((await reviews.readArtifactReviewForActor(f.input)).assignment)?.processed, 1);
  });
}

test("flow freezes referenced Schema definitions and original Memory paths independently", async t => {
  const f = await fixture(t, false), memoryRoot = join(f.root, "memory");
  await mkdir(join(memoryRoot, "schemas"));
  for (const name of ["a", "b"]) await writeFile(join(memoryRoot, "schemas", `${name}.yaml`), withCurrentMemorySyntax(`!schema\nnames: [${name}]\ndefines: [Definition ${name}]\nasserts: [Rule ${name}]\n`));
  await writeFile(join(memoryRoot, "procedures/p.yaml"), withCurrentMemorySyntax(`!procedure\nnames: [p]\ndefines: [Procedure definition]\nflow:\n  - !action\n    action: Result\n    artifact: !artifact\n      name: Result\n      type: object\n      format: json\n      schema: !schema\n        names: [result]\n        defines: [Root definition]\n        fields:\n          - !ref {target: schemas/a}\n          - !ref {target: schemas/b}\n`));
  const run = await flow.startRun({ name: "Schema sources", memoryRoot, runsRoot: join(f.root, "runs"), procedureName: "p", controlPlane: f.controlPlane });
  const tree = createFlowReviewNodes(run, flow.currentStep(run)!);
  const nodes = allReviewNodes(tree.nodeTree);
  assert.deepEqual(nodes.find(n => n.source?.kind === "procedure")!.defines, ["Procedure definition"]);
  const schema = nodes.find(n => n.source?.path === "flow[0].artifact.schema")!;
  assert.deepEqual(schema.defines, ["Root definition"]);
  for (const name of ["a", "b"]) {
    const node = nodes.find(n => n.source?.memoryRef === `schemas/${name}`)!;
    assert.equal(node.source?.path, "."); assert.deepEqual(node.defines, [`Definition ${name}`]);
    assert.deepEqual(node.asserts, [{ rulePath: "asserts[0]", text: `Rule ${name}` }]);
  }
  assert.notEqual(nodes.find(n => n.name === "a")!.nodeId, nodes.find(n => n.name === "b")!.nodeId);
});
