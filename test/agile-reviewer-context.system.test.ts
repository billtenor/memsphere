import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import type { Step } from '../src/context_control/types.js';
import test from 'node:test';
import crossSpawn from 'cross-spawn';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { invokeCliModule } from './helpers/cli-module.js';
import { readMemoryFile } from '../src/memory/store.js';
import type { GraphProcedureMemory, MemoryEntity } from '../src/memory/ast.js';
import { collectMemoryReferenceTargets } from '../src/memory/references.js';
import { openContextControl } from '../src/project/context-control.js';
import { createAgentReviewCliRuntime } from '../src/acp/cli-runtime.js';
import * as reviews from '../src/context_control/review-repository.js';
import { graphReviewId } from '../src/context_control/graph-review.js';
import { currentReviewNode, mutateReviewNode } from '../src/review-nodes.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = join(root, 'dist/cli.js');
type Produced = {
  stepId: string;
  artifactId: string;
  body: string;
  reviewRoundId?: string;
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
    timeout: 180000
  }, async (t) => {
    const f = await initializedContextFixture(t);
    let currentPhase: test.TestContext = t;
    const pending = new Set<Promise<unknown>>();
    function checkCancellation() {
      t.signal.throwIfAborted();
      currentPhase.signal.throwIfAborted();
    }
    async function checked<T>(operation: () => Promise<T>): Promise<T> {
      checkCancellation();
      const work = operation();
      pending.add(work);
      try {
        const result = await work;
        checkCancellation();
        return result;
      } finally {
        pending.delete(work);
      }
    }
    // node:test can finish a canceled subtest while its async callback is still
    // unwinding. Keep the fixture until that callback stops, including any
    // already-started atomic Store operation; guards prevent subsequent work.
    f.beforeCleanup(async () => {
      await Promise.allSettled([...pending]);
    });
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
    // Freeze the Procedure's real reference closure, like normal graph startup.
    // Unrelated repository Statements are not part of this Run's rule contract.
    const statementSources = new Map<string, { entity: MemoryEntity; content: string }>();
    const statements = join(root, '.memsphere/memory/statements');
    for (const filename of await readdir(statements)) {
      if (!filename.endsWith('.yaml'))
        continue;
      const path = join(statements, filename);
      const memory = await readMemoryFile('statements', path);
      const reference = `statements/${memory.entity.names[0]}`;
      statementSources.set(reference, { entity: memory.entity, content: await readFile(path, 'utf8') });
    }
    const references = collectMemoryReferenceTargets(procedure);
    while (references.length) {
      const reference = references.pop()!;
      if (memories[reference]) continue;
      const statement = statementSources.get(reference);
      assert.ok(statement, `Referenced Statement must be available: ${reference}`);
      memories[reference] = { memoryRef: reference, payload: { contentType: 'application/yaml', content: statement.content } };
      references.push(...collectMemoryReferenceTargets(statement.entity));
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
    const started = await checked(() => service.withGraph(g => g.start({
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
    })));
    const runId = started.run.id;
    const runtime = await createAgentReviewCliRuntime({
      nodeExecutable: process.execPath,
      cliEntrypoint: entrypoint
    });
    f.beforeCleanup(() => runtime.cleanup());
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MEMSPHERE_')));
    Object.assign(env, {
      MEMSPHERE_HOME: f.home,
      MEMSPHERE_CONFIG_PATH: join(f.root, 'config.json')
    });
    let currentSnapshot = started;
    let checkedRunnerProcess = false;
    async function phase<T>(name: string, operation: () => Promise<T>): Promise<T> {
      let result: { value: T } | undefined;
      await t.test(name, { timeout: 180000 }, async child => {
        currentPhase = child;
        checkCancellation();
        const work = operation();
        pending.add(work);
        void work.then(() => pending.delete(work), () => pending.delete(work));
        result = { value: await work };
      });
      // A failed subtest must stop dependent phases using its incomplete state.
      assert.ok(result, `Workflow phase did not complete: ${name}`);
      return result.value;
    }
    async function runner(args: string[], json = true) {
      checkCancellation();
      const command = ['--project', 'test-project', ...args];
      // One report per Procedure and the rewind retain the OS boundary. Other
      // Runner setup calls use the real command tree, under the same 20s limit.
      // Every Reviewer read below still executes the restricted OS launcher.
      if (!checkedRunnerProcess || args[1] === 'step') {
        checkedRunnerProcess = true;
        const r = crossSpawn.sync(process.execPath, [entrypoint, ...command], {
          cwd: f.cwd, env, encoding: 'utf8', timeout: 20000, maxBuffer: 2000000
        });
        assert.ifError(r.error);
        assert.equal(r.status, 0, r.stderr);
        return json ? JSON.parse(r.stdout) : r.stdout;
      }
      let receipt: Awaited<ReturnType<typeof invokeCliModule>> | undefined;
      const commandStarted = performance.now();
      await currentPhase.test(`Runner CLI ${args.slice(0, 2).join(' ')}`, { timeout: 20000 }, async () => {
        receipt = await checked(() => invokeCliModule(command, f.cwd, env, entrypoint));
      });
      assert.ok(receipt, 'Runner CLI command must finish within its 20s deadline');
      assert.ok(performance.now() - commandStarted <= 20000, 'Runner CLI keeps its 20s wall-clock limit');
      return json ? JSON.parse(receipt.stdout) : receipt.stdout;
    }
    async function active(id: string): Promise<Step> {
      // The fixture has one writer. Reuse the last public write receipt to
      // select the next Step; actual report/read authorization stays fresh.
      const rows = await checked(() => service.withGraph(async g => g.ready(currentSnapshot).filter(s => s.source?.actionId === id)));
      assert.equal(rows.length, 1, id);
      return rows[0];
    }
    async function produce(id: string, body: string, dependencies: Produced[] = [], throughCli = false): Promise<Produced> {
      const step = await active(id);
      if (throughCli) {
        // Enter is fixture setup; report still uses the real CLI command tree.
        await checked(() => service.withGraph(g => g.enter(runId, step.id)));
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
        const r = await runner(args);
        return {
          stepId: step.id,
          artifactId: r.artifactId,
          body
        };
      }
      const r = await checked(() => service.withGraph(async (g) => {
        await g.enter(runId, step.id);
        checkCancellation();
        return g.report(runId, step.id, {
          text: body
        });
      }));
      currentSnapshot = r.snapshot;
      return {
        stepId: step.id,
        artifactId: r.artifact.id,
        body
      };
    }
    let sessionIndex = 0;
    async function session(candidate: Produced): Promise<ReviewerSession> {
      const step = (await checked(() => service.withGraph(g => g.reviewSnapshot(runId, candidate.stepId)))).steps.find(s => s.id === candidate.stepId)!;
      const roundId = step.reviewRounds!.at(-1)!.id;
      candidate.reviewRoundId = roundId;
      const input = {
        runsRoot: join(f.root, 'runs'),
        reviewId: reviews.graphReviewHandle(runId, step.id),
        roundId,
        actorId: 'reader',
        service
      };
      const claimed = (await checked(() => reviews.claimArtifactReviewAgentAssignment(input)))!;
      const bound = {
        ...input,
        attemptId: claimed.attempt.id
      };
      const cwd = join(f.directory, `review-attempt-${++sessionIndex}`);
      checkCancellation();
      await mkdir(cwd);
      await checked(() => reviews.markArtifactReviewAgentCliReady(bound));
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
        checkCancellation();
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
        const sourceRound = produced.reviewRoundId;
        assert.ok(sourceRound, 'expected confirmation belongs to the original reviewed version');
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
        assert.equal(view.artifact.value, candidate.body);
        for (const expected of inputs) {
          const actual = view.contextArtifacts.find((a: {
            artifactId: string;
          }) => a.artifactId === expected.artifactId);
          assert.ok(actual, expected.artifactId);
          assert.equal(actual.artifact.value, expected.body);
          const sourceRound = expected.reviewRoundId;
          assert.ok(sourceRound, 'expected confirmation keeps its original Round ID');
          assert.ok(view.confirmations.some(r => r.artifactId === expected.artifactId && r.roundId === sourceRound && r.reviewer.source === 'human' && r.status === 'submitted' && r.vote.value === 'approve'));
        }
        return view;
      }
      async function accept(): Promise<void> {
        // Node command authorization/order is exercised by
        // reviewer-session-integration.system and review-node-graph-paths.system.
        // This scenario targets fixed-context reads and workflow versions. Use
        // the real node algorithm in one public CAS to prepare completion; final
        // Agent submission still enforces the handshake and every required node.
        await checked(() => service.withGraph(g => g.mutateReview(runId, step.id, roundId, 'reader', async review => {
          const nodes = { nodeTree: review.nodeTree!, nodeStates: review.nodeStates! };
          let node;
          while ((node = currentReviewNode(nodes)))
            review.comments = mutateReviewNode(nodes, review.comments, {
              operation: 'report', expectedNodeId: node.nodeId, artifact: { applicable: true }
            }, () => { throw new Error('Acceptance fixture has no findings'); });
        })));
        await checked(() => reviews.submitArtifactReviewAgentAssignment({
          ...bound,
          vote: 'approve'
        }));
        await checked(() => service.withGraph(g => g.submitReview(runId, step.id, roundId, 'human', 'approve', [], 'Fixture Human confirms this fixed version.')));
        currentSnapshot = await checked(() => service.withGraph(g => g.submitReview(runId, step.id, roundId, 'runner', 'approve')));
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
      await runner([
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
      currentSnapshot = await checked(() => service.snapshot(runId));
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
      const history = await checked(() => service.withGraph(g => g.reviewSnapshot(runId, first.product.stepId, first.review.roundId)));
      assert.ok(history.artifacts.some(a => a.id === firstInputs.requirements.artifactId));
      assert.ok(history.artifacts.some(a => a.id === first.technical.artifactId));
      assert.ok(!history.artifacts.some(a => a.id === replacement.requirements.artifactId || a.id === third.technical.artifactId));
    });
  });
