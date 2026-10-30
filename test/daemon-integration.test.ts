import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
const exec = promisify(execFile);
const cli = resolve("dist/cli.js");
const notification = (reviewId: string) => `[Memsphere 自动消息]\n请执行命令以继续：\nmemsphere --project 'test-project' run review wait --review '${reviewId}'`;

test("daemon survives CLI exit, restores View intent, and isolates separate Homes", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mem-daemon-"));
  const homes = [join(directory, "a"), join(directory, "b")];
  const call = (home: string, ...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, MEMSPHERE_HOME: home } });
  t.after(async () => { for (const home of homes) await call(home, "daemon", "stop").catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  for (const home of homes) await mkdir(home);
  const results = await Promise.all(homes.map(home => call(home, "daemon", "start")));
  const first = JSON.parse(results[0].stdout), second = JSON.parse(results[1].stdout);
  assert.notEqual(first.pid, second.pid);
  const repeated = JSON.parse((await call(homes[0], "daemon", "start")).stdout);
  assert.equal(repeated.instanceId, first.instanceId);
  await writeFile(join(homes[0], ".runtime", "daemon-services.json"), JSON.stringify({ version: 1, view: { desiredState: "running", configPath: join(directory, "missing-config") } }));
  const restarted = JSON.parse((await call(homes[0], "daemon", "restart")).stdout);
  assert.notEqual(restarted.instanceId, first.instanceId);
  assert.equal(restarted.view.desiredState, "running");
  assert.equal(restarted.view.running, false);
  assert.ok(restarted.view.error);
  assert.equal(JSON.parse((await call(homes[1], "daemon", "status")).stdout).instanceId, second.instanceId);
});

async function reviewFixture(t: TestContext, queueMode: "success" | "all-fail" | "cas-conflict" = "success") {
  const f = await businessFixture(t, {});
  const bin = join(f.directory, "bin"); await mkdir(bin);
  const queue = join(f.directory, "queue.json");
  const queueLog = join(f.directory, "queue-attempts.ndjson");
  const fake = join(bin, "codex");
  await writeFile(fake, `#!${process.execPath}\nimport('node:fs').then(fs => { const args=process.argv.slice(2); if(args[0]==='--version') console.log('codex test'); else if(args.includes('--help')) console.log('queue --thread --message'); else { fs.writeFileSync(${JSON.stringify(queue)},JSON.stringify(args)); fs.appendFileSync(${JSON.stringify(queueLog)},JSON.stringify(args)+"\\n"); if(${JSON.stringify(queueMode)}==="cas-conflict") { const path = ${JSON.stringify(join(f.home, "data", "daemon-tasks"))}; for(const file of fs.readdirSync(path).filter(x=>x.startsWith("task-") && x.endsWith(".json"))) { const record = path+"/"+file; const row=JSON.parse(fs.readFileSync(record,"utf8")); row.revision++; fs.writeFileSync(record+".tmp",JSON.stringify(row)); fs.renameSync(record+".tmp",record); } } if(${JSON.stringify(queueMode)}==="all-fail") process.exitCode=1; } });\n`);
  await chmod(fake, 0o755);
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  await writeFile(join(f.root, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: f.root, memory_path: "memory" }, control_plane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", permissions: ["artifact.read", "decision.decide"] } } } }));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: true } } }));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "origin-session", TRAECLI_THREAD_ID: "", PATH: `${bin}:${process.env.PATH}` };
  const call = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env });
  f.beforeCleanup(async () => { await call("daemon", "stop"); });
  const procedure = join(f.directory, "graph.yaml");
  await writeFile(procedure, `!procedure\nsyntax: memsphere-20261027-stable\nnames: [async-test]\ndefines: [Async test]\nmode: graph\nactions:\n  - !action\n    id: work\n    description: Produce\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: Candidate\n      model: {definedBy: raw.json, definition: '{}'}\n      payload: {contentType: text/plain}\n      review: [approval]\n`);
  const bindings = join(f.directory, "bindings.json");
  await writeFile(bindings, JSON.stringify({ reviews: { "async-test#actions[work]": { policy: "artifact_acceptance.unanimous" } }, slots: { "async-test::approval": { actors: ["human"] } } }));
  const started = JSON.parse((await call("run", "start", "--file", procedure, "--name", "Async", "--review-config", bindings, "--output", "json")).stdout);
  await call("continue", "report", "--artifact", "candidate");
  const { openContextControl } = await import("../src/project/context-control.js");
  const { readArtifactReviewForRunner } = await import("../src/context_control/review-repository.js");
  const snapshot = await (await openContextControl(f.root))!.snapshot(started.runId);
  const step = snapshot.steps.find(s => s.reviewRounds?.length)!;
  const reviewId = `graph-review-${started.runId}__${step.id}`;
  const reviewState = () => readArtifactReviewForRunner({ runsRoot: join(f.root, "runs"), reviewId });
  const voteHuman = async (vote: "approve" | "request_changes") => {
    const comments = join(f.directory, "human-comments.json");
    await writeFile(comments, JSON.stringify(vote === "approve" ? [] : [{ body: "Test fixture requests revision", severity: "blocking" }]));
    return call("continue", "review", "submit-for-human", "--assignment", "human", "--vote", vote, "--comments-file", comments, "--authorization-note", "Isolated fixture vote");
  };
  const setAsync = (enabled: boolean) => writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: enabled } } }));
  return { ...f, call, env, queue, queueLog, started, reviewId, reviewState, voteHuman, setAsync };
}

test("asynchronous review wait returns immediately and sends only a continuation command to its original session", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  const { call, queue, started } = f;
  const wait = await call("continue", "review", "wait");
  assert.match(wait.stdout, /已登记异步等待/);
  const again = await call("continue", "review", "wait");
  assert.equal(/task-[a-f0-9-]+/.exec(wait.stdout)![0], /task-[a-f0-9-]+/.exec(again.stdout)![0]);
  const comments = join(f.directory, "comments.json"); await writeFile(comments, "[]");
  await call("continue", "review", "submit-for-human", "--assignment", "human", "--vote", "approve", "--comments-file", comments, "--authorization-note", "Test fixture authorized vote");
  let sent: string[] | undefined;
  for (let i = 0; i < 200; i++) { try { sent = JSON.parse(await readFile(queue, "utf8")); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); } }
  assert.ok(sent, "daemon should deliver the review result");
  assert.equal(sent[0], "queue"); assert.equal(sent[2], "origin-session");
  const sync = await call("continue", "review", "wait");
  assert.equal(sent[4], notification(f.reviewId));
  assert.ok(sync.stdout.includes(f.reviewId));
  const ready = await call("continue", "review", "wait");
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.doesNotMatch(sent[4], /approve|投票|状态|Reviewer/);
  assert.ok(started.runId);
  const { listTasks, updateTask } = await import("../src/daemon/tasks.js");
  let rows = await listTasks(f.home);
  for (let i = 0; i < 100 && rows[0].value.status !== "completed"; i++) {
    await new Promise(resolve => setTimeout(resolve, 25)); rows = await listTasks(f.home);
  }
  const task = rows[0];
  const status = JSON.parse((await call("run", "review", "wait", "status", "--review", task.value.input.reviewId)).stdout);
  assert.equal(status[0].status, "completed");
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

async function waitForTaskStatus(home: string, status: string) {
  const { listTasks } = await import("../src/daemon/tasks.js");
  const deadline = Date.now() + 20000;
  let rows = await listTasks(home);
  while (Date.now() < deadline) {
    if (rows[0]?.value.status === status) return rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
    rows = await listTasks(home);
  }
  assert.fail(`Expected task ${status}; observed ${rows[0]?.value.status ?? "missing"}`);
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
  const f = await reviewFixture(t);
  await f.setAsync(false);
  const { listTasks } = await import("../src/daemon/tasks.js");
  const { daemonStatus } = await import("../src/daemon/service.js");
  let finished = false;
  const waiting = f.call("continue", "review", "wait").then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(finished, false);
  assert.deepEqual(await listTasks(f.home), []);
  assert.equal((await daemonStatus(f.home)).running, false);
  await f.voteHuman("approve");
  const result = await waiting;
  assert.ok(result.stdout.includes(f.reviewId));
  assert.doesNotMatch(result.stdout, /已登记|Memsphere 自动消息/);
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
  await new Promise(resolve => setTimeout(resolve, 2200));
  const attempts = () => readFile(f.queueLog, "utf8").then(s => s.trim().split("\n"));
  assert.equal((await attempts()).length, 1, "subsequent ticks must not resend after a terminal write conflict");
  await f.call("daemon", "restart");
  const { listTasks } = await import("../src/daemon/tasks.js");
  const [row] = await listTasks(f.home);
  assert.equal(row.value.status, "failed");
  assert.equal(row.value.error?.code, "execution_interrupted");
  assert.equal(row.value.error?.stage, "recovery");
  assert.equal((await attempts()).length, 1, "graceful restart must not queue an uncertain delivery again");
});
