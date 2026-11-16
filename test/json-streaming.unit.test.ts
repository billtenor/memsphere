import assert from "node:assert/strict";
import test from "node:test";
import { snapshotJsonValue, encodeJsonChunks, parseJsonChunks } from "../src/data/extensions/json-serializer/streaming.js";

async function bytes(value: unknown) {
  const chunks = []; for await (const chunk of encodeJsonChunks({}, snapshotJsonValue(value))) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const parts = async function* (bytes: Uint8Array) { for (const byte of bytes) yield Uint8Array.of(byte); };

test("chunked JSON preserves escaping, surrogate pairs, dangerous keys and native scalar roots", async () => {
  const values = [null, false, 12, "x".repeat(4095) + "😀\n\u0000\ud800", [1, "汉😀"], JSON.parse('{"__proto__":{"safe":true},"constructor":2}')];
  for (const value of values) {
    const encoded = await bytes(value);
    assert.equal(encoded.toString(), JSON.stringify(value, null, 2) + "\n");
    const parsed = await parseJsonChunks({}, parts(encoded));
    assert.deepEqual(parsed, value); assert.equal(({} as Record<string, unknown>).safe, undefined);
  }
});
test("JSON snapshot rejects hooks and unsupported values before invoking them; mutable aliases detach", () => {
  let invoked = false;
  for (const value of [BigInt(1), -0, NaN, Infinity, undefined, [,], { get x() { invoked = true; return 1; } }, { toJSON() { invoked = true; return 1; } }, new Date(0)]) assert.throws(() => snapshotJsonValue(value));
  assert.equal(invoked, false);
  const shared = { n: 1 }, input = { a: shared, b: shared }, copy = snapshotJsonValue(input);
  shared.n = 2; assert.deepEqual(copy, { a: { n: 1 }, b: { n: 1 } });
});
test("streaming parser rejects malformed/truncated/multiple-root JSON and invalid UTF8", async () => {
  for (const raw of [Buffer.from('{"x":'), Buffer.from('{}{}'), Buffer.from('01'), Buffer.from('true garbage'), Buffer.from([0xff])]) {
    await assert.rejects(parseJsonChunks({}, parts(raw)), { code: "INVALID_JSON" });
  }
});
test("cancellation at a chunk boundary stops both parser and encoder", async () => {
  const controller = new AbortController(), output = encodeJsonChunks({ signal: controller.signal }, { n: "x".repeat(65536) });
  await output.next(); controller.abort(); await assert.rejects(output.next(), { name: "AbortError" });
  await assert.rejects(parseJsonChunks({ signal: controller.signal }, parts(Buffer.from('{}'))), { name: "AbortError" });
});

test("parser cancellation after the first fragment closes its iterator before further consumption", { timeout: 5000 }, async t => {
  let entered!: () => void, release!: () => void, closed = false, consumed = 0;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  const controller = new AbortController();
  t.after(() => { controller.abort(); release(); });
  const source = (async function* () {
    try {
      consumed++; yield Buffer.from('{"name":');
      entered(); await gate;
      consumed++; yield Buffer.from('"small"}');
      consumed++; yield Buffer.from(' ');
    } finally { closed = true; }
  })();
  const parsing = parseJsonChunks({ signal: controller.signal }, source);
  const rejected = assert.rejects(parsing, { name: "AbortError" });
  try { await ready; controller.abort(); }
  finally { release(); }
  await rejected;
  assert.equal(consumed, 2); assert.equal(closed, true);
});

test("parser checks cancellation after complete EOF and final synchronous validation", async () => {
  const controller = new AbortController(); let eof = false, cancelled = false;
  const source = (async function* () {
    yield Buffer.from('{"name":"small"}');
    eof = true;
    // EOF resumes parsing in microtasks. This immediate runs before the final
    // checkpoint's immediate, after the synchronous final decode/validation.
    setImmediate(() => { cancelled = true; controller.abort(); });
  })();
  await assert.rejects(parseJsonChunks({ signal: controller.signal }, source), { name: "AbortError" });
  assert.equal(eof, true); assert.equal(cancelled, true);
});
