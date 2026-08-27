import type {
  ActionNode,
  ArtifactNode,
  FlowNode,
  MemoryEntity,
  MemoryRefNode,
  RepeatNode,
  RulePart,
  SchemaField,
  SchemaNode,
  StaticSchemaField,
  StatementNode
} from "./ast.js";
import {
  canonicalMemoryNameIssue,
  canonicalMemoryReference,
  parseLogicalMemoryReference
} from "./logical-reference.js";
import type { MemoryFile } from "./store.js";

export type MemoryReferenceIssue = {
  path: string;
  message: string;
};

type ExpectedKind = "concepts" | "statements" | "schemas" | "procedures";

type ReferenceEdge = {
  source: string;
  sourcePath: string;
  target: string;
  form: "logical-reference" | "canonical-name";
  expected: readonly ExpectedKind[];
  filePath: string;
  channel?: "asserts" | "suggests";
};

export function collectMemoryReferenceTargets(entity: MemoryEntity): string[] {
  const sourceKind = entity.tag === "!concept"
    ? "concepts"
    : entity.tag === "!statement"
      ? "statements"
      : entity.tag === "!schema" ? "schemas" : "procedures";
  const source = canonicalMemoryReference(sourceKind, entity.names[0] ?? "") ?? `${sourceKind}/unknown`;
  const targets = new Set<string>();
  for (const edge of collectReferenceEdges(entity, source, source)) {
    if (edge.target === "__invalid_optional_context__") continue;
    if (edge.form === "logical-reference") {
      const parsed = parseLogicalMemoryReference(edge.target);
      if (!parsed || !edge.expected.includes(parsed.kind as ExpectedKind)) continue;
      const reference = canonicalMemoryReference(parsed.kind, parsed.name);
      if (reference) targets.add(reference);
      continue;
    }
    if (canonicalMemoryNameIssue(edge.target)) continue;
    const reference = canonicalMemoryReference(edge.expected[0], edge.target);
    if (reference) targets.add(reference);
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

export function validateMemoryReferences(files: readonly MemoryFile[]): MemoryReferenceIssue[] {
  const issues: MemoryReferenceIssue[] = [];
  const byReference = new Map<string, Set<string>>();
  const entitiesByReference = new Map<string, MemoryEntity>();
  const edges: ReferenceEdge[] = [];

  for (const file of files) {
    const reference = canonicalMemoryReference(file.kind, file.entity.names[0] ?? "");
    if (!reference) continue;
    const matches = byReference.get(reference) ?? new Set<string>();
    matches.add(reference);
    byReference.set(reference, matches);
    entitiesByReference.set(reference, file.entity);
  }

  for (const file of files) {
    const source = canonicalMemoryReference(file.kind, file.entity.names[0] ?? "");
    if (!source) continue;
    edges.push(...collectReferenceEdges(file.entity, source, file.path));
  }

  const graph = new Map<string, ReferenceEdge[]>();
  const ruleGraphs = {
    asserts: new Map<string, ReferenceEdge[]>(),
    suggests: new Map<string, ReferenceEdge[]>()
  };
  for (const edge of edges) {
    if (edge.target === "__invalid_optional_context__") {
      issues.push({
        path: edge.filePath,
        message: `${edge.sourcePath}: optional is only allowed on named Schema fields`
      });
      continue;
    }
    let targetReference: string | undefined;
    if (edge.form === "logical-reference") {
      const parsed = parseLogicalMemoryReference(edge.target);
      if (!parsed) {
        issues.push({
          path: edge.filePath,
          message: `${edge.sourcePath}: invalid !ref target "${edge.target}"; expected canonical logical reference`
        });
        continue;
      }
      if (!edge.expected.includes(parsed.kind as ExpectedKind)) {
        issues.push({
          path: edge.filePath,
          message: `${edge.sourcePath}: !ref target "${edge.target}" has kind ${parsed.kind}; expected ${edge.expected.join(" or ")}`
        });
        continue;
      }
      targetReference = canonicalMemoryReference(parsed.kind, parsed.name);
    } else {
      const nameIssue = canonicalMemoryNameIssue(edge.target);
      if (nameIssue) {
        issues.push({
          path: edge.filePath,
          message: `${edge.sourcePath}: invalid canonical Memory target "${edge.target}": ${nameIssue}`
        });
        continue;
      }
      targetReference = canonicalMemoryReference(edge.expected[0], edge.target);
    }
    if (!targetReference) continue;
    const targets = byReference.get(targetReference);
    if (!targets || targets.size === 0) {
      issues.push({
        path: edge.filePath,
        message: `${edge.sourcePath}: Memory target "${edge.target}" was not found`
      });
      continue;
    }
    // Catalog validation reports the conflicting name. Do not choose an
    // arbitrary canonical target and derive misleading dependency cycles.
    if (targets.size > 1) continue;
    const resolvedTarget = [...targets][0];
    if (edge.channel) {
      const targetEntity = entitiesByReference.get(resolvedTarget);
      if (
        targetEntity?.tag === "!statement" &&
        !hasEffectiveRuleChannel(targetEntity, edge.channel, entitiesByReference, new Set([resolvedTarget]))
      ) {
        issues.push({
          path: edge.filePath,
          message: `${edge.sourcePath}: !ref target "${edge.target}" has no effective ${edge.channel}`
        });
      }
      const ruleGraph = ruleGraphs[edge.channel];
      const source = `${edge.source}.${edge.channel}`;
      const target = `${resolvedTarget}.${edge.channel}`;
      const outgoing = ruleGraph.get(source) ?? [];
      outgoing.push({ ...edge, source, target });
      ruleGraph.set(source, outgoing);
    } else {
      const outgoing = graph.get(edge.source) ?? [];
      outgoing.push({ ...edge, target: resolvedTarget });
      graph.set(edge.source, outgoing);
    }
  }

  issues.push(...detectReferenceCycles(graph));
  issues.push(...detectReferenceCycles(ruleGraphs.asserts));
  issues.push(...detectReferenceCycles(ruleGraphs.suggests));
  return issues;
}

function hasEffectiveRuleChannel(
  statement: StatementNode,
  channel: "asserts" | "suggests",
  entities: ReadonlyMap<string, MemoryEntity>,
  visiting: Set<string>
): boolean {
  const parts = statement[channel] ?? [];
  if (parts.some((part) => typeof part === "string")) return true;
  for (const part of parts) {
    if (typeof part === "string") continue;
    const parsed = parseLogicalMemoryReference(part.target);
    if (!parsed || parsed.kind !== "statements") continue;
    const target = canonicalMemoryReference(parsed.kind, parsed.name);
    if (!target || visiting.has(target)) continue;
    const entity = entities.get(target);
    if (entity?.tag !== "!statement") continue;
    const nestedVisiting = new Set(visiting);
    nestedVisiting.add(target);
    if (hasEffectiveRuleChannel(entity, channel, entities, nestedVisiting)) return true;
  }
  return (statement.sections ?? []).some((section) =>
    hasEffectiveRuleChannel(section, channel, entities, new Set(visiting))
  );
}

function collectReferenceEdges(entity: MemoryEntity, source: string, filePath: string): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  switch (entity.tag) {
    case "!concept":
      for (const [index, target] of (entity.extends ?? []).entries()) {
        edges.push(canonicalNameEdge(source, filePath, `extends[${index}]`, target, "concepts"));
      }
      break;
    case "!statement":
      collectRuleRefs(entity.asserts ?? [], source, filePath, "asserts", "asserts", edges);
      collectRuleRefs(entity.suggests ?? [], source, filePath, "suggests", "suggests", edges);
      collectStatementSections(entity.sections ?? [], source, filePath, "sections", edges);
      break;
    case "!schema":
      collectSchemaRefs(entity, source, filePath, "schema", edges, false);
      break;
    case "!procedure":
      collectRuleRefs(entity.asserts ?? [], source, filePath, "asserts", "asserts", edges);
      collectFlowRefs(entity.flow, source, filePath, "flow", edges);
      break;
  }
  return edges;
}

function collectRuleRefs(
  parts: readonly RulePart[],
  source: string,
  filePath: string,
  path: string,
  channel: "asserts" | "suggests",
  edges: ReferenceEdge[]
): void {
  for (const [index, part] of parts.entries()) {
    if (typeof part === "string") continue;
    edges.push({
      ...referenceEdge(source, filePath, `${path}[${index}]`, part, ["statements"]),
      channel
    });
  }
}

function collectStatementSections(
  sections: readonly StatementNode[],
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  for (const [index, section] of sections.entries()) {
    const childPath = `${path}[${index}]`;
    collectRuleRefs(section.asserts ?? [], source, filePath, `${childPath}.asserts`, "asserts", edges);
    collectRuleRefs(section.suggests ?? [], source, filePath, `${childPath}.suggests`, "suggests", edges);
    collectStatementSections(section.sections ?? [], source, filePath, `${childPath}.sections`, edges);
  }
}

function collectSchemaRefs(
  schema: SchemaNode,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[],
  fieldPosition: boolean
): void {
  collectRuleRefs(schema.asserts ?? [], source, filePath, `${path}.asserts`, "asserts", edges);
  collectRuleRefs(schema.suggests ?? [], source, filePath, `${path}.suggests`, "suggests", edges);
  for (const [index, field] of (schema.fields ?? []).entries()) {
    collectSchemaFieldRef(field, source, filePath, `${path}.fields[${index}]`, edges);
  }
  if (schema.item) collectStaticSchemaFieldRef(schema.item, source, filePath, `${path}.item`, edges);
  for (const [index, item] of (schema.items ?? []).entries()) {
    collectStaticSchemaFieldRef(item, source, filePath, `${path}.items[${index}]`, edges);
  }
  if (schema.optional === true && !fieldPosition) {
    edges.push({
      source,
      sourcePath: `${path}.optional`,
      target: "__invalid_optional_context__",
      form: "canonical-name",
      expected: ["schemas"],
      filePath
    });
  }
}

function collectSchemaFieldRef(
  field: SchemaField,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  if (typeof field === "object" && field.tag === "!repeat") {
    collectRepeatRefs(field, source, filePath, path, edges);
    return;
  }
  collectStaticSchemaFieldRef(field, source, filePath, path, edges);
}

function collectStaticSchemaFieldRef(
  field: StaticSchemaField,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  if (typeof field === "string") return;
  if (field.tag === "!ref") {
    edges.push(referenceEdge(source, filePath, path, field, ["schemas"]));
    return;
  }
  collectSchemaRefs(field, source, filePath, path, edges, true);
}

function collectRepeatRefs(
  repeat: RepeatNode,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  for (const [index, field] of repeat.body.entries()) {
    collectStaticSchemaFieldRef(field, source, filePath, `${path}.body[${index}]`, edges);
  }
}

function collectFlowRefs(
  flow: readonly FlowNode[],
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  for (const [index, node] of flow.entries()) {
    const childPath = `${path}[${index}]`;
    switch (node.tag) {
      case "!action":
        collectActionRefs(node, source, filePath, childPath, edges);
        break;
      case "!if":
        collectActionRefs(node.condition, source, filePath, `${childPath}.condition`, edges);
        collectFlowRefs(node.then, source, filePath, `${childPath}.then`, edges);
        if (node.elseif) collectFlowRefs([node.elseif], source, filePath, `${childPath}.elseif`, edges);
        collectFlowRefs(node.else ?? [], source, filePath, `${childPath}.else`, edges);
        break;
      case "!while":
        collectActionRefs(node.condition, source, filePath, `${childPath}.condition`, edges);
        collectFlowRefs(node.do, source, filePath, `${childPath}.do`, edges);
        break;
      case "!call":
        edges.push(canonicalNameEdge(source, filePath, `${childPath}.target`, node.target, "procedures"));
        break;
    }
  }
}

function collectActionRefs(
  action: ActionNode,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  collectRuleRefs(action.asserts ?? [], source, filePath, `${path}.asserts`, "asserts", edges);
  collectRuleRefs(action.suggests ?? [], source, filePath, `${path}.suggests`, "suggests", edges);
  collectArtifactRefs(action.artifact, source, filePath, `${path}.artifact`, edges);
}

function collectArtifactRefs(
  artifact: ArtifactNode,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  if (!artifact.schema) return;
  if (typeof artifact.schema === "string") {
    edges.push(canonicalNameEdge(source, filePath, `${path}.schema`, artifact.schema, "schemas"));
    return;
  }
  if (artifact.schema.tag === "!ref") {
    edges.push(referenceEdge(source, filePath, `${path}.schema`, artifact.schema, ["schemas"]));
    return;
  }
  collectSchemaRefs(artifact.schema, source, filePath, `${path}.schema`, edges, false);
}

function referenceEdge(
  source: string,
  filePath: string,
  sourcePath: string,
  ref: MemoryRefNode,
  expected: readonly ExpectedKind[]
): ReferenceEdge {
  return { source, sourcePath, target: ref.target, form: "logical-reference", expected, filePath };
}

function canonicalNameEdge(
  source: string,
  filePath: string,
  sourcePath: string,
  target: string,
  expected: ExpectedKind
): ReferenceEdge {
  return { source, sourcePath, target, form: "canonical-name", expected: [expected], filePath };
}

function detectReferenceCycles(graph: ReadonlyMap<string, readonly ReferenceEdge[]>): MemoryReferenceIssue[] {
  const issues: MemoryReferenceIssue[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: ReferenceEdge[] = [];

  const visit = (reference: string): void => {
    if (visited.has(reference)) return;
    if (visiting.has(reference)) {
      const start = stack.findIndex((edge) => edge.source === reference);
      const cycle = stack.slice(Math.max(0, start)).concat(stack.at(-1) ? [] : []);
      const detail = cycle.map((edge) => `${edge.source} ${edge.sourcePath} -> ${edge.target}`).join(" | ");
      const edge = stack.at(-1);
      issues.push({
        path: edge?.filePath ?? reference,
        message: `Memory reference cycle detected: ${detail || reference}`
      });
      return;
    }

    visiting.add(reference);
    for (const edge of graph.get(reference) ?? []) {
      stack.push(edge);
      visit(edge.target);
      stack.pop();
    }
    visiting.delete(reference);
    visited.add(reference);
  };

  for (const reference of graph.keys()) visit(reference);
  return issues;
}
