import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { writeData, readData } from "../src/project/data-service.js";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";
import { filesystemWorker } from "./helpers/filesystem-process.js";
import { initializeProjectModelRegistrations } from "../src/project/model-registration.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
type Fixture = Awaited<ReturnType<typeof businessFixture>>;
type Result = { code: number | null; stdout: string; stderr: string; bytes: Buffer };

function cli(t: TestContext, fixture: Fixture, args: string[], input?: string | Uint8Array, keepStdin = false): Promise<Result> {
  const child = spawn(process.execPath, [cliPath, "--project", "test-project", ...args], {
    cwd: fixture.cwd, env: { ...process.env, MEMSPHERE_HOME: fixture.home }, stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
  if (!keepStdin) child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => { const bytes = Buffer.concat(stdout); resolve({ code, stdout: bytes.toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), bytes }); });
  });
}
function success(result: Result): any {
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, ""); assert.notEqual(result.stdout.trim(), "");
  return JSON.parse(result.stdout);
}
function failure(result: Result, code?: string): any {
  assert.equal(result.code, 1, result.stdout); assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr).error; assert.equal(typeof error.code, "string"); assert.equal(typeof error.message, "string");
  if (code) assert.equal(error.code, code); return error;
}

async function ipcCli(t: TestContext, fixture: Fixture, args: string[], pauseRead = false) {
  const child = fork(new URL("./fixtures/data-cli-worker.ts", import.meta.url), [JSON.stringify({ args: ["--project", "test-project", ...args], recordPath: join(fixture.root, "data/records/item.json"), pauseRead })], {
    cwd: fixture.cwd, execArgv: ["--import", loader], env: { ...process.env, MEMSPHERE_HOME: fixture.home }, stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const messages: string[] = []; const waits = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  child.stdout!.on("data", chunk => stdout.push(chunk)); child.stderr!.on("data", chunk => stderr.push(chunk));
  child.on("message", (message: { type: string }) => {
    const waiter = waits.get(message.type); if (waiter) { waits.delete(message.type); waiter.resolve(); } else messages.push(message.type);
  });
  let closed = false;
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const result = new Promise<Result>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => {
      closed = true; const bytes = Buffer.concat(stdout); const error = Buffer.concat(stderr).toString("utf8");
      for (const waiter of waits.values()) waiter.reject(new Error(`CLI exited before IPC barrier: ${error}`));
      resolve({ code, stdout: bytes.toString("utf8"), stderr: error, bytes });
    });
  });
  t.after(async () => {
    if (!closed) child.kill("SIGKILL");
    await exit;
    // Killed tsx workers can leave inherited pipes open in their compiler
    // subprocess on Windows. Cleanup must not wait for those pipes to close.
    child.stdout!.destroy(); child.stderr!.destroy();
  });
  function next(type: string): Promise<void> {
    const index = messages.indexOf(type); if (index !== -1) { messages.splice(index, 1); return Promise.resolve(); }
    if (closed) return Promise.reject(new Error(`CLI exited before ${type}`));
    return new Promise((resolve, reject) => waits.set(type, { resolve, reject }));
  }
  await next("ready"); return { next, result, send: (message: string) => child.send(message) };
}

test("data CLI creates from stdin, reads/updates/edits complete values and returns explicit identities", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  const created = success(await cli(t, fixture, ["data", "create", "item", "--store", "records", "--value-file", "-", "--output", "json"], '{"name":"first","count":1}'));
  assert.equal(created.project, "test-project"); assert.equal(created.storeId, "records"); assert.equal(created.modelRef, "record.json"); assert.equal(created.id, "item"); assert.equal(created.revision, 1);
  success(await cli(t, fixture, ["data", "update", "item", "--store", "records", "--value", '{"name":"replaced","count":2}', "--expected-revision", "1", "--output", "json"]));
  const edited = success(await cli(t, fixture, ["data", "edit", "item", "--store", "records", "--patch", '[{"op":"replace","path":"/count","value":3}]', "--output", "json"]));
  assert.equal(edited.revision, 3);
  const read = success(await cli(t, fixture, ["data", "read", "item", "--store", "records", "--output", "json"]));
  assert.deepEqual(read.value, { name: "replaced", count: 3 });
  const query = success(await cli(t, fixture, ["data", "read", "item", "--store", "records", "--path", "$.count", "--output", "json"]));
  assert.deepEqual(query.value, [3]);
});

test("CLI reports parsing, input, missing/conflict and capability failures as one JSON error", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  failure(await cli(t, fixture, ["data", "create", "item", "--store", "records", "--output", "json"], undefined, true), "INVALID_ARGUMENT");
  failure(await cli(t, fixture, ["data", "read", "item", "--unknown", "--store", "records", "--output=json"]), "INVALID_ARGUMENT");
  failure(await cli(t, fixture, ["data", "create", "item", "--store", "records", "--value", "{broken", "--output", "json"]), "INPUT_INVALID");
  failure(await cli(t, fixture, ["data", "read", "missing", "--store", "records", "--output", "json"]), "NOT_FOUND");
  await writeData({}, fixture.root, "records", "item", "create", { kind: "value", value: { name: "valid", count: 0 } });
  failure(await cli(t, fixture, ["data", "delete", "item", "--store", "records", "--expected-revision", "2", "--output", "json"]), "REVISION_CONFLICT");
  await fixture.createStore("files", "record.json", "data");
  failure(await cli(t, fixture, ["data", "update", "item.json", "--store", "files", "--expected-revision", "1", "--value-file", "-", "--output", "json"], undefined, true), "UNSUPPORTED_CAPABILITY");
});

test("CLI Store configuration paths are relative to selected Project and remove permits explicit re-registration", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t);
  const args = ["data", "store", "create", "records", "--model", "record.json", "--kind", "value", "--factory", "memsphere/filesystem-json", "--config-file", "-", "--output", "json"];
  const configured = success(await cli(t, fixture, args, '{"directory":"data/records"}'));
  assert.equal(configured.directory, join(fixture.root, "data/records"));
  await writeData({}, fixture.root, "records", "item", "create", { kind: "value", value: { name: "keep", count: 1 } });
  const removed = success(await cli(t, fixture, ["data", "store", "remove", "records", "--output", "json"]));
  assert.equal(removed.dataRetained, true);
  failure(await cli(t, fixture, ["data", "read", "item", "--store", "records", "--output", "json"]), "STORE_NOT_FOUND");
  success(await cli(t, fixture, args, '{"directory":"data/records"}'));
  assert.deepEqual(success(await cli(t, fixture, ["data", "read", "item", "--store", "records", "--output", "json"])).value, { name: "keep", count: 1 });
});

test("CLI uses external absolute directories for both Store kinds and retains records across re-registration", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t);
  for (const kind of ["value", "data"] as const) {
    const storeId = `outside-${kind}`; const directory = join(fixture.directory, "external-cli", kind);
    const factory = kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem";
    const args = ["data", "store", "create", storeId, "--model", "record.json", "--kind", kind, "--factory", factory, "--config-file", "-", "--output", "json"];
    const config = JSON.stringify({ directory });
    assert.equal(success(await cli(t, fixture, args, config)).directory, directory);
    const id = kind === "value" ? "item" : "item.json"; const value = { name: storeId, count: 1 };
    success(await cli(t, fixture, ["data", "create", id, "--store", storeId, "--value", JSON.stringify(value), "--output", "json"]));
    const loaded = success(await cli(t, fixture, ["data", "store", "read", storeId, "--output", "json"]));
    assert.equal(loaded.directory, directory); assert.equal(loaded.config.directory, directory); assert.equal(loaded.status, "available");
    assert.deepEqual(success(await cli(t, fixture, ["data", "read", id, "--store", storeId, "--output", "json"])).value, value);
    const dataBefore = await snapshotTree(directory);
    const removed = success(await cli(t, fixture, ["data", "store", "remove", storeId, "--output", "json"]));
    assert.equal(removed.dataRetained, true); assert.equal(removed.directory, directory);
    assert.deepEqual(await snapshotTree(directory), dataBefore);
    success(await cli(t, fixture, args, config));
    assert.deepEqual(success(await cli(t, fixture, ["data", "read", id, "--store", storeId, "--output", "json"])).value, value);
    assert.deepEqual(await snapshotTree(directory), dataBefore);
  }
});

test("CLI list/read/validate and dry-run produce no Project filesystem writes", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  const before = await snapshotTree(fixture.root);
  for (const args of [
    ["data", "list", "--store", "records"], ["data", "has", "missing", "--store", "records"],
    ["data", "store", "list"], ["data", "store", "read", "records"],
    ["data", "validate", "--model", "record.json", "--value", '{"name":"candidate","count":0}'],
    ["data", "create", "planned", "--store", "records", "--value", '{"name":"dry","count":0}', "--dry-run"]
  ]) success(await cli(t, fixture, [...args, "--output", "json"]));
  assert.deepEqual(await snapshotTree(fixture.root), before);
});

test("CLI opaque Payload export writes exact bytes and keeps raw stdout free of receipts", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore("files", "record.json", "data");
  const bytes = Buffer.from([0, 255, 128, 10, 65]);
  success(await cli(t, fixture, ["data", "create", "item.bin", "--store", "files", "--payload-file", "-", "--content-type", "application/octet-stream", "--output", "json"], bytes));
  const out = await cli(t, fixture, ["data", "export", "item.bin", "--store", "files", "--as", "payload", "--out", "-"]);
  assert.equal(out.code, 0, out.stderr); assert.equal(out.stderr, ""); assert.deepEqual(out.bytes, bytes);
  failure(await cli(t, fixture, ["data", "export", "item.bin", "--store", "files", "--as", "payload", "--out", "-", "--output", "json"]), "INVALID_ARGUMENT");
  const target = join(fixture.directory, "export.bin"); await fs.writeFile(target, "retained");
  failure(await cli(t, fixture, ["data", "export", "item.bin", "--store", "files", "--as", "payload", "--out", target, "--output", "json"]), "ALREADY_EXISTS");
  assert.equal(await fs.readFile(target, "utf8"), "retained");
});

test("CLI and direct Factory conditional writes use the same cross-process record lock", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  await writeData({}, fixture.root, "records", "item", "create", { kind: "value", value: { name: "initial", count: 0 } });
  const factory = await filesystemWorker(t, join(fixture.root, "data/records"), { operation: "update", expectedRevision: 1, pause: "after-lock", value: { name: "factory", count: 1 } });
  const command = await ipcCli(t, fixture, ["data", "update", "item", "--store", "records", "--value", '{"name":"CLI","count":2}', "--expected-revision", "1", "--output", "json"]);
  factory.send("start"); await factory.next("paused");
  command.send("start"); await command.next("waiting");
  factory.send("continue"); assert.equal((await factory.next("result")).ok, true);
  failure(await command.result, "REVISION_CONFLICT");
  assert.deepEqual((await readData({}, fixture.root, "records", "item")).value, { name: "factory", count: 1 });
});

test("two CLI edits that capture the same revision commit exactly one complete patch", { timeout: 30_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  await writeData({}, fixture.root, "records", "item", "create", { kind: "value", value: { name: "original", count: 0 } });
  const first = await ipcCli(t, fixture, ["data", "edit", "item", "--store", "records", "--patch", '[{"op":"replace","path":"/name","value":"first"}]', "--output", "json"], true);
  const second = await ipcCli(t, fixture, ["data", "edit", "item", "--store", "records", "--patch", '[{"op":"replace","path":"/count","value":2}]', "--output", "json"], true);
  first.send("start"); second.send("start");
  await Promise.all([first.next("captured"), second.next("captured")]);
  first.send("continue"); assert.equal(success(await first.result).revision, 2);
  second.send("continue"); failure(await second.result, "REVISION_CONFLICT");
  const final = await readData({}, fixture.root, "records", "item");
  assert.equal(final.revision, 2); assert.deepEqual(final.value, { name: "first", count: 0 });
});

test("Store read reports raw Runtime Payload capability without claiming JSON value decoding", { timeout: 15_000 }, async (t) => {
  const fixture = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root: fixture.root });
  await fixture.createStore("raw-files", "memsphere/run/artifact.json", "data");
  const result = success(await cli(t, fixture, ["data", "store", "read", "raw-files", "--output", "json"]));
  assert.equal(result.status, "available");
  assert.equal(result.capabilities.payload, true); assert.equal(result.capabilities.value, false);
  assert.equal(result.capabilities.conditionalWrite, false); assert.equal(result.capabilities.edit, false);
  assert.deepEqual(result.contentTypeExtensions["application/json"], [".json"]);
});

test("Store discovery does not advertise an incompatible existing raw ValueStore as available", { timeout: 15_000 }, async (t) => {
  const fixture = await businessFixture(t);
  await initializeProjectModelRegistrations({}, { root: fixture.root });
  const configFile = join(fixture.root, "config.json"); const project = JSON.parse(await fs.readFile(configFile, "utf8"));
  project.dataStores = { "raw-values": { model: "memsphere/run/artifact.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/raw-values" } } };
  await fs.writeFile(configFile, JSON.stringify(project));
  const before = await snapshotTree(fixture.root);
  const read = success(await cli(t, fixture, ["data", "store", "read", "raw-values", "--output", "json"]));
  const list = success(await cli(t, fixture, ["data", "store", "list", "--output", "json"]));
  assert.deepEqual(await snapshotTree(fixture.root), before);
  assert.equal(read.status, "unavailable");
  assert.equal(list.items[0].status, "unavailable");
  assert.equal(read.errorCode, "STORE_INCOMPATIBLE");
  assert.equal(list.items[0].errorCode, "STORE_INCOMPATIBLE");
  assert.match(read.error, /JSON/i); assert.match(list.items[0].error, /JSON/i);
  assert.deepEqual(read.capabilities, { value: false, payload: false, conditionalWrite: false, edit: false });
});

test("Store discovery keeps missing and Runtime-unsupported models unavailable without opening data directories", { timeout: 15_000 }, async (t) => {
  const fixture = await businessFixture(t, { "advanced.json": { anyOf: [{ type: "string" }, { type: "number" }] } });
  const configFile = join(fixture.root, "config.json"); const project = JSON.parse(await fs.readFile(configFile, "utf8"));
  project.dataStores = Object.fromEntries(["missing", "advanced"].map(id => [id, {
    model: `${id}.json`, kind: "value", factory: "memsphere/filesystem-json", config: { directory: `data/${id}` }
  }]));
  await fs.writeFile(configFile, JSON.stringify(project));
  const before = await snapshotTree(fixture.root);
  const list = success(await cli(t, fixture, ["data", "store", "list", "--output", "json"]));
  assert.deepEqual(list.items.map((item: any) => [item.storeId, item.status]), [["advanced", "unavailable"], ["missing", "unavailable"]]);
  for (const id of ["missing", "advanced"]) {
    const read = success(await cli(t, fixture, ["data", "store", "read", id, "--output", "json"]));
    assert.equal(read.status, "unavailable");
    assert.equal(typeof read.error, "string"); assert.notEqual(read.error.trim(), "");
    assert.equal(typeof read.errorCode, "string");
    assert.deepEqual(read.capabilities, { value: false, payload: false, conditionalWrite: false, edit: false });
  }
  assert.deepEqual(await snapshotTree(fixture.root), before);
});

test("Factory delete followed by CLI recreation cannot reuse a stale client revision", { timeout: 15_000 }, async (t) => {
  const fixture = await businessFixture(t); await fixture.createStore();
  await writeData({}, fixture.root, "records", "item", "create", { kind: "value", value: { name: "initial", count: 0 } });
  const directory = join(fixture.root, "data/records");
  const deleted = await filesystemWorker(t, directory, { operation: "delete", expectedRevision: 1 });
  deleted.send("start"); assert.equal((await deleted.next("result")).value, true);
  const recreated = success(await cli(t, fixture, ["data", "create", "item", "--store", "records", "--value", '{"name":"recreated","count":1}', "--output", "json"]));
  assert.equal(recreated.revision, 2);
  for (const operation of ["update", "delete"]) {
    const stale = await filesystemWorker(t, directory, { operation, expectedRevision: 1, value: { name: "stale", count: 2 } });
    stale.send("start"); assert.equal((await stale.next("result")).code, "REVISION_CONFLICT");
  }
  assert.deepEqual((await readData({}, fixture.root, "records", "item")).value, { name: "recreated", count: 1 });
});
