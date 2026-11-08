import assert from "node:assert/strict";

import test from "node:test";

import { checkModelDefinition } from "../src/project/model-validation.js";





test("Model identities require the canonical suffix without changing schema URI or extension identity", async () => {
  for (const modelRef of ["entry", "../entry.json", "/entry.json", "a\\b.json", "a.JSON"]) await assert.rejects(checkModelDefinition({}, { modelRef, definition: { type: "string" } }), { code: "MODEL_ID_INVALID" });
  const checked = await checkModelDefinition({}, { modelRef: "entry.json", definition: { $id: "https://example.test/entry", type: "string" } });
  assert.equal(checked.runtime!.descriptor.id, "entry.json");
  assert.deepEqual(checked.model.definition, { $id: "https://example.test/entry", type: "string" });
});
