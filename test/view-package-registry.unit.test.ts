import assert from "node:assert/strict";
import test from "node:test";
import { compareViewCandidatePriority, OFFICIAL_VIEW_CANDIDATE_PRIORITY } from "../src/module/package-registry.js";


test("candidate comparison uses integer tuples and the official fallback stays at 1000", () => {
  assert.equal(OFFICIAL_VIEW_CANDIDATE_PRIORITY, 1000);
  assert.ok(compareViewCandidatePriority([999, 99], [1000, 0]) < 0);
  assert.ok(compareViewCandidatePriority([100, 0], [100, 1]) < 0);
});
