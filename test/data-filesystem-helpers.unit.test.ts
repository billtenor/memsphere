import assert from "node:assert/strict";
import test from "node:test";
import { paginate, portableNameKey, validateFilename, validateRelativeFilePath } from "../src/data/extensions/shared/filesystem.js";
import { consumeContent } from "../src/data/extensions/shared/payload.js";


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
