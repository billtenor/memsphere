import { z } from "zod";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";

export const runSummarySchema = z.object({
  runId: z.string(),
  name: z.string(),
  status: z.string()
}).strict();

export const runPageSchema = z.object({
  runs: z.array(runSummarySchema),
  nextCursor: z.string().optional()
}).strict();

export const runOverviewSchema = z.object({
  run: z.object({ id: z.string(), name: z.string(), status: z.string() }).strict(),
  steps: z.array(z.object({
    id: z.string(), status: z.string(), actionId: z.string().optional(),
    artifactId: z.string().optional(), effective: z.boolean().optional()
  }).strict()),
  stepCount: z.number().int().nonnegative(),
  outputArtifactIds: z.array(z.string()),
  outputArtifactCount: z.number().int().nonnegative(),
  nextCursor: z.string().optional()
}).strict();

export const runEvidenceSchema = z.object({
  kind: z.enum(["artifact", "external"]),
  id: z.string(),
  read: cliCommandSchema.optional()
}).strict();

export const runProgressSchema = runSummarySchema.extend({
  stepId: z.string().optional(),
  stepStatus: z.string().optional(),
  reviewId: z.string().optional(),
  roundId: z.string().optional(),
  vote: z.string().optional(),
  instruction: z.string().optional(),
  actor: z.enum(["agent", "human"]).optional(),
  artifactId: z.string().optional(),
  artifactName: z.string().optional(),
  contentType: z.string().optional(),
  model: z.string().optional(),
  artifactFormat: z.string().optional(),
  dataId: z.string().optional(),
  receipt: z.object({ artifactName: z.string(), dataId: z.string().optional() }).strict().optional(),
  schemaPhase: z.string().optional(),
  schemaField: z.string().optional(),
  completedFields: z.number().int().nonnegative().optional(),
  totalFields: z.number().int().nonnegative().optional(),
  minimumCount: z.number().int().nonnegative().optional(),
  maximumCount: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
  completedSteps: z.number().int().nonnegative().optional(),
  eligibleSteps: z.number().int().nonnegative().optional(),
  waitingReviews: z.number().int().nonnegative().optional(),
  warningCount: z.number().int().nonnegative().optional(),
  ruleCount: z.number().int().nonnegative().optional(),
  memoryRun: z.string().optional(),
  rules: z.array(z.object({ scope: z.string(), text: z.string() }).strict()).optional(),
  materials: z.array(runEvidenceSchema).optional(),
  details: cliCommandSchema.optional(),
  nextAction
}).strict();

export type RunProgress = z.infer<typeof runProgressSchema>;
