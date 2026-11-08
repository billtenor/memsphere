import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseMemoryEntity } from "../src/memory/store.js";
import { collectMemoryReferenceTargets } from "../src/memory/references.js";
import { parseSchemaModel, MEMSPHERE_SCHEMA_MODEL } from "../src/memory/schema-model.js";
import { validateGraphBody } from "../src/context_control/graph-content.js";
import { checkModelDefinition } from "../src/project/model-validation.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
const syntax = "memsphere-20261027-stable";
const definition = `!schema\nsyntax: ${syntax}\ntype: object\nfields: [summary]\n`;
function procedure(model: unknown = { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, contentType = "application/json") {
  return parseMemoryEntity("procedures", { tag: "!procedure", syntax, mode: "graph", names: ["schema-graph"], defines: ["Schema artifacts"], actions: [{ tag: "!action", id: "write", description: "Write", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model, payload: { contentType } } }] }) as GraphProcedureMemory;
}
test("graph accepts inline YAML and canonical Schema references, rejecting ambiguous model sources", () => {
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "schemas/report" });
  assert.deepEqual(collectMemoryReferenceTargets(p), ["schemas/report"]);
  for (const model of [{ definedBy: MEMSPHERE_SCHEMA_MODEL }, { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "schemas/report", definition }, { definedBy: "raw.json", ref: "schemas/report" }, { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "statements/report" }]) assert.throws(() => procedure(model));
  assert.throws(() => parseSchemaModel("!schema\ntype: string\n"), /explicit syntax/);
});
test("ordinary model management rejects the graph-only Schema standard", async () => {
  await assert.rejects(checkModelDefinition({}, { modelRef: "report.json", metaModel: MEMSPHERE_SCHEMA_MODEL, source: definition, definition: undefined }), /only by graph/);
});
test("graph Schema rejects missing required structure and accepts matching payloads", async () => {
  const spec = procedure().actions[0].artifact!;
  const reader = async () => { throw Error("unexpected contentRef"); };
  await validateGraphBody({ content: { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, payload: { contentType: "application/json", content: '{"summary":"ok"}' } } }, spec, reader);
  await assert.rejects(validateGraphBody({ content: { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, payload: { contentType: "application/json", content: '{}' } } }, spec, reader), /summary/);
});
test("Schema Runtime reports field reflection as unsupported", async () => {
  const { runtime } = await checkModelDefinition({}, { modelRef: "report.json", metaModel: MEMSPHERE_SCHEMA_MODEL, source: definition, definition: undefined, scope: "graph" });
  assert.throws(() => runtime!.reflect({}), { code: "MODEL_REFLECTION_UNSUPPORTED" });
});
test("unsupported frozen contract versions fail without recompiling current Memory", async () => {
  const { resolvedArtifact } = await import("../src/context_control/schema-contract.js");
  const spec = procedure().actions[0].artifact!;
  assert.throws(() => resolvedArtifact({ id: "old-run", schemaContracts: { write: { compiledVersion: 99 } } } as unknown as import("../src/context_control/types.js").Run, "write", spec), { code: "SCHEMA_CONTRACT_VERSION_UNSUPPORTED" });
});
