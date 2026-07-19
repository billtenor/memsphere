import { z } from "zod";
import type { MemoryKind } from "./kinds.js";
import {
  builtInArtifactFormats,
  builtInArtifactTypes,
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
  type RepeatNode,
  type SchemaField,
  type SchemaMemory,
  type SchemaNode,
  type StaticSchemaField,
  type StatementMemory,
  type StatementNode,
  type WhileNode
} from "./ast.js";

const nonEmptyString = z.string().min(1);
const stringArray = z.array(nonEmptyString).default([]);
const namesSchema = z.array(nonEmptyString).default([]);

let definitionPartSchema: z.ZodType<DefinitionPart, z.ZodTypeDef, unknown>;
let staticSchemaFieldSchema: z.ZodType<StaticSchemaField, z.ZodTypeDef, unknown>;
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
    asserts: z.array(nonEmptyString).optional(),
    element_types: z.array(z.enum(schemaElementTypes)).min(1).optional(),
    fields: z.lazy(() => z.array(schemaFieldSchema)).optional()
  }).strict().superRefine((node, context) => {
    if (
      node.names.length === 0 &&
      node.defines.length === 0 &&
      (node.asserts?.length ?? 0) === 0 &&
      (node.element_types?.length ?? 0) === 0 &&
      (node.fields?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "anonymous Schema must define defines, asserts, element_types, or fields"
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
  })
);

definitionPartSchema = z.lazy(() => z.union([nonEmptyString, statementNodeSchema, schemaNodeSchema]));

staticSchemaFieldSchema = z.lazy(() => z.union([
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

const repeatLimitSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional()
}).strict().superRefine((limit, context) => {
  if (limit.min === undefined && limit.max === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repeat limit must define min or max"
    });
  }
  if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max"],
      message: "Repeat limit max must be greater than or equal to min"
    });
  }
});

function schemaContainsRepeat(node: SchemaNode): boolean {
  return (node.fields ?? []).some((field) =>
    typeof field === "object" && (
      field.tag === "!repeat" || schemaContainsRepeat(field)
    )
  );
}

const repeatBodyFieldSchema = z.lazy(() => staticSchemaFieldSchema.superRefine((field, context) => {
  if (typeof field === "object" && schemaContainsRepeat(field)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repeat body must not contain a nested Repeat"
    });
  }
}));

const repeatNodeSchema: z.ZodType<RepeatNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!repeat"),
  limit: repeatLimitSchema.optional(),
  body: z.array(repeatBodyFieldSchema).min(1)
}).strict();

schemaFieldSchema = z.lazy(() => z.union([staticSchemaFieldSchema, repeatNodeSchema]));

const artifactFormatInputSchema = z.union([
  nonEmptyString.transform((name) => ({ name, options: {} })),
  z.object({ name: nonEmptyString }).catchall(z.unknown()).transform((value) => {
    const { name, ...options } = value;
    return { name, options };
  })
]).optional().transform((value) => value ?? { name: "plain", options: {} });

export const artifactNodeSchema: z.ZodType<ArtifactNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!artifact"),
  name: nonEmptyString,
  type: nonEmptyString.default("string"),
  format: artifactFormatInputSchema,
  schema: z.lazy(() => z.union([nonEmptyString, schemaNodeSchema])).optional(),
  final: z.boolean().optional()
}).strict().superRefine((artifact, context) => {
  const formatName = artifact.format.name;
  const layout = (artifact.format.options as Record<string, unknown>).layout;
  const knownType = builtInArtifactTypes.includes(artifact.type as (typeof builtInArtifactTypes)[number]);
  const knownFormat = builtInArtifactFormats.includes(formatName as (typeof builtInArtifactFormats)[number]);

  if (!knownType || !knownFormat) return;

  if (formatName !== "markdown" && layout !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "layout is only allowed for markdown Artifact format"
    });
  }

  if (formatName === "markdown" && layout !== undefined && layout !== "outline" && layout !== "table") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "markdown layout must be outline or table"
    });
  }

  const validCombination =
    (["boolean", "number", "string"].includes(artifact.type) && formatName === "plain") ||
    (artifact.type === "string" && formatName === "markdown") ||
    (["object", "array"].includes(artifact.type) && ["json", "yaml", "markdown"].includes(formatName));
  if (!validCombination) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format"],
      message: `Artifact type ${artifact.type} does not support format ${formatName}`
    });
  }

  if (artifact.type === "string" && formatName === "markdown" && layout !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "string markdown Artifact must not declare layout"
    });
  }

  if (formatName === "markdown" && artifact.type === "object" && layout !== "outline") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "object markdown Artifact requires layout: outline"
    });
  }

  if (formatName === "markdown" && artifact.type === "array" && layout !== "table") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "array markdown Artifact requires layout: table"
    });
  }

  if (formatName === "markdown" && ["object", "array"].includes(artifact.type) && !artifact.schema) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schema"],
      message: "structured markdown Artifact requires schema"
    });
  }

  if (["boolean", "number", "string"].includes(artifact.type) && artifact.schema) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schema"],
      message: `Artifact type ${artifact.type} does not support schema`
    });
  }

  if (
    typeof artifact.schema === "object" &&
    schemaContainsRepeat(artifact.schema) &&
    !(artifact.type === "object" && formatName === "markdown" && layout === "outline")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schema", "fields"],
      message: "Schema Repeat is only supported by object markdown Artifacts with layout: outline"
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
  if (node.artifact.type === "boolean") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifact", "type"],
      message: "boolean Artifact type is only allowed for If or While conditions"
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
    if (node.condition.artifact.type !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition", "artifact", "type"],
        message: "While condition Artifact type must be boolean"
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
    if (node.condition.artifact.type !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition", "artifact", "type"],
        message: "If condition Artifact type must be boolean"
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

export {
  definitionPartSchema,
  flowNodeSchema,
  ifNodeSchema,
  repeatNodeSchema,
  schemaFieldSchema,
  schemaNodeSchema,
  statementNodeSchema,
  staticSchemaFieldSchema
};

export const memorySchemas = {
  procedures: procedureMemorySchema,
  concepts: conceptMemorySchema,
  statements: statementMemorySchema,
  schemas: schemaMemorySchema
} as const satisfies Record<MemoryKind, z.ZodTypeAny>;

export type { MemoryEntity };
