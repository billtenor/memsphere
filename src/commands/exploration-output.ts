import { z } from "zod";
import type { PromptLocale } from "../prompts/locale.js";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import { cliCommand, commandFacts, previewText } from "./output.js";
import { reviewCommentId } from "../review-nodes.js";
import type { Review, Step } from "../context_control/types.js";

const optionalText = z.string().optional();

export const runReference = z.object({ runId: z.string(), reviewId: optionalText, nextAction }).strict();

export const explorationReceipt = z.object({
  runId: z.string(), artifactId: optionalText, stepId: optionalText, externalId: optionalText,
  checkpointDigest: optionalText, source: optionalText, stepStatus: optionalText, artifactStatus: optionalText,
  tags: z.array(z.string()).optional(), candidates: z.array(z.string()).optional(),
  candidateDetails: cliCommandSchema.optional(),
  candidateCount: z.number().int().nonnegative().optional(), warningCount: z.number().int().nonnegative().optional(),
  nextAction
}).strict();

export const previewResult = z.object({
  runId: z.string(), id: z.string(), contentType: z.string(), content: optionalText, out: optionalText,
  truncated: z.boolean().optional(), nextAction
}).strict();

export const artifactItems = z.object({
  runId: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() }).strict()),
  nextCursor: optionalText
}).strict();

export const artifactImpact = z.object({
  runId: z.string(), artifactIds: z.array(z.string()), nextCursor: optionalText
}).strict();

const lightReview = z.object({
  reviewId: z.string(), artifactId: z.string(), status: z.string(), source: z.enum(["human", "agent"]).optional(),
  comments: z.array(z.object({ commentId: z.string(), body: z.string() }).strict())
}).strict();

export const lightReviewDetail = lightReview.extend({ runId: z.string() }).strict();
export const lightReviewPage = z.object({ runId: z.string(), items: z.array(lightReview.omit({ comments: true }).extend({ commentCount: z.number().int().nonnegative(), details: cliCommandSchema })), nextCursor: optionalText }).strict();

export function publicLightReview(review: Review) {
  return {
    reviewId: review.id, artifactId: review.artifactId, status: review.status, source: review.reviewer.source,
    comments: review.comments.map(item => ({ commentId: reviewCommentId(item), body: item.body }))
  };
}

const explorationStep = z.object({
  runId: z.string(), stepId: z.string(), stepStatus: z.string(), artifactId: optionalText,
  configuration: z.object({
    reviewer: optionalText, asserts: z.array(z.string()).optional(), suggests: z.array(z.string()).optional(),
    inheritedFrom: z.object({ stepId: z.string(), artifactId: z.string() }).strict().optional()
  }).strict(),
  reviewers: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
  missing: z.array(z.string()), nextAction
}).strict();

export function emitExplorationStep(command: string, item: {
  runId: string;
  step: Step;
  configuration: NonNullable<Step["reviewConfiguration"]>;
  reviewers: { value: string; name: string }[];
  missing: string[];
}, options: { project: string; locale?: PromptLocale }) {
  const { runId, step, configuration } = item;
  const artifactId = step.artifact?.mode === "produce" ? step.artifact.id : undefined;
  const canReview = item.missing.length === 0 && artifactId;
  return commandFacts(() => explorationStep.parse({
    runId, stepId: step.id, stepStatus: step.status, artifactId,
    configuration: {
      reviewer: configuration.reviewer, asserts: configuration.asserts, suggests: configuration.suggests,
      inheritedFrom: configuration.inheritedFrom
    },
    reviewers: item.reviewers.map(({ value, name }) => ({ value, label: previewText(name, 160).text })),
    missing: item.missing,
    nextAction: canReview ? cliCommand(["--project", options.project, "run", "review", "start", "--run", runId, "--artifact", artifactId]) : undefined
  }), { ...options, saved: command === "run step configure" ? { id: step.id, inspect: cliCommand(["--project", options.project, "run", "step", "show", "--run", runId, "--step", step.id]) } : undefined });
}
