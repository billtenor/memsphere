export const schemaFormats = ["outline", "table"] as const;
export type SchemaFormat = (typeof schemaFormats)[number];

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

export const artifactFormats = ["string", "number", "boolean", "markdown", "json", "yaml", "schema"] as const;
export type ArtifactFormat = (typeof artifactFormats)[number];

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
  asserts: string[];
  suggests: string[];
};

export type SchemaField = string | SchemaNode;

export type SchemaNode = CommonMemoryNode & {
  tag: "!schema";
  format?: SchemaFormat;
  asserts?: string[];
  element_types?: SchemaElementType[];
  fields?: SchemaField[];
};

export type ArtifactNode = {
  tag: "!artifact";
  name: string;
  format: ArtifactFormat;
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
