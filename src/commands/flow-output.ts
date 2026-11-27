import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";
import { reviewComment } from "./review-node-output.js";

const str = z.string();
const optional = str.optional();
const ids = z.array(str);
const count = z.number().int().nonnegative();
const format = z.object({ name: str, options: z.record(z.unknown()).optional() }).strict();
const contract = z.object({
  name: str, type: optional, format: format.optional(), schema: z.unknown().optional(),
  final: z.boolean(), review: optional
}).strict();

// Rule content is already projected from the frozen authored rule tree.
const rules = z.array(z.unknown());
export const flowStepDetail = z.object({
  ref: str, procedureName: str, current: z.boolean(), procedureAsserts: rules,
  step: z.object({
    id: str, kind: str, actor: z.enum(["agent", "human"]), instruction: str,
    asserts: rules, suggests: rules, details: ids, artifact: contract.optional()
  }).strict()
}).strict();

export const flowContractDetail = z.object({
  stepRef: str,
  procedure: z.object({ name: str, asserts: rules }).strict(),
  action: z.object({ instruction: str, asserts: rules, suggests: rules, details: ids }).strict(),
  artifact: contract.optional()
}).strict();

const revisionSummary = z.object({
  body: str, digest: str, createdAt: str, previousSubmissionId: optional
}).strict();

export const flowArtifact = z.object({
  name: str, type: optional, format: format.optional(), final: z.boolean().optional(),
  contentType: optional, fileName: optional, storage: z.enum(["inline", "file"]).optional(), value: z.unknown().optional()
}).strict();

export const flowArtifactDetail = z.object({
  stepRef: str, source: z.enum(["review_submission", "run_event", "not_reported"]),
  artifact: flowArtifact.nullable(), revisionSummary: revisionSummary.optional()
}).strict();

const binding = z.union([z.object({ actorIds: ids }).strict(), z.object({ skip: z.literal(true) }).strict()]);
const bindings = z.object({
  runId: str, status: str, readOnly: z.boolean(),
  actors: z.array(z.object({ id: str, name: str, kind: z.enum(["human", "agent"]), permissions: ids }).strict()),
  slots: z.array(z.object({
    key: str, binding, reviewScopes: ids, reviewIds: ids,
    activeReviews: z.array(z.object({
      reviewId: str, artifactScope: str, currentRoundId: str, currentRoundSequence: count,
      currentBinding: binding, nextBinding: binding, effectiveFromRoundSequence: count
    }).strict()).optional()
  }).strict())
}).strict();
export const flowBindings = bindings;
export const flowBindingUpdate = z.object({ changeId: str, slot: str, nextBinding: binding, bindings }).strict();

export const reviewAssignmentReceipt = z.object({
  reviewId: str, roundId: str, assignmentId: str, status: str, vote: optional,
  commentCount: count, completed: z.boolean()
}).strict();

export const reviewerCandidate = z.object({
  artifact: flowArtifact,
  contextArtifacts: z.array(z.object({ stepId: str, artifactId: optional, artifact: flowArtifact }).strict()).optional(),
  revisionSummary: revisionSummary.optional()
}).strict();

export const reviewerAssignment = z.object({
  protocol: z.enum(["flow", "graph"]),
  artifactId: optional,
  references: z.array(z.object({
    kind: z.enum(["artifact", "external", "review"]), id: str, stepId: optional, confirmation: optional,
    source: optional, viaArtifactIds: ids.optional(), artifactId: optional, roundId: optional, readCommand: optional
  }).strict()).optional(),
  memoryReads: z.object({ project: str, frozen: optional }).strict(),
  status: str, reviewProgress: z.object({ phase: str, processed: count, total: count }).strict().optional(),
  binding: str, slots: ids, permissions: ids, comments: z.array(reviewComment), vote: optional, summary: optional
}).strict();

export const legacySchemaWriting = z.object({
  runId: str, stepId: str, artifactName: str, phase: str,
  completed: count, total: count, currentField: optional, nextAction
}).strict();

export function authoredArtifact(value: z.input<typeof flowArtifact> | null): z.input<typeof flowArtifact> | null {
  if (!value) return null;
  const { name, type, format, final, contentType, fileName, storage } = value;
  return { name, type, format, final, contentType, fileName, storage, value: value.value };
}
