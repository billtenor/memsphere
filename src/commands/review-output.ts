import { z } from "zod";
import { artifactReviewAssignmentId, artifactReviewRoundControlPlane, type ArtifactReview, type ArtifactReviewRound } from "../artifact-review.js";
import { reviewCommentId, reviewNodeProgress } from "../review-nodes.js";
import type { RunState } from "../run/store.js";
import { buildArtifactReviewNextActionPromptModel } from "../prompts/review.js";
import { nextAction } from "../prompts/cli-output.js";
import { cliCommand, publishResult, previewText, type CliFormat } from "./output.js";
import { registeredWait, reviewReceipts, type ReviewReceiptCommand } from "../prompts/review-receipts.js";
import type { RunProgress } from "./run-result.js";

type Review = ArtifactReview<RunState["events"][number]["artifact"]>;

export function reviewReceipt(command: ReviewReceiptCommand, input: {
  project?: string;
  run: Pick<RunState, "id" | "language">;
  review: Review;
  round: ArtifactReviewRound;
  progress?: RunProgress;
  taskId?: string;
  assignmentId?: string;
  vote?: string;
  format?: CliFormat;
  statusOnly?: boolean;
  fullComments?: boolean;
}): void {
  const { project, run, review, round, progress } = input;
  const invoke = (...args: string[]) => cliCommand([...(project ? ["--project", project] : []), "run", ...args]);
  const resume = invoke("review", "wait", "--review", review.id);
  const result = buildArtifactReviewNextActionPromptModel(review, round, run.id);
  const opinion = review.id.startsWith("exploration-review-");
  const failed = round.assignments.filter(assignment => assignment.status === "failed");
  let action: z.input<typeof nextAction>;
  const step = review.id.startsWith("graph-review-") ? ["--step", review.stepId] : [];
  const inspect = artifactReviewRoundControlPlane(review, round).permissions.runner.effective.includes("artifact.read")
    ? invoke("review", "show", "--review", review.id, "--round", round.id, "--all") : undefined;
  if (input.statusOnly) action = input.fullComments ? undefined : inspect;
  else if (input.taskId) action = { kind: "wait", resume };
  else if (progress) action = progress.nextAction;
  else if (opinion && round.assignments.every(assignment => assignment.status === "submitted")) action = undefined;
  else if (result.kind === "wait" && !failed.length) action = { kind: "wait", resume };
  else if (result.kind === "runner_vote") action = { kind: "choose", choices: [
    invoke("review", "vote", "--review", review.id, "--round", round.id, "--vote", "approve"),
    invoke("review", "vote", "--review", review.id, "--round", round.id, "--vote", "request_changes", "--comment", "<reason>")
  ] };
  else if (result.kind === "revision") action = invoke("report", "--run", run.id, ...step,
    "--artifact-file", "<candidate>", "--revision-summary-file", "<revision-summary>");
  else if (result.kind === "human_vote") action = { kind: "human_confirmation", resume: invoke(
    "review", "submit-for-human", "--run", run.id, "--review", review.id, "--round", round.id,
    "--assignment", result.assignments.length === 1 ? result.assignments[0].assignmentId : "<assignment-id>",
    "--vote", "<approve|request_changes|abstain>", "--comments-file", "<comments>",
    "--authorization-note-file", "<authorization>"
  ) };
  else if (failed.length) action = { kind: "choose", choices: failed.slice(0, 10).map(assignment =>
    invoke("review", "retry", "--review", review.id, ...(review.id.startsWith("exploration-review-")
      ? [] : ["--assignment", artifactReviewAssignmentId(assignment)]))) };
  const summary = {
    runId: run.id, stepId: review.stepId, reviewId: review.id, roundId: round.id,
    candidateId: round.submissionId, scope: opinion ? "opinion" as const : "decision" as const,
    status: opinion ? round.assignments[0]?.status ?? review.status : review.status,
    roundStatus: round.status, assignmentCount: round.assignments.length,
    commentCount: round.assignments.reduce((total, item) => total + (item.submitted?.comments.length ?? 0), 0),
    details: input.fullComments ? undefined : inspect,
    nextAction: action
  };
  const options = { format: input.format, locale: run.language, maximumBytes: 8192,
    saved: command === "run review show" || command === "run review wait" && !input.taskId
      ? undefined : { id: input.taskId ?? review.id, inspect } };
  const receipt = { ...summary, outcome: opinion ? undefined : round.result?.status };
  switch (command) {
    case "run review wait":
      if (input.taskId) {
        return publishResult(command, () => registeredWait.parse({ ...summary, taskId: input.taskId, nextAction: { kind: "wait", resume } }), options);
      }
      return publishResult(command, () => reviewReceipts[command].parse(receipt), options);
    case "run review vote":
      return publishResult(command, () => reviewReceipts[command].parse({ ...receipt, vote: input.vote! }), options);
    case "run review retry":
      return publishResult(command, () => reviewReceipts[command].parse({ ...receipt, assignmentId: input.assignmentId }), options);
    case "run review submit-for-human":
      return publishResult(command, () => reviewReceipts[command].parse({ ...receipt, assignmentId: input.assignmentId!, vote: input.vote! }), options);
  }
  const comments = round.assignments.flatMap(assignment => (assignment.submitted?.comments ?? []).map(item => {
    const commentId = reviewCommentId(item);
    const preview = input.fullComments ? undefined : previewText(item.body, 96);
    return {
      commentId, actorId: assignment.actorId, severity: item.severity, body: preview?.text ?? item.body,
      truncated: preview?.truncated,
      disposition: round.commentDispositions?.find(d => d.commentId === commentId)?.disposition
    };
  }));
  const assignments = round.assignments.slice(0, 10);
  publishResult(command, () => reviewReceipts[command].parse({
    ...receipt,
    assignments: assignments.map(assignment => ({
      assignmentId: artifactReviewAssignmentId(assignment), actorId: assignment.actorId,
      name: previewText(assignment.actorName, 160).text, kind: assignment.actorKind ?? "human",
      binding: assignment.binding, status: assignment.status, vote: assignment.submitted?.vote,
      summary: assignment.submitted?.summary === undefined ? undefined : input.fullComments
        ? assignment.submitted.summary : previewText(assignment.submitted.summary, 160).text,
      progress: reviewNodeProgress(assignment, assignment.status),
      failureCode: assignment.status === "failed" && /^[a-z0-9_]{1,64}$/i.test(assignment.attempts?.at(-1)?.failure?.code ?? "")
        ? assignment.attempts?.at(-1)?.failure?.code : undefined
    })),
    comments: input.fullComments ? comments : comments.slice(0, 8)
  }), { ...options, itemsField: "comments", maximumBytes: input.fullComments ? undefined : 8192 });
}
