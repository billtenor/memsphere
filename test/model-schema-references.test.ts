import assert from "node:assert/strict";
import test from "node:test";
import { collectExternalSchemaReferences, collectModelSchemaReferences, validateModelSchemaReferences } from "../src/project/model-schema-references.js";

test("Every Draft-07 schema position rejects cross-model references while ordinary annotation data stays opaque", () => {
  const ref = { $ref: "other.json" };
  const definitions = [
    ...["properties", "patternProperties", "definitions"].map(key => ({ [key]: { item: ref } })),
    ...["additionalProperties", "additionalItems", "contains", "propertyNames", "not", "if", "then", "else"].map(key => ({ [key]: ref })),
    ...["allOf", "anyOf", "oneOf", "items"].map(key => ({ [key]: [ref] })),
    { items: ref }, { dependencies: { item: ref } }
  ];
  for (const definition of definitions) assert.throws(() => collectModelSchemaReferences(definition, "root.json"), { code: "MODEL_REFERENCE_UNSUPPORTED" });
  assert.deepEqual(collectModelSchemaReferences({ type: "object", properties: { $ref: { type: "string" } },
    examples: [ref], default: ref, enum: [ref], dependencies: { value: ["other.json"] } }, "root.json"), []);
});

test("Package membership and a matching document URI do not permit nonlocal reference syntax", () => {
  for (const $ref of ["other.json", "other.json#/definitions/value", "https://example.test/root.json#", "https://example.test/root.json#/definitions/value"]) {
    assert.throws(() => validateModelSchemaReferences([
      { registration: { modelRef: "root.json" }, definition: { $id: "https://example.test/root.json", $ref, definitions: { value: { type: "string" } } } },
      { registration: { modelRef: "other.json" }, definition: { type: "string" } }
    ]), { code: "MODEL_REFERENCE_UNSUPPORTED" });
  }
});

test("Local recursive pointers remain finite and escaped targets can be boolean schemas", () => {
  const definition = { definitions: { node: { properties: { child: { $ref: "#/definitions/node" } } }, "a/b~c": false },
    properties: { tree: { $ref: "#/definitions/node" }, condition: { $ref: "#/definitions/a~1b~0c" } } };
  validateModelSchemaReferences([{ registration: { modelRef: "root.json" }, definition }]);
  assert.deepEqual(collectExternalSchemaReferences(definition, "root.json"), []);
  for (const $ref of ["", "#"]) assert.equal(collectModelSchemaReferences({ $ref }, "root.json").length, 1);
});

test("Local pointers reject missing or nonschema targets, named anchors and invalid escapes", () => {
  for (const $ref of ["#named", "#%2Fdefinitions%2Fvalue", "#/%bad", "#/bad~2", "#/missing", "#/title"]) {
    assert.throws(() => collectModelSchemaReferences({ title: "text", $ref, definitions: { value: true } }, "root.json"), { code: "MODEL_REFERENCE_INVALID" });
  }
});

test("An annotation reached by a local reference becomes a checked schema and cannot hide an external reference", () => {
  assert.throws(() => collectModelSchemaReferences({ type: "object", properties: { value: { $ref: "#/default" } },
    default: { $ref: "other.json" } }, "root.json"), { code: "MODEL_REFERENCE_UNSUPPORTED", details: { modelRef: "root.json", path: "#/default/$ref" } });
});
