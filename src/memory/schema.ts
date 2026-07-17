import { z } from "zod";
import type { MemoryKind } from "./kinds.js";
import {
  artifactFormats,
  schemaFormats,
  schemaElementTypes,
  stepActors,
  type ActionNode,
  type ArtifactNode,
  type CallNode,
  type ConceptMemory,
  type DefinitionPart,
  type FlowNode,
  type IfNode,
  type MemoryEntity,
  type ProcedureMemory,
  type SchemaField,
  type SchemaMemory,
  type SchemaNode,
  type StatementMemory,
  type StatementNode,
  type WhileNode
} from "./ast.js";

const nonEmptyString = z.string().min(1);
const stringArray = z.array(nonEmptyString).default([]);
const namesSchema = z.array(nonEmptyString).default([]);

let definitionPartSchema: z.ZodType<DefinitionPart, z.ZodTypeDef, unknown>;
let schemaFieldSchema: z.ZodType<SchemaField, z.ZodTypeDef, unknown>;
let flowNodeSchema: z.ZodType<FlowNode, z.ZodTypeDef, unknown>;
let ifNodeSchema: z.ZodType<IfNode, z.ZodTypeDef, unknown>;

const definesSchema = z.lazy(() => z.array(definitionPartSchema)).default([]);

const statementNodeSchema: z.ZodType<StatementNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    tag: z.literal("!statement"),
    names: namesSchema,
    defines: definesSchema,
    asserts: z.array(nonEmptyString).min(1).optional(),
    suggests: z.array(nonEmptyString).min(1).optional(),
    sections: z.array(statementNodeSchema).min(1).optional()
  }).strict().superRefine((node, context) => {
    if (!node.asserts?.length && !node.suggests?.length && !node.sections?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Statement must define asserts, suggests, or sections"
      });
    }

    const sectionNames = new Map<string, number>();
    for (const [index, section] of (node.sections ?? []).entries()) {
      const canonicalName = section.names[0]?.trim();
      if (!canonicalName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", index, "names"],
          message: "Statement section must have a non-empty names list"
        });
        continue;
      }

      const previousIndex = sectionNames.get(canonicalName);
      if (previousIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", index, "names", 0],
          message: `Statement section canonical name must be unique among siblings; first used at sections[${previousIndex}]`
        });
        continue;
      }
      sectionNames.set(canonicalName, index);
    }
  })
);

const schemaNodeSchema: z.ZodType<SchemaNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    tag: z.literal("!schema"),
    names: namesSchema,
    defines: definesSchema,
    format: z.enum(schemaFormats).optional(),
    asserts: z.array(nonEmptyString).optional(),
    element_types: z.array(z.enum(schemaElementTypes)).min(1).optional(),
    fields: z.lazy(() => z.array(schemaFieldSchema)).optional()
  }).strict().superRefine((node, context) => {
    if (
      node.names.length === 0 &&
      node.defines.length === 0 &&
      !node.format &&
      (node.asserts?.length ?? 0) === 0 &&
      (node.element_types?.length ?? 0) === 0 &&
      (node.fields?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "anonymous Schema must define format, defines, asserts, element_types, or fields"
      });
    }
    if (node.element_types && new Set(node.element_types).size !== node.element_types.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["element_types"],
        message: "Schema element_types must not contain duplicate types"
      });
    }
    if (node.element_types && node.fields?.length && !node.element_types.includes("Schema")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Schema with both element_types and fields must include Schema in element_types"
      });
    }
    if (node.format === "table") {
      if (node.element_types?.length !== 1 || node.element_types[0] !== "Schema") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["element_types"],
          message: "table Schema must declare element_types: [Schema]"
        });
      }
      if (!node.fields?.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields"],
          message: "table Schema must define at least one field"
        });
      }
    }
  })
);

definitionPartSchema = z.lazy(() => z.union([nonEmptyString, statementNodeSchema, schemaNodeSchema]));

schemaFieldSchema = z.lazy(() => z.union([
  nonEmptyString,
  schemaNodeSchema.superRefine((field, context) => {
    if (field.names.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["names"],
        message: "Schema used in fields must have a non-empty names list"
      });
    }
  })
]));

export const artifactNodeSchema: z.ZodType<ArtifactNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!artifact"),
  name: nonEmptyString,
  format: z.enum(artifactFormats),
  schema: z.lazy(() => z.union([nonEmptyString, schemaNodeSchema])).optional(),
  final: z.boolean().optional()
}).strict().superRefine((artifact, context) => {
  if (artifact.format === "schema" && !artifact.schema) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schema"],
      message: "schema is required when Artifact format is schema"
    });
  }
  if (artifact.format !== "schema" && artifact.schema) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schema"],
      message: "schema is only allowed when Artifact format is schema"
    });
  }
});

export const actionNodeSchema: z.ZodType<ActionNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!action"),
  action: nonEmptyString,
  actor: z.enum(stepActors).optional(),
  asserts: z.array(nonEmptyString).min(1).optional(),
  suggests: z.array(nonEmptyString).min(1).optional(),
  artifact: artifactNodeSchema
}).strict();

const plainActionNodeSchema: z.ZodType<ActionNode, z.ZodTypeDef, unknown> = actionNodeSchema.superRefine((node, context) => {
  if (node.artifact.format === "boolean") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifact", "format"],
      message: "boolean Artifact format is only allowed for If or While conditions"
    });
  }
});

const callNodeSchema: z.ZodType<CallNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!call"),
  target: nonEmptyString
}).strict();

const whileNodeSchema: z.ZodType<WhileNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    tag: z.literal("!while"),
    condition: actionNodeSchema,
    do: z.array(flowNodeSchema).min(1)
  }).strict().superRefine((node, context) => {
    if (node.condition.artifact.format !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition", "artifact", "format"],
        message: "While condition Artifact format must be boolean"
      });
    }
  })
);

ifNodeSchema = z.lazy(() =>
  z.object({
    tag: z.literal("!if"),
    condition: actionNodeSchema,
    then: z.array(flowNodeSchema).min(1),
    elseif: ifNodeSchema.optional(),
    else: z.array(flowNodeSchema).optional()
  }).strict().superRefine((node, context) => {
    if (node.condition.artifact.format !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition", "artifact", "format"],
        message: "If condition Artifact format must be boolean"
      });
    }
    if (node.elseif?.else !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["elseif", "else"],
        message: "else is only allowed on the root If in an elseif chain"
      });
    }
  })
);

flowNodeSchema = z.lazy(() => z.union([
  plainActionNodeSchema,
  ifNodeSchema,
  whileNodeSchema,
  callNodeSchema
]));

function requireTopLevelName<T extends { names: string[] }>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): z.ZodType<T, z.ZodTypeDef, unknown> {
  return schema.superRefine((node, context) => {
    if (node.names.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["names"],
        message: "top-level memory must have a non-empty names list"
      });
    }
  });
}

export const conceptMemorySchema: z.ZodType<ConceptMemory, z.ZodTypeDef, unknown> = requireTopLevelName(
  z.object({
    tag: z.literal("!concept"),
    names: namesSchema,
    defines: definesSchema,
    extends: stringArray.optional()
  }).strict()
);

export const statementMemorySchema: z.ZodType<StatementMemory, z.ZodTypeDef, unknown> = requireTopLevelName(statementNodeSchema);
export const schemaMemorySchema: z.ZodType<SchemaMemory, z.ZodTypeDef, unknown> = requireTopLevelName(schemaNodeSchema);

export const procedureMemorySchema: z.ZodType<ProcedureMemory, z.ZodTypeDef, unknown> = requireTopLevelName(
  z.object({
    tag: z.literal("!procedure"),
    names: namesSchema,
    defines: definesSchema,
    asserts: z.array(nonEmptyString).min(1).optional(),
    goals: stringArray,
    flow: z.array(flowNodeSchema).default([])
  }).strict()
);

export { definitionPartSchema, flowNodeSchema, ifNodeSchema, schemaFieldSchema, schemaNodeSchema, statementNodeSchema };

export const memorySchemas = {
  procedures: procedureMemorySchema,
  concepts: conceptMemorySchema,
  statements: statementMemorySchema,
  schemas: schemaMemorySchema
} as const satisfies Record<MemoryKind, z.ZodTypeAny>;

export type { MemoryEntity };
