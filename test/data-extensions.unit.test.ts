import assert from "node:assert/strict";

import test from "node:test";

import { type Model, type ModelRuntime, type ModelRuntimeRegistry } from "../src/data/index.js";

import { JsonSchemaModelRuntimeFactory, JSON_SCHEMA_DRAFT_07, filesystemDataStoreExtension, filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSerializerExtension, rawExtension } from "../src/data/extensions/index.js";

import { bytesContent } from "../src/data/extensions/shared/payload.js";

const definition = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object", required: ["orderNo", "lines"], additionalProperties: false,
  properties: {
    orderNo: { type: "string" },
    lines: {
      type: "array", minItems: 1,
      items: {
        type: "object", required: ["quantity"], additionalProperties: false,
        properties: { quantity: { type: "integer", minimum: 1 } }
      }
    }
  }
};

async function orderRuntime() {
  const registered = new Map<string, ModelRuntime>();
  const registry: ModelRuntimeRegistry = {
    get: id => registered.get(id),
    register(runtime) {
      assert.equal(registered.has(runtime.descriptor.id), false);
      registered.set(runtime.descriptor.id, runtime);
    }
  };
  const model: Model = {
    data: {
      id: "order-model.json", model: JSON_SCHEMA_DRAFT_07,
      payload: { contentType: "application/json", content: bytesContent(new TextEncoder().encode(JSON.stringify(definition))) }
    },
    definition
  };
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, model, registry);
  registry.register(runtime);
  return runtime;
}

test("built-ins expose five independently selectable single-capability extensions", () => {
  const extensions = [filesystemDataStoreExtension, filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSerializerExtension, rawExtension];
  assert.equal(new Set(extensions.map(extension => extension.id)).size, 5);
  for (const extension of extensions) {
    const capabilities = [extension.dataStoreFactories, extension.valueStoreFactories, extension.modelRuntimeFactories, extension.payloadSerializers];
    assert.equal(capabilities.filter(Boolean).length, 1);
    assert.equal(capabilities.reduce((count, value) => count + (value?.length ?? 0), 0), 1);
  }
});
