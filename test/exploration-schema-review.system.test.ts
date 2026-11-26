import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ExplorationReviews, explorationReviewHandle, explorationReviewIdentity, mutateModelReviewNode } from "../src/context_control/exploration-review.js";
import * as reviews from "../src/context_control/review-repository.js";
import { ContextControl } from "../src/context_control/service.js";
import { textContent } from "../src/context_control/types.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import { currentReviewNode, reviewNodeProgress } from "../src/review-nodes.js";
import { inspectReview, renderReviewResult, reviewResumeNotification } from "../src/daemon/review.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { delegatedReviewConfig, explorationFixture as fixture, explorationTestCli as cli, writeFixtureSchema } from "./helpers/exploration.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("exploration reports a broken reviewer only when it is selected or started", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const project = JSON.parse(await readFile(f.config.configPath, "utf8"));
  const homePath = join(f.home, "config.json");
  const home = JSON.parse(await readFile(homePath, "utf8"));
  project.control_plane = {
    runner: { permissions: ["artifact.read", "decision.decide"] },
    actors: { reviewer: { kind: "agent", permissions: ["artifact.read", "decision.assess"], agent: { provider: "kimi" } } }
  };
  await writeFile(f.config.configPath, JSON.stringify(project));
  const run = await f.call("run", "start", "--name", "Review configuration");
  const { stepId, artifactId } = await f.call("continue", "report", "--name", "Result", "--artifact", "Candidate");
  const configure = ["run", "step", "configure", "--run", run.id, "--step", stepId, "--asserts", "fact", "--reviewer"];
  await f.call(...configure, "project:reviewer");

  await writeFile(homePath, JSON.stringify({ ...home, acp_providers: { kimi: { args: "invalid" } } }));
  const step = await f.call("run", "step", "show", "--run", run.id, "--step", stepId);
  assert.deepEqual(step.reviewers.map((reviewer: { value: string }) => reviewer.value), ["runner"]);
  const start = ["run", "review", "start", "--run", run.id, "--artifact", artifactId];
  await assert.rejects(f.call(...start), /INVALID_REVIEWER.*acp_providers\.kimi\.args/);
  await assert.rejects(f.call(...configure, "project:reviewer"), /INVALID_REVIEWER.*acp_providers\.kimi\.args/);
  assert.deepEqual(await new ExplorationReviews(f.service).list(run.id), []);
  await f.call(...configure, "runner");
  assert.ok((await f.call(...start)).reviewId);
});

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

test("a restricted exploration Reviewer CLI reads only the materials bound to its assignment", { timeout: 30000 }, async t => {
  const f = await fixture(t), run = await f.service.start("Restricted review materials", "en");
  const attached = await f.service.addExternal(run.id, "used", { content: textContent("authorized source") });
  const unattached = await f.service.addExternal(run.id, "not used", { content: textContent("unattached source") });
  const { artifact, step } = await f.service.report(run.id, {
    name: "candidate", content: textContent("review this"), dependencies: [{ kind: "external", id: attached.id }]
  });
  await f.service.configureExplorationStep(run.id, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const pending = await new ExplorationReviews(f.service).start(delegatedReviewConfig(f.config), run.id, artifact.id);
  const reviewId = explorationReviewHandle(run.id, pending.id);
  // The CLI reads and enforces the persisted binding without a native Worker.
  const claim = await reviews.claimArtifactReviewAgentAssignment({
    service: f.service, runsRoot: f.config.runsRoot, reviewId, roundId: pending.roundId!, actorId: "reader"
  });
  assert.ok(claim?.assignment.id);
  const assignment = claim.assignment.id;
  const read = explorationReviewerCli(f, t, {
    runId: run.id, reviewId, roundId: claim.round.id, assignmentId: assignment, attemptId: claim.attempt.id
  });
  const candidate = await read("run", "artifact", "show", "--assignment", assignment);
  assert.match(candidate.stdout, /review this/);
  const contract = await read("run", "artifact", "contract", "show", "--assignment", assignment);
  assert.equal(JSON.parse(contract.stdout).artifact.name, "candidate");
  const detail = await read("run", "review", "assignment", "show", "--assignment", assignment);
  assert.ok(JSON.parse(detail.stdout).reviewProgress);
  const external = (id: string) => read("run", "external", "show", "--run", run.id, "--external", id);
  assert.equal(JSON.parse((await external(attached.id)).stdout).source, "used");
  await assert.rejects(external(unattached.id), /REVIEW_RESOURCE_DENIED|outside this Review/);
});

function explorationReviewerCli(f: Awaited<ReturnType<typeof fixture>>, t: Parameters<typeof fixture>[0], binding: {
  runId: string; reviewId: string; roundId: string; assignmentId: string; attemptId: string;
}) {
  const env = {
    ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: f.config.configPath,
    MEMSPHERE_WORKSPACE_ROOT: f.cwd, MEMSPHERE_REVIEW_SOURCE_WORKSPACE: f.root,
    MEMSPHERE_REVIEW_RUN_ID: binding.runId, MEMSPHERE_REVIEW_HANDLE: binding.reviewId,
    MEMSPHERE_REVIEW_ROUND_ID: binding.roundId, MEMSPHERE_REVIEW_MEMORY_RUN_ID: binding.runId,
    MEMSPHERE_REVIEW_ASSIGNMENT_ID: binding.assignmentId, MEMSPHERE_REVIEW_ATTEMPT_ID: binding.attemptId
  };
  let command: ReturnType<typeof invokeCliModule> | undefined;
  f.beforeCleanup(async () => { await command?.catch(() => undefined); });
  return (...args: string[]) => {
    command = invokeCliModule([...args, "--output", "json"], f.cwd, env, cli, t.signal);
    return command;
  };
}

test("delegated exploration Review retry preserves the round, saved nodes and Runner session", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const run = await f.service.start("Delegated retry", "en");
  const { artifact, step } = await f.service.report(run.id, { name: "Candidate", content: textContent("Review this") });
  await f.service.configureExplorationStep(run.id, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const repository = new ExplorationReviews(f.service);
  const config = delegatedReviewConfig(f.config);
  const pending = await repository.start(config, run.id, artifact.id);
  const reviewId = explorationReviewHandle(run.id, pending.id);
  const target = { runsRoot: config.runsRoot, service: f.service, reviewId, roundId: pending.roundId!, actorId: "reader" };

  // Control the persisted Attempt transitions here. The platform integration
  // test exercises retry dispatch and the native Worker lifecycle.
  const homePath = join(f.home, "config.json");
  const homeConfig = JSON.parse(await readFile(homePath, "utf8"));
  await writeFile(homePath, JSON.stringify({ ...homeConfig, debug: { agent_review: true } }));
  const first = await reviews.claimArtifactReviewAgentAssignment(target);
  assert.ok(first?.assignment.id);
  const firstAttempt = { ...target, attemptId: first.attempt.id };
  const binding = { runId: run.id, reviewId, roundId: target.roundId, assignmentId: first.assignment.id };
  const originalCli = explorationReviewerCli(f, t, { ...binding, attemptId: first.attempt.id });
  const report = ["continue", "report", "--artifact", '{"applicable":true}'];
  await originalCli(...report);
  const saved = await reviews.readArtifactReviewForActor(target);
  assert.equal(reviewNodeProgress(saved.assignment)?.processed, 1);
  const nextNode = currentReviewNode(saved.assignment);
  assert.ok(nextNode);
  const failure = { stage: "process", code: "agent_process_failed", message: "Reviewer exited after saving a node" } as const;
  await reviews.failArtifactReviewAgentAssignment({ ...firstAttempt, failure });

  const wait = async () => (await f.invoke("run", "review", "wait", "--review", reviewId)).stdout.trim();
  const failedReceipt = await wait();
  assert.ok(failedReceipt.includes(`${failure.stage} [${failure.code}] ${failure.message}`));
  assert.ok(failedReceipt.includes(`run review retry --review '${reviewId}'`));
  assert.match(failedReceipt, /1\/\d+/);
  assert.doesNotMatch(failedReceipt, /Artifact was accepted|advanced to the next step/);

  const retried = await f.call("run", "review", "retry", "--review", reviewId);
  assert.equal(retried.roundId, target.roundId);
  assert.equal(retried.status, "queued");
  assert.notEqual(retried.attempt.id, firstAttempt.attemptId);
  const second = await reviews.claimArtifactReviewAgentAssignment(target);
  assert.ok(second);
  assert.equal(second.attempt.id, retried.attempt.id);
  assert.equal(second.assignment.attempts?.length, 2);
  assert.deepEqual(second.assignment.nodeStates, saved.assignment.nodeStates);
  assert.equal(currentReviewNode(second.assignment)?.nodeId, nextNode.nodeId);
  await assert.rejects(reviews.assertArtifactReviewAgentAttemptRunning(firstAttempt), /no longer current/);
  await assert.rejects(originalCli(...report), /review_attempt_not_current/);

  const retryCli = explorationReviewerCli(f, t, { ...binding, attemptId: second.attempt.id });
  let view = JSON.parse((await retryCli("continue", "show")).stdout);
  assert.equal(view.node.nodeId, nextNode.nodeId);
  while (view.node) view = JSON.parse((await retryCli(...report)).stdout);
  await retryCli("continue", "submit", "--artifact", '{"vote":"approve","summary":"Retried review completed"}');

  const draft = await f.call("run", "enter-schema", "report", "--run", run.id, "--name", "Unrelated draft", "--content-type", "text/markdown");
  const home = (await openCommandStates(false, f.home))!, session = "codex-free-schema-review";
  const runnerBinding = await home.get({}, session);
  const before = await f.service.inspect(run.id);
  const note = reviewResumeNotification("test-project", reviewId);
  assert.equal(note, `请执行命令以继续：\nmemsphere --project 'test-project' run review wait --review '${reviewId}'`);
  const resumed = await wait();
  assert.equal(resumed, await renderReviewResult(config, await inspectReview(config, reviewId)));
  assert.match(resumed, /Reviewer vote: approve/);
  assert.match(resumed, /Reader/);
  assert.match(resumed, /Retried review completed/);
  assert.doesNotMatch(resumed, /Artifact was accepted|advanced to the next step|Retry this round|agent_process_failed/);
  assert.deepEqual(await home.get({}, session), runnerBinding);
  assert.equal((await f.call("continue", "schema", "show")).stepId, draft.stepId);
  assert.deepEqual(await f.service.inspect(run.id), before);
  assert.equal((await repository.list(run.id)).length, 1);
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
