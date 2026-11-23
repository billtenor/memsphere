import { runGit } from "../src/git.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dispatchArtifactReviewAgents } from "../src/acp/dispatcher.js";
import { runArtifactReviewAgentWorker } from "../src/acp/review-worker.js";
import { readProjectConfig } from "../src/config.js";
import { ExplorationReviews, explorationReviewHandle } from "../src/context_control/exploration-review.js";
import * as reviews from "../src/context_control/review-repository.js";
import { textContent } from "../src/context_control/types.js";
import { openContextControl } from "../src/project/context-control.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
async function fixture(t: test.TestContext) {
  const f = await initializedContextFixture(t);
  await runGit(["init", "-b", "master"], { cwd: f.root });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Embedded fixture"], { cwd: f.root });
  const configuration = join(f.root, "config.json");
  const project = JSON.parse(await readFile(configuration, "utf8"));
  await writeFile(configuration, JSON.stringify({ ...project, store: { type: "embedded", repository_path: f.root, memory_path: "memory" } }));
  const config = await readProjectConfig("test-project", f.home);
  await mkdir(join(config.memoryRoot, "schemas"), { recursive: true });
  await mkdir(join(config.memoryRoot, "statements"), { recursive: true });
  const statement = join(config.memoryRoot, "statements", "fact.yaml");
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check original fact]\nsuggests: [Explain the finding]\n"));
  await writeFile(join(config.memoryRoot, "schemas", "report.yaml"), withCurrentMemorySyntax("!schema\nnames: [report]\ntype: object\nformat: {layout: outline}\nfields:\n  - !schema {name: Notes, optional: true}\n  - !schema {name: Count, type: number}\n"));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const service = (await openContextControl(f.root))!;
  const invoke = (...args: string[]) => invokeCliModule(["--project", "test-project", ...args], f.root,
    { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "free-schema-review", TRAECLI_THREAD_ID: "" }, cli);
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  return { ...f, config, service, invoke, call, statement };
}

test("free exploration Schema and Runner Review use explicit native targets and Continue bindings", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Explore")).id;
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
  const saved = await f.call("continue", "schema", "report", "--position", next.position, "--artifact", "42");
  assert.equal(saved.phase, "awaiting_finalization");
  const path = join(f.directory, "draft.md");
  await f.call("continue", "artifact", "export", "--file", path);
  assert.match(await readFile(path, "utf8"), /42/);
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

test("simultaneous Review starts converge and cancellation during preparation creates no Review", { timeout: 30000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("race")).id;
  const { artifact, step } = await f.service.report(R, { name: "candidate", content: textContent("body") });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "runner" });
  const repository = new ExplorationReviews(f.service);
  const baseline = repository.records.create.bind(repository.records);
  let arrivals = 0, ready!: () => void;
  const competing = new Promise<void>(resolve => { ready = resolve; });
  f.beforeCleanup(async () => { ready(); await Promise.allSettled(starts); });
  repository.records.create = async (...args: Parameters<typeof baseline>) => {
    if (++arrivals === 2) ready();
    await competing;
    return baseline(...args);
  };
  const starts = [repository.start(f.config, R, artifact.id, t.signal), repository.start(f.config, R, artifact.id, t.signal)];
  const [first, second] = await Promise.all(starts);
  assert.equal(first.id, second.id);
  await f.service.configureExplorationStep(R, step.id, { suggests: ["statements/fact"] });
  const controller = new AbortController();
  let readStarted!: () => void, readResume!: () => void;
  const reading = new Promise<void>(resolve => { readStarted = resolve; }), resumed = new Promise<void>(resolve => { readResume = resolve; });
  const body = f.service.body.bind(f.service);
  const intercepted = new Proxy(f.service, { get(target, property) {
    if (property !== "body") return Reflect.get(target, property);
    return async (...args: Parameters<typeof body>) => { readStarted(); await resumed; return body(...args); };
  } });
  const cancelled = new ExplorationReviews(intercepted).start(f.config, R, artifact.id, controller.signal);
  f.beforeCleanup(async () => { controller.abort(); readResume(); await Promise.allSettled([cancelled]); });
  await reading;
  controller.abort();
  readResume();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual((await repository.list(R)).map(r => r.id), [first.id]);
});

test("delegated exploration Review launches a restricted ACP Session and retries the same assignment", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.service.start("delegated")).id;
  const attached = await f.service.addExternal(R, "used", { content: textContent("authorized source") });
  const unattached = await f.service.addExternal(R, "not used", { content: textContent("unattached source") });
  const { artifact, step } = await f.service.report(R, { name: "candidate", content: textContent("review this"), dependencies: [{ kind: "external", id: attached.id }] });
  await f.service.configureExplorationStep(R, step.id, { asserts: ["statements/fact"], reviewer: "project:reader" });
  const repository = new ExplorationReviews(f.service);
  const cfg = { ...f.config, controlPlane: { runner: { permissions: ["artifact.read" as const] }, actors: {
    reader: { kind: "agent" as const, name: "Reader", permissions: ["artifact.read" as const, "decision.assess" as const], agent: { provider: "test", providerType: "traex" as const, command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url)), "approve"], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: 20000 } }
  }, acpProviders: {} } };
  const value = await repository.start(cfg, R, artifact.id), reviewId = explorationReviewHandle(R, value.id);
  const common = { runsRoot: cfg.runsRoot, reviewId, roundId: value.roundId!, actorId: "reader" };
  let dispatchWork: Promise<number> | undefined;
  f.beforeCleanup(async () => { await dispatchWork?.catch(() => undefined); });
  const oldHome = process.env.MEMSPHERE_HOME; process.env.MEMSPHERE_HOME = f.home;
  try {
    let fail = true;
    const dispatch = async () => dispatchArtifactReviewAgents({ config: cfg, run: await reviews.readRun(cfg.runsRoot, R), launchWorker: async input => {
      await runArtifactReviewAgentWorker({ signal: t.signal, config: cfg.configPath, review: input.reviewId, round: input.roundId, assignment: input.assignmentId,
        workspaceRoot: f.cwd, nodeExecutable: process.execPath, cliEntrypoint: cli, providerResolver: () => ({ id: "traex", buildLaunch: ({ actor, workspaceRoot, sessionEnv }) => {
          if (fail) throw new Error("test launch failure");
          return { provider: "controlled-test-provider", command: actor.agent.command, args: actor.agent.args, cwd: workspaceRoot,
            env: { ...process.env, ...sessionEnv, EXPLORATION_TEST_EXTERNAL: attached.id, EXPLORATION_TEST_UNATTACHED: unattached.id }, startupTimeoutMs: 10000,
            idleTimeoutMs: 20000, maxRuntimeMs: null, promptVersion: "artifact-review-v3" };
        } }) });
    } });
    assert.equal(await (dispatchWork = dispatch()), 1);
    const failed = await reviews.readArtifactReviewForActor(common);
    assert.equal(failed.assignment.status, "failed");
    const attemptId = failed.assignment.attempts![0].id;
    const retried = await reviews.retryArtifactReviewAgentAssignment(common);
    assert.notEqual(retried.attempt.id, attemptId);
    await assert.rejects(reviews.assertArtifactReviewAgentAttemptRunning({ ...common, attemptId }), /no longer current/);
    fail = false;
    assert.equal(await (dispatchWork = dispatch()), 1);
    const result = await reviews.waitForArtifactReview({ runsRoot: cfg.runsRoot, reviewId, signal: t.signal });
    assert.equal(result.round.assignments[0].submitted?.vote, "approve", JSON.stringify(result.round.assignments[0].attempts));
    assert.equal((await repository.list(R)).length, 1);
  } finally {
    if (oldHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = oldHome;
  }
});
