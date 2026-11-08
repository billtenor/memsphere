import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedConfigRead, withConfigReadScope } from '../src/config-read-scope.js';

test('ordinary reads remain fresh without an invocation scope', async () => {
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await scopedConfigRead('project', load), 1);
  assert.equal(await scopedConfigRead('project', load), 2);
});

test('one command deduplicates concurrent configuration reads and separates keys', async () => {
  let calls = 0;
  await withConfigReadScope(async () => {
    const load = async () => ++calls;
    assert.deepEqual(await Promise.all([scopedConfigRead('A', load), scopedConfigRead('A', load)]), [1, 1]);
    assert.equal(await scopedConfigRead('B', load), 2);
    assert.equal(await scopedConfigRead('A', load), 1);
  });
  assert.equal(calls, 2);
});

test('later and nested commands get independent snapshots', async () => {
  let version = 1;
  const load = async () => version;
  await withConfigReadScope(async () => {
    assert.equal(await scopedConfigRead('A', load), 1);
    version = 2;
    await withConfigReadScope(async () => assert.equal(await scopedConfigRead('A', load), 2));
    assert.equal(await scopedConfigRead('A', load), 1);
  });
  await withConfigReadScope(async () => assert.equal(await scopedConfigRead('A', load), 2));
});

test('concurrent commands cannot share each other\'s configuration', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = withConfigReadScope(async () => {
    assert.equal(await scopedConfigRead('A', async () => 'first'), 'first');
    await gate;
    assert.equal(await scopedConfigRead('A', async () => 'wrong'), 'first');
  });
  await withConfigReadScope(async () => assert.equal(await scopedConfigRead('A', async () => 'second'), 'second'));
  release();
  await first;
});

test('failed loads stay failed in that command and do not poison later commands', async () => {
  let calls = 0;
  const problem = new Error('invalid configuration');
  await withConfigReadScope(async () => {
    const load = async () => { calls++; throw problem; };
    await assert.rejects(scopedConfigRead('A', load), error => error === problem);
    await assert.rejects(scopedConfigRead('A', load), error => error === problem);
  });
  assert.equal(calls, 1);
  await withConfigReadScope(async () => assert.equal(await scopedConfigRead('A', async () => 'repaired'), 'repaired'));
});
