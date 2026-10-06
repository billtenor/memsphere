import { mutateModel } from "../src/project/model-service.js";
import { createBusinessStore } from "../src/project/business-stores.js";
import { writeData } from "../src/project/data-service.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import crossSpawn from "cross-spawn";
import { parse } from "yaml";
import { runGit } from "../src/git.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";

const cliPath = resolve("dist/cli.js");
const json = (value: unknown) => JSON.stringify(value, null, 2);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "memsphere-list-pages-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const project = join(home, "projects", "main");
  const memory = join(workspace, "memory");
  await mkdir(project, { recursive: true });
  for (const kind of ["concepts", "statements", "schemas", "procedures"]) await mkdir(join(memory, kind), { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: workspace });
  const identity = await resolveWorkspaceIdentity(workspace);
  await writeFile(join(project, "project.json"), json({ format_version: 1, name: "main", created_at: "2026-01-01T00:00:00.000Z" }));
  await writeFile(join(project, "config.json"), json({ store: { type: "embedded", repository_path: workspace, memory_path: "memory" } }));
  const registry = {
    format_version: 1,
    projects: { main: { root: project } } as Record<string, { root: string }>,
    workspaces: { [identity.key]: { primary: "main", mounted: [] as string[] } }
  };
  const saveRegistry = () => writeFile(join(home, "registry.json"), json(registry));
  await saveRegistry();
  const env = { ...process.env, MEMSPHERE_HOME: home, MEMSPHERE_PROJECT: "", MEMSPHERE_CONFIG_PATH: "" };
  const run = (args: string[], cwd = workspace) => spawnSync(process.execPath, [cliPath, ...args], {
    cwd, env, encoding: "utf8", timeout: 20_000
  });
  const writeMemory = async (name: string, kind = "concepts", body = "") => {
    const tag = { concepts: "concept", statements: "statement", schemas: "schema", procedures: "procedure" }[kind];
    await writeFile(join(memory, kind, `${name}.yaml`), `!${tag}\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\ndefines: [${name}]\n${body || (kind === "statements" ? "asserts: [Follow the rule.]\n" : "")}`);
  };
  return { root, home, workspace, project, memory, registry, saveRegistry, env, run, writeMemory, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function result(run: ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>) {
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  return JSON.parse(run.stdout);
}

test("project list pages all registered Projects and binds cursors to the Home and Workspace", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 102; index++) f.registry.projects[`project-${String(index).padStart(3, "0")}`] = { root: join(f.home, `missing-${index}`) };
    await f.saveRegistry();
    const first = result(f.run(["project", "list", "--output", "json"]));
    assert.equal(first.items.length, 100);
    assert.equal(first.items[0].name, "main");
    assert.equal(first.items[0].primary, true);
    const last = result(f.run(["project", "list", "--limit", "1000", "--cursor", first.nextCursor, "--output", "json"]));
    assert.equal(last.items.length, 3);
    assert.equal(Object.hasOwn(last, "nextCursor"), false);
    assert.deepEqual([...first.items, ...last.items].map((item: { name: string }) => item.name), Object.keys(f.registry.projects).sort());
    const text = f.run(["project", "list", "--limit", "1"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /^main\tavailable\tprimary/m);
    assert.match(text.stdout, /^nextCursor: \S+$/m);
    const elsewhere = join(f.root, "elsewhere");
    await mkdir(elsewhere);
    const wrongWorkspace = f.run(["project", "list", "--cursor", first.nextCursor, "--output", "json"], elsewhere);
    assert.equal(wrongWorkspace.status, 1);
    assert.equal(JSON.parse(wrongWorkspace.stderr).error.code, "INVALID_CURSOR");
    const otherHome = join(f.root, "other-home");
    const wrongHome = spawnSync(process.execPath, [cliPath, "project", "list", "--cursor", first.nextCursor, "--output=json"], {
      cwd: f.workspace, env: { ...f.env, MEMSPHERE_HOME: otherHome }, encoding: "utf8"
    });
    assert.equal(wrongHome.status, 1);
    assert.equal(JSON.parse(wrongHome.stderr).error.code, "INVALID_CURSOR");
  } finally { await f.cleanup(); }
});

test("Memory CLI filters before paging and supports the same result in JSON, YAML and text", async () => {
  const f = await fixture();
  try {
    await Promise.all([f.writeMemory("zed"), f.writeMemory("alpha"), f.writeMemory("middle"), f.writeMemory("rules", "statements")]);
    const first = result(f.run(["memory", "list", "--kind", "concepts", "--limit", "1", "--output=json"]));
    assert.deepEqual(first.items.map((item: { reference: string }) => item.reference), ["concepts/alpha"]);
    assert.equal(Object.hasOwn(first, "memories"), false);
    const last = result(f.run(["memory", "list", "--kind", "concepts", "--cursor", first.nextCursor, "--limit", "1000", "--output", "json"]));
    assert.deepEqual(last.items.map((item: { reference: string }) => item.reference), ["concepts/middle", "concepts/zed"]);
    assert.equal(Object.hasOwn(last, "nextCursor"), false);
    const yaml = f.run(["memory", "list", "--kind", "concepts", "--limit", "1"]);
    assert.equal(yaml.status, 0, yaml.stderr);
    assert.deepEqual(parse(yaml.stdout), first);
    const text = f.run(["memory", "list", "--kind", "concepts", "--limit", "1", "--output", "text"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /^concepts\/alpha\tmain@/);
    assert.match(text.stdout, new RegExp(`nextCursor: ${first.nextCursor}`));
    const empty = result(f.run(["memory", "list", "--query", "no-match", "--output", "json"]));
    assert.deepEqual(empty, { items: [] });
    const wrongFilter = f.run(["memory", "list", "--kind", "statements", "--cursor", first.nextCursor, "--output=json"]);
    assert.equal(wrongFilter.status, 1);
    assert.equal(JSON.parse(wrongFilter.stderr).error.code, "INVALID_CURSOR");
  } finally { await f.cleanup(); }
});

test("Memory child pages retain parent context and declaration order in the actual CLI", async () => {
  const f = await fixture();
  try {
    await f.writeMemory("rules", "statements", "sections:\n  - !statement\n    names: [parent]\n    sections:\n      - !statement\n        names: [zed]\n        asserts: [Rule Z.]\n      - !statement\n        names: [alpha]\n        asserts: [Rule A.]\n      - !statement\n        names: [middle]\n        asserts: [Rule M.]\n  - !statement\n    names: [another]\n    asserts: [Other rule.]\n");
    const root = result(f.run(["memory", "list", "rules", "--limit", "1", "--output=json"]));
    assert.equal(root.items[0].node_ref, "statement:parent");
    const args = ["memory", "list", "rules", "--node", "statement:parent", "--output=json"];
    const first = result(f.run([...args, "--limit", "1"]));
    const last = result(f.run([...args, "--limit", "2", "--cursor", first.nextCursor]));
    assert.deepEqual([...first.items, ...last.items].map((item: { name: string }) => item.name), ["zed", "alpha", "middle"]);
    assert.equal(last.memory.reference, "statements/rules");
    assert.equal(last.parent_node_ref, "statement:parent");
    assert.equal(Object.hasOwn(last, "nodes"), false);
    assert.equal(Object.hasOwn(last, "nextCursor"), false);
    const wrongMode = f.run([...args, "--cursor", root.nextCursor]);
    assert.equal(wrongMode.status, 1);
    assert.equal(JSON.parse(wrongMode.stderr).error.code, "INVALID_CURSOR");
  } finally { await f.cleanup(); }
});

test("archive list filters before paging and orders timestamp ties by kind and ID", async () => {
  const f = await fixture();
  try {
    const entries = [
      { kind: "runs", id: "run-b", archivedAt: "2026-01-02" },
      { kind: "changes", id: "change-b", archivedAt: "2026-01-02" },
      { kind: "changes", id: "change-a", archivedAt: "2026-01-02" },
      { kind: "runs", id: "run-a", archivedAt: "2026-01-01" }
    ];
    for (const entry of entries) {
      const directory = join(f.project, "archives", entry.kind, entry.id);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, ".archive.json"), json({ ...entry, layout: "directory" }));
      if (entry.kind === "runs") await writeFile(join(directory, `${entry.id}.json`), "{}");
    }
    const first = result(f.run(["archive", "list", "--limit", "2", "--output=json"]));
    const last = result(f.run(["archive", "list", "--cursor", first.nextCursor, "--output=json"]));
    assert.deepEqual([...first.items, ...last.items].map((item: { id: string }) => item.id), ["change-a", "change-b", "run-b", "run-a"]);
    const changes = result(f.run(["archive", "list", "changes", "--limit", "1", "--output=json"]));
    assert.equal(changes.items[0].id, "change-a");
    assert(changes.nextCursor);
    const wrong = f.run(["archive", "list", "runs", "--cursor", changes.nextCursor, "--output=json"]);
    assert.equal(wrong.status, 1);
    assert.equal(JSON.parse(wrong.stderr).error.code, "INVALID_CURSOR");
    const text = f.run(["archive", "list", "changes", "--limit", "1"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /^changes change-a/m);
    assert.match(text.stdout, /^nextCursor: /m);
  } finally { await f.cleanup(); }
});

test("list argument and runtime failures return one JSON error and leave stdout empty", async () => {
  const f = await fixture();
  try {
    for (const args of [
      ["project", "list", "--unknown", "--output", "json"],
      ["project", "list", "--limit", "0", "--output=json"],
      ["memory", "list", "--kind", "unknown", "--output=json"],
      ["memory", "list", "--node", "x", "--output=json"],
      ["memory", "list", "missing", "--output=json"],
      ["archive", "list", "unknown", "--output=json"],
      ["model", "list", "--unknown", "--output=json"],
      ["model", "create", "example.json", "--output=json"],
      ["model", "list", "--origin", "unknown", "--output=json"],
      ["data", "list", "--output=json"],
      ["data", "store", "create", "example", "--output=json"],
      ["data", "store", "list", "--kind", "unknown", "--output=json"]
    ]) {
      const failed = f.run(args);
      assert.ifError(failed.error);
      assert.equal(failed.status, 1, failed.stderr);
      assert.equal(failed.stdout, "");
      const error = JSON.parse(failed.stderr).error;
      assert.equal(typeof error.code, "string");
      assert.equal(typeof error.message, "string");
    }
    assert.equal(f.run(["memory", "list", "--help"]).status, 0);
    assert.equal(f.run(["--version"]).status, 0);
  } finally { await f.cleanup(); }
});

test("model, data Store and record lists paginate through the registered CLI commands", async () => {
  const f = await fixture();
  try {
    // Model/Store creation is a precondition; this test protects only CLI pagination.
    for (const name of ["zed", "alpha", "middle"]) await mutateModel({}, f.project, "create", `${name}.json`, {
      source: json({ type: "object", properties: { count: { type: "integer" } }, required: ["count"] }),
      fields: { tags: ["paged", "sample"] }
    });
    const models = ["model", "list", "--origin", "project", "--tag", "paged", "--output=json"];
    const modelFirst = result(f.run([...models, "--limit", "1"]));
    const modelLast = result(f.run([...models, "--cursor", modelFirst.nextCursor, "--limit", "1000"]));
    assert.deepEqual([...modelFirst.items, ...modelLast.items].map((item: { id: string }) => item.id), ["alpha.json", "middle.json", "zed.json"]);
    assert.equal(Object.hasOwn(modelLast, "nextCursor"), false);
    const modelText = f.run(["model", "list", "--origin", "project", "--tag", "paged", "--cursor", modelFirst.nextCursor, "--limit", "1000"]);
    assert.equal(modelText.status, 0, modelText.stderr);
    assert.deepEqual(parse(modelText.stdout).items, modelLast.items);
    assert.deepEqual(result(f.run(["model", "list", "--query", "no-match", "--output=json"])).items, []);
    for (const id of ["zed", "alpha", "middle"]) await createBusinessStore({}, f.project, id, {
      model: "alpha.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: `business/${id}` }
    });
    const stores = ["data", "store", "list", "--model", "alpha.json", "--kind", "value", "--output=json"];
    const storeFirst = result(f.run([...stores, "--limit", "1"]));
    const storeLast = result(f.run([...stores, "--cursor", storeFirst.nextCursor, "--limit", "1000"]));
    assert.deepEqual([...storeFirst.items, ...storeLast.items].map((item: { storeId: string }) => item.storeId), ["alpha", "middle", "zed"]);
    assert.equal(Object.hasOwn(storeLast, "nextCursor"), false);
    assert.deepEqual(result(f.run(["data", "list", "--store", "middle", "--output=json"])).items, []);
    for (const id of ["zed", "alpha", "middle"]) await writeData({}, f.project, "alpha", id, "create", { kind: "value", value: { count: 1 } });
    const records = ["data", "list", "--store", "alpha", "--output=json"];
    const recordFirst = result(f.run([...records, "--limit", "1"]));
    const recordLast = result(f.run([...records, "--cursor", recordFirst.nextCursor, "--limit", "1000"]));
    assert.deepEqual([...recordFirst.items, ...recordLast.items].map((item: { id: string }) => item.id), ["alpha", "middle", "zed"]);
    assert.equal(Object.hasOwn(recordLast, "nextCursor"), false);
    for (const args of [
      ["model", "list", "--origin", "system", "--cursor", modelFirst.nextCursor],
      ["data", "store", "list", "--model", "zed.json", "--kind", "value", "--cursor", storeFirst.nextCursor],
      ["data", "list", "--store", "middle", "--cursor", recordFirst.nextCursor]
    ]) {
      const failed = f.run([...args, "--output=json"]);
      assert.ifError(failed.error);
      assert.equal(failed.status, 1, failed.stderr);
      assert.equal(failed.stdout, "");
      assert.equal(JSON.parse(failed.stderr).error.code, "INVALID_CURSOR");
    }
  } finally { await f.cleanup(); }
});

test("Store creation reports invalid configuration as JSON field diagnostics without stdout", async () => {
  const f = await fixture();
  try {
    await mutateModel({}, f.project, "create", "alpha.json", { source: '{"type":"object"}' });
    const storeConfig = join(f.root, "store.json");
    await writeFile(storeConfig, json({ directory: 42 }));
    const invalidConfig = f.run(["data", "store", "create", "invalid", "--model", "alpha.json", "--kind", "value", "--factory", "memsphere/filesystem-json", "--config-file", storeConfig, "--output=json"]);
    assert.ifError(invalidConfig.error);
    assert.equal(invalidConfig.status, 1);
    assert.equal(invalidConfig.stdout, "");
    const error = JSON.parse(invalidConfig.stderr).error;
    assert.equal(error.code, "INVALID_ARGUMENT");
    assert(error.details.some((issue: { path: string[] }) => issue.path.includes("directory")));
  } finally { await f.cleanup(); }
});

test("Reviewer Memory pagination stays on the frozen Run and rejects another Session Project or Run", async () => {
  const f = await fixture();
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: cliPath });
  try {
    const runId = "run-frozen";
    const directory = join(f.project, "runs", runId);
    await mkdir(join(directory, "memory", "concepts"), { recursive: true });
    const files = ["alpha", "zed"].map((name) => `${runId}/memory/concepts/${name}.yaml`);
    for (const name of ["alpha", "zed"]) await writeFile(join(directory, "memory", "concepts", `${name}.yaml`), `!concept\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\ndefines: [frozen]\n`);
    await writeFile(join(directory, `${runId}.json`), json({
      contractVersion: 3, id: runId, name: "Frozen", status: "running", procedureName: "probe", memoryRoot: f.memory,
      memorySource: { kind: "changeset", project: "main", changeId: "change-test", checkpointDigest: "frozen", baseRevision: "base" },
      memorySnapshot: { path: "memory", files }, createdAt: "2026-01-01", updatedAt: "2026-01-01", stack: [], events: [], procedureSnapshots: {}
    }));
    const env = { ...f.env, MEMSPHERE_CONFIG_PATH: join(f.project, "config.json"), MEMSPHERE_REVIEW_MEMORY_RUN_ID: runId };
    const review = (args: string[]) => crossSpawn.sync(runtime.launcherPath, args, { cwd: f.workspace, env, encoding: "utf8", timeout: 20_000 });
    const first = result(review(["memory", "list", "--limit", "1", "--output=json"]));
    assert.equal(first.items[0].reference, "concepts/alpha");
    await f.writeMemory("new-live-memory");
    const last = result(review(["memory", "list", "--cursor", first.nextCursor, "--limit", "1000", "--output=json"]));
    assert.deepEqual(last.items.map((item: { reference: string }) => item.reference), ["concepts/zed"]);
    assert.equal(last.nextCursor, undefined);
    for (const option of [["--run", "other"], ["--project", "other"]]) {
      const denied = review(["memory", "list", ...option, "--output=json"]);
      assert.equal(denied.status, 1);
      assert.equal(denied.stdout, "");
      assert.equal(JSON.parse(denied.stderr).error.code, "REVIEW_SESSION_DENIED");
    }
    const liveCursor = f.run(["memory", "list", "--cursor", first.nextCursor, "--output=json"]);
    assert.equal(liveCursor.status, 1);
    assert.equal(JSON.parse(liveCursor.stderr).error.code, "INVALID_CURSOR");
    assert.deepEqual((await readdir(join(directory, "memory", "concepts"))).sort(), ["alpha.yaml", "zed.yaml"]);
    assert.match(await readFile(join(directory, "memory", "concepts", "zed.yaml"), "utf8"), /defines: \[frozen\]/);
  } finally { await runtime.cleanup(); await f.cleanup(); }
});
