import assert from "node:assert/strict";
import test from "node:test";
import { agentActivityPath } from "../src/acp/activity.js";


const ids = {
  runId: "run-activity",
  reviewId: "review-activity",
  roundId: "round-activity",
  assignmentId: "assignment-activity",
  attemptId: "attempt-activity"
};


test("Agent Activity paths reject caller-controlled traversal", () => {
  assert.throws(() => agentActivityPath({
    runsRoot: "/tmp",
    ...ids,
    attemptId: "../outside"
  }), /invalid Agent Activity identifier/);
});
