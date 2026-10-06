import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { parse } from "yaml";
import { writeData } from "../src/project/data-service.js";
import { mutateModel } from "../src/project/model-service.js";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";

const entry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
type Fixture = Awaited<ReturnType<typeof businessFixture>>;
type Format = "json" | "text" | undefined;

function cli(fixture: Fixture, args: string[], format?: Format, input?: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("MEMSPHERE_")) delete env[name];
  const result = spawnSync(process.execPath, [entry, "--project", "test-project", ...args,
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
  const query = cli(f, ["data", "read", "a", "--store", "records", "--path", "$.nested.nil"], "json");
  assert.equal(query.status, 0, query.stderr);
  assert.deepEqual(JSON.parse(query.stdout).value, [null]);
  const store = representations(f, ["data", "store", "read", "records"]);
  assert.equal(store.storeId, "records");
  assert.equal(store.model, "record.json");
  assert.equal(store.capabilities.value, true);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("all three list commands expose the same paged receipt in JSON, text and default output", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  for (const args of [["model", "list"], ["data", "list", "--store", "records"], ["data", "store", "list"]]) {
    const first = representations(f, [...args, "--limit", "1"]);
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.nextCursor.length);
  }
  // Continuation/order/filter contracts belong to list-pagination-cli and service tests.
  assert.deepEqual(await snapshotTree(f.root), before);
});

for (const domain of ["model", "data", "store"] as const) {
  test(`${domain} dry-run exposes a YAML plan without changing the Project`, { timeout: 60_000 }, async t => {
    const f = await fixture(t);
    await mutateModel({}, f.root, "create", "planned.json", { source: JSON.stringify(schema) });
    const plans = {
      model: { args: ["model", "update", "planned.json", "--name", "true", "--description", "line: # note\nnext", "--dry-run"], input: undefined, operation: "model.update" },
      data: { args: ["data", "create", "planned", "--store", "records", "--value-file", "-", "--dry-run"], input: JSON.stringify(value), operation: "data.create" },
      store: { args: ["data", "store", "create", "planned", "--model", "record.json", "--kind", "value", "--factory", "memsphere/filesystem-json", "--config-file", "-", "--dry-run"], input: '{"directory":"data/planned"}', operation: "data.store.create" }
    };
    const before = await snapshotTree(f.root);
    const result = cli(f, plans[domain].args, domain === "data" ? undefined : "text", plans[domain].input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const plan = parse(result.stdout);
    assert.equal(plan.project, "test-project");
    assert.equal(plan.operation, plans[domain].operation);
    assert.equal(plan.dryRun, true);
    if (domain === "model") assert.equal(plan.registration.name, "true");
    assert.throws(() => JSON.parse(result.stdout), SyntaxError);
    assert.deepEqual(await snapshotTree(f.root), before);
  });
}

test("model/data/Store failures keep stdout empty and wire the shared JSON or readable error protocol", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const cases = [
    [["model", "read", "missing.json"], "MODEL_NOT_FOUND"],
    [["data", "read", "missing", "--store", "records"], "NOT_FOUND"],
    [["data", "store", "read", "missing"], "STORE_NOT_FOUND"],
    [["model", "list", "--unknown-option"], "INVALID_ARGUMENT"],
    [["data", "list", "--store", "records", "--unknown-option"], "INVALID_ARGUMENT"],
    [["data", "store", "list", "--unknown-option"], "INVALID_ARGUMENT"]
  ] as const;
  for (const [index, [args, code]] of cases.entries()) {
    const json = cli(f, [...args], "json");
    assert.equal(json.status, 1);
    assert.equal(json.stdout, "");
    const error = JSON.parse(json.stderr);
    assert.equal(error.error.code, code);
    assert.equal(typeof error.error.message, "string");
    assert.ok(error.error.message.length);
    assert.equal(json.stderr, `${JSON.stringify(error)}\n`);
    // The presentation unit tests exhaust text/default combinations; these calls
    // retain real explicit-text and default-text error dispatch at the CLI boundary.
    if (index < 2) {
      const readable = cli(f, [...args], index === 0 ? "text" : undefined);
      assert.equal(readable.status, 1);
      assert.equal(readable.stdout, "");
      assert.equal(readable.stderr, `error: ${error.error.message}\n`);
      assert.throws(() => JSON.parse(readable.stderr), SyntaxError);
    }
  }
});
