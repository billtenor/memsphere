import assert from "node:assert/strict";
import test from "node:test";
import { encodeHeader, decodeHeader } from "../src/data/extensions/tos-datastore/header.js";
import { encodeRevision, decodeRevision } from "../src/data/extensions/tos-datastore/revision.js";
import { encryptTosCredential, decryptTosCredential } from "../src/tos-credential-codec.js";

test("opaque revision preserves quoted ETags containing colons and rejects malformed input", () => {
  const token = encodeRevision(42, '"a:b:c"');
  assert.equal(token, '0000002a:"a:b:c"');
  assert.deepEqual(decodeRevision(token), { counter: 42, etag: '"a:b:c"' });
  for (const bad of ['2a:"a"', '0000002A:"a"', '0000002a:', '0000002a:a\r\nsecret', 1, null]) assert.throws(() => decodeRevision(bad as string));
});

test("header has a fixed ten-byte format and fails closed on unknown format/flags", () => {
  const header = encodeHeader(0xffffffff, true);
  assert.equal(header.length, 10);
  assert.equal(Buffer.from(header.slice(0, 4)).toString(), "MSDT");
  assert.deepEqual(decodeHeader(header), { counter: 0xffffffff, deleted: true });
  for (const offset of [0, 4, 5]) { const changed = header.slice(); changed[offset] = 99; assert.throws(() => decodeHeader(changed)); }
  assert.throws(() => decodeHeader(header.slice(1)));
});

test("credential vault encrypts values, authenticates the id and detects tampering", () => {
  const credentials = { accessKeyId: "test-access-key", accessKeySecret: "test-secret-key", stsToken: "test-token" };
  const vault = encryptTosCredential("first", credentials);
  assert.deepEqual(decryptTosCredential("first", vault), credentials);
  assert.ok(!JSON.stringify(vault).includes(credentials.accessKeySecret));
  const copy = structuredClone(vault); copy.entries.second = copy.entries.first;
  assert.throws(() => decryptTosCredential("second", copy), { code: "TOS_CREDENTIALS_ERROR" });
  copy.entries.first.tag = Buffer.alloc(16).toString("base64");
  assert.throws(() => decryptTosCredential("first", copy), { code: "TOS_CREDENTIALS_ERROR" });
  const replaced = encryptTosCredential("first", { ...credentials, accessKeySecret: "replacement" }, vault);
  assert.notDeepEqual(vault.entries.first, replaced.entries.first);
  assert.deepEqual(decryptTosCredential("first", vault), credentials);
});

test("upload boundary counts the physical header and accepts exactly the limit", async () => {
  const { createTosUploadBody } = await import("../src/data/extensions/tos-datastore/store.js");
  const { MAX_OBJECT_BYTES } = await import("../src/data/extensions/tos-datastore/header.js");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  assert.equal(MAX_OBJECT_BYTES, 5 * 1024 ** 3);
  for (const header of [undefined, encodeHeader(1, false)]) for (const excess of [0, 1]) {
    const data = { id: "item", model: "file.json", payload: { contentType: "application/octet-stream", content: bytesContent(Buffer.alloc(20 - (header?.length ?? 0) + excess)) } };
    const body = createTosUploadBody({}, data, header, 20);
    const consume = async () => { let size = 0; for await (const chunk of body) size += chunk.length; return size; };
    if (excess) await assert.rejects(consume(), { code: "PAYLOAD_TOO_LARGE" });
    else assert.equal(await consume(), 20);
  }
});
