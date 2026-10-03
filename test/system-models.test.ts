import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectModelHost } from "../src/project/models.js";
import { createModelRegistrationStore, initializeProjectModelRegistrations, modelRegistrationSchema, readModelRegistrations } from "../src/project/model-registration.js";
import { installBundledSystemModels } from "../src/project/system-models.js";
import { modelDefinitionStore } from "../src/project/system-model-store.js";
import { readAll } from "../src/data/extensions/shared/payload.js";
import { readBundledSystemModels } from "../src/reserved/models.js";

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-system-models-"));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function snapshot(root: string): Promise<Record<string, { bytes: string; mtime: number }>> {
  const result: Record<string, { bytes: string; mtime: number }> = {};
  async function visit(path: string, prefix = "") {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const key = prefix + item.name;
      if (item.isDirectory()) await visit(join(path, item.name), key + "/");
      else result[key] = { bytes: (await readFile(join(path, item.name))).toString("base64"), mtime: (await stat(join(path, item.name))).mtimeMs };
    }
  }
  await visit(root); return result;
}

test("An uninitialized Project model read creates neither directories nor virtual system rows", async () => fixture(async root => {
  const host = await createProjectModelHost({}, { root });
  assert.deepEqual(await host.list(), []);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(host.definition("memsphere/run/artifact"), { code: "MODEL_NOT_FOUND" });
  assert.deepEqual(await readdir(root), []);
}));

test("System installation persists five exact definitions and registrations with stable IDs and raw semantics", async () => fixture(async root => {
  const result = await installBundledSystemModels({}, { root });
  assert.deepEqual(result, { status: "installed", created: 5, retained: 0 });
  const state = await readModelRegistrations({}, { root });
  assert.equal(state.records.length, 5);
  assert.ok(state.records.every(record => record.origin === "system" && record.registration.storage === "store"));
  const host = await createProjectModelHost({}, { root });
  for (const asset of readBundledSystemModels()) {
    const ref = asset.registration.modelRef;
    const store = modelDefinitionStore(asset.registration.store_id!, asset.metaModel, join(root, "models/registrations/system/definitions", asset.metaModel), true);
    const stored = await store.get({}, ref);
    assert.equal(stored!.data.id, ref);
    assert.equal(stored!.data.model, asset.metaModel);
    assert.equal(Buffer.from(await readAll({}, stored!.data.payload.content)).toString(), asset.source);
    const definition = await host.definition(ref);
    assert.equal(definition.source, asset.source);
    assert.equal(definition.origin, "system");
    assert.equal(definition.builtin, true);
    assert.equal(definition.registration.store_id, asset.registration.store_id);
    if (asset.metaModel === "raw") {
      const runtime = await host.runtime(ref);
      assert.equal(runtime.reflect(Buffer.from([0, 255, 10])).kind, "scalar");
      assert.throws(() => runtime.reflect("decoded text"));
    }
  }
  assert.equal((await host.list()).length, 5);
}));

test("Repeated explicit initialization preserves definitions, management values, record revisions, markers and config bytes", async () => fixture(async root => {
  const configPath = join(root, "config.json");
  await writeFile(configPath, '{"custom":"preserve"}\n');
  await initializeProjectModelRegistrations({}, { root }, { config: { path: configPath, value: { custom: "preserve" } } });
  const state = await readModelRegistrations({}, { root });
  const record = state.records.find(record => record.registration.modelRef === "memsphere/run/artifact")!;
  const store = await createModelRegistrationStore({}, "system", join(root, "models/registrations/system/registrations"));
  await store.update({}, record.id, { ...record.registration, name: "My artifact", description: "", tags: ["custom"] });
  const before = await snapshot(root);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const repeated = await initializeProjectModelRegistrations({}, { root, modelRegistration: config.modelRegistration }, { config: { path: configPath, value: config } });
  assert.equal(repeated.created, 0);
  assert.equal(repeated.system.status, "unchanged");
  assert.deepEqual(await snapshot(root), before);
  assert.equal((await (await createProjectModelHost({}, { root })).definition("memsphere/run/artifact")).registration.name, "My artifact");
}));

test("Installed system definitions remain the source of truth and damaged files never fall back to the bundle", async () => fixture(async root => {
  await installBundledSystemModels({}, { root });
  const path = join(root, "models/registrations/system/definitions/raw/memsphere/run/artifact.json");
  const source = '\uFEFF {"description":"From persistent Store"}\r\n';
  await writeFile(path, source);
  assert.equal((await (await createProjectModelHost({}, { root })).definition("memsphere/run/artifact")).source, source);
  await assert.rejects(installBundledSystemModels({}, { root }), /conflict/);
  await rm(path);
  const host = await createProjectModelHost({}, { root });
  assert.equal((await host.list()).find(model => model.id === "memsphere/run/artifact")!.status, "unavailable");
  await assert.rejects(host.runtime("memsphere/run/artifact"), /not found/);
  await rm(join(root, "models/registrations/system/definitions/json-schema/draft-07/memsphere/model-registration.json"));
  await assert.rejects(createProjectModelHost({}, { root }), /registration definition is missing/);
}));

test("System installation rejects a Project identity conflict before publishing anything", async () => fixture(async root => {
  const records = await createModelRegistrationStore({}, "project", join(root, "models/registrations/project"));
  await records.create({}, "existing", { modelRef: "memsphere/run/artifact", storage: "store", store_id: "models/json-schema/draft-07" });
  const before = await snapshot(root);
  await assert.rejects(installBundledSystemModels({}, { root }), /identity conflict/);
  assert.deepEqual(await snapshot(root), before);
}));

test("A failure before system publication leaves no visible system package", async () => fixture(async root => {
  await assert.rejects(installBundledSystemModels({}, { root }, { beforePublish: async () => { throw new Error("injected publication failure"); } }), /injected publication/);
  assert.deepEqual(await (await createProjectModelHost({}, { root })).list(), []);
  assert.deepEqual(await readdir(join(root, "models/registrations")), []);
}));

test("A later initialization failure restores legacy definition, references and exact registration records", async () => fixture(async root => {
  const directory = join(root, "models/json-schema/draft-07");
  await mkdir(join(directory, "memsphere"), { recursive: true });
  await writeFile(join(directory, "memsphere/model-registration.json"), ` ${JSON.stringify(modelRegistrationSchema)}\n`);
  const source = '\uFEFF {"type":"object","properties":{"record":{"$ref":"memsphere/model-registration.json"}}}\r\n';
  await writeFile(join(directory, "consumer.json"), source);
  const records = await createModelRegistrationStore({}, "project", join(root, "models/registrations/project"));
  await records.create({}, "old-registration", { modelRef: "memsphere/model-registration.json", storage: "store", store_id: "models/json-schema/draft-07", name: "Old preview" });
  const before = await snapshot(root);
  await assert.rejects(initializeProjectModelRegistrations({}, { root }, { afterRegistrations: async () => { throw new Error("injected final failure"); } }), /injected final/);
  const after = await snapshot(root);
  const relevant = Object.fromEntries(Object.entries(after).filter(([path]) => !path.startsWith("backups/")));
  assert.deepEqual(Object.fromEntries(Object.entries(relevant).map(([path, value]) => [path, value.bytes])), Object.fromEntries(Object.entries(before).map(([path, value]) => [path, value.bytes])));
  assert.ok(Object.keys(after).some(path => path.startsWith("backups/")));
  assert.equal((await readModelRegistrations({}, { root })).records.length, 1);
  assert.equal(await readFile(join(directory, "consumer.json"), "utf8"), source);
}));

test("System identities cannot change their fixed definition standard by switching between system Stores", async () => fixture(async root => {
  await installBundledSystemModels({}, { root });
  const state = await readModelRegistrations({}, { root });
  const record = state.records.find(record => record.registration.modelRef === "memsphere/run/artifact")!;
  const records = await createModelRegistrationStore({}, "system", join(root, "models/registrations/system/registrations"));
  await records.update({}, record.id, { ...record.registration, store_id: "models/system/json-schema/draft-07" });
  const path = join(root, "models/registrations/system/definitions/json-schema/draft-07/memsphere/run/artifact.json");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, '{"type":"string"}');
  const host = await createProjectModelHost({}, { root });
  assert.equal((await host.list()).find(model => model.id === "memsphere/run/artifact")!.status, "unavailable");
  await assert.rejects(host.runtime("memsphere/run/artifact"), /Invalid model storage binding/);
  await assert.rejects(host.manager.getModel({}, "memsphere/run/artifact"), /Invalid model storage binding/);
}));

test("System registrations keep their catalog package identity while allowing management metadata edits", async () => fixture(async root => {
  await installBundledSystemModels({}, { root });
  const record = (await readModelRegistrations({}, { root })).records.find(record => record.registration.modelRef === "memsphere/run/artifact")!;
  const records = await createModelRegistrationStore({}, "system", join(root, "models/registrations/system/registrations"));
  await records.update({}, record.id, { ...record.registration, name: "Local name", description: "Local description", tags: ["local"] });
  const valid = await createProjectModelHost({}, { root });
  const summary = (await valid.list()).find(model => model.id === "memsphere/run/artifact")!;
  assert.equal(summary.status, "available");
  assert.equal(summary.registration!.name, "Local name");
  await records.update({}, record.id, { ...record.registration, package: "wrong.package" });
  const invalid = await createProjectModelHost({}, { root });
  assert.equal((await invalid.list()).find(model => model.id === "memsphere/run/artifact")!.status, "unavailable");
  await assert.rejects(invalid.runtime("memsphere/run/artifact"), /Invalid model storage binding/);
}));

test("Initialization failure never rolls back an unrelated existing registration edited by another writer", async () => fixture(async root => {
  const directory = join(root, "models/json-schema/draft-07");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "keep.json"), '{"type":"string"}');
  const store = await createModelRegistrationStore({}, "project", join(root, "models/registrations/project"));
  const registration = { modelRef: "keep.json", name: "Before", storage: "store", store_id: "models/json-schema/draft-07" };
  await store.create({}, "keep", registration);
  let changed: Buffer;
  await assert.rejects(initializeProjectModelRegistrations({}, { root }, { afterSystemInstall: async () => {
    await store.update({}, "keep", { ...registration, name: "Human edit" });
    changed = await readFile(join(root, "models/registrations/project/keep.json"));
    throw new Error("injected subsequent failure");
  } }), /injected subsequent failure/);
  assert.deepEqual(await readFile(join(root, "models/registrations/project/keep.json")), changed!);
  assert.equal(((await store.get({}, "keep"))!.value as { name: string }).name, "Human edit");
  assert.equal((await readModelRegistrations({}, { root })).records.length, 1);
}));

test("Rollback preserves newly created registrations changed after initialization and reports the conflict", async () => fixture(async root => {
  const directory = join(root, "models/json-schema/draft-07");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "new.json"), '{"type":"string"}');
  let recordPath = "";
  let changed: Buffer;
  await assert.rejects(initializeProjectModelRegistrations({}, { root }, { afterRegistrations: async () => {
    const record = (await readModelRegistrations({}, { root })).records.find(record => record.origin === "project")!;
    const store = await createModelRegistrationStore({}, "project", join(root, "models/registrations/project"));
    await store.update({}, record.id, { ...record.registration, name: "Human edit" });
    recordPath = join(root, "models/registrations/project", `${record.id}.json`);
    changed = await readFile(recordPath);
    throw new Error("injected subsequent failure");
  } }), /restore required.*rollback conflict/);
  assert.deepEqual(await readFile(recordPath), changed!);
  await assert.rejects(readFile(join(root, "models/registrations/initialized.json")), { code: "ENOENT" });
}));

test("Rollback preserves an installed system subtree changed by another writer and reports recovery conflict", async () => fixture(async root => {
  const source = '{"description":"Human changed persisted definition"}';
  const path = join(root, "models/registrations/system/definitions/raw/memsphere/run/artifact.json");
  await assert.rejects(initializeProjectModelRegistrations({}, { root }, { afterSystemInstall: async () => {
    await writeFile(path, source);
    throw new Error("injected subsequent failure");
  } }), /restore required.*changed system subtree preserved/);
  assert.equal(await readFile(path, "utf8"), source);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 5);
  assert.equal((await (await createProjectModelHost({}, { root })).definition("memsphere/run/artifact")).source, source);
}));

test("Legacy rollback preserves a newer reference file instead of replacing it with the original snapshot", async () => fixture(async root => {
  const directory = join(root, "models/json-schema/draft-07");
  await mkdir(join(directory, "memsphere"), { recursive: true });
  const legacy = join(directory, "memsphere/model-registration.json");
  const reference = join(directory, "reference.json");
  await writeFile(legacy, JSON.stringify(modelRegistrationSchema));
  await writeFile(reference, '{"type":"object","properties":{"registration":{"$ref":"memsphere/model-registration.json"}}}');
  const newer = '{"type":"string","description":"Human changed this after migration"}';
  await assert.rejects(initializeProjectModelRegistrations({}, { root }, { afterRegistrations: async () => {
    await writeFile(reference, newer);
    throw new Error("injected subsequent failure");
  } }), /restore required.*rollback conflict/);
  assert.equal(await readFile(reference, "utf8"), newer);
  assert.equal(await readFile(legacy, "utf8"), JSON.stringify(modelRegistrationSchema));
}));
