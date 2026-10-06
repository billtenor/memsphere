import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { listModels, mutateModel, readModel, validateModel } from "../src/project/model-service.js";
import { initializeProjectModelRegistrations, readModelRegistrations, createModelRegistrationStore } from "../src/project/model-registration.js";
import { createBusinessStore, removeBusinessStore } from "../src/project/business-stores.js";
import { writeData } from "../src/project/data-service.js";
import { importModelMarketPackage } from "../src/project/model-market.js";
import { bundledReservedModelsRoot } from "../src/reserved/models.js";
import { businessFixture, objectSchema, snapshotTree } from "./helpers/business-data.js";

const source = '\uFEFF {\r\n "title": "Schema title", "description":"Schema description", "type":"string"\r\n}\r\n';
const location = (root: string, ref: string) => join(root, "models/json-schema/draft-07", ref);
const assertCode = (code: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === code;

// Compare complete file contents, directory membership and modification times where the contract promises zero writes.
test("model CRUD preserves definition bytes, registration identity and omitted metadata", async t => {
  const f = await businessFixture(t, {});
  const created = await mutateModel({}, f.root, "create", "sales/order.json", { source, fields: { name: "Managed", description: "Managed description", tags: ["one", "two"] } });
  assert.equal(created.modelRef, "sales/order.json");
  assert.equal(await fs.readFile(location(f.root, "sales/order.json"), "utf8"), source);
  const records = (await readModelRegistrations({}, { root: f.root })).records;
  assert.equal(records.length, 1); const id = records[0]!.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await readModel({}, f.root, "sales/order.json"), { modelRef: "sales/order.json", definition: JSON.parse(source.slice(1)) });
  const all = await readModel({}, f.root, "sales/order.json", "all");
  assert.equal(all.origin, "project"); assert.equal(all.registration?.name, "Managed");
  assert.equal((await readModel({}, f.root, "sales/order.json", "registration")).definition, undefined);
  await mutateModel({}, f.root, "update", "sales/order.json", { fields: { tags: ["replacement"] } });
  const changed = (await readModel({}, f.root, "sales/order.json", "all")).registration!;
  assert.equal(changed.name, "Managed"); assert.equal(changed.description, "Managed description"); assert.deepEqual(changed.tags, ["replacement"]);
  assert.equal((await readModelRegistrations({}, { root: f.root })).records[0]!.id, id);
  assert.equal(await fs.readFile(location(f.root, "sales/order.json"), "utf8"), source);
  await assert.rejects(mutateModel({}, f.root, "create", "sales/order.json", { source: '{"type":"number"}' }), assertCode("ALREADY_EXISTS"));
  await mutateModel({}, f.root, "delete", "sales/order.json");
  await assert.rejects(fs.readFile(location(f.root, "sales/order.json")), { code: "ENOENT" });
  assert.equal((await readModelRegistrations({}, { root: f.root })).records.length, 0);
  await assert.rejects(readModel({}, f.root, "sales/order.json"), assertCode("MODEL_NOT_FOUND"));
});

test("management unset, tags and shared package names are checked without rewriting definitions", async t => {
  const f = await businessFixture(t, {});
  await mutateModel({}, f.root, "create", "a.json", { source, fields: { package: "sales", package_name: "Sales", description: "", tags: ["old"] } });
  await mutateModel({}, f.root, "create", "b.json", { source, fields: { package: "sales", package_name: "Sales" } });
  const before = await snapshotTree(join(f.root, "models"));
  for (const input of [
    { fields: { package_name: "Other" } }, { fields: { tags: ["same", "same"] } },
    { fields: { name: "name" }, unset: ["name"] }, { unset: ["tags", "tags"] },
    { unset: ["modelRef"] }, { unset: ["package"], fields: { package_name: "No package" } }
  ]) await assert.rejects(mutateModel({}, f.root, "update", "a.json", input));
  assert.deepEqual(await snapshotTree(join(f.root, "models")), before);
  await mutateModel({}, f.root, "update", "a.json", { unset: ["description", "package", "tags"] });
  const saved = await readModel({}, f.root, "a.json", "all");
  assert.equal(Object.hasOwn(saved.registration!, "description"), false);
  assert.equal(Object.hasOwn(saved.registration!, "package"), false);
  assert.equal(Object.hasOwn(saved.registration!, "package_name"), false);
  assert.equal(Object.hasOwn(saved.registration!, "tags"), false);
  assert.equal((saved.definition as { description: string }).description, "Schema description");
  await assert.rejects(mutateModel({}, f.root, "update", "a.json", { fields: { package_name: "Orphan" } }), /requires package/);
  assert.equal(await fs.readFile(location(f.root, "a.json"), "utf8"), source);
});

test("create and update distinguish invalid definitions, Runtime limits and references and never publish rejected bytes", async t => {
  const f = await businessFixture(t, {});
  await mutateModel({}, f.root, "create", "good.json", { source });
  const cases = [
    ['{"required":42}', "MODEL_DEFINITION_INVALID"],
    ['{"type":"string","format":"email"}', "MODEL_RUNTIME_UNSUPPORTED"],
    ['{"type":"object","properties":{"x":{"$ref":"other.json"}}}', "MODEL_REFERENCE_UNSUPPORTED"],
    ['{"type":"object","properties":{"x":{"$ref":"#/definitions/missing"}}}', "MODEL_REFERENCE_INVALID"]
  ];
  for (const [candidate, code] of cases) {
    const before = await snapshotTree(join(f.root, "models"));
    for (const operation of ["create", "update"] as const) {
      await assert.rejects(mutateModel({}, f.root, operation, operation === "create" ? "new.json" : "good.json", { source: candidate }), assertCode(code!));
    }
    assert.deepEqual(await snapshotTree(join(f.root, "models")), before);
  }
  await assert.rejects(mutateModel({}, f.root, "update", "good.json"), assertCode("INVALID_ARGUMENT"));
  for (const ref of ["missing-suffix", "../outside.json", "/absolute.json", "a\\b.json", "a.JSON"]) {
    await assert.rejects(mutateModel({}, f.root, "create", ref, { source }), assertCode("MODEL_ID_INVALID"));
  }
  await mutateModel({}, f.root, "create", "local.json", { source: JSON.stringify({ type: "object", properties: { x: { $ref: "#/definitions/value" } }, definitions: { value: { type: "string" } }, examples: [{ $ref: "ordinary-data.json" }] }) });
  assert.equal((await readModel({}, f.root, "local.json")).modelRef, "local.json");
});

test("all system model writes including metadata and dry-run reject before creating files", async t => {
  const f = await businessFixture(t, {});
  await initializeProjectModelRegistrations({}, { root: f.root });
  const systems = (await listModels({}, f.root, { origin: "system" })).items;
  assert.equal(systems.length, 5);
  const before = await snapshotTree(f.root);
  for (const system of systems) {
    for (const operation of ["create", "update", "delete"] as const) {
      for (const dryRun of [false, true]) await assert.rejects(mutateModel({}, f.root, operation, system.id, {
        source: '{"type":"string"}', fields: { name: "changed", description: "changed", package: "changed", package_name: "changed", tags: ["changed"] }, unset: ["name"], dryRun
      }), assertCode("SYSTEM_MODEL_READ_ONLY"));
    }
  }
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("empty direct Store bindings protect definitions and deletion while unchanged definitions and metadata remain editable", async t => {
  const f = await businessFixture(t);
  await f.createStore("empty-values"); await f.createStore("empty-files", "record.json", "data");
  const before = await snapshotTree(join(f.root, "models"));
  for (const operation of ["update", "delete"] as const) await assert.rejects(mutateModel({}, f.root, operation, "record.json", { source: '{"type":"string"}' }), error => {
    assert.equal((error as { code: string }).code, "MODEL_IN_USE");
    assert.deepEqual((error as { details: { storeIds: string[] } }).details.storeIds.sort(), ["empty-files", "empty-values"]); return true;
  });
  assert.deepEqual(await snapshotTree(join(f.root, "models")), before);
  const reformatted = `\uFEFF ${JSON.stringify(objectSchema, null, 3)}\r\n`;
  await mutateModel({}, f.root, "update", "record.json", { source: reformatted, fields: { name: "Allowed metadata" } });
  assert.equal(await fs.readFile(location(f.root, "record.json"), "utf8"), reformatted);
  await removeBusinessStore({}, f.root, "empty-values"); await removeBusinessStore({}, f.root, "empty-files");
  await mutateModel({}, f.root, "delete", "record.json");
  assert.deepEqual(await fs.readdir(join(f.root, "data/empty-files")), []);
});

test("unavailable definitions can be replaced or deleted but metadata-only changes cannot bypass complete checks", async t => {
  const f = await businessFixture(t, {});
  const invalid = ["{broken", '{"type":"string","format":"email"}', '{"$ref":"other.json"}'];
  for (const [index, bad] of invalid.entries()) {
    const ref = `bad-${index}.json`; await fs.writeFile(location(f.root, ref), bad);
    await assert.rejects(mutateModel({}, f.root, "update", ref, { fields: { name: "No bypass" } }));
    assert.equal(await fs.readFile(location(f.root, ref), "utf8"), bad);
    await mutateModel({}, f.root, "update", ref, { source });
    assert.equal((await readModel({}, f.root, ref)).modelRef, ref);
    await fs.writeFile(location(f.root, ref), bad);
    await mutateModel({}, f.root, "delete", ref);
    await assert.rejects(fs.readFile(location(f.root, ref)), { code: "ENOENT" });
  }
  await fs.writeFile(location(f.root, "bound.json"), '{"type":"string"}');
  await createBusinessStore({}, f.root, "bound", { model: "bound.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/bound" } });
  await fs.writeFile(location(f.root, "bound.json"), "{broken");
  await assert.rejects(mutateModel({}, f.root, "delete", "bound.json"), assertCode("MODEL_IN_USE"));
  await assert.rejects(mutateModel({}, f.root, "update", "bound.json", { source }), assertCode("MODEL_IN_USE"));
});

test("definition-only diagnostics permit unsupported candidates and saved definitions without granting normal access", async t => {
  const f = await businessFixture(t, { "advanced.json": { anyOf: [{ type: "string" }, { type: "number" }] } });
  const before = await snapshotTree(f.root);
  const saved = await validateModel({}, f.root, "advanced.json", { check: "definition" });
  assert.deepEqual(saved.checks, { definition: "passed", runtime: "not_checked" });
  const candidate = await validateModel({}, f.root, "not-saved.json", { source: '{"anyOf":[{"type":"string"},{"type":"number"}]}', check: "definition" });
  assert.equal(candidate.valid, true);
  await assert.rejects(validateModel({}, f.root, "advanced.json"), assertCode("MODEL_RUNTIME_UNSUPPORTED"));
  await assert.rejects(readModel({}, f.root, "advanced.json", "registration"), assertCode("MODEL_RUNTIME_UNSUPPORTED"));
  assert.deepEqual((await listModels({}, f.root, { status: "unavailable" })).items.map(item => item.id), ["advanced.json"]);
  await assert.rejects(validateModel({}, f.root, "not-saved.json", { source: '{"$ref":"missing.json"}', check: "definition" }), assertCode("MODEL_REFERENCE_UNSUPPORTED"));
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("check-data validates both Store kinds against the candidate, identifies failures and does not save it", async t => {
  const f = await businessFixture(t);
  await f.createStore(); await f.createStore("files", "record.json", "data");
  await writeData({}, f.root, "records", "one", "create", { kind: "value", value: { name: "one", count: 1 } });
  await writeData({}, f.root, "files", "two.json", "create", { kind: "value", value: { name: "two", count: 2 } });
  const before = await snapshotTree(f.root);
  const checked = await validateModel({}, f.root, "record.json", { checkData: true });
  assert.equal(checked.snapshot, false); assert.deepEqual(checked.data?.map(item => [item.storeId, item.checked]), [["records", 1], ["files", 1]]);
  const narrowed = JSON.stringify({ ...objectSchema, properties: { ...objectSchema.properties, count: { type: "integer", maximum: 0 } } });
  await assert.rejects(validateModel({}, f.root, "record.json", { source: narrowed, checkData: true }), error => {
    assert.equal((error as { code: string }).code, "DATA_VALIDATION_FAILED");
    const data = (error as { details: { data: { storeId: string; failures: { id: string }[] }[]; snapshot: boolean } }).details;
    assert.equal(data.snapshot, false); assert.deepEqual(data.data.map(item => item.failures.map(failure => failure.id)), [["one"], ["two.json"]]); return true;
  });
  const single = await validateModel({}, f.root, "record.json", { checkData: true, stores: ["records", "records"] });
  assert.equal(single.data?.length, 1);
  await assert.rejects(validateModel({}, f.root, "record.json", { checkData: true, stores: ["unknown"] }), assertCode("STORE_MODEL_MISMATCH"));
  await assert.rejects(validateModel({}, f.root, "record.json", { checkData: true, check: "definition" }), assertCode("INVALID_ARGUMENT"));
  await assert.rejects(validateModel({}, f.root, "record.json", { stores: ["records"] }), assertCode("INVALID_ARGUMENT"));
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("read diagnostics and create/update/delete dry-run preserve directories, bytes and modification times", async t => {
  const f = await businessFixture(t);
  const before = await snapshotTree(f.root);
  await listModels({}, f.root); await readModel({}, f.root, "record.json"); await validateModel({}, f.root, "record.json");
  for (const [operation, ref, input] of [
    ["create", "new/nested.json", { source }], ["update", "record.json", { fields: { name: "Candidate" } }], ["delete", "record.json", {}]
  ] as const) assert.equal((await mutateModel({}, f.root, operation, ref, { ...input, dryRun: true })).dryRun, true);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("market models retain their origin and storage on update and deletion removes their publication entry", async t => {
  const f = await businessFixture(t, {});
  const sourceRoot = join(f.directory, "catalog"); await fs.cp(bundledReservedModelsRoot(), sourceRoot, { recursive: true });
  const manifestPath = join(sourceRoot, "manifest.json"); const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const pack = manifest.market_packages[0];
  for (const entry of pack.models) if (entry.registration.modelRef !== "examples/07-scalar-enum-root.json") await fs.rm(join(sourceRoot, entry.source));
  pack.models = pack.models.filter((entry: { registration: { modelRef: string } }) => entry.registration.modelRef === "examples/07-scalar-enum-root.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await importModelMarketPackage({}, { root: f.root }, pack.id, { sourceRoot });
  const ref = "examples/07-scalar-enum-root.json";
  await fs.mkdir(join(f.root, "models/json-schema/draft-07/examples"), { recursive: true });
  await fs.writeFile(location(f.root, ref), '{"type":"boolean"}');
  const conflict = await snapshotTree(join(f.root, "models"));
  for (const operation of ["update", "delete"] as const) await assert.rejects(mutateModel({}, f.root, operation, ref, { source }), /duplicate/i);
  assert.deepEqual(await snapshotTree(join(f.root, "models")), conflict);
  await fs.rm(location(f.root, ref));
  await mutateModel({}, f.root, "update", ref, { fields: { name: "Imported status" } });
  const updated = await readModel({}, f.root, ref, "all");
  assert.equal(updated.origin, "market"); assert.equal(updated.registration?.store_id, "models/imported/json-schema/draft-07");
  await mutateModel({}, f.root, "delete", ref);
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.root, "models/registrations/published-imports.json"), "utf8")).recordIds, []);
  assert.equal((await listModels({}, f.root, { origin: "market" })).items.length, 0);
  await assert.rejects(fs.readFile(join(f.root, "models/registrations/imported-definitions", ref)), { code: "ENOENT" });
});


test("repair and deletion never bypass invalid registration storage bindings", async t => {
  for (const invalidBinding of ["unknown-store", "builtin"] as const) {
    const f = await businessFixture(t, {});
    await mutateModel({}, f.root, "create", "damaged-binding.json", { source });
    const record = (await readModelRegistrations({}, { root: f.root })).records[0]!;
    const store = await createModelRegistrationStore({}, "fixture", join(f.root, "models/registrations/project"));
    await store.update({}, record.id, invalidBinding === "unknown-store"
      ? { ...record.registration, store_id: "unrecognized-definition-store" }
      : { modelRef: "damaged-binding.json", storage: "builtin" });
    const before = await snapshotTree(join(f.root, "models"));
    for (const operation of ["update", "delete"] as const) await assert.rejects(
      mutateModel({}, f.root, operation, "damaged-binding.json", { source: '{"type":"number"}' }), /binding|storage|registration/i);
    assert.deepEqual(await snapshotTree(join(f.root, "models")), before);
  }
});

test("candidate validation preserves the existing raw model standard instead of treating every file as a business Schema", async t => {
  const f = await businessFixture(t, {});
  await initializeProjectModelRegistrations({}, { root: f.root });
  const before = await snapshotTree(f.root);
  const valid = await validateModel({}, f.root, "memsphere/run/artifact.json", { source: "{}" });
  assert.deepEqual(valid.checks, { definition: "passed", runtime: "passed" });
  await assert.rejects(validateModel({}, f.root, "memsphere/run/artifact.json", { source: '{"type":"string"}' }), assertCode("MODEL_DEFINITION_INVALID"));
  assert.deepEqual(await snapshotTree(f.root), before);
});
