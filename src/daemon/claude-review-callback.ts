import type { MemsphereConfig } from "../config.js";
import { requireEffectiveStep } from "../context_control/graph-rewind.js";
import { explorationReviewIdentity } from "../context_control/exploration-review.js";
import { readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { currentCommandState } from "../home/command-state-store.js";
import { openContextControl } from "../project/context-control.js";
import { captureClaudeInbox } from "../runner/claude-notifications.js";
import { currentIdentity, detectRunnerAgent, readRunnerAgents } from "../runner/identity.js";
import { readTask, recordClaudeDelivery, type ClaudeRecipient, type DaemonTask } from "./tasks.js";
import { reviewReady } from "./review.js";

import { failure } from "../context_control/errors.js";

type ReviewTarget = Pick<DaemonTask["input"], "project" | "runId" | "stepId" | "reviewId">;

async function requireBoundTarget(target: ReviewTarget) {
  const explorationReview = explorationReviewIdentity(target.reviewId) ? target.reviewId : undefined;
  const state = (await currentCommandState(Boolean(target.stepId || explorationReview)))?.value;
  // Historical Flow runs are explicitly addressed and have no Step or Review binding.
  if (!state) return;
  if (state.status !== "active" || state.groupId !== target.runId
      || state.parameters.project !== target.project || state.parameters.step !== target.stepId
      || state.parameters.review !== explorationReview) {
    throw failure("SESSION_CONTEXT_CONFLICT", "Claude Code session is not bound to this Run, Step, or Review; enter the intended target first");
  }
}

export async function prepareClaudeReviewRecipient(sessionId: string, target: ReviewTarget): Promise<ClaudeRecipient> {
  await requireBoundTarget(target);
  const detection = await detectRunnerAgent("claude");
  if (!detection.path || detection.status !== "installed") {
    throw failure("UNSUPPORTED_CAPABILITY", "Install the Claude Code CLI or disable asynchronous execution to wait synchronously");
  }
  const inbox = await captureClaudeInbox({ command: detection.path, version: detection.version, cwd: process.cwd(), sessionId });
  return { agentType: "claude", sessionId, agentCommand: detection.path, inbox };
}

export async function readClaudeReviewCallback(config: MemsphereConfig, reviewId: string, callback: string) {
  const match = /^(task-[0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(callback);
  if (!match) throw failure("INVALID_ARGUMENT", "Invalid Claude Code notification reference");
  const [, taskId, deliveryId] = match;
  const identity = await currentIdentity(true);
  const row = await readTask(taskId);
  const task = row?.value;
  if (identity?.agentType !== "claude" || !task || task.recipient.agentType !== "claude"
      || identity.sessionId !== task.recipient.sessionId || task.claudeDelivery?.id !== deliveryId
      || !["completed", "running"].includes(task.status) || task.input.project !== config.project?.name
      || task.input.reviewId !== reviewId || !(await readRunnerAgents()).claude?.async_enabled) {
    throw failure("PERMISSION_DENIED", "Claude Code notification does not belong to the current session, review, or delivery");
  }
  await requireBoundTarget(task.input);
  if (task.input.stepId) {
    const service = await openContextControl(config.scopeRoot);
    const snapshot = await service?.snapshot(task.input.runId);
    if (snapshot) requireEffectiveStep(snapshot.run, task.input.stepId);
    const step = snapshot?.steps.find(candidate => candidate.id === task.input.stepId);
    if (step?.reviewRounds?.at(-1)?.id !== task.input.roundId) {
      throw failure("REVIEW_CONFLICT", "Claude Code notification is for an obsolete Review round");
    }
  }
  const context = await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId });
  if (context.run.id !== task.input.runId || context.round.id !== task.input.roundId || !reviewReady(context)) {
    throw failure("REVIEW_NOT_READY", "Claude Code notification is for an obsolete or unfinished Review round");
  }
  return { context, acknowledge: () => recordClaudeDelivery(taskId, deliveryId, "readAt") };
}
