import assert from "node:assert/strict";
import test from "node:test";
import { queryJsonPath } from "../src/data/operations/json-path.js";

test("JSONPath always returns a nodelist and preserves null, nested arrays, duplicates and selector order", () => {
  const document = { nothing: null, items: [1, 2], "a/b": "slash", "~": "tilde", "": false };
  assert.deepEqual(queryJsonPath(document, "$"), [document]);
  assert.deepEqual(queryJsonPath(document, "$.missing"), []);
  assert.deepEqual(queryJsonPath(document, "$.nothing"), [null]);
  assert.deepEqual(queryJsonPath(document, "$.items"), [[1, 2]]);
  assert.deepEqual(queryJsonPath(document, "$['a/b','~','','a/b']"), ["slash", "tilde", false, "slash"]);
  assert.deepEqual(queryJsonPath([0, 1, 2], "$[2,0,2]"), [2, 0, 2]);
});

test("JSONPath supports negative indices, slices, recursive descent and filters within one document", () => {
  assert.deepEqual(queryJsonPath([0, 1, 2, 3, 4], "$[-1]"), [4]);
  assert.deepEqual(queryJsonPath([0, 1, 2, 3, 4], "$[1:5:2]"), [1, 3]);
  assert.deepEqual(queryJsonPath([0, 1, 2], "$[::-1]"), [2, 1, 0]);
  assert.deepEqual(queryJsonPath({ amount: 1, children: [{ amount: 2 }, { deeper: { amount: 3 } }] }, "$..amount"), [1, 2, 3]);
  assert.deepEqual(queryJsonPath([{ n: 1 }, { n: 3 }, { missing: true }], "$[?@.n > 1].n"), [3]);
});

test("JSONPath exposes the five RFC standard functions with their standard result meanings", () => {
  const rows = [{ text: "abc", tags: ["x", "y"] }, { text: "zabc", tags: ["z"] }];
  assert.deepEqual(queryJsonPath(rows, "$[?length(@.text) == 3].text"), ["abc"]);
  assert.deepEqual(queryJsonPath(rows, "$[?count(@.tags[*]) == 2].text"), ["abc"]);
  assert.deepEqual(queryJsonPath(rows, "$[?match(@.text, 'a.*')].text"), ["abc"]);
  assert.deepEqual(queryJsonPath(rows, "$[?search(@.text, 'abc')].text"), ["abc", "zabc"]);
  assert.deepEqual(queryJsonPath(rows, "$[?value(@.tags[0]) == 'x'].text"), ["abc"]);
});

test("JSONPath rejects Pointer syntax, malformed expressions and JavaScript extensions", () => {
  for (const path of ["/name", "", "$[", "$[?@.n = 1]", "$[?@.n.toString()]", "$[?(process.exit())]"]) {
    assert.throws(() => queryJsonPath({ n: 1 }, path), { code: "INVALID_PATH" }, path);
  }
  for (const value of [undefined, { n: 1n }, { n: Infinity }, new Uint8Array([1])]) assert.throws(() => queryJsonPath(value, "$"));
});
