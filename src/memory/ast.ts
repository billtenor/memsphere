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

export type DefinitionPart = string | StatementNode | SchemaNode | MemoryRefNode;

export type CommonMemoryNode = {
  names: string[];
  defines: DefinitionPart[];
};

export type ConceptNode = CommonMemoryNode & {
  tag: "!concept";
  extends?: string[];
};

export type StatementNode = CommonMemoryNode & {
  tag: "!statement";
  asserts?: string[];
  suggests?: string[];
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
  asserts?: string[];
  optional?: boolean;
  type?: ArtifactType;
  format?: ArtifactFormatSpec;
  fields?: SchemaField[];
  item?: SchemaNode | MemoryRefNode;
  items?: Array<SchemaNode | MemoryRefNode>;
};

export type ArtifactNode = {
  tag: "!artifact";
  name: string;
  type: ArtifactType;
  format: ArtifactFormatSpec;
  schema?: string | SchemaNode | MemoryRefNode;
  final?: boolean;
};

export type ActionNode = {
  tag: "!action";
  action: string;
  actor?: StepActor;
  asserts?: string[];
  suggests?: string[];
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

export type ProcedureNode = CommonMemoryNode & {
  tag: "!procedure";
  asserts?: string[];
  goals: string[];
  flow: FlowNode[];
};

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
