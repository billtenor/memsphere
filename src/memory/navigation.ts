import type {
  ActionNode,
  CallNode,
  DefinitionPart,
  FlowNode,
  IfNode,
  MemoryEntity,
  ProcedureMemory,
  RepeatNode,
  SchemaField,
  SchemaNode,
  StatementNode,
  WhileNode
} from "./ast.js";
import type { MemoryKind } from "./kinds.js";

export const memoryNodeTypes = ["Statement", "String", "Schema", "Action", "If", "While", "Call"] as const;
export type MemoryNodeType = (typeof memoryNodeTypes)[number];

export type MemoryIdentity = {
  reference: string;
  kind: MemoryKind;
  names: string[];
};

export type MemoryNodeDescriptor = {
  node_ref: string;
  type: MemoryNodeType;
  name?: string;
  field?: string;
  artifact?: string;
  condition_artifact?: string;
  target?: string;
  summary?: string;
  relation?: string;
  has_children: boolean;
};

export type MemoryNodeListPage = {
  memory: MemoryIdentity;
  parent_node_ref?: string;
  nodes: MemoryNodeDescriptor[];
  next_cursor: null;
};

export type MemoryNodeContextEntry = {
  node_ref?: string;
  type: MemoryNodeType | "Repeat";
  relation: string;
  value: unknown;
};

export type MemoryNodeReadResult = {
  memory: MemoryIdentity;
  node_ref: string;
  node_type: MemoryNodeType;
  context: {
    root: unknown;
    ancestors: MemoryNodeContextEntry[];
  };
  fragment: unknown;
};

type InternalMemoryNode = MemoryNodeDescriptor & {
  value: unknown;
  contexts: MemoryNodeContextEntry[];
  children: InternalMemoryNode[];
};

export class MemoryNodeNotFoundError extends Error {
  constructor(readonly nodeRef: string, readonly memoryReference: string) {
    super(`node "${nodeRef}" was not found in memory "${memoryReference}". Run memsphere memory list "${memoryReference}" to discover available nodes.`);
    this.name = "MemoryNodeNotFoundError";
  }
}

export class MemoryNavigation {
  readonly #identity: MemoryIdentity;
  readonly #rootContext: unknown;
  readonly #nodes: InternalMemoryNode[];
  readonly #index: Map<string, InternalMemoryNode>;

  constructor(identity: MemoryIdentity, entity: MemoryEntity) {
    this.#identity = { ...identity, names: [...identity.names] };
    this.#rootContext = rootContext(entity);
    this.#nodes = buildRootNodes(entity);
    this.#index = indexNodes(this.#nodes);
  }

  listChildren(nodeRef?: string): MemoryNodeListPage {
    const nodes = nodeRef === undefined ? this.#nodes : this.#resolve(nodeRef).children;
    return {
      memory: cloneIdentity(this.#identity),
      parent_node_ref: nodeRef,
      nodes: nodes.map(toDescriptor),
      next_cursor: null
    };
  }

  readNode(nodeRef: string): MemoryNodeReadResult {
    const node = this.#resolve(nodeRef);
    return {
      memory: cloneIdentity(this.#identity),
      node_ref: node.node_ref,
      node_type: node.type,
      context: {
        root: cloneValue(this.#rootContext),
        ancestors: cloneValue(node.contexts)
      },
      fragment: cloneValue(node.value)
    };
  }

  #resolve(nodeRef: string): InternalMemoryNode {
    const node = this.#index.get(nodeRef);
    if (!node) throw new MemoryNodeNotFoundError(nodeRef, this.#identity.reference);
    return node;
  }
}

function buildRootNodes(entity: MemoryEntity): InternalMemoryNode[] {
  switch (entity.tag) {
    case "!concept":
      return [];
    case "!statement":
      return buildStatementNodes(entity.sections ?? [], "", []);
    case "!schema":
      return buildSchemaChildren(entity, "", []);
    case "!procedure":
      return buildFlowNodes(entity.flow, "", [], "flow");
  }
}

function buildSchemaChildren(
  schema: SchemaNode,
  prefix: string,
  contexts: MemoryNodeContextEntry[]
): InternalMemoryNode[] {
  const nodes = buildSchemaFields(schema.fields ?? [], prefix, contexts);
  if (schema.item) {
    nodes.push(buildSchemaItemNode(schema.item, prefix, "item", contexts, "item"));
  }
  for (const [index, item] of (schema.items ?? []).entries()) {
    nodes.push(buildSchemaItemNode(item, prefix, `items[${index + 1}]`, contexts, "items"));
  }
  return nodes;
}

function buildSchemaItemNode(
  schema: SchemaNode,
  prefix: string,
  segment: string,
  contexts: MemoryNodeContextEntry[],
  relation: "item" | "items"
): InternalMemoryNode {
  const nodeRef = joinReference(prefix, segment);
  const children = buildSchemaChildren(
    schema,
    nodeRef,
    contexts.concat({
      node_ref: nodeRef,
      type: "Schema",
      relation,
      value: stripSchemaChildren(schema)
    })
  );
  return createNode({
    nodeRef,
    type: "Schema",
    name: schema.names[0],
    summary: definitionSummary(schema.defines, schema.asserts),
    relation,
    value: schema,
    contexts,
    children
  });
}

function buildStatementNodes(
  statements: StatementNode[],
  prefix: string,
  contexts: MemoryNodeContextEntry[]
): InternalMemoryNode[] {
  return buildUniqueSiblings(statements, (statement) => `statement:${escapeReferenceValue(statement.names[0])}`, (statement, segment) => {
    const nodeRef = joinReference(prefix, segment);
    const children = buildStatementNodes(
      statement.sections ?? [],
      nodeRef,
      contexts.concat({
        node_ref: nodeRef,
        type: "Statement",
        relation: "section",
        value: stripStatementSections(statement)
      })
    );
    return createNode({
      nodeRef,
      type: "Statement",
      name: statement.names[0],
      summary: definitionSummary(statement.defines, statement.asserts, statement.suggests),
      relation: "section",
      value: statement,
      contexts,
      children
    });
  });
}

function buildSchemaFields(
  fields: SchemaField[],
  prefix: string,
  contexts: MemoryNodeContextEntry[]
): InternalMemoryNode[] {
  const nodes: InternalMemoryNode[] = [];
  let repeatIndex = 0;
  const staticFields: Array<{ field: Exclude<SchemaField, RepeatNode>; relation: string; prefix: string; contexts: MemoryNodeContextEntry[] }> = [];

  for (const field of fields) {
    if (typeof field === "object" && field.tag === "!repeat") {
      repeatIndex += 1;
      const repeatPrefix = joinReference(prefix, `repeat[${repeatIndex}]`);
      const repeatContext: MemoryNodeContextEntry = {
        type: "Repeat",
        relation: "repeat",
        value: stripRepeatBody(field)
      };
      for (const child of field.body) {
        staticFields.push({
          field: child,
          relation: "repeat",
          prefix: repeatPrefix,
          contexts: contexts.concat(repeatContext)
        });
      }
      continue;
    }
    staticFields.push({ field, relation: "field", prefix, contexts });
  }

  const siblingCounts = new Map<string, number>();
  for (const item of staticFields) {
    const baseSegment = schemaFieldSegment(item.field);
    const occurrence = (siblingCounts.get(`${item.prefix}\0${baseSegment}`) ?? 0) + 1;
    siblingCounts.set(`${item.prefix}\0${baseSegment}`, occurrence);
    const segment = occurrence === 1 ? baseSegment : `${baseSegment}#${occurrence}`;
    nodes.push(buildSchemaFieldNode(item.field, item.prefix, segment, item.contexts, item.relation));
  }
  return nodes;
}

function buildSchemaFieldNode(
  field: Exclude<SchemaField, RepeatNode>,
  prefix: string,
  segment: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  const nodeRef = joinReference(prefix, segment);
  if (typeof field === "string") {
    return createNode({
      nodeRef,
      type: "String",
      field,
      relation,
      value: field,
      contexts,
      children: []
    });
  }

  const children = buildSchemaChildren(
    field,
    nodeRef,
    contexts.concat({
      node_ref: nodeRef,
      type: "Schema",
      relation,
      value: stripSchemaChildren(field)
    })
  );
  return createNode({
    nodeRef,
    type: "Schema",
    name: field.names[0],
    summary: definitionSummary(field.defines, field.asserts),
    relation,
    value: field,
    contexts,
    children
  });
}

function buildFlowNodes(
  flow: FlowNode[],
  prefix: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode[] {
  return buildUniqueSiblings(flow, flowNodeSegment, (node, segment) =>
    buildFlowNode(node, joinReference(prefix, segment), contexts, relation)
  );
}

function buildFlowNode(
  node: FlowNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  switch (node.tag) {
    case "!action":
      return createActionNode(node, nodeRef, contexts, relation);
    case "!if":
      return createIfNode(node, nodeRef, contexts, relation);
    case "!while":
      return createWhileNode(node, nodeRef, contexts, relation);
    case "!call":
      return createCallNode(node, nodeRef, contexts, relation);
  }
}

function createActionNode(
  node: ActionNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  return createNode({
    nodeRef,
    type: "Action",
    artifact: node.artifact.name,
    summary: node.action,
    relation,
    value: node,
    contexts,
    children: []
  });
}

function createIfNode(
  node: IfNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  const thenContexts = contexts.concat(controlContext(nodeRef, "If", "then", node.condition));
  const elseifContexts = contexts.concat(controlContext(nodeRef, "If", "elseif", node.condition));
  const elseContexts = appendElseContexts(node, nodeRef, contexts);
  const children = buildFlowNodes(node.then, joinReference(nodeRef, "then"), thenContexts, "then")
    .concat(node.elseif
      ? buildFlowNodes([node.elseif], joinReference(nodeRef, "elseif"), elseifContexts, "elseif")
      : [])
    .concat(buildFlowNodes(node.else ?? [], joinReference(nodeRef, "else"), elseContexts, "else"));
  return createNode({
    nodeRef,
    type: "If",
    conditionArtifact: node.condition.artifact.name,
    summary: node.condition.action,
    relation,
    value: node,
    contexts,
    children
  });
}

function appendElseContexts(
  node: IfNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[]
): MemoryNodeContextEntry[] {
  const result = contexts.concat(controlContext(nodeRef, "If", "else", node.condition));
  let elseif = node.elseif;
  let parentRef = nodeRef;
  while (elseif) {
    const elseifRef = joinReference(joinReference(parentRef, "elseif"), flowNodeSegment(elseif));
    result.push(controlContext(elseifRef, "If", "else", elseif.condition));
    parentRef = elseifRef;
    elseif = elseif.elseif;
  }
  return result;
}

function createWhileNode(
  node: WhileNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  const children = buildFlowNodes(
    node.do,
    joinReference(nodeRef, "do"),
    contexts.concat(controlContext(nodeRef, "While", "do", node.condition)),
    "do"
  );
  return createNode({
    nodeRef,
    type: "While",
    conditionArtifact: node.condition.artifact.name,
    summary: node.condition.action,
    relation,
    value: node,
    contexts,
    children
  });
}

function createCallNode(
  node: CallNode,
  nodeRef: string,
  contexts: MemoryNodeContextEntry[],
  relation: string
): InternalMemoryNode {
  return createNode({
    nodeRef,
    type: "Call",
    target: node.target,
    summary: `Call ${node.target}`,
    relation,
    value: node,
    contexts,
    children: []
  });
}

function controlContext(
  nodeRef: string,
  type: "If" | "While",
  relation: string,
  condition: ActionNode
): MemoryNodeContextEntry {
  return {
    node_ref: nodeRef,
    type,
    relation,
    value: { condition }
  };
}

function flowNodeSegment(node: FlowNode): string {
  switch (node.tag) {
    case "!action":
      return `action:${escapeReferenceValue(node.artifact.name)}`;
    case "!if":
      return `if:${escapeReferenceValue(node.condition.artifact.name)}`;
    case "!while":
      return `while:${escapeReferenceValue(node.condition.artifact.name)}`;
    case "!call":
      return `call:${escapeReferenceValue(node.target)}`;
  }
}

function schemaFieldSegment(field: Exclude<SchemaField, RepeatNode>): string {
  return typeof field === "string"
    ? `string:${escapeReferenceValue(field)}`
    : `schema:${escapeReferenceValue(field.names[0])}`;
}

function createNode(input: {
  nodeRef: string;
  type: MemoryNodeType;
  name?: string;
  field?: string;
  artifact?: string;
  conditionArtifact?: string;
  target?: string;
  summary?: string;
  relation?: string;
  value: unknown;
  contexts: MemoryNodeContextEntry[];
  children: InternalMemoryNode[];
}): InternalMemoryNode {
  return {
    node_ref: input.nodeRef,
    type: input.type,
    name: input.name,
    field: input.field,
    artifact: input.artifact,
    condition_artifact: input.conditionArtifact,
    target: input.target,
    summary: input.summary,
    relation: input.relation,
    has_children: input.children.length > 0,
    value: input.value,
    contexts: input.contexts,
    children: input.children
  };
}

function buildUniqueSiblings<T>(
  values: T[],
  baseSegment: (value: T) => string,
  build: (value: T, uniqueSegment: string) => InternalMemoryNode
): InternalMemoryNode[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const base = baseSegment(value);
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    return build(value, occurrence === 1 ? base : `${base}#${occurrence}`);
  });
}

function rootContext(entity: MemoryEntity): unknown {
  switch (entity.tag) {
    case "!concept":
      return entity;
    case "!statement":
      return stripStatementSections(entity);
    case "!schema":
      return stripSchemaChildren(entity);
    case "!procedure":
      return stripProcedureFlow(entity);
  }
}

function stripStatementSections(statement: StatementNode): Omit<StatementNode, "sections"> {
  const { sections: _sections, ...context } = statement;
  return context;
}

function stripSchemaChildren(schema: SchemaNode): Omit<SchemaNode, "fields" | "item" | "items"> {
  const { fields: _fields, item: _item, items: _items, ...context } = schema;
  return context;
}

function stripProcedureFlow(procedure: ProcedureMemory): Omit<ProcedureMemory, "flow"> {
  const { flow: _flow, ...context } = procedure;
  return context;
}

function stripRepeatBody(repeat: RepeatNode): Omit<RepeatNode, "body"> {
  const { body: _body, ...context } = repeat;
  return context;
}

function definitionSummary(
  defines: DefinitionPart[],
  asserts?: string[],
  suggests?: string[]
): string | undefined {
  return defines.find((definition): definition is string => typeof definition === "string")
    ?? asserts?.[0]
    ?? suggests?.[0];
}

function indexNodes(nodes: InternalMemoryNode[]): Map<string, InternalMemoryNode> {
  const index = new Map<string, InternalMemoryNode>();
  const visit = (node: InternalMemoryNode): void => {
    index.set(node.node_ref, node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return index;
}

function toDescriptor(node: InternalMemoryNode): MemoryNodeDescriptor {
  return {
    node_ref: node.node_ref,
    type: node.type,
    ...(node.name === undefined ? {} : { name: node.name }),
    ...(node.field === undefined ? {} : { field: node.field }),
    ...(node.artifact === undefined ? {} : { artifact: node.artifact }),
    ...(node.condition_artifact === undefined ? {} : { condition_artifact: node.condition_artifact }),
    ...(node.target === undefined ? {} : { target: node.target }),
    ...(node.summary === undefined ? {} : { summary: node.summary }),
    ...(node.relation === undefined ? {} : { relation: node.relation }),
    has_children: node.has_children
  };
}

function escapeReferenceValue(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1").replaceAll("#", "~2");
}

function joinReference(prefix: string, segment: string): string {
  return prefix ? `${prefix}/${segment}` : segment;
}

function cloneIdentity(identity: MemoryIdentity): MemoryIdentity {
  return { ...identity, names: [...identity.names] };
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
