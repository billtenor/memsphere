import assert from "node:assert/strict";
import test from "node:test";
import { explorationReviewerOptions } from "../src/context_control/exploration-contract.js";
import { explorationReviewHandle, explorationReviewIdentity } from "../src/context_control/exploration-review.js";
import type { ControlPlaneActor, PermissionId } from "../src/control-plane/index.js";

test("exploration Review handles keep Run and record identity separate", () => {
  const runId = "run-123-abcd", recordId = "review-" + "a".repeat(32);
  assert.deepEqual(explorationReviewIdentity(explorationReviewHandle(runId, recordId)), { runId, recordId });
  assert.equal(explorationReviewIdentity(`graph-review-${runId}__step-123`), undefined);
  for (const handle of [
    explorationReviewHandle("run-/other", recordId),
    explorationReviewHandle(runId, recordId.slice(0, -1)),
    explorationReviewHandle(runId, recordId + "__extra")
  ]) assert.throws(() => explorationReviewIdentity(handle), /Invalid exploration Review handle/);
});

test("reviewer choices require an Agent with read and assessment or decision permission", () => {
  const agent = (name: string, permissions: PermissionId[]): ControlPlaneActor => ({
    kind: "agent", name, permissions,
    agent: { provider: "codex", providerType: "codex", command: "codex",
      args: [], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: null, maxRuntimeMs: null }
  });
  assert.deepEqual(explorationReviewerOptions({}), [{ value: "runner", name: "Runner" }]);
  assert.deepEqual(explorationReviewerOptions({ controlPlane: {
    runner: { permissions: ["artifact.read", "decision.decide"] },
    acpProviders: {},
    actors: {
      human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] },
      noRead: agent("No read permission", ["decision.assess"]),
      readOnly: agent("Read only", ["artifact.read"]),
      adviser: agent("Adviser", ["artifact.read", "decision.assess"]),
      decider: agent("", ["artifact.read", "decision.decide"])
    }
  } }), [
    { value: "runner", name: "Runner" },
    { value: "project:adviser", name: "Adviser" },
    { value: "project:decider", name: "decider" }
  ]);
});
