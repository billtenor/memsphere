import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBundledSystemModels } from "../src/reserved/models.js";
import { createProjectModelHost, DEFAULT_MODELS_DIRECTORY } from "../src/project/models.js";
import { createModelRegistrationStore, initializeProjectModelRegistrations, modelRegistrationSchema, MODEL_REGISTRATION_MODEL, DEFAULT_MODEL_REGISTRATION_CONFIG, prepareModelRegistrationMigration, readModelRegistrations, validateModelRegistration } from "../src/project/model-registration.js";
async function fixture(fn: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "model-registration-"));
  const directory = join(root, DEFAULT_MODELS_DIRECTORY);
  await mkdir(directory, { recursive: true });
  try {
    await fn(root, directory);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("Empty registry stays empty until explicit initialization installs its persistent system models", async () => fixture(async (root) => {
  const empty = await createProjectModelHost({}, { root });
  assert.equal(empty.initialized, false);
  assert.deepEqual(await empty.list(), []);
  await assert.rejects(empty.definition(MODEL_REGISTRATION_MODEL), { code: "MODEL_NOT_FOUND" });
  await assert.rejects(readFile(join(root, "models/registrations/initialized.json")), { code: "ENOENT" });
  await initializeProjectModelRegistrations({}, { root });
  const host = await createProjectModelHost({}, { root });
  const runtime = await host.runtime(MODEL_REGISTRATION_MODEL);
  assert.equal(runtime.descriptor.id, MODEL_REGISTRATION_MODEL);
  assert.equal(runtime.reflect({ modelRef: "sales/order.json", storage: "store", store_id: "models/json-schema/draft-07" }).kind, "object");
  assert.equal((await host.definition(MODEL_REGISTRATION_MODEL)).registration.storage, "store");
  assert.equal((await host.definition("memsphere/model-registration.json")).id, MODEL_REGISTRATION_MODEL);
  assert.throws(() => validateModelRegistration({ modelRef: "x", storage: "store" }), /store_id/);
  assert.throws(() => validateModelRegistration({ modelRef: "x", storage: "builtin", store_id: "x" }), /must not/);
}));
test("Explicit initialization uses UUID records for slash IDs, preserves metadata on repeat and definition bytes", async () => fixture(async (root, directory) => {
  const source = '\uFEFF  {"type":"string","title":"Title","description":"Description"}\r\n';
  await mkdir(join(directory, "sales"));
  await writeFile(join(directory, "sales/order.json"), source);
  const initial = await initializeProjectModelRegistrations({}, { root });
  assert.equal(initial.created, 1);
  const state = await readModelRegistrations({}, { root });
  assert.equal(state.records.filter(record => record.origin === "project").length, 1);
  assert.equal(state.records.filter(record => record.origin === "system").length, 5);
  assert.equal(state.records[0]!.registration.modelRef, "sales/order.json");
  assert.ok(!state.records[0]!.id.includes("/"));
  const store = await createModelRegistrationStore({}, "registry", join(root, "models/registrations/project"));
  await store.update({}, state.records[0]!.id, { ...state.records[0]!.registration, name: "Custom", description: "", package: "local.orders", package_name: "本项目订单", tags: ["custom"] });
  const repeated = await initializeProjectModelRegistrations({}, { root });
  assert.equal(repeated.created, 0);
  assert.equal(repeated.retained, 1);
  const host = await createProjectModelHost({}, { root });
  assert.equal(host.initialized, true);
  const model = await host.definition("sales/order.json");
  assert.equal(model.source, source);
  assert.equal(model.registration.name, "Custom");
  assert.equal(model.registration.description, "");
  assert.equal(model.origin, "project");
  assert.equal((await readFile(join(directory, "sales/order.json"), "utf8")), source);
}));
test("Corrupt single records are diagnosed and do not hide good models; unknown storage cannot fall back", async () => fixture(async (root, directory) => {
  await writeFile(join(directory, "good.json"), '{"type":"string"}');
  await writeFile(join(directory, "wrong.json"), '{"type":"number"}');
  await initializeProjectModelRegistrations({}, { root });
  const state = await readModelRegistrations({}, { root });
  const wrong = state.records.find(r => r.registration.modelRef === "wrong.json")!;
  const store = await createModelRegistrationStore({}, "registry", join(root, "models/registrations/project"));
  await store.update({}, wrong.id, { ...wrong.registration, store_id: "unknown" });
  await writeFile(join(root, "models/registrations/project/broken.json"), "invalid");
  const host = await createProjectModelHost({}, { root });
  assert.equal(host.diagnostics.length, 1);
  assert.equal((await host.list()).find(m => m.id === "good.json")?.status, "available");
  assert.equal((await host.list()).find(m => m.id === "wrong.json")?.status, "unavailable");
  await assert.rejects(host.definition("wrong.json"), /binding/);
  await assert.rejects(initializeProjectModelRegistrations({}, { root }), /Damaged/);
}));
test("Changing registry directory requires explicit migration and preserves original and copied bytes", async () => fixture(async (root, directory) => {
  await writeFile(join(directory, "one.json"), '{"type":"string"}');
  await initializeProjectModelRegistrations({}, { root });
  const target = { storeId: "other", stores: { other: { factory: "memsphere/filesystem-json" as const, directory: "internal/registry" } } };
  await assert.rejects(prepareModelRegistrationMigration({}, { root }, target), { code: "MODEL_REGISTRATION_MIGRATION_REQUIRED" });
  const before = await readModelRegistrations({}, { root });
  const migration = await prepareModelRegistrationMigration({}, { root }, target, { migrate: true });
  assert.equal(migration.migrated, true);
  const after = await readModelRegistrations({}, { root, modelRegistration: target });
  assert.deepEqual(after.records, before.records);
  const migratedHost = await createProjectModelHost({}, { root, modelRegistration: target });
  for (const model of readBundledSystemModels()) {
    const path = join("system/definitions", model.metaModel, `${model.registration.modelRef}.json`);
    assert.deepEqual(await readFile(join(root, "models/registrations", path)), await readFile(join(root, "internal/registry", path)));
    assert.equal((await migratedHost.definition(model.registration.modelRef)).source, model.source);
  }
  const filename = `${before.records[0]!.id}.json`;
  assert.deepEqual(await readFile(join(root, "models/registrations/project", filename)), await readFile(join(root, "internal/registry/project", filename)));
  assert.ok(migration.excludedDirectories.includes(await realpath(join(root, "models/registrations"))));
  const conflictStore = await createModelRegistrationStore({}, "conflict", join(root, "bad/project"));
  await conflictStore.create({}, "one", { modelRef: "one.json", storage: "store", store_id: "models/json-schema/draft-07", name: "Different" });
  await assert.rejects(prepareModelRegistrationMigration({}, { root }, { storeId: "bad", stores: { bad: { factory: "memsphere/filesystem-json", directory: "bad" } } }, { migrate: true }), /conflict/);
  assert.deepEqual((await readModelRegistrations({}, { root })).records, before.records);
}));
test("Known preview migration backs up exact bytes and exposes a single canonical builtin", async () => fixture(async (root, directory) => {
  await mkdir(join(directory, "memsphere"));
  const source = `  ${JSON.stringify(modelRegistrationSchema, null, 2)}\n`;
  await writeFile(join(directory, "memsphere/model-registration.json"), source);
  await writeFile(join(directory, "one.json"), '{"type":"string"}');
  const result = await initializeProjectModelRegistrations({}, { root });
  assert.ok(result.backupPath);
  assert.equal(await readFile(result.backupPath!, "utf8"), source);
  const host = await createProjectModelHost({}, { root });
  const models = await host.list();
  assert.equal(models.filter(m => m.id === MODEL_REGISTRATION_MODEL).length, 1);
  assert.equal(models.some(m => m.id === "memsphere/model-registration.json"), false);
  assert.equal((await host.definition("memsphere/model-registration.json")).id, MODEL_REGISTRATION_MODEL);
  await assert.rejects(readFile(join(directory, "memsphere/model-registration.json")), { code: "ENOENT" });
}));
test("Approved example seeds and preview migration produce exactly thirteen models without changing source assets", async () => fixture(async (root, directory) => {
  const snapshots = JSON.parse(await readFile(new URL("../prototypes/model-registration/models.json", import.meta.url), "utf8")) as {
    registration: {
      modelRef: string;
    };
    source: string;
  }[];
  const examples = snapshots.filter(m => m.registration.modelRef.startsWith("examples/"));
  assert.equal(examples.length, 8);
  for (const example of examples) {
    const path = join(directory, example.registration.modelRef);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, example.source);
  }
  await mkdir(join(directory, "memsphere"));
  await writeFile(join(directory, "memsphere/model-registration.json"), JSON.stringify(modelRegistrationSchema));
  const result = await initializeProjectModelRegistrations({}, { root });
  assert.equal(result.created, 8);
  const host = await createProjectModelHost({}, { root });
  assert.equal((await host.list()).length, 13);
  assert.equal((await host.list()).every(m => m.status === "available"), true);
  assert.equal((await host.definition("examples/02-nested-order.json")).registration.package, "memsphere.examples.orders");
  for (const example of examples)
    assert.equal((await host.definition(example.registration.modelRef)).source, example.source);
}));
test("Preview migration updates supported schema references while backing up their complete original bytes", async () => fixture(async (root, directory) => {
  await mkdir(join(directory, "memsphere"));
  await writeFile(join(directory, "memsphere/model-registration.json"), JSON.stringify(modelRegistrationSchema));
  const source = '\uFEFF {"type":"object", "properties":{"registration":{"$ref" : "memsphere/model-registration.json"}},"description":"memsphere/model-registration.json", "examples":[{"$ref":"memsphere/model-registration.json"}]}\r\n';
  await writeFile(join(directory, "reference.json"), source);
  const result = await initializeProjectModelRegistrations({}, { root });
  const expected = source.replace('"$ref" : "memsphere/model-registration.json"', '"$ref" : "memsphere/model-registration"');
  const host = await createProjectModelHost({}, { root });
  assert.equal((await host.definition("reference.json")).source, expected);
  assert.equal((await host.runtime("reference.json")).reflect({ registration: { modelRef: "x", storage: "builtin" } }).kind, "object");
  const receipt = JSON.parse(await readFile(join(result.backupPath!, "..", "migration-receipt.json"), "utf8"));
  assert.equal(await readFile(receipt.references[0].backupPath, "utf8"), source);
}));
test("Registry Store writes enforce storage conditions as business validation, including bootstrap", async () => fixture(async (root) => {
  const store = await createModelRegistrationStore({}, "registry", join(root, "registry"));
  await assert.rejects(store.create({}, "missing", { modelRef: "x", storage: "store" }), /store_id/);
  await assert.rejects(store.create({}, "builtin", { modelRef: "x", storage: "builtin", store_id: "x" }), /must not/);
  await assert.rejects(store.create({}, "package", { modelRef: "x", storage: "builtin", package_name: "Name" }), /requires package/);
}));
