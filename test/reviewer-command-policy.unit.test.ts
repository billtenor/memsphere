import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewerCapabilities, reviewerCommandDefaults, validateReviewerIdentities, type ReviewerIdentities, type ReviewerIdentityOption } from '../src/acp/reviewer-command-policy.js';

const bound: ReviewerIdentities = { project: 'current-project', run: 'run-current', assignment: 'assignment-current' };
const denied = (error: unknown) => (error as { code: string }).code === 'REVIEW_IDENTITY_CONFLICT';

test('each explicit identity and repeated matching occurrences retain the Session identity', () => {
  const identities: ReviewerIdentityOption[] = [['project', ' current-project '], ['run', bound.run], ['assignment', bound.assignment], ['project', bound.project]];
  assert.doesNotThrow(() => validateReviewerIdentities('run artifact show', identities, bound, false));
  assert.deepEqual(bound, { project: 'current-project', run: 'run-current', assignment: 'assignment-current' });
});

for (const key of ['project', 'run', 'assignment'] as const) {
  test(`${key} conflicts cannot be hidden by a later matching occurrence`, () => {
    for (const conflict of ['other', '', undefined, true]) {
      const identities: ReviewerIdentityOption[] = [[key, conflict], [key, bound[key]]];
      assert.throws(() => validateReviewerIdentities('run artifact show', identities, bound, false), denied);
      assert.throws(() => validateReviewerIdentities('run artifact show', identities.toReversed(), bound, false), denied);
    }
    assert.throws(() => validateReviewerIdentities('run artifact show', [[key, bound[key]]], { ...bound, [key]: undefined }, false), denied);
  });
}

test('only Project normalizes surrounding whitespace', () => {
  for (const key of ['run', 'assignment'] as const)
    assert.throws(() => validateReviewerIdentities('run artifact show', [[key, ` ${bound[key]} `]], bound, false), denied);
});

for (const command of ['memory list', 'memory read', 'memory change show']) {
  test(`${command} distinguishes current Project memory from explicitly frozen Run memory`, () => {
    assert.doesNotThrow(() => validateReviewerIdentities(command, [], bound, false));
    assert.throws(() => validateReviewerIdentities(command, [['run', bound.run]], bound, false), denied);
    assert.doesNotThrow(() => validateReviewerIdentities(command, [['run', bound.run]], bound, true));
    assert.throws(() => validateReviewerIdentities(command, [['run', 'other']], bound, true), denied);
    assert.deepEqual(reviewerCommandDefaults(command, {}, bound), {});
    assert.deepEqual(reviewerCommandDefaults(command, { run: bound.run }, bound), {});
  });
}

for (const command of ['run artifact show', 'run artifact contract show']) {
  test(`${command} never mixes a fixed Artifact/Step/Run selector with default Assignment lookup`, () => {
    assert.deepEqual(reviewerCommandDefaults(command, {}, bound), { assignment: bound.assignment });
    for (const options of [{ artifact: 'artifact-fixed' }, { step: 'step-fixed' }, { run: bound.run }, { run: bound.run, artifact: 'artifact-fixed' }])
      assert.deepEqual(reviewerCommandDefaults(command, options, bound), {});
    assert.deepEqual(reviewerCommandDefaults(command, { assignment: bound.assignment }, bound), { assignment: bound.assignment });
  });
}

for (const command of ['run show', 'run step show', 'run external show']) {
  test(`${command} supplies the Session Run only when omitted`, () => {
    assert.deepEqual(reviewerCommandDefaults(command, {}, bound), { run: bound.run });
    assert.deepEqual(reviewerCommandDefaults(command, { run: bound.run }, bound), {});
  });
}

test('native Review mutations bind Assignment; submitted confirmation reads keep their own target', () => {
  for (const command of ['run review assignment show', 'run review comment', 'run review comment add', 'run review comment update', 'run review comment delete', 'run review report', 'run review update', 'run review submit'])
    assert.deepEqual(reviewerCommandDefaults(command, {}, bound), { assignment: bound.assignment });
  for (const command of ['run review show', 'run review list', 'continue'])
    assert.deepEqual(reviewerCommandDefaults(command, {}, bound), {});
});

test('protocol capabilities expose fixed External reads only for graph and never expose Runner production commands', () => {
  for (const protocol of ['graph', 'flow'] as const) {
    const capabilities = reviewerCapabilities(protocol);
    assert.equal(capabilities.protocol, protocol);
    assert.equal(capabilities.commands.includes('run external show'), protocol === 'graph');
    assert.ok(capabilities.commands.includes('run artifact show'));
    assert.ok(capabilities.commands.includes('memory read'));
    for (const write of ['run report', 'run external add', 'memory edit', 'run review vote'])
      assert.ok(!capabilities.commands.some(command => command === write));
  }
});
