import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { parse } from "yaml";
import { writeData } from "../src/project/data-service.js";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";

const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const loader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
type Fixture = Awaited<ReturnType<typeof businessFixture>>;
type Format = "json" | "text" | undefined;

function cli(fixture: Fixture, args: string[], format?: Format, input?: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("MEMSPHERE_")) delete env[name];
  const result = spawnSync(process.execPath, ["--import", loader, entry, "--project", "test-project", ...args,
    ...(format ? ["--output", format] : [])], {
    cwd: fixture.cwd, env: { ...env, MEMSPHERE_HOME: fixture.home }, input, encoding: "utf8", timeout: 15_000
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

/** Compare actual CLI representations of an unchanged result, including the default. */
function representations(fixture: Fixture, args: string[], input?: string): any {
  const results = (["json", "text", undefined] as const).map(format => cli(fixture, args, format, input));
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
  const [json, text, implicit] = results;
  const value = JSON.parse(json.stdout);
  assert.equal(json.stdout, `${JSON.stringify(value)}\n`, "JSON remains one compact value followed by a newline");
  assert.match(text.stdout, /^project: test-project\n/);
  assert.throws(() => JSON.parse(text.stdout), SyntaxError, "text must no longer be pretty-printed JSON");
  assert.deepEqual(parse(text.stdout), value, "YAML text preserves the complete JSON result");
  assert.equal(implicit.stdout, text.stdout, "default output is text");
  return value;
}

const strings = ["", "true", "false", "null", "~", "001", "1e3", "2026-10-06", "a: # comment", "- item",
  "*alias", "&anchor", "!tag", "{}", "[]", "  padded  ", "line one\nline two\n", "tab\tand\u0000nul", "中文 😀"];
const value = { strings, nested: { enabled: false, zero: 0, nil: null, empty: {}, rows: [{ name: "null", values: [] }] } };
const schema = {
  type: "object", title: "标题: # model", description: "First line\nSecond line\n", additionalProperties: false,
  properties: {
    strings: { type: "array", items: { type: "string" } },
    nested: { type: "object", additionalProperties: false, properties: {
      enabled: { type: "boolean" }, zero: { type: "number" }, nil: { type: "null" }, empty: { type: "object", additionalProperties: false },
      rows: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { name: { type: "string" }, values: { type: "array", items: { type: "integer" } } } } }
    } }
  }
};

async function fixture(t: TestContext) {
  const f = await businessFixture(t, { "record.json": schema, "second.json": { type: "string" } });
  await f.createStore();
  await f.createStore("second", "second.json");
  await writeData({}, f.root, "records", "a", "create", { kind: "value", value });
  await writeData({}, f.root, "records", "b", "create", { kind: "value", value });
  return f;
}

test("actual model/data/Store reads use YAML text by default and preserve special strings and nested JSON values", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  const model = representations(f, ["model", "read", "record.json", "--part", "all"]);
  assert.deepEqual(model.definition, schema);
  const data = representations(f, ["data", "read", "a", "--store", "records"]);
  assert.deepEqual(data.value, value);
  assert.equal(data.revision, 1);
  const query = representations(f, ["data", "read", "a", "--store", "records", "--path", "$.nested.nil"]);
  assert.deepEqual(query.value, [null]);
  const store = representations(f, ["data", "store", "read", "records"]);
  assert.equal(store.storeId, "records");
  assert.equal(store.model, "record.json");
  assert.equal(store.capabilities.value, true);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("all three new list commands retain items and usable cursors across JSON, text and default output", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  for (const args of [["model", "list"], ["data", "list", "--store", "records"], ["data", "store", "list"]]) {
    const first = representations(f, [...args, "--limit", "1"]);
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.nextCursor.length);
    const second = representations(f, [...args, "--limit", "1", "--cursor", first.nextCursor]);
    assert.equal(second.items.length, 1);
    assert.notDeepEqual(second.items, first.items);
    assert.equal(Object.hasOwn(second, "nextCursor"), false);
    const all = representations(f, args);
    assert.deepEqual([...first.items, ...second.items], all.items);
  }
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("model/data/Store dry-run receipts differ only in presentation and leave the Project unchanged", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  // A saved registration gives every dry-run the same ID; create plans allocate a new UUID each time.
  const created = cli(f, ["model", "create", "planned.json", "--definition-file", "-"], "json", JSON.stringify(schema));
  assert.equal(created.status, 0, created.stderr);
  const before = await snapshotTree(f.root);
  const model = representations(f, ["model", "update", "planned.json", "--name", "true", "--description", "line: # note\nnext", "--dry-run"]);
  assert.equal(model.operation, "model.update");
  assert.equal(model.dryRun, true);
  assert.equal(model.registration.name, "true");
  const data = representations(f, ["data", "create", "planned", "--store", "records", "--value-file", "-", "--dry-run"], JSON.stringify(value));
  assert.equal(data.operation, "data.create");
  assert.equal(data.dryRun, true);
  const store = representations(f, ["data", "store", "create", "planned", "--model", "record.json", "--kind", "value",
    "--factory", "memsphere/filesystem-json", "--config-file", "-", "--dry-run"], '{"directory":"data/planned"}');
  assert.equal(store.operation, "data.store.create");
  assert.equal(store.dryRun, true);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("model/data/Store failures preserve empty stdout and separate text from the JSON error protocol", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  for (const [args, code] of [
    [["model", "read", "missing.json"], "MODEL_NOT_FOUND"],
    [["data", "read", "missing", "--store", "records"], "NOT_FOUND"],
    [["data", "store", "read", "missing"], "STORE_NOT_FOUND"],
    [["model", "list", "--unknown-option"], "INVALID_ARGUMENT"],
    [["data", "list", "--store", "records", "--unknown-option"], "INVALID_ARGUMENT"],
    [["data", "store", "list", "--unknown-option"], "INVALID_ARGUMENT"]
  ] as const) {
    const [json, text, implicit] = (["json", "text", undefined] as const).map(format => cli(f, [...args], format));
    for (const result of [json, text, implicit]) { assert.equal(result.status, 1); assert.equal(result.stdout, ""); }
    const error = JSON.parse(json.stderr);
    assert.equal(error.error.code, code);
    assert.equal(typeof error.error.message, "string");
    assert.ok(error.error.message.length);
    assert.equal(json.stderr, `${JSON.stringify(error)}\n`);
    assert.equal(text.stderr, `error: ${error.error.message}\n`);
    assert.equal(implicit.stderr, text.stderr);
    assert.throws(() => JSON.parse(text.stderr), SyntaxError);
  }
});
