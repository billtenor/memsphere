import { invokeCliModule } from "./helpers/cli-module.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
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

async function representations(fixture: Fixture, args: string[], input?: string): Promise<any> {
  const results: Array<{ status: number | null; stdout: string; stderr: string }> = [];
  for (const format of ["json", "text", undefined] as const) {
    if (format === "json" || args[0] === "model" && args[1] === "read") results.push(cli(fixture, args, format, input));
    else {
      assert.equal(input, undefined, "stdin contracts must use the native CLI");
      const env = { ...process.env };
      for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("MEMSPHERE_")) delete env[name];
      const result = await invokeCliModule(["--project", "test-project", ...args, ...(format ? ["--output", format] : [])],
        fixture.cwd, { ...env, MEMSPHERE_HOME: fixture.home }, entry);
      results.push({ ...result, status: 0 });
    }
  }
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
  const [json, text, implicit] = results;
  const value = JSON.parse(json.stdout);
  assert.equal(json.stdout, `${JSON.stringify(value)}\n`, "JSON remains one compact value followed by a newline");
  if (args[0] === "data" && args[1] === "read") assert.match(text.stdout, /\n(?:项目|Project)[:：] ?test-project\n/);
  else assert.match(text.stdout, /\nproject[:：] ?test-project\n/);
  assert.throws(() => JSON.parse(text.stdout), SyntaxError, "text must no longer be pretty-printed JSON");
  for (const field of ["modelRef", "id", "storeId", "nextCursor"]) {
    if (value[field] !== undefined) assert.ok(text.stdout.includes(value[field]), field);
  }
  for (const item of value.items ?? []) assert.ok(text.stdout.includes(item.id ?? item.storeId));
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

test("actual model/data/Store reads use Agent text by default and preserve special strings and nested JSON values", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  const model = await representations(f, ["model", "read", "record.json", "--part", "all"]);
  assert.deepEqual(model.definition, schema);
  const data = await representations(f, ["data", "read", "a", "--store", "records"]);
  assert.deepEqual(data.value, value);
  assert.equal(data.revision, "1");
  const query = cli(f, ["data", "read", "a", "--store", "records", "--path", "$.nested.nil"], "json");
  assert.equal(query.status, 0, query.stderr);
  assert.deepEqual(JSON.parse(query.stdout).value, [null]);
  const metadata = await representations(f, ["data", "read", "a", "--store", "records", "--metadata-only"]);
  assert.equal(Object.hasOwn(metadata, "value"), false);
  const metadataText = cli(f, ["data", "read", "a", "--store", "records", "--metadata-only"]);
  assert.doesNotMatch(metadataText.stdout, /正文|Content[:：]|nested/);
  const store = await representations(f, ["data", "store", "read", "records"]);
  assert.equal(store.storeId, "records");
  assert.equal(store.model, "record.json");
  assert.equal(store.capabilities.value, true);
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("all three list commands expose the same paged receipt in JSON, text and default output", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  for (const args of [["model", "list"], ["data", "list", "--store", "records"], ["data", "store", "list"]]) {
    const first = await representations(f, [...args, "--limit", "1"]);
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.nextCursor.length);
  }
  // Continuation/order/filter contracts belong to list-pagination-cli and service tests.
  assert.deepEqual(await snapshotTree(f.root), before);
});

for (const domain of ["model", "data", "store"] as const) {
  test(`${domain} dry-run exposes a text plan without changing the Project`, { timeout: 60_000 }, async t => {
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
    assert.match(result.stdout, /project[:：] ?test-project/);
    assert.ok(result.stdout.includes(plans[domain].operation));
    assert.match(result.stdout, /dryRun[:：] ?true/);
    if (domain === "model") assert.match(result.stdout, /"name":"true"/);
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
    assert.deepEqual(Object.keys(error.error), ["code"]);
    assert.equal(json.stderr, `${JSON.stringify(error)}\n`);
    // The presentation unit tests exhaust text/default combinations; these calls
    // retain real explicit-text and default-text error dispatch at the CLI boundary.
    if (index < 2) {
      const readable = cli(f, [...args], index === 0 ? "text" : undefined);
      assert.equal(readable.status, 1);
      assert.equal(readable.stdout, "");
      assert.ok(readable.stderr.includes(code));
      assert.throws(() => JSON.parse(readable.stderr), SyntaxError);
    }
  }
});

test("reading a null record preserves null in both formats and excludes it in metadata scope", async t => {
  const f = await businessFixture(t, { "nullable.json": { type: "null" } });
  await f.createStore("nullable", "nullable.json");
  await writeData({}, f.root, "nullable", "n-7", "create", { kind: "value", value: null });
  const args = ["data", "read", "n-7", "--store", "nullable"];
  const json = cli(f, args, "json"), text = cli(f, args), metadata = cli(f, [...args, "--metadata-only"], "json");
  for (const result of [json, text, metadata]) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
  assert.equal(JSON.parse(json.stdout).value, null);
  assert.match(text.stdout, /(?:正文：|Content:)\nnull\n$/);
  const { value, ...expectedMetadata } = JSON.parse(json.stdout);
  assert.deepEqual(JSON.parse(metadata.stdout), expectedMetadata);
});

test("Runner and debug commands keep session identifiers private in both representations", async t => {
  const fixture = await businessFixture(t);
  const clean: NodeJS.ProcessEnv = { ...process.env, MEMSPHERE_HOME: fixture.home };
  for (const name of Object.keys(clean)) {
    if (/^(?:path|codex_thread_id|traecli_thread_id|claude_code_session_id|memsphere_review_.+)$/i.test(name)) delete clean[name];
  }
  clean.PATH = fixture.cwd; // A real lookup in an empty directory gives a deterministic missing result.
  const session = "private-session-sentinel";
  const execute = (args: string[], env: NodeJS.ProcessEnv, json: boolean) => {
    const r = spawnSync(process.execPath, [entry, ...args, ...(json ? ["--output", "json"] : [])], {
      cwd: fixture.cwd, env: { ...clean, ...env }, encoding: "utf8", timeout: 15000
    });
    assert.ifError(r.error);
    assert.doesNotMatch(r.stdout + r.stderr, /private-session-sentinel|sessionId|installHelp|detectedAt/);
    return r;
  };
  for (const json of [true, false]) {
    const detection = execute(["runner", "detect"], {}, json);
    assert.equal(detection.status, 0, detection.stderr);
    assert.equal(detection.stderr, "");
    const items = ["codex", "traex", "claude"].map(type => ({ type, status: "missing" }));
    if (json) assert.deepEqual(JSON.parse(detection.stdout), { items });
    else for (const { type } of items) assert.ok(detection.stdout.includes(type) && detection.stdout.includes("missing"));
    for (const identified of [true, false]) {
      const env = identified ? { CODEX_THREAD_ID: session } : {};
      for (const args of [["runner", "identity"], ["debug-thread-id"]]) {
        const reply = execute(args, env, json);
        const runner = args.length === 2;
        assert.equal(reply.status, runner || identified ? 0 : 1, reply.stderr);
        assert.equal(reply.stderr, "");
        if (json) assert.deepEqual(JSON.parse(reply.stdout), runner && identified ? { identified, agentType: "codex" } : { identified });
        else {
          assert.match(reply.stdout, new RegExp("identified[：:] ?" + identified));
          if (runner && identified) assert.match(reply.stdout, /agentType[：:] ?codex/);
        }
      }
    }
    const conflict = execute(["runner", "identity"], { CODEX_THREAD_ID: session, TRAECLI_THREAD_ID: session }, json);
    assert.equal(conflict.status, 1);
    assert.equal(conflict.stdout, "");
    assert.match(conflict.stderr, /INTERNAL_ERROR/);
  }
});

test("CLI registry commands publish only public registration fields in text and JSON", async t => {
  const id = "example.inspection";
  for (const format of [undefined, "json"] as const) {
    const f = await businessFixture(t);
    const descriptor = join(f.cwd, "private-descriptor.json");
    const binding = join(f.cwd, "private-binding.json");
    await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, id, name: "Inspection", description: "Test tool",
      command: [process.execPath], versionProbe: { args: ["--version"], format: "semver" } }));
    await writeFile(binding, JSON.stringify({ schemaVersion: 1, args: ["private-bound-argument"] }));
    const invoke = (args: string[], allowed: string[]) => {
      const result = cli(f, ["cli", ...args], format);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes(id));
      assert.ok(!result.stdout.includes(process.execPath));
      assert.doesNotMatch(result.stdout, /private-|invocation|descriptorPath|envFrom/);
      if (format === "json") {
        const value = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(value).filter(key => !allowed.includes(key)), []);
        return value;
      }
    };
    invoke(["register", descriptor], ["id", "status"]);
    invoke(["bind", id, "--binding", binding], ["id", "status", "project", "app"]);
    const page = invoke(["list"], ["items", "nextCursor"]);
    const detail = invoke(["show", id], ["id", "status", "project", "app", "apps"]);
    const checked = invoke(["check", id], ["id", "status", "app", "items", "total"]);
    if (format === "json") {
      assert.equal(page.items.find((item: { id: string }) => item.id === id).id, id);
      assert.equal(detail.id, id);
      assert.equal(checked.status, "available");
      for (const item of checked.items) assert.deepEqual(Object.keys(item).sort(), ["name", "status"]);
    }
  }
});

test("update and edit dry-runs preserve the stored record in both representations", async t => {
  const f = await fixture(t);
  const before = await snapshotTree(f.root);
  for (const format of ["json", undefined] as const) {
    for (const [verb, options] of [["update", ["--value", JSON.stringify(value)]],
      ["edit", ["--patch", '[{"op":"replace","path":"/nested/zero","value":1}]']]] as const) {
      const result = cli(f, ["data", verb, "a", "--store", "records", ...options, "--dry-run"], format);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      if (format) {
        const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.operation, "data." + verb);
        assert.equal(receipt.dryRun, true);
        assert.equal(receipt.id, "a");
        assert.equal(receipt.storeId, "records");
        assert.equal(receipt.value, undefined);
      } else {
        assert.ok(result.stdout.includes("data." + verb));
        assert.match(result.stdout, /dryRun[:：] ?true/);
      }
    }
  }
  assert.deepEqual(await snapshotTree(f.root), before);
});
