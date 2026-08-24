import {
  artifactReviewOpinionReferencesImplementation,
  repeatedArtifactReviewAdvisories,
  type ArtifactReview,
  type ArtifactReviewRound
} from "../artifact-review.js";
import type { RunState } from "../run/store.js";
import type { PromptLocale } from "./locale.js";
import type {
  ArtifactReviewSummaryPromptModel,
  RunReviewVoteReceiptPromptModel,
  ReviewNextActionPromptModel
} from "./models.js";

export function buildRunReviewVoteReceiptPromptModel(
  vote: "approve" | "request_changes",
  locale: PromptLocale
): RunReviewVoteReceiptPromptModel {
  return {
    vote: localize(locale, vote),
    requiresRevision: vote === "request_changes"
  };
}

export function buildArtifactReviewSummaryPromptModel(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound,
  locale: PromptLocale = "en"
): ArtifactReviewSummaryPromptModel {
  const submitted = round.assignments.filter((assignment) => assignment.status === "submitted").length;
  const advisoryComments = round.assignments
    .filter((assignment) => assignment.binding === "advisory")
    .flatMap((assignment) => assignment.submitted?.comments ?? []);
  const resolved = new Set((round.commentDispositions ?? []).map((item) => item.commentId));
  return {
    reviewId: review.id,
    roundId: round.id,
    round: round.sequence,
    status: localize(locale, review.status),
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
      severity: localize(locale, item.severity),
      count: item.count,
      rounds: item.rounds.join(","),
      body: item.body
    })),
    participants: round.assignments.map((assignment) => {
      return {
        actorName: assignment.actorName,
        binding: localize(locale, assignment.binding),
        vote: localize(locale, assignment.submitted?.vote ?? "pending"),
        decisionIntent: assignment.binding === "decision" ? assignment.submitted?.summary : undefined,
        implementationEvidenceReferenced: assignment.submitted
          ? artifactReviewOpinionReferencesImplementation(assignment.submitted)
          : undefined,
        comments: (assignment.submitted?.comments ?? []).map((comment) => ({
          severity: localize(locale, comment.severity ?? "unspecified"),
          body: comment.body
        }))
      };
    }),
    decision: buildDecision(review, round, submitted)
  };
}

function localize(locale: PromptLocale, value: string): string {
  if (locale === "en") return value;
  return {
    pending: "待提交",
    awaiting_runner_vote: "等待 Runner 投票",
    awaiting_revision: "等待修改",
    passed: "已通过",
    cancelled: "已取消",
    approve: "通过",
    request_changes: "要求修改",
    abstain: "弃权",
    advisory: "建议",
    decision: "决策",
    blocking: "阻塞",
    risk: "风险",
    suggestion: "建议",
    unspecified: "未指定"
  }[value] ?? value;
}

export function buildArtifactReviewNextActionPromptModel(
  review: ArtifactReview<RunState["events"][number]["artifact"]>,
  round: ArtifactReviewRound,
  runId: string
): ReviewNextActionPromptModel {
  if (review.status === "passed" || review.status === "cancelled") return { kind: "none" };
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
  if (review.status === "cancelled") return { kind: "cancelled" };
  if (review.status === "awaiting_runner_vote") {
    const decisionVotes = round.votes.filter(
      (vote) => vote.subject.kind === "actor" && vote.binding === "decision"
    );
    const advisoryVotes = round.votes.filter((vote) => vote.binding === "advisory");
    return {
      kind: "awaiting_runner",
      approved: decisionVotes.filter((vote) => vote.value === "approve").length,
      decisionTotal: decisionVotes.length,
      advisoryTotal: advisoryVotes.length,
      advisoryRequestChanges: advisoryVotes.filter((vote) => vote.value === "request_changes").length
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
