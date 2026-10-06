import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createBusinessStore, removeBusinessStore, getBusinessBinding, openBusinessStore } from "../src/project/business-stores.js";
import { writeData, readData, hasData, listData, editData, deleteData, validateData, exportData } from "../src/project/data-service.js";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";
import { filesystemWorker } from "./helpers/filesystem-process.js";
import { initializeProjectModelRegistrations } from "../src/project/model-registration.js";
import { runGit } from "../src/git.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { projectConfigSchema } from "../src/project/model.js";

test("business ValueStores preserve each JSON root type through CRUD and candidate validation", async (t) => {
  const examples = [
    ["null", { type: "null" }, null, null], ["boolean", { type: "boolean" }, false, true],
    ["number", { type: "number" }, 0, 2.5], ["string", { type: "string" }, "", "changed"],
    ["array", { type: "array", items: { type: "integer" } }, [], [1, 2]],
    ["object", { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false }, { value: 1 }, { value: 2 }]
  ] as const;
  const fixture = await businessFixture(t, Object.fromEntries(examples.map(([name, schema]) => [`${name}.json`, schema])));
  for (const [name, _schema, initial, changed] of examples) {
    await fixture.createStore(name, `${name}.json`);
    assert.equal((await validateData({}, fixture.root, { modelRef: `${name}.json`, value: initial, hasValue: true })).valid, true);
    assert.equal((await writeData({}, fixture.root, name, "item", "create", { kind: "value", value: initial })).revision, 1);
    assert.deepEqual((await readData({}, fixture.root, name, "item")).value, initial);
    assert.equal((await writeData({}, fixture.root, name, "item", "update", { kind: "value", value: changed }, { expectedRevision: 1 })).revision, 2);
    assert.deepEqual((await readData({}, fixture.root, name, "item")).value, changed);
    const exported = join(fixture.directory, `${name}-export.json`);
    await exportData({}, fixture.root, name, "item", "json", exported);
    assert.deepEqual(JSON.parse(await fs.readFile(exported, "utf8")), changed);
    assert.equal((await validateData({}, fixture.root, { id: "item", storeId: name })).valid, true);
    assert.deepEqual(await listData({}, fixture.root, name), { items: [{ id: "item" }] });
    assert.equal((await hasData({}, fixture.root, name, "item")).exists, true);
    assert.equal((await deleteData({}, fixture.root, name, "item", { expectedRevision: 2 })).deleted, true);
    assert.equal((await deleteData({}, fixture.root, name, "item")).deleted, false);
    await assert.rejects(readData({}, fixture.root, name, "item"), { code: "NOT_FOUND" });
  }
});

test("edit validates only the final isolated value and failures preserve bytes and revision", async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore();
  await writeData({}, root, "records", "item", "create", { kind: "value", value: { name: "before", count: 1 } });
  const edited = await editData({}, root, "records", "item", [{ op: "remove", path: "/name" }, { op: "add", path: "/name", value: "after" }]);
  assert.equal(edited.revision, 2);
  assert.deepEqual((await readData({}, root, "records", "item")).value, { name: "after", count: 1 });
  const before = await fs.readFile(join(root, "data/records/item.json"));
  for (const patch of [
    [{ op: "replace", path: "/count", value: 4 }, { op: "test", path: "/name", value: "wrong" }],
    [{ op: "replace", path: "/count", value: -1 }], [{ op: "remove", path: "/name" }]
  ]) {
    await assert.rejects(editData({}, root, "records", "item", patch));
    assert.deepEqual(await fs.readFile(join(root, "data/records/item.json")), before);
  }
  await assert.rejects(editData({}, root, "records", "item", [], { expectedRevision: 1 }), { code: "REVISION_CONFLICT" });
  await assert.rejects(writeData({}, root, "records", "item", "update", { kind: "value", value: { name: "lost", count: 0 } }, { expectedRevision: 1 }), { code: "REVISION_CONFLICT" });
  assert.equal((await readData({}, root, "records", "item")).revision, 2);
});

test("read queries distinguish a missing record from empty matches, null and array nodes", async (t) => {
  const { root, createStore } = await businessFixture(t, { "query.json": { type: "object", properties: { nil: { type: "null" }, values: { type: "array", items: { type: "integer" } } } } });
  await createStore("queries", "query.json");
  await writeData({}, root, "queries", "item", "create", { kind: "value", value: { nil: null, values: [1, 2] } });
  assert.deepEqual((await readData({}, root, "queries", "item", { path: "$.missing" })).value, []);
  assert.deepEqual((await readData({}, root, "queries", "item", { path: "$.nil" })).value, [null]);
  assert.deepEqual((await readData({}, root, "queries", "item", { path: "$.values" })).value, [[1, 2]]);
  await assert.rejects(readData({}, root, "queries", "absent", { path: "$.missing" }), { code: "NOT_FOUND" });
  await assert.rejects(readData({}, root, "queries", "item", { metadataOnly: true, path: "$" }), { code: "INVALID_ARGUMENT" });
});

test("Store removal retains data and deletion history for explicit re-registration", async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore();
  const input = { kind: "value" as const, value: { name: "retained", count: 1 } };
  await writeData({}, root, "records", "item", "create", input);
  await deleteData({}, root, "records", "item");
  await writeData({}, root, "records", "kept", "create", input);
  const dataBefore = await snapshotTree(join(root, "data/records"));
  assert.equal((await removeBusinessStore({}, root, "records")).dataRetained, true);
  await assert.rejects(readData({}, root, "records", "kept"), { code: "STORE_NOT_FOUND" });
  assert.deepEqual(await snapshotTree(join(root, "data/records")), dataBefore);
  await createStore();
  assert.deepEqual((await readData({}, root, "records", "kept")).value, input.value);
  assert.equal((await writeData({}, root, "records", "item", "create", input)).revision, 2);
});

test("both filesystem Store kinds retain data in explicitly configured absolute directories outside the Project", async (t) => {
  const { root, directory, createStore } = await businessFixture(t);
  for (const kind of ["value", "data"] as const) {
    const storeId = `external-${kind}`; const external = join(directory, "outside", kind);
    const config = { directory: external }; const id = kind === "value" ? "item" : "item.json";
    const value = { name: storeId, count: 1 };
    assert.equal((await createStore(storeId, "record.json", kind, config)).directory, external);
    await writeData({}, root, storeId, id, "create", { kind: "value", value });
    const reopened = await openBusinessStore({}, root, storeId);
    assert.equal(reopened.directory, external); assert.equal(reopened.binding.config.directory, external);
    assert.deepEqual((await readData({}, root, storeId, id)).value, value);
    assert.equal((await fs.stat(join(external, "item.json"))).isFile(), true);
    const dataBefore = await snapshotTree(external);
    const removed = await removeBusinessStore({}, root, storeId);
    assert.equal(removed.dataRetained, true); assert.equal(removed.directory, external);
    await assert.rejects(openBusinessStore({}, root, storeId), { code: "STORE_NOT_FOUND" });
    assert.deepEqual(await snapshotTree(external), dataBefore);
    await createStore(storeId, "record.json", kind, config);
    assert.deepEqual((await readData({}, root, storeId, id)).value, value);
    assert.deepEqual(await snapshotTree(external), dataBefore);
  }
});

test("parent-relative Store paths resolve from the Registry Project root and cannot alias an existing absolute binding", async (t) => {
  const { root, directory, createStore } = await businessFixture(t);
  for (const kind of ["value", "data"] as const) {
    const storeId = `absolute-${kind}`; const relativeId = `relative-${kind}`;
    const external = join(directory, "outside", kind); const relativeConfig = { directory: `../outside/${kind}` };
    await createStore(storeId, "record.json", kind, { directory: external });
    const before = await snapshotTree(directory);
    await assert.rejects(createStore(relativeId, "record.json", kind, relativeConfig, true), { code: "STORE_PATH_CONFLICT" });
    assert.deepEqual(await snapshotTree(directory), before);
    await removeBusinessStore({}, root, storeId);
    assert.equal((await createStore(relativeId, "record.json", kind, relativeConfig)).directory, external);
    const id = kind === "value" ? "item" : "item.json"; const value = { name: relativeId, count: 2 };
    await writeData({}, root, relativeId, id, "create", { kind: "value", value });
    assert.equal((await getBusinessBinding(root, relativeId)).directory, external);
    assert.deepEqual((await readData({}, root, relativeId, id)).value, value);
    assert.equal((await fs.stat(join(external, "item.json"))).isFile(), true);
  }
});

test("read and every data/Store dry-run preserve the complete Project filesystem tree", async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore();
  const input = { kind: "value" as const, value: { name: "valid", count: 1 } };
  await writeData({}, root, "records", "item", "create", input);
  const before = await snapshotTree(root);
  await createStore("planned", "record.json", "value", { directory: "new/nested/data" }, true);
  await removeBusinessStore({}, root, "records", true);
  await writeData({}, root, "records", "new", "create", input, { dryRun: true });
  await writeData({}, root, "records", "item", "update", input, { dryRun: true, expectedRevision: 1 });
  await editData({}, root, "records", "item", [{ op: "replace", path: "/count", value: 3 }], { dryRun: true });
  await deleteData({}, root, "records", "item", { dryRun: true });
  await readData({}, root, "records", "item"); await hasData({}, root, "records", "missing"); await listData({}, root, "records");
  await validateData({}, root, { id: "item", storeId: "records" });
  assert.deepEqual(await snapshotTree(root), before);
});

test("Store directories resolve at Project root and aliases/overlap/system Store IDs are rejected", async (t) => {
  const { root, directory, createStore } = await businessFixture(t); await createStore();
  assert.equal((await getBusinessBinding(root, "records")).directory, join(root, "data/records"));
  for (const path of ["data/records", "data/records/nested", "data", "models/registrations/system", "memory", "runs", "archives", ".runtime", "backups/model-registration"]) {
    await assert.rejects(createStore("conflict", "record.json", "value", { directory: path }, true), { code: "STORE_PATH_CONFLICT" }, path);
  }
  const alias = join(directory, "alias"); await fs.symlink(join(root, "data/records"), alias, "junction");
  await assert.rejects(createStore("alias", "record.json", "value", { directory: alias }, true), { code: "STORE_PATH_CONFLICT" });
  for (const id of ["models/system/raw", "memsphere/model-registrations", "memsphere/run/artifact/current"]) await assert.rejects(createStore(id), { code: "SYSTEM_STORE_FORBIDDEN" });
});

test("new and already configured Stores apply the same strict Factory/config rules", async (t) => {
  const { root } = await businessFixture(t);
  const configFile = join(root, "config.json"); const original = JSON.parse(await fs.readFile(configFile, "utf8"));
  const valid = { model: "record.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/new" } };
  for (const binding of [
    { ...valid, factory: "unknown" }, { ...valid, factory: "memsphere/filesystem" },
    { ...valid, config: null }, { ...valid, config: [] }, { ...valid, config: { directory: " " } },
    { ...valid, config: { directory: "data/new", unknown: true } },
    { ...valid, kind: "data", factory: "memsphere/filesystem", config: { directory: "data/new", contentTypeExtensions: { "text/plain": [".json"] } } }
  ]) {
    await fs.writeFile(configFile, JSON.stringify(original));
    await assert.rejects(createBusinessStore({}, root, "invalid", binding, true));
    await fs.writeFile(configFile, JSON.stringify({ ...original, dataStores: { invalid: binding } }));
    await assert.rejects(openBusinessStore({}, root, "invalid"));
  }
  await assert.rejects(fs.stat(join(root, "data")), { code: "ENOENT" });
});

test("Embedded Store registration protects Memory in every worktree of its own repository", async (t) => {
  const { root, directory, home, createStore } = await businessFixture(t);
  const repository = join(directory, "repository"); const linked = join(directory, "linked");
  await fs.mkdir(repository);
  await runGit(["init", "-b", "master"], { cwd: repository });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"], { cwd: repository });
  await runGit(["worktree", "add", "-b", "linked-test", linked], { cwd: repository });
  const mainIdentity = await resolveWorkspaceIdentity(repository); const linkedIdentity = await resolveWorkspaceIdentity(linked);
  assert.equal(mainIdentity.kind, "git"); assert.equal(linkedIdentity.kind, "git");
  assert.equal(mainIdentity.key, linkedIdentity.key); assert.notEqual(mainIdentity.instanceKey, linkedIdentity.instanceKey);
  const memoryPath = "embedded-memory";
  const mainMemory = join(repository, memoryPath); const linkedMemory = join(linked, memoryPath);
  await fs.mkdir(mainMemory); await fs.mkdir(linkedMemory);
  const configFile = join(root, "config.json"); const project = JSON.parse(await fs.readFile(configFile, "utf8"));
  project.store = { type: "embedded", repository_path: repository, memory_path: memoryPath };
  await fs.writeFile(configFile, JSON.stringify(project));
  const storeConfigFile = join(directory, "store-config.json");
  await fs.writeFile(storeConfigFile, JSON.stringify({ directory: linkedMemory }));
  const before = await snapshotTree(directory);
  await assert.rejects(createStore("main-memory", "record.json", "value", { directory: mainMemory }, true), { code: "STORE_PATH_CONFLICT" });
  for (const kind of ["value", "data"] as const) {
    await t.test(`linked Memory rejects ${kind} registration`, async () => {
      await assert.rejects(createStore(`linked-${kind}`, "record.json", kind, { directory: linkedMemory }, true), { code: "STORE_PATH_CONFLICT" });
    });
  }
  await t.test("selected Project CLI rejects linked Memory during dry-run", async () => {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
    await assert.rejects(promisify(execFile)(process.execPath, ["--import", loader, cliPath, "--project", "test-project",
      "data", "store", "create", "linked-cli", "--model", "record.json", "--kind", "value", "--factory", "memsphere/filesystem-json",
      "--config-file", storeConfigFile, "--dry-run", "--output", "json"], { cwd: linked, env: { ...process.env, MEMSPHERE_HOME: home } }),
    (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1); assert.equal(failure.stdout, "");
      assert.equal(JSON.parse(failure.stderr).error.code, "STORE_PATH_CONFLICT"); return true;
    });
  });
  assert.deepEqual(await snapshotTree(directory), before);
});

for (const id of ["constructor", "toString"]) {
  test(`a missing Store named ${id} does not resolve an inherited property`, async (t) => {
    const { root, createStore } = await businessFixture(t); await createStore();
    await assert.rejects(getBusinessBinding(root, id), { code: "STORE_NOT_FOUND" });
  });
  test(`an ordinary Store named ${id} can be created and read`, async (t) => {
    const { root, createStore } = await businessFixture(t); await createStore();
    await createStore(id);
    assert.equal((await getBusinessBinding(root, id)).binding.model, "record.json");
    const value = { name: id, count: 1 };
    await writeData({}, root, id, "item", "create", { kind: "value", value });
    assert.deepEqual((await readData({}, root, id, "item")).value, value);
  });
}

test("the unrepresentable __proto__ Store ID is rejected for both creation and existing configuration", async (t) => {
  const { root, createStore } = await businessFixture(t);
  const before = await snapshotTree(root);
  for (const dryRun of [true, false]) {
    await t.test(`new binding dryRun=${dryRun}`, async () => {
      await assert.rejects(createStore("__proto__", "record.json", "value", { directory: "data/proto" }, dryRun), { code: "INVALID_ARGUMENT" });
    });
  }
  assert.deepEqual(await snapshotTree(root), before);
  const configFile = join(root, "config.json"); const project = JSON.parse(await fs.readFile(configFile, "utf8"));
  project.dataStores = JSON.parse('{"__proto__":{"model":"record.json","kind":"value","factory":"memsphere/filesystem-json","config":{"directory":"data/proto"}}}');
  assert.equal(Object.hasOwn(project.dataStores, "__proto__"), true);
  assert.equal(projectConfigSchema.safeParse(project).success, false, "existing __proto__ must be rejected, not silently dropped");
});

test("opaque DataStore bytes and MIME survive export and re-registration without invented CAS", async (t) => {
  const { root, directory, createStore } = await businessFixture(t);
  await createStore("payloads", "record.json", "data", { directory: "data/payloads", contentTypeExtensions: { "application/x-ndjson": [".jsonl"] } });
  const bytes = new Uint8Array([0, 255, 128, 10, 0]);
  await writeData({}, root, "payloads", "opaque.jsonl", "create", { kind: "payload", contentType: "application/x-ndjson", bytes });
  const metadata = await readData({}, root, "payloads", "opaque.jsonl", { metadataOnly: true });
  assert.equal(metadata.contentType, "application/x-ndjson"); assert.equal("revision" in metadata, false); assert.equal("value" in metadata, false);
  await assert.rejects(readData({}, root, "payloads", "opaque.jsonl"), { code: "UNSUPPORTED_CAPABILITY" });
  await assert.rejects(editData({}, root, "payloads", "opaque.jsonl", []), { code: "UNSUPPORTED_CAPABILITY" });
  await assert.rejects(deleteData({}, root, "payloads", "opaque.jsonl", { expectedRevision: 1 }), { code: "UNSUPPORTED_CAPABILITY" });
  const target = join(directory, "export.bin");
  await exportData({}, root, "payloads", "opaque.jsonl", "payload", target);
  assert.deepEqual(await fs.readFile(target), Buffer.from(bytes));
  await assert.rejects(exportData({}, root, "payloads", "opaque.jsonl", "payload", target), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile(target), Buffer.from(bytes));
  await removeBusinessStore({}, root, "payloads");
  await createStore("payloads", "record.json", "data", { directory: "data/payloads", contentTypeExtensions: { "application/x-ndjson": [".jsonl"] } });
  assert.equal((await hasData({}, root, "payloads", "opaque.jsonl")).exists, true);
});

test("DataStore registration refuses unknown implementation metadata and symlink contents", async (t) => {
  const { root, directory, createStore } = await businessFixture(t);
  const unknown = join(root, "data/unknown"); await fs.mkdir(unknown, { recursive: true });
  await fs.writeFile(join(unknown, ".memsphere-foreign-metadata"), "must retain");
  await assert.rejects(createStore("unknown", "record.json", "data", { directory: unknown }, true), { code: "STORE_INCOMPATIBLE" });
  const linked = join(root, "data/linked"); await fs.mkdir(linked);
  const foreign = join(directory, "outside"); await fs.mkdir(foreign);
  await fs.symlink(foreign, join(linked, "link"), "junction");
  await assert.rejects(createStore("linked", "record.json", "data", { directory: linked }, true), { code: "STORE_INCOMPATIBLE" });
  assert.equal(await fs.readFile(join(unknown, ".memsphere-foreign-metadata"), "utf8"), "must retain");
});

test("data pagination binds cursors to Store and allows changing page size", async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore(); await createStore("other");
  for (const id of ["c", "a", "b"]) await writeData({}, root, "records", id, "create", { kind: "value", value: { name: id, count: 0 } });
  const page = await listData({}, root, "records", { limit: 1 });
  assert.deepEqual(page.items, [{ id: "a" }]); assert.ok(page.nextCursor);
  assert.deepEqual(await listData({}, root, "records", { limit: 2, cursor: page.nextCursor }), { items: [{ id: "b" }, { id: "c" }] });
  await assert.rejects(listData({}, root, "other", { cursor: page.nextCursor }));
});

test("business reads remain valid while a direct Factory has staged an atomic replacement", { timeout: 15_000 }, async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore();
  const initial = { name: "original", count: 0 };
  await writeData({}, root, "records", "item", "create", { kind: "value", value: initial });
  const worker = await filesystemWorker(t, join(root, "data/records"), { operation: "update", expectedRevision: 1, pause: "before-publish", value: { name: "published", count: 1 } });
  worker.send("start"); await worker.next("paused");
  try {
    assert.deepEqual((await readData({}, root, "records", "item")).value, initial);
    assert.deepEqual(await listData({}, root, "records"), { items: [{ id: "item" }] });
  } finally { worker.send("continue"); }
  assert.equal((await worker.next("result")).ok, true);
  assert.deepEqual((await readData({}, root, "records", "item")).value, { name: "published", count: 1 });
});

test("JSON DataStore supports structured values and queries without advertising record revisions", async (t) => {
  const { root, createStore } = await businessFixture(t); await createStore("files", "record.json", "data");
  const created = await writeData({}, root, "files", "item.json", "create", { kind: "value", value: { name: "JSON", count: 1 } });
  assert.equal("revision" in created, false);
  assert.deepEqual((await readData({}, root, "files", "item.json", { path: "$.count" })).value, [1]);
  assert.equal((await validateData({}, root, { id: "item.json", storeId: "files" })).valid, true);
  const before = await fs.readFile(join(root, "data/files/item.json"));
  await assert.rejects(writeData({}, root, "files", "item.json", "update", { kind: "value", value: { name: "ignored", count: 2 } }, { expectedRevision: 1 }), { code: "UNSUPPORTED_CAPABILITY" });
  assert.deepEqual(await fs.readFile(join(root, "data/files/item.json")), before);
});

test("candidate validation without installed systems or Stores does not create Project files", async (t) => {
  const { root } = await businessFixture(t); const before = await snapshotTree(root);
  assert.equal((await validateData({}, root, { modelRef: "record.json", value: { name: "candidate", count: 1 }, hasValue: true })).valid, true);
  assert.deepEqual(await snapshotTree(root), before);
});

test("JSON ValueStore registration rejects a raw bytes Runtime without creating its directory", async (t) => {
  const { root, createStore } = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root });
  const before = await snapshotTree(root);
  await assert.rejects(createStore("raw-values", "memsphere/run/artifact.json", "value", { directory: "data/raw-values" }, true), { code: "STORE_INCOMPATIBLE" });
  assert.deepEqual(await snapshotTree(root), before);
});

test("already configured JSON ValueStores reject the same incompatible raw Runtime", async (t) => {
  const { root } = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root });
  const path = join(root, "config.json"); const project = JSON.parse(await fs.readFile(path, "utf8"));
  project.dataStores = { "raw-values": { model: "memsphere/run/artifact.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/raw-values" } } };
  await fs.writeFile(path, JSON.stringify(project)); await fs.mkdir(join(root, "data/raw-values"), { recursive: true });
  const before = await snapshotTree(root);
  await assert.rejects(openBusinessStore({}, root, "raw-values"), { code: "STORE_INCOMPATIBLE" });
  assert.deepEqual(await snapshotTree(root), before);
});
