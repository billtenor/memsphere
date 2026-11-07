import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { ciProfile, createCiPlan } from '../../scripts/ci/ci-plan.mjs';
import { selectTests } from '../../scripts/ci/test-plan.mjs';
const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8'));

test('default and full CI dispatch every unit file once on Linux, macOS and Windows', () => {
  const files = ['memory.unit.test.ts', 'nested/new.unit.test.ts', 'daemon-integration.test.ts', 'browser.test.ts'];
  const sources = Object.fromEntries(files.map(file => [file, '']));
  for (const profile of ['default', 'full']) {
    const rows = createCiPlan(profile, files, sources).include;
    assert.deepEqual(rows.map(row => row.os), ['ubuntu-24.04', 'macos-latest', 'windows-latest']);
    for (const row of rows) {
      assert.equal(row.suite, 'unit');
      assert.deepEqual(selectTests(files, sources, row.suite), ['memory.unit.test.ts', 'nested/new.unit.test.ts']);
      assert.equal(row.browser, undefined);
    }
  }
  assert.throws(() => createCiPlan('default', ['integration.test.ts'], {'integration.test.ts':''}), /No unit tests/);
});

test('unit-only CI has no integration or packaged smoke job and keeps a five-minute limit', () => {
  assert.equal(workflow.jobs.test['timeout-minutes'], 5);
  assert.equal(workflow.jobs['windows-package-smoke'], undefined);
  const commands = workflow.jobs.test.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /npm run test:ci -- --suite=unit/);
  assert.doesNotMatch(commands, /playwright install|smoke:project|test-concurrency/);
  assert.deepEqual(workflow.jobs['full-result'].needs, ['plan', 'test']);
  assert.equal(workflow.jobs['full-result'].name, 'Cross-platform unit tests');
  assert.equal(workflow.jobs['full-result']['timeout-minutes'], 5);
  assert.match(workflow.on.workflow_dispatch.inputs.profile.description, /integration tests temporarily paused/);
});

test('CI keeps PR cancellation separate from master and manual full histories', () => {
  assert.equal(ciProfile('pull_request', 'full'), 'default');
  assert.equal(ciProfile('push'), 'full');
  assert.equal(ciProfile('workflow_dispatch', 'full'), 'full');
  assert.throws(() => ciProfile('workflow_dispatch', 'unknown'), /Unknown CI profile/);
  assert.deepEqual(workflow.on.push.branches, ['master']);
  assert.match(workflow.concurrency['cancel-in-progress'], /github.event_name != 'push'/);
  assert.equal(workflow.jobs['full-result'].if, "always() && needs.plan.outputs.profile == 'full'");
});
