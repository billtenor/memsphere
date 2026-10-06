import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectModelHost, DEFAULT_MODELS_DIRECTORY } from "../src/project/models.js";
import { listModelMarket, importModelMarketPackage, cleanupModelMarketCandidates } from "../src/project/model-market.js";
import { createModelRegistrationStore, prepareModelRegistrationMigration, readModelRegistrations } from "../src/project/model-registration.js";
const importOptions = (root: string) => ({ sourceRoot: join(root, "bundled") });
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "model-market-"));
  try {
    const sourceRoot = importOptions(root).sourceRoot;
    await cp(new URL("../reserved-models", import.meta.url), sourceRoot, { recursive: true });
    const manifestPath = join(sourceRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const pack = manifest.market_packages[0];
    for (const model of pack.models.filter((model: { registration: { modelRef: string } }) => /examples\/0[45]-/.test(model.registration.modelRef))) await rm(join(sourceRoot, model.source));
    pack.models = pack.models.filter((model: { registration: { modelRef: string } }) => !/examples\/0[45]-/.test(model.registration.modelRef));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await fn(root);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
}
const packageId = "memsphere.examples";
const modelRef = "examples/02-nested-order.json";
const legacyPackageId = "memsphere.examples.orders";
const legacyModelRef = "memsphere/examples/order.json";

async function historicalOrderImport(root: string, published: boolean) {
  const registrationDirectory = join(root, "models/registrations");
  const id = randomUUID();
  const stage = join(registrationDirectory, "staging", randomUUID());
  const definition = join(registrationDirectory, "imported-definitions", legacyModelRef);
  await mkdir(join(definition, ".."), { recursive: true });
  const source = listModelMarket()[0]!.models.find(model => model.registration.modelRef === modelRef)!.source;
  await writeFile(definition, source);
  const store = await createModelRegistrationStore({}, "historical-market", join(registrationDirectory, "imported"));
  await store.create({}, id, {
    modelRef: legacyModelRef, name: "订单与深层嵌套", description: "对象套对象、对象套数组、数组套对象；订单、明细与配送信息。",
    package: legacyPackageId, package_name: "订单示例", tags: ["订单"], storage: "store", store_id: "models/imported/json-schema/draft-07"
  });
  const publication = join(registrationDirectory, "published-imports.json");
  await writeFile(publication, JSON.stringify({ recordIds: published ? [id] : [] }));
  await mkdir(stage, { recursive: true });
  const receipt = join(stage, "candidate.json");
  await writeFile(receipt, JSON.stringify({ packageId: legacyPackageId, recordIds: [id], modelRefs: [legacyModelRef] }));
  return { id, stage, receipt, definition, publication, source, record: join(registrationDirectory, "imported", `${id}.json`) };
}

test("The retired order package is absent from the market while published historical imports and their bytes remain usable", async () => fixture(async (root) => {
  const legacy = await historicalOrderImport(root, true);
  const before = await Promise.all([legacy.definition, legacy.record, legacy.publication].map(path => readFile(path)));
  assert.deepEqual(listModelMarket().map(pack => [pack.id, pack.models.length]), [[packageId, 8]]);
  await assert.rejects(importModelMarketPackage({}, { root }, legacyPackageId), { code: "MODEL_PACKAGE_NOT_FOUND" });
  const oldModel = await (await createProjectModelHost({}, { root })).definition(legacyModelRef);
  assert.equal(oldModel.origin, "market");
  assert.equal(oldModel.registration.package, legacyPackageId);
  assert.equal(oldModel.source, legacy.source);
  // A leftover receipt from a successfully published old import removes only staging data.
  assert.deepEqual((await cleanupModelMarketCandidates({}, { root })).cleanedModelRefs, [legacyModelRef]);
  await assert.rejects(readFile(legacy.receipt), { code: "ENOENT" });
  assert.deepEqual(await Promise.all([legacy.definition, legacy.record, legacy.publication].map(path => readFile(path))), before);
  assert.equal((await importModelMarketPackage({}, { root }, packageId, importOptions(root))).status, "imported");
  assert.equal((await (await createProjectModelHost({}, { root })).definition(legacyModelRef)).source, legacy.source);
  assert.deepEqual(await readFile(legacy.record), before[1]);
}));

test("Unpublished candidates from the retired order package remain invisible and can still be cleaned", async () => fixture(async (root) => {
  const legacy = await historicalOrderImport(root, false);
  assert.equal((await (await createProjectModelHost({}, { root })).list()).some(model => model.id === legacyModelRef), false);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, importOptions(root)), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
  assert.deepEqual((await cleanupModelMarketCandidates({}, { root })).cleanedModelRefs, [legacyModelRef]);
  for (const path of [legacy.receipt, legacy.record, legacy.definition]) await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.equal((await importModelMarketPackage({}, { root }, packageId, importOptions(root))).status, "imported");
}));

test("Legacy cleanup rejects unrecognized package identities without deleting candidate or imported data", async () => fixture(async (root) => {
  const legacy = await historicalOrderImport(root, false);
  for (const receipt of [
    { packageId: "unknown.package", recordIds: [legacy.id], modelRefs: [legacyModelRef] },
    { packageId: legacyPackageId, recordIds: [legacy.id], modelRefs: [modelRef] },
    { packageId: legacyPackageId, recordIds: [], modelRefs: [legacyModelRef] }
  ]) {
    await writeFile(legacy.receipt, JSON.stringify(receipt));
    const before = await Promise.all([legacy.receipt, legacy.record, legacy.definition].map(path => readFile(path)));
    await assert.rejects(cleanupModelMarketCandidates({}, { root }), /Unrecognized candidate package/);
    assert.deepEqual(await Promise.all([legacy.receipt, legacy.record, legacy.definition].map(path => readFile(path))), before);
  }
}));

test("Market source is shipped as catalog assets; import binds the independent model DataStore and repeated import preserves records", async () => fixture(async (root) => {
  const pack = listModelMarket()[0]!;
  assert.equal(pack.id, packageId);
  const before = await createProjectModelHost({}, { root });
  assert.equal((await before.list()).some(m => m.id === modelRef), false);
  const result = await importModelMarketPackage({}, { root }, packageId, importOptions(root));
  assert.equal(result.status, "imported");
  const host = await createProjectModelHost({}, { root });
  const model = await host.definition(modelRef);
  assert.equal(model.source, pack.models.find(model => model.registration.modelRef === modelRef)!.source);
  assert.equal(model.origin, "market");
  assert.equal(model.registration.store_id, "models/imported/json-schema/draft-07");
  assert.equal((await host.runtime(modelRef)).descriptor.id, modelRef);
  const state = await readModelRegistrations({}, { root });
  const bytes = await readFile(join(root, "models/registrations/imported", `${state.records[0]!.id}.json`));
  assert.equal((await importModelMarketPackage({}, { root }, packageId, importOptions(root))).status, "unchanged");
  assert.deepEqual(await readFile(join(root, "models/registrations/imported", `${state.records[0]!.id}.json`)), bytes);
  // Migration preserves exact imported definition bytes and stable Store/model identity.
  const target = { storeId: "next", stores: { next: { factory: "memsphere/filesystem-json" as const, directory: "next-registry" } } };
  await prepareModelRegistrationMigration({}, { root }, target, { migrate: true });
  const migrated = await createProjectModelHost({}, { root, modelRegistration: target });
  assert.equal((await migrated.definition(modelRef)).source, model.source);
  assert.equal((await migrated.definition(modelRef)).registration.store_id, model.registration.store_id);
}));
test("The complete eight-example package rejects unsupported Runtime definitions before writing any model", async () => fixture(async (root) => {
  const pack = listModelMarket().find(pack => pack.id === "memsphere.examples")!;
  assert.equal(pack.models.length, 8);
  await assert.rejects(importModelMarketPackage({}, { root }, pack.id), { code: "MODEL_RUNTIME_UNSUPPORTED" });
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  await assert.rejects(readFile(join(root, "models/registrations/published-imports.json")), { code: "ENOENT" });
  assert.equal((await (await createProjectModelHost({}, { root })).list()).length, 0);
}));

test("Supported package imports block partial reads before publication and roll back every record on failure", async () => fixture(async (root) => {
  await assert.rejects(importModelMarketPackage({}, { root }, "memsphere.examples", { ...importOptions(root), beforePublish: async () => {
    await assert.rejects(createProjectModelHost({}, { root }), { code: "MODEL_OPERATION_PENDING" });
    throw new Error("injected eight-model failure");
  } }), /injected eight-model failure/);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  assert.equal((await importModelMarketPackage({}, { root }, "memsphere.examples", importOptions(root))).status, "imported");
}));

test("A collision within a supported package preserves the project model and imports none", async () => fixture(async (root) => {
  const id = "examples/06-references-and-recursion.json";
  const filename = join(root, DEFAULT_MODELS_DIRECTORY, id);
  await mkdir(join(filename, ".."), { recursive: true });
  const custom = '\uFEFF {"type":"boolean","title":"My custom model"}\r\n';
  await writeFile(filename, custom);
  await assert.rejects(importModelMarketPackage({}, { root }, "memsphere.examples", importOptions(root)), { code: "MODEL_PACKAGE_CONFLICT", conflicts: [id] });
  assert.equal(await readFile(filename, "utf8"), custom);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  const summaries = await (await createProjectModelHost({}, { root })).list();
  assert.equal(summaries.filter(model => model.origin === "market").length, 0);
  assert.equal(summaries.find(model => model.id === id)!.origin, "project");
}));
test("A user-modified imported registration rejects the whole repeated import without replacing content", async () => fixture(async (root) => {
  await importModelMarketPackage({}, { root }, packageId, importOptions(root));
  const state = await readModelRegistrations({}, { root });
  const record = state.records.find(record => record.registration.modelRef === modelRef)!;
  const store = await createModelRegistrationStore({}, "market", join(root, "models/registrations/imported"));
  await store.update({}, record.id, { ...record.registration, name: "My order", tags: ["custom"] });
  const filename = join(root, "models/registrations/imported", `${record.id}.json`);
  const bytes = await readFile(filename);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, importOptions(root)), { code: "MODEL_PACKAGE_CONFLICT" });
  assert.deepEqual(await readFile(filename), bytes);
  assert.equal((await (await createProjectModelHost({}, { root })).definition(modelRef)).registration.name, "My order");
}));
test("Project identity collision refuses import and preserves original definition bytes", async () => fixture(async (root) => {
  const path = join(root, DEFAULT_MODELS_DIRECTORY, modelRef);
  await mkdir(join(path, ".."), { recursive: true });
  const source = '\uFEFF  {"type":"string"}\r\n';
  await writeFile(path, source);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, importOptions(root)), { code: "MODEL_PACKAGE_CONFLICT" });
  assert.equal(await readFile(path, "utf8"), source);
  assert.equal((await (await createProjectModelHost({}, { root })).definition(modelRef)).origin, "project");
}));
test("An interrupted publication blocks partial reads and rolls back before a clean retry", async () => fixture(async (root) => {
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, { ...importOptions(root), beforePublish: async () => {
    await assert.rejects(createProjectModelHost({}, { root }), { code: "MODEL_OPERATION_PENDING" });
    throw new Error("injected publication failure");
  } }), /injected/);
  assert.equal((await (await createProjectModelHost({}, { root })).list()).some(m => m.id === modelRef), false);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  assert.equal((await importModelMarketPackage({}, { root }, packageId, importOptions(root))).status, "imported");
}));

test("Failure while preparing a candidate leaves no partially published models and allows retry", async () => fixture(async (root) => {
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, { ...importOptions(root), afterStage: async () => { throw new Error("injected candidate failure"); } }), /injected candidate/);
  assert.equal((await (await createProjectModelHost({}, { root })).list()).some(m => m.id === modelRef), false);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  assert.equal((await importModelMarketPackage({}, { root }, packageId, importOptions(root))).status, "imported");
}));
