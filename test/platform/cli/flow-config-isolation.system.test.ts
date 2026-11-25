import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runArtifactReviewAgentWorker } from "../../../src/acp/review-worker.js";
import { artifactReviewAssignmentId } from "../../../src/artifact-review.js";
import { readProjectConfig } from "../../../src/config.js";
import { runGit } from "../../../src/git.js";
import { currentReviewNode } from "../../../src/review-nodes.js";
import {
  currentArtifactReview, currentStep, listRuns, markArtifactReviewAgentCliReady,
  mutateArtifactReviewNodes, readArtifactReviewForActor, readRun, reportRun,
  startRun, submitArtifactReviewAgentAssignment
} from "../../../src/run/store.js";
import { businessFixture } from "../../helpers/business-data.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";
import { reviewConfiguration } from "../../helpers/review.js";

const cli = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
const project = "test-project";
const procedure = "flow-config-isolation";
const reviewerPermissions = ["artifact.read", "decision.assess"];

test("Flow CLI isolates unavailable Actors and the Worker uses each Run's frozen Provider", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {});
  await runGit(["init", "-b", "master"], { cwd: f.root });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Flow fixture"], { cwd: f.root });
  const memoryRoot = join(f.root, "memory");
  const configPath = join(f.root, "config.json");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await writeFile(join(memoryRoot, "procedures", `${procedure}.yaml`), withCurrentMemorySyntax(`!procedure
names: [${procedure}]
defines: [Verify Flow Reviewer configuration]
flow:
  - !action
    action: Produce a candidate.
    artifact: !artifact
      name: Candidate
      review: [reviewer]
  - !action
    action: Finish after Review acceptance.
    artifact: !artifact
      name: Final result
`));
  const agent = (provider: string) => ({ kind: "agent", permissions: reviewerPermissions, agent: { provider } });
  const homeConfig = {
    language: "en",
    acp_providers: { kimi: { args: ["--fixture-option"], startup_timeout_ms: 1250 }, codex: null, claude: {}, "future-provider": {} }
  };
  const homePath = join(f.home, "config.json");
  await writeFile(homePath, JSON.stringify(homeConfig));
  await writeFile(configPath, JSON.stringify({
    ...JSON.parse(await readFile(configPath, "utf8")),
    store: { type: "embedded", repository_path: f.root, memory_path: "memory" },
    control_plane: {
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: { healthy: agent("kimi"), damaged: agent("codex"), unknown: agent("future-provider"), malformed: 17 }
    }
  }));
  const config = await readProjectConfig(project, f.home);
  assert.equal(config.controlPlane?.acpProviders?.claude?.command, "claude-agent-acp");
  const { runsRoot } = config;
  const bind = (id: string) => reviewConfiguration({ procedure, slots: { reviewer: [id] } });
  const runCli = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, "--project", project, ...args], {
      cwd: f.root, env: { ...process.env, MEMSPHERE_HOME: f.home }, encoding: "utf8"
    });
    if (result.error) throw result.error;
    return result;
  };
  const start = async (id: string) => {
    const binding = join(f.directory, "review.json");
    await writeFile(binding, JSON.stringify({
      reviews: bind(id).reviews,
      slots: { [`${procedure}::reviewer`]: { actors: [id] } }
    }));
    return runCli("run", "start", procedure, "--name", id, "--review-config", binding, "--output", "json");
  };
  const show = (id: string) => {
    for (const command of ["status", "show"]) {
      const result = runCli("run", command, "--run", id, "--output", "json");
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(id), result.stdout);
    }
  };

  const started = await start("healthy");
  assert.equal(started.status, 0, started.stderr);
  const [healthy] = await listRuns(runsRoot);
  assert.ok(healthy, started.stdout);
  show(healthy.id);
  assert.deepEqual(healthy.reviewConfiguration, bind("healthy"));
  assert.deepEqual(Object.keys(healthy.controlPlane!.actors), ["healthy"]);
  for (const [actor, diagnostic] of [
    ["damaged", /control_plane\.actors\.damaged\.agent\.provider.*acp_providers\.codex/],
    ["unknown", /control_plane\.actors\.unknown\.agent\.provider.*Unknown ACP Provider id: future-provider/],
    ["malformed", /control_plane\.actors\.malformed/]
  ] as const) {
    const attempted = await start(actor);
    assert.notEqual(attempted.status, 0);
    assert.match(attempted.stderr, diagnostic);
  }
  assert.deepEqual(await listRuns(runsRoot), [healthy]);

  const historicalControlPlane = structuredClone(config.controlPlane!);
  const frozenActor = historicalControlPlane.actors.healthy;
  assert.equal(frozenActor.kind, "agent");
  frozenActor.systemPrompt = "Historical fixture prompt";
  frozenActor.agent.provider = "future-provider";
  frozenActor.agent.providerType = "future-provider";
  const historical = await startRun({
    memoryRoot, runsRoot, projectRoot: f.root, name: "Historical Flow", procedureName: procedure,
    controlPlane: historicalControlPlane, reviewConfiguration: bind("healthy")
  });
  const frozen = await readRun(runsRoot, historical.id);
  show(historical.id);
  assert.deepEqual(await readRun(runsRoot, historical.id), frozen);
  assert.deepEqual(frozen.controlPlane, historical.controlPlane);
  assert.deepEqual(frozen.reviewConfiguration, bind("healthy"));

  const previousHome = process.env.MEMSPHERE_HOME;
  process.env.MEMSPHERE_HOME = f.home;
  try {
    for (const run of [healthy, historical]) {
      const pending = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "Candidate" } });
      const review = currentArtifactReview(pending)!;
      const round = review.rounds[0];
      const assignment = round.assignments[0];
      const target = { runsRoot, reviewId: review.id, roundId: round.id, actorId: assignment.actorId, attemptId: assignment.attempts![0].id };
      assert.equal(assignment.status, "queued");
      if (run === healthy) {
        await writeFile(homePath, JSON.stringify({ ...homeConfig, acp_providers: {
          ...homeConfig.acp_providers, kimi: { args: ["--changed-live-option"] }
        } }));
      }
      await runArtifactReviewAgentWorker({
        config: configPath, review: review.id, round: round.id, assignment: artifactReviewAssignmentId(assignment),
        workspaceRoot: f.cwd, nodeExecutable: process.execPath, cliEntrypoint: cli,
        runSession: async session => {
          assert.equal(run, healthy, "unknown Provider must fail before launching a session");
          assert.equal(session.launch.provider, "kimi");
          assert.equal(session.launch.command, "kimi");
          assert.ok(session.launch.args.includes("--fixture-option"));
          assert.ok(!session.launch.args.includes("--changed-live-option"));
          assert.equal(session.launch.startupTimeoutMs, 1250);
          const metadata = { sessionId: "healthy-fixture", protocolVersion: 1 };
          await session.onSession(metadata);
          await markArtifactReviewAgentCliReady(target);
          let progress = await readArtifactReviewForActor(target);
          for (let node = currentReviewNode(progress.assignment); node; node = currentReviewNode(progress.assignment)) {
            progress = await mutateArtifactReviewNodes({
              ...target, mutation: { operation: "report", expectedNodeId: node.nodeId, artifact: { applicable: true } }
            });
          }
          await submitArtifactReviewAgentAssignment({ ...target, vote: "approve" });
          return { ...metadata, stopReason: "submitted", stderr: "" };
        }
      });
      const after = await readRun(runsRoot, run.id);
      const afterReview = currentArtifactReview(after)!;
      const afterRound = afterReview.rounds[0];
      const result = afterRound.assignments[0];
      assert.deepEqual(after.controlPlane, pending.controlPlane);
      assert.deepEqual(after.reviewConfiguration, pending.reviewConfiguration);
      assert.equal(currentStep(after)?.id, currentStep(pending)?.id);
      if (run === healthy) {
        assert.equal(result.status, "submitted", JSON.stringify(result.attempts?.[0]?.failure));
        assert.deepEqual(result.permissions, reviewerPermissions);
        assert.equal(result.submitted?.vote, "approve");
        assert.equal(afterRound.status, "awaiting_runner_vote");
      } else {
        assert.equal(result.status, "failed");
        assert.equal(result.attempts?.[0].failure?.code, "agent_provider_unsupported");
        assert.match(result.attempts?.[0].failure?.message ?? "", /future-provider/);
        assert.equal(result.attempts?.[0].sessionId, undefined);
        assert.equal(result.submitted, undefined);
        assert.deepEqual(afterRound.votes, []);
        assert.equal(afterReview.status, "pending");
      }
    }
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
  }
});
