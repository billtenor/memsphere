import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { businessFixture, objectSchema, snapshotTree } from "./helpers/business-data.js";
import { writeData } from "../src/project/data-service.js";

const entry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
type Fixture = Awaited<ReturnType<typeof businessFixture>>;
type Result = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };
function cli(t: TestContext, f: Fixture, args: string[], options: { input?: string; keepStdin?: boolean; project?: string } = {}): Promise<Result> {
  const child = spawn(process.execPath, [entry, "--project", options.project ?? "test-project", ...args], {
    cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_PROJECT: "", MEMSPHERE_CONFIG_PATH: "" },
    stdio: ["pipe", "pipe", "pipe"], timeout: 8000
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
  if (!options.keepStdin) child.stdin.end(options.input);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}
function success(result: Result): any {
  assert.equal(result.signal, null, result.stderr); assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
function failure(result: Result, code?: string): any {
  assert.equal(result.signal, null, "CLI must reject before waiting for stdin"); assert.equal(result.code, 1, result.stdout); assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr).error;
  assert.equal(typeof error.message, "string"); assert.ok(error.message.length); assert.equal(typeof error.code, "string");
  if (code) assert.equal(error.code, code); return error;
}
const json = ["--output", "json"];
const source = '\uFEFF {\r\n "type":"string", "title":"Definition title", "description":"Definition description"\r\n}\r\n';

test("actual model CLI resolves the Registry Project and preserves stdin definition bytes through CRUD", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t, {});
  const ref = "sales/order.json";
  const created = success(await cli(t, f, ["model", "create", ref, "--definition-file", "-", "--name", "Managed title", "--tag", "one", "--tag", "two", ...json], { input: source }));
  assert.equal(created.project, "test-project"); assert.equal(created.modelRef, ref); assert.equal(created.operation, "model.create");
  const path = join(f.root, "models/json-schema/draft-07", ref);
  assert.equal(await fs.readFile(path, "utf8"), source);
  const definition = success(await cli(t, f, ["model", "read", ref, ...json]));
  assert.equal(definition.project, "test-project"); assert.equal(definition.definition.title, "Definition title"); assert.equal(Object.hasOwn(definition, "registration"), false);
  const updated = success(await cli(t, f, ["model", "update", ref, "--description", "", "--tag", "replacement", ...json]));
  assert.equal(updated.registration.description, ""); assert.deepEqual(updated.registration.tags, ["replacement"]);
  success(await cli(t, f, ["model", "update", ref, "--unset", "description", ...json]));
  const all = success(await cli(t, f, ["model", "read", ref, "--part", "all", ...json]));
  assert.equal(all.registration.name, "Managed title"); assert.equal(Object.hasOwn(all.registration, "description"), false);
  assert.equal(all.definition.description, "Definition description"); assert.equal(await fs.readFile(path, "utf8"), source);
  failure(await cli(t, f, ["model", "create", ref, "--definition-file", "-", ...json], { input: source }), "ALREADY_EXISTS");
  success(await cli(t, f, ["model", "delete", ref, ...json]));
  failure(await cli(t, f, ["model", "read", ref, ...json]), "MODEL_NOT_FOUND");
});

test("definition input filenames resolve from cwd while mutations use the explicitly selected Registry Project", { timeout: 20_000 }, async t => {
  const f = await businessFixture(t, {});
  const other = join(f.directory, "another-project"); await fs.mkdir(other);
  await fs.writeFile(join(other, "config.json"), await fs.readFile(join(f.root, "config.json")));
  await fs.writeFile(join(other, "project.json"), JSON.stringify({ format_version: 1, name: "other", created_at: "2026-10-05T00:00:00.000Z" }));
  await fs.writeFile(join(f.home, "registry.json"), JSON.stringify({ format_version: 1, projects: { "test-project": { root: f.root }, other: { root: other } }, workspaces: {} }));
  await fs.writeFile(join(f.cwd, "candidate.schema.json"), source);
  const before = await snapshotTree(f.root);
  const saved = success(await cli(t, f, ["model", "create", "selected.json", "--definition-file", "candidate.schema.json", ...json], { project: "other" }));
  assert.equal(saved.project, "other"); assert.equal(await fs.readFile(join(other, "models/json-schema/draft-07/selected.json"), "utf8"), source);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("system model writes reject before consuming an open stdin", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t, {}); const before = await snapshotTree(f.root);
  for (const args of [
    ["create", "memsphere/model-registration.json", "--definition-file", "-", "--name", "changed"],
    ["update", "memsphere/model-registration.json", "--definition-file", "-", "--description", "changed"],
    ["update", "memsphere/run/artifact.json", "--tag", "changed", "--dry-run"],
    ["update", "memsphere/run/artifact.json", "--unset", "name"],
    ["delete", "memsphere/run/artifact.json", "--dry-run"]
  ]) failure(await cli(t, f, ["model", ...args, ...json], { keepStdin: true }), "SYSTEM_MODEL_READ_ONLY");
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("invalid model identities reject before consuming an open stdin", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t, {}); const before = await snapshotTree(f.root);
  for (const ref of ["no-suffix", "../outside.json", "/absolute.json"]) failure(await cli(t, f, ["model", "create", ref, "--definition-file", "-", ...json], { keepStdin: true }), "MODEL_ID_INVALID");
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("CLI rejects invalid option combinations before reading stdin and reports JSON diagnostics", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t);
  for (const args of [
    ["create", "missing.json"], ["update", "record.json"], ["read", "record.json", "--part", "references"],
    ["update", "record.json", "--name", "new", "--unset", "name"], ["create", "new.json", "--definition-file", "-", "--check", "definition"],
    ["validate", "record.json", "--definition-file", "-", "--check", "definition", "--check-data"],
    ["validate", "record.json", "--definition-file", "-", "--store", "records"]
  ]) failure(await cli(t, f, ["model", ...args, ...json], { keepStdin: true }), "INVALID_ARGUMENT");
  await assert.rejects(fs.readFile(join(f.root, "models/json-schema/draft-07/new.json")), { code: "ENOENT" });
});

test("malformed definition input returns the specific JSON diagnostic without saving a model", async t => {
  const f = await businessFixture(t);
  failure(await cli(t, f, ["model", "create", "new.json", "--definition-file", "-", ...json], { input: "{broken" }), "INPUT_INVALID");
  failure(await cli(t, f, ["model", "create", "new.json", "--definition-file", "-", ...json], { input: '{"required":42}' }), "MODEL_DEFINITION_INVALID");
  await assert.rejects(fs.readFile(join(f.root, "models/json-schema/draft-07/new.json")), { code: "ENOENT" });
});

test("definition-only CLI diagnostics cannot create a Runtime-unsupported model", async t => {
  const f = await businessFixture(t);
  const unsupported = '{"anyOf":[{"type":"string"},{"type":"number"}]}';
  const diagnostic = success(await cli(t, f, ["model", "validate", "candidate.json", "--definition-file", "-", "--check", "definition", ...json], { input: unsupported }));
  assert.deepEqual(diagnostic.checks, { definition: "passed", runtime: "not_checked" });
  const error = failure(await cli(t, f, ["model", "create", "new.json", "--definition-file", "-", ...json], { input: unsupported }), "MODEL_RUNTIME_UNSUPPORTED");
  assert.equal(error.details.modelRef, "new.json"); assert.match(error.details.path, /^#/);
  failure(await cli(t, f, ["model", "validate", "candidate.json", "--definition-file", "-", "--check", "definition", ...json], { input: '{"$ref":"record.json"}' }), "MODEL_REFERENCE_UNSUPPORTED");
  await assert.rejects(fs.readFile(join(f.root, "models/json-schema/draft-07/new.json")), { code: "ENOENT" });
});

test("empty Store bindings block CLI definition changes and deletion while allowing metadata edits", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t); await f.createStore();
  failure(await cli(t, f, ["model", "delete", "record.json", ...json]), "MODEL_IN_USE");
  failure(await cli(t, f, ["model", "update", "record.json", "--definition-file", "-", ...json], { input: source }), "MODEL_IN_USE");
  success(await cli(t, f, ["model", "update", "record.json", "--name", "Editable metadata", ...json]));
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.root, "models/json-schema/draft-07/record.json"), "utf8")), objectSchema);
});

test("CLI check-data reports failing record identities without saving the candidate definition", async t => {
  const f = await businessFixture(t); await f.createStore();
  await writeData({}, f.root, "records", "bad-for-candidate", "create", { kind: "value", value: { name: "saved", count: 3 } });
  const good = success(await cli(t, f, ["model", "validate", "record.json", "--check-data", "--store", "records", ...json]));
  assert.deepEqual(good.data.map((item: { storeId: string; checked: number }) => [item.storeId, item.checked]), [["records", 1]]);
  const candidate = JSON.stringify({ ...objectSchema, properties: { ...objectSchema.properties, count: { type: "integer", maximum: 0 } } });
  const error = failure(await cli(t, f, ["model", "validate", "record.json", "--definition-file", "-", "--check-data", ...json], { input: candidate }), "DATA_VALIDATION_FAILED");
  assert.equal(error.details.snapshot, false); assert.equal(error.details.data[0].failures[0].id, "bad-for-candidate");
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.root, "models/json-schema/draft-07/record.json"), "utf8")), objectSchema);
});

test("CLI read/list/validate and all mutation dry-runs preserve directory membership, bytes and mtimes", { timeout: 30_000 }, async t => {
  const f = await businessFixture(t); const before = await snapshotTree(f.root);
  for (const args of [
    ["list"], ["read", "record.json", "--part", "all"], ["validate", "record.json"],
    ["create", "planned/nested.json", "--definition-file", "-", "--dry-run"],
    ["update", "record.json", "--name", "Planned", "--dry-run"], ["delete", "record.json", "--dry-run"]
  ]) success(await cli(t, f, ["model", ...args, ...json], { input: source }));
  assert.deepEqual(await snapshotTree(f.root), before);
});
