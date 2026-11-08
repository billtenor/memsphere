import assert from "node:assert/strict";
import crossSpawn from "cross-spawn";

import { once } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { artifactReviewAssignmentId } from "../../../src/artifact-review.js";
import { readConfig } from "../../../src/config.js";
import { currentArtifactReview, readRun, reportRun, retryArtifactReviewAgentAssignment, startRun } from "../../../src/run/store.js";
import { runArtifactReviewAgentWorker } from "../../../src/acp/review-worker.js";
import { createAgentReviewCliRuntime } from "../../../src/acp/cli-runtime.js";
import { getAgentReviewProvider, type AgentReviewProvider, type AgentReviewProviderLaunch } from "../../../src/acp/provider.js";

import { agentActivityRawPath, readAgentActivitySnapshot } from "../../../src/acp/activity.js";


import type { ControlPlaneActor } from "../../../src/control-plane/index.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";
import { createViewServer } from "../../../src/commands/view.js";
import { reviewConfiguration } from "../../helpers/review.js";
import { runGit } from "../../../src/git.js";
import { assertWindowsPrerequisites } from "../../../src/windows-prerequisites.js";

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

test("ACP Agent Reviewer completes its bound Assignment through the Session CLI", async () => {
  await withAgentReviewFixture("approve", async ({ configPath, runsRoot, runId }) => {
    const before = await readRun(runsRoot, runId);
    const review = currentArtifactReview(before);
    assert(review);
    const round = review.rounds[0];
    const assignment = round.assignments[0];
    assert.equal(assignment.actorKind, "agent");
    assert.equal(assignment.status, "queued");

    let callerDirectory = dirname(configPath);
    if (process.platform !== "win32") {
      const alias = join(callerDirectory, "caller-alias");
      await symlink(callerDirectory, alias, "dir");
      callerDirectory = alias;
    }
    let attemptDirectory: string | undefined;
    await runArtifactReviewAgentWorker({
      config: configPath,
      review: review.id,
      round: round.id,
      assignment: artifactReviewAssignmentId(assignment),
      nodeExecutable: process.execPath,
      cliEntrypoint: fakeCli,
      workspaceRoot: callerDirectory,
      providerResolver: () => ({ id: "traex", buildLaunch(input) {
        attemptDirectory = input.workspaceRoot;
        return fakeAgentReviewProvider.buildLaunch(input);
      } })
    });
    assert.ok(attemptDirectory);
    await assert.rejects(readdir(attemptDirectory), { code: "ENOENT" });

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
    assert.doesNotMatch(JSON.stringify(activity), /rawInput|rawOutput|"private"\s*:/);
    const rawRecords = (await readFile(agentActivityRawPath(activityLocation), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { prompt?: { kind: string; text: string } });
    assert.deepEqual(rawRecords.filter((record) => record.prompt).map((record) => record.prompt?.kind), ["initial"]);
    assert.match(rawRecords.find((record) => record.prompt)?.prompt?.text ?? "", /# Memsphere progressive Artifact review/);
    assert.doesNotMatch(JSON.stringify(activity), /# Memsphere progressive Artifact review/);

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

test("ACP Agent Reviewer preserves invalid Provider argument failures", async () => {
  await withAgentReviewFixture("approve", async ({ configPath, runsRoot, runId }) => {
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
      providerResolver: () => ({
        id: "qwen",
        buildLaunch(input) {
          const actor = structuredClone(input.actor);
          actor.agent.providerType = "qwen";
          actor.agent.command = "qwen";
          actor.agent.args = ["--acp"];
          return getAgentReviewProvider("qwen").buildLaunch({ ...input, actor });
        }
      })
    });

    const failedReview = currentArtifactReview(await readRun(runsRoot, runId));
    assert(failedReview);
    const failed = failedReview.rounds[0].assignments[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts?.[0]?.failure?.code, "agent_provider_arguments_invalid");
    assert.equal(failed.attempts?.[0]?.failure?.category, "provider");
    assert.match(failed.attempts?.[0]?.failure?.message ?? "", /does not allow managed argument '--acp'/);
  });
});

test("Agent Review CLI launcher rejects commands outside the Session allowlist", async () => {
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeCli });
  try {
    const denied = crossSpawn.sync(runtime.launcherPath, ["run", "report", "--run", "other"], {
      encoding: "utf8",
      env: launcherEnv()
    });
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /not allowed/);

    const wrongRun = crossSpawn.sync(runtime.launcherPath, ["run", "show", "--run", "other"], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_RUN_ID: "bound-run" })
    });
    assert.equal(wrongRun.status, 2);

    const wrongStepRun = crossSpawn.sync(runtime.launcherPath, ["run", "step", "show", "--run", "other", "--step", "flow[1]"], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_RUN_ID: "bound-run" })
    });
    assert.equal(wrongStepRun.status, 2);

    const wrongMemoryRun = crossSpawn.sync(runtime.launcherPath, ["memory", "list", "--run", "other"], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_MEMORY_RUN_ID: "bound-run" })
    });
    assert.equal(wrongMemoryRun.status, 2);

    const wrongEqualsMemoryRun = crossSpawn.sync(runtime.launcherPath, ["memory", "read", "example", "--run=other"], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_MEMORY_RUN_ID: "bound-run" })
    });
    assert.equal(wrongEqualsMemoryRun.status, 2);

    const duplicateMemoryRun = crossSpawn.sync(runtime.launcherPath, [
      "memory", "list", "--run", "bound-run", "--run=other"
    ], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_MEMORY_RUN_ID: "bound-run" })
    });
    assert.equal(duplicateMemoryRun.status, 2);

    const wrongAssignment = crossSpawn.sync(runtime.launcherPath, [
      "run", "review", "assignment", "show", "--assignment", "other"
    ], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment" })
    });
    assert.equal(wrongAssignment.status, 2);

    const wrongEqualsAssignment = crossSpawn.sync(runtime.launcherPath, [
      "run", "review", "assignment", "show", "--assignment=other"
    ], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment" })
    });
    assert.equal(wrongEqualsAssignment.status, 2);

    const wrongContractAssignment = crossSpawn.sync(runtime.launcherPath, [
      "run", "artifact", "contract", "show", "--assignment", "other"
    ], {
      encoding: "utf8",
      env: launcherEnv({ MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment" })
    });
    assert.equal(wrongContractAssignment.status, 2);

    const unboundEnv = launcherEnv();
    const missingBinding = crossSpawn.sync(runtime.launcherPath, [
      "run", "artifact", "show", "--output", "json"
    ], { encoding: "utf8", env: unboundEnv });
    assert.equal(missingBinding.status, 2);

    const unboundMemoryRun = crossSpawn.sync(runtime.launcherPath, ["memory", "read", "example", "--run", "other"], {
      encoding: "utf8",
      env: unboundEnv
    });
    assert.equal(unboundMemoryRun.status, 2);

    const unboundEqualsMemoryRun = crossSpawn.sync(runtime.launcherPath, ["memory", "read", "example", "--run=other"], {
      encoding: "utf8",
      env: unboundEnv
    });
    assert.equal(unboundEqualsMemoryRun.status, 2);
  } finally {
    await runtime.cleanup();
  }
});

test("Agent Review CLI launcher injects Session bindings without shell environment syntax", async () => {
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeArgsCli });
  const env = launcherEnv({
    MEMSPHERE_REVIEW_RUN_ID: "bound-run",
    MEMSPHERE_REVIEW_MEMORY_RUN_ID: "bound-run",
    MEMSPHERE_REVIEW_ASSIGNMENT_ID: "bound-assignment"
  });
  try {
    const current = crossSpawn.sync(runtime.launcherPath, ["run", "artifact", "show", "--output", "json"], {
      encoding: "utf8",
      env
    });
    assert.equal(current.status, 0);
    assert.deepEqual(JSON.parse(current.stdout.trim()), [
      "run", "artifact", "show", "--output", "json", "--assignment", "bound-assignment"
    ]);

    const prior = crossSpawn.sync(runtime.launcherPath, [
      "run", "artifact", "show", "--step", "flow[1]", "--output", "json"
    ], { encoding: "utf8", env });
    assert.equal(prior.status, 0);
    assert.deepEqual(JSON.parse(prior.stdout.trim()), [
      "run", "artifact", "show", "--step", "flow[1]", "--output", "json", "--run", "bound-run"
    ]);

    const memory = crossSpawn.sync(runtime.launcherPath, ["memory", "read", "example", "--output", "json"], {
      encoding: "utf8",
      env
    });
    assert.equal(memory.status, 0);
    assert.deepEqual(JSON.parse(memory.stdout.trim()), [
      "memory", "read", "example", "--output", "json"
    ]);

    const equalsMemory = crossSpawn.sync(runtime.launcherPath, [
      "memory", "read", "example", "--run=bound-run", "--output", "json"
    ], { encoding: "utf8", env });
    assert.equal(equalsMemory.status, 0);
    assert.deepEqual(JSON.parse(equalsMemory.stdout.trim()), [
      "memory", "read", "example", "--run=bound-run", "--output", "json"
    ]);

    const regularEnv = { ...env };
    delete regularEnv.MEMSPHERE_REVIEW_MEMORY_RUN_ID;
    const regularMemory = crossSpawn.sync(runtime.launcherPath, ["memory", "list", "--output", "json"], {
      encoding: "utf8",
      env: regularEnv
    });
    assert.equal(regularMemory.status, 0);
    assert.deepEqual(JSON.parse(regularMemory.stdout.trim()), ["memory", "list", "--output", "json"]);
  } finally {
    await runtime.cleanup();
  }
});

test("Agent Review CLI reads the Session manifest and binds Project and ordinary or frozen Memory scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-session-manifest-"));
  const configPath = join(root, "config.json");
  await writeFile(configPath, "{}");
  await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "session-project" }));
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeArgsCli });
  const invoke = (args: string[], env: NodeJS.ProcessEnv) => {
    const result = crossSpawn.sync(runtime.launcherPath, args, { encoding: "utf8", env });
    assert.ifError(result.error);
    return result;
  };
  try {
    for (const frozen of [false, true]) {
      const env = launcherEnv({ MEMSPHERE_CONFIG_PATH: configPath, MEMSPHERE_REVIEW_RUN_ID: "session-run",
        ...(frozen ? { MEMSPHERE_REVIEW_MEMORY_RUN_ID: "frozen-run" } : {}) });
      for (const command of ["list", "read"]) {
        const args = ["memory", command, ...(command === "read" ? ["example"] : []), "--output=json"];
        const injected = invoke(args, env);
        assert.equal(injected.status, 0, injected.stderr);
        assert.equal(injected.stderr, "");
        assert.deepEqual(JSON.parse(injected.stdout), [...args, "--project", "session-project"]);
        for (const explicit of [["--project", "session-project"], ["--project=session-project"]]) {
          const matched = invoke([...args, ...explicit], env);
          assert.equal(matched.status, 0, matched.stderr);
          assert.deepEqual(JSON.parse(matched.stdout), [...args, ...explicit]);
        }
        for (const deniedArgs of [
          ["--project", "other"], ["--project=other"], ["--project", "session-project", "--project=other"],
          ["--run", "other"], ["--run=frozen-run", "--run=other"], ...(frozen ? [] : [["--run", "session-run"]])
        ]) {
          const denied = invoke([...args, ...deniedArgs], env);
          assert.equal(denied.status, command === "list" ? 1 : 2, denied.stderr);
          assert.equal(denied.stdout, "");
          if (command === "list") assert.equal(JSON.parse(denied.stderr).error.code, "REVIEW_SESSION_DENIED");
          else assert.match(denied.stderr, /not allowed/);
        }
        if (frozen) for (const explicitRun of [["--run", "frozen-run"], ["--run=frozen-run"]]) {
          const matched = invoke([...args, ...explicitRun], env);
          assert.equal(matched.status, 0, matched.stderr);
          assert.deepEqual(JSON.parse(matched.stdout), [...args, ...explicitRun, "--project", "session-project"]);
        }
      }
      const literalArgs = ["memory", "list", "--output=json", "--", "--project", "literal-name"];
      const literal = invoke(literalArgs, env);
      assert.equal(literal.status, 0, literal.stderr);
      assert.deepEqual(JSON.parse(literal.stdout), ["memory", "list", "--output=json",
        "--project", "session-project", "--", "--project", "literal-name"]);
    }
  } finally { await runtime.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test("Agent Review CLI refuses missing, malformed and unidentified Session manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-invalid-session-manifest-"));
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fakeArgsCli });
  try {
    const manifest = join(root, "project.json");
    for (const source of [undefined, "invalid JSON", "{}", '{"name":""}', '{"name":42}']) {
      if (source === undefined) await rm(manifest, { force: true });
      else await writeFile(manifest, source);
      for (const frozen of [false, true]) for (const command of ["list", "read"]) {
        const result = crossSpawn.sync(runtime.launcherPath, ["memory", command, ...(command === "read" ? ["example"] : []), "--output=json"], {
          encoding: "utf8", env: launcherEnv({ MEMSPHERE_CONFIG_PATH: join(root, "config.json"),
            ...(frozen ? { MEMSPHERE_REVIEW_MEMORY_RUN_ID: "frozen-run" } : {}) })
        });
        assert.ifError(result.error);
        assert.equal(result.status, command === "list" ? 1 : 2, result.stderr);
        assert.equal(result.stdout, "");
        if (command === "list") assert.equal(JSON.parse(result.stderr).error.code, "REVIEW_SESSION_INVALID");
        else assert.match(result.stderr, /Session Project identity is unavailable/);
      }
    }
  } finally { await runtime.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test("Agent Review CLI reads live and frozen Memory from its actual Session Project", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-session-memory-"));
  const projectRoot = join(root, "projects", "session-project");
  const configPath = join(projectRoot, "config.json");
  const memoryRoot = join(projectRoot, "memory");
  const runId = "run-frozen-session";
  const runRoot = join(projectRoot, "runs", runId);
  for (const directory of ["concepts", "statements", "schemas", "procedures"].map(kind => join(memoryRoot, kind))) await mkdir(directory, { recursive: true });
  await mkdir(join(runRoot, "memory", "concepts"), { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({ format_version: 1, name: "session-project", created_at: "2026-01-01T00:00:00.000Z" }));
  await writeFile(configPath, JSON.stringify({ store: { type: "embedded", repository_path: projectRoot, memory_path: "memory" } }));
  await writeFile(join(root, "registry.json"), JSON.stringify({ format_version: 1, projects: { "session-project": { root: projectRoot } }, workspaces: {} }));
  await writeFile(join(memoryRoot, "concepts", "live.yaml"), withCurrentMemorySyntax("!concept\nnames: [live]\ndefines: [Live Session Memory.]\n"));
  await writeFile(join(runRoot, "memory", "concepts", "frozen.yaml"), withCurrentMemorySyntax("!concept\nnames: [frozen]\ndefines: [Frozen Session Memory.]\n"));
  await writeFile(join(runRoot, `${runId}.json`), JSON.stringify({
    contractVersion: 3, id: runId, name: "Frozen Session", status: "running", procedureName: "probe", memoryRoot,
    memorySource: { kind: "changeset", project: "session-project", changeId: "change-session", checkpointDigest: "fixture", baseRevision: "fixture" },
    memorySnapshot: { path: "memory", files: [`${runId}/memory/concepts/frozen.yaml`] }, createdAt: "2026-01-01", updatedAt: "2026-01-01", stack: [], events: [], procedureSnapshots: {}
  }));
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: join(testDirectory, "../dist/cli.js") });
  const invoke = (args: string[], env: NodeJS.ProcessEnv) => {
    const result = crossSpawn.sync(runtime.launcherPath, args, { cwd: projectRoot, encoding: "utf8", env });
    assert.ifError(result.error);
    return result;
  };
  try {
    for (const frozen of [false, true]) {
      const env = launcherEnv({ MEMSPHERE_HOME: root, MEMSPHERE_CONFIG_PATH: configPath, MEMSPHERE_REVIEW_RUN_ID: "session-run",
        ...(frozen ? { MEMSPHERE_REVIEW_MEMORY_RUN_ID: runId } : {}) });
      const currentProject = invoke(["memory", "list", "--output=json"], env);
      assert.equal(currentProject.status, 0, currentProject.stderr);
      assert.deepEqual(JSON.parse(currentProject.stdout).items.map((item: { reference: string }) => item.reference), ["concepts/live"]);
      const listed = invoke(["memory", "list", ...(frozen ? ["--run", runId] : []), "--output=json"], env);
      assert.equal(listed.status, 0, listed.stderr);
      assert.deepEqual(JSON.parse(listed.stdout).items.map((item: { reference: string; project_name: string }) => [item.reference, item.project_name]),
        [[frozen ? "concepts/frozen" : "concepts/live", "session-project"]]);
      const read = invoke(["memory", "read", frozen ? "frozen" : "live", ...(frozen ? ["--run", runId] : []), "--project=session-project", "--output=json"], env);
      assert.equal(read.status, 0, read.stderr);
      assert.match(read.stdout, frozen ? /Frozen Session Memory/ : /Live Session Memory/);
      for (const extra of [["--project", "other"], ["--run", "other"]]) {
        const denied = invoke(["memory", "list", ...extra, "--output=json"], env);
        assert.equal(denied.status, 1);
        assert.equal(denied.stdout, "");
        assert.equal(JSON.parse(denied.stderr).error.code, "REVIEW_SESSION_DENIED");
      }
      const absent = invoke(["memory", "read", frozen ? "live" : "frozen", ...(frozen ? ["--run", runId] : []), "--output=json"], env);
      assert.equal(absent.status, 1);
      assert.equal(absent.stdout, "");
      assert.match(absent.stderr, /not found/i);
    }
  } finally { await runtime.cleanup(); await rm(root, { recursive: true, force: true }); }
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
        assert.match(result.stdout, /bound-assignment/);
      }
    }
  } finally {
    await runtime.cleanup();
  }
});

test("Reviewer Attempts use fresh caller-local temporary directories, including retries", async () => {
  await withAgentReviewFixture("no-submit", async ({ configPath, runsRoot, runId }) => {
    const caller = await mkdtemp(join(tmpdir(), "memsphere-caller-"));
    const nestedCaller = join(caller, "nested");
    if (process.platform === "win32") {
      await mkdir(nestedCaller);
    } else {
      const actualCaller = join(caller, "actual");
      await mkdir(actualCaller);
      await symlink(actualCaller, nestedCaller, "dir");
    }
    const expectedParent = await realpath(nestedCaller);
    const directories: string[] = [];
    try {
      for (let index = 0; index < 2; index++) {
        const review = currentArtifactReview(await readRun(runsRoot, runId))!;
        const round = review.rounds.find(r => r.id === review.currentRoundId)!;
        const assignment = round.assignments[0];
        if (index) await retryArtifactReviewAgentAssignment({ runsRoot, reviewId: review.id, roundId: round.id, actorId: assignment.actorId });
        await runArtifactReviewAgentWorker({
          config: configPath, review: review.id, round: round.id,
          assignment: artifactReviewAssignmentId(assignment), nodeExecutable: process.execPath,
          cliEntrypoint: fakeCli, workspaceRoot: nestedCaller,
          providerResolver: () => ({ id: "traex", buildLaunch(input) {
            directories.push(input.workspaceRoot);
            assert.equal(dirname(input.workspaceRoot), join(expectedParent, "tmp"));
            for (const name of ["TMPDIR", "TMP", "TEMP"]) assert.equal(input.sessionEnv[name], input.workspaceRoot);
            return fakeAgentReviewProvider.buildLaunch(input);
          } })
        });
        const after = currentArtifactReview(await readRun(runsRoot, runId))!;
        assert.equal(after.rounds.at(-1)!.assignments[0].attempts?.at(-1)?.failure?.code, "agent_submission_missing");
        assert.deepEqual(await readdir(join(nestedCaller, "tmp")), []);
      }
      assert.equal(directories.length, 2);
      assert.notEqual(directories[0], directories[1]);
    } finally { await rm(caller, { recursive: true, force: true }); }
  });
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


test("Attempt directory cleanup failure retains the original Reviewer failure and a queryable cleanup diagnostic",{skip:process.platform==="win32"||process.getuid?.()===0},async()=>{
 await withAgentReviewFixture("no-submit",async({configPath,runsRoot,runId})=>{
  const run=await readRun(runsRoot,runId),review=currentArtifactReview(run)!;
  const round=review.rounds[0],assignment=round.assignments[0];let directory="";
  try{
   await runArtifactReviewAgentWorker({config:configPath,review:review.id,round:round.id,assignment:artifactReviewAssignmentId(assignment),nodeExecutable:process.execPath,cliEntrypoint:fakeCli,providerResolver:resolveFakeProvider,
    runSession:async input=>{directory=input.workspaceRoot;const blocked=join(directory,"blocked");await mkdir(blocked);await writeFile(join(blocked,"entry"),"held");await chmod(blocked,0o555);throw Error("agent_connection_closed: controlled primary transport failure");}});
   const failed=currentArtifactReview(await readRun(runsRoot,runId))!.rounds[0].assignments[0];
   assert.equal(failed.status,"failed");assert.match(failed.attempts![0].failure!.message,/controlled primary transport failure/);
   assert.ok((await readdir(directory)).includes("blocked"));
   const activity=await readAgentActivitySnapshot({runsRoot,runId,reviewId:review.id,roundId:round.id,assignmentId:artifactReviewAssignmentId(assignment),attemptId:failed.attempts![0].id});
   assert.ok(activity.events.some(e=>e.status==="cleanup_failed"&&e.title.includes(directory)));
  }finally{if(directory)await chmod(join(directory,"blocked"),0o755).catch(()=>undefined);}
 });
});