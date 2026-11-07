import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
import { checkApp, installApp, setAppEnabled } from "../src/app/install.js";
import { readAppState } from "../src/app/state.js";
import { packageDigest } from "../src/app/files.js";
import { bindCli, checkCli, listClis, registerCli, showCli } from "../src/tools/registry.js";
import { invokeAppOperation } from "../src/app/backend.js";
import { mutateModel } from "../src/project/model-service.js";
import { createProjectModelHost } from "../src/project/models.js";

// Keep recovery subprocesses independent of concurrent builds replacing dist.
// The packed CLI is checked separately by the guide acceptance workflow.
const cliArguments = ["--import", import.meta.resolve("tsx"), resolve("src/cli.ts")];
const expenseExample = resolve("examples/apps/expense");
async function fixture(action: (root: string, context: Awaited<ReturnType<typeof resolveProjectContext>>, app: string) => Promise<void>, embedded = false) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-app-test-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, gitConfig: process.env.GIT_CONFIG_GLOBAL,
    author: process.env.GIT_AUTHOR_NAME, authorEmail: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME, committerEmail: process.env.GIT_COMMITTER_EMAIL };
  try {
    // Supply installed native dependencies to the copied CLI integration fixture.
    // The guide E2E separately verifies npm installs the distributed package.
    await symlink(join(previous.cwd, "node_modules"), join(root, "node_modules"), "junction");
    process.chdir(root);
    process.env.MEMSPHERE_HOME = join(root, "home"); process.env.MEMSPHERE_PROJECT = "test";
    // Project bootstrap reads git config, not GIT_AUTHOR_*; never inherit a developer's identity.
    process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
    await writeFile(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = App Test\n\temail = app@example.test\n");
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
    for (const [key, value] of Object.entries({ MEMSPHERE_HOME: previous.home, MEMSPHERE_PROJECT: previous.project, GIT_CONFIG_GLOBAL: previous.gitConfig,
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

test("Non-loopback App operations reject missing or invalid tokens and accept the operator token", async () => fixture(async (root, context) => {
  const directory = join(root, "expense"); await cp(expenseExample, directory, { recursive: true });
  await installApp(context, directory, { ledgerDirectory: join(root, "ledger") });
  const binding = join(root, "expense-binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, executable: join(directory, "cli/expense.cjs") }));
  await bindCli(context, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await setAppEnabled(context, "org.memsphere.expense", true);
  const config = await readConfig(); config.view = { host: "0.0.0.0", port: 0 };
  const server = createViewServer(config, { settingsToken: "fixture-token" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const token of [undefined, "wrong-token", "fixture-token"]) {
      const response = await fetch(`${origin}/api/projects/test/apps/org.memsphere.expense/operations/list`, {
        method: "POST", headers: { "content-type": "application/json", origin,
          ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ input: {} })
      });
      const payload = await response.json();
      assert.equal(response.status, token === "fixture-token" ? 200 : 401);
      if (token === "fixture-token") assert.deepEqual(payload.result.records, []);
      else assert.equal(payload.error, "Settings operator token is required");
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
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
  assert.equal((await models.definition("example/expense.json")).origin, "app");
  for (const operation of ["update", "delete"] as const) {
    await assert.rejects(mutateModel({}, context.primary.paths.root, operation, "example/expense.json",
      operation === "update" ? { fields: { description: "cannot overwrite an App model" } } : {}),
      (error: unknown) => (error as { code?: string }).code === "APP_MODEL_READ_ONLY");
  }
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


test("App show and check find renamed entrypoints beyond the first Memory page", async () => fixture(async (root, context, app) => {
  await installApp(context, app);
  const installed = (await readAppState(context.primary)).installations["example.app"];
  const memoryPath = join(context.primary.memoryRoot, installed.memories[0]!.path);
  await writeFile(memoryPath, (await readFile(memoryPath, "utf8")).replace("app-intro", "zzz-app-intro"));
  await Promise.all(Array.from({ length: 105 }, (_, index) => writeFile(
    join(context.primary.memoryRoot, "concepts", `before-${index}.yaml`),
    `!concept\nsyntax: memsphere-20260721-stable\nnames: [before-${index}]\ndefines: [Pagination fixture]\n`
  )));
  const shown = JSON.parse(execFileSync(process.execPath, [...cliArguments, "--project", "test", "app", "show", "example.app", "--output", "json"], { cwd: root, encoding: "utf8" }));
  assert.equal(shown.usage.agent[0].reference, "concepts/zzz-app-intro");
  assert.equal((await checkApp(context.primary, "example.app")).items.find(item => item.name === "entrypoint:concepts/app-intro")?.available, true);
}, true));

test("closing a View HTTP response aborts the running App operation", async () => fixture(async (root, context, app) => {
  const http = await import("node:http");
  const manifest = JSON.parse(await readFile(join(app, "app.json"), "utf8"));
  manifest.backend = { entry: "backend.mjs", operations: { wait: "read" } };
  await writeFile(join(app, "app.json"), JSON.stringify(manifest));
  await writeFile(join(app, "backend.mjs"), `export default {operations:{wait:{kind:'read',execute: async ctx => { globalThis.__issue137Started(); await new Promise(resolve => ctx.signal.addEventListener('abort',resolve,{once:true})); globalThis.__issue137Aborted(); }}}};`);
  await installApp(context, app);
  await setAppEnabled(context, "example.app", true);
  let started!: () => void, aborted!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const abort = new Promise<void>(resolve => { aborted = resolve; });
  Object.assign(globalThis, { __issue137Started: started, __issue137Aborted: aborted });
  const config = await readConfig(); config.view = { host: "127.0.0.1", port: 0 };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = http.request(`${origin}/api/projects/test/apps/example.app/operations/wait`, { method: "POST", headers: { "content-type": "application/json", origin } });
  request.on("error", () => undefined);
  try {
    request.end(JSON.stringify({ input: {} }));
    await Promise.race([start, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("operation did not start")), 5000))]);
    request.destroy();
    await Promise.race([abort, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("abort did not reach operation")), 5000))]);
  } finally {
    delete (globalThis as Record<string, unknown>).__issue137Started;
    delete (globalThis as Record<string, unknown>).__issue137Aborted;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}));

test("App installation binds a Project Store and shares records through the View API", async t => fixture(async (root, context, app) => {
  const { createBusinessStore } = await import("../src/project/business-stores.js");
  const { writeData } = await import("../src/project/data-service.js");
  await mutateModel({}, context.primary.paths.root, "create", "expense.json", { source: JSON.stringify({ type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false }) });
  await createBusinessStore({}, context.primary.paths.root, "expenses", { model: "expense.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/expenses" } });
  await writeData({}, context.primary.paths.root, "expenses", "first", "create", { kind: "value", value: { amount: 3 } });
  const manifest = JSON.parse(await readFile(join(app, "app.json"), "utf8"));
  manifest.projectStores = [{ key: "expenses", model: "expense.json", kind: "ValueStore", configKey: "store" }];
  manifest.backend = { entry: "backend.mjs", operations: { read: "read", write: "write", wait: "read" } };
  await writeFile(join(app, "app.json"), JSON.stringify(manifest));
  await writeFile(join(app, "backend.mjs"), `export default {operations:{
    read:{kind:'read',execute:async ctx=>{const binding=await ctx.getProjectStoreBinding('expenses');const store=await ctx.getStore('expenses',{expectedBinding:binding.token});return {token:binding.token,record:await store.get({},'first')};}},
    write:{kind:'write',execute:async(ctx,input)=>{const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.update({},'first',input.value);}},
    wait:{kind:'read',execute:async(ctx,input)=>{const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.update({},'first',{amount:99});globalThis.__issue137SharedStarted();await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));globalThis.__issue137SharedAborted();}}
  }};`);
  await installApp(context, app, { store: "expenses" });
  assert.equal((await checkApp(context.primary, "example.app")).status, "available");
  await setAppEnabled(context, "example.app", true);
  const config = await readConfig(); config.view = { host: "127.0.0.1", port: 0 };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invoke = async (operation: string, input: unknown) => {
    const response = await fetch(`${origin}/api/projects/test/apps/example.app/operations/${operation}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ input }) });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  try {
    const current = await invoke("read", {});
    assert.deepEqual(current.record.value, { amount: 3 });
    await invoke("write", { token: current.token, value: { amount: 8 } });
    const result = JSON.parse(execFileSync(process.execPath, [...cliArguments, "--project", "test", "data", "read", "first", "--store", "expenses", "--output", "json"], { cwd: root, encoding: "utf8" }));
    assert.deepEqual(result.value, { amount: 8 });
    const http = await import("node:http");
    const { FilesystemJsonValueStoreFactory } = await import("../src/data/extensions/filesystem-json-valuestore/index.js");
    let releaseWrite!: () => void, writeStarted!: () => void;
    const writeBarrier = new Promise<void>(resolve => { releaseWrite = resolve; });
    const writeEntered = new Promise<void>(resolve => { writeStarted = resolve; });
    const originalOpen = FilesystemJsonValueStoreFactory.prototype.openExisting;
    t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function (...args: Parameters<typeof originalOpen>) {
      const store = await originalOpen.apply(this, args);
      const update = store.update.bind(store);
      store.update = async (...writeArgs) => { writeStarted(); await writeBarrier; return update(...writeArgs); };
      return store;
    });
    let started!: () => void, aborted!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    const abort = new Promise<void>(resolve => { aborted = resolve; });
    Object.assign(globalThis, { __issue137SharedStarted: started, __issue137SharedAborted: aborted });
    const request = http.request(`${origin}/api/projects/test/apps/example.app/operations/wait`, { method: "POST", headers: { "content-type": "application/json", origin } });
    request.on("error", () => undefined);
    try {
      request.end(JSON.stringify({ input: { token: current.token } }));
      await Promise.race([start, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shared operation did not start")), 5000))]);
      await Promise.race([writeEntered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shared write did not start")), 5000))]);
      request.destroy();
      await Promise.race([abort, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shared operation was not cancelled")), 5000))]);
      const { configureApp } = await import("../src/app/install.js");
      const configured = configureApp(context, "example.app", { store: "expenses" });
      releaseWrite();
      await configured;
      const afterAbort = JSON.parse(execFileSync(process.execPath, [...cliArguments, "--project", "test", "data", "read", "first", "--store", "expenses", "--output", "json"], { cwd: root, encoding: "utf8" }));
      assert.deepEqual(afterAbort.value, { amount: 8 });
    } finally {
      releaseWrite();
      delete (globalThis as Record<string, unknown>).__issue137SharedStarted;
      delete (globalThis as Record<string, unknown>).__issue137SharedAborted;
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));
