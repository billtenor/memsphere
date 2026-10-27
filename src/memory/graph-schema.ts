import { z } from "zod";
import jsonata from "jsonata";
import type { GraphProcedureNode, RulePart } from "./ast.js";
import { assertModelRef } from "../project/model-registration-contract.js";
import { validateJsonSchemaDefinition } from "../data/extensions/json-schema-metamodel/index.js";
import { encodeJsonValue } from "../data/extensions/json-serializer/index.js";

const text = z.string().refine(value => value.trim().length > 0, "Must be nonblank");
const distinctIds = z.array(text).min(1).superRefine((values, context) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: "custom", path: [index], message: `Duplicate ID: ${value}` });
    seen.add(value);
  });
});

/** This grammar is registered only for the graph-aware syntax version. */
export function graphProcedureSchema(input: {
  names: z.ZodType<string[], z.ZodTypeDef, unknown>;
  rule: z.ZodType<RulePart, z.ZodTypeDef, unknown>;
  normalize: (value: unknown) => unknown;
}): z.ZodType<GraphProcedureNode, z.ZodTypeDef, unknown> {
  const rules = z.array(input.rule).min(1).optional();
  const model = z.object({ definedBy: text, definition: text }).strict().superRefine((value, context) => {
    try { assertModelRef(value.definedBy); }
    catch (error) { context.addIssue({ code: "custom", path: ["definedBy"], message: errorMessage(error) }); }
    try {
      const definition: unknown = JSON.parse(value.definition);
      encodeJsonValue(definition);
      if (value.definedBy === "json-schema/draft-07.json") validateJsonSchemaDefinition(definition);
    } catch (error) { context.addIssue({ code: "custom", path: ["definition"], message: errorMessage(error) }); }
  });
  const artifact = z.object({
    name: text, asserts: rules, suggests: rules, model,
    payload: z.object({ contentType: text }).strict(), review: distinctIds.optional()
  }).strict();
  const dependency = z.object({
    tag: z.literal("!dependency"), from: z.union([text, distinctIds]),
    when: text.superRefine((value, context) => {
      try { jsonata(value); }
      catch (error) { context.addIssue({ code: "custom", message: `Invalid JSONata: ${errorMessage(error)}` }); }
    }).optional()
  }).strict();
  const common = {
    tag: z.literal("!action"), id: text, description: text,
    dependencies: z.array(dependency).min(1), asserts: rules, suggests: rules
  };
  const action = z.union([
    z.object({ ...common, actor: z.enum(["agent", "human"]).optional(), artifact }).strict(),
    z.object({ ...common, collect: distinctIds }).strict()
  ]);
  return z.preprocess(input.normalize, z.object({
    tag: z.literal("!procedure"), mode: z.literal("graph"), names: input.names,
    defines: z.array(text).min(1), asserts: rules, goals: z.array(text).default([]),
    actions: z.array(action).min(1)
  }).strict().superRefine((procedure, context) => {
    const byId = new Map<string, typeof procedure.actions[number]>();
    for (const [index, value] of procedure.actions.entries()) {
      if (value.id === "START" || byId.has(value.id)) {
        context.addIssue({ code: "custom", path: ["actions", index, "id"], message: value.id === "START" ? "START is reserved" : `Duplicate Action ID: ${value.id}` });
      }
      byId.set(value.id, value);
    }
    let hasEntry = false;
    for (const [index, value] of procedure.actions.entries()) {
      value.dependencies.forEach((dep, depIndex) => {
        for (const source of typeof dep.from === "string" ? [dep.from] : dep.from) {
          if (source === "START") hasEntry = true;
          else if (!byId.has(source)) context.addIssue({ code: "custom", path: ["actions", index, "dependencies", depIndex, "from"], message: `Unknown Action: ${source}` });
        }
      });
      if ("collect" in value) value.collect.forEach((source, sourceIndex) => {
        const producer = byId.get(source);
        if (!producer || !("artifact" in producer)) context.addIssue({ code: "custom", path: ["actions", index, "collect", sourceIndex], message: `collect requires a producing Action: ${source}` });
      });
    }
    if (!hasEntry) context.addIssue({ code: "custom", path: ["actions"], message: "Graph requires a START dependency" });
  }));
}

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
