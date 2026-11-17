import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { browserScope } from "./helpers/browser.js";
import { useTosService } from "./support/tos-sdk-service.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { readConfigAt } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { openBusinessStore } from "../src/project/business-stores.js";
import { casPhase } from "./support/tos-cas-barrier.js";
import { ownedSetup } from "./support/owned-setup.js";

// Journey scope: real View/CLI/config/Store, external TOS service substituted.
// Official SDK HTTP serialization has separate integration coverage.
test('View binds ValueStore, independent CLI manages values, CAS conflict fails and View unbind retains cloud data', { timeout: 30000 }, async t => {
  const f = await businessFixture(t), service = useTosService(t), prior = { ...process.env };
  const env = { ...prior, MEMSPHERE_HOME: f.home, UI_TOS_AK: 'fake-ak', UI_TOS_SK: 'fake-sk' };
  let server: ReturnType<typeof createViewServer> | undefined;
  let browser: Awaited<ReturnType<typeof browserScope>> | undefined;
  const requests = new Set<Promise<unknown>>();
  let pendingCli: Promise<unknown> | undefined, pendingRace: Promise<unknown> | undefined, pendingJourney: Promise<void> | undefined;
  let releaseRace = () => {};
  const restoreEnvironment = () => {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  };
  const setup = ownedSetup(t.signal, async () => {
    releaseRace();
    try { await browser?.close(); }
    finally {
      await Promise.allSettled([pendingCli, pendingRace, pendingJourney]);
      if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
      await Promise.allSettled([...requests]);
    }
  });
  const stop = setup.stop;
  // Register before changing env or acquiring any server/browser resources.
  f.beforeCleanup(async () => { try { await stop(); } finally { restoreEnvironment(); } });
  const onAbort = () => { releaseRace(); void stop().catch(() => {}); };
  t.signal.addEventListener('abort', onAbort, { once: true });
  try {
    setup.check(); Object.assign(process.env, env);
    await setup.acquire(() => writeFile(join(f.home, 'config.json'), '{}'));
    const config = await setup.acquire(() => readConfigAt(join(f.root, 'config.json')));
    setup.check();
    server = createViewServer(config); const ownedServer = server;
    const handler = ownedServer.listeners('request')[0]!;
    ownedServer.removeListener('request', handler); ownedServer.on('request', (req, res) => { const work = Promise.resolve(handler.call(ownedServer, req, res)); requests.add(work); void work.then(() => requests.delete(work), () => requests.delete(work)); });
    const ownedBrowser = await setup.acquire(browserScope, value => { browser = value; });
    await setup.acquire(() => new Promise<void>((resolve, reject) => {
      ownedServer.once('error', reject);
      ownedServer.listen(0, '127.0.0.1', () => { ownedServer.off('error', reject); resolve(); });
    }));
    const origin = `http://127.0.0.1:${(ownedServer.address() as import('node:net').AddressInfo).port}`;
    const page = await setup.acquire(() => ownedBrowser.newPage({ viewport: { width: 1200, height: 900 } }));
    setup.check(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const run = async (args: string[]) => { setup.check(); const work = invokeCliModule(['--project', 'test-project', 'data', ...args, '--output', 'json'], f.cwd, env, 'memsphere'); pendingCli = work; const result = await work; setup.check(); return JSON.parse(result.stdout); };
    const select = async (path: string, label: string) => { await page.locator(`[data-select-field="${path}"]`).click(); await page.getByRole('option', { name: label, exact: true }).click(); };
    const save = async () => { await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '确认保存', exact: true }).click(); await page.getByText('配置已保存并生效。', { exact: true }).waitFor(); };
    pendingJourney = (async () => {
      setup.check(); await page.goto(`${origin}/projects/test-project/settings/stores`); await page.getByRole('button', { name: '新增 TOS Store', exact: true }).click();
      await select('tosDraft.kind', 'ValueStore'); assert.equal(await page.locator('[data-select-field="tosDraft.mode"]').count(), 0);
      for (const [key, value] of Object.entries({ id: 'values', model: 'record.json', bucket: 'test-bucket', prefix: 'journey/', dataTimeoutMs: '240000', controlTimeoutMs: '180000' })) await page.locator(`[data-field="tosDraft.${key}"]`).fill(value);
      await select('tosDraft.credentials.source', '环境变量');
      await page.locator('[data-field="tosDraft.credentials.accessKeyIdEnv"]').fill('UI_TOS_AK'); await page.locator('[data-field="tosDraft.credentials.accessKeySecretEnv"]').fill('UI_TOS_SK');
      await page.getByRole('button', { name: '添加存储', exact: true }).click(); await save(); await page.reload();
      const row = page.locator('details[data-business-store="values"]'); await row.waitFor({ state: 'attached' });
      await row.locator('..').getByRole('button', { name: '配置', exact: true }).click();
      assert.equal(await page.locator('[data-field="tosTimeout.values.dataTimeoutMs"]').inputValue(), '240000');
      await page.locator('[data-field="tosTimeout.values.dataTimeoutMs"]').fill(''); await save(); await page.reload();
      await row.waitFor({ state: 'attached' }); await row.locator('..').getByRole('button', { name: '配置', exact: true }).click();
      assert.equal(await page.locator('[data-field="tosTimeout.values.dataTimeoutMs"]').inputValue(), '');
      const first = await run(['create', 'item', '--store', 'values', '--value', '{"name":"first","count":1}']);
      const second = await run(['update', 'item', '--store', 'values', '--value', '{"name":"second","count":2}', '--expected-revision', first.revision]);
      await assert.rejects(run(['update', 'item', '--store', 'values', '--value', '{"name":"stale","count":0}', '--expected-revision', first.revision]), /REVISION_CONFLICT/);
      assert.deepEqual((await run(['read', 'item', '--store', 'values'])).value, { name: 'second', count: 2 });
      setup.check();
      const a = (await openBusinessStore({ signal: t.signal }, f.root, 'values')).store, b = (await openBusinessStore({ signal: t.signal }, f.root, 'values')).store;
      assert.equal(a.kind, 'ValueStore'); assert.equal(b.kind, 'ValueStore');
      if (a.kind !== 'ValueStore' || b.kind !== 'ValueStore') throw Error('Wrong Store kind');
      setup.check();
      let release!: () => void, ready!: () => void, arrived = 0; const gate = new Promise<void>(r => release = r), both = new Promise<void>(r => ready = r);
      const raceController = new AbortController();
      releaseRace = () => { raceController.abort(); release(); };
      let failPreparation!: (error: unknown) => void;
      const premature = new Promise<never>((_, reject) => failPreparation = reject);
      const raceContext = { signal: AbortSignal.any([t.signal, raceController.signal]) };
      service.beforeCommit = async () => { if (++arrived === 2) ready(); await gate; };
      const writes = [a.update(raceContext, 'item', { name: 'A', count: 3 }, { expectedRevision: second.revision }), b.update(raceContext, 'item', { name: 'B', count: 4 }, { expectedRevision: second.revision })].map(write => write.catch(error => { if (arrived < 2) failPreparation(error); throw error; }));
      const race = Promise.allSettled(writes);
      pendingRace = race;
      await casPhase(Promise.race([both, premature]), 'journey original writes prepared'); release(); const settled = await casPhase(race, 'journey writes settled'); service.beforeCommit = undefined;
      assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1); assert.equal((settled.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.code, 'REVISION_CONFLICT');
      const current = await run(['read', 'item', '--store', 'values']); await run(['delete', 'item', '--store', 'values', '--expected-revision', current.revision]);
      assert.equal((await run(['has', 'item', '--store', 'values'])).exists, false); await run(['create', 'item', '--store', 'values', '--value', '{"name":"recreated","count":5}']);
      assert.notEqual((await run(['read', 'item', '--store', 'values'])).revision, current.revision);
      await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '删除 Store values', exact: true }).click(); await row.waitFor({ state: 'attached' });
      page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除 Store values', exact: true }).click(); await save();
      assert.ok(service.objects.has('journey/item.json')); assert.equal(JSON.parse(service.objects.get('journey/item.json')!.bytes.toString()).value.name, 'recreated'); assert.deepEqual(errors, []);
    })();
    await pendingJourney;
  } finally {
    t.signal.removeEventListener('abort', onAbort);
    try { await stop(); } finally { restoreEnvironment(); }
  }
});
