import { bytesContent } from "../data/extensions/shared/payload.js";
import { isDeepStrictEqual } from "node:util";
import type { GraphArtifactSpec, GraphModelSpec, SchemaNode, SchemaMemory, StatementMemory } from "../memory/ast.js";
import { MEMSPHERE_SCHEMA_MODEL, parseSchemaModel, serializeSchemaModel } from "../memory/schema-model.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { parseMemoryEntity } from "../memory/store.js";
import { resolveRuleParts, type EffectiveRuleTree } from "../memory/rules.js";
import type { ReviewNodeSource, ReviewSource } from "../review-nodes.js";
import { SchemaModelRuntime } from "../data/extensions/memsphere-schema/index.js";
import { failure } from "./errors.js";
import type { Run } from "./types.js";

export type FrozenSchemaContract = {
  compiledVersion: 1;
  definition: string;
  sources: ReviewNodeSource;
  nodeSources: Record<string, ReviewNodeSource>;
};
export type ResolvedArtifactSpec = Omit<GraphArtifactSpec, "model"> & { model: { definedBy: string; definition: string } };

type Lookup = (ref: string) => SchemaMemory | StatementMemory;

/** Compile against the supplied frozen collection, never the current Project. */
export async function freezeSchemaContract(spec: GraphArtifactSpec, memories: NonNullable<Run["memorySnapshot"]>["memories"], source: ReviewSource): Promise<FrozenSchemaContract> {
  const lookup: Lookup = ref => {
    const memory = memories[ref];
    if (!memory) throw failure("NOT_FOUND", `Frozen Schema dependency not found: ${ref}`);
    const kind = ref.startsWith("schemas/") ? "schemas" : ref.startsWith("statements/") ? "statements" : undefined;
    if (!kind) throw failure("INVALID_ARGUMENT", `Invalid Schema dependency kind: ${ref}`);
    return parseMemoryEntity(kind, parseMemoryYaml(memory.payload.content)) as SchemaMemory | StatementMemory;
  };
  let parsed: ReturnType<typeof parseSchemaModel>;
  const stack: string[] = [];
  if (spec.model.ref) {
    const entity = lookup(spec.model.ref);
    if (entity.tag !== "!schema") throw failure("INVALID_ARGUMENT", "model.ref must identify a Schema");
    parsed = { syntax: entity.syntax, node: entity };
    source = { kind: "schema", memoryRef: spec.model.ref, path: "." };
    stack.push(spec.model.ref);
  } else parsed = parseSchemaModel(spec.model.definition!);
  const nodeSources: Record<string, ReviewNodeSource> = {};
  async function expand(node: SchemaNode, origin: ReviewSource, seen: string[], contractPath = "schema"): Promise<{ node: SchemaNode; source: ReviewNodeSource }> {
    const children: ReviewNodeSource[] = [];
    const childOrigin = (suffix: string) => ({ ...origin, path: origin.path === "." ? suffix : `${origin.path}.${suffix}` });
    const member = async (value: SchemaNode | { tag: "!ref"; target: string }, suffix: string, field: boolean) => {
      let next = value, nextOrigin = childOrigin(suffix), nextSeen = seen;
      if (next.tag === "!ref") {
        if (seen.includes(next.target)) throw failure("INVALID_ARGUMENT", `Circular Schema reference: ${[...seen, next.target].join(" -> ")}`);
        const entity = lookup(next.target);
        if (entity.tag !== "!schema") throw failure("INVALID_ARGUMENT", `Expected Schema: ${next.target}`);
        nextOrigin = { kind: "schema", memoryRef: next.target, path: "." };
        nextSeen = [...seen, next.target]; next = entity;
      }
      if (field && !next.names.length) throw failure("INVALID_ARGUMENT", "Schema field requires a name");
      const result = await expand(next, nextOrigin, nextSeen, `${contractPath}.${suffix}`);
      children.push(result.source);
      return result.node;
    };
    const result: SchemaNode = { ...node };
    // Memory syntax belongs to the document, not an embedded node.
    delete (result as SchemaNode & { syntax?: string }).syntax;
    if (node.fields) {
      result.fields = [];
      for (const [i, f] of node.fields.entries()) {
        if (typeof f === "string") { await member({ tag: "!schema", names: [f], defines: [] }, `fields[${i}]`, true); result.fields.push(f); continue; }
        if (f.tag === "!repeat") {
          const body = [];
          for (const [j, b] of f.body.entries()) {
            const expanded = await member(typeof b === "string" ? { tag: "!schema", names: [b], defines: [] } : b, `fields[${i}].body[${j}]`, true);
            body.push(typeof b === "string" ? b : expanded);
          }
          result.fields.push({ ...f, body });
        } else result.fields.push(await member(f, `fields[${i}]`, true));
      }
    }
    if (node.item) result.item = await member(node.item, "item", false);
    if (node.items) { result.items = []; for (const [i, item] of node.items.entries()) result.items.push(await member(item, `items[${i}]`, false)); }
    const rules = async (channel: "asserts" | "suggests"): Promise<EffectiveRuleTree> => resolveRuleParts(channel, node[channel], async ref => {
      const entity = lookup(ref);
      if (entity.tag !== "!statement") throw failure("INVALID_ARGUMENT", `Expected Statement: ${ref}`);
      return entity;
    });
    const projected = { source: origin, name: node.names[0] ?? "Schema", defines: node.defines, asserts: await rules("asserts"), suggests: await rules("suggests"), children };
    nodeSources[contractPath] = projected;
    return { node: result, source: projected };
  }
  const resolved = await expand(parsed.node, source, stack);
  parseSchemaModel(serializeSchemaModel(parsed.syntax, resolved.node));
  const definition = serializeSchemaModel(parsed.syntax, resolved.node);
  // Compile the full validation plan before the Run is written.
  const runtime = schemaRuntime(definition);
  const contract = runtime.contract(spec.payload.contentType);
  const { createBuiltInArtifactValidatorRegistry } = await import("../artifact-validation.js");
  createBuiltInArtifactValidatorRegistry().resolvePlan(contract);
  return { compiledVersion: 1, definition, sources: resolved.source, nodeSources };
}
export function schemaRuntime(definition: string) {
  return new SchemaModelRuntime({ data: { id: "memsphere/graph-artifact.json", model: MEMSPHERE_SCHEMA_MODEL, payload: { contentType: "application/yaml", content: bytesContent(new Uint8Array()) } }, definition });
}
export function resolvedArtifact(run: Run, actionId: string, spec: GraphArtifactSpec): ResolvedArtifactSpec {
  if (spec.model.definedBy !== MEMSPHERE_SCHEMA_MODEL) {
    if (typeof spec.model.definition !== "string") throw failure("INVALID_STATE", "Unresolved model reference");
    return { ...spec, model: { definedBy: spec.model.definedBy, definition: spec.model.definition } };
  }
  const frozen = run.schemaContracts?.[actionId];
  if (!frozen || frozen.compiledVersion !== 1) throw failure("SCHEMA_CONTRACT_VERSION_UNSUPPORTED", `Unsupported Schema contract for Run ${run.id}, Action ${actionId}: ${frozen?.compiledVersion}; supported: 1`);
  return { ...spec, model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition: frozen.definition } };
}
export function sameModel(left: GraphModelSpec, right: GraphModelSpec): boolean {
  if (left.definedBy !== right.definedBy || !left.definition || !right.definition) return false;
  try {
    return isDeepStrictEqual(left.definedBy === MEMSPHERE_SCHEMA_MODEL ? parseSchemaModel(left.definition) : JSON.parse(left.definition), right.definedBy === MEMSPHERE_SCHEMA_MODEL ? parseSchemaModel(right.definition) : JSON.parse(right.definition));
  } catch { return false; }
}

/** Freeze real content instances into the Review, including repeated same-name fields. */
export async function schemaReviewSources(frozen: FrozenSchemaContract, contentType: string, bytes: Uint8Array): Promise<ReviewNodeSource[]> {
  const { prepareArtifactCandidate, projectSchemaContent } = await import("../artifact-validation.js");
  const runtime = schemaRuntime(frozen.definition), contract = runtime.contract(contentType);
  const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }, { runId: "review", stepId: "review", artifactPath: "artifact", attemptId: "projection" });
  const instances = await projectSchemaContent(runtime.schema.node, contract, candidate);
  const present = new Set(instances.map(instance => instance.contractPath));
  const projected = instances.flatMap(instance => {
    const source = frozen.nodeSources[instance.contractPath];
    if (!source) return [];
    return [{ ...source, requiresReport: true, name: instance.fieldPath || source.name, children: [], defines: [...(source.defines ?? []), `Artifact position: ${instance.fieldPath || "."}`, `Content:\n${instance.text}`] }];
  });
  for (const [path, source] of Object.entries(frozen.nodeSources)) if (!present.has(path)) projected.push({ ...source, requiresReport: true, name: `${source.name} (no content instance)`, children: [], defines: [...(source.defines ?? []), "No content instance: optional field omitted, Repeat has no instances, or a union branch was not selected. Review applicability against the frozen contract."] });
  return projected;
}
