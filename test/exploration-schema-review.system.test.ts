import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ExplorationReviews, explorationReviewHandle, explorationReviewIdentity, mutateModelReviewNode } from "../src/context_control/exploration-review.js";
import { dispatchArtifactReviewAgents } from "../src/acp/dispatcher.js";
import * as reviews from "../src/context_control/review-repository.js";
import { ContextControl } from "../src/context_control/service.js";
import { textContent } from "../src/context_control/types.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import { currentReviewNode, reviewNodeProgress } from "../src/review-nodes.js";
import { inspectReview, renderReviewResult, reviewResumeNotification } from "../src/daemon/review.js";
import { captureProcessIdentity, stopRewindWorker } from "../src/context_control/review-process.js";
import { stopFixtureJob, untilFixture } from "./helpers/fixture-process.js";
import { delegatedReviewConfig, explorationFixture as fixture, explorationTestCli as cli, writeFixtureSchema } from "./helpers/exploration.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("free exploration Schema and Runner Review use explicit native targets and Continue bindings", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Explore")).id;
  await writeFile(f.schema, (await readFile(f.schema, "utf8")) + "  - !repeat\n    limit: {min: 0, max: 2}\n    body: [Example]\n");
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Findings", "--content-type", "text/markdown");
  const A = draft.artifactId, S = draft.stepId;
  const repository = new ExplorationReviews(f.service);
  await assert.rejects(f.call("run", "review", "start", "--run", R, "--artifact", A), /INCOMPLETE_ARTIFACT/);
  assert.equal((await f.call("run", "enter-schema", "--run", R, "--step", S)).artifactId, A);
  const title = await f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "# Findings");
  const next = await f.call("continue", "skip", "--position", title.position);
  await assert.rejects(f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "1"), /POSITION|position/);
  await assert.rejects(f.call("continue", "schema", "report", "--position", next.position, "--artifact", "invalid"));
  assert.equal((await f.call("continue", "schema", "show")).position, next.position);
  const count = await f.call("continue", "schema", "report", "--position", next.position, "--artifact", "42");
  const repeat = await f.call("continue", "repeat", "1", "--position", count.position);
  const saved = await f.call("continue", "schema", "report", "--position", repeat.position, "--artifact", "An example");
  assert.equal(saved.phase, "awaiting_finalization");
  const path = join(f.directory, "draft.md");
  await f.call("continue", "artifact", "export", "--file", path);
  assert.match(await readFile(path, "utf8"), /42/);
  assert.match(await readFile(path, "utf8"), /An example/);
  const E = (await f.call("continue", "external", "add", "--source", "used", "--content", "fixed")).externalId;
  const unused = (await f.call("continue", "external", "add", "--source", "unattached", "--content", "unused")).externalId;
  assert.equal((await f.call("continue", "report", "--depends-on", `external:${E}`)).artifactId, A);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", A), /REVIEWER_REQUIRED/);
  await f.call("continue", "step", "configure", "--step", S, "--reviewer", "runner");
  await assert.rejects(f.call("continue", "review", "start", "--artifact", A), /REVIEW_RULES_REQUIRED/);
  assert.deepEqual(await repository.list(R), []);
  await f.call("continue", "step", "configure", "--step", S, "--asserts", "fact", "--suggests", "statements/fact");
  const first = await f.call("continue", "review", "start", "--artifact", A), V = first.reviewId;
  assert.deepEqual(first.materials.map((ref: { id: string }) => ref.id), [A, E]);
  assert.ok(!first.materials.some((ref: { id: string }) => ref.id === unused));
  await assert.rejects(f.call("continue", "review", "submit", "--artifact", '{"vote":"approve"}'), /review_node_incomplete/);
  await writeFile(f.statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check updated fact]\nsuggests: [Use plain language]\n"));
  const frozen = await f.call("run", "review", "show", "--run", R, "--review", V, "--all");
  assert.ok(frozen.nodes.some((n: { asserts: Array<{ text: string }> }) => n.asserts.some(rule => rule.text === "Check original fact")));
  let progress = await f.call("continue", "review", "show");
  const ruleNode = progress.node.nodeId;
  progress = await f.call("run", "review", "report", "--run", R, "--review", V, "--artifact", '{"applicable":true}');
  const afterUpdate = await f.call("continue", "review", "update", "--node", ruleNode, "--artifact", '{"applicable":true,"comments":[]}');
  assert.equal(afterUpdate.node.nodeId, progress.node.nodeId);
  while (progress.node?.kind !== "open_review") progress = await f.call("continue", "review", "report", "--artifact", '{"applicable":true}');
  const finding = await f.call("run", "review", "comment", "add", "--run", R, "--review", V, "--node", progress.node.nodeId,
    "--artifact", '{"body":"First opinion","severity":"suggestion"}');
  const comment = finding.node.comments[0].commentId;
  const updated = await f.call("continue", "review", "comment", "update", "--comment", comment, "--artifact", '{"body":"Updated opinion"}');
  assert.equal(updated.node.comments[0].body, "Updated opinion");
  const deleted = await f.call("run", "review", "comment", "delete", "--run", R, "--review", V, "--comment", comment);
  assert.deepEqual(deleted.node.comments, []);
  while (progress.node) progress = await f.call("continue", "review", "report", "--artifact", '{"applicable":true}');
  assert.equal((await f.call("run", "review", "submit", "--run", R, "--review", V, "--artifact", '{"vote":"approve","summary":"Confirmed"}')).status, "submitted");
  await assert.rejects(f.call("continue", "review", "show"), /Enter a Review/);
  const old = await f.call("run", "review", "show", "--run", R, "--review", V);
  assert.equal(old.vote.value, "approve");
  const revised = await f.call("continue", "enter-schema", "--revised-from", A);
  assert.notEqual(revised.artifactId, A);
  const inherited = await f.call("run", "step", "show", "--run", R, "--step", revised.stepId);
  assert.equal(inherited.configuration.inheritedFrom.artifactId, A);
  assert.deepEqual(inherited.configuration.asserts, ["statements/fact"]);
  await f.call("continue", "step", "configure", "--step", revised.stepId, "--clear-asserts");
  assert.deepEqual((await f.call("run", "step", "show", "--run", R, "--step", S)).configuration.asserts, ["statements/fact"]);
  const second = await f.call("run", "review", "start", "--run", R, "--artifact", A);
  assert.notEqual(second.reviewId, V);
  assert.deepEqual((await f.call("run", "review", "list", "--run", R, "--artifact", A)).map((r: { id: string }) => r.id), []);
  assert.equal((await f.call("run", "review", "list", "--run", R, "--artifact", A, "--progressive")).length, 2);
});

test("exploration Schema CLI writes files and empty fields and preserves an incomplete draft", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const R = (await f.call("run", "start", "--name", "Schema field inputs")).id;
  const draft = await f.call("run", "enter-schema", "report", "--run", R, "--name", "Findings", "--content-type", "text/markdown");
  const S = draft.stepId;
  const field = join(f.directory, "title.md");
  await writeFile(field, "# Findings\n");
  const notes = await f.call("run", "schema", "report", "--run", R, "--step", S, "--position", draft.position, "--artifact-file", field);
  assert.ok(Object.values(notes.draft.writing.values).includes("# Findings\n"));
  const count = await f.call("continue", "schema", "report", "--position", notes.position, "--artifact", "");
  assert.ok(Object.values(count.draft.writing.values).includes(""));
  assert.deepEqual(count.progress.skipped, []);

  const second = await f.call("continue", "enter-schema", "report", "--name", "Other draft", "--content-type", "text/markdown");
  assert.notEqual(second.artifactId, draft.artifactId);
  assert.equal((await f.call("continue", "enter-schema", "--step", S)).position, count.position);
  const incomplete = await f.service.inspect(R);
  await assert.rejects(f.call("continue", "report"), /SCHEMA_INCOMPLETE/);
  assert.deepEqual(await f.service.inspect(R), incomplete);

  for (const [args, value] of [
    [["run", "schema", "report", "--run", R, "--step", S], "invalid number"],
    [["continue", "schema", "report"], ""]
  ] as const) {
    await assert.rejects(f.call(...args, "--position", count.position, "--artifact", value), (error: Error) => {
      const { error: diagnostic } = JSON.parse(error.message);
      assert.equal(diagnostic.code, "ARTIFACT_VALIDATION_FAILED");
      assert.match(diagnostic.message, /artifact\.type\.expected_number at Findings\.Count/);
      return true;
    });
  }
  const restored = await f.call("continue", "schema", "show");
  assert.equal(restored.position, count.position);
  assert.deepEqual(restored.draft, count.draft);
  assert.equal((await f.call("run", "schema", "show", "--run", R, "--step", second.stepId)).position, second.position);
  await f.call("continue", "schema", "report", "--position", count.position, "--artifact", "42");
  assert.equal((await f.call("continue", "report")).artifactId, draft.artifactId);
});

test("Step configuration changes only selected fields and Continue rejects another Run's targets", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const R = (await f.call("run", "start", "--name", "Configured Run")).id;
  const candidate = await f.call("continue", "report", "--name", "Candidate", "--artifact", "Body");
  const S = candidate.stepId;
  const configure = (...options: string[]) => f.call("continue", "step", "configure", "--step", S, ...options);
  const configuration = async () => (await f.service.explorationStep(R, S)).reviewConfiguration;
  const configured = await configure("--asserts", "fact", "--suggests", "fact", "--reviewer", "runner");
  for (const options of [
    ["--asserts", "fact", "--clear-asserts"],
    ["--suggests", "fact", "--clear-suggests"],
    ["--reviewer", "runner", "--clear-reviewer"]
  ]) await assert.rejects(configure(...options), /Choose setting or clearing/);
  await assert.rejects(configure("--asserts", "statements/absent"), /absent/);
  await assert.rejects(configure("--suggests", ""));
  await assert.rejects(configure("--reviewer", "project:absent"), /INVALID_REVIEWER/);
  assert.deepEqual(await configuration(), configured.configuration);
  for (const [option, field] of [["--clear-asserts", "asserts"], ["--clear-suggests", "suggests"], ["--clear-reviewer", "reviewer"]] as const) {
    const expected = { ...await configuration() };
    if (field === "reviewer") delete expected[field];
    else expected[field] = [];
    assert.deepEqual((await configure(option)).configuration, expected);
  }

  const other = (await f.call("run", "start", "--name", "Foreign Run")).id;
  const foreign = await f.service.report(other, { name: "Foreign candidate", content: textContent("Other body") });
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Local draft", "--content-type", "text/markdown");
  await assert.rejects(f.call("continue", "step", "configure", "--step", S, "--reviewer", "runner"), /NOT_FOUND/);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", candidate.artifactId), /NOT_FOUND/);
  assert.equal((await f.call("continue", "schema", "show")).position, draft.position);
  await f.call("run", "enter", "--run", R);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", foreign.artifact.id), /NOT_FOUND/);
  const repository = new ExplorationReviews(f.service);
  assert.deepEqual(await repository.list(R), []);
  assert.deepEqual(await repository.list(other), []);
});

for (const schema of [false, true]) {
  test(`${schema ? "Schema" : "ordinary"} CLI revision reviews retained and newly attached External independently`, { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const R = (await f.call("run", "start", "--name", "Review material versions")).id;
    const first = (await f.service.addExternal(R, "First", { content: textContent("First material") })).id;
    const write = async (draft: { position: string }) => {
      const notes = await f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "# Findings");
      const count = await f.call("continue", "skip", "--position", notes.position);
      await f.call("continue", "schema", "report", "--position", count.position, "--artifact", "42");
    };
    let original;
    if (schema) {
      const draft = await f.call("continue", "enter-schema", "report", "--name", "Findings", "--content-type", "text/markdown");
      await write(draft);
      original = await f.call("continue", "report", "--depends-on", `external:${first}`);
      assert.equal(original.artifactId, draft.artifactId);
    } else {
      original = await f.call("continue", "report", "--name", "Findings", "--artifact", "First", "--depends-on", `external:${first}`);
    }
    const A1 = original.artifactId, S1 = original.stepId;
    await f.call("continue", "step", "configure", "--step", S1, "--asserts", "fact", "--reviewer", "runner");
    const old = await f.call("continue", "review", "start", "--artifact", A1);
    const repository = new ExplorationReviews(f.service);
    const { recordId } = explorationReviewIdentity(old.reviewId)!;
    const { round, actor } = await repository.locate(R, recordId);
    // Prepare the historical nodes directly. The Runner Review scenario above
    // exercises node reports through the CLI, and this case still submits via Continue.
    await repository.mutate(R, recordId, round.id, actor, async review => {
      for (let node = currentReviewNode(review); node; node = currentReviewNode(review)) {
        mutateModelReviewNode(review, { operation: "report", expectedNodeId: node.nodeId, artifact: { applicable: true } }, new Set(), f.service.runtime.now, () => assert.fail("No test comment expected"));
      }
    });
    assert.equal((await f.call("continue", "review", "submit", "--artifact", '{"vote":"approve"}')).status, "submitted");
    const second = (await f.service.addExternal(R, "Second", { content: textContent("Second material") })).id;
    const dependencies = ["--depends-on", `external:${first}`, "--depends-on", `external:${second}`];
    let revision;
    if (schema) {
      const draft = await f.call("continue", "enter-schema", "--revised-from", A1);
      const before = await f.service.explorationSchemaShow(R, S1);
      assert.deepEqual(draft.draft.schemaContract, before.draft.schemaContract);
      await write(draft);
      revision = await f.call("continue", "report", ...dependencies);
      assert.equal(revision.artifactId, draft.artifactId);
    } else {
      revision = await f.call("run", "report", "--run", R, "--revised-from", A1, "--artifact", "Second", ...dependencies);
    }
    const A2 = revision.artifactId, S2 = revision.stepId;
    assert.notEqual(A1, A2);
    assert.notEqual(S1, S2);
    const inherited = (await f.call("run", "step", "show", "--run", R, "--step", S2)).configuration;
    assert.deepEqual(inherited, {
      inheritedFrom: { artifactId: A1, stepId: S1 }, asserts: ["statements/fact"], reviewer: "runner"
    });
    await f.call("continue", "step", "configure", "--step", S2, "--clear-asserts", "--suggests", "fact");
    const updated = await f.call("continue", "review", "start", "--artifact", A2);
    const again = await f.call("run", "review", "start", "--run", R, "--artifact", A1);
    assert.notEqual(again.reviewId, old.reviewId);
    assert.deepEqual(updated.configuration, { asserts: [], suggests: ["statements/fact"], reviewer: "runner" });
    assert.deepEqual(again.configuration, old.configuration);
    assert.deepEqual((await f.call("run", "review", "show", "--run", R, "--review", old.reviewId)).materials, old.materials);
    const materialIds = (review: { materials: Array<{ id: string }> }) => review.materials.map(ref => ref.id);
    assert.deepEqual(materialIds(again), [A1, first]);
    assert.deepEqual(materialIds(updated), [A2, first, second]);
    const saved = await f.service.inspect(R);
    assert.deepEqual(saved.artifacts.find(a => a.id === A1)?.dependencies.map(ref => ref.id), [first]);
    assert.deepEqual(saved.artifacts.find(a => a.id === A2)?.dependencies.map(ref => ref.id), [first, second]);
  });
}

test("delegated exploration Review reads restricted CLI materials and resumes the same review after saving a node", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("delegated")).id;
  const attached = await f.service.addExternal(R, "used", { content: textContent("authorized source") });
  const unattached = await f.service.addExternal(R, "not used", { content: textContent("unattached source") });
  const { artifact, step } = await f.service.report(R, { name: "candidate", content: textContent("review this"), dependencies: [{ kind: "external", id: attached.id }] });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const repository = new ExplorationReviews(f.service);
  const cfg = delegatedReviewConfig(f.config, {
    EXPLORATION_TEST_EXTERNAL: attached.id, EXPLORATION_TEST_UNATTACHED: unattached.id,
    EXPLORATION_TEST_CRASH_MARKER: join(f.directory, "node-saved")
  });
  const value = await repository.start(cfg, R, artifact.id), reviewId = explorationReviewHandle(R, value.id);
  const common = { runsRoot: cfg.runsRoot, reviewId, roundId: value.roundId!, actorId: "reader" };
  let dispatchWork: Promise<unknown> | undefined;
  const attempts = async () => (await repository.locate(R, value.id)).row.value.attempts ?? [];
  const ownWorkerExited = async (attempt: Awaited<ReturnType<typeof attempts>>[number]) => {
    if (!attempt.workerPid || !attempt.workerIdentity) return true;
    const live = await captureProcessIdentity(attempt.workerPid);
    return live?.started !== attempt.workerIdentity.started;
  };
  f.beforeCleanup(async () => {
    await dispatchWork?.catch(() => undefined);
    for (const attempt of await attempts()) {
      if (!attempt.workerPid || await ownWorkerExited(attempt)) continue;
      if (attempt.workerJob) await stopFixtureJob(attempt.workerJob);
      else await stopRewindWorker({ reviewId, attemptId: attempt.id, pid: attempt.workerPid, identity: attempt.workerIdentity, members: attempt.workerMembers });
      await untilFixture(() => ownWorkerExited(attempt), "owned exploration Review worker exit");
    }
  });
  const oldHome = process.env.MEMSPHERE_HOME; process.env.MEMSPHERE_HOME = f.home;
  try {
    const run = await reviews.readRun(cfg.runsRoot, R);
    const dispatch = () => dispatchArtifactReviewAgents({ config: cfg, run,
      workspaceRoot: f.cwd, runtime: { nodeExecutable: process.execPath, cliEntrypoint: cli } });
    assert.equal(await (dispatchWork = dispatch()), 1);
    const wait = () => reviews.waitForArtifactReview({ runsRoot: cfg.runsRoot, reviewId, signal: t.signal, pollIntervalMs: 150 });
    await wait();
    const failed = await reviews.readArtifactReviewForActor(common);
    assert.equal(failed.assignment.status, "failed");
    const first = (await attempts())[0];
    assert.ok(first.workerPid && first.workerPid !== process.pid && first.workerIdentity);
    await untilFixture(() => ownWorkerExited(first), "first exploration Review worker exit");
    assert.equal(reviewNodeProgress(failed.assignment)?.processed, 1);
    assert.equal((await attempts()).length, 1);
    const failure = failed.assignment.attempts![0].failure!;
    const failedReceipt = (await f.invoke("run", "review", "wait", "--review", reviewId)).stdout;
    assert.ok(failedReceipt.includes(`${failure.stage} [${failure.code}] ${failure.message}`));
    assert.ok(failedReceipt.includes(`run review retry --review '${reviewId}'`));
    assert.match(failedReceipt, /1\/\d+/);
    assert.doesNotMatch(failedReceipt, /产物已被接受|Run 已推进|Artifact was accepted|advanced to the next step/);
    const attemptId = failed.assignment.attempts![0].id;
    const retry = f.call("run", "review", "retry", "--review", reviewId);
    dispatchWork = retry;
    const retried = await retry;
    assert.equal(retried.roundId, value.roundId);
    assert.notEqual(retried.attempt.id, attemptId);
    await assert.rejects(reviews.assertArtifactReviewAgentAttemptRunning({ ...common, attemptId }), /no longer current/);
    const retained = await reviews.readArtifactReviewForActor(common);
    for (const saved of failed.assignment.nodeStates!.filter(node => node.reported)) {
      assert.deepEqual(retained.assignment.nodeStates!.find(node => node.nodeId === saved.nodeId), saved);
    }
    await assert.rejects(reviews.mutateArtifactReviewNodes({ ...common, attemptId, mutation: { operation: "report", expectedNodeId: currentReviewNode(failed.assignment)!.nodeId, artifact: { applicable: true } } }), /not current and running/);
    const draft = await f.call("run", "enter-schema", "report", "--run", R, "--name", "Unrelated draft", "--content-type", "text/markdown");
    const home = (await openCommandStates(false, f.home))!, session = "codex-free-schema-review";
    const target = await home.get({}, session);
    const result = await wait();
    assert.equal(result.round.assignments[0].submitted?.vote, "approve", JSON.stringify(result.round.assignments[0].attempts));
    const second = (await attempts())[1];
    assert.ok(second.workerPid && second.workerPid !== process.pid && second.workerIdentity);
    await untilFixture(() => ownWorkerExited(second), "retried exploration Review worker exit");
    const before = await f.service.inspect(R);
    const note = reviewResumeNotification("test-project", reviewId);
    assert.equal(note, `请执行命令以继续：\nmemsphere --project 'test-project' run review wait --review '${reviewId}'`);
    const rendered = await renderReviewResult(cfg, await inspectReview(cfg, reviewId));
    const resumed = (await f.invoke("run", "review", "wait", "--review", reviewId)).stdout.trim();
    assert.equal(resumed, rendered);
    assert.match(resumed, /评审人投票：通过|Reviewer vote: approve/);
    assert.match(resumed, /Reader/);
    assert.doesNotMatch(resumed, /产物已被接受|Run 已推进|Artifact was accepted|advanced to the next step|同轮重试|Retry this round/);
    assert.deepEqual(await home.get({}, session), target);
    assert.equal((await f.call("continue", "schema", "show")).stepId, draft.stepId);
    assert.deepEqual(await f.service.inspect(R), before);
    assert.equal((await repository.list(R)).length, 1);
  } finally {
    if (oldHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = oldHome;
  }
});

test("waiting for a delegated change request or abstention reports only the Review opinion", { timeout: 30000 }, async t => {
  const f = await fixture(t), repository = new ExplorationReviews(f.service);
  const R = (await f.service.start("Delegated opinions", "en")).id;
  for (const vote of ["request_changes", "abstain"] as const) {
    const { artifact, step } = await f.service.report(R, { name: vote, content: textContent("Candidate") });
    await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
    const pending = await repository.start(delegatedReviewConfig(f.config), R, artifact.id);
    const reviewId = explorationReviewHandle(R, pending.id);
    const target = { runsRoot: f.config.runsRoot, reviewId, roundId: pending.roundId!, actorId: "reader", service: f.service };
    const claimed = await reviews.claimArtifactReviewAgentAssignment(target);
    assert.ok(claimed);
    const attempt = { ...target, attemptId: claimed.attempt.id };
    await reviews.markArtifactReviewAgentCliReady(attempt);
    let context = claimed;
    for (let node = currentReviewNode(context.assignment); node; node = currentReviewNode(context.assignment)) {
      context = await reviews.mutateArtifactReviewNodes({ ...attempt,
        mutation: { operation: "report", expectedNodeId: node.nodeId, artifact: { applicable: true } } });
    }
    await reviews.submitArtifactReviewAgentAssignment({ ...attempt, vote, summary: "Recorded opinion" });
    const before = await f.service.inspect(R);
    const output = (await f.invoke("run", "review", "wait", "--review", reviewId)).stdout;
    assert.ok(output.includes(`Reviewer vote: ${vote}`));
    assert.match(output, /Status: submitted/);
    assert.match(output, /Recorded opinion/);
    assert.doesNotMatch(output, /revise the Artifact|Run advanced|Artifact was accepted|Retry this round/);
    assert.deepEqual(await f.service.inspect(R), before);
  }
});

test("interrupted Schema submission resumes within its original Artifact and releases the completed Continue target", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Resume submission")).id;
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Report", "--content-type", "text/markdown");
  await writeFixtureSchema(f.service, draft);
  const store = f.service.stores.step, update = store.update;
  store.update = async () => { throw new Error("Step update interrupted"); };
  try {
    await assert.rejects(f.service.submitExplorationSchema(R, draft.stepId, {}), { code: "SCHEMA_RECOVERY_REQUIRED" });
  } finally { store.update = update; }
  const saved = await f.service.inspect(R);
  assert.equal(saved.artifacts.find(a => a.id === draft.artifactId)?.status, "submitted");
  assert.equal(saved.steps.find(step => step.id === draft.stepId)?.status, "running");
  const result = await f.call("run", "enter-schema", "--run", R, "--step", draft.stepId);
  assert.equal(result.phase, "submitted");
  assert.equal(result.artifactId, draft.artifactId);
  const next = await f.call("continue", "report", "--name", "Follow-up", "--artifact", "Next artifact");
  assert.notEqual(next.artifactId, draft.artifactId);
  assert.ok((await f.service.inspect(R)).completeIds.includes(draft.artifactId));
});

test("a late Schema submission cannot release a newer Home target", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Home race")).id;
  const draft = await f.call("continue", "enter-schema", "report", "--name", "First", "--content-type", "text/markdown");
  const another = await f.service.enterExplorationSchema(R, { name: "Second", contentType: "text/markdown", contract: draft.draft.schemaContract });
  await writeFixtureSchema(f.service, draft);
  const original = ContextControl.prototype.submitExplorationSchema;
  let saved!: () => void, resume!: () => void;
  const persisted = new Promise<void>(resolve => { saved = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  t.signal.addEventListener("abort", resume, { once: true });
  ContextControl.prototype.submitExplorationSchema = async function (...args) {
    const result = await original.apply(this, args);
    saved();
    await gate;
    return result;
  };
  const late = f.call("continue", "report");
  f.beforeCleanup(async () => { resume(); ContextControl.prototype.submitExplorationSchema = original; await late.catch(() => undefined); });
  const home = (await openCommandStates(false, f.home))!, session = "codex-free-schema-review";
  try {
    await Promise.race([persisted, late.then(() => assert.fail("Submission was not paused after persistence"))]);
    const row = (await home.get({}, session))!;
    await home.update({}, session, { ...(row.value as object), parameters: { project: "test-project", step: another.stepId } }, { expectedRevision: row.revision });
  } finally { resume(); ContextControl.prototype.submitExplorationSchema = original; }
  assert.equal((await late).artifactId, draft.artifactId);
  assert.equal((await f.call("continue", "schema", "show")).stepId, another.stepId);
  assert.ok((await f.service.inspect(R)).completeIds.includes(draft.artifactId));
});
