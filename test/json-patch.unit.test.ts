import assert from "node:assert/strict";
import test from "node:test";
import { applyJsonPatch } from "../src/data/operations/json-patch.js";

test("JSON Patch applies all six operations to one isolated document in order", () => {
  const original = { name: "old", list: ["a", "b"], source: { nested: [1] }, remove: true };
  const patch = [
    { op: "test", path: "/name", value: "old" }, { op: "replace", path: "/name", value: "new" },
    { op: "add", path: "/list/1", value: "inserted" }, { op: "remove", path: "/remove" },
    { op: "copy", from: "/source", path: "/copied" }, { op: "move", from: "/list/0", path: "/last" }
  ];
  const result = applyJsonPatch(original, patch) as any;
  assert.deepEqual(result, { name: "new", list: ["inserted", "b"], source: { nested: [1] }, copied: { nested: [1] }, last: "a" });
  result.copied.nested.push(2);
  assert.deepEqual(result.source, { nested: [1] });
  assert.deepEqual(original, { name: "old", list: ["a", "b"], source: { nested: [1] }, remove: true });
});

test("JSON Patch preserves special object keys as data and decodes Pointer escapes once", () => {
  const document = JSON.parse('{"a/b":1,"~1":2,"":3,"__proto__":{"old":true}}');
  const result = applyJsonPatch(document, [
    { op: "replace", path: "/a~1b", value: 4 }, { op: "replace", path: "/~01", value: 5 },
    { op: "replace", path: "/", value: 6 }, { op: "add", path: "/__proto__/safe", value: true },
    { op: "add", path: "/constructor", value: "data" }
  ]);
  assert.deepEqual(result, JSON.parse('{"a/b":4,"~1":5,"":6,"__proto__":{"old":true,"safe":true},"constructor":"data"}'));
  assert.equal(({} as any).safe, undefined);
  assert.throws(() => applyJsonPatch({}, [{ op: "test", path: "/toString", value: "inherited" }]), { code: "INVALID_PATCH" });
});

test("array edits use RFC positions, append and the post-removal move destination", () => {
  assert.deepEqual(applyJsonPatch(["a", "b", "c"], [{ op: "move", from: "/0", path: "/2" }, { op: "add", path: "/-", value: "d" }]), ["b", "c", "a", "d"]);
  for (const path of ["/01", "/-1", "/1.0", "/9007199254740992", "/4"]) {
    assert.throws(() => applyJsonPatch([1, 2], [{ op: "add", path, value: 3 }]), { code: "INVALID_PATCH" }, path);
  }
  assert.throws(() => applyJsonPatch([1], [{ op: "remove", path: "/-" }]), { code: "INVALID_PATCH" });
  assert.throws(() => applyJsonPatch({ a: {} }, [{ op: "move", from: "/a", path: "/a/nested" }]), { code: "INVALID_PATCH" });
});

test("root replacement supports all JSON types and root removal must end with a document", () => {
  for (const value of [null, true, 5, "text", [1], { kept: true }]) assert.deepEqual(applyJsonPatch({}, [{ op: "replace", path: "", value }]), value);
  assert.deepEqual(applyJsonPatch({}, [{ op: "remove", path: "" }, { op: "add", path: "", value: null }]), null);
  assert.throws(() => applyJsonPatch({}, [{ op: "remove", path: "" }]), { code: "INVALID_PATCH" });
  assert.deepEqual(applyJsonPatch({ value: 1 }, [{ op: "move", from: "", path: "" }]), { value: 1 });
});

test("failed operations leave the original and patch inputs unchanged and locate the failure", () => {
  const original = { count: 1 };
  const patch = [{ op: "replace", path: "/count", value: 2 }, { op: "test", path: "/count", value: 3 }];
  const before = structuredClone(patch);
  assert.throws(() => applyJsonPatch(original, patch), (error: any) => error.code === "PATCH_TEST_FAILED" && error.details.operationIndex === 1);
  assert.deepEqual(original, { count: 1 }); assert.deepEqual(patch, before);
  assert.deepEqual(applyJsonPatch({ a: 1, b: [2] }, [{ op: "test", path: "", value: { b: [2], a: 1 }, ignored: true }]), { a: 1, b: [2] });
  for (const patch of [{ op: "add" }, [{ op: "_get", path: "" }], [{ op: "add", path: "/bad~2", value: 1 }], [{ op: "replace", path: "/missing", value: 1 }], [{ op: "add", path: "/missing/child", value: 1 }], [{ op: "add", path: "/value" }]]) {
    assert.throws(() => applyJsonPatch({}, patch), { code: "INVALID_PATCH" });
  }
});
