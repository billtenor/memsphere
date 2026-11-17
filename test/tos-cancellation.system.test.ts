import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "../src/data/api/context.js";
import { openBusinessStore } from "../src/project/business-stores.js";
import { businessFixture } from "./helpers/business-data.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { useTosService } from "./support/tos-sdk-service.js";
import { ownedSetup } from "./support/owned-setup.js";
import { casPhase } from "./support/tos-cas-barrier.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

for (const phase of ['cli-head', 'cli-put', 'direct-puts'] as const) {
  test(`${phase} cancellation settles owned writes before releasing the commit gate`, { timeout: 30000 }, async t => {
    const f = await businessFixture(t), service = useTosService(t), prior = { ...process.env };
    const controller = new AbortController(), entered = gate(), release = gate();
    const signal = AbortSignal.any([t.signal, controller.signal]);
    const env = { ...prior, MEMSPHERE_HOME: f.home, CLI_TOS_AK: 'fake-ak', CLI_TOS_SK: 'fake-sk' };
    const writes: Promise<unknown>[] = [];
    const setup = ownedSetup(t.signal, async () => {
      await Promise.allSettled(writes);
      for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
      Object.assign(process.env, prior);
    });
    const stop = () => { controller.abort(); release.open(); return setup.stop(); };
    f.beforeCleanup(stop);
    const onAbort = () => { void stop().catch(() => undefined); };
    t.signal.addEventListener('abort', onAbort, { once: true });
    const run = (args: string[]) => setup.acquire(() => invokeCliModule(
      ['--project', 'test-project', 'data', ...args, '--output', 'json'], f.cwd, env, 'memsphere', signal));
    let arrivals = 0, cancellations = 0;
    const pause = async (context: Context) => {
      assert.ok(context.signal); context.signal.throwIfAborted();
      if (++arrivals === (phase === 'direct-puts' ? 2 : 1)) entered.open();
      const ownedSignal = context.signal;
      let abort!: () => void;
      try {
        await Promise.race([release.promise, new Promise<never>((_, reject) => {
          abort = () => { cancellations++; reject(ownedSignal.reason); };
          ownedSignal.addEventListener('abort', abort, { once: true });
          if (ownedSignal.aborted) abort();
        })]);
        ownedSignal.throwIfAborted();
      } finally { ownedSignal.removeEventListener('abort', abort); }
    };
    try {
      setup.check(); Object.assign(process.env, env);
      await setup.acquire(() => writeFile(join(f.home, 'config.json'), '{}'));
      const settings = join(f.directory, 'tos.json');
      await setup.acquire(() => writeFile(settings, JSON.stringify({ region: 'cn-beijing', endpoint: 'tos-cn-beijing.volces.com',
        bucket: 'test-bucket', prefix: 'cancel/', credentials: { source: 'env', accessKeyIdEnv: 'CLI_TOS_AK', accessKeySecretEnv: 'CLI_TOS_SK' } })));
      await run(['store', 'create', 'values', '--kind', 'value', '--factory', 'memsphere/tos-json', '--model', 'record.json', '--config-file', settings]);
      const first = JSON.parse((await run(['create', 'item', '--store', 'values', '--value', '{"name":"before","count":1}'])).stdout);
      const before = Buffer.from(service.objects.get('cancel/item.json')!.bytes);
      let store: Awaited<ReturnType<typeof openBusinessStore>> | undefined;
      if (phase === 'direct-puts') store = await setup.acquire(() => openBusinessStore({ signal }, f.root, 'values'));
      service.calls.length = 0;
      if (phase === 'cli-head') {
        const head = service.head.bind(service);
        t.mock.method(service, 'head', async (context: Context, key: string) => {
          const result = await head(context, key); await pause(context); return result;
        });
      } else service.beforeCommit = (_, context) => pause(context);
      if (store) {
        assert.equal(store.store.kind, 'ValueStore');
        if (store.store.kind !== 'ValueStore') throw Error('Expected ValueStore');
        for (const name of ['A', 'B']) writes.push(store.store.update({ signal }, 'item', { name, count: 2 }, { expectedRevision: first.revision }));
      } else writes.push(run(['update', 'item', '--store', 'values', '--value', '{"name":"after","count":2}', '--expected-revision', first.revision]));
      const settled = Promise.allSettled(writes);
      await casPhase(Promise.race([entered.promise, Promise.all(writes).then(() => { throw Error('Writes completed without entering the gate'); })]), 'owned writes held');
      const reason = Object.assign(new Error('owned invocation cancelled'), { code: 'ABORTED' });
      controller.abort(reason);
      // Do not release the gate to make cancellation appear to work.
      const results = await casPhase(settled, 'writes cancelled while gate remains closed');
      assert.equal(cancellations, phase === 'direct-puts' ? 2 : 1);
      for (const result of results) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.reason.code, 'ABORTED'); }
      assert.equal(service.calls.filter(call => call.method === 'PUT').length, phase === 'cli-head' ? 0 : phase === 'direct-puts' ? 2 : 1);
      assert.deepEqual(service.objects.get('cancel/item.json')!.bytes, before);
      const count = service.calls.length;
      await assert.rejects(run(['delete', 'item', '--store', 'values']), error => error === reason);
      assert.equal(service.calls.length, count);
    } finally {
      t.signal.removeEventListener('abort', onAbort);
      await stop();
    }
  });
}
