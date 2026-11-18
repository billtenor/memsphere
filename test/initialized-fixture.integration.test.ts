import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs/promises";
import { basename } from "node:path";
import { initializedContextFixture, initializedModelFixture } from "./helpers/initialized-context.js";
import { casPhase } from "./support/tos-cas-barrier.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
function scope() {
  const controller = new AbortController(), hooks: Array<() => Promise<void>> = [];
  const context = { signal: controller.signal, after: (cleanup: () => Promise<void>) => { hooks.push(cleanup); } } as unknown as TestContext;
  return { controller, context, cleanup: () => Promise.all(hooks.map(hook => hook())) };
}

test('both extended fixtures settle shared baseline waiting before removing their targets', { timeout: 30000 }, async t => {
  const context = scope(), model = scope(), entered = gate(), release = gate(), modelPrepared = gate();
  const mkdtemp = fs.mkdtemp, cp = fs.cp, rm = fs.rm, writeFile = fs.writeFile;
  const directories: string[] = []; let copies = 0, calls = 0, contextDone = false, modelDone = false;
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => {
    const value = await mkdtemp(...args); directories.push(String(value));
    if (++calls === 2) { entered.open(); await release.promise; }
    return value;
  });
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    const result = await writeFile(...args);
    if (directories[2] && String(args[0]).includes(basename(directories[2])) && /[\\/]home[\\/]registry.json$/.test(String(args[0]))) modelPrepared.open();
    return result;
  });
  t.mock.method(fs, 'cp', async (...args: Parameters<typeof fs.cp>) => { copies++; return cp(...args); });
  t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
    const name = basename(String(args[0]));
    if (name === basename(directories[0] ?? '')) assert.equal(contextDone, true);
    if (name === basename(directories[2] ?? '')) assert.equal(modelDone, true);
    return rm(...args);
  });
  const first = initializedContextFixture(context.context), firstSettled = first.then(() => { contextDone = true; }, () => { contextDone = true; });
  let second: ReturnType<typeof initializedModelFixture> | undefined;
  const reason = new Error('cancel extended preparation');
  try {
    await casPhase(entered.promise, 'baseline held');
    second = initializedModelFixture(model.context, {});
    const secondSettled = second.then(() => { modelDone = true; }, () => { modelDone = true; });
    await casPhase(modelPrepared.promise, 'model filesystem prepared');
    // No filesystem work remains before the model joins the held baseline.
    await new Promise<void>(resolve => setImmediate(resolve));
    context.controller.abort(reason); model.controller.abort(reason);
    let cleaned = false;
    const cleanup = Promise.all([context.cleanup(), model.cleanup()]).then(() => { cleaned = true; });
    await Promise.resolve(); assert.equal(cleaned, false);
    release.open();
    await casPhase(Promise.all([firstSettled, secondSettled, cleanup]), 'extended baseline cancellation');
    await assert.rejects(first, error => error === reason); await assert.rejects(second, error => error === reason);
    assert.equal(copies, 0);
    await assert.rejects(fs.access(directories[0]), { code: 'ENOENT' });
    await assert.rejects(fs.access(directories[2]), { code: 'ENOENT' });
  } finally {
    context.controller.abort(reason); model.controller.abort(reason); release.open();
    await casPhase(Promise.allSettled([first, second]), 'extended preparations settled');
    await Promise.all([context.cleanup(), model.cleanup()]);
  }
});

for (const [name, initialize] of [['context', initializedContextFixture], ['model', initializedModelFixture]] as const) {
  test(`${name} fixture waits an in-flight copy and starts no next copy after cancellation`, { timeout: 30000 }, async t => {
    const owner = scope(), entered = gate(), release = gate(), reason = new Error('cancel copy');
    const cp = fs.cp, rm = fs.rm; let directory = '', copies = 0, settled = false, copied = false;
    t.mock.method(fs, 'cp', async (...args: Parameters<typeof fs.cp>) => {
      copies++; directory = String(args[1]).replace(/[\\/]project[\\/][^\\/]+$/, '');
      entered.open(); await release.promise;
      const result = await cp(...args); copied = true; return result;
    });
    t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
      if (directory && basename(String(args[0])) === basename(directory)) { assert.equal(copied, true); assert.equal(settled, true); }
      return rm(...args);
    });
    const fixture = initialize(owner.context, {}), observed = fixture.then(() => { settled = true; }, () => { settled = true; });
    try {
      await casPhase(entered.promise, 'copy held'); owner.controller.abort(reason);
      let cleaned = false; const cleanup = owner.cleanup().then(() => { cleaned = true; });
      await Promise.resolve(); assert.equal(cleaned, false); await fs.access(directory);
      release.open(); await casPhase(Promise.all([observed, cleanup]), 'copy cancellation cleanup');
      await assert.rejects(fixture, error => error === reason); assert.equal(copies, 1);
      await assert.rejects(fs.access(directory), { code: 'ENOENT' });
    } finally {
      owner.controller.abort(reason); release.open();
      await casPhase(Promise.allSettled([fixture]), 'copy settled'); await owner.cleanup();
    }
  });
}
