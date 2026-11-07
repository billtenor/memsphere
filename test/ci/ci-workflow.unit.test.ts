import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { ciProfile, createCiPlan } from '../../scripts/ci/ci-plan.mjs';
import { selectTests } from '../../scripts/ci/test-plan.mjs';
const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const files = ['memory.unit.test.ts', 'nested/new.unit.test.ts', 'business.module.test.ts', 'future/business.module.test.ts', 'platform/process/future-native.test.ts', 'platform/filesystem/future-paths.test.ts', 'domain.test.ts', 'browser.test.ts'];
const sources = Object.fromEntries(files.map(file => [file, file === 'browser.test.ts' ? 'helpers/browser' : '']));
const systems = ['ubuntu-24.04','macos-latest','windows-latest'];

test('every profile runs every unit on all systems without mixing integration into a unit job', () => {
  for (const profile of ['default', 'full']) {
    const rows = createCiPlan(profile, files, sources).include.filter(row => row.layer === 'unit');
    assert.deepEqual(rows.map(row => row.os), systems);
    for (const row of rows) {
      assert.equal(row.suite,'unit');assert.equal(row.browser,false);
      assert.deepEqual(selectTests(files,sources,row.suite),['memory.unit.test.ts','nested/new.unit.test.ts']);
    }
  }
  assert.throws(()=>createCiPlan('default',['integration.test.ts'],{'integration.test.ts':''}),/No unit tests/);
});

test('default runs portable integration on Linux and native contracts on all systems', () => {
  const rows=createCiPlan('default',files,sources).include;
  for (const os of systems) {
    const integration=rows.filter(row=>row.os===os&&row.layer==='integration').flatMap(row=>selectTests(files,sources,row.suite));
    const expected=os==='ubuntu-24.04'?files.filter(file=>!file.endsWith('.unit.test.ts')&&!file.endsWith('.module.test.ts')):files.filter(file=>file.startsWith('platform/'));
    assert.deepEqual(integration.sort(),expected.sort());
  }
});

test('full assigns every discovered unit and integration file exactly once per system', () => {
  for (const os of systems) {
    const assigned=createCiPlan('full',files,sources).include.filter(row=>row.os===os).flatMap(row=>selectTests(files,sources,row.suite));
    assert.deepEqual(assigned.sort(),[...files].sort());
  }
  assert.throws(()=>createCiPlan('full',[...files,'platform/unowned/new.test.ts'],{...sources,'platform/unowned/new.test.ts':''}),/Unassigned or duplicate/);
});

test('unit and integration jobs are separate, retain five-minute limits and build before execution', () => {
  for (const name of ['unit-tests','module-tests','integration-tests','windows-package-smoke','full-result'])assert.equal(workflow.jobs[name]['timeout-minutes'],5);
  const unit=workflow.jobs['unit-tests'],integration=workflow.jobs['integration-tests'];
  assert.equal(unit.strategy.matrix,'${{ fromJSON(needs.plan.outputs.unit_matrix) }}');
  assert.equal(integration.strategy.matrix,'${{ fromJSON(needs.plan.outputs.integration_matrix) }}');
  assert(unit.steps.some(step=>step.run==='npm run test:ci -- --suite=unit'));
  assert(!unit.steps.some(step=>step.run?.includes('playwright install')));
  assert(integration.steps.some(step=>step.run==='npm run test:ci -- --suite=${{ matrix.suite }}'));
  assert(integration.steps.some(step=>step.run==='npx playwright install chromium'&&step.if==='matrix.browser'));
  assert.deepEqual(workflow.jobs['full-result'].needs,['plan','unit-tests','module-tests','integration-tests','windows-package-smoke']);
  assert.equal(workflow.jobs['full-result'].name,'Full cross-platform regression');
  const result=workflow.jobs['full-result'].steps.at(-1);
  for(const name of ['UNIT_RESULT','MODULE_RESULT','INTEGRATION_RESULT','PACKAGE_RESULT'])assert(result.run.includes(`test "$${name}" = success`));
});

test('CI keeps PR cancellation separate from master and manual full histories', () => {
  assert.equal(ciProfile('pull_request','full'),'default');assert.equal(ciProfile('push'),'full');
  assert.equal(ciProfile('workflow_dispatch','full'),'full');assert.throws(()=>ciProfile('workflow_dispatch','unknown'),/Unknown CI profile/);
  assert.deepEqual(workflow.on.push.branches,['master']);assert.match(workflow.concurrency['cancel-in-progress'],/github.event_name != 'push'/);
  assert.equal(workflow.jobs['full-result'].if,"always() && inputs.include_integration == true && needs.plan.outputs.profile == 'full'");
});


test('module jobs run the full second layer on every OS, and deferred integration cannot become full evidence', () => {
  for (const profile of ['default','full']) {
    const rows=createCiPlan(profile,files,sources).include.filter(row=>row.layer==='module');
    assert.deepEqual(rows.map(row=>row.os),systems);
    for (const row of rows) { assert.equal(row.browser,false); assert.deepEqual(selectTests(files,sources,row.suite),['business.module.test.ts','future/business.module.test.ts']); }
  }
  const moduleJob=workflow.jobs['module-tests'];
  assert.equal(moduleJob.strategy.matrix,'${{ fromJSON(needs.plan.outputs.module_matrix) }}');
  assert(moduleJob.steps.some(step=>step.run==='npm run test:ci -- --suite=module'));
  assert(!moduleJob.steps.some(step=>step.run?.includes('playwright install')));
  assert.equal(workflow.on.workflow_dispatch.inputs.include_integration.default,false);
  for(const name of ['integration-tests','windows-package-smoke'])assert.equal(workflow.jobs[name].if,'inputs.include_integration == true');
  assert(workflow['run-name'].includes('CI (unit + module)'));
});
