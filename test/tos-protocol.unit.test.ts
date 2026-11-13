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
  for (const header of [undefined, encodeHeader(1, false)]) for (const excess of [-1, 0, 1]) {
    const data = { id: "item", model: "file.json", payload: { contentType: "application/octet-stream", content: bytesContent(Buffer.alloc(20 - (header?.length ?? 0) + excess)) } };
    const body = createTosUploadBody({}, data, header, 20);
    const consume = async () => { let size = 0; for await (const chunk of body) size += chunk.length; return size; };
    if (excess > 0) await assert.rejects(consume(), { code: "PAYLOAD_TOO_LARGE" });
    else assert.equal(await consume(), 20 + excess);
  }
});


test("TOS keys enforce the UTF-8 limit and retain literal Unicode and percent signs", async () => {
  const { objectKey } = await import("../src/data/extensions/tos-datastore/keys.js");
  const asciiPrefix = ("a".repeat(249) + "/").repeat(4);
  assert.equal(objectKey(asciiPrefix, "a".repeat(24)).length, 1024);
  assert.throws(() => objectKey(asciiPrefix, "a".repeat(25)));
  const unicodePrefix = ("a".repeat(225) + "/").repeat(4);
  assert.equal(Buffer.byteLength(objectKey(unicodePrefix, "界".repeat(40))), 1024);
  assert.throws(() => objectKey(unicodePrefix, "界".repeat(41)));
  assert.equal(objectKey("r/", "图片/%+ a"), "r/图片/%+ a");
  for (const id of ["", "../a", "/a", "a//b", "a/./b", "a\u0000b", "a\\b"]) assert.throws(() => objectKey("r/", id));
});

test("TOS cursors bind identity and reject malformed envelopes without interpreting backend tokens", async () => {
  const { cursorScope, encodeCursor, decodeCursor } = await import("../src/data/extensions/tos-datastore/keys.js");
  const scope = cursorScope(["one", "bucket", "prefix/"]), foreign = cursorScope(["two", "bucket", "prefix/"]);
  const token = '页+/%=:"token"';
  assert.equal(decodeCursor(scope, encodeCursor(scope, token)), token);
  const pack = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  for (const cursor of ["", "=", "!", "a".repeat(16385), Buffer.from("not json").toString("base64url"), pack(null), pack([]), pack({v:2,scope,token}), pack({v:1,scope:foreign,token}), pack({v:1,scope,token:""}), pack({v:1,scope,token:7}), pack({v:1,scope})]) assert.throws(() => decodeCursor(scope,cursor));
});

test("TOS config validates native region endpoints, namespace and credential references", async () => {
  const { Config } = await import("../src/data/api/config.js");
  const { parseTosConfig } = await import("../src/data/extensions/tos-datastore/config.js");
  const base = { region:"cn-beijing", endpoint:"tos-cn-beijing.volces.com", bucket:"test-bucket", prefix:"records/", mode:"raw", credentials:{source:"settings",id:"main"} };
  for (const mode of ["raw","revision"]) for (const endpoint of ["tos-cn-beijing.volces.com","tos-cn-beijing.ivolces.com"]) assert.equal(parseTosConfig(new Config({...base,mode,endpoint})).mode,mode);
  for (const credentials of [{source:"env",accessKeyIdEnv:"AK",accessKeySecretEnv:"SK"},{source:"env",accessKeyIdEnv:"AK",accessKeySecretEnv:"SK",stsTokenEnv:"STS"}]) assert.equal(parseTosConfig(new Config({...base,credentials})).credentials.source,"env");
  const patches: Record<string, unknown>[] = [
    {extra:true},{region:" cn-beijing"},{region:"CN"},{endpoint:"https://tos-cn-beijing.volces.com"},{endpoint:"tos-cn-shanghai.volces.com"},{endpoint:"tos-cn-beijing.volces.com/path"},{endpoint:"user:secret@tos-cn-beijing.volces.com"},{endpoint:"example.com"},
    {bucket:"ab"},{bucket:"Upper"},{bucket:"a".repeat(64)},{prefix:""},{prefix:"records"},{prefix:"/records/"},{prefix:"a//b/"},{prefix:"a/../b/"},{prefix:"a\u0000/"},{prefix:"a".repeat(1023)+"/"},{mode:"guess"},
    {credentials:null},{credentials:[]},{credentials:{source:"token"}},{credentials:{source:"settings",id:""}},{credentials:{source:"settings",id:"main",accessKeySecret:"secret"}},{credentials:{source:"env",accessKeyIdEnv:"bad-name",accessKeySecretEnv:"SK"}},{credentials:{source:"env",accessKeyIdEnv:"AK"}},{credentials:{source:"env",accessKeyIdEnv:"AK",accessKeySecretEnv:"SK",stsTokenEnv:""}}
  ];
  for (const patch of patches) assert.throws(() => parseTosConfig(new Config({...base,...patch} as never)), JSON.stringify(patch));
});
