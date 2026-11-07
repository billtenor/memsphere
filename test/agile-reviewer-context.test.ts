import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import type { Step } from '../src/context_control/types.js';
import test from 'node:test';
import crossSpawn from 'cross-spawn';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { readMemoryFile } from '../src/memory/store.js';
import type { GraphProcedureMemory } from '../src/memory/ast.js';
import { openContextControl } from '../src/project/context-control.js';
import { createAgentReviewCliRuntime } from '../src/acp/cli-runtime.js';
import * as reviews from '../src/context_control/review-repository.js';
import { graphReviewId } from '../src/context_control/graph-review.js';
import { currentReviewNode } from '../src/review-nodes.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = join(root, 'dist/cli.js');
type Produced = {
  stepId: string;
  artifactId: string;
  body: string;
};
type WorkflowInputs = {
  requirements: Produced;
  plan: Produced;
  pr: Produced;
};
type ArtifactView = {
  artifact: {
    value: unknown;
  };
  contextArtifacts: Array<{
    artifactId: string;
    artifact: {
      value: unknown;
    };
  }>;
  confirmations: Array<{
    artifactId: string;
    roundId: string;
    status: string;
    reviewer: {
      source?: string;
    };
    vote: {
      value: string;
    };
  }>;
};
type ReviewerSession = {
  candidate: Produced;
  roundId: string;
  read(produced: Produced): Promise<void>;
  confirmation(produced: Produced): Promise<void>;
  verify(inputs: Produced[]): Promise<ArtifactView>;
  accept(): Promise<void>;
  cli(args: string[], ok?: boolean): SpawnSyncReturns<string>;
};
type AcceptedDelivery = {
  technical: Produced;
  product: Produced;
  review: ReviewerSession;
};
for (const source of [
  '.memsphere/memory/procedures/memsphere-agile-requirement-development.yaml',
  'reserved-memory/official-memory/procedures/generic-agile-requirement-development.yaml'])
  test(`${source}: formal technical/product Sessions pin actual workflow inputs through loops and rewind`, {
    // Each workflow has six bounded phases; the aggregate spans many Reviews.
    timeout: 540000
  }, async (t) => {
    const f = await initializedContextFixture(t);
    const service = (await openContextControl(f.root))!;
    const file = join(root, source);
    const procedure = (await readMemoryFile('procedures', file)).entity as GraphProcedureMemory;
    const name = procedure.names[0];
    const memories: Record<string, {
      memoryRef: string;
      payload: {
        contentType: string;
        content: string;
      };
    }> = {};
    memories[`procedures/${name}`] = {
      memoryRef: `procedures/${name}`,
      payload: {
        contentType: 'application/yaml',
        content: await readFile(file, 'utf8')
      }
    };
    const statements = join(root, '.memsphere/memory/statements');
    for (const filename of await readdir(statements)) {
      if (!filename.endsWith('.yaml'))
        continue;
      const path = join(statements, filename);
      const memory = await readMemoryFile('statements', path);
      const reference = `statements/${memory.entity.names[0]}`;
      memories[reference] = {
        memoryRef: reference,
        payload: {
          contentType: 'application/yaml',
          content: await readFile(path, 'utf8')
        }
      };
    }
    const reader = {
      kind: 'agent' as const,
      name: 'Reader',
      permissions: [
        'artifact.read',
        'decision.assess'] as const,
      agent: {
        provider: 'test',
        providerType: 'traex' as const,
        command: process.execPath,
        args: [],
        env: {},
        startupTimeoutMs: 10000,
        idleTimeoutMs: null,
        maxRuntimeMs: null
      }
    };
    const policies = Object.fromEntries(procedure.actions.filter(a => a.artifact?.review?.length).map(a => [
      `${name}#actions[${a.id}]`,
      {
        policy: 'artifact_acceptance.unanimous'
      }]));
    const slots = Object.fromEntries(procedure.actions.flatMap(a => (a.artifact?.review ?? []).map(slot => [
      `${name}::${slot}`,
      {
        actorIds: [
          'reader',
          'human']
      }])));
    assert.ok(Object.values(slots).every(slot => slot.actorIds.length === 2), 'every declared Review Slot is enabled');
    const started = await service.withGraph(g => g.start({
      name: 'Real agile Reviewer access fixture',
      procedure,
      memorySnapshot: {
        memories
      },
      controlPlane: {
        runner: {
          permissions: [
            'artifact.read',
            'artifact.submit',
            'decision.decide'
          ]
        },
        actors: {
          reader: {
            ...reader,
            permissions: [...reader.permissions]
          },
          human: {
            kind: 'human',
            name: 'Human',
            permissions: [
              'artifact.read',
              'decision.decide']
          }
        },
        acpProviders: {}
      },
      reviewConfiguration: {
        reviews: policies,
        slots
      }
    }));
    const runId = started.run.id;
    const runtime = await createAgentReviewCliRuntime({
      nodeExecutable: process.execPath,
      cliEntrypoint: entrypoint
    });
    t.after(() => runtime.cleanup());
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MEMSPHERE_')));
    Object.assign(env, {
      MEMSPHERE_HOME: f.home,
      MEMSPHERE_CONFIG_PATH: join(f.root, 'config.json')
    });
    async function phase<T>(name: string, operation: () => Promise<T>): Promise<T> {
      let result: { value: T } | undefined;
      await t.test(name, { timeout: 180000 }, async () => {
        result = { value: await operation() };
      });
      // A failed subtest must stop dependent phases using its incomplete state.
      assert.ok(result, `Workflow phase did not complete: ${name}`);
      return result.value;
    }
    function runner(args: string[], json = true) {
      const r = crossSpawn.sync(process.execPath, [
        entrypoint,
        '--project',
        'test-project',
        ...args
      ], {
        cwd: f.cwd,
        env,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 2000000
      });
      assert.ifError(r.error);
      assert.equal(r.status, 0, r.stderr);
      return json ? JSON.parse(r.stdout) : r.stdout;
    }
    async function active(id: string): Promise<Step> {
      const snapshot = await service.snapshot(runId);
      const rows = await service.withGraph(async g => g.ready(snapshot).filter(s => s.source?.actionId === id));
      assert.equal(rows.length, 1, id);
      return rows[0];
    }
    async function produce(id: string, body: string, dependencies: Produced[] = [], native = false): Promise<Produced> {
      const step = await active(id);
      if (native) {
        // Enter is fixture setup; the operation under test is the real CLI report.
        await service.withGraph(g => g.enter(runId, step.id));
        const args = [
          'run',
          'report',
          '--run',
          runId,
          '--step',
          step.id,
          '--artifact',
          body,
          '--output',
          'json'
        ];
        for (const dependency of dependencies)
          args.push('--depends-on', `artifact:${dependency.artifactId}`);
        const r = runner(args);
        return {
          stepId: step.id,
          artifactId: r.artifactId,
          body
        };
      }
      const r = await service.withGraph(async (g) => {
        await g.enter(runId, step.id);
        return g.report(runId, step.id, {
          text: body
        });
      });
      return {
        stepId: step.id,
        artifactId: r.artifact.id,
        body
      };
    }
    let sessionIndex = 0;
    async function session(candidate: Produced): Promise<ReviewerSession> {
      const step = (await service.snapshot(runId)).steps.find(s => s.id === candidate.stepId)!;
      const roundId = step.reviewRounds!.at(-1)!.id;
      const input = {
        runsRoot: join(f.root, 'runs'),
        reviewId: reviews.graphReviewHandle(runId, step.id),
        roundId,
        actorId: 'reader',
        service
      };
      const claimed = (await reviews.claimArtifactReviewAgentAssignment(input))!;
      const bound = {
        ...input,
        attemptId: claimed.attempt.id
      };
      const cwd = join(f.directory, `review-attempt-${++sessionIndex}`);
      await mkdir(cwd);
      await reviews.markArtifactReviewAgentCliReady(bound);
      const sessionEnv = {
        ...env,
        MEMSPHERE_CLI: runtime.launcherPath,
        MEMSPHERE_REVIEW_RUN_ID: runId,
        MEMSPHERE_REVIEW_MEMORY_RUN_ID: runId,
        MEMSPHERE_REVIEW_HANDLE: input.reviewId,
        MEMSPHERE_REVIEW_ROUND_ID: roundId,
        MEMSPHERE_REVIEW_ASSIGNMENT_ID: claimed.assignment.id!,
        MEMSPHERE_REVIEW_ATTEMPT_ID: claimed.attempt.id,
        MEMSPHERE_WORKSPACE_ROOT: cwd,
        MEMSPHERE_REVIEW_SOURCE_WORKSPACE: f.cwd
      };
      let exports = 0;
      const cli = (args: string[], ok = true): SpawnSyncReturns<string> => {
        const r = crossSpawn.sync(runtime.launcherPath, [
          ...args,
          '--output',
          'json'
        ], {
          cwd,
          env: sessionEnv,
          encoding: 'utf8',
          timeout: 20000,
          maxBuffer: 2000000
        });
        assert.ifError(r.error);
        if (ok)
          assert.equal(r.status, 0, r.stderr);
        else {
          assert.equal(r.status, 1);
          assert.equal(r.stdout, '');
          assert.match(r.stderr, /REVIEW_RESOURCE_DENIED/);
        }
        return r;
      };
      async function read(produced: Produced): Promise<void> {
        const out = `evidence-${++exports}.md`;
        cli([
          'run',
          'artifact',
          'show',
          '--run',
          runId,
          '--artifact',
          produced.artifactId,
          '--out',
          out
        ]);
        assert.equal(await readFile(join(cwd, out), 'utf8'), produced.body);
      }
      async function confirmation(produced: Produced): Promise<void> {
        const source = (await service.snapshot(runId)).steps.find(s => s.id === produced.stepId)!;
        const sourceRound = source.reviewRounds!.at(-1)!.id;
        const r = JSON.parse(cli([
          'run',
          'review',
          'show',
          '--review',
          graphReviewId(sourceRound, 'human')
        ]).stdout);
        assert.equal(r.artifactId, produced.artifactId);
        assert.equal(r.roundId, sourceRound);
        assert.equal(r.vote.value, 'approve');
        assert.equal(r.reviewer.source, 'human');
      }
      async function verify(inputs: Produced[]): Promise<ArtifactView> {
        const view = JSON.parse(cli([
          'run',
          'artifact',
          'show'
        ]).stdout) as ArtifactView;
        const snapshot = await service.snapshot(runId);
        assert.equal(view.artifact.value, candidate.body);
        for (const expected of inputs) {
          const actual = view.contextArtifacts.find((a: {
            artifactId: string;
          }) => a.artifactId === expected.artifactId);
          assert.ok(actual, expected.artifactId);
          assert.equal(actual.artifact.value, expected.body);
          const source = snapshot.steps.find(s => s.id === expected.stepId)!;
          const sourceRound = source.reviewRounds!.at(-1)!.id;
          assert.ok(view.confirmations.some(r => r.artifactId === expected.artifactId && r.roundId === sourceRound && r.reviewer.source === 'human' && r.status === 'submitted' && r.vote.value === 'approve'));
        }
        return view;
      }
      async function accept(): Promise<void> {
        let context = await reviews.readArtifactReviewForActor(input);
        while (currentReviewNode(context.assignment))
          context = await reviews.mutateArtifactReviewNodes({
            ...bound,
            mutation: {
              operation: 'report',
              expectedNodeId: currentReviewNode(context.assignment)!.nodeId,
              artifact: {
                applicable: true
              }
            }
          });
        await reviews.submitArtifactReviewAgentAssignment({
          ...bound,
          vote: 'approve'
        });
        await service.withGraph(g => g.submitReview(runId, step.id, roundId, 'human', 'approve', [], 'Fixture Human confirms this fixed version.'));
        await reviews.submitArtifactReviewRunnerVote({
          ...input,
          vote: 'approve'
        });
      }
      return {
        read,
        confirmation,
        verify,
        accept,
        cli,
        roundId,
        candidate
      };
    }
    async function confirmed(id: string, body: string): Promise<Produced> {
      const produced = await produce(id, body);
      await (await session(produced)).accept();
      return produced;
    }
    async function setup(version: string): Promise<WorkflowInputs> {
      const requirements = await confirmed('requirements', `Requirements ${version}`);
      const plan = await confirmed('implementation_plan', `Plan ${version}`);
      await produce('implement', `Implementation ${version}`);
      const pr = await produce('pr', `PR ${version}`);
      return {
        requirements,
        plan,
        pr
      };
    }
    // Routing values are isolated test inputs, not claims about repository CI.
    async function gate(version: string, route = version === 'v1' ? 'follow_ci' : 'technical_acceptance'): Promise<void> {
      await produce('release_gate', JSON.stringify({
        route,
        headSha: `fixture-${version}`,
        masterSha: 'fixture-master',
        prUrl: 'https://example.invalid/pr/1',
        evidence: 'Workflow access fixture only; no actual CI certification.'
      }));
      if (route === 'follow_ci')
        await produce('check_ci', 'false');
    }
    async function acceptance(version: string, inputs: WorkflowInputs): Promise<AcceptedDelivery> {
      await gate(version);
      const technical = await produce('acceptance', `Technical ${version}`, [
        inputs.requirements,
        inputs.plan], true);
      const tech = await session(technical);
      const view = await tech.verify([
        inputs.requirements,
        inputs.plan]);
      if (version === 'v1') {
        assert.ok(view.contextArtifacts.some(a => a.artifact.value === false), 'first technical review receives check_ci=false plus fixed requirements/plan');
        await tech.read(inputs.requirements);
        await tech.read(inputs.plan);
        await tech.confirmation(inputs.requirements);
        tech.cli([
          'run',
          'artifact',
          'show',
          '--artifact',
          inputs.pr.artifactId
        ], false);
      }
      await tech.accept();
      const product = await produce('delivery', `Product ${version}`, [
        inputs.requirements,
        inputs.plan], true);
      const review = await session(product);
      await review.verify([
        inputs.requirements,
        inputs.plan,
        technical
      ]);
      if (version === 'v1') {
        await review.read(technical);
        await review.confirmation(technical);
      }
      await review.accept();
      return {
        technical,
        product,
        review
      };
    }
    const firstInputs = await phase('confirm initial requirements and plan', () => setup('v1'));
    const first = await phase('first technical and product acceptance', () => acceptance('v1', firstInputs));
    await phase('direct product gate retains the accepted technical version', async () => {
      await gate('product-only', 'product_acceptance');
      const productOnly = await produce('delivery', 'Product via gate', [
        firstInputs.requirements,
        firstInputs.plan,
        first.technical
      ], true);
      const productOnlyReview = await session(productOnly);
      await productOnlyReview.verify([
        firstInputs.requirements,
        firstInputs.plan,
        first.technical
      ]);
      await productOnlyReview.confirmation(first.technical);
      await productOnlyReview.accept();
    });
    await phase('loop acceptance keeps earlier Review versions isolated', async () => {
      const accepted = await acceptance('v2', firstInputs);
      await first.review.read(first.technical);
      first.review.cli([
        'run',
        'artifact',
        'show',
        '--artifact',
        accepted.technical.artifactId
      ], false);
      await accepted.review.read(accepted.technical);
      return accepted;
    });
    const replacement = await phase('rewind and confirm replacement requirements and plan', async () => {
      runner([
        'run',
        'step',
        'rewind',
        '--run',
        runId,
        '--step',
        firstInputs.requirements.stepId,
        '--reason',
        'Replace confirmed requirements in fixture',
        '--output',
        'json'
      ]);
      return setup('after-rewind');
    });
    await phase('post-rewind acceptance and historical snapshots retain exact versions', async () => {
      const third = await acceptance('after-rewind', replacement);
      third.review.cli([
        'run',
        'artifact',
        'show',
        '--artifact',
        firstInputs.requirements.artifactId
      ], false);
      const history = await service.withGraph(g => g.reviewSnapshot(runId, first.product.stepId, first.review.roundId));
      assert.ok(history.artifacts.some(a => a.id === firstInputs.requirements.artifactId));
      assert.ok(history.artifacts.some(a => a.id === first.technical.artifactId));
      assert.ok(!history.artifacts.some(a => a.id === replacement.requirements.artifactId || a.id === third.technical.artifactId));
    });
  });
