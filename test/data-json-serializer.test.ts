import assert from "node:assert/strict";
import test from "node:test";
import type { PayloadContent } from "../src/data/api/payload.js";
import type {
  Descriptor,
  EnumDescriptor,
  EnumValueDescriptor,
  FieldDescriptor,
  ObjectDescriptor,
  ScalarDescriptor,
  TypeDescriptor
} from "../src/data/api/reflection.js";
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

test("JSON object values preserve falsy, unknown and nested properties without defaults", async () => {
  const model = descriptor(objectType({ name: stringType, missing: stringType }));
  const value = {
    name: "",
    enabled: false,
    count: 0,
    nullable: null,
    nested: { tags: ["中文", "\ud800", "", null, false, { ratio: 1.25 }] }
  };
  const payload = await serializer.serialize({}, model, value);
  assert.deepEqual(await serializer.deserialize({}, model, payload), value);
  assert.equal(Object.hasOwn(await serializer.deserialize({}, model, payload) as object, "missing"), false);
  assert.deepEqual(JSON.parse(await textOf(payload)), value);
});

test("JSON supports scalar and array roots with exact primitive values", async () => {
  const examples: [TypeDescriptor, unknown][] = [
    [stringType, "hello\nworld"],
    [numberType, 12.5],
    [numberType, Number.MAX_SAFE_INTEGER],
    [numberType, Number.MIN_SAFE_INTEGER],
    [{ kind: "scalar", scalar: "null" }, null],
    [{ kind: "scalar", scalar: "boolean" }, false],
    [{ kind: "array", element: numberType }, [0, 1.25, -2, Number.MIN_VALUE]],
    [{ kind: "array", element: stringType }, []]
  ];
  for (const [root, value] of examples) {
    const model = descriptor(root);
    assert.deepEqual(await serializer.deserialize({}, model, await serializer.serialize({}, model, value)), value);
  }
});

test("JSON preserves dangerous own keys and does not pollute prototypes", async () => {
  const model = descriptor(objectType());
  const input = '{"__proto__":{"jsonSerializerPolluted":true},"constructor":{"prototype":{"x":1}},"prototype":2}';
  const value = await serializer.deserialize({}, model, content(input)) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.deepEqual(value.__proto__, { jsonSerializerPolluted: true });
  assert.equal(Object.hasOwn(Object.prototype, "jsonSerializerPolluted"), false);
  assert.equal(await textOf(await serializer.serialize({}, model, value)), input);

  const nullPrototype = Object.create(null) as Record<string, unknown>;
  nullPrototype.__proto__ = "retained";
  Object.defineProperty(nullPrototype, "constructor", {
    value: "retained too", enumerable: true, configurable: true, writable: true
  });
  assert.deepEqual(
    await serializer.deserialize({}, model, await serializer.serialize({}, model, nullPrototype)),
    JSON.parse('{"__proto__":"retained","constructor":"retained too"}')
  );

  const declaredModel = descriptor(objectType(Object.fromEntries([
    ["__proto__", stringType],
    ["constructor", numberType]
  ])));
  const declaredValue = JSON.parse('{"__proto__":"own field","constructor":42}');
  assert.deepEqual(await serializer.deserialize({}, declaredModel, await serializer.serialize({}, declaredModel, declaredValue)), declaredValue);
  await assert.rejects(serializer.deserialize({}, declaredModel, content('{"__proto__":42,"constructor":42}')), TypeError);
});

test("JSON snapshots serialized data and gives every reader independent bytes", async () => {
  const model = descriptor(objectType());
  const value = { nested: { items: ["before"] } };
  const pending = serializer.serialize({}, model, value);
  value.nested.items[0] = "after";
  const payload = await pending;
  const expected = '{"nested":{"items":["before"]}}';
  assert.equal(await textOf(payload), expected);
  const reader = payload.stream().getReader();
  const first = await reader.read();
  assert.ok(first.value);
  first.value.fill(0);
  await reader.cancel();
  reader.releaseLock();
  assert.deepEqual(await Promise.all([textOf(payload), textOf(payload)]), [expected, expected]);
});

test("JSON honors scalar, object, array and dynamic-field descriptor shapes without coercion", async () => {
  const failures: [TypeDescriptor, unknown][] = [
    [stringType, 1],
    [numberType, "1"],
    [{ kind: "scalar", scalar: "boolean" }, 0],
    [{ kind: "scalar", scalar: "null" }, false],
    [objectType(), []],
    [objectType(), null],
    [{ kind: "array", element: numberType }, {}],
    [{ kind: "array", element: numberType }, ["1"]],
    [objectType({ count: numberType }), { count: "1" }],
    [objectType({}, numberType), { dynamic: "1" }]
  ];
  for (const [root, value] of failures) {
    const model = descriptor(root);
    await assert.rejects(serializer.serialize({}, model, value), TypeError);
    await assert.rejects(serializer.deserialize({}, model, content(JSON.stringify(value))), TypeError);
  }
  const dynamicModel = descriptor(objectType({ label: stringType }, numberType));
  const value = { label: "declared wins", one: 1, two: 2 };
  assert.deepEqual(await serializer.deserialize({}, dynamicModel, await serializer.serialize({}, dynamicModel, value)), value);
});

test("JSON preserves enum values, enforces closed enums and allows same-type open values", async () => {
  for (const root of [enumType("string", ["draft", "ready"]), enumType("number", [10, 20])]) {
    const model = descriptor(root);
    const member = root.enum!.values[0].value;
    assert.equal(await serializer.deserialize({}, model, await serializer.serialize({}, model, member)), member);
    for (const invalid of ["MEMBER_0", root.scalar === "number" ? "10" : 10, root.scalar === "number" ? 99 : "other"]) {
      await assert.rejects(serializer.serialize({}, model, invalid), TypeError);
      await assert.rejects(serializer.deserialize({}, model, content(JSON.stringify(invalid))), TypeError);
    }
  }
  const openModel = descriptor(enumType("string", ["known"], true));
  assert.equal(await serializer.deserialize({}, openModel, await serializer.serialize({}, openModel, "new")), "new");
  await assert.rejects(serializer.serialize({}, openModel, 1), TypeError);
});

test("JSON rejects unsupported descriptors anywhere in the graph, even absent fields", async () => {
  const unsupported: TypeDescriptor[] = [
    { kind: "scalar", scalar: "bigint" },
    { kind: "scalar", scalar: "bytes" },
    { kind: "map", key: stringType, value: stringType },
    { kind: "union" } as unknown as TypeDescriptor
  ];
  for (const type of unsupported) {
    for (const root of [type, objectType({ absent: type }), objectType({}, type), { kind: "array", element: type } as TypeDescriptor]) {
      await assert.rejects(serializer.serialize({}, descriptor(root), {}), /JSON does not support/);
      await assert.rejects(serializer.deserialize({}, descriptor(root), content("{}")), /JSON does not support/);
    }
  }
});

test("JSON rejects non-JSON values even in unknown properties", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const values = [undefined, () => 1, Symbol("value"), 1n, new Uint8Array([1]), new Map(), new Set(), new Date(), /x/, new Number(1), cyclic];
  for (const value of values) {
    await assert.rejects(serializer.serialize({}, descriptor(objectType()), { unknown: value }), TypeError);
  }
  const shared = { value: "allowed" };
  const model = descriptor(objectType());
  assert.deepEqual(
    await serializer.deserialize({}, model, await serializer.serialize({}, model, { one: shared, two: shared })),
    { one: { value: "allowed" }, two: { value: "allowed" } }
  );
});

test("JSON rejects lossy numeric values and uses native precision for fractions", async () => {
  const model = descriptor(numberType);
  for (const value of [NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    await assert.rejects(serializer.serialize({}, model, value), TypeError);
    await assert.rejects(serializer.serialize({}, descriptor(objectType()), { unknown: value }), TypeError);
  }
  for (const literal of ["-0", "-0.0", "1e999", "9007199254740993", "-9007199254740993"]) {
    await assert.rejects(serializer.deserialize({}, model, content(literal)), TypeError);
    await assert.rejects(serializer.deserialize({}, descriptor(objectType()), content(`{"unknown":${literal}}`)), TypeError);
  }
  const fraction = "0.12345678901234567890123456789";
  assert.equal(await serializer.deserialize({}, model, content(fraction)), JSON.parse(fraction));
});

test("JSON rejects malformed enum descriptors, including unrepresentable number members", async () => {
  const invalid: ScalarDescriptor[] = [
    { ...enumType("string", ["a"]), scalar: "number" },
    enumType("number", ["1"]),
    enumType("number", [Infinity]),
    enumType("number", [-0]),
    enumType("number", [Number.MAX_SAFE_INTEGER + 1])
  ];
  for (const type of invalid) {
    const model = descriptor(objectType({ absent: type }));
    await assert.rejects(serializer.serialize({}, model, {}), TypeError);
    await assert.rejects(serializer.deserialize({}, model, content("{}")), TypeError);
  }
});

test("JSON rejects accessors, hooks, sparse arrays and properties it cannot preserve", async () => {
  let effects = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { effects += 1; return 1; } });
  const hook = { toJSON() { effects += 1; return {}; } };
  const hookGetter = Object.defineProperty({}, "toJSON", { get() { effects += 1; return () => ({}); } });
  const hidden = Object.defineProperty({}, "hidden", { value: 1 });
  const symbolKey = { [Symbol("key")]: "value" };
  const extraArray = Object.assign([1], { extra: 1 });
  const arrayGetter = Object.defineProperty([1], "0", { enumerable: true, get() { effects += 1; return 1; } });
  for (const value of [getter, hook, hookGetter, hidden, symbolKey, Array(1), [undefined], extraArray, arrayGetter]) {
    await assert.rejects(serializer.serialize({}, descriptor(objectType()), { unknown: value }), TypeError);
  }
  assert.equal(effects, 0);
  const model = descriptor(objectType());
  const literalProperty = { toJSON: "just data" };
  assert.deepEqual(await serializer.deserialize({}, model, await serializer.serialize({}, model, literalProperty)), literalProperty);
});

test("JSON handles recursive descriptors but rejects cyclic value graphs", async () => {
  const fields: FieldDescriptor[] = [];
  const root: ObjectDescriptor = { kind: "object", fields, field: name => fields.find(field => field.name === name) };
  fields.push({ parent: root, name: "name", type: stringType });
  fields.push({ parent: root, name: "children", type: { kind: "array", element: root } });
  const model = descriptor(root);
  const value = { name: "root", children: [{ name: "leaf", children: [] }] };
  assert.deepEqual(await serializer.deserialize({}, model, await serializer.serialize({}, model, value)), value);
  const cyclic = { name: "root", children: [] as unknown[] };
  cyclic.children.push(cyclic);
  await assert.rejects(serializer.serialize({}, model, cyclic), /cyclic/);
});

test("JSON rejects malformed JSON and invalid UTF-8 and accepts split multibyte sequences", async () => {
  const model = descriptor(objectType());
  for (const malformed of ["", "undefined", "{", '{"x":1,}', '{"x":NaN}', '{} trailing', '{} {}']) {
    await assert.rejects(serializer.deserialize({}, model, content(malformed)), SyntaxError);
  }
  const invalidUtf8: PayloadContent = {
    stream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0x22, 0xc3, 0x28, 0x22])); controller.close(); } })
  };
  await assert.rejects(serializer.deserialize({}, descriptor(stringType), invalidUtf8), TypeError);
  const encoded = new TextEncoder().encode('"中文"');
  const split: PayloadContent = {
    stream: () => new ReadableStream({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } })
  };
  assert.equal(await serializer.deserialize({}, descriptor(stringType), split), "中文");
});

test("JSON honors cancellation before work and cancels a stalled input stream", { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled test operation");
  controller.abort(reason);
  let opened = false;
  const unopened: PayloadContent = { stream() { opened = true; throw new Error("must not open"); } };
  await assert.rejects(serializer.deserialize({ signal: controller.signal }, descriptor(stringType), unopened), error => error === reason);
  await assert.rejects(serializer.serialize({ signal: controller.signal }, descriptor(stringType), "value"), error => error === reason);
  assert.equal(opened, false);

  const pendingController = new AbortController();
  let cancelled: unknown;
  const stalled: PayloadContent = { stream: () => new ReadableStream({ cancel(value) { cancelled = value; } }) };
  const pending = serializer.deserialize({ signal: pendingController.signal }, descriptor(stringType), stalled);
  pendingController.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, reason);
});
