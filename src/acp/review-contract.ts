import {
  activeProcedureAsserts,
  currentFrame,
  currentStep,
  type ArtifactReviewContext,
  type RunSchemaContract
} from "../run/store.js";

export type AgentReviewContract = {
  procedure: {
    name: string;
    asserts: string[];
  };
  action: {
    instruction: string;
    asserts: string[];
    suggests: string[];
    details: string[];
  };
  artifact: {
    name: string;
    type?: string;
    format?: { name: string; options: Readonly<Record<string, unknown>> };
    schema?: RunSchemaContract;
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
  return {
    procedure: {
      name: frame?.memoryName ?? context.run.procedureName,
      asserts: activeProcedureAsserts(context.run)
    },
    action: {
      instruction: step.instruction,
      asserts: step.asserts ?? [],
      suggests: step.suggests ?? [],
      details: step.details ?? []
    },
    artifact: {
      name: step.artifact ?? context.review.artifactName,
      type: step.type,
      format: step.format,
      schema: step.schema,
      final: step.final ?? false,
      review: step.reviewPolicy
    }
  };
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
