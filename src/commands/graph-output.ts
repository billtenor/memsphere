import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";
import { reviewSourceSchema } from "../review-nodes.js";

const str = z.string();
const optional = str.optional();
const idList = z.array(str);
const ref = z.object({ id: str, kind: z.enum(["artifact", "external"]) }).strict();
const inputGroups = z.record(z.array(ref));
const rule = z.object({ scope: str, text: str }).strict();

export const graphStepDetail = z.object({
  runId: str,
  step: z.object({
    id: str, actionId: optional, status: str, effective: z.boolean(), supersedingRewindId: optional,
    inputGroups: inputGroups.optional(), artifactId: optional
  }).strict(),
  instruction: str,
  actor: z.enum(["agent", "human"]),
  artifactName: optional,
  contentType: optional,
  model: optional,
  rules: z.array(rule)
}).strict();

export const graphArtifactCollection = z.object({
  runId: str, stepId: str,
  items: z.array(z.object({
    artifactId: str, name: str, status: str, contentType: optional, dependencies: z.array(ref)
  }).strict())
}).strict();

export const graphContractDetail = z.object({
  runId: str, stepId: str, name: optional, contentType: optional, model: optional,
  definition: optional, memoryReference: optional,
  schema: z.object({ definition: str, source: reviewSourceSchema }).strict().optional(),
  rules: z.array(rule)
}).strict();

export const graphRewindResult = z.object({
  runId: str, dryRun: z.boolean(), targetStepId: str, actionId: str,
  affectedStepIds: idList, affectedArtifactIds: idList, retainedStepIds: idList,
  rewindId: optional, replacementStepId: optional, nextAction
}).strict();

const binding = z.object({ actorIds: idList, skipped: z.boolean() }).strict();
export const graphBindingResult = z.object({
  runId: str, nextRound: z.record(binding),
  rounds: z.array(z.object({ stepId: str, roundId: str, bindings: z.record(binding) }).strict())
}).strict();

export function publicBindings(values: Record<string, { actorIds: string[]; skipped?: boolean } | { skip: true }>) {
  return Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot,
    "skip" in value ? { actorIds: [], skipped: true } : { actorIds: value.actorIds, skipped: value.skipped ?? false }
  ]));
}
