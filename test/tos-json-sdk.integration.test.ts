import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { Config } from "../src/data/api/config.js";
import { TosJsonValueStoreFactory } from "../src/data/extensions/tos-json-valuestore/index.js";
import { TosDataStoreFactory } from "../src/data/extensions/tos-datastore/index.js";
import { bindTosClient } from "../src/data/extensions/tos-datastore/client.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { fixture, gate } from "./support/tos-sdk-http.js";
import { MemoryTosClient } from "./support/tos-object-client.js";
import { TosRequestError } from "../src/data/extensions/tos-datastore/response.js";

const config = { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "probe-bucket", prefix: "values/", credentials: { source: "settings" as const, id: "test" } };
const credentials = async () => ({ accessKeyId: "fake-ak", accessKeySecret: "fake-sk" });
const runtime = createPlainRuntime({ id: "value.json", root: { kind: "object", fields: [], field: () => undefined, additionalProperties: { kind: "scalar", scalar: "string" } } });

test("ValueStore Factory uses official SDK JSON metadata and exact conditional headers over HTTP", { timeout: 10000 }, async t => {
  const objects = new MemoryTosClient(), wire: Array<{ method: string; ifMatch?: string }> = [];
  const f = await fixture(t, (request, response) => {
    void (async () => {
      const url = new URL(request.url!, "http://fixture"), key = url.pathname.split('/').slice(2).join('/');
      if (url.searchParams.has("versioning")) { response.writeHead(200); response.end('{}'); return; }
      wire.push({ method: request.method!, ifMatch: request.headers['if-match'] as string | undefined });
      try {
        if (request.method === "HEAD") { response.writeHead(200, await objects.head({}, key)); response.end(); }
        else if (request.method === "GET") { const out = await objects.read({}, key); response.writeHead(200, out.headers); out.stream.pipe(response); }
        else if (request.method === "PUT") {
          const meta: Record<string, string> = {};
          for (const [name, value] of Object.entries(request.headers)) if (name.startsWith('x-tos-meta-')) meta[name.slice(11)] = String(value);
          const headers = await objects.put({}, key, request, { meta, contentType: String(request.headers['content-type']), ifMatch: request.headers['if-match'] as string | undefined, create: request.headers['if-none-match'] === '*' });
          response.writeHead(200, { etag: headers.etag! }); response.end();
        } else throw Error('Unexpected method');
      } catch (e) { response.writeHead(e instanceof TosRequestError ? e.status! : 500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ Code: e instanceof TosRequestError ? e.code : 'InternalError' })); }
    })().catch(() => response.destroy());
  });
  const factory = new TosJsonValueStoreFactory(credentials, parsed => bindTosClient(f.sdk, parsed.bucket, parsed));
  const store = await factory.createStore({}, 'values', runtime, new Config(config));
  const first = await store.create({}, 'a', { name: 'x' });
  wire.length = 0; const next = await store.update({}, 'a', { name: 'x' }, { expectedRevision: first.revision });
  assert.deepEqual(wire, [{ method: 'HEAD', ifMatch: undefined }, { method: 'PUT', ifMatch: first.revision }]);
  assert.notEqual(next.revision, first.revision); assert.deepEqual(await store.get({}, 'a'), next);
  await store.delete({}, 'a', { expectedRevision: next.revision }); assert.equal(await store.get({}, 'a'), undefined);
  await store.create({}, 'a', { name: 'again' }); assert.equal((await store.get({}, 'a'))!.value && objects.objects.size, 1);
  const calls = wire.length; await assert.rejects(store.update({}, 'a', { name: 'bad' }, { expectedRevision: '*' }), { code: 'INVALID_ARGUMENT' }); assert.equal(wire.length, calls);
});

for (const kind of ['value', 'data'] as const) test(`${kind} Factory controlTimeoutMs extends beyond old120s and closes at configured deadline, without cancelling peer`, { timeout: 10000 }, async t => {
  const started = gate(), peer = gate(), closed = gate(); let pending: import('node:http').ServerResponse | undefined;
  const f = await fixture(t, (request, response) => {
    if (request.url!.includes('versioning')) { response.writeHead(200); response.end('{}'); return; }
    if (request.url!.includes('peer')) { response.writeHead(200, { etag: '"peer"', 'content-length': '0' }); response.end(); peer.resolve(); return; }
    pending = response; response.once('close', closed.resolve); started.resolve();
  });
  const parsed = new Config({ ...config, controlTimeoutMs: 180000, ...(kind === 'data' ? { mode: 'raw' } : {}) });
  const factory = kind === 'value' ? new TosJsonValueStoreFactory(credentials, c => bindTosClient(f.sdk, c.bucket, c)) : new TosDataStoreFactory(credentials, c => bindTosClient(f.sdk, c.bucket, c));
  const store = kind === 'value' ? await (factory as TosJsonValueStoreFactory).createStore({}, 'values', runtime, parsed) : await (factory as TosDataStoreFactory).createStore({}, 'values', 'value.json', parsed);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = f.controller(); let settled = false;
  const failure = assert.rejects(store.has({ signal: controller.signal }, 'a'), { code: 'TOS_DEADLINE' }).finally(() => { settled = true; });
  await started.promise; t.mock.timers.tick(120001); await Promise.resolve(); assert.equal(settled, false);
  // A separate request has its own budget and cancellation token.
  const peerRequest = bindTosClient(f.sdk, config.bucket, { controlTimeoutMs: 1000 }).head({}, 'peer');
  await peer.promise; await peerRequest;
  t.mock.timers.tick(60000); await failure; await closed.promise; assert.ok(pending!.destroyed);
});

test('DataStore HEAD404 diagnostic GET starts its own data budget after a partially consumed control budget', { timeout: 10000 }, async t => {
  const headStarted = gate(), getStarted = gate(); let head: import('node:http').ServerResponse | undefined, get: import('node:http').ServerResponse | undefined;
  const f = await fixture(t, (request, response) => {
    if (request.url!.includes('versioning')) { response.end('{}'); return; }
    if (request.method === 'HEAD') { head = response; headStarted.resolve(); }
    else { get = response; getStarted.resolve(); }
  });
  const factory = new TosDataStoreFactory(credentials, c => bindTosClient(f.sdk, c.bucket, c));
  const store = await factory.createStore({}, 'raw', 'value.json', new Config({ ...config, mode: 'raw', dataTimeoutMs: 200000, controlTimeoutMs: 100000 }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false; const result = store.has({}, 'missing').finally(() => { settled = true; });
  await headStarted.promise; t.mock.timers.tick(90000); head!.writeHead(404); head!.end();
  await getStarted.promise; t.mock.timers.tick(110001); await Promise.resolve(); assert.equal(settled, false);
  get!.writeHead(404, { 'content-type': 'application/json' }); get!.end('{"Code":"NoSuchKey"}');
  assert.equal(await result, false);
});
