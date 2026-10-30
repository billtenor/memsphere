import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { businessFixture } from "./helpers/business-data.js";
import { mutateModel, readModel } from "../src/project/model-service.js";
import { createModelRegistrationStore, initializeProjectModelRegistrations, modelDefinitionHash, readModelRegistrations } from "../src/project/model-registration.js";
import { createProjectModelHost } from "../src/project/models.js";
import { withNativeFileLock } from "../src/file-lock.js";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";

test("model publication uses a definition hash and ignores the old Project lock", async t => {
  const f = await businessFixture(t, {});
  await mkdir(join(f.root, ".runtime"), { recursive: true });
  const source = '\uFEFF {"type":"string"}\r\n';
  await withNativeFileLock(join(f.root, ".runtime/settings.lock"), async () => {
    await mutateModel({}, f.root, "create", "order.json", { source });
    assert.equal((await readModel({}, f.root, "order.json", "all")).registration?.definition_sha256, modelDefinitionHash(source));
    await mutateModel({}, f.root, "update", "order.json", { fields: { name: "Order" } });
    await mutateModel({}, f.root, "delete", "order.json");
  });
});

test("unregistered and mismatched definitions cannot be used; explicit publication repairs a mismatch", async t => {
  const f = await businessFixture(t, {}), path = join(f.root, "models/json-schema/draft-07/order.json");
  await writeFile(path, '{"type":"string"}');
  await assert.rejects(readModel({}, f.root, "order.json"), { code: "MODEL_NOT_REGISTERED" });
  await mutateModel({}, f.root, "update", "order.json", { source: '{"type":"string"}' });
  await writeFile(path, '{"type":"number"}');
  await assert.rejects(readModel({}, f.root, "order.json"), { code: "MODEL_DEFINITION_HASH_MISMATCH" });
  await mutateModel({}, f.root, "update", "order.json", { source: '{"type":"number"}' });
  assert.deepEqual((await readModel({}, f.root, "order.json")).definition, { type: "number" });
});

test("legacy registration hash backfill uses CAS once and preserves metadata and raw definition bytes", async t => {
  const f = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root: f.root });
  const record = (await readModelRegistrations({}, { root: f.root })).records.find(r => r.registration.modelRef === "record.json")!;
  const registry = await createModelRegistrationStore({}, "legacy", join(f.root, "models/registrations/project"));
  const row = (await registry.get({}, record.id))!;
  const { definition_sha256: _hash, ...legacy } = row.value as typeof record.registration;
  const before = await registry.update({}, record.id, { ...legacy, name: "Keep me" }, { expectedRevision: row.revision });
  const path = join(f.root, "models/json-schema/draft-07/record.json"), bytes = await readFile(path);
  await Promise.all([readModel({}, f.root, "record.json"), readModel({}, f.root, "record.json")]);
  const after = (await registry.get({}, record.id))!;
  assert.equal(after.revision, before.revision! + 1);
  assert.deepEqual(after.value, { ...legacy, name: "Keep me", definition_sha256: modelDefinitionHash(bytes) });
  assert.deepEqual(await readFile(path), bytes);
  // The host reuses the bytes it checked even if a subsequent writer replaces the file.
  const host = await createProjectModelHost({}, { root: f.root });
  const snapshot = await host.definition("record.json");
  await writeFile(path, '{"type":"null"}');
  assert.deepEqual((await host.definition("record.json")).definition, snapshot.definition);
  await assert.rejects(readModel({}, f.root, "record.json"), { code: "MODEL_DEFINITION_HASH_MISMATCH" });
});

test("failure after definition write leaves it unpublished until registration succeeds", async t => {
  const f = await businessFixture(t, {});
  await mutateModel({}, f.root, "create", "order.json", { source: '{"type":"string"}' });
  const original = FilesystemJsonValueStoreFactory.prototype.createStore;
  const replacement = '{"type":"number"}';
  const mock = t.mock.method(FilesystemJsonValueStoreFactory.prototype, "createStore", async function (...args: Parameters<typeof original>) {
    const store = await original.apply(this, args);
    if (args[1] === "registrations/project") store.update = async () => { throw new Error("registration publication failed"); };
    return store;
  });
  await assert.rejects(mutateModel({}, f.root, "update", "order.json", { source: replacement }), /registration publication failed/);
  mock.mock.restore();
  assert.equal(await readFile(join(f.root, "models/json-schema/draft-07/order.json"), "utf8"), replacement);
  await assert.rejects(readModel({}, f.root, "order.json"), { code: "MODEL_DEFINITION_HASH_MISMATCH" });
  await mutateModel({}, f.root, "update", "order.json", { source: replacement });
  assert.deepEqual((await readModel({}, f.root, "order.json")).definition, { type: "number" });
});

test("legacy installed registration schemas allow hash backfill without rewriting the old definition", async t => {
  const f = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root: f.root });
  const state = await readModelRegistrations({}, { root: f.root });
  for (const [ref, area] of [["record.json", "project"], ["memsphere/model-registration.json", "system/registrations"]]) {
    const record = state.records.find(r => r.registration.modelRef === ref)!;
    const registry = await createModelRegistrationStore({}, "legacy", join(f.root, "models/registrations", area));
    const row = (await registry.get({}, record.id))!;
    const { definition_sha256: _hash, ...legacy } = row.value as typeof record.registration;
    await registry.update({}, record.id, legacy, { expectedRevision: row.revision });
  }
  const path = join(f.root, "models/registrations/system/definitions/json-schema/draft-07/memsphere/model-registration.json");
  const schema = JSON.parse(await readFile(path, "utf8"));
  delete schema.properties.definition_sha256;
  const source = JSON.stringify(schema);
  await writeFile(path, source);
  await readModel({}, f.root, "record.json");
  await readModel({}, f.root, "memsphere/model-registration.json");
  assert.equal(await readFile(path, "utf8"), source);
  const after = await readModelRegistrations({}, { root: f.root });
  assert.equal(after.records.find(r => r.registration.modelRef === "memsphere/model-registration.json")!.registration.definition_sha256, modelDefinitionHash(source));
});
