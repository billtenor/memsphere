import { z } from "zod";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import { flowArtifact } from "./flow-output.js";
import { reviewComment } from "./review-node-output.js";
import type { Review } from "../context_control/types.js";

const str = z.string();
const optional = str.optional();
const ids = z.array(str);
const ref = z.object({ kind: z.enum(["artifact", "external"]), id: str }).strict();

export const fixedReviewContract = z.object({
  procedure: z.object({ name: str, asserts: z.array(z.unknown()) }).strict(),
  action: z.object({ instruction: str, asserts: z.array(z.unknown()), suggests: z.array(z.unknown()), details: ids }).strict(),
  artifact: z.object({
    name: str, type: optional, format: z.object({ name: str, options: z.record(z.unknown()) }).strict().optional(),
    // The requested frozen Schema definition and its authorized rules are authored review material.
    schema: z.unknown().optional(), final: z.boolean(), review: optional,
    modelTarget: z.object({ storeId: str, modelRef: str, dataId: optional }).strict().optional()
  }).strict()
}).strict();

const confirmation = z.object({
  id: str, roundId: optional, artifactId: str, status: str, actorId: optional, kind: optional,
  vote: z.object({ value: str, summary: optional }).strict().optional(),
  comments: z.array(reviewComment)
}).strict();
export const fixedConfirmation = confirmation;
export const fixedConfirmationList = z.object({ items: z.array(confirmation) }).strict();

export function publicConfirmation(review: Review): z.input<typeof confirmation> {
  return { id: review.id, roundId: review.roundId, artifactId: review.artifactId, status: review.status,
    actorId: review.reviewer.actorId, kind: review.reviewer.source,
    vote: review.vote && { value: review.vote.value, summary: review.vote.summary },
    comments: review.comments
  };
}

export const destination = z.object({
  storeId: str, modelRef: str, dataId: str, operation: z.enum(["upsert", "create"])
}).strict();
const fixedArtifact = flowArtifact.extend({
  dependencies: z.array(ref),
  business: z.object({ destination, value: z.unknown().optional() }).strict().optional()
}).strict();

export const fixedCandidate = z.object({
  artifactId: str,
  artifact: fixedArtifact,
  contextArtifacts: z.array(z.object({ artifactId: str, stepId: str, artifact: fixedArtifact }).strict()),
  contextExternals: z.array(z.object({ externalId: str, source: str, viaArtifactIds: ids }).strict()),
  confirmations: z.array(confirmation),
  revisionSummary: z.object({ body: str, digest: str, createdAt: str, previousSubmissionId: optional }).strict().optional()
}).strict();

export const fixedMaterial = z.object({
  runId: str, id: str, contentType: str, out: optional, content: optional, truncated: z.boolean().optional(),
  source: optional, viaArtifactIds: ids.optional(), dependencies: z.array(ref).optional(),
  business: z.object({ destination, valuePreview: optional, valueTruncated: z.boolean().optional() }).strict().optional(),
  nextAction
}).strict();

export const fixedRunSummary = z.object({
  id: str, name: optional, status: str, stepIds: ids.optional(),
  steps: z.array(z.object({ id: str, actionId: optional, status: str, artifactIds: ids }).strict()).optional()
}).strict();
