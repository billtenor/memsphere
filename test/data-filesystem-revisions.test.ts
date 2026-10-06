import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Config } from "../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory, FILESYSTEM_JSON_METADATA_DIRECTORY, validateFilesystemJsonStoreMetadata } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { recordStateKey } from "../src/data/extensions/shared/filesystem.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";

async function fixture(t: TestContext) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-revision-history-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
  const store = await new FilesystemJsonValueStoreFactory().openExisting({}, "test/records", runtime, new Config({ directory }));
  const state = join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY, `${recordStateKey("item.json")}.revision.json`);
  return { directory, store, state };
}

test("deletion history I/O failure preserves the original record and revision", async (t) => {
  const { directory, store, state } = await fixture(t);
  const original = await store.create({}, "item", { valid: true });
  const link = fs.link.bind(fs);
  const failing = t.mock.method(fs, "link", async (source, target) => {
    if (String(target) === state) throw Object.assign(new Error("disk failure"), { code: "EIO" });
    return link(source, target);
  });
  await assert.rejects(store.delete({}, "item", { expectedRevision: 1 }), { code: "EIO" });
  failing.mock.restore();
  assert.deepEqual(await store.get({}, "item"), original);
  assert.deepEqual(await fs.readdir(join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY)), [`${recordStateKey("item.json")}.lock`]);
});

test("failed unlink retains conservative history without advancing the visible revision", async (t) => {
  const { directory, store, state } = await fixture(t);
  const original = await store.create({}, "item", { valid: true });
  const unlink = fs.unlink.bind(fs);
  const failing = t.mock.method(fs, "unlink", async (path) => {
    if (String(path) === join(directory, "item.json")) throw Object.assign(new Error("disk failure"), { code: "EIO" });
    return unlink(path);
  });
  await assert.rejects(store.delete({}, "item", { expectedRevision: 1 }), { code: "EIO" });
  failing.mock.restore();
  assert.equal(JSON.parse(await fs.readFile(state, "utf8")).revision, 1);
  assert.deepEqual(await store.get({}, "item"), original);
  assert.equal((await store.update({}, "item", { valid: "updated" }, { expectedRevision: 1 })).revision, 2);
  assert.equal(await store.delete({}, "item"), true);
  assert.equal((await store.create({}, "item", { recreated: true })).revision, 3);
});

test("corrupt deletion history blocks recreation instead of resetting its revision", async (t) => {
  const { directory, store, state } = await fixture(t);
  await store.create({}, "item", {});
  await store.delete({}, "item");
  await fs.writeFile(state, "{broken");
  await assert.rejects(store.create({}, "item", {}), { code: "INVALID_STORE_METADATA" });
  assert.equal(await store.get({}, "item"), undefined);
  await assert.rejects(validateFilesystemJsonStoreMetadata({}, directory), { code: "INVALID_STORE_METADATA" });
  assert.equal(await fs.readFile(state, "utf8"), "{broken");
});

test("retained maximum revision cannot wrap around when a deleted record is recreated", async (t) => {
  const { directory, store } = await fixture(t);
  const original = await store.create({}, "item", {});
  await fs.writeFile(join(directory, "item.json"), JSON.stringify({ ...original, revision: Number.MAX_SAFE_INTEGER }));
  await store.delete({}, "item");
  await assert.rejects(store.create({}, "item", {}), /revision overflow/);
  assert.equal(await store.has({}, "item"), false);
});

test("known metadata survives reopening but unknown metadata is rejected without changes", async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", {});
  await store.delete({}, "item");
  await validateFilesystemJsonStoreMetadata({}, directory);
  assert.deepEqual(await store.list({}), { items: [] });
  const unknown = join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY, "another-format.json");
  await fs.writeFile(unknown, "keep this evidence");
  await assert.rejects(validateFilesystemJsonStoreMetadata({}, directory), /Unknown.*metadata/);
  assert.equal(await fs.readFile(unknown, "utf8"), "keep this evidence");
});

test("retained history must identify a valid logical record ID, not just a portable physical filename", async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", {});
  for (const filename of [".json", "trailing..json"]) {
    const path = join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY, `${recordStateKey(filename)}.revision.json`);
    await fs.writeFile(path, JSON.stringify({ format: "memsphere/filesystem-json-revision/1", filename, revision: 1 }));
    await assert.rejects(validateFilesystemJsonStoreMetadata({}, directory), { code: "INVALID_STORE_METADATA" });
    await fs.unlink(path);
  }
});
