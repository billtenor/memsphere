import { z } from "zod";
import { cliCommandSchema, nextAction } from "./cli-output.js";

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

const roundSummary = z.object({
  runId: z.string(),
  stepId: z.string(),
  reviewId: z.string(),
  roundId: z.string(),
  candidateId: z.string(),
  scope: z.enum(["decision", "opinion"]),
  status: z.string(),
  roundStatus: z.string(),
  outcome: z.string().optional(),
  assignmentCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  details: cliCommandSchema.optional(),
  nextAction
}).strict();

export const reviewReceipts = {
  "run review show": roundSummary.extend({ assignments: z.array(actor), comments: z.array(comment) }),
  "run review wait": roundSummary,
  "run review vote": roundSummary.extend({ vote: z.string() }),
  "run review retry": roundSummary.extend({ assignmentId: z.string().optional() }),
  "run review submit-for-human": roundSummary.extend({ assignmentId: z.string(), vote: z.string() })
};

export const registeredWait = roundSummary.omit({ outcome: true }).extend({
  taskId: z.string(),
  nextAction: z.object({ kind: z.literal("wait"), resume: cliCommandSchema }).strict()
});

export type ReviewReceiptCommand = keyof typeof reviewReceipts;
