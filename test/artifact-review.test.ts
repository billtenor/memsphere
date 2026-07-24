import assert from "node:assert/strict";
import test from "node:test";
import {
  createArtifactReviewAssignments,
  artifactReviewOpinionReferencesImplementation,
  evaluateArtifactReviewRound,
  repeatedArtifactReviewAdvisories,
  type ArtifactReview,
  type ArtifactReviewRound
} from "../src/artifact-review.js";
import {
  createControlPlaneSnapshot,
  resolveArtifactControlPlane,
  type ControlPlaneConfig
} from "../src/control-plane/index.js";

function fixture(input?: { runnerDecides?: boolean; humanDecides?: boolean }) {
  const config: ControlPlaneConfig = {
    runner: {
      permissions: ["artifact.read", "artifact.submit", ...(input?.runnerDecides === false ? [] : ["decision.decide"] as const)]
    },
    actors: {
      alice: {
        kind: "human",
        name: "Alice",
        permissions: ["artifact.read", "decision.assess", ...(input?.humanDecides === false ? [] : ["decision.decide"] as const)]
      },
      bot: {
        kind: "agent",
        name: "Bot",
        permissions: ["artifact.read", "decision.assess"],
        agent: { command: "bot", args: [] }
      }
    }
  };
  const snapshot = createControlPlaneSnapshot(config);
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: {
      "fixture::reader": { actorIds: ["alice", "bot"], source: "run:fixture::reader" },
      "fixture::reviewer": { actorIds: ["alice", "bot"], source: "run:fixture::reviewer" }
    },
    artifactScope: "fixture#flow[1]",
    policyId: "artifact_acceptance.unanimous"
  });
  return { snapshot, controlPlane };
}

test("Artifact Review merges Slots and creates Human and Agent assignments", () => {
  const { snapshot, controlPlane } = fixture();
  const result = createArtifactReviewAssignments({
    snapshot,
    controlPlane,
    now: "2026-07-21T00:00:00.000Z"
  });
  assert.equal(result.assignments.length, 2);
  const human = result.assignments.find((assignment) => assignment.actorId === "alice");
  const agent = result.assignments.find((assignment) => assignment.actorId === "bot");
  assert.deepEqual(human?.slotIds, ["fixture::reader", "fixture::reviewer"]);
  assert.equal(human?.binding, "decision");
  assert.equal(human?.status, "draft");
  assert.equal(agent?.actorKind, "agent");
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
      actorId: "advisor",
      actorName: "Advisor",
      slotIds: ["advisor"],
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
      subject: { kind: "actor", actorId: "advisor" },
      binding: "advisory",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }]
  };
  assert.equal(evaluateArtifactReviewRound(round, "2026-07-21T00:02:00.000Z")?.status, "passed");

  round.assignments.push({
    actorId: "decider",
    actorName: "Decider",
    slotIds: ["decider"],
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
      subject: { kind: "actor", actorId: "human" },
      binding: "decision",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }]
  };
  assert.equal(evaluateArtifactReviewRound(round, "2026-07-21T00:02:00.000Z")?.status, "changes_requested");
});

test("repeated advisory comments aggregate across review rounds", () => {
  const advisory = (sequence: number): ArtifactReviewRound => ({
    id: `round-${sequence}`,
    sequence,
    submissionId: `submission-${sequence}`,
    status: "changes_requested",
    revision: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [{
      actorId: "advisor",
      actorName: "Advisor",
      slotIds: ["advisor"],
      permissions: ["artifact.read", "decision.assess"],
      binding: "advisory",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        comments: [{
          id: `comment-${sequence}`,
          body: sequence === 1 ? "Validate the retry path." : "  validate   the retry path. ",
          severity: "risk",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z"
        }],
        vote: "request_changes",
        submittedAt: "2026-07-21T00:00:00.000Z",
        authorization: {} as never
      }
    }],
    votes: []
  });
  const review = { rounds: [advisory(1), advisory(2)] } as ArtifactReview;
  assert.deepEqual(repeatedArtifactReviewAdvisories(review), [{
    severity: "risk",
    body: "Validate the retry path.",
    count: 2,
    rounds: [1, 2]
  }]);
});

test("submitted opinions expose whether implementation evidence was referenced", () => {
  const opinion = {
    comments: [],
    vote: "approve" as const,
    summary: "Reviewed src/run/store.ts and the implementation diff.",
    submittedAt: "2026-07-21T00:00:00.000Z",
    authorization: {} as never
  };
  assert.equal(artifactReviewOpinionReferencesImplementation(opinion), true);
  assert.equal(artifactReviewOpinionReferencesImplementation({ ...opinion, summary: "The requirement text is clear." }), false);
});
