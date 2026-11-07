import {
  activeProcedureAssertTrees,
  currentFrame,
  currentStep,
  type ArtifactReviewContext,
  type RunSchemaContract
} from "../run/store.js";
import type { EffectiveRuleTree } from "../memory/rules.js";
import {
  toEffectiveRuleDisplayEntries,
  toEffectiveRuleDisplayValue,
  type EffectiveRuleDisplayEntry
} from "../memory/serializer.js";

export type AgentReviewContract = {
  procedure: {
    name: string;
    asserts: EffectiveRuleDisplayEntry[];
  };
  action: {
    instruction: string;
    asserts: EffectiveRuleDisplayEntry[];
    suggests: EffectiveRuleDisplayEntry[];
    details: string[];
  };
  artifact: {
    name: string;
    type?: string;
    format?: { name: string; options: Readonly<Record<string, unknown>> };
    schema?: unknown;
    modelTarget?: { storeId: string; modelRef: string; dataId?: string };
    final: boolean;
    review?: string;
  };
};

export function buildAgentReviewContract(context: ArtifactReviewContext): AgentReviewContract {
  const step = currentStep(context.run);
  if (!step || step.id !== context.review.stepId) {
    throw new Error(`Artifact Review current Step is unavailable: ${context.review.stepId}`);
  }
  const frame = currentFrame(context.run);
  const submission = step.store
    ? context.review.submissions.find(item => item.id === context.round.submissionId)
    : undefined;
  const contract = buildReviewContract({
    procedureName: frame?.memoryName ?? context.run.procedureName,
    procedureRules: activeProcedureAssertTrees(context.run), step,
    artifactName: context.review.artifactName
  });
  contract.artifact.modelTarget = step.store && context.run.modelTargets?.[step.store]
    ? { storeId: step.store, modelRef: context.run.modelTargets[step.store].modelRef, dataId: submission?.artifact.modelTarget?.dataId ?? `${context.run.id}--${step.stepExecutionId}` }
    : undefined;
  return contract;
}

/** The same frozen contract shape is used for candidates and accepted inputs. */
export function buildReviewContract(input: {
  procedureName: string; procedureRules: EffectiveRuleTree[];
  step: Pick<NonNullable<ReturnType<typeof currentStep>>, "instruction" | "assertTree" | "suggestTree" | "details" | "artifact" | "type" | "format" | "schema" | "final" | "reviewPolicy">;
  artifactName: string;
}): AgentReviewContract {
  const { step } = input;
  return {
    procedure: {
      name: input.procedureName,
      asserts: input.procedureRules.flatMap(toEffectiveRuleDisplayEntries)
    },
    action: {
      instruction: step.instruction,
      asserts: toEffectiveRuleDisplayEntries(step.assertTree ?? emptyRuleTree("asserts")),
      suggests: toEffectiveRuleDisplayEntries(step.suggestTree ?? emptyRuleTree("suggests")),
      details: step.details ?? []
    },
    artifact: {
      name: step.artifact ?? input.artifactName,
      type: step.type,
      format: step.format,
      schema: toEffectiveRuleDisplayValue(step.schema),
      final: step.final ?? false,
      review: step.reviewPolicy
    }
  };
}

function emptyRuleTree(channel: "asserts" | "suggests"): EffectiveRuleTree {
  return { channel, entries: [], sections: [] };
}

export function summarizeAgentReviewSchema(schema: RunSchemaContract | undefined): string {
  if (!schema) return "None";
  const node = schema.node;
  const parts = [schema.kind === "external" ? `External (${schema.name})` : "Inline"];
  if (node?.type) parts.push(`type ${node.type}`);
  if (node?.format) parts.push(`format ${formatArtifactFormat(node.format)}`);
  if (node?.fields) parts.push(`${node.fields.length} top-level field${node.fields.length === 1 ? "" : "s"}`);
  if (node?.item) parts.push("one item contract");
  if (node?.items) parts.push(`${node.items.length} allowed item contract${node.items.length === 1 ? "" : "s"}`);
  if (!node) parts.push("definition unavailable in this Run snapshot");
  return parts.join("; ");
}

export function formatArtifactFormat(
  format: { name: string; options: Readonly<Record<string, unknown>> } | undefined
): string {
  if (!format) return "unspecified";
  const options = Object.entries(format.options);
  if (!options.length) return format.name;
  return `${format.name} (${options.map(([name, value]) => `${name}: ${String(value)}`).join(", ")})`;
}
