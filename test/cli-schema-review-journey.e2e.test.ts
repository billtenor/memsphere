import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { get_encoding } from "tiktoken";
import { inspectWindowsReviewJob } from "../src/context_control/windows-review-job.js";
import { daemonStatus, stopDaemon } from "../src/daemon/service.js";
import { openContextControl } from "../src/project/context-control.js";
import { stripRunnerEnvironment } from "../src/runner/agent-types.js";
import { cleanupFixtureResources, createFixtureProcesses } from "./helpers/fixture-process.js";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { ownTestProcess } from "./helpers/owned-process.js";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const rethrowEntry = fileURLToPath(new URL("./fixtures/cli-rethrow.mjs", import.meta.url));
const reviewer = new URL("./fixtures/fake-acp-reviewer.mjs", import.meta.url).href;

async function executable(path: string, body: string) {
  if (process.platform === "win32") {
    await writeFile(path + ".mjs", body);
    await writeFile(path + ".cmd", `@"${process.execPath}" "${path}.mjs" %*\r\n`);
  } else {
    await writeFile(path, `#!${process.execPath}\n${body}`);
    await chmod(path, 0o755);
  }
}

test("a Schema author receives the original Review wakeup, verifies the saved candidate and finishes the Run", { timeout: 120000 }, async t => {
  const f = await initializedContextFixture(t);
  const service = (await openContextControl(f.root))!;
  const bin = join(f.directory, "bin"), gate = join(f.directory, "release");
  const queue = join(f.directory, "queue.json"), transcript = join(f.directory, "reviewer.ndjson");
  await mkdir(bin);
  const actor = "contract-author";
  const env = { ...process.env, MEMSPHERE_HOME: f.home, PATH: bin + delimiter + process.env.PATH };
  let activeRun: string | undefined;
  stripRunnerEnvironment(env);
  Object.assign(env, { CODEX_THREAD_ID: actor });
  await executable(join(bin, "codex"), `
    const args = process.argv.slice(2);
    if (args.includes("--version")) console.log("codex fixture");
    else if (args.includes("--help")) console.log("queue --thread --message");
    else import("node:fs").then(fs => fs.writeFileSync(${JSON.stringify(queue)}, JSON.stringify(args), {flag:"wx"}));`);
  await executable(join(bin, "codex-acp"), `
    if (process.argv.includes("--version")) console.log("codex-acp fixture");
    else {
      process.argv[2] = "gated-approve";
      process.env.REVIEW_TEST_GATE = ${JSON.stringify(gate)};
      process.env.REVIEW_TEST_CLI_TRANSCRIPT = ${JSON.stringify(transcript)};
      import(${JSON.stringify(reviewer)});
    }`);
  const readerReview = async (runId: string) => (await service.inspect(runId)).reviews.find(row => row.reviewer.actorId === "reader");
  let processObserver: ReturnType<typeof createFixtureProcesses> | undefined;
  const observeProcesses = () => processObserver ??= createFixtureProcesses();
  f.beforeCleanup(() => cleanupFixtureResources([
    () => writeFile(gate, "release"),
    async () => {
      let pid: number | undefined;
      try {
        const daemon = await daemonStatus(f.home);
        if (daemon.running) {
          await (await observeProcesses()).remember(daemon.pid);
          pid = daemon.pid;
        }
      } finally {
        await stopDaemon(f.home);
      }
      if (pid !== undefined) {
        const processes = await observeProcesses();
        const signal = AbortSignal.timeout(20_000);
        while ((await processes.alive(pid))[0]) await delay(50, undefined, { signal });
      }
    },
    async () => {
      if (process.platform === "win32" && activeRun) {
        const runId = activeRun;
        const signal = AbortSignal.timeout(20_000);
        let review = await readerReview(runId);
        while (review?.attempts?.at(-1) && !review.attempts.at(-1)?.workerJob && !review.attempts.at(-1)?.completion) {
          await delay(50, undefined, { signal });
          review = await readerReview(runId);
        }
        const job = review?.attempts?.at(-1)?.workerJob;
        if (job) {
          while ((await inspectWindowsReviewJob(job)).exists) await delay(50, undefined, { signal });
          const members = (await readerReview(runId))?.attempts?.at(-1)?.workerMembers ?? [];
          if (members.length) {
            const processes = await observeProcesses();
            processes.rememberSnapshot(...members);
            const pids = members.map(member => member.pid);
            while ((await processes.alive(...pids)).some(Boolean)) await delay(50, undefined, { signal });
          }
        }
      }
    },
    async () => (await processObserver)?.close()
  ]));
  await exec("git", ["init", "-b", "master"], { cwd: f.root, signal: t.signal });
  const configPath = join(f.root, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  config.control_plane = { runner: { permissions: ["artifact.read", "artifact.write", "artifact.submit", "decision.decide"] },
    actors: { reader: { kind: "agent", permissions: ["artifact.read", "decision.assess"], agent: { provider: "codex" } } } };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ language: "en", acp_providers: { codex: { idle_timeout_ms: 30000 } },
    runner_agents: { codex: { identity_enabled: true, async_enabled: true } } }));
  const procedure = join(f.directory, "produce.yaml"), bindings = join(f.directory, "review.json");
  await writeFile(procedure, `!procedure
syntax: memsphere-20261027-stable
mode: graph
name: deliver
defines: [Result]
actions:
  - !action
    id: write
    description: Write the result
    dependencies: [!dependency {from: START}]
    artifact:
      name: Result
      model:
        definedBy: memsphere/schema.json
        definition: |
          !schema
          syntax: memsphere-20261027-stable
          type: object
          fields: [summary]
      payload: {contentType: application/json}
      review: [approval]
`);
  await writeFile(bindings, JSON.stringify({ reviews: { "deliver#actions[write]": { policy: "artifact_acceptance.unanimous" } },
    slots: { "deliver::approval": { actors: ["reader"] } } }));
  const tokenizer = get_encoding("o200k_base");
  t.after(() => tokenizer.free());
  let runnerCalls = 0, runnerTokens = 0;
  const invoke = async (entrypoint: string[], args: string[]) => {
    t.signal.throwIfAborted();
    const started = performance.now();
    const command = exec(process.execPath, [...entrypoint, "--project", "test-project", ...args, "--output", "json"],
      { cwd: f.root, env, timeout: 30000, killSignal: "SIGKILL" });
    ownTestProcess(command.child, t.signal, f.beforeCleanup);
    const { stdout, stderr } = await command
      .finally(() => t.diagnostic(`${args.join(" ").split(" --", 1)[0]} took ${Math.round(performance.now() - started)} ms`));
    assert.equal(stderr, "");
    runnerCalls++;
    runnerTokens += tokenizer.encode(stdout).length;
    return JSON.parse(stdout);
  };
  const call = (...args: string[]) => invoke([entry], args);

  const { runId } = await call("run", "start", "--file", procedure, "--review-config", bindings, "--name", "Deliver one result");
  const draft = await call("continue", "enter-schema");
  const body = '{"summary":"Checked by the reader"}';
  const written = await call("continue", "schema", "report", "--position", draft.position, "--artifact", body);
  assert.equal(written.phase, "awaiting_finalization");
  const candidate = await call("continue", "report", "--artifact", body);
  assert.equal(candidate.artifactId, draft.artifactId);
  assert.equal(candidate.status, "awaiting_review");
  assert.equal((await daemonStatus(f.home)).running, false);
  assert.equal((await readerReview(runId))?.attempts?.at(-1)?.workerPid, undefined);
  // On failure preserve the internal cause from registering the wakeup.
  activeRun = runId;
  const wait = await invoke([rethrowEntry, entry], candidate.nextAction.resume.args);
  assert.equal(wait.roundId, candidate.roundId);
  assert.ok(wait.taskId);
  assert.equal((await daemonStatus(f.home)).running, true);
  const signal = AbortSignal.any([t.signal, AbortSignal.timeout(60000)]);
  // The wait command can launch the Reviewer. Keep the gate closed until
  // both the wakeup registration and the ACP session are established.
  const reviewerStarted = performance.now();
  let reader = await readerReview(runId);
  while (!reader?.attempts?.at(-1)?.session) {
    const failure = reader?.attempts?.at(-1)?.completion?.failure;
    if (failure) throw new Error(`Reviewer setup failed (${failure.code}) ${failure.message}`);
    await delay(30, undefined, { signal });
    reader = await readerReview(runId);
  }
  t.diagnostic(`Reviewer readiness took ${Math.round(performance.now() - reviewerStarted)} ms`);
  await writeFile(gate, "ready");
  let queued: string[] | undefined;
  while (!queued) {
    try { queued = JSON.parse(await readFile(queue, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(50, undefined, { signal });
    }
  }
  assert.deepEqual(queued.slice(0, 4), ["queue", "--thread", actor, "--message"]);
  const wake = queued[4].match(/\nmemsphere --project 'test-project' run review wait --review '([^']+)' --notification-round '([^']+)'$/);
  assert.ok(wake, queued[4]);
  assert.deepEqual(wake.slice(1), [candidate.reviewId, candidate.roundId]);
  const read = await call("run", "review", "wait", "--review", wake[1], "--notification-round", wake[2]);
  assert.equal(read.candidateId, candidate.artifactId);
  // The worker records its provider stop reason just after the vote becomes readable.
  let before = await service.inspect(runId);
  while (!before.reviews.find(row => row.reviewer.actorId === "reader")?.attempts?.at(-1)?.completion?.stopReason) {
    await delay(30, undefined, { signal });
    before = await service.inspect(runId);
  }
  await call("run", "review", "wait", "--review", wake[1], "--notification-round", wake[2]);
  assert.deepEqual(await service.inspect(runId), before);
  const approve = read.nextAction.choices.find((choice: { args: string[] }) => choice.args.includes("approve"));
  assert.ok(approve);
  const voted = await call(...approve.args.filter((_: string, i: number) => i >= (approve.args[0] === "--project" ? 2 : 0)));
  const finish = voted.nextAction.args;
  await call(...finish.slice(finish[0] === "--project" ? 2 : 0));
  const final = await service.inspect(runId);
  assert.equal(final.run.status, "done");
  assert.deepEqual(final.artifacts.map(item => item.id), [candidate.artifactId]);
  assert.deepEqual(final.steps[0].reviewRounds?.map(round => round.id), [candidate.roundId]);
  assert.equal(final.reviews.filter(row => row.reviewer.actorId === "reader").length, 1);
  const reviewerCalls = (await readFile(transcript, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(reviewerCalls.filter(row => row.args[0] === "continue" && row.args[1] === "submit").length, 1);
  const reviewerTokens = reviewerCalls.reduce((n, row) => n + tokenizer.encode(row.receipt).length, 0);
  t.diagnostic(JSON.stringify({ runnerCalls, reviewerCalls: reviewerCalls.length, receiptTokens: runnerTokens + reviewerTokens,
    tokenizer: "o200k_base", artifacts: final.artifacts.length, rounds: final.steps[0].reviewRounds?.length, finalStatus: final.run.status }));
});
