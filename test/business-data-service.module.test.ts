import assert from "node:assert/strict";
import test from "node:test";
import { businessDataModule } from "./helpers/business-data-module.js";
import { objectSchema } from "./helpers/business-data.js";

const roots = [
  ["null", { type: "null" }, null, null], ["boolean", { type: "boolean" }, false, true],
  ["number", { type: "number" }, 0, 2.5], ["string", { type: "string" }, "", "changed"],
  ["array", { type: "array", items: { type: "integer" } }, [], [1, 2]],
  ["object", { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false }, { value: 1 }, { value: 2 }]
] as const;

for (const [name, schema, initial, changed] of roots) test(`business operations preserve ${name} roots through validation, CRUD and export`, async () => {
  const { service: s, root, modelRef, exported } = await businessDataModule(schema);
  assert.equal((await s.validateData({}, root, { modelRef, value: initial, hasValue: true })).valid, true);
  assert.equal((await s.writeData({}, root, "records", "item", "create", { kind: "value", value: initial })).revision, 1);
  assert.deepEqual((await s.readData({}, root, "records", "item")).value, initial);
  assert.equal((await s.writeData({}, root, "records", "item", "update", { kind: "value", value: changed }, { expectedRevision: 1 })).revision, 2);
  assert.deepEqual((await s.readData({}, root, "records", "item")).value, changed);
  const receipt = await s.exportData({}, root, "records", "item", "json", "export.json");
  assert.equal(receipt?.bytes, exported.get("export.json")!.byteLength);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(exported.get("export.json"))), changed);
  assert.equal((await s.validateData({}, root, { id: "item", storeId: "records" })).valid, true);
  assert.deepEqual(await s.listData({}, root, "records"), { items: [{ id: "item" }] });
  assert.equal((await s.hasData({}, root, "records", "item")).exists, true);
  assert.equal((await s.deleteData({}, root, "records", "item", { expectedRevision: 2 })).deleted, true);
  assert.equal((await s.deleteData({}, root, "records", "item")).deleted, false);
  await assert.rejects(s.readData({}, root, "records", "item"), { code: "NOT_FOUND" });
});

test("business edits apply final-value validation and reject failed patches without changing value or revision", async () => {
  const { service: s, root } = await businessDataModule(objectSchema);
  const input = { kind: "value" as const, value: { name: "before", count: 1 } };
  await s.writeData({}, root, "records", "item", "create", input);
  await s.editData({}, root, "records", "item", [{ op: "remove", path: "/name" }, { op: "add", path: "/name", value: "after" }]);
  const before = await s.readData({}, root, "records", "item");
  assert.equal(before.revision, 2); assert.deepEqual(before.value, { name: "after", count: 1 });
  for (const patch of [
    [{ op: "replace", path: "/count", value: 4 }, { op: "test", path: "/name", value: "wrong" }],
    [{ op: "replace", path: "/count", value: -1 }], [{ op: "remove", path: "/name" }]
  ]) {
    await assert.rejects(s.editData({}, root, "records", "item", patch));
    assert.deepEqual(await s.readData({}, root, "records", "item"), before);
  }
  await assert.rejects(s.editData({}, root, "records", "item", [], { expectedRevision: 1 }), { code: "REVISION_CONFLICT" });
  await assert.rejects(s.writeData({}, root, "records", "item", "update", input, { expectedRevision: 1 }), { code: "REVISION_CONFLICT" });
  await s.upsertData({}, root, "records", "item", input);
  assert.equal((await s.readData({}, root, "records", "item")).revision, 3);
});

test("business queries forward JSONPath and distinguish missing records, empty matches, null and array values", async () => {
  const { service: s, root } = await businessDataModule({ type: "object", properties: { nil: { type: "null" }, values: { type: "array", items: { type: "integer" } } } });
  await s.writeData({}, root, "records", "item", "create", { kind: "value", value: { nil: null, values: [1, 2] } });
  for (const [path, expected] of [["$.missing", []], ["$.nil", [null]], ["$.values", [[1, 2]]]] as const)
    assert.deepEqual((await s.readData({}, root, "records", "item", { path })).value, expected);
  await assert.rejects(s.readData({}, root, "records", "absent", { path: "$.missing" }), { code: "NOT_FOUND" });
  await assert.rejects(s.readData({}, root, "records", "item", { metadataOnly: true, path: "$" }), { code: "INVALID_ARGUMENT" });
});

test("business pagination forwards Store continuations and binds cursors to the selected Store", async () => {
  const { service: s, root } = await businessDataModule(objectSchema);
  for (const id of ["c", "a", "b"]) await s.writeData({}, root, "records", id, "create", { kind: "value", value: { name: id, count: 0 } });
  const page = await s.listData({}, root, "records", { limit: 1 });
  assert.deepEqual(page.items, [{ id: "a" }]); assert.ok(page.nextCursor);
  assert.deepEqual(await s.listData({}, root, "records", { limit: 2, cursor: page.nextCursor }), { items: [{ id: "b" }, { id: "c" }] });
  await assert.rejects(s.listData({}, root, "other", { cursor: page.nextCursor }), { code: "INVALID_CURSOR" });
});

test("business dry-run composes validation without publishing and model conflicts reject before export", async () => {
  const f = await businessDataModule(objectSchema), s = f.service;
  const input = { kind: "value" as const, value: { name: "original", count: 1 } };
  await s.writeData({}, f.root, "records", "item", "create", input, { dryRun: true });
  assert.equal((await s.hasData({}, f.root, "records", "item")).exists, false);
  await s.writeData({}, f.root, "records", "item", "create", input);
  await s.deleteData({}, f.root, "records", "item", { dryRun: true });
  assert.equal((await s.readData({}, f.root, "records", "item")).revision, 1);
  f.changeModel();
  await assert.rejects(s.exportData({}, f.root, "records", "item", "json", "blocked.json"), { code: "MODEL_READ_CONFLICT" });
  assert.equal(f.exported.size, 0);
});

test("raw business Store composes JSON decoding while rejecting unsupported conditional writes", async () => {
  const { service: s, root } = await businessDataModule(objectSchema, "data");
  const input = { kind: "value" as const, value: { name: "raw", count: 1 } };
  await s.writeData({}, root, "records", "item.json", "create", input);
  assert.deepEqual((await s.readData({}, root, "records", "item.json")).value, input.value);
  await assert.rejects(s.writeData({}, root, "records", "item.json", "update", input, { expectedRevision: 1 }), { code: "UNSUPPORTED_CAPABILITY" });
  await assert.rejects(s.editData({}, root, "records", "item.json", []), { code: "UNSUPPORTED_CAPABILITY" });
});
