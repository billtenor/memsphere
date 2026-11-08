import {
  activeProcedureAssertTrees,
  currentFrame,
  currentStep,
  type ArtifactReviewContext,
  type RunStep,
  type RunSchemaContract
} from "../run/store.js";
import { failure } from "../context_control/errors.js";
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
  const frame = currentFrame(context.run);
  const scope = (context.round.controlPlane ?? context.review.controlPlane).artifactScope;
  const wrongProcedure = !context.review.id.startsWith("graph-review-") && frame?.type === "procedure" && scope !== `${frame.memoryName}#${step?.id}`;
  if (!step || step.id !== context.review.stepId || wrongProcedure) {
    return buildHistoricalFlowReviewContract(context);
  }
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

/** Historical flow frames have already been popped. Resolve their immutable
 * definition and procedure ancestry, never the current Project or next Step. */
function buildHistoricalFlowReviewContract(context: ArtifactReviewContext): AgentReviewContract {
  const { run, review, round } = context;
  const scope = (round.controlPlane ?? review.controlPlane).artifactScope;
  const suffix = `#${review.stepId}`;
  if (!scope.endsWith(suffix)) throw failure("REVIEW_CONTEXT_INVALID", `Artifact Review frozen Step scope is invalid: ${scope}`);
  const name = scope.slice(0, -suffix.length);
  const templates = run.procedureSnapshots ?? {};
  const steps = name === run.procedureName ? run.plan : templates[name]?.steps;
  function flatten(items: readonly RunStep[]): RunStep[] {
    return items.flatMap(item => [item, ...flatten(item.branches?.truthy ?? []), ...flatten(item.branches?.falsy ?? []), ...flatten(item.loop?.body ?? [])]);
  }
  const matches = flatten(steps ?? []).filter(item => item.id === review.stepId);
  if (matches.length !== 1) throw failure("REVIEW_CONTEXT_INVALID", `Artifact Review frozen Step is unavailable: ${scope}`);
  const paths: EffectiveRuleTree[][] = [];
  function visit(procedure: string, ancestors: string[], rules: EffectiveRuleTree[]) {
    if (ancestors.includes(procedure)) return;
    const template = templates[procedure];
    const next = template?.assertTree ? [...rules, template.assertTree] : rules;
    if (procedure === name) { paths.push(next); return; }
    for (const target of new Set(flatten(procedure === run.procedureName ? run.plan ?? [] : template?.steps ?? []).filter(s => s.kind === "call").map(s => s.target).filter((s): s is string => Boolean(s)))) {
      visit(target, [...ancestors, procedure], next);
    }
  }
  visit(run.procedureName, [], run.assertTree ? [run.assertTree] : []);
  const unique = new Map(paths.map(path => {
    const deduped = [...new Map(path.map(tree => [JSON.stringify(tree), tree])).values()];
    return [JSON.stringify(deduped), deduped] as const;
  }));
  // Old persistence has no execution ancestry after frame removal. If frozen
  // callers disagree, fail explicitly rather than merge or guess their rules.
  if (unique.size !== 1) throw failure("REVIEW_CONTEXT_INVALID", `Artifact Review frozen procedure ancestry is unavailable or ambiguous: ${scope}`);
  const step = matches[0]!;
  const contract = buildReviewContract({ procedureName: name, procedureRules: [...unique.values()][0]!, step: { ...step, reviewPolicy: review.policyId }, artifactName: review.artifactName });
  const target = review.submissions.find(item => item.id === round.submissionId)?.artifact.modelTarget;
  contract.artifact.modelTarget = target ? { storeId: target.storeId, modelRef: target.modelRef, dataId: target.dataId } : undefined;
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
