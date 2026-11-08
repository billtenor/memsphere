import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createViewServer } from "../../../src/commands/view.js";
import { projectCreateCommand } from "../../../src/commands/project.js";
import { resolveProjectContext } from "../../../src/project/resolver.js";
import { readConfig } from "../../../src/config.js";


import { installApp, setAppEnabled } from "../../../src/app/install.js";


import { bindCli } from "../../../src/tools/registry.js";

import { mutateModel } from "../../../src/project/model-service.js";
import { createProjectModelHost } from "../../../src/project/models.js";

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