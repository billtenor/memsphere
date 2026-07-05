import { z } from "zod";
import type { MemoryKind } from "./kinds.js";

const stringArray = z.array(z.string()).default([]);
const nonEmptyStringArray = z.array(z.string().min(1)).min(1);
const schemaFormatSchema = z.enum(["section", "field", "table", "list", "template"]);
const artifactFormatSchema = z.enum(["string", "int", "boolean", "markdown", "json", "yaml", "schema"]);
const stepActorSchema = z.enum(["agent", "human"]);

export type FlowStep = Record<string, unknown>;
export type SchemaFormat = z.infer<typeof schemaFormatSchema>;

export type SchemaMemory = {
  tag: "!schema";
  names: string[];
  format?: SchemaFormat;
  defines: string[];
  asserts?: string[];
  fields?: SchemaMemory[];
};

const baseMemorySchema = z.object({
  names: nonEmptyStringArray,
  defines: stringArray
});

const stepArtifactSchema = z.object({
  name: z.string().min(1),
  format: artifactFormatSchema,
  schema: z.string().min(1).optional()
}).strict();

const procedureRunnableStepSchema = z.object({
  action: z.string().min(1),
  actor: stepActorSchema.optional(),
  artifact: stepArtifactSchema
}).strict();

const procedureFlowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.union([
    procedureRunnableStepSchema,
    z.object({
      tag: z.literal("!call"),
      target: z.string().min(1)
    }).strict(),
    z.object({
      tag: z.literal("!if"),
      condition: procedureRunnableStepSchema,
      then: z.array(procedureFlowStepSchema).min(1),
      elseif: z.array(z.object({
        condition: procedureRunnableStepSchema,
        then: z.array(procedureFlowStepSchema).min(1)
      }).strict()).optional(),
      else: z.array(procedureFlowStepSchema).optional()
    }).strict(),
    z.object({
      tag: z.literal("!while"),
      condition: procedureRunnableStepSchema,
      do: z.array(procedureFlowStepSchema).min(1)
    }).strict()
  ])
);

const schemaMemorySchema: z.ZodType<SchemaMemory, z.ZodTypeDef, unknown> = z.lazy(() =>
  baseMemorySchema
    .extend({
      tag: z.literal("!schema"),
      format: schemaFormatSchema.optional(),
      asserts: stringArray.optional(),
      fields: z.array(schemaMemorySchema).optional()
    })
    .strict()
);

export const procedureMemorySchema = baseMemorySchema
  .extend({
    tag: z.literal("!procedure"),
    goals: stringArray,
    flow: z.array(procedureFlowStepSchema).default([])
  })
  .strict();

export const conceptMemorySchema = baseMemorySchema
  .extend({
    tag: z.literal("!concept"),
    extends: stringArray.optional()
  })
  .strict();

export const statementMemorySchema = baseMemorySchema
  .extend({
    tag: z.literal("!statement"),
    asserts: stringArray
  })
  .strict();

export { schemaMemorySchema };

export const memorySchemas = {
  procedures: procedureMemorySchema,
  concepts: conceptMemorySchema,
  statements: statementMemorySchema,
  schemas: schemaMemorySchema
} as const satisfies Record<MemoryKind, z.ZodTypeAny>;

export type ProcedureMemory = z.infer<typeof procedureMemorySchema>;
export type ConceptMemory = z.infer<typeof conceptMemorySchema>;
export type StatementMemory = z.infer<typeof statementMemorySchema>;
export type MemoryEntity = ProcedureMemory | ConceptMemory | StatementMemory | SchemaMemory;
