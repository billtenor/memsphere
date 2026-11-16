import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Config } from "../src/data/api/config.js";
import { TosJsonValueStoreFactory } from "../src/data/extensions/tos-json-valuestore/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { createTosClient } from "../src/data/extensions/tos-datastore/client.js";
import { validateCredentials } from "../src/data/extensions/tos-datastore/config.js";
import { readBounded } from "../src/data/extensions/tos-datastore/response.js";
import type { ModelRuntime } from "../src/data/api/model-runtime.js";

const file = process.env.MEMSPHERE_TOS_TEST_CREDENTIALS_FILE;
async function cloud(t: TestContext, runtime: ModelRuntime) {
  let credentials: ReturnType<typeof validateCredentials>;
  try { credentials = validateCredentials(JSON.parse(await readFile(file!, 'utf8'))); } catch { throw Error('Cannot read valid private TOS credentials'); }
  const owner = randomUUID(), base = `memsphere-value-integration/${owner}/`, prefix = base + 'records/', marker = base + 'owner';
  const config = { region: 'cn-beijing', endpoint: 'tos-cn-beijing.volces.com', bucket: 'lyj-test', prefix,
    credentials: { source: 'settings' as const, id: 'integration' }, dataTimeoutMs: 120000, controlTimeoutMs: 120000 };
  const client = createTosClient(config, credentials), intents = ['item'].map(id => prefix + id + '.json');
  let claimed = false, markerEtag: string | undefined;
  t.after(async () => {
    const cleanup = { signal: AbortSignal.timeout(60000) };
    if (!claimed) return;
    const check = await client.read(cleanup, marker, { ifMatch: markerEtag });
    assert.equal((await readBounded(check.stream, 128)).toString(), owner);
    for (const key of intents) {
      try {
        const head = await client.head(cleanup, key);
        assert.equal(head['x-tos-meta-memsphere-model'], Buffer.from(runtime.descriptor.id).toString('base64url'));
        await client.delete(cleanup, key);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        try { const out = await client.read(cleanup, key); out.stream.destroy(); throw Error('Object appeared during cleanup'); }
        catch (diagnosis) { if ((diagnosis as { code?: string }).code !== 'NoSuchKey') throw diagnosis; }
      }
    }
    await client.delete(cleanup, marker);
    const rest = await client.list(cleanup, { prefix: base, limit: 128 }); assert.deepEqual(rest.keys, []); assert.equal(rest.token, undefined);
    t.diagnostic(`Owned-prefix cleanup verified: ${prefix}`);
  });
  markerEtag = (await client.put({ signal: t.signal }, marker, Readable.from([Buffer.from(owner)]), { create: true, contentType: 'text/plain', meta: { owner } })).etag;
  claimed = true;
  const store = await new TosJsonValueStoreFactory(async () => credentials).createStore({ signal: t.signal }, 'cloud-values', runtime, new Config(config));
  t.diagnostic(`Reserved cloud prefix: ${prefix}`);
  return { store, client, prefix, context: { signal: t.signal } };
}

test('official SDK ValueStore cloud JSON, mirror, conditional writes and hidden tombstone recreation', { skip: !file, timeout: 180000 }, async t => {
  const runtime = createPlainRuntime({ id: 'cloud-value.json', root: { kind: 'object', fields: [], field: () => undefined, additionalProperties: { kind: 'scalar', scalar: 'string' } } });
  const { store, client, prefix, context } = await cloud(t, runtime);
  const first = await store.create(context, 'item', { name: 'first' });
  const same = await store.update(context, 'item', { name: 'first' }, { expectedRevision: first.revision });
  assert.notEqual(first.revision, same.revision); assert.deepEqual(await store.get(context, 'item'), same);
  const head = await client.head(context, prefix + 'item.json'); assert.equal(head['x-tos-meta-memsphere-is_delete'], 'false'); assert.equal(head['x-tos-meta-memsphere-storage-version'], '1');
  await assert.rejects(store.create(context, 'item', { name: 'bad' }), { code: 'ALREADY_EXISTS' });
  await assert.rejects(store.update(context, 'item', { name: 'bad' }, { expectedRevision: first.revision }), { code: 'REVISION_CONFLICT' });
  await store.delete(context, 'item', { expectedRevision: same.revision }); assert.equal(await store.get(context, 'item'), undefined); assert.equal(await store.has(context, 'item'), false);
  assert.deepEqual((await store.list(context)).items, []);
  const recreated = await store.create(context, 'item', { name: 'again' }); assert.notEqual(recreated.revision, same.revision);
  const upsert = await store.upsert(context, 'item', { name: 'upsert' }); assert.deepEqual(await store.get(context, 'item'), upsert);
});
