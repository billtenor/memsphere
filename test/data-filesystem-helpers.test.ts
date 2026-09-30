import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { Config } from "../src/data/api/config.js";
import {
  appendFileContent,
  atomicPublish,
  cleanupCreatedDirectories,
  deleteFile,
  findFile,
  INTERNAL_PREFIX,
  isCode,
  listFilenames,
  listRelativeFilenames,
  paginate,
  portableNameKey,
  prepareDirectory,
  readFileSnapshot,
  resolveFileParent,
  validateFilename,
  validateRelativeFilePath,
  withRecordLock
} from "../src/data/extensions/shared/filesystem.js";
import { bytesContent, consumeContent } from "../src/data/extensions/shared/payload.js";

const bytes = (value: string) => new TextEncoder().encode(value);

async function temporary(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere file helpers "));
  try { await action(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("stream cancellation interrupts a stalled read even when source cancellation never settles", async () => {
  const ready = deferred();
  const abort = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() { ready.resolve(); },
    cancel(reason) {
      assert.equal(reason, abort.signal.reason);
      cancelled = true;
      return new Promise<void>(() => undefined);
    }
  }, { highWaterMark: 0 });
  const pending = consumeContent({ signal: abort.signal }, { stream: () => stream }, async () => {
    assert.fail("a stalled source must not produce bytes");
  });
  const rejected = assert.rejects(pending, /stop stalled source/);
  await ready.promise;
  abort.abort(new Error("stop stalled source"));
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("stream consumption does not retain earlier chunks while waiting for EOF", async () => {
  // Inspect an active operation in a separate GC-enabled process. A permanently
  // pending abort Promise raced against every read retains all previous chunks.
  const helper = new URL("../src/data/extensions/shared/payload.ts", import.meta.url).href;
  const script = `
    import { consumeContent } from ${JSON.stringify(helper)};
    const retained = [];
    for (const signal of [undefined, new AbortController().signal]) {
      global.gc();
      const baseline = process.memoryUsage().arrayBuffers;
      let ready;
      const waiting = new Promise(resolve => { ready = resolve; });
      let controller;
      let count = 0;
      const source = new ReadableStream({
        start(value) { controller = value; },
        pull(value) {
          if (count++ < 1024) value.enqueue(new Uint8Array(64 * 1024));
          else ready();
        }
      }, { highWaterMark: 0 });
      const pending = consumeContent({ signal }, { stream: () => source }, async () => {});
      await waiting;
      await new Promise(setImmediate);
      global.gc();
      global.gc();
      retained.push(process.memoryUsage().arrayBuffers - baseline);
      controller.close();
      await pending;
    }
    process.stdout.write(JSON.stringify(retained));
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath, ["--expose-gc", "--import", "tsx", "--input-type=module", "-e", script], { env });
  assert.notEqual(stdout.trim(), "", "GC probe returned no output; child-process execution must be permitted");
  const retained = JSON.parse(stdout) as number[];
  assert.equal(retained.length, 2);
  for (const [index, bytesRetained] of retained.entries()) {
    assert.ok(bytesRetained < 8 * 1024 * 1024, `retained ${bytesRetained} bytes (signal: ${index === 1}) after consuming 64 MiB`);
  }
});

test("portable filenames reject Windows/Linux/macOS hazards on every host", () => {
  const invalid = [
    "", ".", "..", "../outside", "/absolute", "sub/file", "sub\\file", "a\u0000b", "a\nb", "a\u007fb", "a\u0085b",
    "a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b", "ending.", "ending ",
    "NUL", "nul.json", "CON.txt", "PRN.any", "AUX", "LPT1.txt", "com9", "COM¹.json", "LPT².txt", "COM³", "CON .txt", "CONIN$", "CONOUT$.txt",
    ".memsphere-temp", ".MEMSPHERE-X", "cafe\u0301.json", "bad\ud800", "bad\udc00", "x".repeat(256), "中".repeat(86)
  ];
  for (const name of invalid) assert.throws(() => validateFilename(name), JSON.stringify(name));
  for (const name of ["hello.json", "Résumé 文档 💾.md", "nulled.txt", "LPT10", "COM0", ".visible", "x".repeat(255)]) {
    assert.doesNotThrow(() => validateFilename(name));
  }
  assert.equal(portableNameKey("cafe\u0301.json"), portableNameKey("CAFÉ.JSON"));
});

test("relative file IDs use canonical '/' segments with no absolute paths or traversal", () => {
  for (const path of ["order.json", "a/b/c/order.json", "订单/2026 年/💾.json", ".visible/file.txt"]) {
    assert.doesNotThrow(() => validateRelativeFilePath(path));
  }
  for (const path of [
    "", "/root.txt", "a/", "a//b.json", "./a.json", "a/../b.json", "a/./b.json", "../b.json",
    "a\\b.json", "C:/data/a.json", "C:a.json", "//server/share/a.json", "\\\\server\\share\\a.json",
    "a/CON/file.json", "a/.memsphere-temp/file.json", "a/b /file.json", "a/b./file.json", "cafe\u0301/file.json"
  ]) assert.throws(() => validateRelativeFilePath(path), path);
});

test("relative parent resolution creates nested directories only when requested and after validation", async () => {
  await temporary(async (directory) => {
    assert.equal(await resolveFileParent({}, directory, "a/b/c/order.json"), undefined);
    assert.deepEqual(await fs.readdir(directory), []);
    for (const path of ["created/../escape.json", "created/nested/CON.json", "created/nested//file.json"]) {
      await assert.rejects(resolveFileParent({}, directory, path, true));
      assert.deepEqual(await fs.readdir(directory), []);
    }
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(resolveFileParent({ signal: controller.signal }, directory, "cancelled/child/file.json", true), /stop/);
    assert.deepEqual(await fs.readdir(directory), []);
    const parent = (await resolveFileParent({}, directory, "a/b/c/order.json", true))!;
    assert.deepEqual(parent, { directory: join(directory, "a", "b", "c"), filename: "order.json" });
    assert.deepEqual(await resolveFileParent({}, directory, "a/b/c/order.json"), parent);
    await atomicPublish({}, parent.directory, parent.filename, bytes('{"order":1}'), "create");
    assert.equal(await fs.readFile(join(directory, "a", "b", "c", "order.json"), "utf8"), '{"order":1}');
    assert.deepEqual(await listRelativeFilenames({}, directory), ["a/b/c/order.json"]);
    await assert.rejects(resolveFileParent({}, directory, "a/b/c/order.json/child.txt", true), /parent must be a directory/);
  });
});

test("concurrent relative parent creation rechecks mkdir EEXIST without requiring a lock", async () => {
  await temporary(async (directory) => {
    const [first, second] = await Promise.all([
      resolveFileParent({}, directory, "a/b/first.json", true),
      resolveFileParent({}, directory, "a/b/second.json", true)
    ]);
    assert.equal(first?.directory, join(directory, "a", "b"));
    assert.equal(second?.directory, first?.directory);
    assert.equal(first?.filename, "first.json");
    assert.equal(second?.filename, "second.json");
    assert.deepEqual(await fs.readdir(join(directory, "a", "b")), []);
  });
});

test("nested parent lookup rejects case aliases while preserving physical Unicode normalization", async () => {
  await temporary(async (directory) => {
    await fs.mkdir(join(directory, "Orders"));
    await fs.mkdir(join(directory, "cafe\u0301"));
    await assert.rejects(resolveFileParent({}, directory, "orders/file.json"), /case alias/);
    await assert.rejects(resolveFileParent({}, directory, "ORDERS/child/file.json", true), /case alias/);
    assert.deepEqual(await fs.readdir(join(directory, "Orders")), []);
    const parent = (await resolveFileParent({}, directory, "café/订单/file.json", true))!;
    await atomicPublish({}, parent.directory, parent.filename, bytes("body"), "create");
    assert.equal(await fs.readFile(join(directory, "cafe\u0301", "订单", "file.json"), "utf8"), "body");
    assert.deepEqual(await listRelativeFilenames({}, directory), ["café/订单/file.json"]);
  });
});

test("recursive listing walks names only and excludes internal entries at every depth", async (t) => {
  await temporary(async (directory) => {
    await fs.mkdir(join(directory, "a", "b"), { recursive: true });
    await fs.mkdir(join(directory, `${INTERNAL_PREFIX}hidden`));
    await fs.writeFile(join(directory, "root.txt"), "root");
    await fs.writeFile(join(directory, "a", "one.json"), "{}");
    await fs.writeFile(join(directory, "a", "b", "two.md"), "# Text");
    await fs.writeFile(join(directory, "a", "b", `${INTERNAL_PREFIX}staged.tmp`), "unfinished");
    await fs.writeFile(join(directory, `${INTERNAL_PREFIX}hidden`, "not-a-record.txt"), "hidden");
    const read = t.mock.method(fs, "readFile", async () => { throw new Error("payload must not be read"); });
    const open = t.mock.method(fs, "open", async () => { throw new Error("payload must not be opened"); });
    try {
      assert.deepEqual((await listRelativeFilenames({}, directory)).sort(), ["a/b/two.md", "a/one.json", "root.txt"]);
    } finally {
      read.mock.restore();
      open.mock.restore();
    }
  });
});

test("nested directory aliases are detected on case-sensitive filesystems", async (t) => {
  await temporary(async (directory) => {
    await fs.mkdir(join(directory, "a"));
    await fs.mkdir(join(directory, "a", "Orders"));
    try { await fs.mkdir(join(directory, "a", "orders")); }
    catch (error) {
      if (isCode(error, "EEXIST")) { t.skip("filesystem is case insensitive"); return; }
      throw error;
    }
    await assert.rejects(listRelativeFilenames({}, directory), /Ambiguous filenames/);
    await assert.rejects(resolveFileParent({}, directory, "a/Orders/file.json"), /Ambiguous filenames/);
  });
});

test("relative resolution rejects directory symlinks and recursive listing never traverses them", async (t) => {
  await temporary(async (directory) => {
    await temporary(async (outside) => {
      await fs.writeFile(join(outside, "outside.txt"), "external");
      await fs.writeFile(join(directory, "inside.txt"), "internal");
      try { await fs.symlink(outside, join(directory, "linked"), process.platform === "win32" ? "junction" : "dir"); }
      catch (error) {
        if (process.platform === "win32" && (isCode(error, "EPERM") || isCode(error, "EACCES"))) {
          t.skip("creating directory links requires Windows privileges");
          return;
        }
        throw error;
      }
      await assert.rejects(resolveFileParent({}, directory, "linked/outside.txt"), /parent must be a directory/);
      await assert.rejects(resolveFileParent({}, directory, "linked/new/record.json", true), /parent must be a directory/);
      assert.deepEqual(await listRelativeFilenames({}, directory), ["inside.txt"]);
      assert.deepEqual(await fs.readdir(outside), ["outside.txt"]);
    });
  });
});

test("prepareDirectory uses a canonical directory, accepts spaces and honors cancellation", async () => {
  await temporary(async (directory) => {
    const nested = join(directory, "new directory", "订单");
    assert.equal(await prepareDirectory({}, new Config({ directory: nested })), await fs.realpath(nested));
    await assert.rejects(prepareDirectory({}, new Config({})), /directory.*non-empty/);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const notCreated = join(directory, "cancelled");
    await assert.rejects(prepareDirectory({ signal: controller.signal }, new Config({ directory: notCreated })), /cancelled/);
    await assert.rejects(fs.stat(notCreated), (error: unknown) => isCode(error, "ENOENT"));
  });
});

test("raw files atomically create and replace, retain snapshot metadata, and leave no sidecars", async () => {
  await temporary(async (directory) => {
    const created = await atomicPublish({}, directory, "订单.json", bytes('{"quantity":1}\n'), "create");
    assert.equal(created.size, bytes('{"quantity":1}\n').length);
    assert.equal(await fs.readFile(join(directory, "订单.json"), "utf8"), '{"quantity":1}\n');
    const snapshot = (await readFileSnapshot({}, directory, "订单.json"))!;
    await assert.rejects(atomicPublish({}, directory, "订单.json", bytes("wrong"), "create"), (error: unknown) => isCode(error, "EEXIST"));
    await assert.rejects(atomicPublish({}, directory, "missing.json", bytes("wrong"), "replace"), (error: unknown) => isCode(error, "ENOENT"));
    const replaced = await atomicPublish({}, directory, "订单.json", bytes('{"quantity":22}\n'), "replace");
    assert.equal(replaced.size, bytes('{"quantity":22}\n').length);
    assert.equal(new TextDecoder().decode(snapshot.bytes), '{"quantity":1}\n');
    assert.equal(snapshot.stat.size, bytes('{"quantity":1}\n').length);
    assert.equal(await fs.readFile(join(directory, "订单.json"), "utf8"), '{"quantity":22}\n');
    assert.deepEqual(await fs.readdir(directory), ["订单.json"]);
    assert.equal(await deleteFile({}, directory, "订单.json"), true);
    assert.equal(await deleteFile({}, directory, "订单.json"), false);
    assert.equal(await readFileSnapshot({}, directory, "订单.json"), undefined);
  });
});

test("exclusive create publishes exactly one complete contender", async () => {
  await temporary(async (directory) => {
    const first = "a".repeat(16_000);
    const second = "b".repeat(16_000);
    const results = await Promise.allSettled([
      atomicPublish({}, directory, "one.txt", bytes(first), "create"),
      atomicPublish({}, directory, "one.txt", bytes(second), "create")
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(isCode(failure.reason, "EEXIST"), true);
    assert.ok([first, second].includes(await fs.readFile(join(directory, "one.txt"), "utf8")));
    assert.deepEqual(await fs.readdir(directory), ["one.txt"]);
  });
});

test("finding and listing reject case aliases, normalize decomposed filenames, and ignore internal files", async () => {
  await temporary(async (directory) => {
    await fs.writeFile(join(directory, "Report.txt"), "hello");
    await fs.writeFile(join(directory, "cafe\u0301.txt"), "world");
    await fs.writeFile(join(directory, `${INTERNAL_PREFIX}staged.tmp`), "unfinished");
    await fs.mkdir(join(directory, "subdirectory"));
    assert.deepEqual((await listFilenames({}, directory)).sort(), ["Report.txt", "café.txt"]);
    await assert.rejects(findFile({}, directory, "report.txt"), /case alias/);
    await assert.rejects(atomicPublish({}, directory, "REPORT.txt", bytes("overwrite"), "create"), /case alias/);
    assert.equal(new TextDecoder().decode((await readFileSnapshot({}, directory, "café.txt"))!.bytes), "world");
    await atomicPublish({}, directory, "café.txt", bytes("updated"), "replace");
    assert.equal(await fs.readFile(join(directory, "cafe\u0301.txt"), "utf8"), "updated");
    await assert.rejects(findFile({}, directory, "subdirectory"), /regular file/);
  });
});

test("case-sensitive disks report existing case and normalization collisions", async (t) => {
  await temporary(async (directory) => {
    await fs.writeFile(join(directory, "A.txt"), "first");
    await fs.writeFile(join(directory, "a.txt"), "second");
    if ((await fs.readdir(directory)).length < 2) { t.skip("filesystem is case insensitive"); return; }
    await assert.rejects(listFilenames({}, directory), /Ambiguous filenames/);
    await assert.rejects(findFile({}, directory, "A.txt"), /Ambiguous filenames/);
  });
  await temporary(async (directory) => {
    await fs.writeFile(join(directory, "café.txt"), "first");
    await fs.writeFile(join(directory, "cafe\u0301.txt"), "second");
    if ((await fs.readdir(directory)).length < 2) return;
    await assert.rejects(listFilenames({}, directory), /Ambiguous filenames/);
  });
});

test("record symlinks are not followed or overwritten", async (t) => {
  await temporary(async (directory) => {
    const target = join(directory, "actual.txt");
    const alias = join(directory, "alias.txt");
    await fs.writeFile(target, "original");
    try { await fs.symlink(target, alias, "file"); }
    catch (error) {
      if (process.platform === "win32" && (isCode(error, "EPERM") || isCode(error, "EACCES"))) {
        t.skip("creating symlinks requires Windows privileges");
        return;
      }
      throw error;
    }
    assert.deepEqual(await listFilenames({}, directory), ["actual.txt"]);
    await assert.rejects(readFileSnapshot({}, directory, "alias.txt"), /regular file/);
    await assert.rejects(atomicPublish({}, directory, "alias.txt", bytes("wrong"), "replace"), /regular file/);
    await assert.rejects(appendFileContent({}, directory, "alias.txt", bytesContent(bytes("wrong"))), /regular file/);
    await assert.rejects(deleteFile({}, directory, "alias.txt"), /regular file/);
    assert.equal(await fs.readFile(target, "utf8"), "original");
  });
});

test("failed stream cleanup removes only newly created empty directories", async () => {
  await temporary(async (directory) => {
    await fs.mkdir(join(directory, "existing"));
    const created: string[] = [];
    await resolveFileParent({}, directory, "existing/a/b/item.bin", true, created);
    assert.deepEqual(created, [join(directory, "existing", "a"), join(directory, "existing", "a", "b")]);
    await fs.writeFile(join(directory, "existing", "a", "keep.txt"), "another writer's data");
    await cleanupCreatedDirectories(created);
    assert.deepEqual(await fs.readdir(join(directory, "existing", "a")), ["keep.txt"]);
    assert.equal(await fs.readFile(join(directory, "existing", "a", "keep.txt"), "utf8"), "another writer's data");
  });
});

test("streamed file writes retry short writes without rereading their source", async (t) => {
  await temporary(async (directory) => {
    const originalOpen = fs.open;
    let writes = 0;
    const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      const originalWrite = handle.write.bind(handle);
      t.mock.method(handle, "write", async (chunk: Uint8Array, offset: number, length: number, position: number | null) => {
        writes += 1;
        return originalWrite(chunk, offset, Math.min(length, 2), position);
      });
      return handle;
    });
    try {
      let opened = 0;
      await atomicPublish({}, directory, "item.txt", {
        stream() {
          opened += 1;
          assert.equal(opened, 1);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes("12345"));
              controller.enqueue(new Uint8Array());
              controller.enqueue(bytes("678"));
              controller.close();
            }
          });
        }
      }, "create");
      assert.equal(writes, 5);
      assert.equal(await fs.readFile(join(directory, "item.txt"), "utf8"), "12345678");
      await appendFileContent({}, directory, "item.txt", bytesContent(bytes("90abc")));
      assert.equal(writes, 8);
      assert.equal(await fs.readFile(join(directory, "item.txt"), "utf8"), "1234567890abc");
    } finally {
      open.mock.restore();
    }
  });
});

test("a failed destination cancels its one-shot source and does not publish partial data", async (t) => {
  await temporary(async (directory) => {
    await atomicPublish({}, directory, "item.txt", bytes("original"), "create");
    const originalOpen = fs.open;
    const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      t.mock.method(handle, "write", async () => { throw new Error("disk full"); });
      return handle;
    });
    let cancelled = false;
    try {
      await assert.rejects(atomicPublish({}, directory, "item.txt", {
        stream() {
          return new ReadableStream<Uint8Array>({
            pull(controller) { controller.enqueue(bytes("replacement")); },
            cancel(reason) { assert.match(String(reason), /disk full/); cancelled = true; }
          }, { highWaterMark: 0 });
        }
      }, "replace"), /disk full/);
      assert.equal(cancelled, true);
      assert.equal(await fs.readFile(join(directory, "item.txt"), "utf8"), "original");
      assert.deepEqual(await fs.readdir(directory), ["item.txt"]);
    } finally {
      open.mock.restore();
    }
  });
});

test("failed publication and cancellation remove temporary files without altering data", async (t) => {
  await temporary(async (directory) => {
    const originalLink = fs.link;
    const link = t.mock.method(fs, "link", async () => { throw Object.assign(new Error("hard links unavailable"), { code: "ENOTSUP" }); });
    await assert.rejects(atomicPublish({}, directory, "one.txt", bytes("body"), "create"), /hard links unavailable/);
    assert.deepEqual(await fs.readdir(directory), []);
    link.mock.restore();
    assert.equal(fs.link, originalLink);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(atomicPublish({ signal: controller.signal }, directory, "one.txt", bytes("body"), "create"), /stop/);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("Windows replacement retries transient sharing errors without unlinking the old file", async (t) => {
  await temporary(async (directory) => {
    await atomicPublish({}, directory, "one.txt", bytes("old"), "create");
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const originalRename = fs.rename;
    let calls = 0;
    const rename = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(await fs.readFile(join(directory, "one.txt"), "utf8"), "old");
        throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      }
      return originalRename(...args);
    });
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      await atomicPublish({}, directory, "one.txt", bytes("new"), "replace");
      assert.equal(calls, 2);
    } finally {
      Object.defineProperty(process, "platform", platform);
      rename.mock.restore();
    }
    assert.equal(await fs.readFile(join(directory, "one.txt"), "utf8"), "new");
    assert.deepEqual(await fs.readdir(directory), ["one.txt"]);
  });
});

test("pagination is lexical, scoped, bounded and rejects malformed cursors", () => {
  const first = paginate(["z", "a", "b", "中文"], { limit: 2 }, "store-1");
  assert.deepEqual(first.items, [{ id: "a" }, { id: "b" }]);
  assert.ok(first.nextCursor);
  assert.deepEqual(paginate(["z", "a", "b", "中文"], { cursor: first.nextCursor, limit: 2 }, "store-1"), { items: [{ id: "z" }, { id: "中文" }] });
  assert.deepEqual(paginate([], { cursor: first.nextCursor }, "store-1"), { items: [] });
  assert.throws(() => paginate([], { cursor: first.nextCursor }, "store-2"), /cursor/);
  assert.throws(() => paginate([], { cursor: `${first.nextCursor}!` }, "store-1"), /cursor/);
  for (const limit of [0, -1, 0.1, 1001, Infinity]) assert.throws(() => paginate([], { limit }, "store-1"), /limit/);
  assert.throws(() => paginate([], { limit: null as unknown as number }, "store-1"), /limit/);
});

test("record mutex serializes the same canonical file while unrelated files proceed", async () => {
  await temporary(async (directory) => {
    const started = deferred();
    const release = deferred();
    const events: string[] = [];
    const first = withRecordLock({}, directory, "one.json", async () => {
      events.push("first");
      started.resolve();
      await release.promise;
      events.push("first done");
    });
    await started.promise;
    const second = withRecordLock({}, join(directory, "."), "ONE.json", async () => { events.push("second"); });
    await withRecordLock({}, directory, "two.json", async () => { events.push("other"); });
    assert.deepEqual(events, ["first", "other"]);
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first", "other", "first done", "second"]);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("cancelled mutex waiter cannot let a later writer bypass its active predecessor", async () => {
  await temporary(async (directory) => {
    const started = deferred();
    const release = deferred();
    const events: string[] = [];
    const first = withRecordLock({}, directory, "one.json", async () => {
      started.resolve();
      await release.promise;
      events.push("first done");
    });
    await started.promise;
    const controller = new AbortController();
    const cancelled = withRecordLock({ signal: controller.signal }, directory, "one.json", async () => { events.push("cancelled ran"); });
    // Let the waiter enter the queue before aborting it.
    await sleep(20);
    controller.abort(new Error("cancel waiter"));
    await assert.rejects(cancelled, /cancel waiter/);
    const next = withRecordLock({}, directory, "one.json", async () => { events.push("next"); });
    await sleep(20);
    assert.deepEqual(events, []);
    release.resolve();
    await Promise.all([first, next]);
    assert.deepEqual(events, ["first done", "next"]);
    await assert.rejects(withRecordLock({}, directory, "one.json", async () => { throw new Error("failed action"); }), /failed action/);
    assert.equal(await withRecordLock({}, directory, "one.json", async () => 42), 42);
  });
});
