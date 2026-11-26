import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { useTosService } from "./support/tos-sdk-service.js";
import { ownedSetup } from "./support/owned-setup.js";
import { readConfigAt } from "../src/config.js";
import { readProjectConfigDocument, editableProjectConfigDraft, writeProjectConfigDraft } from "../src/config-management.js";

test("TOS ValueStore CLI supports JSON operations, CAS, tombstone recreation and timeout changes between pages", { timeout: 30000 }, async t => {
  const f = await businessFixture(t), service = useTosService(t);
  const env = { ...process.env, MEMSPHERE_HOME: f.home, CLI_TOS_AK: 'fake-ak', CLI_TOS_SK: 'fake-sk' };
  const owner = ownedSetup(t.signal, async () => {});
  f.beforeCleanup(owner.stop);
  const run = async (args: string[]) => {
    const result = await owner.acquire(() => invokeCliModule(['--project', 'test-project', 'data', ...args, '--output', 'json'], f.cwd, env, 'memsphere', t.signal));
    return JSON.parse(result.stdout);
  };
  const write = (file: string, value: string) => owner.acquire(() => fs.writeFile(file, value, { signal: t.signal }));
  const path = join(f.directory, 'tos.json'), valueFile = join(f.directory, 'value.json');
  await write(join(f.home, 'config.json'), '{}');
  await write(path, JSON.stringify({ region: 'cn-beijing', endpoint: 'tos-cn-beijing.volces.com', bucket: 'test-bucket', prefix: 'json/', credentials: { source: 'env', accessKeyIdEnv: 'CLI_TOS_AK', accessKeySecretEnv: 'CLI_TOS_SK' } }));
  await run(['store', 'create', 'values', '--kind', 'value', '--factory', 'memsphere/tos-json', '--model', 'record.json', '--config-file', path]);
  assert.equal((await run(['store', 'read', 'values'])).idRule, 'portable relative path; .json is a physical suffix');
  await write(valueFile, JSON.stringify({ name: 'first', count: 1 }));
  const first = await run(['create', 'a', '--store', 'values', '--value-file', valueFile]); assert.equal(typeof first.revision, 'string');
  assert.deepEqual((await run(['read', 'a', '--store', 'values'])).value, { name: 'first', count: 1 });
  await run(['edit', 'a', '--store', 'values', '--patch', '[{"op":"replace","path":"/count","value":2}]', '--expected-revision', first.revision]);
  assert.deepEqual((await run(['read', 'a', '--store', 'values', '--path', '$.count'])).value, [2]);
  await assert.rejects(run(['update', 'a', '--store', 'values', '--value-file', valueFile, '--expected-revision', first.revision]), /REVISION_CONFLICT/);
  await run(['upsert', 'b', '--store', 'values', '--value', '{"name":"second","count":3}']);
  const page = await run(['list', '--store', 'values', '--limit', '1']); assert.ok(page.nextCursor);
  // Real configuration save: timeouts are editable and excluded from both cursor identities.
  await owner.acquire(async () => {
    const priorEnv = { ...process.env };
    try {
      Object.assign(process.env, env);
      const resolved = await owner.acquire(() => readConfigAt(join(f.root, 'config.json')));
      let document = await owner.acquire(() => readProjectConfigDocument(resolved.configPath, resolved));
      let draft = editableProjectConfigDraft(document);
      const connection = draft.dataStores!.values.config as Record<string, unknown>;
      connection.dataTimeoutMs = 200000;
      connection.controlTimeoutMs = 180000;
      const save = () => writeProjectConfigDraft({ document, expectedRevision: document.revision, draft, globalConfigPath: join(f.home, 'config.json') });
      document = await owner.acquire(save);
      assert.equal(document.raw.dataStores!.values.config.controlTimeoutMs, 180000);
      draft = editableProjectConfigDraft(document);
      (draft.dataStores!.values.config as Record<string, unknown>).prefix = 'other/';
      await owner.acquire(() => assert.rejects(save()));
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
      Object.assign(process.env, priorEnv);
    }
  });
  const next = await run(['list', '--store', 'values', '--limit', '1', '--cursor', page.nextCursor]);
  assert.deepEqual([...page.items, ...next.items].map(x => x.id), ['a', 'b']);
  const current = await run(['read', 'a', '--store', 'values']);
  await run(['delete', 'a', '--store', 'values', '--expected-revision', current.revision]);
  assert.equal((await run(['has', 'a', '--store', 'values'])).exists, false);
  await run(['create', 'a', '--store', 'values', '--value-file', valueFile]);
  assert.notEqual((await run(['read', 'a', '--store', 'values'])).revision, current.revision);
  const visibleName = "Line\u0085split\u2028RTL\u202eend";
  await run(["upsert", "display", "--store", "values", "--value", JSON.stringify({ name: visibleName, count: 3 })]);
  for (const language of ["zh-CN", "en"]) {
    await write(join(f.home, "config.json"), JSON.stringify({ language }));
    for (const flags of [[], ["--output", "text"]]) {
      const receipt = await invokeCliModule(["--project", "test-project", "data", "read", "display", "--store", "values", ...flags],
        f.cwd, env, "memsphere", t.signal);
      assert.equal(receipt.stderr, "");
      assert.ok(receipt.stdout.includes("Line\\u0085split\\u2028RTL\\u202eend"));
      assert.ok(!receipt.stdout.includes(visibleName));
    }
  }
  assert.equal((await run(["read", "display", "--store", "values"])).value.name, visibleName);
  await run(['store', 'remove', 'values']); assert.ok(service.objects.has('json/a.json'));
});
