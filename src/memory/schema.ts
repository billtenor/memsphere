import { z } from "zod";
import type { MemoryKind } from "./kinds.js";

const stringArray = z.array(z.string()).default([]);
const nonEmptyStringArray = z.array(z.string().min(1)).min(1);
const schemaFormatSchema = z.enum(["section", "field", "table", "list", "template"]);

export type FlowStep = string | Record<string, unknown>;
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
    flow: z.array(z.union([z.string(), z.record(z.unknown())])).default([])
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
