import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readBundledSystemModels } from "../src/reserved/models.js";
import { initializeProjectModelRegistrations, upgradeProjectModelRegistrations, readModelRegistrations, withModelRegistrationMaintenance } from "../src/project/model-registration.js";
import { createProjectModelHost } from "../src/project/models.js";
import { RAW_MODEL } from "../src/data/extensions/raw/index.js";

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "model-upgrade-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const upgrade = (root: string, options = {}) => withModelRegistrationMaintenance(root, () => upgradeProjectModelRegistrations({}, { root }, options));
const definitionPath = (root: string, model: ReturnType<typeof readBundledSystemModels>[number]) => join(root, "models/registrations/system/definitions", model.metaModel === RAW_MODEL ? "raw" : "json-schema/draft-07", model.registration.modelRef);
async function envelopeFor(root: string, ref: string) {
  const record = (await readModelRegistrations({}, { root })).records.find(item => item.registration.modelRef === ref)!;
  const path = join(root, "models/registrations", record.origin === "system" ? "system/registrations" : "project", `${record.id}.json`);
  return { path, envelope: JSON.parse(await readFile(path, "utf8")) };
}

test("explicit upgrade replaces real system definitions and full release metadata, retains envelope and user bytes, and is idempotent", async () => fixture(async root => {
  const userPath = join(root, "models/json-schema/draft-07/customer.json");
  await mkdir(dirname(userPath), { recursive: true });
  const source = '\uFEFF  {"type":"string", "title":"User"}\r\n';
  await writeFile(userPath, source);
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels().find(model => model.metaModel === RAW_MODEL)!;
  await writeFile(definitionPath(root, model), '{"description":"former release definition"}');
  const { path, envelope } = await envelopeFor(root, model.registration.modelRef);
  envelope.createdBy = "original-author";
  envelope.value = { ...envelope.value, name: "former release", description: "old", tags: ["old"], package_name: "old package" };
  await writeFile(path, JSON.stringify(envelope));
  const userRegistration = await envelopeFor(root, "customer.json");
  const userBytes = await readFile(userRegistration.path);
  const history = join(root, "runs/frozen/history.md");
  await mkdir(dirname(history), { recursive: true });
  await writeFile(history, "frozen Run bytes\n");
  await assert.rejects(initializeProjectModelRegistrations({}, { root }), /conflicts/);
  const result = await upgrade(root);
  assert.equal(result.system.status, "upgraded");
  assert.equal(result.system.updated, 1);
  assert.equal(result.changed, true);
  assert.equal(await readFile(definitionPath(root, model), "utf8"), model.source);
  const updated = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(updated.value, model.registration);
  assert.equal(updated.id, envelope.id);
  assert.equal(updated.createdAt, envelope.createdAt);
  assert.equal(updated.createdBy, envelope.createdBy);
  assert.equal(updated.revision, envelope.revision + 1);
  assert.equal(await readFile(userPath, "utf8"), source);
  assert.deepEqual(await readFile(userRegistration.path), userBytes);
  assert.equal(await readFile(history, "utf8"), "frozen Run bytes\n");
  const once = await readFile(path);
  const stamp = await readFile(join(root, ".runtime/model-operation.json"));
  const second = await upgrade(root);
  assert.equal(second.changed, false);
  assert.equal(second.system.status, "unchanged");
  assert.deepEqual(await readFile(path), once);
  assert.deepEqual(await readFile(join(root, ".runtime/model-operation.json")), stamp);
}));

test("metadata-only system upgrades count as changes without touching definition bytes", async () => fixture(async root => {
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels()[0]!;
  const definition = await readFile(definitionPath(root, model));
  const { path, envelope } = await envelopeFor(root, model.registration.modelRef);
  delete envelope.value.description;
  envelope.value.tags = ["obsolete"];
  await writeFile(path, JSON.stringify(envelope));
  const result = await upgrade(root);
  assert.equal(result.system.updated, 1);
  assert.equal(result.changed, true);
  assert.deepEqual(await readFile(definitionPath(root, model)), definition);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).value, model.registration);
}));

test("upgrade fills missing owned system definitions and registrations, preserving surviving UUID", async () => fixture(async root => {
  await initializeProjectModelRegistrations({}, { root });
  const models = readBundledSystemModels();
  const first = await envelopeFor(root, models[0]!.registration.modelRef);
  const second = await envelopeFor(root, models[1]!.registration.modelRef);
  await rm(definitionPath(root, models[0]!));
  await rm(second.path);
  const result = await upgrade(root);
  assert.equal(result.system.created, 2);
  assert.equal(JSON.parse(await readFile(first.path, "utf8")).id, first.envelope.id);
  assert.equal((await readModelRegistrations({}, { root })).diagnostics.length, 0);
  assert.equal((await createProjectModelHost({}, { root })).initialized, true);
}));

test("damaged definitions, unknown System resources and user identity collisions fail before target writes", async () => fixture(async root => {
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels()[0]!;
  const path = definitionPath(root, model);
  const registration = await envelopeFor(root, model.registration.modelRef);
  await writeFile(path, "broken json");
  const before = await readFile(registration.path);
  await assert.rejects(upgrade(root), SyntaxError);
  assert.equal(await readFile(path, "utf8"), "broken json");
  assert.deepEqual(await readFile(registration.path), before);
  await writeFile(path, model.source);
  const unknown = join(root, "models/registrations/system/definitions/raw/unknown.json");
  await mkdir(dirname(unknown), { recursive: true });
  await writeFile(unknown, '{}');
  await assert.rejects(upgrade(root), /Unexpected system model definition/);
  await rm(unknown);
  const collision = join(root, "models/json-schema/draft-07", model.registration.modelRef);
  await mkdir(dirname(collision), { recursive: true });
  await writeFile(collision, '{"type":"string"}');
  await assert.rejects(upgrade(root), /identity conflict/);
  assert.equal(await readFile(collision, "utf8"), '{"type":"string"}');
}));

test("upgrade synchronizes supported legacy registration IDs and config bindings without rewriting user source", async () => fixture(async root => {
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels().find(model => model.metaModel === RAW_MODEL)!;
  const { path, envelope } = await envelopeFor(root, model.registration.modelRef);
  envelope.value.modelRef = model.registration.modelRef.slice(0, -5);
  await writeFile(path, JSON.stringify(envelope));
  const configPath = join(root, "config.json");
  const value = { store: { type: "managed", published_revision: "initial", branch: "master" }, dataStores: {
    history: { model: model.registration.modelRef.slice(0, -5), kind: "data", factory: "memsphere/filesystem", config: { directory: "business/history" } }
  } };
  await writeFile(configPath, JSON.stringify(value));
  await upgrade(root, { config: { path: configPath, value } });
  const actual = JSON.parse(await readFile(path, "utf8"));
  assert.equal(actual.value.modelRef, model.registration.modelRef);
  assert.equal(actual.id, envelope.id);
  assert.equal(actual.revision, envelope.revision + 1);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).dataStores.history.model, model.registration.modelRef);
}));

test("bound incompatible business records reject upgrade without overwriting candidate System bytes", async () => fixture(async root => {
  const user = join(root, "models/json-schema/draft-07/order.json");
  await mkdir(dirname(user), { recursive: true });
  await writeFile(user, '{"type":"string"}');
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels().find(model => model.metaModel === RAW_MODEL)!;
  const system = definitionPath(root, model);
  await writeFile(system, '{"description":"old"}');
  const configPath = join(root, "config.json");
  const value = { store: { type: "managed", published_revision: "initial", branch: "master" }, dataStores: { orders: {
    model: "order.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "business/orders" }
  } } };
  await writeFile(configPath, JSON.stringify(value));
  const record = join(root, "business/orders/order.json");
  await mkdir(dirname(record), { recursive: true });
  await writeFile(record, JSON.stringify({ id: "order", revision: 1, createdAt: 1, updatedAt: 1, value: 12 }));
  const bytes = await readFile(record);
  await assert.rejects(upgrade(root, { config: { path: configPath, value } }), /string/);
  assert.equal(await readFile(system, "utf8"), '{"description":"old"}');
  assert.deepEqual(await readFile(record), bytes);
  await writeFile(record, JSON.stringify({ id: "order", revision: 1, createdAt: 1, updatedAt: 1, value: "valid order" }));
  const corrected = await readFile(record);
  await upgrade(root, { config: { path: configPath, value } });
  assert.equal(await readFile(system, "utf8"), model.source);
  assert.deepEqual(await readFile(record), corrected);
}));

test("failed model publication rolls back as one existing logged operation and can be retried", async () => fixture(async root => {
  await initializeProjectModelRegistrations({}, { root });
  const model = readBundledSystemModels().find(model => model.metaModel === RAW_MODEL)!;
  const path = definitionPath(root, model);
  await writeFile(path, '{"description":"old"}');
  const before = await readFile(path);
  await assert.rejects(upgrade(root, { afterSystemInstall: async () => { throw new Error("injected interruption"); } }), /injected interruption/);
  assert.deepEqual(await readFile(path), before);
  assert.equal(JSON.parse(await readFile(join(root, ".runtime/model-operation.json"), "utf8")).phase, "recovered");
  await upgrade(root);
  assert.equal(await readFile(path, "utf8"), model.source);
}));


test("first upgrade installs a system catalog and preserves unbound unsupported user Runtime definitions", async () => fixture(async root => {
  const user = join(root, "models/json-schema/draft-07/display-only.json");
  await mkdir(dirname(user), { recursive: true });
  const source = '{"anyOf":[{"type":"string"},{"type":"number"}]}\n';
  await writeFile(user, source);
  const first = await upgrade(root);
  assert.equal(first.system.status, "installed");
  assert.equal(first.system.created, readBundledSystemModels().length);
  assert.equal(await readFile(user, "utf8"), source);
  const second = await upgrade(root);
  assert.equal(second.changed, false);
  assert.equal(await readFile(user, "utf8"), source);
}));


test("upgrade validates a planned ordinary registration used by an existing Store and preserves its UUID on repeat", async () => fixture(async root => {
  const user = join(root, "models/json-schema/draft-07/order.json");
  await mkdir(dirname(user), { recursive: true });
  const source = '  {"type":"string"}\n';
  await writeFile(user, source);
  const configPath = join(root, "config.json");
  const value = { store: { type: "managed", published_revision: "initial", branch: "master" }, dataStores: { orders: {
    model: "order.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "business/orders" }
  } } };
  await writeFile(configPath, JSON.stringify(value));
  const record = join(root, "business/orders/order.json");
  await mkdir(dirname(record), { recursive: true });
  await writeFile(record, JSON.stringify({ id: "order", revision: 1, createdAt: 1, updatedAt: 1, value: "existing order" }));
  const businessBefore = await readFile(record);
  // A definition without a published registration cannot be used.
  await assert.rejects((await createProjectModelHost({}, { root })).runtime("order.json"), { code: "MODEL_NOT_REGISTERED" });
  const first = await upgrade(root, { config: { path: configPath, value } });
  assert.equal(first.created, 1);
  const registration = await envelopeFor(root, "order.json");
  const registrationBefore = await readFile(registration.path);
  assert.equal(registration.envelope.revision, 1);
  const currentConfig = JSON.parse(await readFile(configPath, "utf8"));
  const second = await upgrade(root, { config: { path: configPath, value: currentConfig } });
  assert.equal(second.changed, false);
  assert.equal(second.created, 0);
  const repeated = await envelopeFor(root, "order.json");
  assert.equal(repeated.envelope.id, registration.envelope.id);
  assert.deepEqual(await readFile(repeated.path), registrationBefore);
  assert.deepEqual(await readFile(record), businessBefore);
  assert.equal(await readFile(user, "utf8"), source);
}));
