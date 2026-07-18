export const legacySchemaFormats = ["outline", "table"] as const;
export type LegacySchemaFormat = (typeof legacySchemaFormats)[number];

export const schemaElementTypes = [
  "string",
  "number",
  "boolean",
  "Concept",
  "Statement",
  "Schema",
  "Procedure",
  "Action",
  "Artifact",
  "If",
  "While",
  "Call"
] as const;
export type SchemaElementType = (typeof schemaElementTypes)[number];

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

export type DefinitionPart = string | StatementNode | SchemaNode;

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

export type StaticSchemaField = string | SchemaNode;

export type RepeatNode = {
  tag: "!repeat";
  limit?: RepeatLimitNode;
  body: StaticSchemaField[];
};

export type SchemaField = StaticSchemaField | RepeatNode;

export type SchemaNode = CommonMemoryNode & {
  tag: "!schema";
  asserts?: string[];
  element_types?: SchemaElementType[];
  fields?: SchemaField[];
};

export type ArtifactNode = {
  tag: "!artifact";
  name: string;
  type: ArtifactType;
  format: ArtifactFormatSpec;
  schema?: string | SchemaNode;
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

export type ConceptMemory = ConceptNode;
export type StatementMemory = StatementNode;
export type SchemaMemory = SchemaNode;
export type ProcedureMemory = ProcedureNode;
export type MemoryEntity = ConceptMemory | StatementMemory | SchemaMemory | ProcedureMemory;
