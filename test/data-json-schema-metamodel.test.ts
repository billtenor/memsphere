import assert from "node:assert/strict";
import test from "node:test";
import { JsonSchemaMetaModelRuntimeFactory } from "../src/data/extensions/json-schema-metamodel/index.js";
import { JSON_SCHEMA_DRAFT_07 } from "../src/data/extensions/json-schema/index.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";
import { JsonPayloadSerializer } from "../src/data/extensions/json-serializer/index.js";
import { readAll } from "../src/data/extensions/shared/payload.js";

async function runtime() {
  return new JsonSchemaMetaModelRuntimeFactory().createRuntime({}, { data: { id: JSON_SCHEMA_DRAFT_07, model: JSON_SCHEMA_DRAFT_07,
    payload: { contentType: "application/json", content: bytesContent(Buffer.from("{}")) } }, definition: {} },
    { get() { throw new Error("Bootstrap must not recursively resolve another model"); }, register() {} });
}

test("metamodel bootstrap retains complete advanced definitions while reflecting only declared metadata", async () => {
  const model = await runtime();
  const definition = { title: "Union", anyOf: [{ type: "string" }, { type: "number" }], definitions: { x: true }, customAnnotation: { note: "preserved" } };
  const serializer = new JsonPayloadSerializer();
  const parsed = await serializer.deserialize({}, model.descriptor, bytesContent(Buffer.from(JSON.stringify(definition))));
  const value = model.reflect(parsed);
  assert.equal(value.kind, "object");
  if (value.kind !== "object") throw new Error("not object");
  assert.equal(value.get(value.descriptor.field("title")!)?.value, "Union");
  assert.equal(value.descriptor.field("anyOf"), undefined);
  assert.deepEqual(value.value, definition);
  const serialized = await serializer.serialize({}, model.descriptor, value.value);
  assert.deepEqual(JSON.parse(Buffer.from(await readAll({}, serialized)).toString()), definition);
});

test("metamodel accepts the HTTP and HTTPS Draft-07 identifiers without fetching remote resources", async () => {
  const model = await runtime();
  for (const $schema of ["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema"]) {
    assert.deepEqual(model.reflect({ $schema, type: "object", properties: { name: { type: "string" } } }).value,
      { $schema, type: "object", properties: { name: { type: "string" } } });
  }
});

test("metamodel rejects unsupported standards and malformed definitions instead of silently accepting them", async () => {
  const model = await runtime();
  assert.throws(() => model.reflect({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" }), /Draft-07/);
  assert.throws(() => model.reflect({ type: "unknown" }), /Invalid JSON Schema/);
  assert.throws(() => model.reflect({ required: 42 }), /Invalid JSON Schema/);
  assert.throws(() => model.reflect(true), /plain object/);
});

test("metamodel Factory explicitly targets the definition standard and respects cancellation", async () => {
  const factory = new JsonSchemaMetaModelRuntimeFactory();
  assert.deepEqual(factory.target, { model: JSON_SCHEMA_DRAFT_07 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(factory.createRuntime({ signal: controller.signal }, { data: { id: "wrong", model: "wrong",
    payload: { contentType: "application/json", content: bytesContent(new Uint8Array()) } }, definition: {} }, { get() { return undefined; }, register() {} }), { name: "AbortError" });
});
