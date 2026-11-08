import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { ciProfile, createCiPlan } from '../../scripts/ci/ci-plan.mjs';
import { selectTests } from '../../scripts/ci/test-plan.mjs';
const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const files = ['memory.unit.test.ts', 'nested/new.unit.test.ts', 'business.module.test.ts', 'future/business.module.test.ts', 'platform/process/future-native.integration.test.ts', 'platform/filesystem/future-paths.integration.test.ts', 'domain.integration.test.ts', 'browser.system.test.ts', 'journey.e2e.test.ts'];
const sources = Object.fromEntries(files.map(file => [file, file === 'browser.system.test.ts' ? 'helpers/browser' : '']));
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
    const expected=os==='ubuntu-24.04'?files.filter(file=>file.endsWith('.integration.test.ts')):files.filter(file=>file.startsWith('platform/'));
    assert.deepEqual(integration.sort(),expected.sort());
  }
});

test('full assigns every discovered layer exactly once per system', () => {
  for (const os of systems) {
    const assigned=createCiPlan('full',files,sources).include.filter(row=>row.os===os).flatMap(row=>selectTests(files,sources,row.suite));
    assert.deepEqual(assigned.sort(),[...files].sort());
  }
  assert.throws(()=>createCiPlan('full',[...files,'platform/unowned/new.integration.test.ts'],{...sources,'platform/unowned/new.integration.test.ts':''}),/Unassigned or duplicate/);
});

test('unit and integration jobs are separate and retain their configured execution limits', () => {
  for (const name of ['unit-tests','module-tests','full-result'])assert.equal(workflow.jobs[name]['timeout-minutes'],5);
  const unit=workflow.jobs['unit-tests'],integration=workflow.jobs['integration-tests'];
  assert.equal(integration['timeout-minutes'],'${{ matrix.timeoutMinutes }}');
  assert.equal(unit.strategy.matrix,'${{ fromJSON(needs.plan.outputs.unit_matrix) }}');
  assert.equal(integration.strategy.matrix,'${{ fromJSON(needs.plan.outputs.integration_matrix) }}');
  assert(unit.steps.some(step=>step.run==='npm run test:ci -- --suite=unit'));
  assert(!unit.steps.some(step=>step.run?.includes('playwright install')));
  assert(integration.steps.some(step=>step.run==='npm run test:ci -- --suite=${{ matrix.suite }}'));
  assert(integration.steps.some(step=>step.run==='npx playwright install chromium'&&step.if==='matrix.browser'));
  assert.deepEqual(workflow.jobs['full-result'].needs,['plan','unit-tests','module-tests','integration-tests','system-tests','windows-package-smoke']);
  assert.equal(workflow.jobs['full-result'].name,'Full cross-platform regression');
  const result=workflow.jobs['full-result'].steps.at(-1);
  for(const name of ['UNIT_RESULT','MODULE_RESULT','INTEGRATION_RESULT','SYSTEM_RESULT','PACKAGE_RESULT'])assert(result.run.includes(`test "$${name}" = success`));
});

test('CI keeps PR cancellation separate from master and manual full histories', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.profile.default,'default');
  assert.equal(ciProfile('pull_request','full'),'default');assert.equal(ciProfile('push'),'full');
  assert.equal(ciProfile('workflow_dispatch','full'),'full');assert.throws(()=>ciProfile('workflow_dispatch','unknown'),/Unknown CI profile/);
  assert.deepEqual(workflow.on.push.branches,['master']);assert.match(workflow.concurrency['cancel-in-progress'],/github.event_name != 'push'/);
  assert.equal(workflow.jobs['full-result'].if,"always() && needs.plan.outputs.profile == 'full'");
});


test('module jobs run the full second layer on every OS, and full evidence requires all built layers', () => {
  for (const profile of ['default','full']) {
    const rows=createCiPlan(profile,files,sources).include.filter(row=>row.layer==='module');
    assert.deepEqual(rows.map(row=>row.os),systems);
    for (const row of rows) { assert.equal(row.browser,false); assert.deepEqual(selectTests(files,sources,row.suite),['business.module.test.ts','future/business.module.test.ts']); }
  }
  const moduleJob=workflow.jobs['module-tests'];
  assert.equal(moduleJob.strategy.matrix,'${{ fromJSON(needs.plan.outputs.module_matrix) }}');
  assert(moduleJob.steps.some(step=>step.run==='npm run test:ci -- --suite=module'));
  assert(!moduleJob.steps.some(step=>step.run?.includes('playwright install')));
  assert.equal(workflow.jobs['integration-tests'].if,undefined);
  assert.equal(workflow.jobs['windows-package-smoke'].if,"needs.plan.outputs.profile == 'full'");
  assert.equal(workflow.jobs['full-result'].if,"always() && needs.plan.outputs.profile == 'full'");
  assert(workflow['run-name'].includes('CI (default)'));
  assert(workflow['run-name'].includes('CI (full)'));
});


test('default excludes system and end-to-end tests while full runs every file once per OS', () => {
  assert.throws(()=>createCiPlan('default',[...files,'unclassified.test.ts'],{...sources,'unclassified.test.ts':''}),/explicit layer suffix/);
  const systemFiles=['browser.system.test.ts','platform/process/cli.system.test.ts'];
  const rootNative='model-storage.integration.test.ts';
  const discovered=[...files,...systemFiles.slice(1),rootNative];
  const texts={...sources,'platform/process/cli.system.test.ts':'', [rootNative]:'// @integration-platform: native'};
  for(const profile of ['default','full'])for(const os of systems){
    const assigned=createCiPlan(profile,discovered,texts).include.filter(row=>row.os===os).flatMap(row=>selectTests(discovered,texts,row.suite));
    assert(assigned.includes(rootNative));
    for(const file of [...systemFiles,'journey.e2e.test.ts'])assert.equal(assigned.filter(f=>f===file).length,profile==='full'?1:0);
  }
  assert.deepEqual(selectTests(discovered,texts,'system').sort(),systemFiles.sort());
  assert(!selectTests(discovered,texts,'regression').some(file=>systemFiles.includes(file)||file.endsWith('.e2e.test.ts')));
  assert.deepEqual(selectTests(discovered,texts,'e2e'),['journey.e2e.test.ts']);
});


test('full-only system and packaged tests have thirty-minute deadlines', () => {
  for(const name of ['system-tests','windows-package-smoke'])assert.equal(workflow.jobs[name]['timeout-minutes'],30);
  const job=workflow.jobs['system-tests'];
  assert.equal(job.strategy.matrix,'${{ fromJSON(needs.plan.outputs.system_matrix) }}');
  assert.equal(job.if,"needs.plan.outputs.profile == 'full'");
  assert(job.steps.some(step=>step.run==='npm run test:ci -- --suite=${{ matrix.suite }}'));
  assert(job.steps.some(step=>step.run==='npx playwright install chromium'&&step.if==='matrix.browser'));
  for(const profile of ['default','full']){
    const rows=createCiPlan(profile,files,sources).include.filter(row=>row.layer==='system');
    assert.deepEqual(rows.map(row=>row.os),profile==='full'?systems:[]);
    for(const row of rows){assert.equal(row.suite,'system');assert.equal(row.browser,true);assert.deepEqual(selectTests(files,sources,row.suite),['browser.system.test.ts']);}
  }
});


test('full retains five minutes for every default platform/suite and grants thirty only to additional jobs', () => {
  const defaults=createCiPlan('default',files,sources).include;
  const full=createCiPlan('full',files,sources).include;
  const regular=new Set(defaults.map(row=>`${row.os}/${row.suite}`));
  for(const row of defaults) assert.equal(row.timeoutMinutes,5);
  for(const row of full) assert.equal(row.timeoutMinutes,regular.has(`${row.os}/${row.suite}`)?5:30,`${row.os}/${row.suite}`);
  for(const os of systems){
    const native=full.filter(row=>row.os===os&&row.suite.startsWith('platform-'));
    assert(native.length>0);for(const row of native)assert.equal(row.timeoutMinutes,5);
    const portable=full.filter(row=>row.os===os&&row.suite.startsWith('integration-'));
    assert(portable.length>0);for(const row of portable)assert.equal(row.timeoutMinutes,os==='ubuntu-24.04'?5:30);
    for(const row of full.filter(row=>row.os===os&&['system','e2e'].includes(row.layer)))assert.equal(row.timeoutMinutes,30);
  }
});

test('full discovers future end-to-end tests without generating empty suites', () => {
  const withoutE2e=files.filter(file=>!file.endsWith('.e2e.test.ts'));
  assert(!createCiPlan('full',withoutE2e,sources).include.some(row=>row.layer==='e2e'));
  const rows=createCiPlan('full',files,sources).include.filter(row=>row.layer==='e2e');
  assert.deepEqual(rows.map(row=>row.os),systems);
  for(const row of rows)assert.deepEqual(selectTests(files,sources,row.suite),['journey.e2e.test.ts']);
});
