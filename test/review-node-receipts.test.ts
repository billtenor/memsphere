import assert from "node:assert/strict";
import test from "node:test";
import { reviewCliFixture } from "./helpers/review-node-cli.js";
import { currentReviewNode, reviewCommentId } from "../src/review-nodes.js";
import * as reviews from "../src/context_control/review-repository.js";

test("report receipt identifies the completed node and generated comments alongside the next prompt", async t => {
  const f = await reviewCliFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  const receipt = f.cli(["continue", "report", "--artifact", JSON.stringify({ applicable: true, comments: [{ rulePath: n.asserts[0].rulePath, result: "not_satisfied", body: "Missing evidence", severity: "risk" }] }), "--output", "json"]);
  assert.equal(receipt.savedNodeId, n.nodeId); assert.equal(receipt.savedCommentIds.length, 1);
  const c = await reviews.readArtifactReviewForActor(f.input);
  assert.deepEqual(receipt.savedCommentIds, c.assignment.draft.comments.map(reviewCommentId));
  assert.equal(receipt.node.kind, "open_review"); assert.equal(receipt.progress.processed, 1);
  assert.equal(JSON.stringify(receipt).includes("Missing evidence"), false, "previous body is not repeated with the next prompt");
});

test("report receipt retains the identity of comments saved before reporting", async t => {
  const f = await reviewCliFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  const c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Need evidence", severity: "risk" } } });
  const receipt = f.cli(["run", "review", "report", "--artifact", '{"applicable":true}', "--output", "json"]);
  assert.equal(receipt.savedNodeId, n.nodeId); assert.deepEqual(receipt.savedCommentIds, c.assignment.draft.comments.map(reviewCommentId));
});

test("future-node comment receipts support immediate update and delete without an extra query or progression", async t => {
  const f = await reviewCliFixture(t), current = currentReviewNode(f.claimed.assignment)!, future = f.claimed.assignment.nodeTree!.root.children.at(-1)!;
  const add = f.cli(["continue", "comment", "add", "--node", future.nodeId, "--artifact", JSON.stringify({ body: 'Extra "中文"\nissue', severity: "risk" }), "--output", "json"]);
  assert.equal(add.savedNodeId, future.nodeId); assert.equal(add.savedCommentIds.length, 1); assert.equal(add.node.nodeId, current.nodeId); assert.equal(add.progress.processed, 0);
  const id = add.savedCommentIds[0]; assert.equal(typeof id, "string");
  const update = f.cli(["run", "review", "comment", "update", "--comment", id, "--artifact", '{"body":"Updated"}', "--output", "json"]);
  assert.equal(update.savedNodeId, future.nodeId); assert.equal(update.commentId, id); assert.deepEqual(update.savedCommentIds, [id]); assert.equal(update.progress.processed, 0);
  const deleted = f.cli(["continue", "comment", "delete", "--comment", id, "--output", "json"]);
  assert.equal(deleted.savedNodeId, future.nodeId); assert.equal(deleted.commentId, id); assert.deepEqual(deleted.savedCommentIds, []); assert.equal(deleted.progress.processed, 0);
  assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment.draft.comments, []);
});

test("updating a reported node returns its own identity while keeping the current prompt and progress", async t => {
  const f = await reviewCliFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "report", expectedNodeId: n.nodeId, artifact: { applicable: true } } });
  const receipt = f.cli(["continue", "update", "--node", n.nodeId, "--artifact", JSON.stringify({ applicable: false, comments: [{ body: "Outside role", severity: "suggestion" }] }), "--output", "json"]);
  assert.equal(receipt.savedNodeId, n.nodeId); assert.equal(receipt.savedCommentIds.length, 1); assert.equal(receipt.node.kind, "open_review"); assert.equal(receipt.progress.processed, 1);
});
