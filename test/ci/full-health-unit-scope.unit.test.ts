import assert from 'node:assert/strict';
import test from 'node:test';
import { fullEvidence, FULL_JOB, REPOSITORY, WORKFLOW_ID } from '../../scripts/ci/full-health.mjs';
const run = { id: 1, workflow_id: WORKFLOW_ID, repository: {full_name: REPOSITORY}, head_branch: 'master', event: 'push', status: 'completed', conclusion: 'success', display_title: 'CI (full)' };
test('full gate requires a full regression summary and cannot borrow unit-only evidence', async () => {
  const api = name => ({ list: async () => [{name, status:'completed', conclusion:'success'}] });
  assert.equal((await fullEvidence(api(FULL_JOB),run)).state, 'success');
  assert.equal((await fullEvidence(api('Cross-platform unit tests'),run)).state, 'failure');
  assert.equal(await fullEvidence(api(FULL_JOB),{...run,display_title:'CI (full · units only)'}),undefined);
});
test('a default PR run cannot be used as completed master full evidence', async () => {
  let reads = 0;
  for (const title of ['CI (default)', 'CI (default · units only)', 'CI (unit + module)', 'CI (unit + module + integration)']) {
    assert.equal(await fullEvidence({list:async()=>{reads++;return [];}},{...run,display_title:title}),undefined);
  }
  assert.equal(reads,0);
});
