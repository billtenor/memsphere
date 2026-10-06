import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { listModels, readModel } from "../src/project/model-service.js";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";

// These rule combinations previously each drove the same unavailable screen.
// The contract here is the saved model's availability, read rejection and bytes;
// the browser suite separately protects the unavailable screen and recovery.
const cases = [
  ["format-root.json", { type: "string", format: "uuid" }],
  ["format-field.json", { type: "object", properties: { email: { type: "string", format: "email" } } }],
  ["custom-format.json", { type: "string", format: "<b>custom</b>" }],
  ["encoded.json", { type: "string", contentEncoding: "base64" }],
  ["allow-root.json", true], ["deny-root.json", false],
  ["allow-property.json", { type: "object", properties: { allowed: true } }],
  ["deny-property.json", { type: "object", properties: { forbidden: false } }],
  ["deny-items.json", { type: "array", items: false }],
  ["nullable.json", { type: "object", properties: { value: { type: ["string", "null"] } } }],
  ["any-of.json", { type: "object", properties: { value: { anyOf: [{ type: "string" }, { type: "integer" }] } } }],
  ["one-of.json", { type: "object", properties: { value: { oneOf: [{ type: "string" }, { type: "integer" }] } } }],
  ["nested-union.json", { type: "array", items: { oneOf: [{ type: "string" }, { type: "integer" }] } }],
  ["conditional.json", { type: "object", if: { type: "object" }, then: { type: "object" } }],
  ["all-of.json", { type: "number", allOf: [{ type: "number", minimum: 0 }] }],
  ["patterned.json", { type: "object", patternProperties: { "^tag": { type: "string" } } }],
  ["missing-ref.json", { type: "object", properties: { missing: { $ref: "#/definitions/missing" } } }],
  ["external-ref.json", { type: "object", properties: { external: { $ref: "other.json" }, valid: { type: "integer" } } }],
  ["alias-cycle.json", { $ref: "#/definitions/alias", definitions: { alias: { $ref: "#/definitions/alias" } } }]
] as const;

for (const [id, schema] of cases) {
  test(`saved ${id} stays unavailable and rejects definition reads without rewriting its source`, async t => {
    const f = await businessFixture(t, { [id]: schema });
    const source = JSON.stringify(schema, null, 2);
    const path = join(f.root, "models/json-schema/draft-07", id);
    await writeFile(path, source);
    const before = await snapshotTree(f.root);
    const catalog = await listModels({}, f.root);
    assert.equal(catalog.items.find(model => model.id === id)?.status, "unavailable");
    await assert.rejects(readModel({}, f.root, id), /Unsupported|not supported|must be an object|plain object|reference/i);
    assert.equal(await readFile(path, "utf8"), source);
    assert.deepEqual(await snapshotTree(f.root), before);
  });
}
