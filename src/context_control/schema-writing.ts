import { resolveSchemaContract } from "../memory/schema.js";
import type { SchemaNode, ArtifactFormatSpec } from "../memory/ast.js";
import { createHash } from "node:crypto";
import type { RunStep } from "../run/store.js";
import { compileSchemaSteps, compileRepeatBody } from "../run/store.js";
import { ArtifactValidationFailure, createBuiltInArtifactValidatorRegistry, prepareArtifactCandidate, type CompiledArtifactContract } from "../artifact-validation.js";
import { schemaRuntime } from "./schema-contract.js";
import type { Artifact, SubmissionFrame } from "./types.js";
import { failure } from "./errors.js";

export type SchemaWriting = {
  items: RunStep[];
  contracts: Record<string, CompiledArtifactContract>;
  index: number;
  values: Record<string, string>;
  skipped: string[];
  submission?: { token: string; frame: SubmissionFrame };
};
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function startSchemaWriting(definition: string, contentType: string, name: string): SchemaWriting {
  const runtime = schemaRuntime(definition), contract = runtime.contract(contentType);
  const items = compileSchemaSteps({ ...runtime.schema.node, format: contract.format }, name, contract);
  const contracts: Record<string, CompiledArtifactContract> = {};
  collectWritingContracts({ ...runtime.schema.node, format: contract.format }, name, contract.format, contracts);
  return { items: clean(items), contracts: clean(contracts), index: 0, values: {}, skipped: [] };
}
export function writingPosition(draft: Artifact, revision: string): string {
  return createHash("sha256").update(JSON.stringify([draft.stepId, draft.id, revision, draft.writing?.items[draft.writing.index]?.id])).digest("hex");
}
export function checkWritingPosition(draft: Artifact, revision: string, position?: string) {
  if (!position || position !== writingPosition(draft, revision)) throw failure("SCHEMA_POSITION_CHANGED", "Writing position changed; read schema show and use its position token");
  if (!draft.writing || draft.writing.submission || draft.status !== "draft") throw failure("RECOVERY_REQUIRED", "Draft is no longer editable");
  if (draft.writing.index >= draft.writing.items.length) throw failure("INVALID_ARGUMENT", "All fields are complete; inspect and submit the full Artifact");
}
export async function reportSchemaItem(writing: SchemaWriting, text: string): Promise<void> {
  const item = writing.items[writing.index];
  if (item.kind === "repeat") throw failure("INVALID_ARGUMENT", "Choose the Repeat count first");
  const contract: CompiledArtifactContract = writing.contracts[item.id] ?? { name: item.artifact!, type: item.type!, format: item.format!, final: false };
  const context = { runId: "writing", stepId: item.id, artifactPath: item.schemaContext?.path ?? item.id, attemptId: "field" };
  const registry = createBuiltInArtifactValidatorRegistry();
  const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: text }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });
  if (result.status !== "passed") throw new ArtifactValidationFailure(result);
  writing.values[item.id] = text; writing.index++;
}
export function skipSchemaItem(writing: SchemaWriting): void {
  const item = writing.items[writing.index];
  if (item.kind === "repeat" || !item.optional) throw failure("INVALID_ARGUMENT", "Only the current optional field can be skipped");
  writing.skipped.push(item.id); writing.index++;
  // Skipping a named optional object skips its whole writing subtree.
  const prefix = `${item.artifact}.`;
  while (writing.items[writing.index]?.schemaContext?.path.startsWith(prefix)) {
    writing.skipped.push(writing.items[writing.index].id); writing.index++;
  }
}
export function repeatSchemaItem(writing: SchemaWriting, count: number): void {
  const item = writing.items[writing.index], repeat = item.repeat;
  if (item.kind !== "repeat" || !repeat || !Number.isSafeInteger(count) || count < repeat.min || repeat.max !== undefined && count > repeat.max) throw failure("INVALID_ARGUMENT", "Repeat count must satisfy the current min/max limits");
  const items = compileRepeatBody(repeat, count, undefined, item.schemaContext);
  for (let i = 1; i <= count; i++) for (const child of repeat.body) if (typeof child === "object" && child.tag === "!schema") collectWritingContracts(child, `${repeat.parentPath}.${child.names[0]}[${i}]`, { name: "markdown", options: { layout: "outline" } }, writing.contracts);
  writing.items.splice(writing.index, 1, ...clean(items));
}
/** Preserve single-item serialization; only outline contracts assemble section text. */
export function assembleSchemaDraft(writing: SchemaWriting, rootName: string, contentType: string): string {
  const root = writing.items[0];
  if (root?.format?.name !== "markdown" || root.format.options.layout !== "outline") return writing.values[root.id] ?? "";
  const chunks: string[] = [];
  for (const item of writing.items) {
    if (!item.artifact || item.kind === "repeat" || writing.skipped.includes(item.id)) continue;
    const value = writing.values[item.id];
    if (value === undefined) continue;
    if (item.artifact === rootName) { chunks.push(value); continue; }
    const path = item.artifact.startsWith(`${rootName}.`) ? item.artifact.slice(rootName.length + 1) : item.artifact;
    const segments = path.split(".");
    chunks.push(`${"#".repeat(Math.min(6, segments.length + 1))} ${segments.at(-1)!.replace(/\[(\d+)\]/g, " $1")}`, value);
  }
  return chunks.join("\n\n");
}

function collectWritingContracts(node: SchemaNode, path: string, parent: ArtifactFormatSpec, out: Record<string, CompiledArtifactContract>) {
  const resolved = resolveSchemaContract(node, parent);
  const outline = resolved.type === "object" && resolved.format.name === "markdown" && resolved.format.options.layout === "outline";
  out[`schema:${path}`] = { name: path, ...resolved, ...(outline ? {} : { schema: node }), final: false };
  if (outline) for (const field of node.fields ?? []) if (typeof field === "object" && field.tag === "!schema") collectWritingContracts(field, `${path}.${field.names[0]}`, resolved.format, out);
}
