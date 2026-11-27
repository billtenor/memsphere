import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dispatchArtifactReviewAgents } from "../../../src/acp/dispatcher.js";
import { ExplorationReviews, explorationReviewHandle } from "../../../src/context_control/exploration-review.js";
import { readRun, waitForArtifactReview } from "../../../src/context_control/review-repository.js";
import { captureProcessIdentity, stopRewindWorker } from "../../../src/context_control/review-process.js";
import { textContent } from "../../../src/context_control/types.js";
import { inspectWindowsReviewJob } from "../../../src/context_control/windows-review-job.js";
import { delegatedReviewConfig, explorationFixture, explorationTestCli } from "../../helpers/exploration.js";
import { bounded, sameProcess, stopFixtureJob, untilFixture } from "../../helpers/fixture-process.js";

test("exploration dispatch recovers the queued Attempt and owns a fresh native Worker on retry", { timeout: 60000 }, async t => {
  const f = await explorationFixture(t);
  const run = await f.service.start("Native dispatch recovery");
  const { artifact, step } = await f.service.report(run.id, { name: "Candidate", content: textContent("Body") });
  await f.service.configureExplorationStep(run.id, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const launches = join(f.directory, "provider-sessions");
  // Returning without a vote keeps the Provider alive until the Worker captures and stops it.
  const config = delegatedReviewConfig(f.config, { EXPLORATION_TEST_LAUNCHES: launches }, "no-submit");
  const repository = new ExplorationReviews(f.service);
  const value = await repository.start(config, run.id, artifact.id);
  const reviewId = explorationReviewHandle(run.id, value.id);
  const attempts = async () => (await repository.locate(run.id, value.id)).row.value.attempts ?? [];
  const projected = await readRun(config.runsRoot, run.id);
  const dispatch = (loadRun?: typeof readRun) => dispatchArtifactReviewAgents({
    config, run: projected, workspaceRoot: f.cwd,
    runtime: { nodeExecutable: process.execPath, cliEntrypoint: explorationTestCli }
  }, { readRun: loadRun });

  const release = Promise.withResolvers<void>();
  let requests: Promise<number>[] = [];
  f.beforeCleanup(async () => {
    release.resolve();
    await Promise.allSettled(requests);
    for (const attempt of await attempts()) {
      const identity = attempt.workerIdentity;
      if (!identity || !sameProcess(identity, await captureProcessIdentity(identity.pid))) continue;
      if (attempt.workerJob) await stopFixtureJob(attempt.workerJob);
      else await stopRewindWorker({ reviewId, attemptId: attempt.id, pid: identity.pid, identity, members: attempt.workerMembers });
      await untilFixture(async () => !sameProcess(identity, await captureProcessIdentity(identity.pid)), "owned exploration Worker exit");
    }
  });
  const previousHome = process.env.MEMSPHERE_HOME;
  process.env.MEMSPHERE_HOME = f.home;
  try {
    const runtimeDir = join(config.scopeRoot, ".runtime");
    await mkdir(runtimeDir, { recursive: true });
    const blocked = join(runtimeDir, "review-dispatch");
    await writeFile(blocked, "injected failure before launching a worker");
    try { await assert.rejects(dispatch(), /EEXIST|ENOTDIR/); }
    finally { await rm(blocked); }
    assert.equal((await repository.start(config, run.id, artifact.id)).id, value.id);
    assert.deepEqual(await attempts(), value.attempts);

    let snapshots = 0;
    const concurrentRead: typeof readRun = async (...args) => {
      const current = await readRun(...args);
      if (++snapshots <= 2) {
        if (snapshots === 2) release.resolve();
        await release.promise;
      }
      return current;
    };
    requests = [dispatch(concurrentRead), dispatch(concurrentRead)];
    try { await bounded(Promise.all(requests), "concurrent dispatch requests", 20000); }
    finally { release.resolve(); }

    const receipt = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId, signal: t.signal, pollIntervalMs: 150 });
    assert.equal(receipt.round.assignments[0].status, "failed");
    const workerAttempts = await attempts();
    assert.equal(workerAttempts.length, 1);
    const [attempt] = workerAttempts;
    const identity = attempt.workerIdentity;
    assert.ok(identity?.started && identity.pid !== process.pid);
    assert.equal(attempt.workerPid, identity.pid);
    if (process.platform === "win32") assert.ok(attempt.workerJob);
    else assert.equal(attempt.workerJob, undefined);
    assert.ok(attempt.workerMembers?.some(member => member.pid !== identity.pid), "Provider process ownership was recorded");
    const firstSession = (await readFile(launches, "utf8")).trim();
    assert.match(firstSession, /^fake-[a-f0-9-]+$/, "Provider started exactly once");
    await untilFixture(async () => {
      t.signal.throwIfAborted();
      return !sameProcess(identity, await captureProcessIdentity(identity.pid));
    }, "original exploration Worker exit");

    // The production retry command must replace the exited Worker. This
    // Provider performs the real ACP handshake without per-node CLI launches.
    const retry = await f.call("run", "review", "retry", "--review", reviewId);
    const result = await waitForArtifactReview({ runsRoot: config.runsRoot, reviewId, signal: t.signal, pollIntervalMs: 150 });
    assert.equal(result.round.assignments[0].attempts?.at(-1)?.failure?.code, "agent_submission_missing");
    const retryAttempts = await attempts();
    assert.equal(retryAttempts.length, 2);
    const [original, retried] = retryAttempts;
    assert.deepEqual(original, attempt);
    assert.equal(retry.roundId, value.roundId);
    assert.equal(retry.attempt, undefined);
    assert.notEqual(retried.id, original.id);
    const retriedWorker = retried.workerIdentity;
    assert.ok(retriedWorker?.started && retriedWorker.pid !== process.pid);
    assert.equal(retried.workerPid, retriedWorker.pid);
    assert.equal(sameProcess(identity, retriedWorker), false);
    assert.ok(retried.workerMembers?.some(member => member.pid !== retriedWorker.pid), "Retried Provider process ownership was recorded");
    const sessions = (await readFile(launches, "utf8")).trim().split("\n");
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0], firstSession);
    assert.equal(sessions[1], retried.session?.id);
    assert.notEqual(sessions[1], firstSession);
    await untilFixture(async () => {
      t.signal.throwIfAborted();
      return !sameProcess(retriedWorker, await captureProcessIdentity(retriedWorker.pid));
    }, "retried exploration Worker exit");
    if (process.platform === "win32") {
      assert.ok(retried.workerJob && retried.workerJob !== attempt.workerJob);
      assert.equal((await inspectWindowsReviewJob(retried.workerJob)).active, 0);
    }
    assert.deepEqual(await readdir(join(f.root, "tmp")), []);
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
  }
});
