import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readConfig } from '../../../src/config.js';
import { withConfigReadScope } from '../../../src/config-read-scope.js';
import { runGit } from '../../../src/git.js';
import { businessFixture } from '../../helpers/business-data.js';

test('Embedded command configuration resolves real Git identity once and refreshes on the next command', async t => {
  const f = await businessFixture(t, {});
  await runGit(['init', '-b', 'master'], { cwd: f.root });
  await runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'Configuration fixture'], { cwd: f.root });
  const configPath = join(f.root, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.store = { type: 'embedded', repository_path: f.root, memory_path: 'memory' };
  await writeFile(configPath, JSON.stringify(config));
  const keys = ['MEMSPHERE_HOME', 'MEMSPHERE_CONFIG_PATH', 'MEMSPHERE_REVIEW_ASSIGNMENT_ID', 'MEMSPHERE_REVIEW_SOURCE_WORKSPACE', 'GIT_TRACE2_EVENT'] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: configPath, MEMSPHERE_REVIEW_ASSIGNMENT_ID: 'fixture', MEMSPHERE_REVIEW_SOURCE_WORKSPACE: f.root });
  try {
    const ordinaryTrace = join(f.directory, 'ordinary-git.json');
    process.env.GIT_TRACE2_EVENT = ordinaryTrace;
    await readConfig(configPath);
    await readConfig('');
    const scopedTrace = join(f.directory, 'scoped-git.json');
    process.env.GIT_TRACE2_EVENT = scopedTrace;
    await withConfigReadScope(async () => {
      const [first, repeated] = await Promise.all([readConfig(configPath), readConfig()]);
      assert.equal(first, repeated);
      assert.equal(first.memoryRoot, join(f.root, 'memory'));
    });
    const starts = async (path: string) => (await readFile(path, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(event => event.event === 'start').length;
    const ordinary = await starts(ordinaryTrace), scoped = await starts(scopedTrace);
    assert.ok(scoped > 0, 'the adapter must execute real Git identity checks');
    assert.equal(ordinary, scoped * 2, 'one command deduplicates the complete Git resolution, not its identity checks');
    t.diagnostic(`Git starts: two unscoped config reads=${ordinary}; two command-scoped reads=${scoped}`);
    config.modelsDirectory = 'models/updated';
    await writeFile(configPath, JSON.stringify(config));
    await withConfigReadScope(async () => assert.equal((await readConfig(configPath)).modelsDirectory, join(f.root, 'models/updated')));
  } finally {
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
});
