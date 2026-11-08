import assert from "node:assert/strict";

import test from "node:test";

import { type Model, type ModelRuntime, type ModelRuntimeRegistry } from "../src/data/index.js";

import { JsonSchemaModelRuntimeFactory, JSON_SCHEMA_DRAFT_07 } from "../src/data/extensions/index.js";

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

test("reflection replacement invalidates descendants across independent reflect calls", async () => {
  const runtime = await orderRuntime();
  const raw = { orderNo: "O-001", lines: [{ quantity: 2 }] };
  const first = runtime.reflect(raw);
  const second = runtime.reflect(raw);
  if (first.kind !== "object" || second.kind !== "object") throw new Error();
  const field = first.descriptor.field("lines")!;
  const lines = first.get(field);
  if (lines?.kind !== "array") throw new Error();
  const line = lines.get(0);
  if (line?.kind !== "object") throw new Error();
  const quantity = line.get(line.descriptor.field("quantity")!);
  if (quantity?.kind !== "scalar") throw new Error();
  second.set(field, [{ quantity: 3 }]);
  assert.throws(() => lines.value, /stale/);
  assert.throws(() => quantity.value, /stale/);
  assert.throws(() => quantity.set(4), /stale/);
  assert.deepEqual(raw.lines, [{ quantity: 3 }]);
});
