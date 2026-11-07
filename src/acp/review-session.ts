import { reviewerCommand } from "./reviewer-invocation.js";
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
import { realpath } from "node:fs/promises";
import { openContextControl } from "../project/context-control.js";
import { dirname } from "node:path";
import type { Review } from "../context_control/types.js";
import { effectiveStep } from "../context_control/graph-rewind.js";
import { graphReviewHandle } from "../context_control/review-repository.js";

type BoundAgentReviewSession = {
  // Reuse only the open Store handle within this binding operation. Each
  // repository call still reads current records and checks the model stamp.
  service: Awaited<ReturnType<typeof openContextControl>>;
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
    artifact: await expandReviewArtifact(binding.runsRoot, submission.artifact),
    contextArtifacts: await Promise.all(submission.contextArtifacts.map(async (item) => ({
      stepId: item.stepId,
      ...(item.artifactId ? { artifactId: item.artifactId } : {}),
      artifact: await expandReviewArtifact(binding.runsRoot, item.artifact)
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
  const resources = await (await import("./reviewer-resources.js")).reviewerResources();
  return {
    protocol: binding.reviewId.startsWith("graph-review-") ? "graph" : "flow",
    ...(resources ? {
      artifactId: resources.candidate.id,
      references: [
        ...resources.artifacts.map(a => ({ kind: "artifact", id: a.id, stepId: a.stepId, confirmation: resources.confirmations.some(r => r.artifactId === a.id) ? "submitted-reviews" : a.id === resources.candidate.id ? "current-candidate" : "accepted-without-independent-review", readCommand: reviewerCommand(`run artifact show --run ${resources.run.id} --artifact ${a.id} --out ${a.id}.md`) })),
        ...resources.externals.map(e => ({ kind: "external", id: e.id, source: e.source, viaArtifactIds: resources.artifacts.filter(a => a.dependencies.some(r => r.kind === "external" && r.id === e.id)).map(a => a.id), readCommand: reviewerCommand(`run external show --run ${resources.run.id} --external ${e.id} --out ${e.id}.txt`) })),
        ...resources.confirmations.map(r => ({ kind: "review", id: r.id, artifactId: r.artifactId, roundId: r.roundId, readCommand: reviewerCommand(`run review show --review ${r.id} --output json`) }))
      ]
    } : {}),
    memoryReads: { project: reviewerCommand("memory list --output json"), frozen: process.env.MEMSPHERE_REVIEW_MEMORY_RUN_ID ? reviewerCommand(`memory list --run ${context.run.id} --output json`) : undefined },
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

export async function boundAgentReviewSession(write = false): Promise<BoundAgentReviewSession> {
  const configPath = requiredEnv("MEMSPHERE_CONFIG_PATH");
  const workspaceRoot = resolve(requiredEnv("MEMSPHERE_WORKSPACE_ROOT"));
  const runId = requiredEnv("MEMSPHERE_REVIEW_RUN_ID");
  const assignmentId = requiredEnv("MEMSPHERE_REVIEW_ASSIGNMENT_ID");
  const attemptId = requiredEnv("MEMSPHERE_REVIEW_ATTEMPT_ID");
  const config = await readConfig(configPath);
  const currentDirectory = await realpath(process.cwd());
  const workspaceRelative = relative(await realpath(workspaceRoot), currentDirectory);
  if (workspaceRelative === ".." || workspaceRelative.startsWith("../") || workspaceRelative.startsWith("..\\") || isAbsolute(workspaceRelative)) {
    throw new Error("cli_workspace_mismatch");
  }
  const service = await openContextControl(dirname(config.runsRoot));
  const modelRun = service && await service.findRun(runId);
  let directed: Awaited<ReturnType<typeof readArtifactReviewForActor>> | undefined;
  if (modelRun?.frames?.some(f => f.type === "graph")) {
    directed = await service!.withGraph(async g => {
      const review = (await g.records.require<Review>("review", runId, assignmentId)).value;
      if (!review.roundId || !review.reviewer.actorId) throw new Error("review_assignment_not_bound");
      const artifact = (await g.records.require<import("../context_control/types.js").Artifact>("artifact", runId, review.artifactId)).value;
      if (!effectiveStep(modelRun, artifact.stepId)) throw new Error("review_attempt_not_current");
      return readArtifactReviewForActor({ service, runsRoot: config.runsRoot, reviewId: graphReviewHandle(runId, artifact.stepId), roundId: review.roundId, actorId: review.reviewer.actorId });
    });
  }
  const run = directed?.run ?? await readRun(config.runsRoot, runId);
  for (const review of run.artifactReviews ?? []) {
    const selectedRound = directed?.round.id ?? process.env.MEMSPHERE_REVIEW_ROUND_ID;
    const matches = review.rounds.filter(candidate => (!selectedRound || candidate.id === selectedRound) && candidate.assignments.some(a => artifactReviewAssignmentId(a) === assignmentId && a.attempts?.some(attempt => attempt.id === attemptId)));
    if (matches.length > 1) throw new Error("review_assignment_not_bound");
    const round = matches[0];
    const assignment = round?.assignments.find((candidate) => artifactReviewAssignmentId(candidate) === assignmentId);
    if (!round || !assignment) continue;
    if (review.status === "cancelled" || assignment.status === "cancelled" || run.status === "abandoned") throw new Error("review_attempt_not_current");
    if (process.env.MEMSPHERE_REVIEW_HANDLE && process.env.MEMSPHERE_REVIEW_HANDLE !== review.id || process.env.MEMSPHERE_REVIEW_ROUND_ID && process.env.MEMSPHERE_REVIEW_ROUND_ID !== round.id) throw new Error("review_session_identity_conflict");
    const attempt = assignment.attempts?.find(a => a.id === attemptId);
    if (!attempt) throw new Error(`Agent Review attempt not found: ${assignmentId}`);
    if (assignment.attempts?.at(-1)?.id !== attempt.id || !["running", "submitted"].includes(attempt.status) || !["running", "submitted"].includes(assignment.status)) throw new Error("review_attempt_not_current");
    if (write && (assignment.attempts?.at(-1)?.id !== attempt?.id || assignment.status !== "running")) throw new Error("review_attempt_not_current");
    if (write) await markArtifactReviewAgentCliReady({
      service,
      runsRoot: config.runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      attemptId: attempt.id
    });
    return {
      service,
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

export async function expandReviewArtifact(runsRoot: string, artifact: RunEvent["artifact"]) {
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
    assignmentId: artifactReviewAssignmentId(context.assignment),
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
