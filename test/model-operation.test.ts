import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { readFile, writeFile, mkdir, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { businessFixture, snapshotTree } from "./helpers/business-data.js";
import { assertModelOperationStamp, commitModelOperation, optionalFileBytes, readModelOperationStamp, recoverModelOperation, withProjectModelWrite, withProjectSettingsLock } from "../src/project/model-operation.js";
import { createProjectModelHost } from "../src/project/models.js";

async function worker(t: TestContext, root: string, request: object) {
  const child = fork(new URL("./fixtures/model-operation-worker.ts", import.meta.url), [root, JSON.stringify(request)], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  type Message = { type: string; ok?: boolean; code?: string; message?: string };
  const messages: Message[] = [];
  const waiters = new Map<string, { resolve: (message: Message) => void; reject: (cause: Error) => void }>();
  let exited = false, stderr = "";
  child.stderr!.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  child.on("message", (message: Message) => {
    const waiter = waiters.get(message.type);
    if (waiter) { waiters.delete(message.type); waiter.resolve(message); } else messages.push(message);
  });
  const exit = new Promise<void>(resolve => child.once("exit", () => {
    exited = true;
    for (const waiter of waiters.values()) waiter.reject(new Error(`Worker exited before IPC barrier: ${stderr}`));
    waiters.clear(); resolve();
  }));
  t.after(async () => { if (!exited) child.kill("SIGKILL"); await exit; });
  const next = (type: string): Promise<Message> => {
    const index = messages.findIndex(message => message.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    if (exited) return Promise.reject(new Error(`Worker exited: ${stderr}`));
    return new Promise((resolve, reject) => { waiters.set(type, { resolve, reject }); });
  };
  await next("ready");
  return { child, next, exit, start: () => child.send("start") };
}
async function setup(t: TestContext) {
  const f = await businessFixture(t);
  const definition = join(f.root, "models/json-schema/draft-07/existing.json");
  await writeFile(definition, "before\n");
  return { ...f, definition, config: await readFile(join(f.root, "config.json")) };
}

for (const pause of ["pending", "file-0", "file-1", "file-2"]) {
  test(`Killed model writer at ${pause}: pure reads fail, a different request restores before preflight`, { timeout: 30_000 }, async t => {
    const f = await setup(t);
    const writing = await worker(t, f.root, { mode: "write", pause });
    writing.start(); await writing.next("paused"); writing.child.kill("SIGKILL"); await writing.exit;
    const pending = await snapshotTree(f.root);
    await assert.rejects(readModelOperationStamp(f.root), { code: "MODEL_OPERATION_PENDING" });
    await assert.rejects(createProjectModelHost({}, { root: f.root }), { code: "MODEL_OPERATION_PENDING" });
    assert.deepEqual(await snapshotTree(f.root), pending, "Reads must not create locks, repair files or advance the journal");
    const next = await worker(t, f.root, { mode: "new-write" });
    next.start(); const result = await next.next("result"); await next.exit;
    assert.equal(result.ok, true, result.message);
    assert.equal(await readFile(f.definition, "utf8"), "before\n");
    assert.deepEqual(await readFile(join(f.root, "config.json")), f.config);
    assert.equal(await optionalFileBytes(join(f.root, "models/registrations/project/created.json")), undefined);
    assert.equal(await readFile(join(f.root, "models/json-schema/draft-07/new-request.json"), "utf8"), "new request\n");
    assert.match(await readModelOperationStamp(f.root), /:committed$/);
  });
}

for (const pause of ["pending", "file-0"]) {
  test(`Recovery itself killed at ${pause}: a fresh process completes it without replay`, { timeout: 30_000 }, async t => {
    const f = await setup(t);
    const writing = await worker(t, f.root, { mode: "write", pause: "file-2" });
    writing.start(); await writing.next("paused"); writing.child.kill("SIGKILL"); await writing.exit;
    const recovering = await worker(t, f.root, { mode: "recover", pause });
    recovering.start(); await recovering.next("paused"); recovering.child.kill("SIGKILL"); await recovering.exit;
    await assert.rejects(readModelOperationStamp(f.root), { code: "MODEL_OPERATION_PENDING" });
    const retry = await worker(t, f.root, { mode: "recover" });
    retry.start(); const result = await retry.next("result"); await retry.exit;
    assert.equal(result.ok, true, result.message);
    assert.equal(await readFile(f.definition, "utf8"), "before\n");
    assert.deepEqual(await readFile(join(f.root, "config.json")), f.config);
    assert.equal(await optionalFileBytes(join(f.root, "models/registrations/project/created.json")), undefined);
    assert.match(await readModelOperationStamp(f.root), /:recovered$/);
    const settled = await snapshotTree(f.root);
    await recoverModelOperation(f.root);
    assert.deepEqual(await snapshotTree(f.root), settled);
  });
}

test("Failure rolls back all published files and retains a changed stamp to reject cached reads", async t => {
  const f = await setup(t);
  const stamp = await readModelOperationStamp(f.root);
  const created = join(f.root, "models/json-schema/draft-07/new/deep.json");
  await assert.rejects(withProjectModelWrite(f.root, () => commitModelOperation(f.root, "failure", [
    { path: f.definition, before: Buffer.from("before\n"), after: Buffer.from("after\n") },
    { path: created, before: undefined, after: Buffer.from("created\n") }
  ], { afterFile: async index => { if (index === 1) throw new Error("injected failure"); } })), /injected failure/);
  assert.equal(await readFile(f.definition, "utf8"), "before\n");
  assert.equal(await optionalFileBytes(created), undefined);
  await assert.rejects(readFile(join(f.root, "models/json-schema/draft-07/new")), { code: "ENOENT" });
  await assert.rejects(assertModelOperationStamp(f.root, stamp), { code: "MODEL_READ_CONFLICT" });
});

test("Recovery preserves external newer content and keeps the Project unavailable until conflict is addressed", { timeout: 30_000 }, async t => {
  const f = await setup(t);
  const writing = await worker(t, f.root, { mode: "write", pause: "file-0" });
  writing.start(); await writing.next("paused"); writing.child.kill("SIGKILL"); await writing.exit;
  await writeFile(f.definition, "external newer content\n");
  await assert.rejects(withProjectSettingsLock(f.root, () => recoverModelOperation(f.root)), { code: "MODEL_OPERATION_CONFLICT" });
  assert.equal(await readFile(f.definition, "utf8"), "external newer content\n");
  await assert.rejects(readModelOperationStamp(f.root), { code: "MODEL_OPERATION_PENDING" });
  await writeFile(f.definition, "before\n");
  await withProjectModelWrite(f.root, async () => {});
  assert.match(await readModelOperationStamp(f.root), /:recovered$/);
});

test("Conflicts and targets outside model roots fail before any journal or target write", async t => {
  const f = await setup(t);
  const snapshot = await snapshotTree(f.root);
  await assert.rejects(commitModelOperation(f.root, "wrong-before", [{ path: f.definition, before: Buffer.from("wrong"), after: Buffer.from("bad") }]), { code: "MODEL_OPERATION_CONFLICT" });
  await assert.rejects(commitModelOperation(f.root, "out-of-scope", [{ path: join(f.root, "memory/forbidden.json"), before: undefined, after: Buffer.from("bad") }]), { code: "MODEL_OPERATION_DAMAGED" });
  assert.deepEqual(await snapshotTree(f.root), snapshot);
});

test("A symlink cannot redirect a journal write or recovery into another directory", { skip: process.platform === "win32" }, async t => {
  const f = await setup(t);
  const outside = join(f.directory, "outside"); await mkdir(outside);
  await symlink(outside, join(f.root, "models/json-schema/draft-07/alias"));
  await assert.rejects(commitModelOperation(f.root, "symlink", [{ path: join(f.root, "models/json-schema/draft-07/alias/escape.json"), before: undefined, after: Buffer.from("bad") }]), { code: "MODEL_OPERATION_CONFLICT" });
  assert.equal(await optionalFileBytes(join(outside, "escape.json")), undefined);
});

test("Completed staging state stays readable after Project publication without acting on old paths", async t => {
  const f = await setup(t);
  await withProjectModelWrite(f.root, () => commitModelOperation(f.root, "create-project", [{ path: f.definition, before: Buffer.from("before\n"), after: Buffer.from("published\n") }]));
  const published = join(f.directory, "published"); await rename(f.root, published);
  assert.match(await readModelOperationStamp(published), /:committed$/);
  await recoverModelOperation(published);
  assert.equal(await readFile(join(published, "models/json-schema/draft-07/existing.json"), "utf8"), "published\n");
});
