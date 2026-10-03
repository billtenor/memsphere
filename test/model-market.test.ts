import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectModelHost, DEFAULT_MODELS_DIRECTORY } from "../src/project/models.js";
import { listModelMarket, importModelMarketPackage, cleanupModelMarketCandidates } from "../src/project/model-market.js";
import { createModelRegistrationStore, prepareModelRegistrationMigration, readModelRegistrations } from "../src/project/model-registration.js";
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "model-market-"));
  try {
    await fn(root);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
}
const packageId = "memsphere.examples.orders";
const modelRef = "memsphere/examples/order.json";
test("Market source is shipped inline; import binds the independent model DataStore and repeated import preserves records", async () => fixture(async (root) => {
  const pack = listModelMarket()[0]!;
  assert.equal(pack.id, packageId);
  const before = await createProjectModelHost({}, { root });
  assert.equal((await before.list()).some(m => m.id === modelRef), false);
  const result = await importModelMarketPackage({}, { root }, packageId);
  assert.equal(result.status, "imported");
  const host = await createProjectModelHost({}, { root });
  const model = await host.definition(modelRef);
  assert.equal(model.source, pack.models[0]!.source);
  assert.equal(model.origin, "market");
  assert.equal(model.registration.store_id, "models/imported/json-schema/draft-07");
  assert.equal((await host.runtime(modelRef)).descriptor.id, modelRef);
  const state = await readModelRegistrations({}, { root });
  const bytes = await readFile(join(root, "models/registrations/imported", `${state.records[0]!.id}.json`));
  assert.equal((await importModelMarketPackage({}, { root }, packageId)).status, "unchanged");
  assert.deepEqual(await readFile(join(root, "models/registrations/imported", `${state.records[0]!.id}.json`)), bytes);
  // Migration preserves exact imported definition bytes and stable Store/model identity.
  const target = { storeId: "next", stores: { next: { factory: "memsphere/filesystem-json" as const, directory: "next-registry" } } };
  await prepareModelRegistrationMigration({}, { root }, target, { migrate: true });
  const migrated = await createProjectModelHost({}, { root, modelRegistration: target });
  assert.equal((await migrated.definition(modelRef)).source, model.source);
  assert.equal((await migrated.definition(modelRef)).registration.store_id, model.registration.store_id);
}));
test("A user-modified imported registration rejects the whole repeated import without replacing content", async () => fixture(async (root) => {
  await importModelMarketPackage({}, { root }, packageId);
  const state = await readModelRegistrations({}, { root });
  const record = state.records[0]!;
  const store = await createModelRegistrationStore({}, "market", join(root, "models/registrations/imported"));
  await store.update({}, record.id, { ...record.registration, name: "My order", tags: ["custom"] });
  const filename = join(root, "models/registrations/imported", `${record.id}.json`);
  const bytes = await readFile(filename);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId), { code: "MODEL_PACKAGE_CONFLICT" });
  assert.deepEqual(await readFile(filename), bytes);
  assert.equal((await (await createProjectModelHost({}, { root })).definition(modelRef)).registration.name, "My order");
}));
test("Project identity collision refuses import and preserves original definition bytes", async () => fixture(async (root) => {
  const path = join(root, DEFAULT_MODELS_DIRECTORY, modelRef);
  await mkdir(join(path, ".."), { recursive: true });
  const source = '\uFEFF  {"type":"string"}\r\n';
  await writeFile(path, source);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId), { code: "MODEL_PACKAGE_CONFLICT" });
  assert.equal(await readFile(path, "utf8"), source);
  assert.equal((await (await createProjectModelHost({}, { root })).definition(modelRef)).origin, "project");
}));
test("Candidates and partially written imports remain invisible; write failures roll back and allow clean retry", async () => fixture(async (root) => {
  let during: boolean | undefined;
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, { beforePublish: async () => { during = (await (await createProjectModelHost({}, { root })).list()).some(m => m.id === modelRef); throw new Error("injected publication failure"); } }), /injected/);
  assert.equal(during, false);
  assert.equal((await (await createProjectModelHost({}, { root })).list()).some(m => m.id === modelRef), false);
  assert.equal((await readModelRegistrations({}, { root })).records.length, 0);
  assert.equal((await importModelMarketPackage({}, { root }, packageId)).status, "imported");
}));
test("Cleanup failure reports pending identities, keeps candidates invisible and blocks ambiguous retry", async () => fixture(async (root) => {
  await assert.rejects(importModelMarketPackage({}, { root }, packageId, { afterStage: async () => { throw new Error("injected stage failure"); }, removeCandidate: async () => { throw new Error("injected cleanup failure"); } }), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
  assert.equal((await (await createProjectModelHost({}, { root })).list()).some(m => m.id === modelRef), false);
  await assert.rejects(importModelMarketPackage({}, { root }, packageId), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
  assert.deepEqual((await cleanupModelMarketCandidates({}, { root })).cleanedModelRefs, [modelRef]);
  assert.equal((await importModelMarketPackage({}, { root }, packageId)).status, "imported");
}));
