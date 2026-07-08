import assert from "node:assert/strict";
import test from "node:test";
import { shouldRenderTaskStepArtifact } from "../src/view/browser.js";

test("task step artifact area is hidden when no event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact(undefined), false);
  assert.equal(shouldRenderTaskStepArtifact(null), false);
});

test("task step artifact area is shown when an event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact({ stepId: "flow-1", artifact: { value: "done" } }), true);
});
