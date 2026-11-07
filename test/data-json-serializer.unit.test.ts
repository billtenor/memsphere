import assert from "node:assert/strict";

import test from "node:test";

import type { PayloadContent } from "../src/data/api/payload.js";

import type { Descriptor, EnumDescriptor, EnumValueDescriptor, FieldDescriptor, ObjectDescriptor, ScalarDescriptor, TypeDescriptor } from "../src/data/api/reflection.js";

import { JsonPayloadSerializer, jsonSerializerExtension } from "../src/data/extensions/json-serializer/index.js";

const serializer = new JsonPayloadSerializer();

const stringType: ScalarDescriptor = { kind: "scalar", scalar: "string" };

const numberType: ScalarDescriptor = { kind: "scalar", scalar: "number" };

function objectType(
  types: Record<string, TypeDescriptor> = {},
  additionalProperties?: TypeDescriptor
): ObjectDescriptor {
  const fields: FieldDescriptor[] = [];
  const dynamic = new Map<string, FieldDescriptor>();
  const result: ObjectDescriptor = {
    kind: "object",
    fields,
    additionalProperties,
    field(name) {
      const declared = fields.find(field => field.name === name);
      if (declared || additionalProperties === undefined) return declared;
      if (!dynamic.has(name)) dynamic.set(name, { parent: result, name, type: additionalProperties });
      return dynamic.get(name);
    }
  };
  for (const [name, type] of Object.entries(types)) fields.push({ parent: result, name, type });
  return result;
}

function descriptor(root: TypeDescriptor): Descriptor {
  return { id: "test/json", root };
}

function enumType(scalar: "string" | "number", entries: (string | number)[], open = false): ScalarDescriptor {
  const values: EnumValueDescriptor[] = [];
  const enumeration: EnumDescriptor = {
    scalar,
    open,
    values,
    byName: name => values.find(member => member.name === name),
    byValue: value => values.find(member => member.value === value)
  };
  entries.forEach((value, index) => values.push({ parent: enumeration, name: `MEMBER_${index}`, value }));
  return { kind: "scalar", scalar, enum: enumeration };
}

function content(text: string): PayloadContent {
  const bytes = new TextEncoder().encode(text);
  return { stream: () => new ReadableStream({ start(controller) { controller.enqueue(bytes.slice()); controller.close(); } }) };
}

async function textOf(payload: PayloadContent): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = payload.stream().getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

test("JSON serializer extension registers one independent capability", () => {
  assert.equal(serializer.id, "json");
  assert.equal(serializer.contentType, "application/json");
  assert.equal(jsonSerializerExtension.id, "memsphere/json-serializer");
  assert.equal(jsonSerializerExtension.version, "0.1.0");
  assert.equal(jsonSerializerExtension.payloadSerializers?.length, 1);
  assert.ok(jsonSerializerExtension.payloadSerializers?.[0] instanceof JsonPayloadSerializer);
  assert.equal(jsonSerializerExtension.modelRuntimeFactories, undefined);
  assert.equal(jsonSerializerExtension.dataStoreFactories, undefined);
  assert.equal(jsonSerializerExtension.valueStoreFactories, undefined);
});
