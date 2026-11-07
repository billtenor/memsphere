import assert from 'node:assert/strict';
import test from 'node:test';
import { fullEvidence, FULL_JOB, REPOSITORY, WORKFLOW_ID } from '../../scripts/ci/full-health.mjs';
const run = { id: 1, workflow_id: WORKFLOW_ID, repository: {full_name: REPOSITORY}, head_branch: 'master', event: 'push', status: 'completed', conclusion: 'success', display_title: 'CI (full · units only)' };
test('unit-only gate requires the new unit summary and cannot borrow a historical full job', async () => {
  const api = name => ({ list: async () => [{name, status:'completed', conclusion:'success'}] });
  assert.equal((await fullEvidence(api(FULL_JOB),run)).state, 'success');
  assert.equal((await fullEvidence(api('Full cross-platform regression'),run)).state, 'failure');
  assert.equal((await fullEvidence(api('Full cross-platform regression'),{...run,display_title:'CI (full)'})).state, 'success');
});
test('a unit-only PR default run cannot be used as completed master evidence', async () => {
  let reads = 0;
  assert.equal(await fullEvidence({list:async()=>{reads++;return [];}},{...run,display_title:'CI (default · units only)'}),undefined);
  assert.equal(reads,0);
});
