import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { artifactReviewAssignmentId } from "../src/artifact-review.js";
import { readConfig } from "../src/config.js";
import { currentArtifactReview, readRun, reportRun, retryArtifactReviewAgentAssignment, startRun } from "../src/run/store.js";
import { runArtifactReviewAgentWorker } from "../src/acp/review-worker.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import {
  getAgentReviewProvider,
  type AgentReviewProvider,
  type AgentReviewProviderLaunch
} from "../src/acp/provider.js";
import { runAgentReviewAcpSession } from "../src/acp/client.js";
import { agentActivityRawPath, readAgentActivitySnapshot } from "../src/acp/activity.js";
import { tryRunArtifactReviewAgents } from "../src/acp/debug.js";
import { dispatchArtifactReviewAgents } from "../src/acp/dispatcher.js";
import type { ControlPlaneActor } from "../src/control-plane/index.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { createViewServer } from "../src/commands/view.js";
import { reviewConfiguration } from "./helpers/review.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeReviewer = join(testDirectory, "fixtures", "fake-acp-reviewer.mjs");
const fakeCli = join(testDirectory, "fixtures", "fake-review-cli.mjs");

test("ACP Agent Reviewer completes its bound Assignment through the Session CLI", async () => {
  await withAgentReviewFixture("approve", async ({ configPath, runsRoot, runId }) => {
    const before = await readRun(runsRoot, runId);
    const review = currentArtifactReview(before);
    assert(review);
    const round = review.rounds[0];
    const assignment = round.assignments[0];
    assert.equal(assignment.actorKind, "agent");
    assert.equal(assignment.status, "queued");

    await runArtifactReviewAgentWorker({
      config: configPath,
      review: review.id,
      round: round.id,
      assignment: artifactReviewAssignmentId(assignment),
      nodeExecutable: process.execPath,
      cliEntrypoint: fakeCli,
      providerResolver: resolveFakeProvider
    });

    const after = await readRun(runsRoot, runId);
    const completed = currentArtifactReview(after);
    assert(completed);
    const completedAssignment = completed.rounds[0].assignments[0];
    assert.equal(
      completedAssignment.status,
      "submitted",
      JSON.stringify(completedAssignment.attempts?.[0]?.failure)
    );
    assert.equal(completedAssignment.submitted?.vote, "approve");
    assert.equal(completedAssignment.submitted?.summary, "Fake ACP review completed");
    assert.equal(completedAssignment.attempts?.[0]?.status, "submitted");
    assert.match(completedAssignment.attempts?.[0]?.sessionId ?? "", /^fake-/);
    assert.equal(completedAssignment.attempts?.[0]?.protocolVersion, 1);
    assert(completedAssignment.attempts?.[0]?.cliReadyAt);
    assert.equal(completedAssignment.attempts?.[0]?.stopReason, "end_turn");
    assert.equal(completed.status, "awaiting_runner_vote");
    const activityLocation = {
      runsRoot,
      runId,
      reviewId: review.id,
      roundId: round.id,
      assignmentId: artifactReviewAssignmentId(assignment),
      attemptId: completedAssignment.attempts?.[0]?.id ?? ""
    };
    const activity = await readAgentActivitySnapshot(activityLocation);
    assert.equal(activity.events.some((event) => event.kind === "message"), true);
    assert.equal(activity.events.find((event) => event.kind === "tool")?.status, "completed");
    assert.equal(activity.events.some((event) => event.kind === "plan"), true);
    assert.doesNotMatch(JSON.stringify(activity), /rawInput|rawOutput|private/);
    const rawRecords = (await readFile(agentActivityRawPath(activityLocation), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { prompt?: { kind: string; text: string } });
    assert.deepEqual(rawRecords.filter((record) => record.prompt).map((record) => record.prompt?.kind), ["initial"]);
    assert.match(rawRecords.find((record) => record.prompt)?.prompt?.text ?? "", /# Memsphere Artifact Reviewer/);
    assert.doesNotMatch(JSON.stringify(activity), /# Memsphere Artifact Reviewer/);

    const config = await readConfig(configPath);
    const server = createViewServer(config);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert(address && typeof address === "object");
      const activityUrl = `http://127.0.0.1:${address.port}/api/artifact-reviews/${review.id}`
        + `/rounds/${round.id}/assignments/${assignment.actorId}/attempts/1/activity`;
      const response = await fetch(`${activityUrl}?cursor=0&limit=500`);
      assert.equal(response.status, 200);
      const payload = await response.json() as { events: Array<{ kind: string }>; summary?: { text: string } };
      assert.equal(payload.events.some((event) => event.kind === "tool"), true);
      assert(payload.summary?.text);
      assert.equal((await fetch(activityUrl.replace("/attempts/1/", "/attempts/99/"))).status, 404);
      assert.equal((await fetch(`${activityUrl}?cursor=-1`)).status, 400);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

test("ACP Agent Reviewer failure is visible and can be requeued explicitly", async () => {
  await withAgentReviewFixture("no-submit", async ({ configPath, runsRoot, runId }) => {
    const before = await readRun(runsRoot, runId);
    const review = currentArtifactReview(before);
    assert(review);
    const round = review.rounds[0];
    const assignment = round.assignments[0];

    await runArtifactReviewAgentWorker({
      config: configPath,
      review: review.id,
      round: round.id,
      assignment: artifactReviewAssignmentId(assignment),
      nodeExecutable: process.execPath,
      cliEntrypoint: fakeCli,
      providerResolver: resolveFakeProvider
    });

    const failedRun = await readRun(runsRoot, runId);
    const failedReview = currentArtifactReview(failedRun);
    assert(failedReview);
    const failed = failedReview.rounds[0].assignments[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts?.[0]?.failure?.code, "agent_submission_missing");
    const rawRecords = (await readFile(agentActivityRawPath({
      runsRoot,
      runId,
      reviewId: review.id,
      roundId: round.id,
      assignmentId: artifactReviewAssignmentId(assignment),
      attemptId: failed.attempts?.[0]?.id ?? ""
    }), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { prompt?: { kind: string; text: string } });
    assert.deepEqual(
      rawRecords.filter((record) => record.prompt).map((record) => record.prompt?.kind),
      ["initial", "reminder"]
    );

    const retried = await retryArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: failedReview.id,
      roundId: failedReview.currentRoundId,
      actorId: artifactReviewAssignmentId(failed)
    });
    assert.equal(retried.assignment.status, "queued");
    assert.equal(retried.assignment.attempts?.length, 2);
    assert.equal(retried.attempt.status, "queued");
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
    const prompt = await readFile(join(directory, "prompt.md"), "utf8");
    assert.equal(launch.processStarted, false);
    assert.equal(launch.actorId, "reviewer-agent");
    assert.equal(launch.provider, "traex");
    assert.deepEqual((launch.args as string[]).slice(0, 4), ["--sandbox", "workspace-write", "--ask-for-approval", "never"]);
    assert.match(prompt, /# Memsphere Artifact Reviewer/);
    assert.match(prompt, /## Role\nCheck the candidate independently\./);
    assert.match(prompt, /## Overview/);
    assert.match(prompt, /Role is a review lens, not a limit on scope/);
    assert.match(prompt, /do not treat the candidate summary, prior validation report, or another reviewer's conclusion as proof/);
    assert.match(prompt, /## Review contract/);
    assert.match(prompt, /### Action\nProduce a reviewed Artifact\./);
    assert.match(prompt, /### Procedure assertions\n- Keep the review evidence traceable\./);
    assert.match(prompt, /### Action assertions\n- The candidate must be concrete\./);
    assert.match(prompt, /### Suggestions\n- Prefer a concise candidate\./);
    assert.match(prompt, /- Name: reviewed result/);
    assert.match(prompt, /- Schema: Inline; type object; format json; 1 top-level field/);
    assert.doesNotMatch(prompt, /## Artifact\n```json/);
    assert.match(prompt, /run artifact show --assignment "\$MEMSPHERE_REVIEW_ASSIGNMENT_ID"/);
    assert.match(prompt, /run artifact show --run "\$MEMSPHERE_REVIEW_RUN_ID" --step "<step-ref>"/);
    assert.match(prompt, /run artifact contract show --assignment "\$MEMSPHERE_REVIEW_ASSIGNMENT_ID"/);
    assert.match(prompt, /run review assignment show --assignment "\$MEMSPHERE_REVIEW_ASSIGNMENT_ID"/);
    assert.match(prompt, /Comment bodies use Markdown/);
    assert.match(prompt, /run review comment --assignment "\$MEMSPHERE_REVIEW_ASSIGNMENT_ID" --severity <blocking\|risk\|suggestion> --body-stdin --output json <<'MEMSPHERE_COMMENT'/);
    assert.match(prompt, /Do not encode line breaks as literal `\\n` sequences/);
    assert.match(prompt, /## Earlier Artifacts\n- flow\[1\]: prior context/);
    assert.match(prompt, /trace backward through Artifacts already produced in this Run/);
    assert.match(prompt, /Check every assertion in the frozen Review contract before voting/);
    assert.match(prompt, /For each unmet assertion, preserve at least one concrete comment/);
    assert.match(prompt, /## Review method/);
    assert.match(prompt, /explain the basis for the vote and any residual risks/);
    assert.match(prompt, /Do not stop after finding the first issue/);
    assert.match(prompt, /complete a coverage pass across every contract assertion/);
    assert.match(prompt, /same defect pattern and adjacent boundary cases/);
    assert.match(prompt, /every substantiated finding discovered in this round has been recorded/);
    assert.match(prompt, /Do not invent a finding merely to avoid an empty comment list/);
    assert.doesNotMatch(JSON.stringify(launch), /MEMSPHERE_REVIEW_ENDPOINT|MEMSPHERE_REVIEW_CAPABILITY|bridge\.sock/);
    assert.match(prompt, /run step show --run "\$MEMSPHERE_REVIEW_RUN_ID" --step "<step-ref>"/);
    assert.doesNotMatch(prompt, /Identity:|Binding:|Decision policy:|Candidate Artifact and contract|Required workflow/);
    assert.doesNotMatch(prompt, /reviewer-agent|round-|assignment-/);
    await assert.rejects(
      tryRunArtifactReviewAgents({
        config: { ...config, debug: { agentReview: false, root: debugRoot } },
        run: before
      }),
      /requires debug\.agent_review=true/
    );
  });
});

test("Agent Review CLI launcher rejects commands outside the Session allowlist", async () => {
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeCli });
  try {
    const denied = spawnSync(runtime.launcherPath, ["run", "report", "--run", "other"], {
      encoding: "utf8",
      env: process.env
    });
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /not allowed/);

    const wrongRun = spawnSync(runtime.launcherPath, ["run", "show", "--run", "other"], {
      encoding: "utf8",
      env: { ...process.env, MEMSPHERE_REVIEW_RUN_ID: "bound-run" }
    });
    assert.equal(wrongRun.status, 2);

    const wrongStepRun = spawnSync(runtime.launcherPath, ["run", "step", "show", "--run", "other", "--step", "flow[1]"], {
      encoding: "utf8",
      env: { ...process.env, MEMSPHERE_REVIEW_RUN_ID: "bound-run" }
    });
    assert.equal(wrongStepRun.status, 2);

    const wrongAssignment = spawnSync(runtime.launcherPath, [
      "run", "review", "assignment", "show", "--assignment", "other"
    ], {
      encoding: "utf8",
      env: { ...process.env, MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment" }
    });
    assert.equal(wrongAssignment.status, 2);
  } finally {
    await runtime.cleanup();
  }
});

test("Traex Provider fixes the ACP process to workspace-write non-interactive execution", () => {
  const provider = getAgentReviewProvider("traex");
  const launch = provider.buildLaunch({
    actor: agentIdentity("traex", ["acp", "serve"], { model: "review-model" }),
    workspaceRoot: "/workspace",
    sessionEnv: { MEMSPHERE_CLI: "/tmp/memsphere-review" }
  });
  assert.deepEqual(launch.args, [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "never",
    "--model", "review-model",
    "acp", "serve"
  ]);
  assert.equal(launch.env.MEMSPHERE_CLI, "/tmp/memsphere-review");
  assert.match(launch.env.NO_PROXY ?? "", /(?:^|,)bytedance\.net(?:,|$)/);
  assert.match(launch.env.NO_PROXY ?? "", /(?:^|,)trae\.com\.cn(?:,|$)/);
  assert.equal(launch.env.no_proxy, launch.env.NO_PROXY);
  assert.equal(launch.startupTimeoutMs, 60_000);
  assert.equal(launch.idleTimeoutMs, 120_000);
  assert.equal(launch.maxRuntimeMs, null);

  const unlimited = provider.buildLaunch({
    actor: agentIdentity("traex", [], {
      startupTimeoutMs: 5_000,
      idleTimeoutMs: 15_000,
      maxRuntimeMs: null
    }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  });
  assert.equal(unlimited.startupTimeoutMs, 5_000);
  assert.equal(unlimited.idleTimeoutMs, 15_000);
  assert.equal(unlimited.maxRuntimeMs, null);

  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", ["--sandbox=danger-full-access"]),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /managed security argument/);
  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", ["exec"]),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /cannot launch the 'exec' subcommand/);
  assert.throws(() => provider.buildLaunch({
    actor: agentIdentity("traex", [], { cwd: "../outside" }),
    workspaceRoot: "/workspace",
    sessionEnv: {}
  }), /cwd must stay inside the workspace/);
});

test("ACP Client reports a missing Provider executable as a process startup failure", async () => {
  await assert.rejects(runAgentReviewAcpSession({
    launch: {
      provider: "traex",
      command: join(tmpdir(), `missing-acp-${Date.now()}`),
      args: [],
      cwd: tmpdir(),
      env: process.env,
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
      env: process.env,
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
      startupTimeoutMs: 30,
      idleTimeoutMs: 1_000,
      maxRuntimeMs: null
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_startup_timeout: startup exceeded 30ms/);

  await assert.rejects(runAgentReviewAcpSession({
    launch: fakeClientLaunch("idle", {
      startupTimeoutMs: 1_000,
      idleTimeoutMs: 40,
      maxRuntimeMs: null
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_idle_timeout: no ACP activity for 40ms/);

  const progressUpdates: string[] = [];
  const activeWithoutMaximum = await runAgentReviewAcpSession({
    launch: fakeClientLaunch("progress", {
      startupTimeoutMs: 1_000,
      idleTimeoutMs: 40,
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
      idleTimeoutMs: 40,
      maxRuntimeMs: 100
    }),
    prompt: "Review",
    reminder: "Submit",
    workspaceRoot: tmpdir(),
    isSubmitted: async () => false,
    onSession: async () => undefined
  }), /agent_max_runtime_timeout: total runtime exceeded 100ms/);
});

async function withAgentReviewFixture(
  mode: "approve" | "no-submit",
  run: (fixture: { configPath: string; runsRoot: string; runId: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-review-"));
  try {
    const scopeRoot = join(root, ".memsphere");
    const memoryRoot = join(scopeRoot, "memory");
    const runsRoot = join(scopeRoot, "runs");
    const configPath = join(scopeRoot, "config.json");
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
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
    await writeFile(configPath, `${JSON.stringify({
      memoryRoot: "memory",
      runsRoot: "runs",
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
            agent: { provider: "traex", command: process.execPath, args: [fakeReviewer, mode], timeout_ms: 10_000 }
          }
        }
      }
    }, null, 2)}\n`);
    const config = await readConfig(configPath);
    const started = await startRun({
      memoryRoot: config.memoryRoot,
      runsRoot: config.runsRoot,
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
    await rm(root, { recursive: true, force: true });
  }
}

function agentIdentity(
  provider: "traex",
  args: string[],
  overrides: Partial<Extract<ControlPlaneActor, { kind: "agent" }>["agent"]> = {}
): Extract<ControlPlaneActor, { kind: "agent" }> {
  return {
    kind: "agent",
    name: "Reviewer",
    permissions: ["artifact.read", "decision.assess"],
    agent: { provider, command: "traecli", args, ...overrides }
  };
}

const fakeAgentReviewProvider: AgentReviewProvider = {
  id: "fake-test-provider",
  buildLaunch({ actor, workspaceRoot, sessionEnv }) {
    return {
      provider: "fake-test-provider",
      command: actor.agent.command,
      args: [...actor.agent.args],
      cwd: workspaceRoot,
      env: { ...process.env, ...sessionEnv },
      startupTimeoutMs: actor.agent.startupTimeoutMs ?? 10_000,
      idleTimeoutMs: actor.agent.idleTimeoutMs ?? 10_000,
      maxRuntimeMs: actor.agent.maxRuntimeMs ?? null,
      promptVersion: actor.agent.promptVersion ?? "artifact-review-v1",
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
    env: process.env,
    promptVersion: "artifact-review-v1",
    ...timeouts
  };
}
