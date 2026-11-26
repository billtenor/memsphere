import type { MemsphereConfig } from "../config.js";
import { readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { openContextControl } from "../project/context-control.js";
import { renderPrompt } from "../prompts/renderer.js";
import { failure } from "../context_control/errors.js";
import { artifactReviewRoundControlPlane, artifactReviewWaitReady } from "../artifact-review.js";

export async function inspectReview(config: MemsphereConfig, reviewId: string) {
  if (reviewId.startsWith("graph-review-")) {
    const runId = reviewId.slice("graph-review-".length).split("__")[0];
    const service = await openContextControl(config.scopeRoot);
    await service?.withGraph(g => g.advance(runId));
  }
  return readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId });
}
export type ReviewContext = Awaited<ReturnType<typeof inspectReview>>;
export function reviewReady(context: ReviewContext) {
  return artifactReviewWaitReady(context.review, context.round);
}

/** Read the delivered candidate under the permissions frozen for its round. */
export function notificationRound(context: ReviewContext, roundId: string) {
  const round = context.review.rounds.find(item => item.id === roundId);
  if (!round) throw failure("NOT_FOUND", "Notification round not found");
  if (!artifactReviewRoundControlPlane(context.review, round).permissions.runner.effective.includes("artifact.read")) {
    throw failure("PERMISSION_DENIED", "Runner requires artifact.read for the notification round");
  }
  if (round.id === context.round.id && !reviewReady(context)) {
    throw failure("REVIEW_NOT_READY", "This notification round is not ready");
  }
  return { ...context, round };
}

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function reviewResumeNotification(project: string, reviewId: string, delivery: { roundId: string } | { callback: string }) {
  const target = `memsphere --project ${quote(project)} run review wait --review ${quote(reviewId)}`;
  return renderPrompt("cli.notification", "zh-CN", {
    command: "callback" in delivery ? `${target} --callback ${quote(delivery.callback)}` : `${target} --notification-round ${quote(delivery.roundId)}`
  });
}
