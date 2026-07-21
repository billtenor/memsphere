import { z } from "zod";
import { requireDecisionPolicyDefinition } from "../control-plane/catalog.js";
import type { MemoryKind } from "./kinds.js";
import {
  builtInArtifactFormats,
  builtInArtifactTypes,
  stepActors,
  type ActionNode,
  type ArtifactFormatSpec,
  type ArtifactNode,
  type CallNode,
  type ConceptNode,
  type ConceptMemory,
  type DefinitionPart,
  type FlowNode,
  type IfNode,
  type MemoryEntity,
  type ProcedureMemory,
  type ProcedureNode,
  type RepeatNode,
  type SchemaField,
  type SchemaMemory,
  type SchemaNode,
  type StaticSchemaField,
  type StatementMemory,
  type StatementNode,
  type WhileNode
} from "./ast.js";
import {
  assertMemorySyntaxIdentifier,
  controlPlaneMemorySyntax,
  firstStableMemorySyntax,
  MemorySyntaxRegistry,
  type MemorySyntaxVersion
} from "./syntax.js";

const nonEmptyString = z.string().min(1);
const stringArray = z.array(nonEmptyString).default([]);
const namesSchema = z.array(nonEmptyString).superRefine((names, context) => {
  const seen = new Map<string, number>();
  for (const [index, name] of names.entries()) {
    const previous = seen.get(name);
    if (previous !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Memory names must be unique; first used at names[${previous}]`
      });
      continue;
    }
    seen.set(name, index);
  }
}).default([]);

function normalizeNameShorthand(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!("name" in source) || "names" in source) return value;
  const normalized: Record<string, unknown> = { ...source, names: [source.name] };
  delete normalized.name;
  return normalized;
}

const memorySyntaxValueSchema = z.string().superRefine((value, context) => {
  try {
    assertMemorySyntaxIdentifier(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function withRootSyntax<T extends { tag: string }>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): z.ZodType<T & { syntax: MemorySyntaxVersion }, z.ZodTypeDef, unknown> {
  return z.unknown().transform((value, context) => {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : value;
    const syntaxInput = source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>).syntax
      : undefined;
    const nodeInput = source && typeof source === "object" && !Array.isArray(source)
      ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== "syntax"))
      : source;
    const syntax = memorySyntaxValueSchema.safeParse(syntaxInput);
    const node = schema.safeParse(nodeInput);

    if (!syntax.success) {
      for (const issue of syntax.error.issues) context.addIssue({ ...issue, path: ["syntax", ...issue.path] });
    }
    if (!node.success) {
      for (const issue of node.error.issues) context.addIssue(issue);
    }
    if (!syntax.success || !node.success) return z.NEVER;

    const { tag, ...fields } = node.data;
    return { tag, syntax: syntax.data, ...fields } as T & { syntax: MemorySyntaxVersion };
  });
}

let definitionPartSchema: z.ZodType<DefinitionPart, z.ZodTypeDef, unknown>;
let staticSchemaFieldSchema: z.ZodType<StaticSchemaField, z.ZodTypeDef, unknown>;
let schemaFieldSchema: z.ZodType<SchemaField, z.ZodTypeDef, unknown>;
let legacyFlowNodeSchema: z.ZodType<FlowNode, z.ZodTypeDef, unknown>;
let legacyIfNodeSchema: z.ZodType<IfNode, z.ZodTypeDef, unknown>;

const definesSchema = z.lazy(() => z.array(definitionPartSchema)).default([]);

const formatInputSchema = z.union([
  nonEmptyString.transform((name) => ({ name, options: {} })),
  z.object({ name: nonEmptyString }).catchall(z.unknown()).transform((value) => {
    const { name, ...options } = value;
    return { name, options };
  })
]);

const artifactFormatInputSchema = formatInputSchema.optional().transform((value) => value ?? { name: "plain", options: {} });
const schemaFormatInputSchema = formatInputSchema.optional();

const statementNodeSchema: z.ZodType<StatementNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.preprocess(normalizeNameShorthand, z.object({
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
  }))
);

const schemaNodeSchema: z.ZodType<SchemaNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.preprocess(normalizeNameShorthand, z.object({
    tag: z.literal("!schema"),
    names: namesSchema,
    defines: definesSchema,
    asserts: z.array(nonEmptyString).optional(),
    type: nonEmptyString.optional(),
    format: schemaFormatInputSchema,
    fields: z.lazy(() => z.array(schemaFieldSchema)).optional(),
    item: schemaNodeSchema.optional(),
    items: z.array(schemaNodeSchema).min(2).optional()
  }).strict().superRefine((node, context) => {
    if (
      node.names.length === 0 &&
      node.defines.length === 0 &&
      (node.asserts?.length ?? 0) === 0 &&
      node.type === undefined &&
      node.format === undefined &&
      (node.fields?.length ?? 0) === 0 &&
      node.item === undefined &&
      (node.items?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "anonymous Schema must define defines, asserts, type, format, fields, item, or items"
      });
    }
    validateSchemaLocalContract(node, context);
  }))
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
  ) || (node.item !== undefined && schemaContainsRepeat(node.item)) ||
    (node.items ?? []).some((item) => schemaContainsRepeat(item));
}

export function inferSchemaType(node: SchemaNode): string {
  return node.type ?? (node.fields !== undefined ? "object" : "string");
}

export function inheritSchemaFormat(parent: ArtifactFormatSpec, type: string): ArtifactFormatSpec {
  const options = { ...parent.options };
  if (parent.name === "markdown") {
    const layout = options.layout;
    const compatibleLayout =
      (layout === "outline" && type === "object") ||
      (layout === "table" && type === "array");
    if (!compatibleLayout) delete options.layout;
  }
  return {
    name: parent.name,
    options
  };
}

export function resolveSchemaContract(
  node: SchemaNode,
  parentFormat: ArtifactFormatSpec
): { type: string; format: ArtifactFormatSpec } {
  const type = inferSchemaType(node);
  return {
    type,
    format: node.format ?? inheritSchemaFormat(parentFormat, type)
  };
}

function validateSchemaLocalContract(node: SchemaNode, context: z.RefinementCtx): void {
  const type = inferSchemaType(node);
  const formatName = node.format?.name;
  const layout = node.format?.options.layout;
  const knownType = builtInArtifactTypes.includes(type as (typeof builtInArtifactTypes)[number]);
  const knownFormat = formatName !== undefined && builtInArtifactFormats.includes(formatName as (typeof builtInArtifactFormats)[number]);

  if (formatName !== undefined && knownFormat && formatName !== "markdown" && layout !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "layout is only allowed for markdown Schema format"
    });
  }
  if (knownFormat && formatName === "markdown" && layout !== undefined && layout !== "outline" && layout !== "table") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["format", "layout"],
      message: "markdown layout must be outline or table"
    });
  }

  if (knownType && knownFormat && formatName !== undefined) {
    const validCombination =
      (["boolean", "number", "string"].includes(type) && formatName === "plain") ||
      (["boolean", "number", "string"].includes(type) && formatName === "markdown" && layout === undefined) ||
      (["boolean", "number", "string", "object", "array"].includes(type) && ["json", "yaml"].includes(formatName)) ||
      (type === "object" && formatName === "markdown" && layout === "outline") ||
      (type === "array" && formatName === "markdown" && layout === "table");
    if (!validCombination) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: formatName === "markdown" ? ["format", "layout"] : ["format"],
        message: formatName === "markdown" && type === "object"
          ? "object markdown Schema requires layout: outline"
          : formatName === "markdown" && type === "array"
            ? "array markdown Schema requires layout: table"
            : `Schema type ${type} does not support format ${formatName}`
      });
    }
  }

  if (["boolean", "number", "string", "array"].includes(type) && node.fields !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fields"],
      message: `Schema type ${type} does not support fields`
    });
  }

  if (node.item !== undefined && node.items !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items"],
      message: "Schema item and items are mutually exclusive"
    });
  }

  if ((node.item !== undefined || node.items !== undefined) && node.type !== "array") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [node.item !== undefined ? "item" : "items"],
      message: "Schema item and items require an explicit type: array"
    });
  }

  if (node.item && schemaContainsRepeat(node.item)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["item"],
      message: "Schema Repeat is not allowed under array item"
    });
  }
  for (const [index, item] of (node.items ?? []).entries()) {
    if (!schemaContainsRepeat(item)) continue;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items", index],
      message: "Schema Repeat is not allowed under array items"
    });
  }

  if (
    schemaContainsRepeat(node) &&
    (type !== "object" || (node.format !== undefined && !(formatName === "markdown" && layout === "outline")))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fields"],
      message: "Schema Repeat requires object + markdown + layout: outline"
    });
  }
}

function sameFormat(left: ArtifactFormatSpec, right: ArtifactFormatSpec): boolean {
  return left.name === right.name && JSON.stringify(left.options) === JSON.stringify(right.options);
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

const legacyArtifactNodeSchema: z.ZodType<ArtifactNode, z.ZodTypeDef, unknown> = z.object({
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

  if (typeof artifact.schema === "object") {
    const rootContract = resolveSchemaContract(artifact.schema, artifact.format);
    if (rootContract.type !== artifact.type || !sameFormat(rootContract.format, artifact.format)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schema"],
        message: "root Schema inferred type and effective format must match its Artifact contract"
      });
    }
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

const legacyActionNodeSchema: z.ZodType<ActionNode, z.ZodTypeDef, unknown> = z.object({
  tag: z.literal("!action"),
  action: nonEmptyString,
  actor: z.enum(stepActors).optional(),
  asserts: z.array(nonEmptyString).min(1).optional(),
  suggests: z.array(nonEmptyString).min(1).optional(),
  artifact: legacyArtifactNodeSchema
}).strict();

const legacyPlainActionNodeSchema: z.ZodType<ActionNode, z.ZodTypeDef, unknown> = legacyActionNodeSchema.superRefine((node, context) => {
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

const legacyWhileNodeSchema: z.ZodType<WhileNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    tag: z.literal("!while"),
    condition: legacyActionNodeSchema,
    do: z.array(legacyFlowNodeSchema).min(1)
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

legacyIfNodeSchema = z.lazy(() =>
  z.object({
    tag: z.literal("!if"),
    condition: legacyActionNodeSchema,
    then: z.array(legacyFlowNodeSchema).min(1),
    elseif: legacyIfNodeSchema.optional(),
    else: z.array(legacyFlowNodeSchema).optional()
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

legacyFlowNodeSchema = z.lazy(() => z.union([
  legacyPlainActionNodeSchema,
  legacyIfNodeSchema,
  legacyWhileNodeSchema,
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

const conceptNodeSchema: z.ZodType<ConceptNode, z.ZodTypeDef, unknown> = requireTopLevelName(
  z.preprocess(normalizeNameShorthand, z.object({
    tag: z.literal("!concept"),
    names: namesSchema,
    defines: definesSchema,
    extends: stringArray.optional()
  }).strict())
);

export const conceptMemorySchema: z.ZodType<ConceptMemory, z.ZodTypeDef, unknown> = withRootSyntax(conceptNodeSchema);
export const statementMemorySchema: z.ZodType<StatementMemory, z.ZodTypeDef, unknown> = withRootSyntax(requireTopLevelName(statementNodeSchema));
export const schemaMemorySchema: z.ZodType<SchemaMemory, z.ZodTypeDef, unknown> = withRootSyntax(requireTopLevelName(schemaNodeSchema));

const legacyProcedureNodeSchema: z.ZodType<ProcedureNode, z.ZodTypeDef, unknown> = requireTopLevelName(
  z.preprocess(normalizeNameShorthand, z.object({
    tag: z.literal("!procedure"),
    names: namesSchema,
    defines: definesSchema,
    asserts: z.array(nonEmptyString).min(1).optional(),
    goals: stringArray,
    flow: z.array(legacyFlowNodeSchema).default([])
  }).strict())
);

const legacyProcedureMemorySchema: z.ZodType<ProcedureMemory, z.ZodTypeDef, unknown> = withRootSyntax(legacyProcedureNodeSchema);

const uniqueNonEmptyStringArray = z.array(nonEmptyString).min(1).superRefine((values, context) => {
  const seen = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const previous = seen.get(value);
    if (previous !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `value must be unique; first used at index ${previous}`
      });
    } else {
      seen.set(value, index);
    }
  }
});

const roleBindingsInputSchema = z.record(z.union([
  nonEmptyString.transform((value) => [value]),
  uniqueNonEmptyStringArray
])).superRefine((bindings, context) => {
  for (const roleId of Object.keys(bindings)) {
    if (!roleId.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [roleId], message: "Role id must not be empty" });
    }
  }
});

const permissionGrantsInputSchema = z.record(uniqueNonEmptyStringArray).superRefine((grants, context) => {
  for (const roleId of Object.keys(grants)) {
    if (!roleId.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [roleId], message: "Role id must not be empty" });
    }
  }
});

const decisionPolicyIdSchema = nonEmptyString.superRefine((value, context) => {
  try {
    requireDecisionPolicyDefinition(value);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown Decision Policy id: ${value}`
    });
  }
});

export const artifactNodeSchema: z.ZodType<ArtifactNode, z.ZodTypeDef, unknown> = z.unknown().transform((value, context) => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const baseInput = source ? { ...source } : value;
  if (source) {
    delete (baseInput as Record<string, unknown>).role_bindings;
    delete (baseInput as Record<string, unknown>).permission_grants;
    delete (baseInput as Record<string, unknown>).review;
  }
  const base = legacyArtifactNodeSchema.safeParse(baseInput);
  const roleBindings = roleBindingsInputSchema.optional().safeParse(source?.role_bindings);
  const permissionGrants = permissionGrantsInputSchema.optional().safeParse(source?.permission_grants);
  const review = decisionPolicyIdSchema.optional().safeParse(source?.review);
  if (!base.success) {
    for (const issue of base.error.issues) context.addIssue(issue);
  }
  if (!roleBindings.success) {
    for (const issue of roleBindings.error.issues) context.addIssue({ ...issue, path: ["role_bindings", ...issue.path] });
  }
  if (!permissionGrants.success) {
    for (const issue of permissionGrants.error.issues) context.addIssue({ ...issue, path: ["permission_grants", ...issue.path] });
  }
  if (!review.success) {
    for (const issue of review.error.issues) context.addIssue({ ...issue, path: ["review", ...issue.path] });
  }
  if (!base.success || !roleBindings.success || !permissionGrants.success || !review.success) return z.NEVER;
  return {
    ...base.data,
    ...(review.data ? { review: review.data } : {}),
    ...(roleBindings.data ? { roleBindings: roleBindings.data } : {}),
    ...(permissionGrants.data ? { permissionGrants: permissionGrants.data } : {})
  };
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

let ifNodeSchema: z.ZodType<IfNode, z.ZodTypeDef, unknown>;
let flowNodeSchema: z.ZodType<FlowNode, z.ZodTypeDef, unknown>;

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

const procedureNodeSchema: z.ZodType<ProcedureNode, z.ZodTypeDef, unknown> = requireTopLevelName(
  z.preprocess(normalizeNameShorthand, z.object({
    tag: z.literal("!procedure"),
    names: namesSchema,
    defines: definesSchema,
    asserts: z.array(nonEmptyString).min(1).optional(),
    goals: stringArray,
    role_bindings: roleBindingsInputSchema.optional(),
    flow: z.array(flowNodeSchema).default([])
  }).strict().transform((procedure) => {
    const { role_bindings, ...base } = procedure;
    return { ...base, ...(role_bindings ? { roleBindings: role_bindings } : {}) };
  }))
);

export const procedureMemorySchema: z.ZodType<ProcedureMemory, z.ZodTypeDef, unknown> = withRootSyntax(procedureNodeSchema);

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

const legacyMemorySchemas = {
  procedures: legacyProcedureMemorySchema,
  concepts: conceptMemorySchema,
  statements: statementMemorySchema,
  schemas: schemaMemorySchema
} as const satisfies Record<MemoryKind, z.ZodTypeAny>;

export const memorySyntaxRegistry = new MemorySyntaxRegistry();
memorySyntaxRegistry.register({ version: firstStableMemorySyntax, schemas: legacyMemorySchemas });
memorySyntaxRegistry.register({ version: controlPlaneMemorySyntax, schemas: memorySchemas });

export type { MemoryEntity };
