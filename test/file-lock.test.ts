import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { withNativeFileLock } from "../src/file-lock.js";
import { filesystemWorker } from "./helpers/filesystem-process.js";

test("native lock timeout cannot steal a live process's permanent coordination file", { timeout: 15_000 }, async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-native-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const holder = await filesystemWorker(t, directory, { operation: "lock" });
  holder.send("start"); await holder.next("locked");
  const file = join(directory, "coordination.lock");
  const before = await fs.stat(file);
  const contender = await filesystemWorker(t, directory, { operation: "lock", timeoutMs: 40 });
  contender.send("start"); await contender.next("waiting");
  assert.equal((await contender.next("result")).code, "LOCK_TIMEOUT");
  assert.equal((await fs.stat(file)).ino, before.ino);
  holder.send("continue"); assert.equal((await holder.next("result")).ok, true);
  assert.equal(await withNativeFileLock(file, async () => "acquired"), "acquired");
  assert.equal((await fs.stat(file)).ino, before.ino);
});

test("SIGKILL releases native lock without deleting or recovering the coordination file", { timeout: 15_000 }, async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-killed-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const holder = await filesystemWorker(t, directory, { operation: "lock" });
  holder.send("start"); await holder.next("locked");
  const contender = await filesystemWorker(t, directory, { operation: "lock" });
  contender.send("start"); await contender.next("waiting");
  const file = join(directory, "coordination.lock");
  const before = await fs.stat(file);
  holder.child.kill("SIGKILL"); await holder.exit;
  await contender.next("locked");
  contender.send("continue"); assert.equal((await contender.next("result")).ok, true);
  assert.equal((await fs.stat(file)).ino, before.ino);
});

test("native lock cancellation and action failure release handles without running canceled work", async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-aborted-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = join(directory, "coordination.lock");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withNativeFileLock(file, async () => assert.fail("must not execute"), { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(await fs.readdir(directory), []);
  await assert.rejects(withNativeFileLock(file, async () => { throw new Error("failed action"); }), /failed action/);
  assert.equal(await withNativeFileLock(file, async () => 42), 42);
});

test("unsupported native locking fails closed before entering the write action", async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-unsupported-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const native = createRequire(import.meta.url)("fs-native-extensions");
  const mocked = t.mock.method(native, "tryLock", () => { throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" }); });
  await assert.rejects(withNativeFileLock(join(directory, "coordination.lock"), async () => assert.fail("must not write")), { code: "UNSUPPORTED_CAPABILITY" });
  mocked.mock.restore();
  assert.equal(await withNativeFileLock(join(directory, "coordination.lock"), async () => true), true);
});
