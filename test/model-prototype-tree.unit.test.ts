import assert from "node:assert/strict";
import test from "node:test";
import { definitionTree } from "../modules/org.memsphere.model-prototype/adapter/view/definition-tree.js";

test("prototype table preserves separate array and array-element levels", () => {
  const tree = definitionTree({ type: "object", properties: {
    items: { type: "array", items: { type: "object", properties: {
      productId: { type: "string" }, quantity: { type: "number" }
    }, required: ["quantity"] } }
  }, required: ["items"] }, "Object", "Array element");
  const items = tree.children[0];
  assert.equal(tree.kind, "root");
  assert.equal(items.kind, "field");
  assert.equal(tree.required, undefined);
  assert.equal(items.name, "items");
  assert.equal(items.required, true);
  assert.equal(items.children.length, 1);
  const element = items.children[0];
  assert.equal(element.kind, "element");
  assert.equal(element.name, "Array element");
  assert.equal(element.required, undefined);
  assert.deepEqual(element.children.map(field => [field.name, field.required]), [["productId", false], ["quantity", true]]);
});

test("prototype required flags are local to each containing object", () => {
  const tree = definitionTree({ type: "object", properties: {
    optional: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    name: { type: "string" }
  }, required: ["name"] }, "Object", "Array element");
  assert.equal(tree.children[0].required, false);
  assert.equal(tree.children[0].children[0].required, true);
  assert.equal(tree.children[1].required, true);
});

test("prototype preserves nested arrays without inventing fields or values", () => {
  const tree = definitionTree({ type: "array", items: { type: "array", items: { type: "string" } } }, "Array", "Array element");
  assert.equal(tree.children[0].schema.type, "array");
  assert.equal(tree.children[0].children[0].schema.type, "string");
  assert.equal(tree.children[0].children[0].children.length, 0);
});

test("prototype preserves descriptions, defaults and enum definitions without changing the source", () => {
  const schema = { type: "object", properties: { state: { type: "string", enum: ["new", "done"], default: "new", description: "State" } } };
  const before = JSON.stringify(schema);
  const tree = definitionTree(schema, "Object", "Array element");
  assert.deepEqual(tree.children[0].schema, schema.properties.state);
  assert.equal(JSON.stringify(schema), before);
});

test("scalar roots and unresolved reference rows are not presented as made-up object fields", () => {
  const scalar = definitionTree({ type: "number" }, "Number", "Array element");
  assert.equal(scalar.required, undefined);
  assert.equal(scalar.children.length, 0);
  const reference = definitionTree({ $ref: "other.json" }, "Unspecified", "Array element");
  assert.equal(reference.children.length, 0);
  assert.equal(reference.schema.$ref, "other.json");
});

test("local references expose target structures while required stays on the containing field and source stays unchanged", () => {
  const schema = { type: "object", properties: { address: { $ref: "#/definitions/alias", description: "收货地址", type: "number", format: "wrong" },
    addresses: { type: "array", items: { $ref: "#/definitions/address" } },
    dictionary: { type: "object", additionalProperties: { $ref: "#/definitions/address" } },
    choice: { anyOf: [{ $ref: "#/definitions/address" }, { $ref: "#/definitions/text" }] }
  }, required: ["address"], definitions: { alias: { $ref: "#/definitions/address" },
    address: { type: "object", properties: { city: { type: "string", format: "custom", enum: ["上海"] } }, required: ["city"] },
    text: { type: "string" } } };
  const before = JSON.stringify(schema);
  const tree = definitionTree(schema, "Root", "Item");
  const address = tree.children[0];
  assert.equal(address.schema.type, "object");
  assert.equal(address.schema.description, "收货地址");
  assert.equal(address.schema.format, undefined, "Draft-07 validation siblings do not alter the target");
  assert.equal(address.required, true);
  assert.deepEqual(address.references, ["#/definitions/alias", "#/definitions/address"]);
  assert.equal(address.children[0].required, true);
  assert.equal(tree.children[1].required, false);
  assert.equal(tree.children[1].children[0].required, undefined);
  assert.equal(tree.children[1].children[0].children[0].schema.format, "custom");
  assert.equal(tree.children[2].children[0].children[0].name, "city");
  assert.equal(tree.children[3].children[0].children[0].name, "city");
  assert.equal(JSON.stringify(schema), before);
});

test("local reference addresses honor pointer escaping, URI encoding, root IDs and boolean targets", () => {
  const schema = { $id: "https://example.test/schema", type: "object", properties: {
    escaped: { $ref: "#/definitions/a~1b~0c" }, encoded: { $ref: "#/definitions/%E5%90%8D%E7%A7%B0" },
    absolute: { $ref: "https://example.test/schema#/definitions/名称" },
    allowed: { $ref: "#/definitions/allowed" }, forbidden: { $ref: "#/definitions/forbidden" }
  }, definitions: { "a/b~c": { type: "integer" }, 名称: { type: "string" }, allowed: true, forbidden: false } };
  const fields = definitionTree(schema, "Root", "Item").children;
  assert.deepEqual(fields.slice(0, 3).map(field => field.schema.type), ["integer", "string", "string"]);
  assert.equal(fields[3].booleanSchema, true);
  assert.equal(fields[4].booleanSchema, false);
  const idNamed = definitionTree({ $ref: "#/definitions/$id", definitions: { $id: { type: "string" } } }, "Root", "Item");
  assert.equal(idNamed.schema.type, "string", "$id used as a definition name does not establish a scope");
});

test("unresolved references report a reason without exposing siblings as the referenced structure", () => {
  for (const [ref, error] of [["#/missing", "missing"], ["other.json", "external"], ["#named", "invalid"],
    ["#/definitions/a~2b", "invalid"], ["#/%zz", "invalid"], ["#/definitions/invalid", "invalid"],
    ["#/definitions/scoped", "scope"]]) {
    const tree = definitionTree({ $ref: ref, properties: { fake: { type: "string" } },
      definitions: { invalid: 123, scoped: { $id: "different.json", type: "string" } } }, "Root", "Item");
    assert.equal(tree.referenceError, error);
    assert.equal(tree.children.length, 0);
  }
  const cycle = definitionTree({ $ref: "#/definitions/alias", definitions: { alias: { $ref: "#" } } }, "Root", "Item");
  assert.equal(cycle.referenceError, "cycle");
  const scoped = definitionTree({ type: "object", properties: { scope: { $id: "different.json", type: "object",
    properties: { value: { $ref: "#/definitions/name" } } } }, definitions: { name: { type: "string" } } }, "Root", "Item");
  assert.equal(scoped.children[0].children[0].referenceError, "scope");
});

test("recursive object references keep a finite tree and allow another explicit level", () => {
  const schema = { type: "object", properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#" } } } };
  const tree = definitionTree(schema, "Root", "Item");
  const item = tree.children[1].children[0];
  assert.equal(item.schema.type, "object");
  assert.equal(item.children.length, 0);
  assert.ok(item.expandReference);
  const next = item.expandReference();
  assert.equal(next[0].name, "name");
  assert.ok(next[1].children[0].expandReference);
  assert.notEqual(next[0].id, tree.children[0].id);
});

test("boolean schemas preserve their semantics instead of becoming empty object definitions", () => {
  const tree = definitionTree({ type: "object", properties: { any: true, forbidden: false } }, "Object", "Array element");
  assert.equal(tree.children[0].booleanSchema, true);
  assert.equal(tree.children[1].booleanSchema, false);
  assert.equal(tree.children[0].children.length, 0);
});

test("dynamic fields are peers of named fields and expand their values without inventing concrete names", () => {
  const schema = { type: "object", properties: { known: { type: "string" } }, required: ["known"], additionalProperties: {
    type: "array", items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] }
  } };
  const source = JSON.stringify(schema);
  const tree = definitionTree(schema, "Root", "Item", "[Dynamic field]");
  assert.deepEqual(tree.children.map(child => [child.kind, child.name, child.required]), [
    ["field", "known", true], ["dynamic-field", "[Dynamic field]", undefined]
  ]);
  const dictionary = tree.children[1];
  assert.equal(dictionary.schema.type, "array");
  const item = dictionary.children[0];
  assert.equal(item.kind, "element");
  assert.equal(item.required, undefined);
  assert.deepEqual(item.children.map(child => [child.name, child.required]), [["id", true]]);
  assert.equal(JSON.stringify(schema), source);
});

test("dictionary nodes honor explicit boolean schemas without inferring implicit or patterned keys", () => {
  for (const schema of [{ type: "object" }, { type: "object", additionalProperties: false },
    { type: "object", patternProperties: { "^prefix": { type: "string" } } },
    { type: "array", additionalProperties: { type: "string" } }]) {
    assert.equal(definitionTree(schema, "Root", "Item").children.length, 0);
  }
  const tree = definitionTree({ type: "object", additionalProperties: true }, "Root", "Item");
  assert.equal(tree.children[0].kind, "dynamic-field");
  assert.equal(tree.children[0].name, "[Dynamic field]");
  assert.equal(tree.children[0].booleanSchema, true);
  assert.equal(tree.children[0].required, undefined);
  assert.equal(tree.children[0].children.length, 0);
  const inferred = definitionTree({ additionalProperties: { $ref: "#/definitions/value" } }, "Root", "Item");
  assert.equal(inferred.children[0].schema.$ref, "#/definitions/value");
  assert.equal(inferred.children[0].children.length, 0);
});

test("union branches retain independent fields, local required flags and source definitions", () => {
  const schema = { type: "object", properties: { payment: { oneOf: [
    { type: "object", properties: { method: { const: "card" }, cardLast4: { type: "string" } }, required: ["cardLast4"] },
    { type: "object", properties: { method: { const: "cash" }, received: { type: "boolean" } }, required: ["received"] }
  ] } }, required: ["payment"] };
  const before = JSON.stringify(schema);
  const payment = definitionTree(schema, "Root", "Item").children[0];
  assert.equal(payment.required, true);
  assert.deepEqual(payment.children.map(branch => [branch.kind, branch.combination, branch.required]), [
    ["branch", "oneOf", undefined], ["branch", "oneOf", undefined]
  ]);
  assert.deepEqual(payment.children[0].children.map(field => [field.name, field.required]), [["method", false], ["cardLast4", true]]);
  assert.deepEqual(payment.children[1].children.map(field => [field.name, field.required]), [["method", false], ["received", true]]);
  assert.equal(payment.children[0].schema, schema.properties.payment.oneOf[0]);
  assert.notEqual(payment.children[0].id, payment.children[1].id);
  assert.equal(JSON.stringify(schema), before);
});

test("unions retain nesting under array items and dynamic fields without merging simultaneous groups or resolving references", () => {
  const schema = { type: "array", items: { anyOf: [true, false, { type: "object", additionalProperties: {
    anyOf: [{ $ref: "other.json" }, { type: "string" }], oneOf: [{ type: "number" }, { type: "boolean" }]
  } }] } };
  const root = definitionTree(schema, "Root", "Item");
  const item = root.children[0];
  assert.equal(item.kind, "element");
  assert.deepEqual(item.children.map(branch => branch.booleanSchema), [true, false, undefined]);
  const dynamic = item.children[2].children[0];
  assert.equal(dynamic.kind, "dynamic-field");
  assert.deepEqual(dynamic.children.map(branch => branch.combination), ["anyOf", "anyOf", "oneOf", "oneOf"]);
  assert.deepEqual(dynamic.children.map(branch => branch.name), ["[anyOf: Type 1]", "[anyOf: Type 2]", "[oneOf: Type 1]", "[oneOf: Type 2]"]);
  assert.equal(dynamic.children[0].schema.$ref, "other.json");
  assert.equal(dynamic.children[0].children.length, 0);
});
