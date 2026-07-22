import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  artifactReviewAssignmentId,
  type ArtifactReviewAnchor,
  type ArtifactReviewSeverity,
  type ArtifactReviewVoteValue
} from "../artifact-review.js";
import { readConfig } from "../config.js";
import {
  appendArtifactReviewAgentComment,
  markArtifactReviewAgentCliReady,
  readArtifactReviewForIdentity,
  readRun,
  submitArtifactReviewAgentAssignment,
  type ArtifactReviewAgentContext,
  type RunEvent
} from "../run/store.js";
import { buildAgentReviewContract } from "./review-contract.js";

type BoundAgentReviewSession = {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  identityId: string;
  assignmentId: string;
  attemptId: string;
};

export async function agentReviewArtifactPayload(): Promise<unknown> {
  const binding = await boundAgentReviewSession();
  const context = await readBoundContext(binding);
  const submission = context.review.submissions.find((candidate) => candidate.id === context.round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${context.round.submissionId}`);
  return {
    artifact: await expandArtifact(binding.runsRoot, submission.artifact),
    package: submission.package ? {
      requirements: submission.package.requirements,
      evidence: await Promise.all(submission.package.evidence.map(async (item) => ({
        stepId: item.stepId,
        role: item.role,
        artifact: await expandArtifact(binding.runsRoot, item.artifact)
      })))
    } : undefined,
    revisionSummary: submission.revisionSummary
  };
}

export async function agentReviewArtifactContractPayload(): Promise<unknown> {
  const binding = await boundAgentReviewSession();
  return buildAgentReviewContract(await readBoundContext(binding));
}

export async function agentReviewAssignmentDetailPayload(): Promise<unknown> {
  const binding = await boundAgentReviewSession();
  const context = await readBoundContext(binding);
  return {
    status: context.assignment.status,
    binding: context.assignment.binding,
    roles: context.assignment.roleIds.map((roleId) => context.run.controlPlane?.roles[roleId]?.name ?? roleId),
    permissions: context.assignment.permissions,
    comments: context.assignment.submitted?.comments ?? context.assignment.draft.comments,
    vote: context.assignment.submitted?.vote,
    summary: context.assignment.submitted?.summary
  };
}

export async function addBoundAgentReviewComment(input: {
  body: string;
  severity: ArtifactReviewSeverity;
  anchor?: ArtifactReviewAnchor;
}): Promise<unknown> {
  const binding = await boundAgentReviewSession();
  const context = await appendArtifactReviewAgentComment({ ...binding, ...input });
  return agentAssignmentReceipt(context, "comment");
}

export async function submitBoundAgentReview(input: {
  vote: ArtifactReviewVoteValue;
  summary?: string;
}): Promise<unknown> {
  const binding = await boundAgentReviewSession();
  const context = await submitArtifactReviewAgentAssignment({ ...binding, ...input });
  return agentAssignmentReceipt(context, "submit");
}

async function boundAgentReviewSession(): Promise<BoundAgentReviewSession> {
  const configPath = requiredEnv("MEMSPHERE_CONFIG_PATH");
  const workspaceRoot = resolve(requiredEnv("MEMSPHERE_WORKSPACE_ROOT"));
  const runId = requiredEnv("MEMSPHERE_REVIEW_RUN_ID");
  const assignmentId = requiredEnv("MEMSPHERE_REVIEW_ASSIGNMENT_ID");
  const config = await readConfig(configPath);
  if (resolve(dirname(config.scopeRoot)) !== workspaceRoot) throw new Error("cli_workspace_mismatch");
  const run = await readRun(config.runsRoot, runId);
  for (const review of run.artifactReviews ?? []) {
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    const assignment = round?.assignments.find((candidate) => artifactReviewAssignmentId(candidate) === assignmentId);
    if (!round || !assignment) continue;
    const attempt = assignment.attempts?.at(-1);
    if (!attempt) throw new Error(`Agent Review attempt not found: ${assignmentId}`);
    await markArtifactReviewAgentCliReady({
      runsRoot: config.runsRoot,
      reviewId: review.id,
      roundId: round.id,
      identityId: assignment.identityId,
      attemptId: attempt.id
    });
    return {
      runsRoot: config.runsRoot,
      reviewId: review.id,
      roundId: round.id,
      identityId: assignment.identityId,
      assignmentId,
      attemptId: attempt.id
    };
  }
  throw new Error(`review_assignment_not_bound: ${assignmentId}`);
}

async function readBoundContext(binding: BoundAgentReviewSession): Promise<ArtifactReviewAgentContext> {
  const context = await readArtifactReviewForIdentity(binding);
  const attempt = context.assignment.attempts?.find((candidate) => candidate.id === binding.attemptId);
  if (!attempt) throw new Error(`Agent Review attempt not found: ${binding.attemptId}`);
  return { ...context, attempt };
}

async function expandArtifact(runsRoot: string, artifact: RunEvent["artifact"]): Promise<unknown> {
  const value = artifact.storage === "file" && artifact.path
    ? await readFile(join(runsRoot, artifact.path), "utf8")
    : artifact.value;
  return {
    name: artifact.name,
    type: artifact.type,
    format: artifact.format,
    final: artifact.final,
    reviewRole: artifact.reviewRole,
    storage: artifact.storage ?? (artifact.path ? "file" : "inline"),
    value,
    fields: artifact.fields,
    fileName: artifact.fileName,
    filePath: artifact.path ? resolve(runsRoot, artifact.path) : undefined,
    contentType: artifact.contentType,
    validation: artifact.validation
  };
}

function agentAssignmentReceipt(context: ArtifactReviewAgentContext, operation: "comment" | "submit"): unknown {
  return {
    reviewId: context.review.id,
    reviewRoundId: context.round.id,
    assignmentId: context.assignment.id,
    status: context.assignment.status,
    vote: context.assignment.submitted?.vote,
    commentCount: context.assignment.draft.comments.length,
    completed: operation === "submit",
    message: operation === "submit"
      ? "Assignment submitted successfully. Stop now; do not submit again."
      : "Comment saved."
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Agent Review Session environment is missing ${name}`);
  return value;
}
