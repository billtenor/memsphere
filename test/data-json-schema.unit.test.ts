import assert from "node:assert/strict";

import test from "node:test";

import { JSON_SCHEMA_DRAFT_07, JsonSchemaModelRuntimeFactory, jsonSchemaExtension } from "../src/data/extensions/json-schema/index.js";



import type { Model } from "../src/data/api/model.js";

import type { ModelRuntime, ModelRuntimeRegistry } from "../src/data/api/model-runtime.js";

import type { ObjectDescriptor } from "../src/data/api/reflection.js";

function model(definition: unknown, id = "tests/example.json"): Model {
  return {
    data: { id, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: { stream: () => new ReadableStream() } } },
    definition
  };
}

function registry(...runtimes: ModelRuntime[]): ModelRuntimeRegistry {
  const registered = new Map(runtimes.map(runtime => [runtime.descriptor.id, runtime]));
  return {
    get: ref => registered.get(ref),
    register(runtime) {
      assert.equal(registered.has(runtime.descriptor.id), false);
      registered.set(runtime.descriptor.id, runtime);
    }
  };
}

function compile(definition: unknown, dependencies = registry()) {
  return new JsonSchemaModelRuntimeFactory().createRuntime({}, model(definition), dependencies);
}

test("JSON Schema is an independent meta-model-targeted extension with stable descriptor identities", async () => {
  assert.equal(jsonSchemaExtension.id, "memsphere/json-schema-draft-07");
  assert.equal(jsonSchemaExtension.version, "0.1.0");
  assert.equal(jsonSchemaExtension.modelRuntimeFactories?.length, 1);
  assert.equal(jsonSchemaExtension.payloadSerializers, undefined);
  assert.equal(jsonSchemaExtension.dataStoreFactories, undefined);
  assert.deepEqual(new JsonSchemaModelRuntimeFactory().target, { metaModel: JSON_SCHEMA_DRAFT_07 });
  const runtime = await compile({
    $schema: "https://json-schema.org/draft-07/schema#",
    type: "object", description: "A record",
    properties: {
      title: { type: "string", description: "The title" },
      count: { type: "integer" },
      active: { type: "boolean" },
      empty: { type: "null" },
      tags: { type: "array", items: { type: "string" } }
    },
    additionalProperties: { type: "number" }
  });
  assert.equal(runtime.descriptor.id, "tests/example.json");
  assert.equal(runtime.descriptor.root.kind, "object");
  const root = runtime.descriptor.root as ObjectDescriptor;
  assert.equal(root.description, "A record");
  assert.equal(root.fields.length, 5);
  for (const field of root.fields) {
    assert.strictEqual(field.parent, root);
    assert.strictEqual(root.field(field.name), field);
  }
  assert.equal(root.field("title")?.description, "The title");
  assert.deepEqual(root.field("count")?.type, { kind: "scalar", scalar: "number" });
  assert.strictEqual(root.field("dynamic"), root.field("dynamic"));
  assert.strictEqual(root.field("dynamic")?.parent, root);
  assert.strictEqual(root.field("dynamic")?.type, root.additionalProperties);
  assert.equal(root.fields.length, 5);
});
