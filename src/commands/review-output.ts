import { z } from "zod";
import { artifactReviewAssignmentId, type ArtifactReview, type ArtifactReviewRound } from "../artifact-review.js";
import { reviewCommentId, reviewNodeProgress } from "../review-nodes.js";
import type { RunState } from "../run/store.js";
import { buildArtifactReviewNextActionPromptModel } from "../prompts/review.js";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import { cliCommand, emitCliResult, previewText, type CliFormat } from "./output.js";
import type { RunProgress } from "./run-result.js";

type Review = ArtifactReview<RunState["events"][number]["artifact"]>;

const actor = z.object({
  assignmentId: z.string(),
  actorId: z.string(),
  name: z.string(),
  kind: z.enum(["agent", "human"]),
  binding: z.enum(["advisory", "decision"]),
  status: z.string(),
  vote: z.string().optional(),
  summary: z.string().optional(),
  progress: z.object({ phase: z.string(), processed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict().optional(),
  failureCode: z.string().optional()
}).strict();

const comment = z.object({
  commentId: z.string(),
  actorId: z.string(),
  severity: z.string().optional(),
  body: z.string(),
  disposition: z.string().optional(),
  truncated: z.boolean().optional()
}).strict();

const reviewResult = z.object({
  runId: z.string(),
  stepId: z.string(),
  reviewId: z.string(),
  roundId: z.string(),
  candidateId: z.string(),
  scope: z.enum(["decision", "opinion"]),
  status: z.string(),
  roundStatus: z.string(),
  outcome: z.string().optional(),
  taskId: z.string().optional(),
  assignmentId: z.string().optional(),
  vote: z.string().optional(),
  assignmentCount: z.number().int().nonnegative(),
  assignments: z.array(actor).max(10),
  comments: z.array(comment),
  commentCount: z.number().int().nonnegative(),
  details: cliCommandSchema.optional(),
  nextAction
}).strict();

export function reviewReceipt(command: string, input: {
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
  if (input.statusOnly) action = invoke("status", "--run", run.id);
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
  const comments = round.assignments.flatMap(assignment => (assignment.submitted?.comments ?? []).map(item => {
    const commentId = reviewCommentId(item);
    const preview = input.fullComments ? undefined : previewText(item.body, 96);
    return {
      commentId, actorId: assignment.actorId, severity: item.severity, body: preview?.text ?? item.body,
      truncated: preview?.truncated,
      disposition: round.commentDispositions?.find(d => d.commentId === commentId)?.disposition
    };
  }));
  emitCliResult(command, reviewResult, {
    runId: run.id, stepId: review.stepId, reviewId: review.id, roundId: round.id,
    candidateId: round.submissionId, scope: opinion ? "opinion" : "decision",
    status: opinion ? round.assignments[0]?.status ?? review.status : review.status, roundStatus: round.status,
    outcome: !opinion ? round.result?.status : undefined, taskId: input.taskId, vote: input.vote, assignmentId: input.assignmentId,
    assignmentCount: round.assignments.length,
    assignments: round.assignments.slice(0, 10).map(assignment => ({
      assignmentId: artifactReviewAssignmentId(assignment), actorId: assignment.actorId,
      name: previewText(assignment.actorName, 160).text, kind: assignment.actorKind ?? "human",
      binding: assignment.binding, status: assignment.status, vote: assignment.submitted?.vote,
      summary: assignment.submitted?.summary === undefined ? undefined : input.fullComments
        ? assignment.submitted.summary : previewText(assignment.submitted.summary, 160).text,
      progress: reviewNodeProgress(assignment, assignment.status),
      failureCode: assignment.status === "failed" && /^[a-z0-9_]{1,64}$/i.test(assignment.attempts?.at(-1)?.failure?.code ?? "")
        ? assignment.attempts?.at(-1)?.failure?.code : undefined
    })),
    comments: input.fullComments ? comments : comments.slice(0, 8), commentCount: comments.length,
    details: progress?.details ?? (!input.fullComments && comments.length
      ? invoke("review", "show", "--review", review.id, "--round", round.id, "--all") : undefined),
    nextAction: action
  }, { format: input.format, locale: run.language, itemsField: "comments", maximumBytes: input.fullComments ? undefined : 8192, saved: { id: review.id, inspect: resume } });
}
