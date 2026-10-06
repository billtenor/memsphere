import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";

// Exercise the built CLI without shell-dependent JSON quoting or user state.
const { values } = parseArgs({ options: { cli: { type: "string" } } });
const root = mkdtempSync(join(tmpdir(), "memsphere-model-data-smoke-"));
const home = join(root, "home");
const workspace = join(root, "workspace");
const cli = resolve(values.cli ?? "dist/cli.js");
const gitConfig = join(root, "gitconfig");
const env = { ...process.env, MEMSPHERE_HOME: home, MEMSPHERE_PROJECT: "", MEMSPHERE_CONFIG_PATH: "", GIT_CONFIG_GLOBAL: gitConfig };

function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: workspace, env, input, encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  return result;
}
function json(args, input) {
  const result = run([...args, "--output=json"], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
function text(args, explicit = true) {
  const result = run(explicit ? [...args, "--output=text"] : args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^project: smoke\n/);
  assert.throws(() => JSON.parse(result.stdout), SyntaxError);
  return parse(result.stdout);
}
function failure(args, code) {
  const result = run([...args, "--output=json"]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, code);
}

try {
  mkdirSync(workspace);
  mkdirSync(join(workspace, "memory"));
  writeFileSync(gitConfig, "[user]\n\tname = Memsphere Smoke\n\temail = smoke@example.com\n");
  execFileSync("git", ["init", "-b", "master"], { cwd: workspace, env, stdio: "pipe" });
  const created = run(["project", "create", "smoke", "--embedded", "memory", "--bind"]);
  assert.equal(created.status, 0, created.stderr);
  const definition = JSON.stringify({ type: "object", properties: { count: { type: "integer", minimum: 0 } }, required: ["count"] });
  for (const id of ["counter.json", "spare.json"]) json(["model", "create", id, "--definition-file", "-", "--tag", "smoke"], definition);
  const models = json(["model", "list", "--origin", "project", "--tag", "smoke", "--limit", "1"]);
  assert.equal(models.items[0].id, "counter.json");
  const tail = json(["model", "list", "--origin", "project", "--tag", "smoke", "--cursor", models.nextCursor, "--limit", "1000"]);
  assert.deepEqual(tail.items.map(item => item.id), ["spare.json"]);
  assert.equal(tail.nextCursor, undefined);
  assert.deepEqual(json(["model", "read", "counter.json"]).definition, JSON.parse(definition));
  assert.deepEqual(text(["model", "list", "--origin", "project", "--tag", "smoke", "--cursor", models.nextCursor, "--limit", "1000"]), tail);
  for (const id of ["counters", "empty"]) json([
    "data", "store", "create", id, "--model", "counter.json", "--kind", "value",
    "--factory", "memsphere/filesystem-json", "--config-file", "-"
  ], JSON.stringify({ directory: `data/${id}` }));
  const stores = json(["data", "store", "list", "--model", "counter.json", "--limit", "1"]);
  assert.equal(stores.items[0].storeId, "counters");
  assert.equal(json(["data", "store", "list", "--model", "counter.json", "--cursor", stores.nextCursor]).items[0].storeId, "empty");
  assert.deepEqual(text(["data", "store", "read", "counters"]), json(["data", "store", "read", "counters"]));
  for (const id of ["one", "two"]) json(["data", "create", id, "--store", "counters", "--value-file", "-"], '{"count":1}');
  const records = json(["data", "list", "--store", "counters", "--limit", "1"]);
  assert.equal(records.items[0].id, "one");
  assert.deepEqual(json(["data", "list", "--store", "counters", "--cursor", records.nextCursor]).items.map(item => item.id), ["two"]);
  assert.deepEqual(json(["data", "read", "one", "--store", "counters", "--path", "$.count"]).value, [1]);
  assert.deepEqual(text(["data", "read", "one", "--store", "counters"], false), json(["data", "read", "one", "--store", "counters"]));
  const edited = json(["data", "edit", "one", "--store", "counters", "--expected-revision", "1", "--patch-file", "-"], '[{"op":"replace","path":"/count","value":2}]');
  assert.equal(edited.revision, 2);
  failure(["data", "delete", "one", "--store", "counters", "--expected-revision", "1"], "REVISION_CONFLICT");
  failure(["model", "list", "--unknown"], "INVALID_ARGUMENT");
  const exported = join(root, "export.json");
  json(["data", "export", "one", "--store", "counters", "--as", "json", "--out", exported]);
  assert.deepEqual(JSON.parse(readFileSync(exported, "utf8")), { count: 2 });
  const removed = json(["data", "store", "remove", "counters"]);
  assert.equal(removed.dataRetained, true);
  assert.equal(JSON.parse(readFileSync(join(removed.directory, "one.json"), "utf8")).value.count, 2);
  console.log(`Model/data CLI smoke passed on ${process.platform}, Node ${process.versions.node}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
