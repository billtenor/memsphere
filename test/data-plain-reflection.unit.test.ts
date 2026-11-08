import assert from "node:assert/strict";
import test from "node:test";
import type { FieldDescriptor, ObjectDescriptor, ScalarDescriptor, Value } from "../src/data/api/reflection.js";
import { assertPlainValue, createPlainRuntime } from "../src/data/extensions/shared/reflection.js";

const number: ScalarDescriptor = { kind: "scalar", scalar: "number" };
const string: ScalarDescriptor = { kind: "scalar", scalar: "string" };
const fields: FieldDescriptor[] = [];
const object: ObjectDescriptor = { kind: "object", fields, field: name => fields.find(field => field.name === name) };
const quantity: FieldDescriptor = { parent: object, name: "quantity", type: number };
fields.push(quantity);

test("Map reflection rejects overridden operations without invoking user hooks", () => {
  const runtime = createPlainRuntime({ id: "map", root: { kind: "map", key: string, value: number } });
  for (const name of ["get", "set", "has", "delete", "clear", "keys", "values", "entries", "size", Symbol.iterator]) {
    const raw = new Map([["key", 1]]);
    let calls = 0;
    Object.defineProperty(raw, name, { get() { calls += 1; throw new Error("Hook called"); } });
    assert.throws(() => runtime.reflect(raw), /Overridden Map/);
    assert.equal(calls, 0);
  }
});

function scalar(value: Value | undefined) {
  assert.equal(value?.kind, "scalar");
  if (value?.kind !== "scalar") throw new Error("Not a scalar");
  return value;
}

test("plain object views write through, share scalar bindings and reject foreign fields", () => {
  const runtime = createPlainRuntime({ id: "item", root: object });
  const raw = { quantity: 1 };
  const root = runtime.reflect(raw);
  assert.equal(root.kind, "object");
  if (root.kind !== "object") return;
  const first = scalar(root.get(quantity));
  const second = scalar(root.get(quantity));
  first.set(2);
  assert.equal(second.value, 2);
  assert.equal(raw.quantity, 2);
  assert.throws(() => root.get({ ...quantity }), /Foreign/);
  assert.throws(() => first.set("bad"), /number/);
  assert.equal(second.value, 2);
  root.set(quantity, 3);
  assert.throws(() => first.value, /stale/);
  assert.equal(root.delete(quantity), true);
  assert.equal(root.get(quantity), undefined);
  assert.equal(root.has(quantity), false);
});

test("full-root validation rolls back scalar writes and deletion without invalidating views", () => {
  const runtime = createPlainRuntime({ id: "item", root: object }, {
    validate(value) {
      if ((value as { quantity?: number }).quantity !== 1) throw new Error("quantity must remain one");
    }
  });
  const root = runtime.reflect({ quantity: 1 });
  if (root.kind !== "object") throw new Error();
  const child = scalar(root.get(quantity));
  assert.throws(() => child.set(2), /remain one/);
  assert.throws(() => root.delete(quantity), /remain one/);
  assert.deepEqual(root.value, { quantity: 1 });
  assert.equal(child.value, 1);
});

test("array length changes invalidate child views and invalid writes are atomic", () => {
  const runtime = createPlainRuntime({ id: "items", root: { kind: "array", element: number } }, {
    validate(value) { if ((value as number[]).length > 3) throw new Error("too many"); }
  });
  const root = runtime.reflect([1, 2]);
  if (root.kind !== "array") throw new Error();
  const first = scalar(root.get(0));
  const second = scalar(root.get(1));
  root.set(0, 3);
  assert.throws(() => first.value, /stale/);
  assert.equal(second.value, 2);
  root.insert(1, 4);
  assert.throws(() => second.value, /stale/);
  const current = scalar(root.get(0));
  assert.throws(() => root.push(5), /too many/);
  assert.equal(current.value, 3);
  assert.deepEqual(root.value, [3, 4, 2]);
  assert.throws(() => root.set(3, 5), /range/);
  assert.throws(() => root.get(0.5), /integer/);
  root.remove(1);
  assert.deepEqual([...root.values()].map(value => value.value), [3, 2]);
  root.clear();
  assert.deepEqual(root.value, []);
});

test("Map keys preserve object identity and only replaced entries become stale", () => {
  const runtime = createPlainRuntime({ id: "items", root: { kind: "map", key: object, value: number } });
  const key = { quantity: 1 };
  const other = { quantity: 1 };
  const root = runtime.reflect(new Map([[key, 1]]));
  if (root.kind !== "map") throw new Error();
  assert.equal(root.has(other), false);
  assert.strictEqual([...root.keys()][0], key);
  const child = scalar(root.get(key));
  root.set(other, 2);
  assert.equal(child.value, 1);
  child.set(3);
  assert.equal((root.value as Map<unknown, number>).get(key), 3);
  root.delete(other);
  assert.equal(child.value, 3);
  root.set(key, 4);
  assert.throws(() => child.value, /stale/);
  const latest = scalar(root.get(key));
  root.clear();
  assert.throws(() => latest.value, /stale/);
  assert.equal(root.size, 0);
});

test("Map mutation rollback preserves insertion order, values and view validity", () => {
  const raw = new Map([["first", 1], ["second", 2]]);
  const runtime = createPlainRuntime({ id: "map", root: { kind: "map", key: string, value: number } }, {
    validate(value) { if ((value as Map<unknown, unknown>).size !== 2) throw new Error("two entries required"); }
  });
  const root = runtime.reflect(raw);
  if (root.kind !== "map") throw new Error();
  const child = scalar(root.get("first"));
  assert.throws(() => root.delete("first"), /required/);
  assert.throws(() => root.clear(), /required/);
  assert.throws(() => root.set("third", 3), /required/);
  assert.deepEqual([...root.keys()], ["first", "second"]);
  assert.equal(child.value, 1);
  assert.throws(() => root.get(1), /string/);
});

test("Map implements SameValueZero and rejects structural mutation during iteration", () => {
  const runtime = createPlainRuntime({ id: "map", root: { kind: "map", key: number, value: { kind: "scalar", scalar: "null" } } });
  const root = runtime.reflect(new Map());
  if (root.kind !== "map") throw new Error();
  root.set(NaN, null).set(-0, null);
  assert.equal(root.has(NaN), true);
  assert.equal(root.has(0), true);
  assert.equal(scalar(root.get(0)).value, null);
  const iterator = root.entries();
  iterator.next();
  root.set(1, null);
  assert.throws(() => iterator.next(), /changed/);
});

test("byte keys are identities, while root scalars update the held value", () => {
  const bytes: ScalarDescriptor = { kind: "scalar", scalar: "bytes" };
  const key = new Uint8Array([1]);
  const map = createPlainRuntime({ id: "map", root: { kind: "map", key: bytes, value: number } }).reflect(new Map([[key, 1]]));
  if (map.kind !== "map") throw new Error();
  assert.equal(map.has(new Uint8Array([1])), false);
  assert.strictEqual([...map.keys()][0], key);
  const value = scalar(createPlainRuntime({ id: "counter", root: number }).reflect(1));
  value.set(2);
  assert.equal(value.value, 2);
});

test("replacing a parent invalidates descendants; aliases share slot invalidation", () => {
  const pairFields: FieldDescriptor[] = [];
  const pair: ObjectDescriptor = { kind: "object", fields: pairFields, field: name => pairFields.find(f => f.name === name) };
  const left = { parent: pair, name: "left", type: object };
  const right = { parent: pair, name: "right", type: object };
  pairFields.push(left, right);
  const item = { quantity: 1 };
  const root = createPlainRuntime({ id: "pair", root: pair }).reflect({ left: item, right: item });
  if (root.kind !== "object") throw new Error();
  const l = root.get(left), r = root.get(right);
  if (l?.kind !== "object" || r?.kind !== "object") throw new Error();
  const child = scalar(r.get(quantity));
  l.set(quantity, 2);
  assert.throws(() => child.value, /stale/);
  const descendant = scalar(l.get(quantity));
  root.set(left, { quantity: 3 });
  assert.throws(() => descendant.value, /stale/);
});

test("plain reflection never evaluates accessors and rejects sparse or wrapped values", () => {
  let called = false;
  assert.throws(() => assertPlainValue(object, { get quantity() { called = true; return 1; } }), /Accessors/);
  assert.equal(called, false);
  assert.throws(() => assertPlainValue(object, { quantity: undefined }), /number/);
  assert.throws(() => assertPlainValue({ kind: "array", element: number }, new Array(2)), /Sparse/);
  const wrapped = createPlainRuntime({ id: "item", root: object }).reflect({ quantity: 1 });
  assert.throws(() => assertPlainValue(object, wrapped), /raw values/);
});

test("array structural rollback never invokes species or aliases its snapshot", () => {
  const raw = [1, 2];
  let speciesCalls = 0;
  Object.defineProperty(raw, "constructor", {
    value: { [Symbol.species]: function () { speciesCalls += 1; return raw; } }, configurable: true
  });
  const root = createPlainRuntime({ id: "array", root: { kind: "array", element: number } }, {
    validate(value) { if ((value as unknown[]).length !== 2) throw new Error("two items required"); }
  }).reflect(raw);
  if (root.kind !== "array") throw new Error();
  const child = scalar(root.get(0));
  const before = Object.getOwnPropertyDescriptors(raw);
  for (const mutate of [() => root.insert(1, 3), () => root.remove(0), () => root.clear()]) {
    assert.throws(mutate, /two items required/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(raw), before);
    assert.equal(child.value, 1);
  }
  assert.equal(speciesCalls, 0);
});

test("array mutations ignore user methods, constructors and inherited index setters", () => {
  const raw = [1, 2];
  let calls = 0;
  for (const name of ["slice", "splice", "constructor"]) {
    Object.defineProperty(raw, name, {
      configurable: true,
      get() { calls += 1; throw new Error(`must not read ${name}`); }
    });
  }
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, "2", {
    set() { calls += 1; throw new Error("must not invoke inherited setter"); }
  });
  Object.setPrototypeOf(raw, prototype);
  const root = createPlainRuntime({ id: "array", root: { kind: "array", element: number } }).reflect(raw);
  if (root.kind !== "array") throw new Error();
  root.insert(1, 3);
  assert.deepEqual([...root.values()].map(value => value.value), [1, 3, 2]);
  root.remove(0);
  assert.deepEqual([...root.values()].map(value => value.value), [3, 2]);
  root.clear();
  assert.equal(root.length, 0);
  assert.equal(calls, 0);
});

test("readonly and nonextensible arrays reject structural writes before changing slots", () => {
  const arrays: number[][] = [
    Object.freeze([1, 2]) as unknown as number[],
    Object.preventExtensions([1, 2]),
    Object.defineProperty([1, 2], "length", { writable: false }),
    Object.defineProperty([1, 2], "1", { writable: false }),
    Object.defineProperty([1, 2], "1", { configurable: false }),
    Object.defineProperty([1, 2], "1", { enumerable: false })
  ];
  for (const raw of arrays) {
    const root = createPlainRuntime({ id: "array", root: { kind: "array", element: number } }).reflect(raw);
    if (root.kind !== "array") throw new Error();
    const child = scalar(root.get(0));
    const before = Object.getOwnPropertyDescriptors(raw);
    for (const mutate of [() => root.insert(0, 3), () => root.remove(0), () => root.clear()]) {
      assert.throws(mutate, TypeError);
      assert.deepEqual(Object.getOwnPropertyDescriptors(raw), before);
      assert.equal(child.value, 1);
    }
  }
});

test("array write errors restore already changed slots without invalidating views", () => {
  const raw = [1, 2, 3];
  let rejectOnce = true;
  const proxy = new Proxy(raw, {
    defineProperty(target, key, property) {
      if (key === "1" && rejectOnce) {
        rejectOnce = false;
        throw new Error("array write rejected");
      }
      return Reflect.defineProperty(target, key, property);
    }
  });
  const root = createPlainRuntime({ id: "array", root: { kind: "array", element: number } }).reflect(proxy);
  if (root.kind !== "array") throw new Error();
  const child = scalar(root.get(0));
  const before = Object.getOwnPropertyDescriptors(raw);
  assert.throws(() => root.insert(0, 0), /array write rejected/);
  assert.deepEqual(Object.getOwnPropertyDescriptors(raw), before);
  assert.equal(child.value, 1);
  root.insert(0, 0);
  assert.deepEqual(raw, [0, 1, 2, 3]);
  assert.throws(() => child.value, /stale/);
});

test("array iterators detect shortening past their current position", () => {
  for (const operation of ["clear", "remove"] as const) {
    const root = createPlainRuntime({ id: "array", root: { kind: "array", element: number } }).reflect([1]);
    if (root.kind !== "array") throw new Error();
    const iterator = root.entries();
    assert.equal(iterator.next().value?.[0], 0);
    if (operation === "clear") root.clear(); else root.remove(0);
    assert.throws(() => iterator.next(), /changed/);
  }
});
