import assert from "node:assert/strict";
import test from "node:test";
import { encodeHeader, decodeHeader } from "../src/data/extensions/tos-datastore/header.js";
import { assertEtag } from "../src/data/extensions/tos-datastore/revision.js";
import { encryptTosCredential, decryptTosCredential } from "../src/tos-credential-codec.js";

test("single opaque ETag preserves quoted colons/commas and rejects conditional expressions", () => {
  for (const good of ['"a:b:c"', '"a,b"', "abc123", "a:b"]) assert.doesNotThrow(() => assertEtag(good));
  for (const bad of ["*", " ", '"a", "b"', "a,b", 'W/"a"', "a\r\nsecret", 1, null]) assert.throws(() => assertEtag(bad));
});
test("header has a fixed fourteen-byte version2 layout and rejects unsupported headers", () => {
  const mutationId = Buffer.alloc(8, 255), header = encodeHeader(mutationId, true);
  assert.equal(header.length, 14); assert.equal(header[4], 2);
  assert.equal(Buffer.from(header.slice(0, 4)).toString(), "MSDT");
  assert.deepEqual(decodeHeader(header), { mutationId: Uint8Array.from(mutationId), deleted: true });
  for (const offset of [0, 4, 5]) { const changed = header.slice(); changed[offset] = 99; assert.throws(() => decodeHeader(changed)); }
  const legacy = header.slice(); legacy[4] = 1; assert.throws(() => decodeHeader(legacy));
  assert.throws(() => decodeHeader(header.slice(1))); assert.throws(() => encodeHeader(new Uint8Array(4), false));
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
