import {
  artifactReviewOpinionReferencesImplementation,
  repeatedArtifactReviewAdvisories,
  type ArtifactReview,
  type ArtifactReviewRound
} from "../artifact-review.js";
import { authorizeArtifactOperation } from "../control-plane/index.js";
import type { RunState } from "../run/store.js";
import type {
  ArtifactReviewSummaryPromptModel,
  ReviewNextActionPromptModel
} from "./models.js";

export function buildArtifactReviewSummaryPromptModel(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound
): ArtifactReviewSummaryPromptModel {
  const submitted = round.assignments.filter((assignment) => assignment.status === "submitted").length;
  const advisoryComments = round.assignments
    .filter((assignment) => assignment.binding === "advisory")
    .flatMap((assignment) => assignment.submitted?.comments ?? []);
  const resolved = new Set((round.commentDispositions ?? []).map((item) => item.commentId));
  const runnerVote = round.votes.find((candidate) => candidate.subject.kind === "runner");
  const runnerCanDecide = Boolean(runnerVote) || authorizeArtifactOperation({
    controlPlane: review.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  }).allowed;

  return {
    reviewId: review.id,
    roundId: round.id,
    round: round.sequence,
    status: review.status,
    submitted,
    total: round.assignments.length,
    decisionReady: round.assignments.every((assignment) => assignment.status === "submitted"),
    advisory: {
      blocking: advisoryComments.filter((comment) => comment.severity === "blocking").length,
      risk: advisoryComments.filter((comment) => comment.severity === "risk").length,
      suggestion: advisoryComments.filter((comment) => comment.severity === "suggestion").length,
      unresolvedBlocking: advisoryComments.filter(
        (comment) => comment.severity === "blocking" && !resolved.has(comment.id)
      ).length
    },
    earlierArtifacts: review.submissions.find((candidate) => candidate.id === round.submissionId)
      ?.contextArtifacts.length ?? 0,
    repeatedAdvisories: repeatedArtifactReviewAdvisories(review).map((item) => ({
      severity: item.severity,
      count: item.count,
      rounds: item.rounds.join(","),
      body: item.body
    })),
    participants: round.assignments.map((assignment) => {
      return {
        actorName: assignment.actorName,
        binding: assignment.binding,
        vote: assignment.submitted?.vote ?? "pending",
        decisionIntent: assignment.binding === "decision" ? assignment.submitted?.summary : undefined,
        implementationEvidenceReferenced: assignment.submitted
          ? artifactReviewOpinionReferencesImplementation(assignment.submitted)
          : undefined,
        comments: (assignment.submitted?.comments ?? []).map((comment) => ({
          severity: comment.severity ?? "unspecified",
          body: comment.body
        }))
      };
    }),
    runner: runnerVote || runnerCanDecide ? {
      automatic: runnerVote?.automatic ?? false,
      vote: runnerVote?.value ?? "pending",
      comment: runnerVote?.comment
    } : undefined,
    decision: buildDecision(review, round, submitted)
  };
}

export function buildArtifactReviewNextActionPromptModel(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound,
  runId: string
): ReviewNextActionPromptModel {
  if (review.status === "passed") return { kind: "none" };
  if (review.status === "awaiting_runner_vote") {
    return {
      kind: "runner_vote",
      reviewId: review.id,
      roundId: round.id
    };
  }
  if (review.status === "awaiting_revision") return { kind: "revision", runId };
  const failed = round.assignments.find((assignment) => assignment.status === "failed");
  if (failed) return { kind: "none" };
  return { kind: "wait", reviewId: review.id };
}

function buildDecision(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound,
  submitted: number
): ArtifactReviewSummaryPromptModel["decision"] {
  if (review.status === "awaiting_runner_vote") {
    const decisionVotes = round.votes.filter(
      (vote) => vote.subject.kind === "actor" && vote.binding === "decision"
    );
    return {
      kind: "awaiting_runner",
      approved: decisionVotes.filter((vote) => vote.value === "approve").length,
      decisionTotal: decisionVotes.length,
      advisoryTotal: round.votes.filter((vote) => vote.binding === "advisory").length
    };
  }
  if (round.result) {
    return {
      kind: "result",
      passed: round.result.status === "passed",
      approved: round.result.decisionApprove,
      decisionTotal: round.result.decisionTotal,
      advisoryTotal: round.result.advisoryTotal
    };
  }
  const failedAssignments = round.assignments.filter((assignment) => assignment.status === "failed").length;
  if (failedAssignments) return { kind: "failed", failedAssignments };
  return { kind: "pending", remaining: round.assignments.length - submitted };
}
