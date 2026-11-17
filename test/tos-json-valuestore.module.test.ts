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

// Each gate is reached only after both production handles finish HEAD and
// construct their original PUT conditions. The chosen commit order is explicit.
for (const scenario of ['missing-create', 'deleted-create', 'update-delete', 'upsert-upsert'] as const) {
  for (const first of [0, 1] as const) test(`${scenario}: writer ${first} commits once and the competing original condition fails`, async () => {
    await valueRace(scenario, first);
  });
}
test('ValueStore CAS oracle rejects a transport that removes conditional headers', async () => {
  await assert.rejects(valueRace('missing-create', 0, true), /Exactly one conditional writer may commit/);
});
for (const first of [0, 1] as const) test(`upsert with reverse PUT arrival still commits chosen writer ${first}`, async () => {
  await valueRace('upsert-upsert', first, false, true);
});
async function valueRace(scenario: 'missing-create' | 'deleted-create' | 'update-delete' | 'upsert-upsert', first: 0 | 1, removeConditions = false, reverseArrival = false) {
  const { controlledPutPair } = await import('./support/tos-cas-barrier.js');
  const { client, store } = fixture();
  if (scenario !== 'missing-create') await store.create({}, 'race', { name: 'old' });
  if (scenario === 'deleted-create') await store.delete({}, 'race');
  const revision = client.objects.get('values/race.json')?.headers.etag;
  const transport = {
    head: client.head.bind(client), read: client.read.bind(client), list: client.list.bind(client),
    delete: client.delete.bind(client), versioning: client.versioning.bind(client),
    put: ((context, key, body, options) => client.put(context, key, body,
      removeConditions ? { ...options, create: undefined, ifMatch: undefined } : options)) as typeof client.put
  };
  client.calls.length = 0;
  let mutation = 10;
  let releaseFirst!: () => void;
  const writerOnePrepared = new Promise<void>(resolve => { releaseFirst = resolve; });
  const arrivals: number[] = [], finished = [false, false];
  await controlledPutPair({ client: transport, key: 'values/race.json', first,
    condition: revision ? { ifMatch: revision } : { create: true },
    conflictCode: ['update-delete', 'upsert-upsert'].includes(scenario) ? 'REVISION_CONFLICT' : 'ALREADY_EXISTS',
    write: async (gated, context, index) => {
      try {
        if (reverseArrival && index === 0) await writerOnePrepared;
        const observed = { ...gated, put: ((...args) => {
          arrivals.push(index); const result = gated.put(...args);
          if (index === 1) releaseFirst();
          return result;
        }) as typeof gated.put };
        const handle = new TosJsonValueStore('values', runtime, config, observed, () => 2000, () => (++mutation).toString(16).padStart(16, '0'));
        if (scenario === 'upsert-upsert') await handle.upsert(context, 'race', { name: index === 0 ? 'A' : 'B' });
        else if (scenario !== 'update-delete') await handle.create(context, 'race', { name: index === 0 ? 'A' : 'B' });
        else if (index === 0) await handle.update(context, 'race', { name: 'updated' }, { expectedRevision: revision });
        else await handle.delete(context, 'race', { expectedRevision: revision });
      } finally { if (index === 1) releaseFirst(); finished[index] = true; }
    }
  });
  assert.deepEqual(finished, [true, true]);
  if (reverseArrival) assert.deepEqual(arrivals, [1, 0]);
  assert.equal(client.calls.filter(c => c.method === 'PUT').length, 2);
  assert.equal(client.calls.filter(c => c.method === 'HEAD').length, 2);
  assert.equal(client.calls.filter(c => c.method === 'GET').length, scenario === 'missing-create' ? 2 : 0);
  const body = JSON.parse(client.objects.get('values/race.json')!.bytes.toString());
  const deleted = scenario === 'update-delete' && first === 1;
  assert.equal(body.is_delete, deleted);
  if (deleted) {
    assert.equal(Object.hasOwn(body, 'value'), false); assert.equal(await store.get({}, 'race'), undefined);
  } else {
    const expected = { name: scenario === 'update-delete' ? 'updated' : first === 0 ? 'A' : 'B' };
    assert.deepEqual(body.value, expected); assert.deepEqual((await store.get({}, 'race'))!.value, expected);
  }
}

test('CAS preparation failure preserves its cause and settles the writer held at the gate', async () => {
  const { controlledPutPair } = await import('./support/tos-cas-barrier.js');
  const { client, store } = fixture(); const original = await store.create({}, 'early', { name: 'old' });
  const before = Buffer.from(client.objects.get('values/early.json')!.bytes);
  const transport = { head: client.head.bind(client), read: client.read.bind(client), list: client.list.bind(client),
    delete: client.delete.bind(client), versioning: client.versioning.bind(client), put: client.put.bind(client) };
  let arrived!: () => void, finished = false;
  const firstPrepared = new Promise<void>(resolve => arrived = resolve), failure = new Error('writer failed before its PUT');
  await assert.rejects(controlledPutPair({ client: transport, key: 'values/early.json', first: 0,
    condition: { ifMatch: original.revision }, conflictCode: 'REVISION_CONFLICT',
    write: async (gated, context, index) => {
      if (index === 1) { await firstPrepared; throw failure; }
      const observed = { ...gated, put: ((...args) => { const result = gated.put(...args); arrived(); return result; }) as typeof gated.put };
      try { await new TosJsonValueStore('values', runtime, config, observed, () => 2000, () => '0000000000000002').upsert(context, 'early', { name: 'never committed' }); }
      finally { finished = true; }
    }
  }), error => error === failure);
  assert.equal(finished, true); assert.deepEqual(client.objects.get('values/early.json')!.bytes, before);
});
