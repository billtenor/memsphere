import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { readProjectConfig } from "../src/config.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
const exec = promisify(execFile);
const cli = resolve("dist/cli.js");
const notification = (reviewId: string) => `[Memsphere 自动消息]\n请执行命令以继续：\nmemsphere --project 'test-project' run review wait --review '${reviewId}'`;

test("daemon survives CLI exit, restores View intent, and isolates separate Homes", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mem-daemon-"));
  const homes = [join(directory, "deep-".repeat(16)), join(directory, "b")];
  const call = (home: string, ...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, MEMSPHERE_HOME: home } });
  t.after(async () => { for (const home of homes) await call(home, "daemon", "stop").catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  for (const home of homes) await mkdir(home);
  const results = await Promise.all(homes.map(home => call(home, "daemon", "start")));
  const first = JSON.parse(results[0].stdout), second = JSON.parse(results[1].stdout);
  assert.notEqual(first.pid, second.pid);
  const firstState = JSON.parse(await readFile(join(homes[0], ".runtime", "daemon.json"), "utf8"));
  if (process.platform !== "win32") {
    assert.ok(Buffer.byteLength(firstState.endpoint) < 100);
    assert.equal((await stat(dirname(firstState.endpoint))).mode & 0o777, 0o700);
    assert.equal((await stat(firstState.endpoint)).mode & 0o777, 0o600);
  }
  const repeated = JSON.parse((await call(homes[0], "daemon", "start")).stdout);
  assert.equal(repeated.instanceId, first.instanceId);
  await writeFile(join(homes[0], ".runtime", "daemon-services.json"), JSON.stringify({ version: 1, view: { desiredState: "running", configPath: join(directory, "missing-config") } }));
  const restarted = JSON.parse((await call(homes[0], "daemon", "restart")).stdout);
  assert.notEqual(restarted.instanceId, first.instanceId);
  if (process.platform !== "win32") await assert.rejects(stat(dirname(firstState.endpoint)), { code: "ENOENT" });
  assert.equal(restarted.view.desiredState, "running");
  assert.equal(restarted.view.running, false);
  assert.ok(restarted.view.error);
  assert.equal(JSON.parse((await call(homes[1], "daemon", "status")).stdout).instanceId, second.instanceId);
});

async function writeTestCommand(command: string, source: string) {
  if (process.platform === "win32") {
    const script = `${command}.mjs`;
    await writeFile(script, source);
    await writeFile(`${command}.cmd`, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    await writeFile(command, source);
    await chmod(command, 0o755);
  }
}

async function reviewFixture(t: TestContext, queueMode: "success" | "all-fail" | "cas-conflict" = "success", includeAgent = true, realReviewer = false) {
  const f = await businessFixture(t, {});
  const bin = join(f.directory, "bin"); await mkdir(bin);
  const gate = join(f.directory, "review-gate");
  const runnerAgents = { codex: { identity_enabled: true, async_enabled: true } };
  const providers = { codex: { env: { REVIEW_TEST_GATE: gate } } };
  const provider = join(bin, "codex-acp");
  await writeTestCommand(provider, `#!${process.execPath}\nif (process.argv.includes("--version")) { console.log("fake-acp test"); process.exit(0); } process.env.MEMSPHERE_HOME = ${JSON.stringify(f.home)}; process.argv[2] = "gated-approve"; import(${JSON.stringify(pathToFileURL(resolve("test/fixtures/fake-acp-reviewer.mjs")).href)});\n`);
  const queue = join(f.directory, "queue.json");
  const queueLog = join(f.directory, "queue-attempts.ndjson");
  const fake = join(bin, "codex");
  await writeTestCommand(fake, `#!${process.execPath}\nimport('node:fs').then(fs => { const args=process.argv.slice(2); if(args[0]==='--version') console.log('codex test'); else if(args.includes('--help')) console.log('queue --thread --message'); else { fs.writeFileSync(${JSON.stringify(queue)},JSON.stringify(args)); fs.appendFileSync(${JSON.stringify(queueLog)},JSON.stringify(args)+"\\n"); if(${JSON.stringify(queueMode)}==="cas-conflict") { const path = ${JSON.stringify(join(f.home, "data", "daemon-tasks"))}; for(const file of fs.readdirSync(path).filter(x=>x.startsWith("task-") && x.endsWith(".json"))) { const record = path+"/"+file; const row=JSON.parse(fs.readFileSync(record,"utf8")); row.revision++; fs.writeFileSync(record+".tmp",JSON.stringify(row)); fs.renameSync(record+".tmp",record); } } if(${JSON.stringify(queueMode)}==="all-fail") process.exitCode=1; } });\n`);
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  await writeFile(join(f.root, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: f.root, memory_path: "memory" }, control_plane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", permissions: ["artifact.read", "decision.decide"] }, ...(includeAgent ? { agent: { kind: "agent", permissions: ["artifact.read", "decision.assess"], agent: { provider: "codex" } } } : {}) } } }));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: runnerAgents, acp_providers: providers }));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "origin-session", TRAECLI_THREAD_ID: "", PATH: `${bin}${delimiter}${process.env.PATH}` };
  const call = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env });
  f.beforeCleanup(async () => {
    await completeAgent(true).catch(() => undefined);
    const pids = new Set((await reviewState()).round.assignments.flatMap(a => a.attempts?.map(attempt => attempt.workerPid).filter((pid): pid is number => !!pid && pid !== process.pid) ?? []));
    try { pids.add(JSON.parse(await readFile(join(f.home, ".runtime", "daemon.json"), "utf8")).pid); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const { stopDaemon } = await import("../src/daemon/service.js");
    await stopDaemon(f.home);
    // A persisted result or removed daemon state can precede process exit.
    // Processes can still write activity, and Windows retains each process cwd.
    const deadline = Date.now() + 20000;
    for (const pid of pids) for (;;) {
      try { process.kill(pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") break; throw error; }
      if (process.platform === "linux") {
        try {
          const stat = await readFile(`/proc/${pid}/stat`, "utf8");
          if (["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3))) break;
        } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
      }
      assert.ok(Date.now() < deadline, `fixture process ${pid} must exit before removing its cwd`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  const { readArtifactReviewForRunner } = await import("../src/context_control/review-repository.js");
  // Run creation, candidate production and session binding are preconditions,
  // not the CLI boundary under test. Construct them through domain APIs/Stores.
  const config = await readProjectConfig("test-project", f.home);
  const service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = {
    tag: "!procedure", syntax: "memsphere-20261027-stable", names: ["async-test"], defines: ["Async test"], mode: "graph",
    actions: [{ tag: "!action", id: "work", description: "Produce", dependencies: [{ tag: "!dependency", from: "START" }],
      artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" }, review: ["approval"] } }]
  };
  const initial = await service.withGraph(g => g.start({ name: "Async", language: "zh-CN", procedure, controlPlane: config.controlPlane,
    reviewConfiguration: { reviews: { "async-test#actions[work]": { policy: "artifact_acceptance.unanimous" } },
      slots: { "async-test::approval": { actorIds: includeAgent ? ["human", "agent"] : ["human"] } } } }));
  const started = { runId: initial.run.id };
  const work = initial.steps[0];
  await service.withGraph(async graph => {
    await graph.enter(started.runId, work.id);
    await graph.report(started.runId, work.id, { text: "candidate" });
  });
  await (await openCommandStates(true, f.home))!.create({}, "codex-origin-session", {
    id: "codex-origin-session", agentType: "codex", sessionId: "origin-session", updatedAt: new Date().toISOString(),
    commandGroup: "run", groupId: started.runId, status: "active", parameters: { project: "test-project", step: work.id }, state: { reads: {} }
  });
  const snapshot = await service.snapshot(started.runId);
  const step = snapshot.steps.find(s => s.reviewRounds?.length)!;
  const reviewId = `graph-review-${started.runId}__${step.id}`;
  const reviewState = () => readArtifactReviewForRunner({ runsRoot: join(f.root, "runs"), reviewId });
  const api = await import("../src/context_control/review-repository.js");
  const agentInput = { runsRoot: join(f.root, "runs"), reviewId, roundId: (await reviewState()).round.id, actorId: "agent" };
  if (includeAgent && !realReviewer) {
    // Most cases test wait/queue behavior, not ACP dispatch. Keep a controlled
    // pending assignment instead of repeating an entire Reviewer/tool process.
    const claimed = await api.claimArtifactReviewAgentAssignment({ ...agentInput, workerPid: process.pid });
    assert.ok(claimed);
    await api.markArtifactReviewAgentCliReady({ ...agentInput, attemptId: claimed.attempt.id });
  }
  const completeAgent = async (allowManual = false) => {
    if (!includeAgent) return;
    if (!realReviewer) {
      const assignment = (await reviewState()).round.assignments.find(a => a.actorId === "agent")!;
      if (assignment.status !== "submitted") await api.submitArtifactReviewAgentAssignment({ ...agentInput,
        attemptId: assignment.attempts!.at(-1)!.id, vote: "approve" });
      return;
    }
    await writeFile(gate, "ready");
    const current = await reviewState();
    if (allowManual && current.round.assignments.find(a => a.actorId === "agent")!.status === "queued") {
      const api = await import("../src/context_control/review-repository.js");
      const input = { runsRoot: join(f.root, "runs"), reviewId, roundId: current.round.id, actorId: "agent" };
      const claimed = await api.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid });
      if (claimed) {
        const attempt = { ...input, attemptId: claimed.attempt.id };
        await api.markArtifactReviewAgentCliReady(attempt);
        await api.submitArtifactReviewAgentAssignment({ ...attempt, vote: "approve" });
      }
    }
    for (let i = 0; i < 400; i++) {
      const assignment = (await reviewState()).round.assignments.find(a => a.actorId === "agent")!;
      if (assignment.status === "submitted") return;
      if (assignment.status === "failed") assert.fail(JSON.stringify(assignment.attempts));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("Agent did not submit");
  };
  const voteHuman = async (vote: "approve" | "request_changes", complete = true) => {
    if (complete) await completeAgent(true);
    const { submitArtifactReviewHumanAssignmentForRunner } = await import("../src/context_control/review-repository.js");
    const current = await reviewState();
    return submitArtifactReviewHumanAssignmentForRunner({ runsRoot: join(f.root, "runs"), runId: started.runId, reviewId,
      roundId: current.round.id, assignmentId: "human", vote,
      comments: vote === "approve" ? [] : [{ body: "Test fixture requests revision", severity: "blocking" }],
      authorizationNote: "Isolated fixture vote" });
  };
  const setAsync = (enabled: boolean) => writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: enabled } }, acp_providers: providers }));
  return { ...f, call, env, queue, queueLog, started, reviewId, reviewState, voteHuman, setAsync, completeAgent };
}

test("repeated asynchronous review wait reuses one task and sends a continuation to its original session", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "success", true, true);
  const { call, queue, started } = f;
  const wait = await call("continue", "review", "wait");
  assert.match(wait.stdout, /已登记异步等待/);
  const again = await call("continue", "review", "wait");
  assert.equal(/task-[a-f0-9-]+/.exec(wait.stdout)![0], /task-[a-f0-9-]+/.exec(again.stdout)![0]);
  await f.completeAgent();
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
  assert.ok((await f.reviewState()).round.assignments.find(a => a.actorId === "agent")!.attempts?.at(-1)?.sessionId);
  let sent: string[] | undefined;
  for (let i = 0; i < 200; i++) { try { sent = JSON.parse(await readFile(queue, "utf8")); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); } }
  assert.ok(sent, "daemon should deliver the review result");
  assert.equal(sent[0], "queue"); assert.equal(sent[2], "origin-session");
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
  const sync = await call("continue", "review", "wait");
  assert.equal(sent[4], notification(f.reviewId));
  assert.ok(sync.stdout.includes(f.reviewId));
  const ready = await call("continue", "review", "wait");
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.doesNotMatch(sent[4], /approve|投票|状态|Reviewer/);
  assert.ok(started.runId);
  const { listTasks } = await import("../src/daemon/tasks.js");
  let rows = await listTasks(f.home);
  for (let i = 0; i < 100 && rows[0].value.status !== "completed"; i++) {
    await new Promise(resolve => setTimeout(resolve, 25)); rows = await listTasks(f.home);
  }
  const task = rows[0];
  const status = JSON.parse((await call("run", "review", "wait", "status", "--review", task.value.input.reviewId)).stdout);
  assert.equal(status[0].status, "completed");
});

test("explicit retry delivers the same continuation to the original session", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  const { call, queue } = f;
  await call("continue", "review", "wait");
  await f.completeAgent();
  const task = await waitForTaskStatus(f.home, "completed");
  const { updateTask } = await import("../src/daemon/tasks.js");
  await updateTask(task, { status: "failed", error: { stage: "send", code: "fixture", message: "Explicit retry fixture" } }, f.home);
  await rm(queue);
  const retry = await call("run", "review", "wait", "retry", "--review", task.value.input.reviewId, "--round", task.value.input.roundId);
  assert.match(retry.stdout, /registered for retry/);
  for (let i = 0; i < 200; i++) { try { await readFile(queue); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); } }
  const retriedMessage = JSON.parse(await readFile(queue, "utf8"));
  assert.equal(retriedMessage[2], "origin-session");
  assert.equal(retriedMessage[4], notification(f.reviewId));
});

test("Continue refuses missing, ambiguous, disabled and invalid session identities without creating state", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const { snapshotTree } = await import("./helpers/business-data.js");
  for (const [enabled, code, trae] of [[true, "", ""], [true, "one", "two"], [false, "one", ""], [true, "../bad", ""]] as const) {
    await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: enabled } } }));
    const before = await snapshotTree(f.home);
    await assert.rejects(exec(process.execPath, [cli, "continue", "report", "--artifact", "must not be written"], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: code, TRAECLI_THREAD_ID: trae } }));
    assert.deepEqual(await snapshotTree(f.home), before);
  }
});

test("task registration deduplicates active waits while preserving terminal history", async t => {
  const f = await businessFixture(t, {});
  const { registerTask, listTasks, updateTask } = await import("../src/daemon/tasks.js");
  const input = { input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex" as const, sessionId: "one", agentCommand: "/codex" } };
  let previous = await registerTask(input, f.home);
  for (const status of ["failed", "cancelled", "completed"] as const) {
    const row = (await listTasks(f.home)).find(r => r.id === previous.id)!;
    await updateTask(row, { status, error: status === "failed" ? { stage: "send", code: "queue_failed", message: "Failed" } : status === "cancelled" ? { stage: "cancel", code: "round_changed", message: "Changed" } : undefined }, f.home);
    const results = await Promise.all([registerTask(input, f.home), registerTask(input, f.home)]);
    assert.equal(results[0].id, results[1].id);
    assert.notEqual(results[0].id, previous.id);
    assert.equal((await listTasks(f.home)).find(r => r.id === previous.id)!.value.status, status);
    previous = results[0];
  }
  assert.equal((await listTasks(f.home)).length, 4);
  assert.equal((await listTasks(f.home)).filter(r => ["queued", "running"].includes(r.value.status)).length, 1);
});

test("View desired running/stopped survives daemon restarts while View remains independently controlled", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {});
  const env = { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "", TRAECLI_THREAD_ID: "" };
  const call = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.cwd, env });
  f.beforeCleanup(async () => { await call("daemon", "stop"); });
  const start = await call("view", "start");
  const origin = /http:\/\/[^\s]+/.exec(start.stdout)![0];
  assert.equal((await fetch(origin)).status, 200);
  const first = JSON.parse((await call("daemon", "status")).stdout);
  assert.equal(first.view.desiredState, "running"); assert.equal(first.view.running, true);
  const restarted = JSON.parse((await call("daemon", "restart")).stdout);
  assert.equal(restarted.view.desiredState, "running"); assert.equal(restarted.view.running, true);
  assert.notEqual(restarted.instanceId, first.instanceId);
  await call("view", "stop");
  const stopped = JSON.parse((await call("daemon", "status")).stdout);
  assert.equal(stopped.running, true); assert.equal(stopped.view.running, false);
  const again = JSON.parse((await call("daemon", "restart")).stdout);
  assert.equal(again.view.desiredState, "stopped"); assert.equal(again.view.running, false);
});

test("daemon recovery reports interrupted execution and cancels disabled queued tasks before accessing their Project", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const { registerTask, listTasks, updateTask } = await import("../src/daemon/tasks.js");
  const input = { input: { project: "unavailable", runId: "r", reviewId: "v", roundId: "one", configPath: join(f.directory, "missing-config"), cwd: f.root }, recipient: { agentType: "codex" as const, sessionId: "disabled", agentCommand: "/must-not-be-run" } };
  await registerTask(input, f.home);
  await registerTask({ ...input, recipient: { ...input.recipient, sessionId: "interrupted" } }, f.home);
  const interrupted = (await listTasks(f.home)).find(row => row.value.recipient.sessionId === "interrupted")!;
  await updateTask(interrupted, { status: "running", daemonInstanceId: "old-instance" }, f.home);
  const call = (...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, MEMSPHERE_HOME: f.home } });
  f.beforeCleanup(async () => { await call("daemon", "stop"); });
  await call("daemon", "start");
  let rows = await listTasks(f.home);
  for (let i = 0; i < 200 && rows.some(row => row.value.status === "queued" || row.value.status === "running"); i++) {
    await new Promise(resolve => setTimeout(resolve, 25)); rows = await listTasks(f.home);
  }
  const cancelled = rows.find(row => row.value.recipient.sessionId === "disabled")!.value;
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.error?.code, "runner_disabled");
  const recovered = rows.find(row => row.value.recipient.sessionId === "interrupted")!.value;
  assert.equal(recovered.status, "failed"); assert.equal(recovered.error?.code, "execution_interrupted"); assert.equal(recovered.error?.stage, "recovery");
});

test("a Runner without artifact.read cannot reach asynchronous review registration", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  await writeFile(join(f.root, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: f.root, memory_path: "memory" }, control_plane: { runner: { permissions: ["artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", permissions: ["artifact.read", "decision.decide"] } } } }));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: true } } }));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "denied-session", TRAECLI_THREAD_ID: "" };
  const call = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env });
  const procedure = join(f.directory, "denied.yaml");
  await writeFile(procedure, `!procedure\nsyntax: memsphere-20261027-stable\nnames: [denied-test]\ndefines: [Read permission test]\nmode: graph\nactions:\n  - !action\n    id: work\n    description: Produce\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: Candidate\n      model: {definedBy: raw.json, definition: '{}'}\n      payload: {contentType: text/plain}\n      review: [approval]\n`);
  const bindings = join(f.directory, "bindings.json");
  await writeFile(bindings, JSON.stringify({ reviews: { "denied-test#actions[work]": { policy: "artifact_acceptance.unanimous" } }, slots: { "denied-test::approval": { actors: ["human"] } } }));
  await assert.rejects(call("run", "start", "--file", procedure, "--name", "Denied", "--review-config", bindings, "--output", "json"), /artifact.read/);
  const { listTasks } = await import("../src/daemon/tasks.js");
  const { daemonStatus } = await import("../src/daemon/service.js");
  assert.deepEqual(await listTasks(f.home), []);
  assert.equal((await daemonStatus(f.home)).running, false);
});

async function waitForTaskStatus(home: string, status: string, id?: string) {
  const { listTasks } = await import("../src/daemon/tasks.js");
  const deadline = Date.now() + 20000;
  let rows = await listTasks(home);
  while (Date.now() < deadline) {
    const row = id ? rows.find(row => row.id === id) : rows[0];
    if (row?.value.status === status) return row;
    await new Promise(resolve => setTimeout(resolve, 25));
    rows = await listTasks(home);
  }
  assert.fail(`Expected task ${id ?? "first"} ${status}; observed ${JSON.stringify(rows.map(row => ({ id: row.id, status: row.value.status })))}`);
}

test("daemon notification for a requested revision contains only the continuation command", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  await f.call("continue", "review", "wait");
  await f.call("daemon", "stop");
  await f.voteHuman("request_changes");
  assert.equal((await f.reviewState()).review.status, "awaiting_revision");
  await f.call("daemon", "start");
  await waitForTaskStatus(f.home, "completed");
  const sent = JSON.parse(await readFile(f.queue, "utf8"));
  const sync = await f.call("run", "review", "wait", "--review", f.reviewId);
  assert.equal(sent[2], "origin-session");
  assert.equal(sent[4], notification(f.reviewId));
  assert.ok(sync.stdout.includes(f.reviewId));
});

test("failed wakeup remains queryable without sending a second notification", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "all-fail");
  await f.call("continue", "review", "wait");
  await f.voteHuman("approve");
  const task = await waitForTaskStatus(f.home, "failed");
  assert.equal(task.value.error?.stage, "send");
  const attempts: string[][] = (await readFile(f.queueLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0][2], "origin-session");
  assert.equal(attempts[0][4], notification(f.reviewId));
  const ready = await f.call("run", "review", "wait", "--review", f.reviewId);
  assert.ok(ready.stdout.includes(f.reviewId));
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.equal((await readFile(f.queueLog, "utf8")).trim().split("\n").length, 1);
  assert.equal((await waitForTaskStatus(f.home, "failed")).value.error?.stage, "send");
});

test("unusable identity rejects Continue while native synchronous review remains available", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  await f.voteHuman("approve");
  const { requireCommandState } = await import("../src/home/command-state-store.js");
  const before = await requireCommandState("codex-origin-session", f.home);
  for (const [codex, traex] of [["one", "two"], ["../unsafe", ""]]) {
    const env = { ...f.env, CODEX_THREAD_ID: codex, TRAECLI_THREAD_ID: traex };
    const call = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env });
    await assert.rejects(call("continue", "review", "wait"));
    const native = await call("run", "review", "wait", "--review", f.reviewId);
    assert.ok(native.stdout.includes(f.reviewId));
  }
  assert.deepEqual(await requireCommandState("codex-origin-session", f.home), before);
  await assert.rejects(readFile(f.queue), { code: "ENOENT" });
  const { listTasks } = await import("../src/daemon/tasks.js");
  assert.deepEqual(await listTasks(f.home), []);
});

for (const state of ["passed", "awaiting_revision"] as const) {
  test(`already-returnable ${state} result bypasses daemon and task registration`, { timeout: 90000 }, async t => {
    const f = await reviewFixture(t);
    await f.voteHuman(state === "passed" ? "approve" : "request_changes");
    if ((await f.reviewState()).review.status === "awaiting_runner_vote") {
      await f.call("continue", "review", "vote", "--vote", state === "passed" ? "approve" : "request_changes", "--comment", "Fixture decision");
    }
    assert.equal((await f.reviewState()).review.status, state);
    const sync = await f.call("run", "review", "wait", "--review", f.reviewId);
    const ready = await f.call("run", "review", "wait", "--review", f.reviewId);
    assert.equal(ready.stdout, sync.stdout);
    assert.ok(!ready.stdout.startsWith("[Memsphere 自动消息]"));
    const { listTasks } = await import("../src/daemon/tasks.js");
    const { daemonStatus } = await import("../src/daemon/service.js");
    assert.deepEqual(await listTasks(f.home), []);
    assert.equal((await daemonStatus(f.home)).running, false);
    await assert.rejects(readFile(f.queue), { code: "ENOENT" });
  });
}

test("native report refuses another session binding until the caller explicitly enters its target", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  const a = JSON.parse((await f.call("run", "start", "--name", "First free Run", "--output", "json")).stdout);
  await f.call("run", "start", "--name", "Second free Run", "--output", "json");
  const { openContextControl } = await import("../src/project/context-control.js");
  const service = (await openContextControl(f.root))!;
  const before = await service.snapshot(a.id);
  await assert.rejects(f.call("run", "report", "--run", a.id, "--name", "Candidate", "--artifact", "must not be written", "--output", "json"), /SESSION_CONTEXT_CONFLICT/);
  assert.deepEqual(await service.snapshot(a.id), before);
  await f.call("run", "enter", "--run", a.id);
  await f.call("run", "report", "--run", a.id, "--name", "Candidate", "--artifact", "accepted after explicit enter");
  assert.equal((await service.snapshot(a.id)).artifacts.length, 1);
});

test("daemon control refuses unauthorized stop requests without changing its instance", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const call = (...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, MEMSPHERE_HOME: f.home } });
  f.beforeCleanup(async () => { await call("daemon", "stop"); });
  const started = JSON.parse((await call("daemon", "start")).stdout);
  const state = JSON.parse(await readFile(join(f.home, ".runtime", "daemon.json"), "utf8"));
  const { createConnection } = await import("node:net");
  for (const invalid of [{ protocol: 2, token: state.token }, { protocol: 1, token: "0".repeat(state.token.length) }]) {
    const response = await new Promise<{ error?: string }>((resolve, reject) => {
      const socket = createConnection(state.endpoint);
      let buffer = "";
      socket.setTimeout(5000, () => socket.destroy(new Error("Control response timeout")));
      socket.once("error", reject);
      socket.once("connect", () => socket.write(JSON.stringify({ ...invalid, instanceId: state.instanceId, command: "stop" }) + "\n"));
      socket.on("data", chunk => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) {
          socket.destroy();
          try { resolve(JSON.parse(buffer.split("\n")[0])); } catch (error) { reject(error); }
        }
      });
    });
    assert.match(response.error!, /protocol\/authentication mismatch/);
    const after = JSON.parse((await call("daemon", "status")).stdout);
    assert.equal(after.running, true); assert.equal(after.instanceId, started.instanceId);
  }
});


test("pending wait uses synchronous execution when the caller configuration disables async", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "success", true, true);
  await f.setAsync(false);
  const { listTasks } = await import("../src/daemon/tasks.js");
  const { daemonStatus } = await import("../src/daemon/service.js");
  let finished = false;
  const waiting = f.call("continue", "review", "wait").then(result => { finished = true; return result; });
  const deadline = Date.now() + 20000;
  while (!(await f.reviewState()).round.assignments.find(a => a.actorId === "agent")!.attempts?.at(-1)?.sessionId) {
    assert.ok(Date.now() < deadline, "synchronous wait must start its gated Reviewer session");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(finished, false);
  assert.deepEqual(await listTasks(f.home), []);
  assert.equal((await daemonStatus(f.home)).running, false);
  await f.completeAgent();
  const result = await waiting;
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
  assert.ok(result.stdout.includes(f.reviewId));
  assert.doesNotMatch(result.stdout, /已登记|Memsphere 自动消息/);
});

for (const async of [false, true]) test(`Human-only wait returns immediately with async=${async} and never registers a task`, { timeout: 30000 }, async t => {
  const f = await reviewFixture(t, "success", false);
  await f.setAsync(async);
  const result = await f.call("continue", "review", "wait");
  assert.doesNotMatch(result.stdout, /已登记/);
  assert.match(result.stdout, /run review vote/);
  assert.equal((await f.reviewState()).round.assignments[0].status, "draft");
  const { listTasks } = await import("../src/daemon/tasks.js");
  assert.deepEqual(await listTasks(f.home), []);
});

test("a completed historical wait does not block a fresh pending wait in the same round", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  const { listTasks, updateTask } = await import("../src/daemon/tasks.js");
  await f.call("continue", "review", "wait");
  await f.call("daemon", "stop");
  const previous = (await listTasks(f.home))[0];
  await updateTask(previous, { status: "completed", daemonInstanceId: undefined }, f.home);
  const outputs = await Promise.all([f.call("continue", "review", "wait"), f.call("continue", "review", "wait")]);
  const ids = outputs.map(r => /task-[a-f0-9-]+/.exec(r.stdout)![0]);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], previous.id);
  const rows = await listTasks(f.home);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(r => ["queued", "running"].includes(r.value.status)).length, 1);
  await f.voteHuman("approve");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && (await listTasks(f.home)).some(r => r.value.status !== "completed")) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok((await listTasks(f.home)).every(r => r.value.status === "completed"));
  assert.equal((await readFile(f.queueLog, "utf8")).trim().split("\n").length, 1);
  assert.doesNotMatch((await f.call("continue", "review", "wait")).stdout, /已登记/);
  assert.equal((await listTasks(f.home)).length, 2);
});


test("explicit task retry and fresh registration share the active-task deduplication lock", async t => {
  const f = await businessFixture(t, {});
  const { registerTask, retryFailedTask, listTasks, updateTask } = await import("../src/daemon/tasks.js");
  const input = { input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex" as const, sessionId: "one", agentCommand: "/codex" } };
  const first = await registerTask(input, f.home);
  await updateTask((await listTasks(f.home))[0], { status: "failed", error: { stage: "send", code: "fixture", message: "Failed" } }, f.home);
  const [retry, registration] = await Promise.all([retryFailedTask(first.id, f.home), registerTask(input, f.home)]);
  assert.equal(retry.id, registration.id);
  assert.equal((await listTasks(f.home)).filter(r => ["queued", "running"].includes(r.value.status)).length, 1);
});


test("terminal task write conflict suspends scheduling, exposes diagnostics and recovers without resending", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "cas-conflict");
  await f.call("continue", "review", "wait");
  await f.voteHuman("approve");
  let status: any;
  for (let i = 0; i < 100; i++) {
    status = JSON.parse((await f.call("daemon", "status")).stdout);
    if (status.taskErrors.some((e: { error: string }) => e.error.includes("TASK_STATE_WRITE_FAILED"))) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(status.taskErrors[0]?.error ?? "", /TASK_STATE_WRITE_FAILED/);
  assert.equal(status.tasks.running, 1);
  const { listTasks, registerTask } = await import("../src/daemon/tasks.js");
  const original = (await listTasks(f.home))[0];
  // A disabled-recipient marker reaches cancelled only after another scheduling
  // pass. Observe that progress rather than guessing how many ticks fit in 2.2s.
  const marker = await registerTask({ input: original.value.input,
    recipient: { agentType: "traex", sessionId: "tick-marker", agentCommand: "unused" } }, f.home);
  await waitForTaskStatus(f.home, "cancelled", marker.id);
  const attempts = () => readFile(f.queueLog, "utf8").then(s => s.trim().split("\n"));
  assert.equal((await attempts()).length, 1, "subsequent ticks must not resend after a terminal write conflict");
  await f.call("daemon", "restart");
  const row = (await listTasks(f.home)).find(row => row.id === original.id)!;
  assert.equal(row.value.status, "failed");
  assert.equal(row.value.error?.code, "execution_interrupted");
  assert.equal(row.value.error?.stage, "recovery");
  assert.equal((await attempts()).length, 1, "graceful restart must not queue an uncertain delivery again");
});
