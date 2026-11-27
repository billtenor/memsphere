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

export type ReceiptBinding = { runId: string; stepId?: string; reviewId?: string };
type Projection = {
  items?: Record<string, { schema: z.ZodTypeAny; select: (row: Record<string, unknown>) => Record<string, unknown> }>;
  nested?: Record<string, { schema: z.ZodTypeAny; select: (value: Record<string, unknown>, facts: Record<string, unknown>) => Record<string, unknown> }>;
  remove?: readonly string[];
  omitEmpty?: readonly string[];
  omitZero?: readonly string[];
  omitFalse?: readonly string[];
  omitTrue?: readonly string[];
  frozenReviewDetail?: boolean;
  savedComments?: boolean;
  counts?: Readonly<Record<string, string>>;
};
type Disclosure = { rule: string; omit?: readonly string[] } & Projection;

function verifyDisclosure(id: string, policy: Disclosure, fields: z.ZodRawShape) {
  if (!policy.rule.trim() || policy.omit?.some(key => Object.hasOwn(fields, key))) {
    throw new Error("Invalid public field policy for " + id);
  }
  const projected = [...(policy.remove ?? []), ...(policy.omitEmpty ?? []), ...(policy.omitZero ?? []),
    ...(policy.omitTrue ?? []), ...(policy.omitFalse ?? []), ...Object.keys(policy.items ?? {}),
    ...Object.keys(policy.nested ?? {}), ...Object.keys(policy.counts ?? {}), ...Object.values(policy.counts ?? {})];
  for (const key of projected) {
    if (!Object.hasOwn(fields, key)) throw new Error("Unknown projection field " + id + "." + key);
  }
}

function publicProjection(fields: z.ZodRawShape, policy: Projection, bound: boolean) {
  const output = { ...fields };
  for (const [key, entry] of Object.entries(policy.nested ?? {})) {
    output[key] = fields[key].isOptional() ? entry.schema.optional() : entry.schema;
  }
  for (const [key, entry] of Object.entries(policy.items ?? {})) output[key] = list(entry.schema);
  for (const key of policy.remove ?? []) delete output[key];
  const conditional = [...(policy.omitEmpty ?? []), ...(policy.omitZero ?? []),
    ...(policy.omitFalse ?? []), ...(policy.omitTrue ?? []),
    ...(policy.frozenReviewDetail ? ["stepId", "candidateId"] : []),
    ...(policy.savedComments ? ["savedCommentIds"] : []), ...Object.keys(policy.counts ?? {})];
  if (bound) conditional.push("runId", "stepId", "reviewId");
  for (const key of conditional) if (output[key]) output[key] = output[key].optional();
  const schema = object(output);
  const project = (facts: Record<string, unknown>, binding?: ReceiptBinding) => {
    const result = { ...facts };
    for (const [key, entry] of Object.entries(policy.nested ?? {})) {
      if (result[key] !== undefined) result[key] = entry.select(result[key] as Record<string, unknown>, facts);
    }
    for (const [key, entry] of Object.entries(policy.items ?? {})) {
      if (Array.isArray(result[key])) result[key] = (result[key] as Record<string, unknown>[]).map(entry.select);
    }
    for (const key of policy.remove ?? []) delete result[key];
    for (const key of policy.omitEmpty ?? []) {
      const value = result[key];
      if (value && typeof value === "object" && Object.keys(value).length === 0) delete result[key];
    }
    for (const key of policy.omitZero ?? []) if (result[key] === 0) delete result[key];
    for (const key of policy.omitFalse ?? []) if (result[key] === false) delete result[key];
    for (const [count, list] of Object.entries(policy.counts ?? {})) {
      const items = result[list];
      if (Array.isArray(items) && result[count] === items.length && !result.nextCursor) delete result[count];
    }
    for (const key of policy.omitTrue ?? []) if (result[key] === true) delete result[key];
    if (policy.savedComments && Array.isArray(result.savedCommentIds) &&
        result.savedCommentIds.length === 1 && result.savedCommentIds[0] === result.commentId) {
      delete result.savedCommentIds;
    }
    if (policy.frozenReviewDetail && result.details) {
      const details = cliCommandSchema.safeParse(result.details);
      const args = details.success ? details.data.args : [];
      const start = args[0] === "--project" ? 2 : 0;
      if (details.success && details.data.launcher === "memsphere" &&
          args.slice(start, start + 4).join(" ") === "run review show --review" &&
          args[start + 4] === result.reviewId && args[start + 5] === "--round" &&
          args[start + 6] === result.roundId && args[start + 7] === "--all" && args.length === start + 8) {
        delete result.stepId;
        delete result.candidateId;
      }
    }
    if (bound && binding) {
      for (const key of ["runId", "stepId", "reviewId"] as const) {
        if (binding[key] !== undefined && result[key] === binding[key]) delete result[key];
      }
    }
    return schema.parse(result);
  };
  return { outputFields: output, project };
}

export function receipt(id: string, scenario: string, policy: Disclosure, fields: z.ZodRawShape) {
  verifyDisclosure(id, policy, fields);
  return { id, sourceId: id, scenario, policy, fields, schema: object(fields), ...publicProjection(fields, policy, false) };
}
export type ReceiptCase = ReturnType<typeof receipt>;

export function inherit(cases: ReceiptCase[], sourceId: string, id: string, policy: Disclosure): ReceiptCase {
  const source = cases.find(entry => entry.id === sourceId);
  if (!source) throw new Error("Missing source CLI contract " + sourceId);
  verifyDisclosure(id, policy, source.fields);
  const projection = { ...source.policy, ...policy };
  return { ...source, id, policy: projection, ...publicProjection(source.fields, projection, id.startsWith("runner-continue-")) };
}
