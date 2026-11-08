// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import { openContextControl } from "../src/project/context-control.js";
import { currentReviewNode } from "../src/review-nodes.js";
import * as reviews from "../src/context_control/review-repository.js";

test("rewind preserves progressive Review history and rejects writes from its old Attempt", async t => {
  const f = await reviewNodeFixture(t, true);
  const service = (await openContextControl(f.root))!;
  const node = currentReviewNode(f.claimed.assignment)!;
  const changed = await reviews.mutateArtifactReviewNodes({ ...f.bound,
    mutation: { operation: "comment-add", nodeId: node.nodeId, artifact: { body: "Preserve this review evidence", severity: "suggestion" } }
  });
  const before = changed.assignment;
  const stepId = changed.review.stepId!;
  await service.withGraph(async g => {
    // This module fixture has no OS worker; its claim uses the test process as a placeholder.
    await g.mutateReview(f.runId, stepId, f.input.roundId, "agent", async review => {
      delete review.attempts!.at(-1)!.workerPid;
      delete review.attempts!.at(-1)!.workerIdentity;
    });
    await g.rewind(f.runId, stepId, "Revise candidate");
  });
  await assert.rejects(reviews.mutateArtifactReviewNodes({ ...f.bound,
    mutation: { operation: "comment-add", nodeId: node.nodeId, artifact: { body: "Late edit", severity: "suggestion" } }
  }), { code: "STEP_SUPERSEDED" });
  const history = await reviews.readArtifactReviewForActor(f.input);
  assert.equal(history.review.status, "cancelled");
  assert.deepEqual(history.assignment.nodeTree, before.nodeTree);
  assert.deepEqual(history.assignment.nodeStates, before.nodeStates);
  assert.deepEqual(history.assignment.draft.comments, before.draft.comments);
});
