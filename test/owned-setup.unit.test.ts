import assert from "node:assert/strict";
import test from "node:test";
import { ownedSetup } from "./support/owned-setup.js";
import { casPhase } from "./support/tos-cas-barrier.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

for (const boundary of ['scope', 'page'] as const) test(`cancel during ${boundary} acquisition closes late resources before fixture cleanup`, { timeout: 20000 }, async () => {
  const controller = new AbortController(), entered = gate(), release = gate();
  const events: string[] = [], contexts = new Set<string>();
  let browser: { close(): Promise<void> } | undefined;
  const resource = { async close() { contexts.clear(); events.push('resources closed'); } };
  if (boundary === 'page') browser = resource;
  const setup = ownedSetup(controller.signal, async () => { await browser?.close(); events.push('fixture removed'); });
  let stopping: Promise<void> | undefined, cleaned = false;
  const reason = new Error('cancel during acquisition');
  controller.signal.addEventListener('abort', () => { stopping = setup.stop().then(() => { cleaned = true; }); }, { once: true });
  const work = (async () => {
    await setup.acquire(async () => {
      entered.open(); await release.promise; contexts.add('late context'); events.push('resource acquired'); return resource;
    }, value => { browser = value; });
    setup.check(); events.push('journey continued');
  })();
  const rejected = assert.rejects(work, error => error === reason);
  void rejected.catch(() => undefined);
  try {
    await casPhase(Promise.race([entered.promise, work]), 'resource acquisition entered'); controller.abort(reason);
    await Promise.resolve(); assert.equal(cleaned, false);
    release.open(); await casPhase(Promise.all([rejected, stopping]), 'canceled resource settled');
    assert.equal(contexts.size, 0);
    assert.deepEqual(events, ['resource acquired', 'resources closed', 'fixture removed']);
    let called = false;
    await assert.rejects(setup.acquire(async () => { called = true; }), error => error === reason);
    assert.equal(called, false);
  } finally { release.open(); await casPhase(Promise.allSettled([work, setup.stop()]), 'setup regression cleanup'); }
});

test('cancel before acquisition starts prevents the queued operation', async () => {
  const controller = new AbortController(); let created = false, cleaned = false;
  const setup = ownedSetup(controller.signal, async () => { cleaned = true; });
  const work = setup.acquire(async () => { created = true; });
  const reason = new Error('cancel before setup'); controller.abort(reason);
  const stopping = setup.stop();
  await assert.rejects(work, error => error === reason); await stopping;
  assert.equal(created, false); assert.equal(cleaned, true);
});

test('acquisition failure preserves its error and cleanup runs once', async () => {
  let closed = 0; const failure = new Error('setup failed');
  const setup = ownedSetup(new AbortController().signal, async () => { closed++; });
  await assert.rejects(setup.acquire(async () => { throw failure; }), error => error === failure);
  await Promise.all([setup.stop(), setup.stop()]); assert.equal(closed, 1);
});
