import type { MemsphereConfig } from "../config.js";
import { readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { openContextControl } from "../project/context-control.js";
import { renderPrompt } from "../prompts/renderer.js";
import { buildArtifactReviewSummaryPromptModel, buildArtifactReviewNextActionPromptModel } from "../prompts/index.js";
import { renderRunOutput } from "../prompts/run-output.js";
import { resolvePromptLocale } from "../prompts/locale.js";
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
export function reviewResumeNotification(project: string, reviewId: string) {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return `请执行命令以继续：\nmemsphere --project ${quote(project)} run review wait --review ${quote(reviewId)}`;
}
/** No enter, context writes, or graph advancement in the renderer. */
export async function renderReviewResult(config: MemsphereConfig, context: ReviewContext): Promise<string> {
  const { run, review, round } = context;
  const locale = resolvePromptLocale(run.language);
  if (!review.id.startsWith("graph-review-")) return renderRunOutput({ kind: "review", run, review, round, runsRoot: config.runsRoot }, resolvePromptLocale(run.language));
  const summary = renderPrompt("run.review-summary", locale, buildArtifactReviewSummaryPromptModel(review, round, locale));
  const service = (await openContextControl(config.scopeRoot))!;
  const snapshot = await service.snapshot(run.id);
  const step = snapshot.steps.find(s => s.id === review.stepId);
  if (step?.status !== "done") return summary + "\n" + renderPrompt("run.review-next-action", locale, buildArtifactReviewNextActionPromptModel(review, round, run.id));
  return service.withGraph(async g => {
    const ready = g.ready(snapshot);
    const commands = ready.map(s => `memsphere --project '${config.project!.name.replaceAll("'", "'\\''")}' run step enter --run ${run.id} --step ${s.id}`);
    return summary + "\n" + (commands.length ? commands.join("\n") : `memsphere run status --run ${run.id}`);
  });
}
