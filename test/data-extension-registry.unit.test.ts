import assert from "node:assert/strict";
import test from "node:test";
import type { DataStoreFactory } from "../src/data/api/data-store.js";
import type { DataExtension } from "../src/data/api/extension.js";
import type { ModelRuntimeFactory, ModelRuntimeFactoryTarget } from "../src/data/api/model-runtime.js";
import type { PayloadSerializer } from "../src/data/api/serializer.js";
import type { ValueStoreFactory } from "../src/data/api/value-store.js";
import { DefaultDataExtensionRegistry } from "../src/data/management/extension-registry.js";

function serializer(id = "json", contentType = "application/json"): PayloadSerializer {
  return {
    id,
    contentType,
    async deserialize() { throw new Error("Registration must not deserialize"); },
    async serialize() { throw new Error("Registration must not serialize"); }
  };
}

function runtimeFactory(target: ModelRuntimeFactoryTarget): ModelRuntimeFactory {
  return { target, async createRuntime() { throw new Error("Registration must not create a runtime"); } };
}

function dataFactory(id: string): DataStoreFactory {
  return { id, async createStore() { throw new Error("Registration must not create a data store"); } };
}

function valueFactory(id: string): ValueStoreFactory {
  return { id, async createStore() { throw new Error("Registration must not create a value store"); } };
}

function extension(id: string, capabilities: Partial<DataExtension> = {}): DataExtension {
  return { id, version: "1.0.0", ...capabilities };
}

test("extension registry is empty by default and missing capabilities return undefined", () => {
  const registry = new DefaultDataExtensionRegistry();
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.get("missing"), undefined);
  assert.equal(registry.getPayloadSerializer("application/unknown"), undefined);
  assert.equal(registry.getModelRuntimeFactory({ model: "missing" }), undefined);
  assert.equal(registry.getModelRuntimeFactory({ metaModel: "missing" }), undefined);
  assert.equal(registry.getDataStoreFactory("missing"), undefined);
  assert.equal(registry.getValueStoreFactory("missing"), undefined);
});

test("extension registry preserves independent capability namespaces without invoking factories", () => {
  const payload = serializer();
  const direct = runtimeFactory({ model: "same-ref" });
  const meta = runtimeFactory({ metaModel: "same-ref" });
  const data = dataFactory("same-store");
  const value = valueFactory("same-store");
  const registry = new DefaultDataExtensionRegistry([extension("first", {
    payloadSerializers: [payload],
    modelRuntimeFactories: [direct, meta],
    dataStoreFactories: [data],
    valueStoreFactories: [value]
  })]);
  const secondPayload = serializer("json", "application/example+json");
  registry.register(extension("second", { payloadSerializers: [secondPayload] }));

  assert.equal(registry.getPayloadSerializer("application/json"), payload);
  assert.equal(registry.getPayloadSerializer("application/example+json"), secondPayload);
  assert.equal(registry.getModelRuntimeFactory({ model: "same-ref" }), direct);
  assert.equal(registry.getModelRuntimeFactory({ metaModel: "same-ref" }), meta);
  assert.equal(registry.getDataStoreFactory("same-store"), data);
  assert.equal(registry.getValueStoreFactory("same-store"), value);
  assert.deepEqual(registry.list().map(item => item.id), ["first", "second"]);
});

test("runtime factory lookup is exact and never falls back between target kinds", () => {
  const direct = runtimeFactory({ model: "direct-only" });
  const meta = runtimeFactory({ metaModel: "meta-only" });
  const registry = new DefaultDataExtensionRegistry([extension("runtimes", { modelRuntimeFactories: [direct, meta] })]);
  assert.equal(registry.getModelRuntimeFactory({ model: "direct-only" }), direct);
  assert.equal(registry.getModelRuntimeFactory({ metaModel: "direct-only" }), undefined);
  assert.equal(registry.getModelRuntimeFactory({ model: "meta-only" }), undefined);
  assert.equal(registry.getModelRuntimeFactory({ metaModel: "meta-only" }), meta);
});

test("duplicate extension IDs reject both same-version and different-version replacement", () => {
  const original = extension("stable", { payloadSerializers: [serializer()] });
  const registry = new DefaultDataExtensionRegistry([original]);
  for (const version of ["1.0.0", "2.0.0"]) {
    assert.throws(() => registry.register(extension("stable", {
      version,
      dataStoreFactories: [dataFactory("not-published")]
    })), /stable.*already registered.*1\.0\.0/);
    assert.equal(registry.get("stable")?.version, "1.0.0");
    assert.equal(registry.getDataStoreFactory("not-published"), undefined);
    assert.equal(registry.list().length, 1);
  }
});

test("every cross-extension and within-extension conflict leaves all registration maps unchanged", () => {
  const seed = extension("seed", {
    payloadSerializers: [serializer("seed", "application/seed")],
    modelRuntimeFactories: [runtimeFactory({ model: "seed" }), runtimeFactory({ metaModel: "seed" })],
    dataStoreFactories: [dataFactory("seed")],
    valueStoreFactories: [valueFactory("seed")]
  });
  const cases: Array<[string, Partial<DataExtension>]> = [
    ["duplicate serializer ID", { payloadSerializers: [serializer("duplicate", "application/one"), serializer("duplicate", "application/two")] }],
    ["duplicate MIME in extension", { payloadSerializers: [serializer("one", "application/one"), serializer("two", "Application/ONE")] }],
    ["existing MIME", { payloadSerializers: [serializer("fresh", "application/fresh"), serializer("different-id", "application/seed")] }],
    ["duplicate model", { modelRuntimeFactories: [runtimeFactory({ model: "fresh" }), runtimeFactory({ model: "fresh" })] }],
    ["existing model", { modelRuntimeFactories: [runtimeFactory({ model: "fresh" }), runtimeFactory({ model: "seed" })] }],
    ["duplicate metaModel", { modelRuntimeFactories: [runtimeFactory({ metaModel: "fresh" }), runtimeFactory({ metaModel: "fresh" })] }],
    ["existing metaModel", { modelRuntimeFactories: [runtimeFactory({ metaModel: "fresh" }), runtimeFactory({ metaModel: "seed" })] }],
    ["duplicate data store", { dataStoreFactories: [dataFactory("fresh"), dataFactory("fresh")] }],
    ["existing data store", { dataStoreFactories: [dataFactory("fresh"), dataFactory("seed")] }],
    ["duplicate value store", { valueStoreFactories: [valueFactory("fresh"), valueFactory("fresh")] }],
    ["existing value store", { valueStoreFactories: [valueFactory("fresh"), valueFactory("seed")] }]
  ];

  for (const [label, conflicting] of cases) {
    const registry = new DefaultDataExtensionRegistry([seed]);
    const candidate = extension("candidate", {
      payloadSerializers: [serializer("fresh", "application/fresh")],
      modelRuntimeFactories: [runtimeFactory({ model: "fresh" }), runtimeFactory({ metaModel: "fresh" })],
      dataStoreFactories: [dataFactory("fresh")],
      valueStoreFactories: [valueFactory("fresh")],
      ...conflicting
    });
    assert.throws(() => registry.register(candidate), /already registered|Duplicate serializer ID/, label);
    assert.deepEqual(registry.list().map(item => item.id), ["seed"], label);
    assert.equal(registry.get("candidate"), undefined, label);
    for (const contentType of ["application/fresh", "application/one", "application/two"]) {
      assert.equal(registry.getPayloadSerializer(contentType), undefined, label);
    }
    assert.equal(registry.getModelRuntimeFactory({ model: "fresh" }), undefined, label);
    assert.equal(registry.getModelRuntimeFactory({ metaModel: "fresh" }), undefined, label);
    assert.equal(registry.getDataStoreFactory("fresh"), undefined, label);
    assert.equal(registry.getValueStoreFactory("fresh"), undefined, label);
    assert.equal(registry.getPayloadSerializer("application/seed"), seed.payloadSerializers![0], label);
    assert.equal(registry.getDataStoreFactory("seed"), seed.dataStoreFactories![0], label);
    assert.equal(registry.getValueStoreFactory("seed"), seed.valueStoreFactories![0], label);
    // A failed registration must not reserve the extension ID either.
    registry.register(extension("candidate"));
  }
});

test("metadata and array snapshots resist mutation without freezing caller-owned capabilities", () => {
  const payload = serializer();
  const direct = runtimeFactory({ model: "model" });
  const data = dataFactory("data");
  const value = valueFactory("value");
  const source = {
    id: "snapshot", version: "1.0.0",
    payloadSerializers: [payload], modelRuntimeFactories: [direct],
    dataStoreFactories: [data], valueStoreFactories: [value]
  };
  const registry = new DefaultDataExtensionRegistry([source]);
  const before = registry.list();
  const snapshot = registry.get("snapshot")!;
  assert.notEqual(snapshot, source);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.payloadSerializers), false);
  assert.equal(Object.isFrozen(payload), false);
  assert.equal(Object.isFrozen(direct), false);
  assert.equal(Object.isFrozen(direct.target), false);
  source.id = "changed";
  source.version = "changed";
  source.payloadSerializers.length = 0;
  source.modelRuntimeFactories.length = 0;
  source.dataStoreFactories.length = 0;
  source.valueStoreFactories.length = 0;
  assert.equal(snapshot.id, "snapshot");
  assert.equal(snapshot.version, "1.0.0");
  assert.deepEqual(snapshot.payloadSerializers, [payload]);
  assert.deepEqual(snapshot.modelRuntimeFactories, [direct]);
  assert.deepEqual(snapshot.dataStoreFactories, [data]);
  assert.deepEqual(snapshot.valueStoreFactories, [value]);
  assert.equal(Reflect.set(snapshot, "id", "corrupt"), false);
  assert.equal(Reflect.set(snapshot, "version", "corrupt"), false);
  assert.equal(Reflect.set(snapshot, "payloadSerializers", []), false);
  for (const array of [before, snapshot.payloadSerializers!, snapshot.modelRuntimeFactories!, snapshot.dataStoreFactories!, snapshot.valueStoreFactories!]) {
    assert.equal(Object.isFrozen(array), true);
    assert.equal(Reflect.set(array, "length", 0), false);
  }
  registry.register(extension("later"));
  assert.equal(before.length, 1);
  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("changed"), undefined);
  assert.equal(registry.getPayloadSerializer("application/json"), payload);
  assert.equal(registry.getModelRuntimeFactory({ model: "model" }), direct);
  assert.equal(registry.getDataStoreFactory("data"), data);
  assert.equal(registry.getValueStoreFactory("value"), value);
});

test("capability methods retain their original receiver and private state", async () => {
  const payloadContent = { stream: () => new ReadableStream<Uint8Array>() };
  class StatefulSerializer implements PayloadSerializer {
    readonly id = "stateful";
    readonly contentType = "application/stateful";
    #value = "private value";
    async deserialize(..._args: Parameters<PayloadSerializer["deserialize"]>) { return this.#value; }
    async serialize(..._args: Parameters<PayloadSerializer["serialize"]>) {
      assert.equal(this.#value, "private value");
      return payloadContent;
    }
  }
  class StatefulRuntimeFactory implements ModelRuntimeFactory {
    readonly target = { model: "stateful" };
    #called = false;
    async createRuntime(..._args: Parameters<ModelRuntimeFactory["createRuntime"]>): Promise<never> {
      this.#called = true;
      throw new Error("runtime called");
    }
    get called() { return this.#called; }
  }
  const payload = new StatefulSerializer();
  const factory = new StatefulRuntimeFactory();
  const registry = new DefaultDataExtensionRegistry([extension("stateful", {
    payloadSerializers: [payload], modelRuntimeFactories: [factory]
  })]);
  assert.equal(factory.called, false);
  const registeredPayload = registry.getPayloadSerializer(payload.contentType)!;
  const registeredFactory = registry.getModelRuntimeFactory(factory.target)!;
  assert.equal(registeredPayload, payload);
  assert.equal(registeredPayload.serialize, payload.serialize);
  assert.equal(registeredFactory, factory);
  assert.equal(registeredFactory.createRuntime, factory.createRuntime);
  const descriptor = { id: "stateful", root: { kind: "scalar", scalar: "string" } } as const;
  assert.equal(await registeredPayload.deserialize({}, descriptor, payloadContent), "private value");
  assert.equal(await registeredPayload.serialize({}, descriptor, "value"), payloadContent);
  await assert.rejects(registeredFactory.createRuntime({}, {} as never, {} as never), /runtime called/);
  assert.equal(factory.called, true);
});

test("MIME matching normalizes case, parameter order, and equivalent quoted syntax", () => {
  const payload = serializer("mime", 'Application/EXAMPLE; Profile="https://example.test/a;b"; Version="One"');
  const registry = new DefaultDataExtensionRegistry([extension("mime", { payloadSerializers: [payload] })]);
  assert.equal(registry.getPayloadSerializer(' application/example ; version=One; PROFILE="https://example.test/a;b" '), payload);
  assert.equal(registry.getPayloadSerializer('application/example;version="O\\ne";profile="https://example.test/a;b"'), payload);
  assert.throws(() => registry.register(extension("collision", {
    payloadSerializers: [serializer("other", 'application/example;version=One;profile="https://example.test/a;b"')]
  })), /already registered/);
  assert.equal(registry.getPayloadSerializer('application/example;version=one;profile="https://example.test/a;b"'), undefined);
  assert.equal(registry.getPayloadSerializer('application/example;profile="https://example.test/a;b"'), undefined);
  assert.equal(registry.getPayloadSerializer('application/example;version=One;profile="https://example.test/different"'), undefined);
});

test("MIME matching preserves every parameter, including charset and empty quoted values", () => {
  const bare = serializer("bare", "application/json");
  const lower = serializer("lower", "application/json;charset=utf-8");
  const upper = serializer("upper", "application/json;charset=UTF-8");
  const empty = serializer("empty", 'application/json;profile=""');
  const registry = new DefaultDataExtensionRegistry([extension("mime", { payloadSerializers: [bare, lower, upper, empty] })]);
  assert.equal(registry.getPayloadSerializer("Application/JSON"), bare);
  assert.equal(registry.getPayloadSerializer('application/json;CHARSET="utf-8"'), lower);
  assert.equal(registry.getPayloadSerializer("application/json;charset=UTF-8"), upper);
  assert.equal(registry.getPayloadSerializer('application/json;profile=""'), empty);
  assert.equal(registry.getPayloadSerializer("application/json;charset=latin1"), undefined);
  assert.equal(registry.getPayloadSerializer("application/json;version=1"), undefined);
});

test("malformed and ambiguous MIME parameters are rejected at registration and lookup", () => {
  for (const contentType of [
    "", "json", "application/", "application/json;", "application/json;broken", "application/json;profile=",
    "application/json;profile =one", "application/json;profile=two words", 'application/json;profile="unterminated',
    'application/json;profile="valid"garbage', "application/json;;version=1", "application/json;version=1;VERSION=2",
    "application/json;version=1;version=1", "application/json\n", 'application/json;profile="line\nfeed"'
  ]) {
    const registry = new DefaultDataExtensionRegistry();
    assert.throws(() => registry.register(extension("bad", { payloadSerializers: [serializer("bad", contentType)] })), TypeError, contentType);
    assert.throws(() => registry.getPayloadSerializer(contentType), TypeError, contentType);
    assert.deepEqual(registry.list(), [], contentType);
  }
});

test("runtime factory targets require exactly one own nonempty discriminant", () => {
  const invalidTargets = [
    null, [], {}, { model: "" }, { model: " " }, { model: 1 }, { metaModel: undefined },
    { model: "a", metaModel: "b" }, { model: "a", metaModel: undefined },
    Object.create({ model: "inherited" }), Object.assign(Object.create({ metaModel: "inherited" }), { model: "own" })
  ];
  for (const target of invalidTargets) {
    const registry = new DefaultDataExtensionRegistry();
    const typed = target as ModelRuntimeFactoryTarget;
    assert.throws(() => registry.register(extension("invalid", { modelRuntimeFactories: [runtimeFactory(typed)] })), TypeError);
    assert.throws(() => registry.getModelRuntimeFactory(typed), TypeError);
    assert.equal(registry.get("invalid"), undefined);
  }
});

test("practical runtime shape validation rejects malformed metadata and incomplete capabilities atomically", () => {
  const invalidExtensions: unknown[] = [
    null, [], {}, { id: "", version: "1" }, { id: "x", version: "" }, { id: "x", version: 1 },
    extension("bad", { payloadSerializers: {} as never }),
    extension("bad", { modelRuntimeFactories: {} as never }),
    extension("bad", { dataStoreFactories: {} as never }),
    extension("bad", { valueStoreFactories: {} as never }),
    extension("bad", { payloadSerializers: [null as never] }),
    extension("bad", { payloadSerializers: [{ ...serializer(), id: "" }] }),
    extension("bad", { payloadSerializers: [{ ...serializer(), contentType: 42 as never }] }),
    extension("bad", { payloadSerializers: [{ ...serializer(), deserialize: undefined as never }] }),
    extension("bad", { payloadSerializers: [{ ...serializer(), serialize: undefined as never }] }),
    extension("bad", { modelRuntimeFactories: [null as never] }),
    extension("bad", { modelRuntimeFactories: [{ target: { model: "x" } } as never] }),
    extension("bad", { dataStoreFactories: [null as never] }),
    extension("bad", { dataStoreFactories: [{ ...dataFactory("x"), id: "" }] }),
    extension("bad", { dataStoreFactories: [{ id: "x" } as never] }),
    extension("bad", { valueStoreFactories: [null as never] }),
    extension("bad", { valueStoreFactories: [{ ...valueFactory("x"), id: 1 as never }] }),
    extension("bad", { payloadSerializers: [serializer()], valueStoreFactories: [{ id: "x" } as never] })
  ];
  for (const invalid of invalidExtensions) {
    const registry = new DefaultDataExtensionRegistry();
    assert.throws(() => registry.register(invalid as DataExtension), TypeError);
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.getPayloadSerializer("application/json"), undefined);
  }
  assert.throws(() => new DefaultDataExtensionRegistry({} as never), TypeError);
});
