import type { MemorySyntaxVersion } from "./syntax.js";

export const builtInArtifactTypes = ["boolean", "number", "string", "object", "array"] as const;
export type BuiltInArtifactType = (typeof builtInArtifactTypes)[number];
export type ArtifactType = string;

export const builtInArtifactFormats = ["plain", "markdown", "json", "yaml"] as const;
export type BuiltInArtifactFormat = (typeof builtInArtifactFormats)[number];

export type ArtifactFormatSpec = {
  name: string;
  options: Readonly<Record<string, unknown>>;
};

export const stepActors = ["agent", "human"] as const;
export type StepActor = (typeof stepActors)[number];

export type MemoryRefNode = {
  tag: "!ref";
  target: string;
};

export type DefinitionPart = string;
export type RulePart = string | MemoryRefNode;

export type CommonMemoryNode = {
  names: string[];
  defines: string[];
};

export type ConceptNode = CommonMemoryNode & {
  tag: "!concept";
  extends?: string[];
};

export type StatementNode = CommonMemoryNode & {
  tag: "!statement";
  asserts?: RulePart[];
  suggests?: RulePart[];
  sections?: StatementNode[];
};

export type RepeatLimitNode = {
  min?: number;
  max?: number;
};

export type StaticSchemaField = string | SchemaNode | MemoryRefNode;

export type RepeatNode = {
  tag: "!repeat";
  limit?: RepeatLimitNode;
  body: StaticSchemaField[];
};

export type SchemaField = StaticSchemaField | RepeatNode;

export type SchemaNode = CommonMemoryNode & {
  tag: "!schema";
  asserts?: RulePart[];
  suggests?: RulePart[];
  optional?: boolean;
  type?: ArtifactType;
  format?: ArtifactFormatSpec;
  fields?: SchemaField[];
  item?: SchemaNode | MemoryRefNode;
  items?: Array<SchemaNode | MemoryRefNode>;
};

export type ArtifactNode = {
  tag: "!artifact";
  store?: string;
  model?: string;
  name: string;
  type: ArtifactType;
  format: ArtifactFormatSpec;
  schema?: string | SchemaNode | MemoryRefNode;
  final?: boolean;
  review?: string[];
};

export type ActionNode = {
  tag: "!action";
  action: string;
  actor?: StepActor;
  asserts?: RulePart[];
  suggests?: RulePart[];
  artifact: ArtifactNode;
};

export type CallNode = {
  tag: "!call";
  target: string;
};

export type IfNode = {
  tag: "!if";
  condition: ActionNode;
  then: FlowNode[];
  elseif?: IfNode;
  else?: FlowNode[];
};

export type WhileNode = {
  tag: "!while";
  condition: ActionNode;
  do: FlowNode[];
};

export type FlowNode = ActionNode | IfNode | WhileNode | CallNode;

export type ProcedureBase = CommonMemoryNode & {
  tag: "!procedure";
  asserts?: RulePart[];
  goals: string[];
};

export type FlowProcedureNode = ProcedureBase & {
  mode?: "flow";
  flow: FlowNode[];
  actions?: never;
};

export type GraphDependency = { tag: "!dependency"; from: string | string[]; when?: string };
export type GraphArtifactSpec = {
  name: string;
  asserts?: RulePart[];
  suggests?: RulePart[];
  model: { definedBy: string; definition: string };
  payload: { contentType: string };
  review?: string[];
};
export type GraphAction = {
  tag: "!action";
  id: string;
  description: string;
  dependencies: GraphDependency[];
  asserts?: RulePart[];
  suggests?: RulePart[];
} & (
  | { actor?: StepActor; artifact: GraphArtifactSpec; collect?: never }
  | { collect: string[]; actor?: never; artifact?: never }
);
export type GraphProcedureNode = ProcedureBase & { mode: "graph"; actions: GraphAction[]; flow?: never };
export type ProcedureNode = FlowProcedureNode | GraphProcedureNode;
export type GraphProcedureMemory = GraphProcedureNode & VersionedMemory;

export type VersionedMemory = {
  syntax: MemorySyntaxVersion;
};

export type ConceptMemory = ConceptNode & VersionedMemory;
export type StatementMemory = StatementNode & VersionedMemory;
export type SchemaMemory = SchemaNode & VersionedMemory;
export type ProcedureMemory = ProcedureNode & VersionedMemory;
export type MemoryEntity = ConceptMemory | StatementMemory | SchemaMemory | ProcedureMemory;

export function schemaNodeFromMemory(memory: SchemaMemory): SchemaNode {
  const { syntax: _syntax, ...node } = memory;
  return node;
}
