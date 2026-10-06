import assert from "node:assert/strict";
import test from "node:test";
import {
  JSON_SCHEMA_DRAFT_07,
  JsonSchemaModelRuntimeFactory,
  jsonSchemaExtension
} from "../src/data/extensions/json-schema/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import type { Model } from "../src/data/api/model.js";
import type { ModelRuntime, ModelRuntimeRegistry } from "../src/data/api/model-runtime.js";
import type { ArrayValue, ObjectDescriptor, ObjectValue, ScalarValue } from "../src/data/api/reflection.js";

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

test("JSON Schema nested views enforce constraints, required fields, and atomic failed writes", async () => {
  const runtime = await compile({
    type: "object", required: ["profile"], additionalProperties: false,
    properties: {
      profile: {
        type: "object", required: ["name", "age", "tags"], additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 2, maxLength: 12, pattern: "^[a-z]+$" },
          age: { type: "integer", minimum: 0, maximum: 150 },
          tags: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string" } }
        }
      }
    }
  });
  const raw = { profile: { name: "alice", age: 20, tags: ["first"] } };
  const root = runtime.reflect(raw) as ObjectValue;
  const profile = root.get(root.descriptor.field("profile")!) as ObjectValue;
  const name = profile.get(profile.descriptor.field("name")!) as ScalarValue;
  const age = profile.get(profile.descriptor.field("age")!) as ScalarValue;
  const tags = profile.get(profile.descriptor.field("tags")!) as ArrayValue;
  name.set("bob");
  assert.equal(raw.profile.name, "bob");
  assert.throws(() => name.set("X"), /JSON Schema validation/);
  assert.equal(name.value, "bob");
  assert.throws(() => age.set(2.5), /JSON Schema validation/);
  assert.equal(age.value, 20);
  assert.throws(() => profile.delete(profile.descriptor.field("name")!), /required/);
  assert.equal(name.value, "bob");
  tags.push("second");
  assert.throws(() => tags.push("third"), /maxItems|more than 2/);
  assert.deepEqual(raw.profile.tags, ["first", "second"]);
  assert.throws(() => tags.set(1, "first"), /unique|duplicate/);
  assert.deepEqual(raw.profile.tags, ["first", "second"]);
  assert.throws(() => tags.clear(), /minItems|fewer than 1/);
  assert.deepEqual(raw.profile.tags, ["first", "second"]);
  assert.throws(() => runtime.reflect({}), /required/);
  assert.throws(() => runtime.reflect({ profile: { name: "alice", age: "20", tags: ["one"] } }));
});

test("JSON Schema does not default, coerce, remove or implicitly forbid opaque additional properties", async () => {
  for (const additionalProperties of [undefined, true]) {
    const runtime = await compile({
      type: "object", properties: { name: { type: "string", default: "default-name" } },
      ...(additionalProperties === undefined ? {} : { additionalProperties })
    });
    const raw = { extra: { value: 1 } };
    const root = runtime.reflect(raw) as ObjectValue;
    assert.deepEqual(raw, { extra: { value: 1 } });
    assert.equal(root.has(root.descriptor.field("name")!), false);
    assert.equal(root.get(root.descriptor.field("name")!), undefined);
    assert.equal(root.descriptor.field("extra"), undefined);
    assert.deepEqual([...root], []);
    assert.throws(() => root.set(root.descriptor.field("name")!, 23));
    assert.deepEqual(raw, { extra: { value: 1 } });
  }
  const closed = await compile({ type: "object", properties: {}, additionalProperties: false });
  assert.throws(() => closed.reflect({ extra: 1 }), /additional propert/);
  const dynamic = await compile({ type: "object", additionalProperties: { type: "integer", minimum: 0 } });
  const value = dynamic.reflect({ first: 1 }) as ObjectValue;
  value.set(value.descriptor.field("second")!, 2);
  assert.equal([...value].length, 2);
  assert.throws(() => value.set(value.descriptor.field("first")!, -1), /JSON Schema validation/);
  assert.deepEqual(value.value, { first: 1, second: 2 });
});

test("JSON Schema string and number enums keep raw values, identity and unnamed members", async () => {
  for (const members of [["red", "green"], [0, 2]] as const) {
    const runtime = await compile({ enum: members, description: "Allowed values" });
    const descriptor = runtime.descriptor.root;
    assert.equal(descriptor.kind, "scalar");
    if (descriptor.kind !== "scalar") throw new Error("expected scalar");
    const enumeration = descriptor.enum!;
    assert.equal(enumeration.open, false);
    assert.equal(enumeration.description, "Allowed values");
    assert.equal(enumeration.name, undefined);
    for (const member of enumeration.values) {
      assert.equal(member.name, undefined);
      assert.strictEqual(member.parent, enumeration);
      assert.strictEqual(enumeration.byValue(member.value), member);
      assert.equal(enumeration.byName(String(member.value)), undefined);
    }
    assert.equal(enumeration.byValue(typeof members[0] === "string" ? 0 : "0"), undefined);
    const value = runtime.reflect(members[0]) as ScalarValue;
    value.set(members[1]);
    assert.equal(value.value, members[1]);
    assert.throws(() => value.set(typeof members[0] === "string" ? "missing" : 3));
    assert.equal(value.value, members[1]);
  }
  assert.equal((await compile({ enum: [true, false] })).reflect(false).value, false);
  assert.equal((await compile({ enum: [null] })).reflect(null).value, null);
});

test("JSON Schema local references preserve descriptor reuse and support recursive objects", async () => {
  const runtime = await compile({
    $id: "https://schemas.example.test/tree.json",
    $ref: "#/definitions/node",
    definitions: {
      node: {
        type: "object", required: ["label"], additionalProperties: false,
        properties: {
          label: { $ref: "#/definitions/label" },
          children: { type: "array", items: { $ref: "#/definitions/node" } }
        }
      },
      label: { type: "string", minLength: 1 }
    }
  });
  const descriptor = runtime.descriptor.root as ObjectDescriptor;
  const children = descriptor.field("children")!.type;
  assert.equal(children.kind, "array");
  if (children.kind !== "array") throw new Error("expected array");
  assert.strictEqual(children.element, descriptor);
  const raw = { label: "root", children: [{ label: "child" }] };
  const value = runtime.reflect(raw) as ObjectValue;
  const array = value.get(descriptor.field("children")!) as ArrayValue;
  array.push({ label: "second", children: [] });
  assert.equal(raw.children.length, 2);
  assert.throws(() => array.push({ label: "" }), /JSON Schema validation/);
  assert.equal(raw.children.length, 2);
  assert.throws(() => runtime.reflect({ label: "root", children: [{ children: [] }] }), /required/);
});

test("JSON Schema JSON Pointers decode escaped property names", async () => {
  const runtime = await compile({
    type: "object",
    properties: { first: { $ref: "#/definitions/a~1b~0c" }, second: { $ref: "#/definitions/a~1b~0c" } },
    definitions: { "a/b~c": { type: "string", pattern: "^x" } }
  });
  const descriptor = runtime.descriptor.root as ObjectDescriptor;
  assert.strictEqual(descriptor.field("first")?.type, descriptor.field("second")?.type);
  assert.throws(() => runtime.reflect({ first: "bad" }), /pattern/);
  assert.doesNotThrow(() => runtime.reflect({ first: "xyz", second: "xxx" }));
});

test("JSON Schema rejects external references even when their Runtime is already registered", async () => {
  const dependency = createPlainRuntime({ id: "positive.json", root: { kind: "scalar", scalar: "number" } });
  const dependencies = registry(dependency);
  for (const ref of ["positive.json", "positive.json#", "positive.json#/definitions/value", "https://schemas.example.test/root.json#/definitions/value"]) {
    await assert.rejects(compile({ $id: "https://schemas.example.test/root.json", type: "object",
      properties: { value: { $ref: ref } }, definitions: { value: { type: "string" } } }, dependencies), { code: "MODEL_REFERENCE_UNSUPPORTED" });
  }
  await assert.rejects(compile({ type: "object", properties: { amount: { $ref: "#/default" } },
    default: { $ref: dependency.descriptor.id } }, dependencies), { code: "MODEL_REFERENCE_UNSUPPORTED" });
});

test("JSON Schema prototype-sensitive field names remain own fields and satisfy Ajv constraints", async () => {
  const runtime = await compile(JSON.parse(`{
    "type":"object", "required":["__proto__","constructor","toString"], "additionalProperties":false,
    "properties":{
      "__proto__":{"type":"string","minLength":2},
      "constructor":{"type":"number","minimum":1},
      "toString":{"type":"boolean"}
    }
  }`));
  const raw = JSON.parse('{"__proto__":"ok","constructor":1,"toString":false}');
  const originalPrototype = Object.getPrototypeOf(raw);
  const view = runtime.reflect(raw) as ObjectValue;
  assert.equal([...view].length, 3);
  view.set(view.descriptor.field("__proto__")!, "updated");
  assert.equal(Object.getPrototypeOf(raw), originalPrototype);
  assert.equal(Object.getOwnPropertyDescriptor(raw, "__proto__")!.value, "updated");
  assert.throws(() => view.set(view.descriptor.field("__proto__")!, "x"), /JSON Schema validation/);
  assert.equal(raw.__proto__, "updated");
  const child = view.get(view.descriptor.field("__proto__")!) as ScalarValue;
  assert.throws(() => view.delete(view.descriptor.field("__proto__")!), /required/);
  assert.equal(raw.__proto__, "updated");
  assert.equal(child.value, "updated");
  assert.equal(Object.getPrototypeOf(raw), originalPrototype);
  assert.throws(() => runtime.reflect({}), /required/);
});

test("JSON Schema compilation snapshots definitions, so later caller mutations cannot alter validation", async () => {
  const definition = { type: "object", properties: { count: { type: "number", maximum: 5 } } };
  const runtime = await compile(definition);
  definition.properties.count.maximum = 100;
  definition.properties.count.type = "string";
  assert.throws(() => runtime.reflect({ count: 6 }), /JSON Schema validation/);
  assert.throws(() => runtime.reflect({ count: "1" }));
  assert.deepEqual(runtime.reflect({ count: 5 }).value, { count: 5 });
});

test("JSON Schema never invokes getters or conversion hooks inside opaque descendants", async () => {
  const runtime = await compile({ type: "object", const: { extra: { nested: 1 } } });
  let calls = 0;
  const accessor = { get nested() { calls += 1; return 1; } };
  assert.throws(() => runtime.reflect({ extra: accessor }), /accessors/);
  for (const hook of ["valueOf", "toString", "constructor"]) {
    const extra = { nested: 1, [hook]: () => { calls += 1; return 1; } };
    assert.throws(() => runtime.reflect({ extra }), /functions|callable hooks/);
  }
  const inherited = Object.create({ get nested() { calls += 1; return 1; } });
  assert.throws(() => runtime.reflect({ extra: inherited }), /custom object prototypes/);
  const proxy = new Proxy({ nested: 1 }, { get() { calls += 1; return 1; } });
  assert.throws(() => runtime.reflect({ extra: proxy }), /Proxy/);
  const array = await compile({ type: "array", uniqueItems: true, items: { type: "object" } });
  assert.throws(() => array.reflect([{ extra: accessor }, { extra: { nested: 1 } }]), /accessors/);
  assert.equal(calls, 0);

  const editable = await compile({ type: "object", properties: { payload: { type: "object", const: { extra: { nested: 1 } } } } });
  const originalPayload = { extra: { nested: 1 } };
  const raw = { payload: originalPayload };
  const root = editable.reflect(raw) as ObjectValue;
  const field = root.descriptor.field("payload")!;
  const existingView = root.get(field)!;
  assert.throws(() => root.set(field, { extra: accessor }), /accessors/);
  assert.strictEqual(raw.payload, originalPayload);
  assert.strictEqual(existingView.value, originalPayload);
  assert.equal(calls, 0);
});

test("JSON Schema safety scanning preserves opaque native values and recursive graphs without invoking accessors", async () => {
  const bytes = new Uint8Array([1, 2]);
  const map = new Map([[1n, bytes], [2n, Buffer.from([3, 4])]]);
  const opaque = await compile({ type: "object" });
  const raw = { native: map };
  assert.strictEqual(opaque.reflect(raw).value, raw);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.strictEqual(opaque.reflect(cycle).value, cycle);
  let calls = 0;
  const badMap = new Map([[1n, { get dangerous() { calls += 1; return 1; } }]]);
  assert.throws(() => opaque.reflect({ native: badMap }), /accessors/);
  Object.defineProperty(map, "entries", { get() { calls += 1; return Map.prototype.entries; } });
  assert.throws(() => opaque.reflect({ native: map }), /accessors/);
  assert.equal(calls, 0);
});

test("JSON Schema handles scalar, object-count, and array constraints through Ajv", async () => {
  for (const [schema, good, bad] of [
    [{ type: "number", exclusiveMinimum: 1, exclusiveMaximum: 4, multipleOf: 0.5 }, 2.5, 1],
    [{ type: "number", multipleOf: 2 }, 4, 3],
    [{ type: "string", minLength: 1, maxLength: 2 }, "😀", "abc"],
    [{ type: "string", const: "fixed" }, "fixed", "other"],
    [{ type: "object", minProperties: 1, maxProperties: 2 }, { extra: 1 }, {}],
    [{ type: "array", items: { type: "boolean" }, minItems: 1 }, [true], []]
  ] as const) {
    const runtime = await compile(schema);
    assert.doesNotThrow(() => runtime.reflect(good));
    assert.throws(() => runtime.reflect(bad), /JSON Schema validation/);
  }
  const number = await compile({ type: "number" });
  for (const bad of [NaN, Infinity, -Infinity, "2", undefined]) assert.throws(() => number.reflect(bad));
});

test("JSON Schema rejects unsupported and malformed schemas without pretending to support all Draft-07", async () => {
  const unsupported = [
    true, false, {}, { type: ["string", "null"] },
    { type: "array" }, { type: "array", items: true }, { type: "array", items: [{ type: "string" }] },
    { type: "object", properties: { unrestricted: {} } },
    { type: "object", properties: { forbidden: false } },
    { type: "string", format: "email" }, { type: "object", patternProperties: { x: { type: "string" } } },
    { type: "string", oneOf: [{ type: "string" }] }, { type: "string", anyOf: [{ type: "string" }] },
    { type: "string", allOf: [{ type: "string" }] }, { type: "string", typoConstraint: 1 },
    { enum: [1, "one"] }, { type: "number", enum: [1, "one"] },
    { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" },
    { $id: "relative/schema", type: "string" },
    { type: "object", properties: { nested: { $id: "https://schemas.example.test/nested", type: "string" } } },
    { $ref: "#/definitions/missing" }, { $ref: "#anchor" }, { $ref: "external#/definitions/nested" },
    { $ref: "#" }, { $ref: "#/definitions/self", definitions: { self: { $ref: "#/definitions/self" } } },
    { $ref: "#/definitions/value", maxLength: 3, definitions: { value: { type: "string" } } },
    { type: "string", minLength: -1 }, { type: "string", enum: [] },
    { type: "number", default: Infinity }, { type: "string", default: undefined }
  ];
  for (const schema of unsupported) await assert.rejects(compile(schema), { name: /Error/ }, JSON.stringify(schema));
  const cyclic: Record<string, unknown> = { type: "object" };
  cyclic.properties = { self: cyclic };
  await assert.rejects(compile(cyclic), /cyclic definitions/);
});

test("JSON Schema factory rejects wrong meta-model and honours pre-aborted contexts", async () => {
  const factory = new JsonSchemaModelRuntimeFactory();
  const wrong = model({ type: "string" });
  wrong.data.model = "other-standard";
  await assert.rejects(factory.createRuntime({}, wrong, registry()), /requires model.data.model/);
  const controller = new AbortController();
  const reason = new Error("cancelled before compilation");
  controller.abort(reason);
  await assert.rejects(factory.createRuntime({ signal: controller.signal }, model({ type: "string" }), registry()), error => error === reason);
});
