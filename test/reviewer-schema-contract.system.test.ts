import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { invokeCliModule } from './helpers/cli-module.js';
import { openContextControl } from '../src/project/context-control.js';
import { graphMemorySyntax } from '../src/memory/syntax.js';
import { serializeMemoryYaml } from '../src/memory/serializer.js';
import type { GraphAction, GraphProcedureMemory } from '../src/memory/ast.js';
import * as reviews from '../src/context_control/review-repository.js';
import { buildArtifactReviewerPrompt } from '../src/acp/prompt.js';

// The actual assembled CLI runs with a persisted restricted Assignment. The
// Schema contract is the boundary under test; native launcher/process coverage
// remains in reviewer-session-integration and reviewer-legacy-session suites.
async function schemaReview(t: test.TestContext) {
  const f = await initializedContextFixture(t), service = (await openContextControl(f.root))!;
  const ids = ['upstream', 'candidate', 'unrelated'];
  const schema = (id: string) => `!schema\nsyntax: ${graphMemorySyntax}\nnames: [${id}]\ndefines: [${id} frozen definition]\ntype: object\nfields: [summary]\nasserts: [${id} frozen requirement]\n`;
  const memories = Object.fromEntries(ids.map(id => [`schemas/${id}`, { memoryRef: `schemas/${id}`, payload: { contentType: 'application/yaml', content: schema(id) } }]));
  const actions: GraphAction[] = ids.map(id => ({ tag: '!action', id, description: id,
    dependencies: [{ tag: '!dependency', from: id === 'candidate' ? 'upstream' : 'START' }],
    artifact: { name: id, model: { definedBy: 'memsphere/schema.json', ref: `schemas/${id}` }, payload: { contentType: 'application/json' }, ...(id === 'candidate' ? { review: ['reader'] } : {}) } }));
  const p: GraphProcedureMemory = { tag: '!procedure', syntax: graphMemorySyntax, mode: 'graph', names: ['schema-reader'], defines: ['Frozen contracts'], actions };
  memories['procedures/schema-reader'] = { memoryRef: 'procedures/schema-reader', payload: { contentType: 'application/yaml', content: serializeMemoryYaml(p) } };
  const initial = await service.withGraph(g => g.start({ name: 'Frozen Schema', procedure: p, memorySnapshot: { memories },
    controlPlane: { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { reader: { kind: 'agent', name: 'Reader', permissions: ['artifact.read', 'decision.assess'], agent: { provider: 'test', providerType: 'traex', command: process.execPath, args: [], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: null, maxRuntimeMs: null } } }, acpProviders: {} },
    reviewConfiguration: { reviews: { 'schema-reader#actions[candidate]': { policy: 'artifact_acceptance.unanimous' } }, slots: { 'schema-reader::reader': { actorIds: ['reader'] } } } }));
  const run = initial.run.id;
  const produce = (id: string) => service.withGraph(async g => {
    const step = (await g.snapshot(run)).steps.find(s => s.source?.actionId === id)!;
    await g.enter(run, step.id); return g.report(run, step.id, { text: '{"summary":"fixed"}' });
  });
  const upstream = await produce('upstream'), candidate = await produce('candidate');
  const input = { service, runsRoot: join(f.root, 'runs'), reviewId: reviews.graphReviewHandle(run, candidate.step.id), roundId: candidate.step.reviewRounds![0].id, actorId: 'reader' };
  const claim = (await reviews.claimArtifactReviewAgentAssignment(input))!;
  await mkdir(join(f.root, 'memory', 'schemas'), { recursive: true });
  for (const id of ids) await writeFile(join(f.root, 'memory', 'schemas', `${id}.yaml`), schema(id).replaceAll('frozen', 'CURRENT_PROJECT'));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: join(f.root, 'config.json'), MEMSPHERE_WORKSPACE_ROOT: f.cwd,
    MEMSPHERE_REVIEW_SOURCE_WORKSPACE: f.cwd, MEMSPHERE_REVIEW_RUN_ID: run, MEMSPHERE_REVIEW_MEMORY_RUN_ID: run,
    MEMSPHERE_REVIEW_HANDLE: input.reviewId, MEMSPHERE_REVIEW_ASSIGNMENT_ID: claim.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: claim.attempt.id };
  const cli = (args: string[]) => invokeCliModule(args, f.cwd, env, fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
  return { run, cli, upstream, candidate, input, unrelated: initial.steps.find(s => s.source?.actionId === 'unrelated')! };
}

for (const target of ['candidate', 'upstream'] as const) {
  test(`restricted ${target} contract includes its frozen Schema without current or unrelated definitions`, async t => {
    const f = await schemaReview(t);
    const response = await f.cli(['run', 'artifact', 'contract', 'show', '--run', f.run, '--artifact', f[target].artifact.id, '--output', 'json']);
    const contract = JSON.parse(response.stdout);
    assert.equal(contract.artifact.schema.compiledVersion, 1);
    assert.match(contract.artifact.schema.definition, new RegExp(`${target} frozen requirement`));
    assert.equal(contract.artifact.schema.sources.source.memoryRef, `schemas/${target}`);
    assert.doesNotMatch(response.stdout, /CURRENT_PROJECT|unrelated frozen/);
  });
}

test('restricted Schema contract rejects an unrelated Step before exposing its definition', async t => {
  const f = await schemaReview(t);
  await assert.rejects(f.cli(['run', 'artifact', 'contract', 'show', '--run', f.run, '--step', f.unrelated.id, '--output', 'json']), /REVIEW_RESOURCE_DENIED|outside this Review/);
});

test('graph Reviewer prompt directs Schema reading to the fixed contract', async t => {
  const f = await schemaReview(t);
  const prompt = await buildArtifactReviewerPrompt({ context: await reviews.readArtifactReviewForActor(f.input), locale: 'zh-CN', promptVersion: 'artifact-review-v3' });
  assert.match(prompt, /"schema":\s*\{\s*"readCommand":.*run artifact contract show --assignment/);
  assert.doesNotMatch(prompt, /CURRENT_PROJECT|unrelated frozen/);
});
