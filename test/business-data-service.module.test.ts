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

for (const [name, schema, initial, changed] of roots) {
  test(`business candidate validation accepts a ${name} root`, async () => {
    const { service: s, root, modelRef } = await businessDataModule(schema);
    assert.equal((await s.validateData({}, root, { modelRef, value: initial, hasValue: true })).valid, true);
  });
  test(`business create/read preserves a ${name} root and its initial revision`, async () => {
    const { service: s, root } = await businessDataModule(schema);
    assert.equal((await s.writeData({}, root, "records", "item", "create", { kind: "value", value: initial })).revision, 1);
    assert.deepEqual((await s.readData({}, root, "records", "item")).value, initial);
  });
  test(`business update/read preserves a ${name} root and advances its revision`, async () => {
    const { service: s, root, seedValue } = await businessDataModule(schema);
    await seedValue("item", initial);
    assert.equal((await s.writeData({}, root, "records", "item", "update", { kind: "value", value: changed }, { expectedRevision: 1 })).revision, 2);
    assert.deepEqual((await s.readData({}, root, "records", "item")).value, changed);
  });
  test(`business export serializes a ${name} root as complete JSON`, async () => {
    const { service: s, root, seedValue, exported } = await businessDataModule(schema);
    await seedValue("item", changed);
    const receipt = await s.exportData({}, root, "records", "item", "json", "export.json");
    assert.equal(receipt?.bytes, exported.get("export.json")!.byteLength);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(exported.get("export.json"))), changed);
  });
  test(`business stored-value validation accepts a ${name} root`, async () => {
    const { service: s, root, seedValue } = await businessDataModule(schema);
    await seedValue("item", changed);
    assert.equal((await s.validateData({}, root, { id: "item", storeId: "records" })).valid, true);
  });
  test(`business list enumerates a record containing a ${name} root`, async () => {
    const { service: s, root, seedValue } = await businessDataModule(schema);
    await seedValue("item", initial);
    assert.deepEqual(await s.listData({}, root, "records"), { items: [{ id: "item" }] });
  });
  test(`business has finds a record containing a ${name} root`, async () => {
    const { service: s, root, seedValue } = await businessDataModule(schema);
    await seedValue("item", initial);
    assert.equal((await s.hasData({}, root, "records", "item")).exists, true);
  });
  test(`business delete removes a record containing a ${name} root`, async () => {
    const { service: s, root, seedValue } = await businessDataModule(schema);
    await seedValue("item", initial);
    assert.equal((await s.deleteData({}, root, "records", "item", { expectedRevision: 1 })).deleted, true);
    await assert.rejects(s.readData({}, root, "records", "item"), { code: "NOT_FOUND" });
  });
}

test("business delete reports false for a record already removed", async () => {
  const { service: s, root, seedValue } = await businessDataModule(objectSchema);
  await seedValue("item", { name: "delete", count: 1 });
  await s.deleteData({}, root, "records", "item");
  assert.equal((await s.deleteData({}, root, "records", "item")).deleted, false);
});

async function existingBusinessItem() {
  const f = await businessDataModule(objectSchema);
  const input = { kind: "value" as const, value: { name: "before", count: 1 } };
  await f.seedValue("item", input.value);
  return { ...f, input };
}

test("business edits validate the final complete value rather than intermediate patch states", async () => {
  const { service: s, root } = await existingBusinessItem();
  await s.editData({}, root, "records", "item", [{ op: "remove", path: "/name" }, { op: "add", path: "/name", value: "after" }]);
  const after = await s.readData({}, root, "records", "item");
  assert.equal(after.revision, 2);
  assert.deepEqual(after.value, { name: "after", count: 1 });
});

test("failed business patches preserve the complete value and revision", async () => {
  const { service: s, root } = await existingBusinessItem();
  const before = await s.readData({}, root, "records", "item");
  for (const patch of [
    [{ op: "replace", path: "/count", value: 4 }, { op: "test", path: "/name", value: "wrong" }],
    [{ op: "replace", path: "/count", value: -1 }], [{ op: "remove", path: "/name" }]
  ]) {
    await assert.rejects(s.editData({}, root, "records", "item", patch));
    assert.deepEqual(await s.readData({}, root, "records", "item"), before);
  }
});

for (const operation of ["edit", "update"] as const) test(`business ${operation} forwards revision conflicts without changing the record`, async () => {
  const { service: s, root, input } = await existingBusinessItem();
  await s.upsertData({}, root, "records", "item", input);
  const before = await s.readData({}, root, "records", "item");
  const stale = { expectedRevision: 1 };
  await assert.rejects(operation === "edit"
    ? s.editData({}, root, "records", "item", [], stale)
    : s.writeData({}, root, "records", "item", "update", input, stale), { code: "REVISION_CONFLICT" });
  assert.deepEqual(await s.readData({}, root, "records", "item"), before);
});

test("business upsert replaces an existing complete value and advances its revision", async () => {
  const { service: s, root, seedValue } = await businessDataModule({
    ...objectSchema, properties: { ...objectSchema.properties, obsolete: { type: "string" } }
  });
  await seedValue("item", { name: "before", count: 1, obsolete: "must disappear" });
  const input = { kind: "value" as const, value: { name: "replacement", count: 3 } };
  await s.upsertData({}, root, "records", "item", input);
  const after = await s.readData({}, root, "records", "item");
  assert.equal(after.revision, 2);
  assert.deepEqual(after.value, input.value);
});

test("business queries forward JSONPath and preserve empty matches, null and array values", async () => {
  const { service: s, root } = await businessDataModule({ type: "object", properties: { nil: { type: "null" }, values: { type: "array", items: { type: "integer" } } } });
  await s.writeData({}, root, "records", "item", "create", { kind: "value", value: { nil: null, values: [1, 2] } });
  for (const [path, expected] of [["$.missing", []], ["$.nil", [null]], ["$.values", [[1, 2]]]] as const)
    assert.deepEqual((await s.readData({}, root, "records", "item", { path })).value, expected);
});

test("business queries report missing records instead of empty JSONPath matches", async () => {
  const { service: s, root } = await businessDataModule(objectSchema);
  await assert.rejects(s.readData({}, root, "records", "absent", { path: "$.missing" }), { code: "NOT_FOUND" });
});

test("business reads reject simultaneous metadata-only and JSONPath requests", async () => {
  const { service: s, root } = await existingBusinessItem();
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

test("business dry-run validates creates without publishing a new record", async () => {
  const f = await businessDataModule(objectSchema), s = f.service;
  const input = { kind: "value" as const, value: { name: "original", count: 1 } };
  await s.writeData({}, f.root, "records", "item", "create", input, { dryRun: true });
  assert.equal((await s.hasData({}, f.root, "records", "item")).exists, false);
});

test("business dry-run delete leaves the stored record unchanged", async () => {
  const f = await existingBusinessItem(), s = f.service;
  const before = await s.readData({}, f.root, "records", "item");
  await s.deleteData({}, f.root, "records", "item", { dryRun: true });
  assert.equal((await s.readData({}, f.root, "records", "item")).revision, 1);
  assert.deepEqual(await s.readData({}, f.root, "records", "item"), before);
});

test("business model conflicts reject export before publishing bytes", async () => {
  const f = await existingBusinessItem(), s = f.service;
  f.changeModel();
  await assert.rejects(s.exportData({}, f.root, "records", "item", "json", "blocked.json"), { code: "MODEL_READ_CONFLICT" });
  assert.equal(f.exported.size, 0);
});

test("raw business Store decodes JSON through the opaque payload adapter", async () => {
  const { service: s, root } = await businessDataModule(objectSchema, "data");
  const input = { kind: "value" as const, value: { name: "raw", count: 1 } };
  await s.writeData({}, root, "records", "item.json", "create", input);
  assert.deepEqual((await s.readData({}, root, "records", "item.json")).value, input.value);
});

for (const operation of ["update", "edit"] as const) test(`raw business Store rejects unsupported conditional ${operation}`, async () => {
  const { service: s, root } = await businessDataModule(objectSchema, "data");
  const input = { kind: "value" as const, value: { name: "raw", count: 1 } };
  await assert.rejects(operation === "update"
    ? s.writeData({}, root, "records", "item.json", "update", input, { expectedRevision: 1 })
    : s.editData({}, root, "records", "item.json", []), { code: "UNSUPPORTED_CAPABILITY" });
});
