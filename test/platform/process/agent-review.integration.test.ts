import { createAgentReviewCliRuntime } from "../../../src/acp/cli-runtime.js";
import { realpath } from "node:fs/promises";
import { assertWindowsPrerequisites } from "../../../src/windows-prerequisites.js";
import assert from "node:assert/strict";
import crossSpawn from "cross-spawn";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { artifactReviewAssignmentId } from "../../../src/artifact-review.js";
import { readConfig } from "../../../src/config.js";
import { abandonRun, appendArtifactReviewAgentComment, claimArtifactReviewAgentAssignment, currentArtifactReview, failArtifactReviewAgentAssignment, markArtifactReviewAgentCliReady, readRun, reportRun, retryArtifactReviewAgentAssignment, startRun, submitArtifactReviewAssignment, submitArtifactReviewAgentAssignment, updateArtifactReviewDraft, updateRunSlotBinding } from "../../../src/run/store.js";


import { type AgentReviewProvider, type AgentReviewProviderLaunch } from "../../../src/acp/provider.js";
import { runAgentReviewAcpSession } from "../../../src/acp/client.js";

import { tryRunArtifactReviewAgents } from "../../../src/acp/debug.js";
import { dispatchArtifactReviewAgents } from "../../../src/acp/dispatcher.js";
import type { ControlPlaneActor } from "../../../src/control-plane/index.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";

import { reviewConfiguration } from "../../helpers/review.js";
import { runGit } from "../../../src/git.js";


const testDirectory = fileURLToPath(new URL("../../", import.meta.url));
const fakeReviewer = join(testDirectory, "fixtures", "fake-acp-reviewer.mjs");
const fakeCli = join(testDirectory, "fixtures", "fake-review-cli.mjs");
const fakeArgsCli = join(testDirectory, "fixtures", "fake-args-cli.mjs");

/** Keep fake launchers independent of the ACP Session running this test suite. */
function launcherEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("MEMSPHERE_")) delete env[name];
  return { ...env, ...overrides };
}

test("dispatcher only launches the rebound Agent in the next Round and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-handoff-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    const home = join(root, "home");
    const projectRoot = join(home, "projects", "handoff-fixture");
    const memoryRoot = join(projectRoot, "memory");
    const runsRoot = join(projectRoot, "runs");
    const configPath = join(projectRoot, "config.json");
    process.env.MEMSPHERE_HOME = home;
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: projectRoot });
    await writeFile(join(memoryRoot, "procedures", "handoff.yaml"), withCurrentMemorySyntax(`!procedure
name: agent-handoff-fixture
flow:
  - !action
    action: Review and revise the candidate.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`));
    await writeFile(join(projectRoot, "project.json"), `${JSON.stringify({
      format_version: 1,
      name: "handoff-fixture",
      created_at: new Date().toISOString()
    }, null, 2)}\n`);
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: { "handoff-fixture": { root: projectRoot } },
      workspaces: {}
    }, null, 2)}\n`);
    await writeFile(join(home, "config.json"), `${JSON.stringify({
      language: "en",
      acp_providers: { traex: {} }
    }, null, 2)}\n`);
    await writeFile(configPath, `${JSON.stringify({
      store: { type: "embedded", repository_path: projectRoot, memory_path: "memory" },
      control_plane: {
        runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
        actors: {
          human: {
            kind: "human",
            name: "Human",
            permissions: ["artifact.read", "decision.decide"]
          },
          agent: {
            kind: "agent",
            name: "Agent",
            permissions: ["artifact.read", "decision.assess"],
            agent: { provider: "traex" }
          }
        }
      }
    }, null, 2)}\n`);
    const config = await readConfig(configPath);
    const started = await startRun({
      name: "Human to Agent handoff",
      memoryRoot: config.memoryRoot,
      runsRoot: config.runsRoot,
      language: config.language,
      procedureName: "agent-handoff-fixture",
      controlPlane: config.controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "agent-handoff-fixture",
        slots: { reviewer: ["human"] }
      })
    });
    const firstPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "first" }
    });
    const review = currentArtifactReview(firstPending);
    assert(review);
    const firstRound = review.rounds[0];
    const drafted = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstRound.revision,
      draft: { vote: "request_changes", comments: [{ body: "Please revise." }] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: drafted.round.revision
    });
    await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "agent-handoff-fixture::reviewer",
      actorIds: ["agent"]
    });
    const revised = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "second" },
      revisionSummary: "Addressed the Human feedback."
    });
    const secondReview = currentArtifactReview(revised);
    assert(secondReview);
    assert.equal(secondReview.id, review.id);
    const secondRound = secondReview.rounds[1];
    const launched: Array<{ reviewId: string; roundId: string; assignmentId: string }> = [];
    const launchWorker = async (assignment: { reviewId: string; roundId: string; assignmentId: string }) => {
      launched.push(assignment);
      const claimed = await claimArtifactReviewAgentAssignment({
        runsRoot,
        reviewId: assignment.reviewId,
        roundId: assignment.roundId,
        actorId: assignment.assignmentId,
        workerPid: 4242
      });
      assert(claimed);
    };

    assert.equal(await dispatchArtifactReviewAgents({ config, run: revised, launchWorker }), 1);
    assert.equal(await dispatchArtifactReviewAgents({ config, run: revised, launchWorker }), 0);
    assert.deepEqual(launched, [{
      reviewId: review.id,
      roundId: secondRound.id,
      assignmentId: artifactReviewAssignmentId(secondRound.assignments[0])
    }]);

    const persisted = currentArtifactReview(await readRun(runsRoot, started.id));
    assert(persisted);
    assert.equal(persisted.rounds[0].assignments[0].actorId, "human");
    assert.deepEqual(persisted.rounds[0].assignments[0].attempts ?? [], []);
    assert.equal(persisted.rounds[1].assignments[0].actorId, "agent");
    assert.equal(persisted.rounds[1].assignments[0].status, "running");
    assert.equal(persisted.rounds[1].assignments[0].attempts?.length, 1);
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("abandoning a Run cancels running Agent Review work and preserves the terminal state when termination fails", async () => {
  await withAgentReviewFixture("approve", async ({ configPath, runsRoot, runId }) => {
    const config = await readConfig(configPath);
    const before = await readRun(runsRoot, runId);
    const review = currentArtifactReview(before);
    assert(review);
    const assignment = review.rounds[0].assignments[0];
    assignment.status = "running";
    assert(assignment.attempts?.[0]);
    assignment.attempts[0].status = "running";
    assignment.attempts[0].workerPid = 4242;
    await writeFile(join(runsRoot, runId, `${runId}.json`), `${JSON.stringify(before, null, 2)}\n`);
    const terminated: number[] = [];

    const result = await abandonRun({
      runsRoot,
      runId,
      source: "view",
      reason: "Human stopped the Run",
      terminateWorker: async (pid) => {
        terminated.push(pid);
        throw new Error("simulated termination failure");
      }
    });
    const cancelled = result.run.artifactReviews?.find((candidate) => candidate.id === review.id);
    assert.equal(result.run.status, "abandoned");
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.rounds[0]?.status, "cancelled");
    assert.equal(cancelled?.rounds[0]?.assignments[0]?.status, "cancelled");
    assert.equal(cancelled?.rounds[0]?.assignments[0]?.attempts?.[0]?.status, "cancelled");
    assert.deepEqual(terminated, [4242]);
    assert.match(result.terminationWarnings[0] ?? "", /4242.*simulated termination failure/);
    assert.equal((await readRun(runsRoot, runId)).status, "abandoned");
    assert.equal(currentArtifactReview(result.run), undefined);
    assert.equal(await dispatchArtifactReviewAgents({ config, run: result.run }), 0);
    const lateInput = {
      runsRoot,
      reviewId: review.id,
      roundId: review.rounds[0].id,
      actorId: assignment.actorId,
      attemptId: assignment.attempts[0].id
    };
    await assert.rejects(markArtifactReviewAgentCliReady(lateInput), /Run is not running.*abandoned/);
    await assert.rejects(appendArtifactReviewAgentComment({
      ...lateInput,
      body: "late comment",
      severity: "blocking"
    }), /read-only|not running|cancelled/);
    await assert.rejects(submitArtifactReviewAgentAssignment({
      ...lateInput,
      vote: "approve",
      summary: "late submit"
    }), /Run is not running.*abandoned/);
    await assert.rejects(failArtifactReviewAgentAssignment({
      ...lateInput,
      failure: { stage: "session", code: "late_failure", message: "late failure" }
    }), /Run is not running.*abandoned/);
    await assert.rejects(retryArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.rounds[0].id,
      actorId: assignment.actorId
    }), /Run is not running.*abandoned/);
  });
});

test("Agent Review try-run explicitly writes launch evidence without starting or claiming the Agent", async () => {
  await withAgentReviewFixture("approve", async ({ configPath, runsRoot, runId }) => {
    const config = await readConfig(configPath);
    const debugRoot = join(dirname(configPath), "debug");
    const debugConfig = { ...config, debug: { agentReview: true, root: debugRoot } };
    const before = await readRun(runsRoot, runId);
    const review = currentArtifactReview(before);
    assert(review);
    const round = review.rounds[0];
    const assignment = round.assignments[0];

    const dispatched = await dispatchArtifactReviewAgents({ config: debugConfig, run: before });

    assert.equal(dispatched, 0);
    const after = await readRun(runsRoot, runId);
    assert.deepEqual(after, before);
    assert.equal(after.artifactReviews?.[0]?.rounds[0]?.assignments[0]?.status, "queued");
    const generated = await tryRunArtifactReviewAgents({ config: debugConfig, run: before });
    assert.equal(generated.length, 1);
    const directory = generated[0].directory;
    assert.equal(directory, join(debugRoot, "agent-review", review.id, round.id, artifactReviewAssignmentId(assignment)));
    const launch = JSON.parse(await readFile(join(directory, "launch.json"), "utf8")) as Record<string, unknown>;
    const prompt = normalizeNewlines(await readFile(join(directory, "prompt.md"), "utf8"));
    assert.equal(launch.processStarted, false);
    assert.equal(launch.actorId, "reviewer-agent");
    assert.equal(launch.provider, "traex");
    assert.deepEqual((launch.args as string[]).slice(0, 4), ["--sandbox", "workspace-write", "--ask-for-approval", "never"]);
    assert.match(prompt, /# Memsphere progressive Artifact review/);
    assert.match(prompt, /Check the candidate independently/);
    assert.match(prompt, /within your role/);
    assert.match(prompt, /do not replace evidence/);
    assert.match(prompt, /"rulePath": "asserts\[0\]"/);
    assert.match(prompt, /"text": "Keep the review evidence traceable\."/);
    assert.doesNotMatch(prompt, /"text": "The candidate must be concrete\."/);
    assert.match(prompt, /MEMSPHERE_CLI/);
    assert.match(prompt, /run artifact show/);
    assert.match(prompt, /"\$MEMSPHERE_CLI" continue report --artifact/);
    assert.doesNotMatch(prompt, /MEMSPHERE_REVIEW_ENDPOINT|MEMSPHERE_REVIEW_CAPABILITY|bridge\.sock/);
    assert.doesNotMatch(JSON.stringify(launch), /MEMSPHERE_REVIEW_ENDPOINT|MEMSPHERE_REVIEW_CAPABILITY|bridge\.sock/);
    await assert.rejects(
      tryRunArtifactReviewAgents({
        config: { ...config, debug: { agentReview: false, root: debugRoot } },
        run: before
      }),
      /requires debug\.agent_review=true/
    );
  });
});

test("ACP Client reports a missing Provider executable as a process startup failure", async () => {
  await assert.rejects(runAgentReviewAcpSession({
    launch: {
      provider: "traex",
      command: join(tmpdir(), `missing-acp-${Date.now()}`),
      args: [],
      cwd: tmpdir(),
      env: launcherEnv(),
      startupTimeoutMs: 2_000,
      idleTimeoutMs: 2_000,
      maxRuntimeMs: 2_000,
      promptVersion: "artifact-review-v1"
    },
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_process_spawn/);
});

test("ACP Client preserves Provider stderr when a Session request fails", async () => {
  await assert.rejects(runAgentReviewAcpSession({
    launch: {
      provider: "fake-test-provider",
      command: process.execPath,
      args: [fakeReviewer, "internal-error"],
      cwd: tmpdir(),
      env: launcherEnv(),
      startupTimeoutMs: 2_000,
      idleTimeoutMs: 2_000,
      maxRuntimeMs: 2_000,
      promptVersion: "artifact-review-v1"
    },
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), (error: unknown) => {
    assert(error instanceof Error);
    assert.match(error.message, /Internal error/);
    assert.match(error.message, /Agent stderr:\nprovider diagnostic: reconnecting/);
    return true;
  });
});

test("ACP Client separates startup, idle, and maximum runtime timeouts", async () => {
  await assert.rejects(runAgentReviewAcpSession({
    launch: fakeClientLaunch("slow-start", {
      startupTimeoutMs: 500,
      idleTimeoutMs: 1_000,
      maxRuntimeMs: null
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_startup_timeout: startup exceeded 500ms/);

  await assert.rejects(runAgentReviewAcpSession({
    launch: fakeClientLaunch("idle", {
      startupTimeoutMs: 1_000,
      idleTimeoutMs: 500,
      maxRuntimeMs: null
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_idle_timeout: no ACP activity for 500ms/);

  const progressUpdates: string[] = [];
  const activeWithoutMaximum = await runAgentReviewAcpSession({
    launch: fakeClientLaunch("progress", {
      startupTimeoutMs: 1_000,
      idleTimeoutMs: 500,
      maxRuntimeMs: null
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => true,
    onSession: async () => undefined,
    onUpdate: (update) => progressUpdates.push(update.sessionUpdate)
  });
  assert.equal(activeWithoutMaximum.stopReason, "end_turn");
  assert.equal(progressUpdates.length, 8);
  assert.equal(progressUpdates.every((update) => update === "agent_message_chunk"), true);

  await assert.rejects(runAgentReviewAcpSession({
    launch: fakeClientLaunch("progress-hang", {
      startupTimeoutMs: 1_000,
      idleTimeoutMs: 500,
      maxRuntimeMs: 100
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_max_runtime_timeout: total runtime exceeded 100ms/);
});

test("ACP Client permits silent work with both timeouts disabled and detects transport failures", { timeout: 15_000 }, async () => {
  const input = (mode: string) => ({
    launch: fakeClientLaunch(mode, { startupTimeoutMs: 3_000, idleTimeoutMs: null, maxRuntimeMs: null }),
    prompt: "Review", reminder: "Submit", workspaceRoot: tmpdir(),
    isSubmitted: async () => true, onSession: async () => undefined
  });
  const result = await runAgentReviewAcpSession(input("idle"));
  assert.equal(result.stopReason, "end_turn");
  for (const mode of ["exit-zero", "exit-error", "exit-signal", "disconnect", "stream-error"]) {
    const before = Date.now();
    let provider: ChildProcessWithoutNullStreams | undefined;
    const breakPipe = mode === "disconnect" || mode === "stream-error";
    await assert.rejects(runAgentReviewAcpSession({
      ...input(breakPipe ? "progress-hang" : mode),
      isSubmitted: async () => false,
      onSession: async () => {
        if (breakPipe) {
          assert.equal(provider!.exitCode, null, "the provider must still be alive when its ACP pipe breaks");
          provider!.stdout.destroy(mode === "stream-error" ? new Error("Test disconnected the ACP pipe") : undefined);
        }
      }
    }, {
      spawn: launch => provider = crossSpawn(launch.command, launch.args, {
        cwd: launch.cwd, env: launch.env, stdio: "pipe"
      }) as ChildProcessWithoutNullStreams
    }),
      breakPipe ? /agent_connection_closed:/ : /agent_process_exit:|agent_connection_closed:/);
    assert.ok(Date.now() - before < 5_000, `${mode}: transport failure must not wait for a configured timeout`);
  }
});

async function withAgentReviewFixture(
  mode: "approve" | "no-submit",
  run: (fixture: { configPath: string; runsRoot: string; runId: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-review-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    const home = join(root, "home");
    const projectRoot = join(home, "projects", "review-fixture");
    const memoryRoot = join(projectRoot, "memory");
    const runsRoot = join(projectRoot, "runs");
    const configPath = join(projectRoot, "config.json");
    process.env.MEMSPHERE_HOME = home;
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: projectRoot });
    await writeFile(join(memoryRoot, "procedures", "agent-review.yaml"), withCurrentMemorySyntax(`!procedure
name: agent-review-fixture
asserts:
  - Keep the review evidence traceable.
flow:
  - !action
    action: Produce prior context.
    artifact: !artifact
      name: prior context
      format: markdown
  - !action
    action: Produce a reviewed Artifact.
    asserts:
      - The candidate must be concrete.
    suggests:
      - Prefer a concise candidate.
    artifact: !artifact
      name: reviewed result
      type: object
      format: json
      schema: !schema
        name: reviewed result contract
        type: object
        format: json
        fields:
          - !schema
            name: summary
            type: string
      review: [reviewer]
`));
    await writeFile(join(projectRoot, "project.json"), `${JSON.stringify({
      format_version: 1,
      name: "review-fixture",
      created_at: new Date().toISOString()
    }, null, 2)}\n`);
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: { "review-fixture": { root: projectRoot } },
      workspaces: {}
    }, null, 2)}\n`);
    await writeFile(join(home, "config.json"), `${JSON.stringify({
      language: "en",
      acp_providers: { traex: {} }
    }, null, 2)}\n`);
    await writeFile(configPath, `${JSON.stringify({
      store: { type: "embedded", repository_path: projectRoot, memory_path: "memory" },
      control_plane: {
        runner: {
          permissions: ["artifact.read", "artifact.submit", "decision.decide"]
        },
        actors: {
          "reviewer-agent": {
            kind: "agent",
            name: "Fake Reviewer",
            permissions: ["artifact.read", "decision.decide"],
            system_prompt: "Check the candidate independently.",
            agent: { provider: "traex" }
          }
        }
      }
    }, null, 2)}\n`);
    const config = await readConfig(configPath);
    const reviewer = config.controlPlane?.actors["reviewer-agent"];
    if (!reviewer || reviewer.kind !== "agent") throw new Error("missing reviewer fixture");
    reviewer.agent.command = process.execPath;
    reviewer.agent.args = [fakeReviewer, mode];
    reviewer.agent.startupTimeoutMs = 10_000;
    reviewer.agent.idleTimeoutMs = 10_000;
    reviewer.agent.maxRuntimeMs = null;
    const started = await startRun({
      name: "Test run",
      memoryRoot: config.memoryRoot,
      runsRoot: config.runsRoot,
      language: config.language,
      procedureName: "agent-review-fixture",
      controlPlane: config.controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "agent-review-fixture",
        flowIndexes: [2],
        slots: { reviewer: ["reviewer-agent"] }
      })
    });
    await reportRun({
      runsRoot: config.runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Prior context\nRelevant background." }
    });
    await reportRun({
      runsRoot: config.runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: JSON.stringify({ summary: "Candidate" }) }
    });
    await run({ configPath, runsRoot, runId: started.id });
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}

function agentIdentity(
  providerType: "traex" | "qwen" | "kimi" | "codex",
  args: string[],
  overrides: Partial<Extract<ControlPlaneActor, { kind: "agent" }>["agent"]> = {}
): Extract<ControlPlaneActor, { kind: "agent" }> {
  return {
    kind: "agent",
    name: "Reviewer",
    permissions: ["artifact.read", "decision.assess"],
    agent: {
      provider: providerType,
      providerType,
      command: providerType === "codex" ? "codex-acp" : providerType,
      args,
      env: {},
      startupTimeoutMs: 60_000,
      idleTimeoutMs: null,
      maxRuntimeMs: null,
      ...overrides
    }
  };
}

const fakeAgentReviewProvider: AgentReviewProvider = {
  id: "traex",
  buildLaunch({ actor, workspaceRoot, sessionEnv }) {
    return {
      provider: "fake-test-provider",
      command: actor.agent.command,
      args: [...actor.agent.args],
      cwd: workspaceRoot,
      env: launcherEnv({ MEMSPHERE_HOME: process.env.MEMSPHERE_HOME, ...sessionEnv }),
      startupTimeoutMs: actor.agent.startupTimeoutMs,
      idleTimeoutMs: actor.agent.idleTimeoutMs,
      maxRuntimeMs: actor.agent.maxRuntimeMs,
      promptVersion: "artifact-review-v1",
      model: actor.agent.model
    };
  }
};

function resolveFakeProvider(provider: string | undefined): AgentReviewProvider {
  assert.equal(provider, "traex");
  return fakeAgentReviewProvider;
}

function fakeClientLaunch(
  mode: string,
  timeouts: Pick<AgentReviewProviderLaunch, "startupTimeoutMs" | "idleTimeoutMs" | "maxRuntimeMs">
): AgentReviewProviderLaunch {
  return {
    provider: "fake-test-provider",
    command: process.execPath,
    args: [fakeReviewer, mode],
    cwd: tmpdir(),
    env: launcherEnv(),
    promptVersion: "artifact-review-v1",
    ...timeouts
  };
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

test("Windows queue passes complete multiline messages through direct and npm Node shims", { skip: process.platform !== "win32" }, async t => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { checkQueueCapability } = await import("../../../src/runner/identity.js");
  const { sendQueue } = await import("../../../src/daemon/service.js");
  const directory = await mkdtemp(join(tmpdir(), "queue $& shim "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, "queue.mjs"), output = join(directory, "args.json"), shim = join(directory, "codex.cmd");
  await writeFile(script, `import { writeFileSync } from 'node:fs'; if (process.argv.includes('--help')) console.log('queue --thread --message'); else writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));`);
  const body = '请执行命令以继续：\ncommand "quoted" %percent% & | ^ !';
  for (const source of [
    `@"${process.execPath}" "${script}" %*\r\n`,
    'SET "_prog=%dp0%\\node.exe"\r\nSET "_prog=node"\r\nendLocal & "%_prog%" "%dp0%\\queue.mjs" %*\r\n'
  ]) {
    await writeFile(shim, source);
    await checkQueueCapability(shim);
    await sendQueue(shim, "session", body, directory);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), ["queue", "--thread", "session", "--message", `[Memsphere 自动消息]\n${body}`]);
  }
  await writeFile(shim, '@echo unknown %*\r\n');
  await assert.rejects(checkQueueCapability(shim), /QUEUE_BATCH_UNSUPPORTED/);
});


// Session authorization is exercised against real persisted Assignments in
// reviewer-session-integration.test.ts, rather than an argv-recording fake CLI.
test("Agent Review launcher preserves CLI arguments without injecting a second protocol", async () => {
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeArgsCli });
  try {
    for (const args of [
      ["--project", "bound", "run", "artifact", "show", "--run", "R", "--artifact", "A", "--out", "copy.md"],
      ["memory", "list", "--output=json"],
      ["memory", "read", "p", "--run=R", "--project=bound"],
      ["memory", "list", "--", "--project", "literal-name"]
    ]) {
      const result = crossSpawn.sync(runtime.launcherPath, args, { encoding: "utf8", env: launcherEnv({ MEMSPHERE_REVIEW_ASSIGNMENT_ID: "A" }) });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), args);
    }
  } finally { await runtime.cleanup(); }
});


test("Agent Review launcher runs the fixed CLI in one Node process and preserves its identity and exit code", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-cli identity % # -"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entrypoint = join(directory, "fixed cli.mjs");
  await writeFile(entrypoint, `if (!process.argv.includes("--version")) {
    console.log(JSON.stringify({ pid: process.pid, parent: process.ppid, entrypoint: process.argv[1], module: import.meta.url, args: process.argv.slice(2), cwd: process.cwd(), token: process.env.MEMSPHERE_TEST_LAUNCH_TOKEN }));
    process.exitCode = 23;
  }`);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: entrypoint });
  t.after(() => runtime.cleanup());
  const args = ["--project", "bound", "run", "artifact", "show", "--", "literal argument"];
  const result = crossSpawn.sync(runtime.launcherPath, args, { cwd: directory, encoding: "utf8", env: launcherEnv({ MEMSPHERE_TEST_LAUNCH_TOKEN: "kept" }) });
  assert.ifError(result.error);
  assert.equal(result.status, 23, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(process.platform === "win32" ? actual.parent : actual.pid, result.pid);
  assert.equal(await realpath(actual.entrypoint), await realpath(entrypoint));
  assert.equal(await realpath(fileURLToPath(actual.module)), await realpath(entrypoint));
  assert.equal(await realpath(actual.cwd), await realpath(directory));
  assert.deepEqual(actual.args, args);
  assert.equal(actual.token, "kept");
});


test("Windows PowerShell, CMD, and Git Bash execute Agent Review read, comment, and vote commands", {
  skip: process.platform !== "win32"
}, async () => {
  const prerequisites = await assertWindowsPrerequisites();
  assert(prerequisites);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeArgsCli });
  const env = launcherEnv({
    PATH: `${runtime.directory};${process.env.PATH ?? ""}`,
    MEMSPHERE_REVIEW_RUN_ID: "bound-run",
    MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment"
  });
  try {
    const reviewCommands = [
      "memsphere run artifact show --output json",
      "memsphere run artifact contract show --output json",
      "memsphere run review assignment show --output json",
      "memsphere run review comment --severity suggestion --body shell-smoke --output json",
      "memsphere run review submit --vote approve --summary shell-smoke --output json"
    ];
    for (const [command, prefix] of [
      ["powershell.exe", ["-NoProfile", "-Command"]],
      ["pwsh.exe", ["-NoProfile", "-Command"]],
      ["cmd.exe", ["/d", "/s", "/c"]],
      [prerequisites.gitBashPath, ["-lc"]]
    ] as const) {
      for (const reviewCommand of reviewCommands) {
        const result = crossSpawn.sync(command, [...prefix, reviewCommand], { encoding: "utf8", env });
        assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
        assert.deepEqual(JSON.parse(result.stdout), reviewCommand.split(" ").slice(1));
      }
    }
  } finally {
    await runtime.cleanup();
  }
});
test("caller cancellation captures the live Provider and waits for its shutdown", { timeout: 15000 }, async t => {
  const controller = new AbortController();
  let provider: ChildProcessWithoutNullStreams | undefined;
  let captured = 0;
  await assert.rejects(runAgentReviewAcpSession({
    launch: fakeClientLaunch("progress-hang", { startupTimeoutMs: 3000, idleTimeoutMs: null, maxRuntimeMs: null }),
    signal: AbortSignal.any([controller.signal, t.signal]),
    prompt: "Review", reminder: "Submit", workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => { controller.abort(new Error("fixture canceled")); },
    onPrompt: () => assert.fail("a canceled Session cannot advance to its prompt"),
    onBeforeStop: async pid => {
      captured++;
      assert.equal(pid, provider!.pid);
      assert.equal(provider!.exitCode, null, "capture ownership before requesting termination");
    }
  }, { spawn: launch => provider = crossSpawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: "pipe" }) as ChildProcessWithoutNullStreams }), /fixture canceled/);
  assert.equal(captured, 1);
  assert.ok(provider!.exitCode !== null || provider!.signalCode !== null, "owned Provider exits before fixture reclamation");
});
