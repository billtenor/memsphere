import assert from "node:assert/strict";
import test from "node:test";
import { decodeListCursor, encodeListCursor, paginateItems, parseListLimit, type CursorScope } from "../src/pagination.js";

const scope: CursorScope = { command: "model list", scope: { project: "/project-a" }, filters: { origin: "project" } };

test("list limit defaults to 100 and rejects values outside the integer 1–1000 contract", () => {
  assert.equal(parseListLimit(undefined), 100);
  for (const value of [1, 1000, "1", "1000"]) assert.equal(parseListLimit(value), Number(value));
  for (const value of [0, -1, 1.5, 1001, Infinity, NaN, null, true, "", "1x", "1.5", "1e2", "-1"]) {
    assert.throws(() => parseListLimit(value), { code: "INVALID_ARGUMENT" });
  }
});

test("list pages retain their supplied order and can change limit without losing or repeating entries", () => {
  const values = Array.from({ length: 207 }, (_, index) => `node-${207 - index}`);
  const first = paginateItems(values, {}, scope);
  assert.equal(first.items.length, 100);
  const second = paginateItems(values, { cursor: first.nextCursor, limit: 1 }, scope);
  const last = paginateItems(values, { cursor: second.nextCursor, limit: 1000 }, scope);
  assert.deepEqual([...first.items, ...second.items, ...last.items], values);
  assert.equal(Object.hasOwn(last, "nextCursor"), false);
  assert.deepEqual(paginateItems([], {}, scope), { items: [] });
  assert.deepEqual(paginateItems(values.slice(0, 100), {}, scope), { items: values.slice(0, 100) });
});

test("a cursor is rejected on another command, source, filter or query mode", () => {
  const first = paginateItems([1, 2], { limit: 1 }, scope);
  for (const other of [
    { ...scope, command: "data list" },
    { ...scope, scope: { project: "/project-b" } },
    { ...scope, filters: { origin: "system" } },
    { ...scope, scope: { project: "/project-a", mode: "children" } }
  ]) assert.throws(() => paginateItems([1, 2], { cursor: first.nextCursor }, other), { code: "INVALID_CURSOR" });
});

test("malformed cursors cannot silently restart enumeration, including empty sources", () => {
  const token = paginateItems([1, 2], { limit: 1 }, scope).nextCursor!;
  for (const cursor of ["", "!", `${token}=`, `${token}!`, Buffer.from("{}").toString("base64url")]) {
    assert.throws(() => paginateItems([], { cursor }, scope), { code: "INVALID_CURSOR" });
  }
  for (const position of ["-1", "1.2", "01", "9007199254740992", "opaque-store-token"]) {
    assert.throws(() => paginateItems([], { cursor: encodeListCursor(scope, position) }, scope), { code: "INVALID_CURSOR" });
  }
});

test("Store continuations are wrapped losslessly and equivalent filter objects share a cursor scope", () => {
  const first = { command: "data list", scope: { project: "/project", store: "orders" }, filters: { a: 1, b: 2 } };
  const same = { command: "data list", filters: { b: 2, a: 1 }, scope: { store: "orders", project: "/project" } };
  const token = encodeListCursor(first, "opaque-store-token:中文");
  assert.equal(decodeListCursor(token, same), "opaque-store-token:中文");
  assert.equal(decodeListCursor(undefined, first), undefined);
});
