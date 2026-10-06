import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createViewServer } from "../src/commands/view.js";
import { projectCreateCommand } from "../src/commands/project.js";
import { resolveProjectContext } from "../src/project/resolver.js";
import { readConfig } from "../src/config.js";
import { createMemoryCatalogForConfig, createProjectMemoryCatalogs } from "../src/memory/factory.js";
import { startRun } from "../src/run/store.js";
import { installApp, setAppEnabled } from "../src/app/install.js";
import { readAppState } from "../src/app/state.js";
import { packageDigest } from "../src/app/files.js";
import { bindCli, checkCli, listClis, registerCli, showCli } from "../src/tools/registry.js";
import { invokeAppOperation } from "../src/app/backend.js";
import { createProjectModelHost } from "../src/project/models.js";

// Keep recovery subprocesses independent of concurrent builds replacing dist.
// The packed CLI is checked separately by the guide acceptance workflow.
const cliArguments = ["--import", import.meta.resolve("tsx"), resolve("src/cli.ts")];
const expenseExample = resolve("examples/apps/expense");
async function fixture(action: (root: string, context: Awaited<ReturnType<typeof resolveProjectContext>>, app: string) => Promise<void>, embedded = false) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-app-test-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT,
    author: process.env.GIT_AUTHOR_NAME, authorEmail: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME, committerEmail: process.env.GIT_COMMITTER_EMAIL };
  try {
    process.chdir(root);
    process.env.MEMSPHERE_HOME = join(root, "home"); process.env.MEMSPHERE_PROJECT = "test";
    Object.assign(process.env, { GIT_AUTHOR_NAME: "App Test", GIT_AUTHOR_EMAIL: "app@example.test", GIT_COMMITTER_NAME: "App Test", GIT_COMMITTER_EMAIL: "app@example.test" });
    if (embedded) {
      await mkdir(join(root, ".memsphere/memory"), { recursive: true });
      execFileSync("git", ["init", "-b", "master"], { cwd: root });
      execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: root });
    }
    await projectCreateCommand("test", embedded ? { embedded: ".memsphere/memory" } : {});
    const context = await resolveProjectContext({ project: "test" });
    const app = join(root, "app"); await mkdir(join(app, "memories"), { recursive: true });
    await writeFile(join(app, "app.json"), JSON.stringify({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example",
      assets: { memories: [{ key: "intro", path: "memories/intro.yaml" }] }, entrypoints: { agent: ["concepts/app-intro"] } }));
    await writeFile(join(app, "memories/intro.yaml"), "!concept\nsyntax: memsphere-20260721-stable\nnames: [app-intro]\ndefines: [App introduction]\n");
    await action(root, context, app);
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries({ MEMSPHERE_HOME: previous.home, MEMSPHERE_PROJECT: previous.project,
      GIT_AUTHOR_NAME: previous.author, GIT_AUTHOR_EMAIL: previous.authorEmail, GIT_COMMITTER_NAME: previous.committer, GIT_COMMITTER_EMAIL: previous.committerEmail })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("CLI installs a minimal App and reports ownership without changing other Project Memory", async () => fixture(async (root, context, app) => {
  const invoke = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [...cliArguments, "--project", "test", ...args, "--output", "json"], { cwd: root, encoding: "utf8" }));
  assert.equal(invoke("app", "install", app).status, "installed");
  assert.equal(invoke("app", "enable", "example.app").enabled, true);
  assert.equal(invoke("app", "install", app).status, "unchanged");
  const catalog = createMemoryCatalogForConfig(await readConfig());
  assert.equal((await catalog.resolve("concepts/app-intro")).app?.id, "example.app");
  assert.equal((await catalog.read("concepts/app-intro")).names[0], "app-intro");
  assert.equal((await catalog.resolve("concepts/memsphere-memory")).app, undefined);
  await setAppEnabled(context, "example.app", false);
  assert.equal((await createMemoryCatalogForConfig(await readConfig()).resolve("concepts/app-intro")).app?.enabled, false);
}));

for (const embedded of [false, true]) test(`${embedded ? "Embedded" : "Managed"} interrupted installation stays hidden after a new process starts and same-source retry completes`, async () => fixture(async (root, context, app) => {
  await assert.rejects(installApp(context, app, {}, { afterMemoryPublish: async () => { throw new Error("injected commit failure"); } }), /injected/);
  const pending = await readAppState(context.primary);
  assert.equal(Object.keys(pending.installations).length, 0);
  assert.equal(Object.keys(pending.operations).length, 1);
  const catalog = createMemoryCatalogForConfig(await readConfig());
  await assert.rejects(catalog.read("concepts/app-intro"), /not found/);
  assert.equal((await catalog.read("concepts/memsphere-memory")).names[0], "memsphere-memory");
  const result = JSON.parse(execFileSync(process.execPath, [...cliArguments, "--project", "test", "app", "install", app, "--output", "json"], { cwd: root, encoding: "utf8" }));
  assert.equal(result.status, "installed");
  assert.equal((await createMemoryCatalogForConfig(await readConfig()).resolve("concepts/app-intro")).app?.id, "example.app");
}, embedded));

test("Mounted write target is rejected before touching either the target or Home", async () => fixture(async (root, context, app) => {
  await projectCreateCommand("mounted");
  const mounted = (await resolveProjectContext({ project: "mounted" })).primary;
  const before = await packageDigest(context.home);
  await assert.rejects(installApp({ ...context, mounted: [mounted] }, app, {}, { target: mounted }), /Mounted/);
  await assert.rejects(setAppEnabled({ ...context, mounted: [mounted] }, "example.app", true, mounted), /Mounted/);
  assert.equal(await packageDigest(context.home), before);
}));

test("Disabled App procedures reject direct, file and indirect Run starts while existing Run sources stay frozen", async () => fixture(async (root, context, app) => {
  const manifest = JSON.parse(await readFile(join(app, "app.json"), "utf8"));
  manifest.assets.memories.push({ key: "procedure", path: "memories/procedure.yaml" });
  await writeFile(join(app, "app.json"), JSON.stringify(manifest));
  await writeFile(join(app, "memories/procedure.yaml"), "!procedure\nsyntax: memsphere-20260721-stable\nnames: [app-work]\nflow:\n  - !action\n    action: Produce a note\n    artifact: !artifact\n      name: note\n      format: markdown\n");
  await installApp(context, app);
  const config = await readConfig();
  const input = () => ({ memoryRoot: config.memoryRoot, runsRoot: config.runsRoot, name: "App task",
    memoryCatalog: createMemoryCatalogForConfig(config), projectMemoryCatalogs: createProjectMemoryCatalogs(config) });
  await assert.rejects(startRun({ ...input(), procedureName: "app-work" }), /disabled/);
  await setAppEnabled(context, "example.app", true);
  const run = await startRun({ ...input(), procedureName: "app-work" });
  assert.equal(run.appSources?.[0].id, "example.app");
  const before = JSON.stringify(run);
  await setAppEnabled(context, "example.app", false);
  assert.equal(JSON.stringify(run), before);
  const installed = (await readAppState(context.primary)).installations["example.app"];
  await assert.rejects(startRun({ ...input(), procedureFile: join(config.memoryRoot, installed.memories.find(m => m.key === "procedure")!.path) }), /disabled/);
  const caller = join(root, "caller.yaml");
  await writeFile(caller, "!procedure\nsyntax: memsphere-20260721-stable\nnames: [caller]\nflow:\n  - !call\n    target: app-work\n");
  await assert.rejects(startRun({ ...input(), procedureFile: caller }), /disabled/);
  assert.equal((await input().memoryCatalog.read("procedures/app-work")).names[0], "app-work");
}));

test("CLI discovery never launches a program; explicit check uses only its declared version probe", async () => fixture(async (root, context) => {
  const descriptor = join(root, "cli.json"), script = join(root, "tool.mjs"), counter = join(root, "counter");
  await writeFile(script, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(counter)}, 'probe'); console.log('1.2.3');`);
  await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, id: "example.tool", name: "Tool", description: "Test", command: [process.execPath, script],
    versionProbe: { args: ["--version"], format: "semver" }, requirements: { version: "^1.0.0" } }));
  await registerCli(context, descriptor);
  const binding = join(root, "binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, args: ["a value with spaces"] }));
  await bindCli(context, "example.tool", binding);
  await listClis(context.primary);
  assert.deepEqual((await showCli(context.primary, "example.tool")).invocation?.args, [script, "a value with spaces"]);
  await assert.rejects(readFile(counter), { code: "ENOENT" });
  assert.equal((await checkCli(context.primary, "example.tool")).status, "available");
  assert.equal(await readFile(counter, "utf8"), "probe");
  await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, id: "example.unknown", name: "Unknown", description: "No probe protocol",
    command: [process.execPath], requirements: { version: "^1.0.0" } }));
  await registerCli(context, descriptor);
  assert.equal((await checkCli(context.primary, "example.unknown")).status, "unknown");
  assert.equal(await readFile(counter, "utf8"), "probe");
  await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, id: "example.missing", name: "Missing", description: "Missing executable", command: [join(root, "not-installed")] }));
  await registerCli(context, descriptor);
  assert.equal((await checkCli(context.primary, "example.missing")).status, "unavailable");
}));

test("Real View API and independently launched CLI share records, revisions and business validation", async () => fixture(async (root, context) => {
  const directory = join(root, "expense"); await cp(expenseExample, directory, { recursive: true });
  const ledger = join(root, "ledger"), executable = join(directory, "cli/expense.cjs");
  await installApp(context, directory, { ledgerDirectory: ledger });
  const binding = join(root, "expense-binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, executable }));
  await bindCli(context, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await setAppEnabled(context, "org.memsphere.expense", true);
  const config = await readConfig(); config.view = { host: "127.0.0.1", port: 0 };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invoke = async (operation: string, input: unknown) => {
    const response = await fetch(`${origin}/api/projects/test/apps/org.memsphere.expense/operations/${operation}`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ input })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result.result;
  };
  try {
  const html = await (await fetch(origin)).text();
  assert.match(html, /appApiBase/);
  const record = await invoke("create", { description: "View expense", amount: 25 }) as { id: string; revision: number };
  const list = JSON.parse(execFileSync(process.execPath, [executable, "--ledger", ledger, "list"], { encoding: "utf8" }));
  assert.equal(list.records[0].id, record.id);
  execFileSync(process.execPath, [executable, "--ledger", ledger, "submit", "--id", record.id, "--revision", String(record.revision)], { encoding: "utf8" });
  assert.equal((await invoke("list", {}) as any).records[0].value.status, "submitted");
  await assert.rejects(invoke("create", { description: "Invalid", amount: -1 }), /positive/);
  assert.throws(() => execFileSync(process.execPath, [executable, "--ledger", ledger, "create", "--description", "Invalid", "--amount", "-1"], { encoding: "utf8", stdio: "pipe" }), /positive/);
  const models = await createProjectModelHost({}, { root: context.primary.paths.root });
  assert.equal((await models.definition("example/expense")).origin, "app");
  await setAppEnabled(context, "org.memsphere.expense", false);
  await assert.rejects(invoke("list", {}), /disabled/);
  assert.equal(JSON.parse(execFileSync(process.execPath, [executable, "--ledger", ledger, "list"], { encoding: "utf8" })).records.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test("Two Apps share one CLI descriptor with isolated bindings; Projects never inherit installations", async () => fixture(async (root, context, directory) => {
  const descriptor = { schemaVersion: 1, id: "shared.tool", name: "Shared", description: "Shared external tool", command: [process.execPath] };
  const manifest = JSON.parse(await readFile(join(directory, "app.json"), "utf8"));
  manifest.assets.cliDescriptors = [{ key: "tool", path: "tool.json" }];
  manifest.cliBindings = [{ cli: "shared.tool", args: ["--ledger", "one"] }];
  await writeFile(join(directory, "tool.json"), JSON.stringify(descriptor));
  await writeFile(join(directory, "app.json"), JSON.stringify(manifest));
  await installApp(context, directory);
  const second = join(root, "second"); await cp(directory, second, { recursive: true });
  manifest.id = "example.second"; manifest.assets.memories = []; manifest.entrypoints.agent = [];
  manifest.cliBindings[0].args[1] = "two";
  await writeFile(join(second, "app.json"), JSON.stringify(manifest));
  await installApp(context, second);
  assert.deepEqual((await showCli(context.primary, "shared.tool", "example.app")).invocation?.args, ["--ledger", "one"]);
  assert.deepEqual((await showCli(context.primary, "shared.tool", "example.second")).invocation?.args, ["--ledger", "two"]);
  assert.equal((await showCli(context.primary, "shared.tool")).status, "unresolved");
  await setAppEnabled(context, "example.second", true);
  await setAppEnabled(context, "example.app", false);
  assert.equal((await checkCli(context.primary, "shared.tool", "example.second")).status, "available");
  await projectCreateCommand("other");
  const other = await resolveProjectContext({ project: "other" });
  assert.equal(Object.keys((await readAppState(other.primary)).installations).length, 0);
  // Explicit context selects the target even while MEMSPHERE_PROJECT remains test.
  await installApp(other, directory);
  assert.equal(Object.keys((await readAppState(other.primary)).installations).length, 1);
  assert.equal((await readAppState(other.primary)).installations["example.app"].enabled, false);
}));

test("A ChangeSet freezes App ownership in its digest and rejects disabled candidate procedures", async () => fixture(async (root, context, directory) => {
  const manifest = JSON.parse(await readFile(join(directory, "app.json"), "utf8"));
  manifest.assets.memories = [{ key: "work", path: "work.yaml" }]; manifest.entrypoints.agent = ["procedures/app-work"];
  await writeFile(join(directory, "app.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "work.yaml"), "!procedure\nsyntax: memsphere-20260721-stable\nnames: [app-work]\nflow:\n  - !action\n    action: Produce a note\n    artifact: !artifact\n      name: note\n      format: markdown\n");
  await assert.rejects(installApp(context, directory, {}, { afterMemoryPublish: async () => { throw new Error("interrupted"); } }), /interrupted/);
  const state = await readAppState(context.primary);
  const changeId = state.operations["example.app"].changeId!;
  const { withMemoryChangePreview } = await import("../src/memory/changeset.js");
  const { AppSnapshotMemoryProvider } = await import("../src/app/ownership.js");
  const { DefaultMemoryCatalog } = await import("../src/memory/catalog.js");
  await withMemoryChangePreview({ home: context.home, project: "test", changeId, use: async preview => {
    assert.equal(Object.values(preview.change.app_ownership!)[0].id, "example.app");
    const catalog = new DefaultMemoryCatalog(new AppSnapshotMemoryProvider(preview.memoryRoot, preview.change.app_ownership));
    assert.equal((await catalog.resolve("procedures/app-work")).app?.enabled, false);
    const config = await readConfig();
    await assert.rejects(startRun({ memoryRoot: preview.memoryRoot, runsRoot: config.runsRoot, name: "Candidate", procedureName: "app-work", memoryCatalog: catalog }), /disabled/);
  } });
}));

test("Shared Model Package remains usable when another App is disabled; separate Projects keep separate data", async () => fixture(async (root, context) => {
  const first = join(root, "expense-one"); await cp(expenseExample, first, { recursive: true });
  await installApp(context, first, { ledgerDirectory: join(root, "ledger-one") });
  const binding = join(root, "binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, executable: join(first, "cli/expense.cjs") }));
  await bindCli(context, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await setAppEnabled(context, "org.memsphere.expense", true);
  await invokeAppOperation(context.primary, "org.memsphere.expense", "create", { description: "First Project", amount: 12 });
  const second = join(root, "expense-two"); await cp(first, second, { recursive: true });
  const manifest = JSON.parse(await readFile(join(second, "app.json"), "utf8"));
  manifest.id = "example.other-expense"; manifest.assets.memories = []; manifest.entrypoints = {};
  await writeFile(join(second, "app.json"), JSON.stringify(manifest));
  await installApp(context, second, { ledgerDirectory: join(root, "ledger-two") });
  await bindCli(context, "org.memsphere.expense-cli", binding, manifest.id);
  await setAppEnabled(context, manifest.id, true);
  await setAppEnabled(context, "org.memsphere.expense", false);
  const created = await invokeAppOperation(context.primary, manifest.id, "create", { description: "Shared Model", amount: 7 }) as { value: { amount: number } };
  assert.equal(created.value.amount, 7);
  await projectCreateCommand("separate");
  const separate = await resolveProjectContext({ project: "separate" });
  await installApp(separate, first, { ledgerDirectory: join(root, "ledger-separate") });
  await bindCli(separate, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await assert.rejects(invokeAppOperation(separate.primary, "org.memsphere.expense", "list", {}), /disabled/);
  await setAppEnabled(separate, "org.memsphere.expense", true);
  assert.deepEqual((await invokeAppOperation(separate.primary, "org.memsphere.expense", "list", {}) as { records: unknown[] }).records, []);
  await assert.rejects(invokeAppOperation(separate.primary, "org.memsphere.expense", "undeclared", {}), /Undeclared/);
}));
