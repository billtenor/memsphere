import type {
  ActionNode,
  ArtifactNode,
  DefinitionPart,
  FlowNode,
  MemoryEntity,
  MemoryRefNode,
  RepeatNode,
  SchemaField,
  SchemaNode,
  StaticSchemaField,
  StatementNode
} from "./ast.js";
import { isMemoryKind, type MemoryKind } from "./kinds.js";
import type { MemoryFile } from "./store.js";

export type MemoryReferenceIssue = {
  path: string;
  message: string;
};

type ExpectedKind = "concepts" | "statements" | "schemas";

type ReferenceEdge = {
  source: string;
  sourcePath: string;
  target: string;
  expected: readonly ExpectedKind[];
  filePath: string;
};

export function validateMemoryReferences(files: readonly MemoryFile[]): MemoryReferenceIssue[] {
  const issues: MemoryReferenceIssue[] = [];
  const byReference = new Map<string, MemoryFile>();
  const edges: ReferenceEdge[] = [];

  for (const file of files) {
    const reference = memoryReference(file.kind, file.entity);
    if (!reference) continue;
    byReference.set(reference, file);
  }

  for (const file of files) {
    const source = memoryReference(file.kind, file.entity);
    if (!source) continue;
    edges.push(...collectReferenceEdges(file.entity, source, file.path));
  }

  const graph = new Map<string, ReferenceEdge[]>();
  for (const edge of edges) {
    if (edge.target === "__invalid_optional_context__") {
      issues.push({
        path: edge.filePath,
        message: `${edge.sourcePath}: optional is only allowed on named Schema fields`
      });
      continue;
    }
    const parsed = parseLogicalReference(edge.target);
    if (!parsed) {
      issues.push({
        path: edge.filePath,
        message: `${edge.sourcePath}: invalid !ref target "${edge.target}"; expected logical reference`
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
    if (!byReference.has(edge.target)) {
      issues.push({
        path: edge.filePath,
        message: `${edge.sourcePath}: !ref target "${edge.target}" was not found`
      });
      continue;
    }
    const outgoing = graph.get(edge.source) ?? [];
    outgoing.push(edge);
    graph.set(edge.source, outgoing);
  }

  issues.push(...detectReferenceCycles(graph));
  return issues;
}

function collectReferenceEdges(entity: MemoryEntity, source: string, filePath: string): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  collectDefinitions(entity.defines, source, filePath, "defines", edges);

  switch (entity.tag) {
    case "!concept":
      break;
    case "!statement":
      collectStatementSections(entity.sections ?? [], source, filePath, "sections", edges);
      break;
    case "!schema":
      collectSchemaRefs(entity, source, filePath, "schema", edges, false);
      break;
    case "!procedure":
      collectFlowRefs(entity.flow, source, filePath, "flow", edges);
      break;
  }
  return edges;
}

function collectDefinitions(
  definitions: readonly DefinitionPart[],
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  for (const [index, definition] of definitions.entries()) {
    const childPath = `${path}[${index}]`;
    if (typeof definition === "string") continue;
    if (definition.tag === "!ref") {
      edges.push(referenceEdge(source, filePath, childPath, definition, ["concepts", "statements", "schemas"]));
      continue;
    }
    collectDefinitions(definition.defines, source, filePath, `${childPath}.defines`, edges);
    if (definition.tag === "!statement") collectStatementSections(definition.sections ?? [], source, filePath, `${childPath}.sections`, edges);
    if (definition.tag === "!schema") collectSchemaRefs(definition, source, filePath, childPath, edges, false);
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
    collectDefinitions(section.defines, source, filePath, `${childPath}.defines`, edges);
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
  collectDefinitions(schema.defines, source, filePath, `${path}.defines`, edges);
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
  collectArtifactRefs(action.artifact, source, filePath, `${path}.artifact`, edges);
}

function collectArtifactRefs(
  artifact: ArtifactNode,
  source: string,
  filePath: string,
  path: string,
  edges: ReferenceEdge[]
): void {
  if (!artifact.schema || typeof artifact.schema === "string") return;
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
  return { source, sourcePath, target: ref.target, expected, filePath };
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

function memoryReference(kind: MemoryKind, entity: MemoryEntity): string | undefined {
  const name = entity.names[0]?.trim();
  return name ? `${kind}/${name}` : undefined;
}

function parseLogicalReference(input: string): { kind: MemoryKind; name: string } | undefined {
  const separator = input.indexOf("/");
  if (separator <= 0) return undefined;
  const kind = input.slice(0, separator);
  const name = input.slice(separator + 1).trim();
  if (!isMemoryKind(kind) || !name) return undefined;
  return { kind, name };
}
