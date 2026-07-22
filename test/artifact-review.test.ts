import assert from "node:assert/strict";
import test from "node:test";
import {
  createArtifactReviewAssignments,
  evaluateArtifactReviewRound,
  type ArtifactReviewRound
} from "../src/artifact-review.js";
import {
  createControlPlaneSnapshot,
  resolveArtifactControlPlane,
  type ControlPlaneConfig
} from "../src/control-plane/index.js";

function fixture(input?: { runnerDecides?: boolean; humanDecides?: boolean }) {
  const config: ControlPlaneConfig = {
    identities: {
      alice: { kind: "human", name: "Alice" },
      bot: { kind: "agent", name: "Bot", agent: { command: "bot", args: [] } }
    },
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read", "artifact.submit", ...(input?.runnerDecides === false ? [] : ["decision.decide"] as const)],
        grantablePermissions: []
      },
      reader: {
        name: "Reader",
        permissions: ["artifact.read"],
        grantablePermissions: []
      },
      reviewer: {
        name: "Reviewer",
        permissions: ["decision.assess", ...(input?.humanDecides === false ? [] : ["decision.decide"] as const)],
        grantablePermissions: []
      }
    }
  };
  const snapshot = createControlPlaneSnapshot(config);
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    procedureBindings: {
      reader: { identityIds: ["alice", "bot"], source: "procedure" },
      reviewer: { identityIds: ["alice", "bot"], source: "procedure" }
    },
    artifactScope: "fixture#flow[1]",
    artifactBindingSource: "artifact",
    artifactGrantSource: "artifact"
  });
  return { snapshot, controlPlane };
}

test("Artifact Review merges roles and creates Human and Agent assignments", () => {
  const { snapshot, controlPlane } = fixture();
  const result = createArtifactReviewAssignments({
    snapshot,
    controlPlane,
    now: "2026-07-21T00:00:00.000Z"
  });
  assert.equal(result.assignments.length, 2);
  const human = result.assignments.find((assignment) => assignment.identityId === "alice");
  const agent = result.assignments.find((assignment) => assignment.identityId === "bot");
  assert.deepEqual(human?.roleIds, ["reader", "reviewer"]);
  assert.equal(human?.binding, "decision");
  assert.equal(human?.status, "draft");
  assert.equal(agent?.identityKind, "agent");
  assert.equal(agent?.status, "queued");
  assert.equal(agent?.attempts?.[0]?.status, "queued");
  assert.match(agent?.id ?? "", /^assignment-/);
  assert.equal(result.runnerCanDecide, true);
});

test("Artifact Review rejects missing Reviewer assignments and missing deciders", () => {
  const { snapshot, controlPlane } = fixture({ runnerDecides: false, humanDecides: false });
  assert.throws(() => createArtifactReviewAssignments({
    snapshot,
    controlPlane,
    now: "2026-07-21T00:00:00.000Z"
  }), /decision\.decide/);

  controlPlane.bindings = {};
  assert.throws(() => createArtifactReviewAssignments({
    snapshot,
    controlPlane,
    now: "2026-07-21T00:00:00.000Z"
  }), /Reviewer assignment/);
});

test("unanimous waits for all Humans and ignores advisory rejection", () => {
  const round: ArtifactReviewRound = {
    id: "round-1",
    sequence: 1,
    submissionId: "submission-1",
    status: "pending",
    revision: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [{
      identityId: "advisor",
      identityName: "Advisor",
      roleIds: ["advisor"],
      permissions: ["artifact.read", "decision.assess"],
      binding: "advisory",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        comments: [],
        vote: "request_changes",
        submittedAt: "2026-07-21T00:01:00.000Z",
        authorization: {} as never
      }
    }],
    votes: [{
      id: "vote-runner",
      subject: { kind: "runner" },
      binding: "decision",
      value: "approve",
      automatic: true,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:00:00.000Z"
    }, {
      id: "vote-advisor",
      subject: { kind: "identity", identityId: "advisor" },
      binding: "advisory",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }]
  };
  assert.equal(evaluateArtifactReviewRound(round, "2026-07-21T00:02:00.000Z")?.status, "passed");

  round.assignments.push({
    identityId: "decider",
    identityName: "Decider",
    roleIds: ["decider"],
    permissions: ["artifact.read", "decision.decide"],
    binding: "decision",
    status: "draft",
    draft: { comments: [], vote: "approve" }
  });
  assert.equal(evaluateArtifactReviewRound(round, "2026-07-21T00:03:00.000Z"), undefined);
});

test("unanimous fails when a Human decider requests changes", () => {
  const round: ArtifactReviewRound = {
    id: "round-1",
    sequence: 1,
    submissionId: "submission-1",
    status: "pending",
    revision: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [],
    votes: [{
      id: "vote-runner",
      subject: { kind: "runner" },
      binding: "decision",
      value: "approve",
      automatic: true,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:00:00.000Z"
    }, {
      id: "vote-human",
      subject: { kind: "identity", identityId: "human" },
      binding: "decision",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }]
  };
  assert.equal(evaluateArtifactReviewRound(round, "2026-07-21T00:02:00.000Z")?.status, "changes_requested");
});
