import { currentReviewNode, reviewNodeView, reviewNodeProgress, nodeSubmitSchema, type NodeMutation, type ReviewNodeState } from "../review-nodes.js";
import { requireRunContent } from "../project/run-data.js";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  artifactReviewAssignmentId,
  type ArtifactReviewAgentAnchorInput,
  type ArtifactReviewSeverity,
  type ArtifactReviewVoteValue
} from "../artifact-review.js";
import { readConfig } from "../config.js";
import {
  appendArtifactReviewAgentComment,
  mutateArtifactReviewNodes,
  markArtifactReviewAgentCliReady,
  readArtifactReviewForActor,
  readRun,
  submitArtifactReviewAgentAssignment,
  type ArtifactReviewAgentContext,
  type RunEvent
} from "../context_control/review-repository.js";
import { buildAgentReviewContract } from "./review-contract.js";

type BoundAgentReviewSession = {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
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
    contextArtifacts: await Promise.all(submission.contextArtifacts.map(async (item) => ({
      stepId: item.stepId,
      ...(item.artifactId ? { artifactId: item.artifactId } : {}),
      artifact: await expandArtifact(binding.runsRoot, item.artifact)
    }))),
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
    reviewProgress: reviewNodeProgress(context.assignment, context.assignment.status),
    binding: context.assignment.binding,
    slots: [...context.assignment.slotIds],
    permissions: context.assignment.permissions,
    comments: context.assignment.submitted?.comments ?? context.assignment.draft.comments,
    vote: context.assignment.submitted?.vote,
    summary: context.assignment.submitted?.summary
  };
}

export async function addBoundAgentReviewComment(input: {
  body: string;
  severity: ArtifactReviewSeverity;
  anchor?: ArtifactReviewAgentAnchorInput;
}): Promise<unknown> {
  const binding = await boundAgentReviewSession(true);
  if ((await readBoundContext(binding)).assignment.nodeTree) throw new Error("review_node_artifact_protocol_required");
  const context = await appendArtifactReviewAgentComment({ ...binding, ...input });
  return agentAssignmentReceipt(context, "comment");
}

export async function submitBoundAgentReview(input: {
  vote: ArtifactReviewVoteValue;
  summary?: string;
}): Promise<unknown> {
  const binding = await boundAgentReviewSession(true);
  const context = await submitArtifactReviewAgentAssignment({ ...binding, ...input });
  return agentAssignmentReceipt(context, "submit");
}

async function boundAgentReviewSession(write = false): Promise<BoundAgentReviewSession> {
  const configPath = requiredEnv("MEMSPHERE_CONFIG_PATH");
  const workspaceRoot = resolve(requiredEnv("MEMSPHERE_WORKSPACE_ROOT"));
  const runId = requiredEnv("MEMSPHERE_REVIEW_RUN_ID");
  const assignmentId = requiredEnv("MEMSPHERE_REVIEW_ASSIGNMENT_ID");
  const config = await readConfig(configPath);
  const currentDirectory = resolve(process.cwd());
  const workspaceRelative = relative(workspaceRoot, currentDirectory);
  if (workspaceRelative.startsWith("..") || isAbsolute(workspaceRelative)) {
    throw new Error("cli_workspace_mismatch");
  }
  const run = await readRun(config.runsRoot, runId);
  for (const review of run.artifactReviews ?? []) {
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    const assignment = round?.assignments.find((candidate) => artifactReviewAssignmentId(candidate) === assignmentId);
    if (!round || !assignment) continue;
    const attemptId = process.env.MEMSPHERE_REVIEW_ATTEMPT_ID;
    if (assignment.nodeTree && !attemptId) throw new Error("review_attempt_binding_required");
    const attempt = attemptId ? assignment.attempts?.find(a => a.id === attemptId) : assignment.attempts?.at(-1);
    if (!attempt) throw new Error(`Agent Review attempt not found: ${assignmentId}`);
    if (write && (assignment.attempts?.at(-1)?.id !== attempt?.id || assignment.status !== "running")) throw new Error("review_attempt_not_current");
    if (write) await markArtifactReviewAgentCliReady({
      runsRoot: config.runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      attemptId: attempt.id
    });
    return {
      runsRoot: config.runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      assignmentId,
      attemptId: attempt.id
    };
  }
  throw new Error(`review_assignment_not_bound: ${assignmentId}`);
}

async function readBoundContext(binding: BoundAgentReviewSession): Promise<ArtifactReviewAgentContext> {
  const context = await readArtifactReviewForActor(binding);
  const attempt = context.assignment.attempts?.find((candidate) => candidate.id === binding.attemptId);
  if (!attempt) throw new Error(`Agent Review attempt not found: ${binding.attemptId}`);
  return { ...context, attempt };
}

async function expandArtifact(runsRoot: string, artifact: RunEvent["artifact"]): Promise<unknown> {
  const value = artifact.storage === "file" && artifact.path
    ? (await requireRunContent(runsRoot, "artifact", artifact.path)).toString("utf8")
    : artifact.value;
  return {
    name: artifact.name,
    type: artifact.type,
    format: artifact.format,
    final: artifact.final,
    storage: artifact.storage ?? (artifact.path ? "file" : "inline"),
    value,
    fields: artifact.fields,
    fileName: artifact.fileName,
    filePath: artifact.path ? resolve(runsRoot, artifact.path) : undefined,
    contentType: artifact.contentType,
    validation: artifact.validation,
    modelTarget: artifact.modelTarget,
    modelData: artifact.modelData
  };
}

function agentAssignmentReceipt(context: ArtifactReviewAgentContext, operation: "comment" | "submit"): unknown {
  return {
    reviewId: context.review.id,
    reviewRoundId: context.round.id,
    assignmentId: context.assignment.id,
    status: context.assignment.status,
    reviewProgress: reviewNodeProgress(context.assignment, context.assignment.status),
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

export async function boundReviewNodeContext() {
  const binding = await boundAgentReviewSession();
  return readBoundContext(binding);
}
export async function boundReviewNodeView(options: { nodeId?: string; all?: boolean; list?: boolean } = {}) {
  const context = await boundReviewNodeContext();
  return { ...reviewNodeView(context.assignment, context.assignment.submitted?.comments ?? context.assignment.draft.comments, { ...options, status: context.assignment.status }), vote: context.assignment.submitted?.vote, summary: context.assignment.submitted?.summary };
}
export async function mutateBoundReviewNode(mutation: Omit<Extract<NodeMutation, { operation: "report" }>, "expectedNodeId"> | Exclude<NodeMutation, { operation: "report" }>) {
  const binding = await boundAgentReviewSession(true);
  const context = await readBoundContext(binding);
  const currentNodeId = currentReviewNode(context.assignment)?.nodeId ?? "";
  const fixed: NodeMutation = mutation.operation === "report"
    ? { ...mutation, expectedNodeId: currentNodeId }
    : mutation.operation === "comment-add"
      ? { ...mutation, nodeId: mutation.nodeId ?? currentNodeId }
      : mutation;
  const commentIds = (state: ReviewNodeState) => [...state.ruleResults.flatMap(r => r.commentIds), ...(state.reasonCommentId ? [state.reasonCommentId] : []), ...(state.commentIds ?? [])];
  const targetNodeId = fixed.operation === "report" ? fixed.expectedNodeId : fixed.operation === "update" ? fixed.nodeId : fixed.operation === "comment-add" ? fixed.nodeId : context.assignment.nodeStates?.find(s => commentIds(s).includes(fixed.commentId))?.nodeId;
  const saved = await mutateArtifactReviewNodes({ ...binding, mutation: fixed });
  const state = saved.assignment.nodeStates?.find(s => s.nodeId === targetNodeId);
  return { operation: mutation.operation, savedNodeId: targetNodeId, savedCommentIds: state ? commentIds(state) : [], ...("commentId" in fixed ? { commentId: fixed.commentId } : {}), ...reviewNodeView(saved.assignment, saved.assignment.draft.comments, { status: saved.assignment.status }) };
}
export async function submitBoundReviewNodes(artifact: unknown) {
  const input = nodeSubmitSchema.parse(artifact);
  await submitBoundAgentReview(input);
  return { operation: "submit", ...await boundReviewNodeView() };
}
