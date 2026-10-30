import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { createCommandState, findCommandStates, requireCommandState, updateCommandState, accountRead } from "../src/home/command-state-store.js";

test("session keys persist across commands and reads remain isolated when two sessions share a Run", async t => {
  const f = await businessFixture(t, {});
  const previous = { MEMSPHERE_HOME: process.env.MEMSPHERE_HOME, CODEX_THREAD_ID: process.env.CODEX_THREAD_ID, TRAECLI_THREAD_ID: process.env.TRAECLI_THREAD_ID };
  Object.assign(process.env, { MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "session-a", TRAECLI_THREAD_ID: "" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true } } }));
  const a = (await createCommandState("project-a", "run-a"))!;
  assert.equal(a.id, "codex-session-a");
  const old = await requireCommandState(a.id);
  await accountRead("project-a", "run-a", "artifact:A");
  await assert.rejects(updateCommandState(old, { ...old.value, state: { reads: {} } }), { code: "REVISION_CONFLICT" });
  process.env.CODEX_THREAD_ID = "session-b";
  const b = (await createCommandState("project-a", "run-a"))!;
  await accountRead("project-a", "run-a", "artifact:B");
  assert.deepEqual(Object.keys((await requireCommandState(a.id)).value.state.reads!), ["artifact:A"]);
  assert.deepEqual(Object.keys((await requireCommandState(b.id)).value.state.reads!), ["artifact:B"]);
  assert.equal((await findCommandStates("project-a", "run-a")).length, 2);
  const rebound = (await createCommandState("project-b", "run-b"))!;
  assert.equal(rebound.id, b.id);
  assert.deepEqual((await requireCommandState(b.id)).value.state.reads, {});
});

async function sessionProcesses(t: import("node:test").TestContext) {
  const f = await businessFixture(t, {});
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const source = pathToFileURL(resolve("src/home/command-state-store.ts")).href;
  const exec = promisify(execFile);
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true } } }));
  const run = async (session: string, project = "project-a", runId = "run-a", before = "") => {
    const script = `import {createCommandState,openCommandStates} from ${JSON.stringify(source)}; ${before}; console.log(JSON.stringify(await createCommandState(${JSON.stringify(project)},${JSON.stringify(runId)})));`;
    const result = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: session, TRAECLI_THREAD_ID: "" }, timeout: 8000
    });
    return JSON.parse(result.stdout);
  };
  return { ...f, run };
}

test("independent session processes do not acquire the former Home session lock", { timeout: 20000 }, async t => {
  const f = await sessionProcesses(t);
  const { mkdir, stat } = await import("node:fs/promises");
  const { withNativeFileLock } = await import("../src/file-lock.js");
  await mkdir(join(f.home, ".runtime"), { recursive: true });
  await withNativeFileLock(join(f.home, ".runtime", "runner-sessions.lock"), async () => {
    const [a, b] = await Promise.all([f.run("session-a"), f.run("session-b")]);
    assert.equal(a.id, "codex-session-a");
    assert.equal(b.id, "codex-session-b");
  });
  await assert.rejects(stat(join(f.home, ".runtime", "settings.lock")), { code: "ENOENT" });
});

test("same-session concurrent creation is idempotent through ValueStore and preserves reads", { timeout: 20000 }, async t => {
  const f = await sessionProcesses(t);
  const states = await Promise.all(Array.from({ length: 4 }, () => f.run("same-session")));
  assert.ok(states.every(s => s.id === "codex-same-session" && s.groupId === "run-a"));
  const { openCommandStates } = await import("../src/home/command-state-store.js");
  const store = (await openCommandStates(false, f.home))!;
  const row = (await store.get({}, "codex-same-session"))!;
  assert.equal(row.revision, 1, "concurrent duplicate creation must not rewrite the winning record");
  const value = row.value as import("../src/home/command-state-store.js").CommandState;
  await store.update({}, row.id, { ...value, state: { reads: { "artifact:A": { readAt: new Date().toISOString() } } } }, { expectedRevision: row.revision });
  await Promise.all([f.run("same-session"), f.run("same-session")]);
  const current = (await store.get({}, row.id))!;
  assert.equal(current.revision, 2);
  assert.deepEqual(Object.keys((current.value as typeof value).state.reads!), ["artifact:A"]);
  const { stat } = await import("node:fs/promises");
  await assert.rejects(stat(join(f.home, ".runtime", "runner-sessions.lock")), { code: "ENOENT" });
});


test("a concurrent different binding is reported as a conflict rather than overwritten", { timeout: 20000 }, async t => {
  const f = await sessionProcesses(t);
  await f.run("same-session");
  const before = `
    const store = await openCommandStates();
    const prototype = Object.getPrototypeOf(store);
    const update = prototype.update;
    let injected = false;
    prototype.update = async function(context,id,value,options) {
      if (!injected && id === "codex-same-session") {
        injected = true;
        const row = await this.get(context,id);
        await update.call(this,context,id,{...row.value,groupId:"winning-run",parameters:{project:"winning-project"}},{expectedRevision:row.revision});
      }
      return update.call(this,context,id,value,options);
    };
  `;
  await assert.rejects(f.run("same-session", "losing-project", "losing-run", before), (error: unknown) => {
    assert.match((error as Error).message, /Session binding changed concurrently/);
    return true;
  });
  const { openCommandStates } = await import("../src/home/command-state-store.js");
  const store = (await openCommandStates(false, f.home))!;
  const row = (await store.get({}, "codex-same-session"))!;
  assert.equal(row.revision, 2);
  assert.equal((row.value as { groupId: string }).groupId, "winning-run");
});
