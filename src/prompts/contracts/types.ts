import { validPublicCommand } from "./actions.js";
import { z } from "zod";
import { cliCommandSchema, nextAction } from "../cli-output.js";

export const text = z.string();
export const number = z.number().finite();
export const integer = number.int().nonnegative();
export const bool = z.boolean();
export const nil = z.null();
export const yes = z.literal(true);
export const content = z.unknown().refine(value => value !== undefined, "Content is required");
export const command = cliCommandSchema.refine(validPublicCommand, "Command unavailable in this invocation");
export const action = nextAction.unwrap().refine(value => {
  switch (value.kind) {
    case "command": return validPublicCommand(value);
    case "choose": return value.choices.every(validPublicCommand) && (!value.more || validPublicCommand(value.more));
    default: return !value.resume || validPublicCommand(value.resume);
  }
}, "Action unavailable in this invocation");
export const literal = (value: string) => z.literal(value);
export const oneOf = (...values: [string, ...string[]]) => z.enum(values);
export const either = (...schemas: [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]) => z.union(schemas);
export const map = (entry: z.ZodTypeAny) => z.record(entry);
export function list(item: z.ZodTypeAny, limit?: number) {
  const schema = z.array(item);
  return limit === undefined ? schema : schema.max(limit);
}

export function object(shape: z.ZodRawShape) {
  // A missing optional projection is not a wire field. Reject every populated
  // unknown key, including those on items in a list or inside a map.
  return z.preprocess(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
  }, z.object(shape).strict());
}

export function receipt(id: string, scenario: string, fields: z.ZodRawShape) {
  return { id, scenario, fields, schema: object(fields) };
}
export type ReceiptCase = ReturnType<typeof receipt>;

export function inherit(cases: ReceiptCase[], sourceId: string, id: string): ReceiptCase {
  const source = cases.find(entry => entry.id === sourceId);
  if (!source) throw new Error("Missing source CLI contract " + sourceId);
  return { ...source, id };
}
