import assert from "node:assert/strict";
import test from "node:test";
import { collectExternalSchemaReferences, collectModelSchemaReferences, validateModelSchemaReferences } from "../src/project/model-schema-references.js";

test("Reference inspection visits Draft-07 schema positions and skips ordinary example/default/enum data", () => {
  const ref = (name: string) => ({ $ref: `${name}.json` });
  const definition = {
    properties: { item: ref("properties") }, patternProperties: { "x.*": ref("pattern") }, definitions: { item: ref("definitions") },
    additionalProperties: ref("additionalProperties"), additionalItems: ref("additionalItems"), contains: ref("contains"), propertyNames: ref("propertyNames"),
    not: ref("not"), if: ref("if"), then: ref("then"), else: ref("else"),
    allOf: [ref("allOf")], anyOf: [ref("anyOf")], oneOf: [ref("oneOf")], items: [ref("tuple0"), ref("tuple1")],
    dependencies: { scalar: ["field"], schema: ref("dependencies") },
    examples: [ref("ignored")], default: ref("ignored"), enum: [ref("ignored")]
  };
  assert.deepEqual(new Set(collectExternalSchemaReferences(definition, "root.json")), new Set([
    "properties", "pattern", "definitions", "additionalProperties", "additionalItems", "contains", "propertyNames", "not", "if", "then", "else", "allOf", "anyOf", "oneOf", "tuple0", "tuple1", "dependencies"
  ].map(name => `${name}.json`)));
  assert.deepEqual(collectExternalSchemaReferences({ items: ref("homogeneous") }, "root.json"), ["homogeneous.json"]);
});

test("Package references preserve exact ModelRef identity and allow finite local recursive pointers", () => {
  const definitions = [
    { registration: { modelRef: "examples/06.json" }, definition: { definitions: { node: { properties: { child: { $ref: "#/definitions/node" } } } }, properties: { external: { $ref: "examples/07.json" } } } },
    { registration: { modelRef: "examples/07.json" }, definition: { type: "string" } }
  ];
  validateModelSchemaReferences(definitions);
  assert.deepEqual(collectExternalSchemaReferences(definitions[0]!.definition, "examples/06.json"), ["examples/07.json"]);
  assert.throws(() => validateModelSchemaReferences(definitions.slice(0, 1)), /Missing model reference/);
  assert.throws(() => validateModelSchemaReferences([{ registration: { modelRef: "test.json" }, definition: { anyOf: [{ $ref: "#/missing" }] } }]), /Missing schema reference/);
  assert.throws(() => validateModelSchemaReferences([{ registration: { modelRef: "test.json" }, definition: { if: { $ref: "missing.json" } } }]), /Missing model reference/);
});

test("Pointers are decoded safely, boolean subschemas are valid targets, and unsupported scopes are explicit", () => {
  validateModelSchemaReferences([{ registration: { modelRef: "test.json" }, definition: { definitions: { "a/b~c": false }, $ref: "#%2Fdefinitions%2Fa~1b~0c" } }]);
  for (const definition of [{ $ref: "#named" }, { $ref: "#/%bad" }, { $ref: "#/bad~2" }, { $id: "relative.json" }, { properties: { sub: { $id: "https://example.test/sub" } } }]) {
    assert.throws(() => collectModelSchemaReferences(definition, "test.json"), TypeError);
  }
  assert.deepEqual(collectExternalSchemaReferences({ $id: "https://example.test/root.json", properties: { a: { $ref: "other.json" } } }, "root.json"), ["https://example.test/other.json"]);
  assert.throws(() => validateModelSchemaReferences([{ registration: { modelRef: "test.json" }, definition: { title: "text", $ref: "#/title" } }]), /not a schema/);
});
