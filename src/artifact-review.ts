import { randomUUID } from "node:crypto";
import {
  authorizeArtifactOperation,
  type ArtifactControlPlane,
  type AuthorizationDecision,
  type ControlPlaneSnapshot
} from "./control-plane/index.js";
import type { PermissionId } from "./control-plane/catalog.js";

export const artifactReviewVoteValues = ["approve", "request_changes", "abstain"] as const;
export type ArtifactReviewVoteValue = (typeof artifactReviewVoteValues)[number];
export type ArtifactReviewBinding = "decision" | "advisory";
export type ArtifactReviewStatus = "pending" | "awaiting_runner_vote" | "awaiting_revision" | "passed";
export type ArtifactReviewRoundStatus = "pending" | "awaiting_runner_vote" | "passed" | "changes_requested";

export type ArtifactReviewAnchor = {
  target: string;
  location?: string;
  sourceHash: string;
};

export type ArtifactReviewComment = {
  id: string;
  body: string;
  anchor?: ArtifactReviewAnchor;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactReviewDraft = {
  comments: ArtifactReviewComment[];
  vote?: ArtifactReviewVoteValue;
  updatedAt?: string;
};

export type ArtifactReviewSubmittedOpinion = {
  comments: ArtifactReviewComment[];
  vote: ArtifactReviewVoteValue;
  submittedAt: string;
  authorization: AuthorizationDecision;
};

export type ArtifactReviewAssignment = {
  identityId: string;
  identityName: string;
  roleIds: string[];
  permissions: PermissionId[];
  binding: ArtifactReviewBinding;
  status: "draft" | "submitted";
  draft: ArtifactReviewDraft;
  submitted?: ArtifactReviewSubmittedOpinion;
};

export type ArtifactReviewVote = {
  id: string;
  subject: { kind: "runner" } | { kind: "identity"; identityId: string };
  binding: ArtifactReviewBinding;
  value: ArtifactReviewVoteValue;
  automatic: boolean;
  comment?: string;
  authorization: AuthorizationDecision;
  submittedAt: string;
};

export type ArtifactReviewRevisionSummary = {
  body: string;
  digest: string;
  createdAt: string;
  previousSubmissionId: string;
};

export type ArtifactReviewSubmission<TArtifact = unknown> = {
  id: string;
  digest: string;
  createdAt: string;
  artifact: TArtifact;
  revisionSummary?: ArtifactReviewRevisionSummary;
};

export type ArtifactReviewRoundResult = {
  status: "passed" | "changes_requested";
  completedAt: string;
  humanSubmitted: number;
  humanTotal: number;
  decisionApprove: number;
  decisionTotal: number;
  advisoryTotal: number;
};

export type ArtifactReviewRound = {
  id: string;
  sequence: number;
  submissionId: string;
  status: ArtifactReviewRoundStatus;
  revision: number;
  createdAt: string;
  assignments: ArtifactReviewAssignment[];
  votes: ArtifactReviewVote[];
  result?: ArtifactReviewRoundResult;
};

export type ArtifactReviewOutcome = {
  status: "passed";
  submissionId: string;
  roundId: string;
  completedAt: string;
};

export type ArtifactReview<TArtifact = unknown> = {
  id: string;
  stepId: string;
  artifactName: string;
  policyId: string;
  controlPlane: ArtifactControlPlane;
  status: ArtifactReviewStatus;
  currentRoundId: string;
  createdAt: string;
  updatedAt: string;
  submissions: ArtifactReviewSubmission<TArtifact>[];
  rounds: ArtifactReviewRound[];
  outcome?: ArtifactReviewOutcome;
};

export type ArtifactReviewAssignmentSet = {
  assignments: ArtifactReviewAssignment[];
  runnerCanDecide: boolean;
};

export function createArtifactReviewAssignments(input: {
  snapshot: ControlPlaneSnapshot;
  controlPlane: ArtifactControlPlane;
  now: string;
}): ArtifactReviewAssignmentSet {
  const byIdentity = new Map<string, {
    identityName: string;
    roleIds: Set<string>;
    permissions: Set<PermissionId>;
  }>();

  for (const [roleId, binding] of Object.entries(input.controlPlane.bindings)) {
    const rolePermissions = input.controlPlane.permissions[roleId];
    if (!rolePermissions) continue;
    for (const identityId of binding.identityIds) {
      const identity = input.snapshot.identities[identityId];
      if (!identity || identity.kind !== "human") continue;
      const existing = byIdentity.get(identityId) ?? {
        identityName: identity.name,
        roleIds: new Set<string>(),
        permissions: new Set<PermissionId>()
      };
      existing.roleIds.add(roleId);
      for (const permission of rolePermissions.effective) existing.permissions.add(permission);
      byIdentity.set(identityId, existing);
    }
  }

  const assignments: ArtifactReviewAssignment[] = [];
  for (const [identityId, merged] of [...byIdentity.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!merged.permissions.has("artifact.read")) continue;
    const canDecide = merged.permissions.has("decision.decide");
    const canAssess = merged.permissions.has("decision.assess");
    if (!canDecide && !canAssess) continue;
    assignments.push({
      identityId,
      identityName: merged.identityName,
      roleIds: [...merged.roleIds].sort(),
      permissions: [...merged.permissions].sort(),
      binding: canDecide ? "decision" : "advisory",
      status: "draft",
      draft: { comments: [] }
    });
  }

  const runnerAuthorization = authorizeArtifactOperation({
    controlPlane: input.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  });
  const runnerCanDecide = runnerAuthorization.allowed;

  if (assignments.length === 0) {
    throw new Error("Artifact Review requires at least one Human assignment");
  }
  if (!runnerCanDecide && !assignments.some((assignment) => assignment.binding === "decision")) {
    throw new Error("Artifact Review requires at least one decision.decide subject");
  }

  return { assignments, runnerCanDecide };
}

export function authorizeArtifactReviewIdentity(input: {
  controlPlane: ArtifactControlPlane;
  assignment: ArtifactReviewAssignment;
  permission: "artifact.read" | "decision.assess" | "decision.decide";
}): AuthorizationDecision {
  for (const roleId of input.assignment.roleIds) {
    const decision = authorizeArtifactOperation({
      controlPlane: input.controlPlane,
      subject: { kind: "identity", identityId: input.assignment.identityId, roleId },
      permission: input.permission
    });
    if (decision.allowed) return decision;
  }
  const roleId = input.assignment.roleIds[0] ?? "";
  return authorizeArtifactOperation({
    controlPlane: input.controlPlane,
    subject: { kind: "identity", identityId: input.assignment.identityId, roleId },
    permission: input.permission
  });
}

export function evaluateArtifactReviewRound(round: ArtifactReviewRound, now: string): ArtifactReviewRoundResult | undefined {
  const submitted = round.assignments.filter((assignment) => assignment.status === "submitted");
  if (submitted.length !== round.assignments.length) return undefined;

  const decisionVotes = round.votes.filter((vote) => vote.binding === "decision");
  const advisoryVotes = round.votes.filter((vote) => vote.binding === "advisory");
  if (decisionVotes.length === 0) throw new Error("Artifact Review Round has no decision votes");
  const passed = decisionVotes.every((vote) => vote.value === "approve");
  return {
    status: passed ? "passed" : "changes_requested",
    completedAt: now,
    humanSubmitted: submitted.length,
    humanTotal: round.assignments.length,
    decisionApprove: decisionVotes.filter((vote) => vote.value === "approve").length,
    decisionTotal: decisionVotes.length,
    advisoryTotal: advisoryVotes.length
  };
}

export function submittedAssignmentVote(
  assignment: ArtifactReviewAssignment,
  authorization: AuthorizationDecision
): ArtifactReviewVote {
  if (!assignment.submitted) throw new Error(`Artifact Review assignment is not submitted: ${assignment.identityId}`);
  return {
    id: makeReviewEntityId("vote", assignment.submitted.submittedAt),
    subject: { kind: "identity", identityId: assignment.identityId },
    binding: assignment.binding,
    value: assignment.submitted.vote,
    automatic: false,
    authorization,
    submittedAt: assignment.submitted.submittedAt
  };
}

export function makeReviewEntityId(prefix: "review" | "submission" | "round" | "comment" | "vote", iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}`;
}
