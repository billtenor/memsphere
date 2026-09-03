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
export const artifactReviewSeverityValues = ["blocking", "risk", "suggestion"] as const;
export type ArtifactReviewSeverity = (typeof artifactReviewSeverityValues)[number];
export const artifactReviewDispositionValues = [
  "accepted-fixed",
  "accepted-followup",
  "rejected-out-of-scope",
  "rejected-not-blocking",
  "rejected-invalid"
] as const;
export type ArtifactReviewDispositionValue = (typeof artifactReviewDispositionValues)[number];
export type ArtifactReviewBinding = "decision" | "advisory";
export type ArtifactReviewStatus = "pending" | "awaiting_runner_vote" | "awaiting_revision" | "passed" | "cancelled";
export type ArtifactReviewRoundStatus = "pending" | "awaiting_runner_vote" | "passed" | "changes_requested" | "cancelled";

export type ArtifactReviewAnchor = {
  submissionId: string;
  target: string;
  location?: string;
  sourceHash: string;
  context?: string;
};

export type ArtifactReviewAgentAnchorInput = Omit<ArtifactReviewAnchor, "submissionId"> & {
  submissionId?: string;
};

export type ArtifactReviewComment = {
  id: string;
  body: string;
  severity?: ArtifactReviewSeverity;
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
  summary?: string;
  submittedAt: string;
  authorization: AuthorizationDecision;
  delegation?: {
    kind: "runner";
    runId: string;
    humanActorId: string;
    authorizationNote: string;
    authorization: AuthorizationDecision;
  };
};

export function artifactReviewOpinionReferencesImplementation(
  opinion: ArtifactReviewSubmittedOpinion | undefined
): boolean {
  if (!opinion) return false;
  const source = [
    opinion.summary,
    ...opinion.comments.flatMap((comment) => [
      comment.body,
      comment.anchor?.target,
      comment.anchor?.location
    ])
  ].filter((value): value is string => Boolean(value)).join("\n");
  return /\bimplementation\b|\b(?:src|test|tests)\/[^\s`]+|\bcode path\b|\bdiff\b/i.test(source);
}

export type ArtifactReviewAgentAttemptStatus = "queued" | "running" | "submitted" | "failed" | "cancelled";

export type ArtifactReviewAgentFailure = {
  stage: "spawn" | "initialize" | "auth" | "session" | "mode" | "cli" | "prompt" | "permission" | "timeout" | "protocol" | "process";
  code: string;
  message: string;
  category?: "environment" | "provider" | "reviewer" | "unknown";
};

export function artifactReviewFailureCategory(
  failure: ArtifactReviewAgentFailure
): NonNullable<ArtifactReviewAgentFailure["category"]> {
  if (failure.category) return failure.category;
  if (/listen EPERM|EACCES|ENOENT|timeout/i.test(failure.message)) return "environment";
  if (failure.stage === "spawn" || failure.stage === "initialize" || failure.stage === "protocol") return "provider";
  if (failure.stage === "cli" || failure.stage === "prompt" || failure.stage === "permission") return "reviewer";
  return "unknown";
}

export type ArtifactReviewCommentDisposition = {
  commentId: string;
  disposition: ArtifactReviewDispositionValue;
  note?: string;
  validationSummary?: string;
  updatedAt: string;
};

export type ArtifactReviewContextArtifact<TArtifact = unknown> = {
  stepId: string;
  artifact: TArtifact;
};

export type ArtifactReviewAgentAttempt = {
  id: string;
  sequence: number;
  status: ArtifactReviewAgentAttemptStatus;
  provider: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workerPid?: number;
  cliReadyAt?: string;
  promptVersion?: string;
  sessionId?: string;
  protocolVersion?: number;
  agentName?: string;
  agentVersion?: string;
  model?: string;
  stopReason?: string;
  failure?: ArtifactReviewAgentFailure;
};

export type ArtifactReviewAssignment = {
  id?: string;
  actorId: string;
  actorName: string;
  actorKind?: "human" | "agent";
  slotIds: string[];
  permissions: PermissionId[];
  binding: ArtifactReviewBinding;
  status: "draft" | "queued" | "running" | "submitted" | "failed" | "cancelled";
  draft: ArtifactReviewDraft;
  attempts?: ArtifactReviewAgentAttempt[];
  submitted?: ArtifactReviewSubmittedOpinion;
};

export type ArtifactReviewVote = {
  id: string;
  subject: { kind: "runner" } | { kind: "actor"; actorId: string };
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
  contextArtifacts: ArtifactReviewContextArtifact<TArtifact>[];
  revisionSummary?: ArtifactReviewRevisionSummary;
};

export type ArtifactReviewRoundResult = {
  status: "passed" | "changes_requested";
  completedAt: string;
  submitted: number;
  total: number;
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
  controlPlane?: ArtifactControlPlane;
  bindingSource?: {
    resolvedAt: string;
    slots: Record<string, {
      kind: "run-start" | "run-update";
      changeId?: string;
    }>;
  };
  assignments: ArtifactReviewAssignment[];
  votes: ArtifactReviewVote[];
  commentDispositions?: ArtifactReviewCommentDisposition[];
  result?: ArtifactReviewRoundResult;
};

export function artifactReviewRoundControlPlane<TArtifact>(
  review: ArtifactReview<TArtifact>,
  round: ArtifactReviewRound
): ArtifactControlPlane {
  return round.controlPlane ?? review.controlPlane;
}

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

export type ArtifactReviewRepeatedAdvisory = {
  severity: ArtifactReviewSeverity | "unspecified";
  body: string;
  count: number;
  rounds: number[];
};

export function repeatedArtifactReviewAdvisories<TArtifact>(
  review: ArtifactReview<TArtifact>
): ArtifactReviewRepeatedAdvisory[] {
  const groups = new Map<string, ArtifactReviewRepeatedAdvisory & { roundSet: Set<number> }>();
  for (const round of review.rounds) {
    for (const assignment of round.assignments) {
      if (assignment.binding !== "advisory") continue;
      for (const comment of assignment.submitted?.comments ?? []) {
        const body = comment.body.trim();
        const normalizedBody = body.replace(/\s+/g, " ").toLocaleLowerCase();
        if (!normalizedBody) continue;
        const severity = comment.severity ?? "unspecified";
        const key = `${severity}\u0000${normalizedBody}`;
        const group = groups.get(key) ?? {
          severity,
          body,
          count: 0,
          rounds: [],
          roundSet: new Set<number>()
        };
        group.count += 1;
        group.roundSet.add(round.sequence);
        groups.set(key, group);
      }
    }
  }
  return [...groups.values()]
    .filter((group) => group.count > 1)
    .map(({ roundSet, ...group }) => ({ ...group, rounds: [...roundSet].sort((left, right) => left - right) }))
    .sort((left, right) => right.count - left.count || left.body.localeCompare(right.body));
}

export type ArtifactReviewAssignmentSet = {
  assignments: ArtifactReviewAssignment[];
  runnerCanDecide: boolean;
};

export function createArtifactReviewAssignments(input: {
  snapshot: ControlPlaneSnapshot;
  controlPlane: ArtifactControlPlane;
  now: string;
}): ArtifactReviewAssignmentSet {
  const byActor = new Map<string, {
    actorName: string;
    slotIds: Set<string>;
    permissions: Set<PermissionId>;
  }>();

  for (const [slotId, binding] of Object.entries(input.controlPlane.bindings)) {
    if (binding.skipped) continue;
    for (const actorId of binding.actorIds) {
      const actor = input.snapshot.actors[actorId];
      const actorPermissions = input.controlPlane.permissions[actorId];
      if (!actor || !actorPermissions) continue;
      const existing = byActor.get(actorId) ?? {
        actorName: actor.name,
        slotIds: new Set<string>(),
        permissions: new Set<PermissionId>()
      };
      existing.slotIds.add(slotId);
      for (const permission of actorPermissions.effective) existing.permissions.add(permission);
      byActor.set(actorId, existing);
    }
  }

  const assignments: ArtifactReviewAssignment[] = [];
  for (const [actorId, merged] of [...byActor.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!merged.permissions.has("artifact.read")) continue;
    const canDecide = merged.permissions.has("decision.decide");
    const canAssess = merged.permissions.has("decision.assess");
    if (!canDecide && !canAssess) continue;
    const actor = input.snapshot.actors[actorId];
    const isAgent = actor?.kind === "agent";
    assignments.push({
      id: makeReviewEntityId("assignment", input.now),
      actorId,
      actorName: merged.actorName,
      actorKind: actor?.kind ?? "human",
      slotIds: [...merged.slotIds].sort(),
      permissions: [...merged.permissions].sort(),
      binding: canDecide ? "decision" : "advisory",
      status: isAgent ? "queued" : "draft",
      draft: { comments: [] },
      attempts: isAgent ? [{
        id: makeReviewEntityId("attempt", input.now),
        sequence: 1,
        status: "queued",
        provider: actor.agent.provider ?? "unconfigured",
        createdAt: input.now,
        promptVersion: "artifact-review-v2",
        model: actor.agent.model
      }] : undefined
    });
  }

  const runnerAuthorization = authorizeArtifactOperation({
    controlPlane: input.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  });
  const runnerCanDecide = runnerAuthorization.allowed;

  if (assignments.length === 0) {
    throw new Error("Artifact Review requires at least one Reviewer assignment");
  }
  if (!runnerCanDecide && !assignments.some((assignment) => assignment.binding === "decision")) {
    throw new Error("Artifact Review requires at least one decision.decide subject");
  }

  return { assignments, runnerCanDecide };
}

export function authorizeArtifactReviewActor(input: {
  controlPlane: ArtifactControlPlane;
  assignment: ArtifactReviewAssignment;
  permission: "artifact.read" | "decision.assess" | "decision.decide";
}): AuthorizationDecision {
  return authorizeArtifactOperation({
    controlPlane: input.controlPlane,
    subject: { kind: "actor", actorId: input.assignment.actorId },
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
    submitted: submitted.length,
    total: round.assignments.length,
    decisionApprove: decisionVotes.filter((vote) => vote.value === "approve").length,
    decisionTotal: decisionVotes.length,
    advisoryTotal: advisoryVotes.length
  };
}

export function submittedAssignmentVote(
  assignment: ArtifactReviewAssignment,
  authorization: AuthorizationDecision
): ArtifactReviewVote {
  if (!assignment.submitted) throw new Error(`Artifact Review assignment is not submitted: ${assignment.actorId}`);
  return {
    id: makeReviewEntityId("vote", assignment.submitted.submittedAt),
    subject: { kind: "actor", actorId: assignment.actorId },
    binding: assignment.binding,
    value: assignment.submitted.vote,
    automatic: false,
    authorization,
    submittedAt: assignment.submitted.submittedAt
  };
}

export function artifactReviewAssignmentId(assignment: ArtifactReviewAssignment): string {
  return assignment.id ?? assignment.actorId;
}

export function makeReviewEntityId(prefix: "review" | "submission" | "round" | "assignment" | "comment" | "vote" | "attempt", iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}`;
}
