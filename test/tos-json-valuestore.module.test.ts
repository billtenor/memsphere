import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { Config } from "../src/data/api/config.js";
import { TosJsonValueStore, TosJsonValueStoreFactory } from "../src/data/extensions/tos-json-valuestore/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { MemoryTosClient } from "./support/tos-object-client.js";
import { valueStoreContract } from "./support/value-store-contract.js";
import { TosRequestError } from "../src/data/extensions/tos-datastore/response.js";

const runtime = createPlainRuntime({ id: "value.json", root: { kind: "object", fields: [], field: () => undefined, additionalProperties: { kind: "scalar", scalar: "string" } } });
const config = { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: "values/", credentials: { source: "env" as const, accessKeyIdEnv: "TEST_AK", accessKeySecretEnv: "TEST_SK" } };
function fixture() {
  const client = new MemoryTosClient(); let serial = 0;
  const open = () => new TosJsonValueStore("values", runtime, config, client, () => 1000, () => (++serial).toString(16).padStart(16, "0"));
  return { client, store: open(), open };
}
valueStoreContract("TOS JSON", async () => { const f = fixture(); return { store: f.store, reopen: async () => f.open() }; });

test("same-value update uses HEAD+onePUT and preserves creation metadata without downloading old value", async () => {
  const { store, client } = fixture(), first = await store.create({}, "a", { name: "same" });
  client.calls.length = 0; const next = await store.update({}, "a", { name: "same" }, { expectedRevision: first.revision });
  assert.deepEqual(client.calls.map(c => c.method), ["HEAD", "PUT"]);
  assert.notEqual(first.revision, next.revision); assert.equal(next.createdAt, first.createdAt);
  const physical = client.objects.get("values/a.json")!, body = JSON.parse(physical.bytes.toString());
  assert.equal(body.storageVersion, 1); assert.match(body.mutationId, /^[0-9a-f]{16}$/);
  assert.equal(physical.headers["x-tos-meta-memsphere-is_delete"], "false");
  assert.equal(physical.headers["x-tos-meta-memsphere-storage-version"], "1");
  assert.deepEqual(await store.get({}, "a"), next);
});
test("delete is hidden from standard reads, recreation rejects every pre-delete token", async () => {
  const { store, client } = fixture(), first = await store.create({}, "a", { name: "old" });
  await store.delete({}, "a", { expectedRevision: first.revision });
  assert.equal(await store.get({}, "a"), undefined); assert.equal(await store.has({}, "a"), false); assert.deepEqual((await store.list({})).items, []);
  const physical = client.objects.get("values/a.json")!, tombstone = JSON.parse(physical.bytes.toString());
  assert.equal(tombstone.is_delete, true); assert.ok(!Object.hasOwn(tombstone, "value"));
  const recreated = await store.create({}, "a", { name: "new" }); assert.notEqual(recreated.revision, first.revision);
  await assert.rejects(store.update({}, "a", { name: "bad" }, { expectedRevision: first.revision }), { code: "REVISION_CONFLICT" });
});
test("unconditional upsert races fail directly after consuming input, with no follow-up requests", async () => {
  const { store, client } = fixture(); await store.create({}, "a", { name: "old" });
  let ready!: () => void, release!: () => void, arrived = 0;
  const both = new Promise<void>(r => ready = r), gate = new Promise<void>(r => release = r);
  client.beforeCommit = async () => { if (++arrived === 2) ready(); await gate; };
  client.calls.length = 0;
  const result = Promise.allSettled([store.upsert({}, "a", { name: "A" }), store.upsert({}, "a", { name: "B" })]);
  await both; release(); const settled = await result;
  assert.equal(settled.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((settled.find(x => x.status === "rejected") as PromiseRejectedResult).reason.code, "REVISION_CONFLICT");
  assert.equal(client.calls.filter(c => c.method === "PUT").length, 2);
  assert.equal(client.calls.filter(c => c.method === "HEAD").length, 2); assert.equal(client.calls.filter(c => c.method === "GET").length, 0);
});
test("failed input, wildcard revision and metadata mismatch never alter the existing object", async () => {
  const { store, client } = fixture(); await store.create({}, "a", { name: "old" }); const original = Buffer.from(client.objects.get("values/a.json")!.bytes);
  client.calls.length = 0;
  for (const expectedRevision of ["*", '"a", "b"', " ", "W/\"a\""]) await assert.rejects(store.update({}, "a", { name: "bad" }, { expectedRevision }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(store.update({}, "a", { name: BigInt(1) })); assert.equal(client.calls.length, 0);
  client.objects.get("values/a.json")!.headers["x-tos-meta-memsphere-created-at"] = "999";
  await assert.rejects(store.get({}, "a"), { code: "STORE_INCOMPATIBLE" }); assert.deepEqual(client.objects.get("values/a.json")!.bytes, original);
});
test("permissions and transport errors are not treated as missing or retried", async () => {
  const { store, client } = fixture(); client.head = async () => { throw new TosRequestError("AccessDenied", 403); };
  await assert.rejects(store.has({}, "a"), { code: "AccessDenied" }); await assert.rejects(store.create({}, "a", { name: "x" }), { code: "AccessDenied" });
  assert.equal(client.objects.size, 0);
});
test("pagination filters mixed tombstones without losing candidates or empty-page continuation", async () => {
  const { store } = fixture();
  for (let i = 0; i < 14; i++) { const id = String(i).padStart(2, "0"); await store.create({}, id, { name: id }); if (i < 11) await store.delete({}, id); }
  const first = await store.list({}, { limit: 1 }); assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
  const ids: string[] = []; let cursor = first.nextCursor;
  do { const page = await store.list({}, { limit: 1, cursor }); ids.push(...page.items.map(x => x.id)); cursor = page.nextCursor; } while (cursor);
  assert.deepEqual(ids, ["11", "12", "13"]);
});
test("factory rejects mode and versioned buckets, resolves credentials once and preserves Store identity", async () => {
  const client = new MemoryTosClient(); let resolved = 0;
  const factory = new TosJsonValueStoreFactory(async () => { resolved++; return { accessKeyId: "fake-ak", accessKeySecret: "fake-sk" }; }, () => client);
  await assert.rejects(factory.createStore({}, "values", runtime, new Config({ ...config, mode: "revision" })));
  const store = await factory.createStore({}, "values", runtime, new Config(config)); assert.equal(store.id, "values"); assert.equal(store.model, "value.json"); assert.equal(resolved, 1);
  client.version = "Suspended"; await assert.rejects(factory.createStore({}, "values", runtime, new Config(config)), { code: "STORE_INCOMPATIBLE" });
});

test("a lost acknowledgment reports possible commit and never retries or compensates", async () => {
  const { store, client } = fixture(); await store.create({}, "a", { name: "old" });
  const put = client.put.bind(client); client.put = async (...args) => { await put(...args); throw new TosRequestError("TOS_DEADLINE"); };
  client.calls.length = 0;
  await assert.rejects(store.update({}, "a", { name: "new" }), error => {
    assert.equal((error as { code: string }).code, "TOS_DEADLINE"); assert.match(String(error), /may be committed/); return true;
  });
  assert.deepEqual(client.calls.map(c => c.method), ["HEAD", "PUT"]);
  assert.deepEqual((await store.get({}, "a"))!.value, { name: "new" });
});

test("parent cancellation closes a stalled value read without cancelling an independent reader", async () => {
  const { store, client } = fixture(); await store.create({}, "slow", { name: "slow" }); await store.create({}, "fast", { name: "fast" });
  const read = client.read.bind(client); let started!: () => void;
  const ready = new Promise<void>(resolve => started = resolve); let stalled: Readable | undefined;
  client.read = async (...args) => {
    const response = await read(...args);
    if (args[1].endsWith('/slow.json')) {
      response.stream.destroy(); stalled = new Readable({ read() { started(); } }); return { ...response, stream: stalled };
    }
    return response;
  };
  const controller = new AbortController(), rejected = assert.rejects(store.get({ signal: controller.signal }, 'slow'), { code: 'ABORTED' });
  await ready; const peer = store.get({}, 'fast'); controller.abort(); await rejected;
  assert.equal(stalled!.destroyed, true); assert.deepEqual((await peer)!.value, { name: 'fast' });
});
