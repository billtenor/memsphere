import assert from "node:assert/strict";
import test from "node:test";
import { checkModelDefinition } from "../src/project/model-validation.js";
import { JSON_SCHEMA_DRAFT_07 } from "../src/data/extensions/json-schema/index.js";
import { RAW_MODEL } from "../src/data/extensions/raw/index.js";

test("Candidate checking distinguishes invalid definitions from unsupported Runtime constraints with model and location", async () => {
  await assert.rejects(checkModelDefinition({}, { modelRef: "bad.json", definition: { type: "object", required: 42 } }),
    { code: "MODEL_DEFINITION_INVALID", details: { modelRef: "bad.json", path: "#/required" } });
  const candidate = { modelRef: "advanced.json", definition: { type: "string", format: "email" } };
  const diagnostic = await checkModelDefinition({}, candidate, "definition");
  assert.equal(diagnostic.runtime, undefined);
  assert.deepEqual(diagnostic.model.definition, candidate.definition);
  await assert.rejects(checkModelDefinition({}, candidate),
    { code: "MODEL_RUNTIME_UNSUPPORTED", details: { modelRef: "advanced.json", path: "#/format" } });
});

test("Candidate checking uses the persisted source bytes and cannot approve a different supplied definition", async () => {
  await assert.rejects(checkModelDefinition({}, { modelRef: "bad.json", definition: { type: "string" }, source: '{"required":42}' }), { code: "MODEL_DEFINITION_INVALID" });
  await assert.rejects(checkModelDefinition({}, { modelRef: "bad.json", definition: {}, source: "not-json" }), { code: "MODEL_DEFINITION_INVALID" });
});

test("Definition diagnostics reject cross-model references and invalid local targets without requiring business Runtime support", async () => {
  for (const check of ["definition", "runtime"] as const) {
    await assert.rejects(checkModelDefinition({}, { modelRef: "entry.json", definition: { anyOf: [{ $ref: "other.json" }] } }, check), { code: "MODEL_REFERENCE_UNSUPPORTED" });
    await assert.rejects(checkModelDefinition({}, { modelRef: "entry.json", definition: { $ref: "#/missing" } }, check), { code: "MODEL_REFERENCE_INVALID" });
  }
});

test("Model identities require the canonical suffix without changing schema URI or extension identity", async () => {
  for (const modelRef of ["entry", "../entry.json", "/entry.json"]) await assert.rejects(checkModelDefinition({}, { modelRef, definition: { type: "string" } }), { code: "MODEL_ID_INVALID" });
  const checked = await checkModelDefinition({}, { modelRef: "entry.json", definition: { $id: "https://example.test/entry", type: "string" } });
  assert.equal(checked.runtime!.descriptor.id, "entry.json");
  assert.deepEqual(checked.model.definition, { $id: "https://example.test/entry", type: "string" });
});

test("Metamodel bootstrap and raw definitions keep their own Runtime semantics", async () => {
  const meta = await checkModelDefinition({}, { modelRef: JSON_SCHEMA_DRAFT_07, definition: { type: "object" } });
  assert.doesNotThrow(() => meta.runtime!.reflect({ anyOf: [{ type: "string" }, { type: "number" }] }));
  const raw = await checkModelDefinition({}, { modelRef: "artifact.json", metaModel: RAW_MODEL, definition: {} });
  const bytes = new Uint8Array([0, 255]);
  assert.equal(raw.runtime!.reflect(bytes).value, bytes);
  assert.throws(() => raw.runtime!.reflect("text"));
  await assert.rejects(checkModelDefinition({}, { modelRef: "artifact.json", metaModel: RAW_MODEL, definition: { type: "string" } }), { code: "MODEL_DEFINITION_INVALID" });
});
