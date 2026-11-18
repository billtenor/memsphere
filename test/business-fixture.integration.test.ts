import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs/promises";
import { basename, sep } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { casPhase } from "./support/tos-cas-barrier.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

for (const phase of ['directory', 'mkdir', 'model-read'] as const) {
  test(`business fixture owns late ${phase} initialization before removal`, { timeout: 30000 }, async t => {
    const controller = new AbortController(), entered = gate(), release = gate();
    const hooks: Array<() => Promise<void>> = [], events: string[] = [], lateActions: string[] = [];
    const context = { signal: controller.signal, after: (cleanup: () => Promise<void>) => { hooks.push(cleanup); } } as unknown as TestContext;
    const original = { mkdtemp: fs.mkdtemp, mkdir: fs.mkdir, readFile: fs.readFile, writeFile: fs.writeFile, rm: fs.rm };
    let directory = '', held = false, ioSettled = false, initSettled = false;
    const pause = async () => { held = true; events.push('operation held'); entered.open(); await release.promise; };
    t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => {
      const result = await original.mkdtemp(...args); directory = String(result);
      if (phase === 'directory') { await pause(); ioSettled = true; }
      return result;
    });
    t.mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
      if (controller.signal.aborted) lateActions.push('mkdir');
      if (phase === 'mkdir' && !held) {
        await pause(); const result = await original.mkdir(...args); ioSettled = true; return result;
      }
      return original.mkdir(...args);
    });
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (controller.signal.aborted) lateActions.push('writeFile');
      return original.writeFile(...args);
    });
    t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
      if (controller.signal.aborted) lateActions.push('readFile');
      const bytes = await original.readFile(...args);
      if (phase === 'model-read' && String(args[0]).endsWith(`${sep}draft-07${sep}record.json`) && !held) {
        await pause(); ioSettled = true;
      }
      return bytes;
    });
    t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
      if (directory && basename(String(args[0])) === basename(directory)) {
        assert.equal(ioSettled, true); assert.equal(initSettled, true); events.push('directory removed');
      }
      return original.rm(...args);
    });
    const fixture = businessFixture(context), reason = new Error('fixture preparation cancelled');
    const rejected = assert.rejects(fixture, error => { initSettled = true; events.push('initialization settled'); return error === reason; });
    void rejected.catch(() => undefined);
    try {
      await casPhase(Promise.race([entered.promise, fixture.then(() => { throw Error('Fixture never entered the held operation'); })]), 'fixture operation entered');
      controller.abort(reason);
      let cleaned = false;
      const cleanup = Promise.all(hooks.map(hook => hook())).then(() => { cleaned = true; });
      await Promise.resolve(); assert.equal(cleaned, false); await fs.access(directory);
      release.open(); await casPhase(Promise.all([rejected, cleanup]), 'fixture cancellation cleanup');
      assert.deepEqual(lateActions, []);
      assert.ok(events.indexOf('initialization settled') < events.indexOf('directory removed'));
      await assert.rejects(fs.access(directory), { code: 'ENOENT' });
    } finally {
      controller.abort(reason); release.open();
      await casPhase(Promise.allSettled([fixture, ...hooks.map(hook => hook())]), 'fixture regression settled');
      if (directory) await original.rm(directory, { recursive: true, force: true });
    }
  });
}

test('fixture cleans its acquired directory when canonicalization fails', async t => {
  const hooks: Array<() => Promise<void>> = [], failure = new Error('realpath failed');
  const context = { signal: t.signal, after: (cleanup: () => Promise<void>) => { hooks.push(cleanup); } } as unknown as TestContext;
  const mkdtemp = fs.mkdtemp, realpath = fs.realpath; let directory = '';
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { const value = await mkdtemp(...args); directory = String(value); return value; });
  t.mock.method(fs, 'realpath', async (...args: Parameters<typeof fs.realpath>) => { if (String(args[0]) === directory) throw failure; return realpath(...args); });
  try {
    await assert.rejects(businessFixture(context), error => error === failure);
    await Promise.all(hooks.map(hook => hook()));
    await assert.rejects(fs.access(directory), { code: 'ENOENT' });
  } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
});

test('fixture attempts independent cleanups after a consumer close fails and retains its directory', async t => {
  const hooks: Array<() => Promise<void>> = [], failure = new Error('consumer did not close');
  const context = { signal: t.signal, after: (cleanup: () => Promise<void>) => { hooks.push(cleanup); } } as unknown as TestContext;
  const f = await businessFixture(context, {}), closed: string[] = [];
  f.beforeCleanup(async () => { closed.push('first'); throw failure; });
  f.beforeCleanup(async () => { closed.push('second'); });
  try {
    await assert.rejects(hooks[0](), error => error instanceof AggregateError && error.errors[0] === failure);
    assert.deepEqual(closed, ['first', 'second']);
    await fs.access(f.directory);
  } finally { await fs.rm(f.directory, { recursive: true, force: true }); }
});
