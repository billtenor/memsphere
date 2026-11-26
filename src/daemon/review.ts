import type { MemsphereConfig } from "../config.js";
import { readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { openContextControl } from "../project/context-control.js";
import { renderPrompt } from "../prompts/renderer.js";
import { artifactReviewWaitReady } from "../artifact-review.js";

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

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function reviewResumeNotification(project: string, reviewId: string, callback?: string) {
  const target = `memsphere --project ${quote(project)} run review wait --review ${quote(reviewId)}`;
  return renderPrompt("cli.notification", "zh-CN", {
    command: callback ? `${target} --callback ${quote(callback)}` : target
  });
}
