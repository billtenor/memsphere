import { processGates } from "../../fixtures/process-gates.mjs";

import { invokeCliModule } from "../../helpers/cli-module.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { execFile, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { watch } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { businessFixture } from "../../helpers/business-data.js";
import { initializedContextFixture } from "../../helpers/initialized-context.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";
import { ExplorationReviews, explorationReviewHandle } from "../../../src/context_control/exploration-review.js";
import { textContent } from "../../../src/context_control/types.js";
import { openContextControl } from "../../../src/project/context-control.js";
import { readProjectConfig } from "../../../src/config.js";
import { openCommandStates, requireCommandState } from "../../../src/home/command-state-store.js";
import { FILESYSTEM_JSON_METADATA_DIRECTORY, recordStateKey } from "../../../src/data/extensions/shared/filesystem.js";
import { withNativeFileLock } from "../../../src/file-lock.js";
import { randomUUID } from "node:crypto";
import type { GraphProcedureMemory } from "../../../src/memory/ast.js";
import { completeReview } from "../../helpers/review-node-materials.js";
import { stripRunnerEnvironment } from "../../../src/runner/agent-types.js";
const exec = promisify(execFile);
const cli = resolve("dist/cli.js");
const notification = (reviewId: string) => `[Memsphere 自动消息]\n请执行命令以继续：\nmemsphere --project 'test-project' run review wait --review '${reviewId}'`;

test("daemon survives CLI exit, restores View intent, and isolates separate Homes", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mem-daemon-"));
  const homes = [join(directory, "deep-".repeat(16)), join(directory, "b")];
  const call = (home: string, ...args: string[]) => exec(process.execPath, [cli, ...args, "--output", "json"], { env: { ...process.env, MEMSPHERE_HOME: home } });
  t.after(async () => { for (const home of homes) await call(home, "daemon", "stop").catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  for (const home of homes) await mkdir(home);
  const results = await Promise.all(homes.map(home => call(home, "daemon", "start")));
  const first = JSON.parse(results[0].stdout), second = JSON.parse(results[1].stdout);
  assert.equal(first.running && second.running, true);
  assert.equal(Object.hasOwn(first, "pid"), false);
  const firstState = JSON.parse(await readFile(join(homes[0], ".runtime", "daemon.json"), "utf8"));
  const secondState = JSON.parse(await readFile(join(homes[1], ".runtime", "daemon.json"), "utf8"));
  assert.notEqual(firstState.pid, secondState.pid);
  if (process.platform !== "win32") {
    assert.ok(Buffer.byteLength(firstState.endpoint) < 100);
    assert.equal((await stat(dirname(firstState.endpoint))).mode & 0o777, 0o700);
    assert.equal((await stat(firstState.endpoint)).mode & 0o777, 0o600);
  }
  const repeated = JSON.parse((await call(homes[0], "daemon", "start")).stdout);
  assert.equal(repeated.running, true);
  assert.equal(JSON.parse(await readFile(join(homes[0], ".runtime", "daemon.json"), "utf8")).instanceId, firstState.instanceId);
  await writeFile(join(homes[0], ".runtime", "daemon-services.json"), JSON.stringify({ version: 1, view: { desiredState: "running", configPath: join(directory, "missing-config") } }));
  const restarted = JSON.parse((await call(homes[0], "daemon", "restart")).stdout);
  assert.notEqual(JSON.parse(await readFile(join(homes[0], ".runtime", "daemon.json"), "utf8")).instanceId, firstState.instanceId);
  if (process.platform !== "win32") await assert.rejects(stat(dirname(firstState.endpoint)), { code: "ENOENT" });
  assert.equal(restarted.view.desiredState, "running");
  assert.equal(restarted.view.running, false);
  assert.equal(restarted.view.errorCode, "VIEW_UNAVAILABLE");
  assert.equal(JSON.parse((await call(homes[1], "daemon", "status")).stdout).running, true);
  assert.equal(JSON.parse(await readFile(join(homes[1], ".runtime", "daemon.json"), "utf8")).instanceId, secondState.instanceId);
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

// Register before reading so a state change during the read cannot be missed.
// Filesystem events only wake observation; assertions always use persisted state.
async function observe<T>(t: TestContext, directory: string, read: () => Promise<T>, ready: (value: T) => boolean, signal = t.signal) {
  let wake = () => {};
  let failure: Error | undefined;
  let watcher:ReturnType<typeof watch>|undefined;
  try{watcher=watch(directory,()=>wake());}
  catch(error){if(!["EMFILE","ENOSPC"].includes((error as NodeJS.ErrnoException).code??""))throw error;}
  watcher?.on("error", error => { failure = error; wake(); });
  const abort = () => wake();
  signal.addEventListener("abort", abort);
  try {
    for (;;) {
      signal.throwIfAborted();
      if (failure) throw failure;
      // When the host has exhausted watchers, bounded state probes retain the same assertion.
      const changed = watcher ? new Promise<void>(resolve => { wake = resolve; }) : delay(25,undefined,{signal});
      const value = await read();
      if (ready(value)) return value;
      signal.throwIfAborted();
      if (failure) throw failure;
      await changed;
    }
  } finally {
    watcher?.close();
    signal.removeEventListener("abort", abort);
  }
}

async function reviewFixture(t: TestContext, queueMode: "success" | "all-fail" = "success", includeAgent = true, processBoundary = false, runnerType: "codex" | "claude" = "codex", mode: "graph" | "exploration" = "graph") {
  // Installation and Embedded worktree discovery are not part of daemon
  // delivery. Reuse installed models in separate Managed filesystem Stores.
  const f = await initializedContextFixture(t);
  const bin = join(f.directory, "bin"); await mkdir(bin);
  const runnerAgents = { [runnerType]: { identity_enabled: true, async_enabled: true } };
  const provider = join(bin, "codex-acp");
  await writeTestCommand(provider, `#!${process.execPath}\nif (process.argv.includes("--version")) console.log("controlled reviewer fixture"); else { console.error("ACP dispatch is outside this test boundary"); process.exitCode = 1; }\n`);
  const queue = join(f.directory, "queue.json");
  const queueLog = join(f.directory, "queue-attempts.ndjson");
  const fake = join(bin, "codex");
  await writeTestCommand(fake, `#!${process.execPath}\nimport('node:fs').then(fs => { const args=process.argv.slice(2); if(args[0]==='--version') console.log('codex test'); else if(args.includes('--help')) console.log('queue --thread --message'); else { fs.writeFileSync(${JSON.stringify(queue)},JSON.stringify(args)); fs.appendFileSync(${JSON.stringify(queueLog)},JSON.stringify(args)+"\\n"); if(${JSON.stringify(queueMode)}==="all-fail") process.exitCode=1; } });\n`);
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  const configPath = join(f.root, "config.json");
  const project = JSON.parse(await readFile(configPath, "utf8"));
  if (mode === "exploration") {
    // Statement resolution reads the Project's Memory through a real Workspace.
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Exploration fixture"], { cwd: f.root, signal: t.signal });
    project.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  }
  await writeFile(configPath, JSON.stringify({ ...project, control_plane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", permissions: ["artifact.read", "decision.decide"] }, ...(includeAgent ? { agent: { kind: "agent", permissions: ["artifact.read", "decision.assess"], agent: { provider: "codex" } } } : {}) } } }));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: runnerAgents }));
  const env: NodeJS.ProcessEnv = { ...process.env, MEMSPHERE_HOME: f.home, PATH: `${bin}${delimiter}${process.env.PATH}` };
  stripRunnerEnvironment(env);
  env[runnerType === "claude" ? "CLAUDE_CODE_SESSION_ID" : "CODEX_THREAD_ID"] = "origin-session";
  // These commands still communicate with the real daemon process. Keep
  // native entry/exit and simultaneous registrations in dedicated scenarios.
  const cliLifetime = new AbortController();
  const cliSignal = AbortSignal.any([t.signal, cliLifetime.signal]);
  const cliClosures = new Set<Promise<void>>();
  const nativeCall = (commandEnv: NodeJS.ProcessEnv, ...args: string[]) => {
    cliSignal.throwIfAborted();
    const result = exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env: commandEnv, signal: cliSignal });
    // An aborted execFile can reject before its child has released the streams.
    const closed = new Promise<void>(resolve => { result.child.once("close", () => resolve()); });
    cliClosures.add(closed);
    void closed.then(() => cliClosures.delete(closed));
    return result;
  };
  f.beforeCleanup(async () => {
    cliLifetime.abort();
    await Promise.all(cliClosures);
  });
  const call = (...args: string[]) => processBoundary
    ? nativeCall(env, ...args)
    : invokeCliModule(["--project", "test-project", ...args], f.root, env, cli, t.signal);
  const { daemonStatus, stopDaemon: stop } = await import("../../../src/daemon/service.js");
  let daemon: ReturnType<typeof spawn> | undefined;
  const startDaemon = async (preload?: string) => {
    assert.equal(daemon, undefined);
    await mkdir(join(f.home, ".runtime"), { recursive: true });
    const lifetime = new AbortController();
    const nodeArgs = preload ? ["--import", preload] : [];
    daemon = spawn(process.execPath, [...nodeArgs, cli, "daemon", "serve"], { cwd: f.root, env, stdio: "ignore" });
    daemon.once("error", error => lifetime.abort(error));
    daemon.once("exit", (code, signal) => lifetime.abort(new Error(`Fixture daemon exited: ${code ?? signal}`)));
    try {
      const signal=AbortSignal.any([t.signal,lifetime.signal,AbortSignal.timeout(10000)]);
      // Probe the actual control socket; no watcher resource or elapsed-time
      // guess is needed to establish readiness.
      while(!(await daemonStatus(f.home)).running){signal.throwIfAborted();await delay(25,undefined,{signal});}
    } catch (error) {
      if (daemon.exitCode === null && daemon.signalCode === null && daemon.pid) {
        const exited = once(daemon, "exit", { signal: AbortSignal.timeout(20000) });
        daemon.kill();
        await exited;
      }
      daemon = undefined;
      throw error;
    }
  };
  const stopDaemon = async () => {
    if (!daemon) return;
    const child = daemon;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit", { signal: AbortSignal.timeout(20000) });
      try {
        await stop(f.home);
        await exited;
      } catch (error) {
        child.kill();
        throw error;
      }
    }
    daemon = undefined;
  };
  const interruptDaemon = async () => {
    assert.ok(daemon?.pid);
    const exited = once(daemon, "exit", { signal: t.signal });
    daemon.kill("SIGKILL");
    await exited;
    daemon = undefined;
  };
  f.beforeCleanup(stopDaemon);
  const waitForTask = async (status: string, id?: string) => {
    const { listTasks } = await import("../../../src/daemon/tasks.js");
    const rows = await observe(t, join(f.home, "data", "daemon-tasks"), () => listTasks(f.home), rows =>
      (id ? rows.find(row => row.id === id) : rows[0])?.value.status === status);
    return (id ? rows.find(row => row.id === id) : rows[0])!;
  };
  const { readArtifactReviewForRunner } = await import("../../../src/context_control/review-repository.js");
  // Run creation, candidate production and session binding are preconditions,
  // not the CLI boundary under test. Construct them through domain APIs/Stores.
  const config = await readProjectConfig("test-project", f.home);
  const service = (await openContextControl(f.root))!;
  const { runId, reviewId, target, otherReviewId } = mode === "exploration"
    ? await explorationReviewTarget(service, config)
    : await graphReviewTarget(service, config, includeAgent);
  const started = { runId };
  const stateId = `${runnerType}-origin-session`;
  await (await openCommandStates(true, f.home))!.create({}, stateId, {
    id: stateId, agentType: runnerType, sessionId: "origin-session", updatedAt: new Date().toISOString(),
    commandGroup: "run", groupId: runId, status: "active", parameters: { project: "test-project", ...target }, state: { reads: {} }
  });
  // Reuse this fixture's opened model service. Each query still reads current
  // records; reopening and revalidating all model bindings is not under test.
  const reviewInput = { runsRoot: join(f.root, "runs"), reviewId, service };
  const reviewState = () => readArtifactReviewForRunner(reviewInput);
  const api = await import("../../../src/context_control/review-repository.js");
  const agentInput = { ...reviewInput, roundId: (await reviewState()).round.id, actorId: "agent" };
  if (includeAgent) {
    // Most cases test wait/queue behavior, not ACP dispatch. Keep a controlled
    // pending assignment instead of repeating an entire Reviewer/tool process.
    // The Reviewer is a logical fixture, not an OS worker owned by this test.
    const claimed = await api.claimArtifactReviewAgentAssignment({ ...agentInput });
    assert.ok(claimed);
    await api.markArtifactReviewAgentCliReady({ ...agentInput, attemptId: claimed.attempt.id });
  }
  const completeAgent = async () => {
    if (!includeAgent) return;
    const assignment = (await reviewState()).round.assignments.find(a => a.actorId === "agent")!;
    if (assignment.status !== "submitted") {
      const bound = { ...agentInput, attemptId: assignment.attempts!.at(-1)!.id };
      await completeReview(bound);
      await api.submitArtifactReviewAgentAssignment({ ...bound, vote: "approve" });
    }
  };
  const voteHuman = async (vote: "approve" | "request_changes", complete = true) => {
    if (complete) await completeAgent();
    const { submitArtifactReviewHumanAssignmentForRunner } = await import("../../../src/context_control/review-repository.js");
    const current = await reviewState();
    return submitArtifactReviewHumanAssignmentForRunner({ ...reviewInput, runId: started.runId,
      roundId: current.round.id, assignmentId: "human", vote,
      comments: vote === "approve" ? [] : [{ body: "Test fixture requests revision", severity: "blocking" }],
      authorizationNote: "Isolated fixture vote" });
  };
  const setAsync = (enabled: boolean) => writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { [runnerType]: { identity_enabled: true, async_enabled: enabled } } }));
  return { ...f, call, nativeCall, env, queue, queueLog, queueCommand:fake, started, reviewId, otherReviewId, reviewState, service, voteHuman, setAsync, completeAgent, startDaemon, stopDaemon, interruptDaemon, waitForTask };
}

type FixtureService = NonNullable<Awaited<ReturnType<typeof openContextControl>>>;
type FixtureConfig = Awaited<ReturnType<typeof readProjectConfig>>;

async function graphReviewTarget(service: FixtureService, config: FixtureConfig, includeAgent: boolean) {
  const procedure: GraphProcedureMemory = {
    tag: "!procedure", syntax: "memsphere-20261027-stable", names: ["async-test"], defines: ["Async test"], mode: "graph",
    actions: [{ tag: "!action", id: "work", description: "Produce", dependencies: [{ tag: "!dependency", from: "START" }],
      artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" }, review: ["approval"] } }]
  };
  return service.withGraph(async graph => {
    const initial = await graph.start({ name: "Async", language: "zh-CN", procedure, controlPlane: config.controlPlane,
      reviewConfiguration: { reviews: { "async-test#actions[work]": { policy: "artifact_acceptance.unanimous" } },
        slots: { "async-test::approval": { actorIds: includeAgent ? ["human", "agent"] : ["human"] } } } });
    const runId = initial.run.id, step = initial.steps[0].id;
    await graph.enter(runId, step);
    await graph.report(runId, step, { text: "candidate" });
    return { runId, reviewId: `graph-review-${runId}__${step}`, target: { step }, otherReviewId: undefined };
  });
}

async function explorationReviewTarget(service: FixtureService, config: FixtureConfig) {
  const statements = join(config.memoryRoot, "statements");
  await mkdir(statements, { recursive: true });
  await writeFile(join(statements, "candidate.yaml"), withCurrentMemorySyntax("!statement\nnames: [candidate]\nasserts: [Review the candidate]\n"));
  const run = await service.start("Async exploration", "zh-CN");
  const repository = new ExplorationReviews(service);
  const prepare = async (name: string, reviewer: string) => {
    const { artifact, step } = await service.report(run.id, { name, content: textContent("Candidate") });
    await service.configureExplorationStep(run.id, step.id, { asserts: ["statements/candidate"], reviewer });
    const review = await repository.start(config, run.id, artifact.id);
    return explorationReviewHandle(run.id, review.id);
  };
  const reviewId = await prepare("Notified candidate", "project:agent");
  const otherReviewId = await prepare("Other candidate", "runner");
  return { runId: run.id, reviewId, target: { review: reviewId }, otherReviewId };
}

function daemonTaskLock(home: string, taskId: string) {
  return join(home, "data", "daemon-tasks", FILESYSTEM_JSON_METADATA_DIRECTORY, `${recordStateKey(`${taskId}.json`)}.lock`);
}

async function claudeNotificationFixture(t: TestContext, beforeRoster = "", mode: "graph" | "exploration" = "graph") {
  const f = await reviewFixture(t, "success", true, true, "claude", mode);
  const path = join(f.directory, `${process.pid}.sock`);
  const roster = [{ sessionId: "origin-session", pid: process.pid, startedAt: 1795350000000, kind: "interactive", status: "idle", cwd: f.root }];
  await writeTestCommand(join(dirname(f.queueCommand), "claude"), `#!${process.execPath}
if (process.argv[2] === "--version") console.log("2.1.330 (Claude Code)");
else if (process.argv.slice(2).join(" ") === "agents --json") {
  (async () => {
    ${beforeRoster}
    console.log(${JSON.stringify(JSON.stringify(roster))});
  })().catch(() => { process.exitCode = 1; });
}
else process.exitCode = 1;
`);
  const messages: string[] = [];
  const received = new EventEmitter();
  const server = createServer(socket => {
    let contents = "";
    socket.setEncoding("utf8");
    socket.on("data", data => { contents += data; });
    socket.on("end", () => {
      messages.push(JSON.parse(contents).message.content);
      received.emit("message");
    });
  });
  f.beforeCleanup(async () => {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  server.listen(path);
  await once(server, "listening", { signal: t.signal });
  f.env.CLAUDE_CODE_MESSAGING_SOCKET = path;
  return { ...f, messages, async waitForMessages(count: number) {
    while (messages.length < count) await once(received, "message", { signal: t.signal });
    return [...messages];
  } };
}

test("Claude notification is completed on socket write and only the bound session can record read-back", {
  skip: process.platform !== "linux", timeout: 90000
}, async t => {
  const f = await claudeNotificationFixture(t);
  await f.startDaemon();
  assert.match((await f.call("continue", "review", "wait")).stdout, /taskId[:：]/);
  await f.completeAgent();
  const { value: sent } = await f.waitForTask("completed");
  assert.ok(sent.claudeDelivery?.sentAt);
  assert.equal(sent.claudeDelivery?.readAt, undefined);
  const callback = `${sent.id}:${sent.claudeDelivery!.id}`;
  assert.deepEqual(await f.waitForMessages(1), [`${notification(f.reviewId)} --callback '${callback}'`]);

  const args = ["run", "review", "wait", "--review", f.reviewId, "--callback", callback];
  const continueArgs = ["continue", "review", "wait", "--callback", callback];
  const { listTasks, readTask, updateTask } = await import("../../../src/daemon/tasks.js");
  const states = (await openCommandStates(false, f.home))!;
  const stateId = "claude-origin-session";
  const original = (await requireCommandState(stateId, f.home)).value;
  await states.create({}, "claude-other-session", { ...original, id: "claude-other-session", sessionId: "other-session" });
  const observableState = async () => ({
    run: (await f.reviewState()).run,
    review: (await f.reviewState()).review,
    sessions: await Promise.all([states.get({}, stateId), states.get({}, "claude-other-session")]),
    tasks: await listTasks(f.home),
    dispatched: await readdir(join(f.root, ".runtime", "review-dispatch")).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return [];
    })
  });
  const rejectsWithoutSideEffects = async (diagnostic: RegExp, ...operations: Array<() => ReturnType<typeof f.call>>) => {
    const before = await observableState();
    for (const operation of operations) await assert.rejects(operation, (error: Error & { stdout?: string }) => {
      assert.match(error.message, diagnostic);
      assert.equal(error.stdout ?? "", "");
      return true;
    });
    assert.deepEqual(await observableState(), before);
  };
  const fromOtherSession = (...commandArgs: string[]) => f.nativeCall({ ...f.env, CLAUDE_CODE_SESSION_ID: "other-session" }, ...commandArgs);
  await rejectsWithoutSideEffects(/PERMISSION_DENIED/,
    () => fromOtherSession(...args), () => fromOtherSession(...continueArgs));
  await assert.rejects(f.nativeCall({ ...f.env, CLAUDE_CODE_SESSION_ID: "different-session" }, ...args), /PERMISSION_DENIED/);
  await assert.rejects(f.call("run", "review", "wait", "--review", "different-review", "--callback", callback),
    /PERMISSION_DENIED/);
  await assert.rejects(f.call("run", "review", "wait", "--review", f.reviewId, "--callback", `${sent.id}:00000000-0000-4000-8000-000000000000`),
    /PERMISSION_DENIED/);
  for (const changed of [
    { ...original, parameters: { ...original.parameters, project: "other-project" } },
    { ...original, groupId: "other-run" },
    { ...original, parameters: { ...original.parameters, step: "other-step" } }
  ]) {
    const previous = await requireCommandState(stateId, f.home);
    await states.update({}, stateId, changed, { expectedRevision: previous.revision });
    await rejectsWithoutSideEffects(/SESSION_CONTEXT_CONFLICT|INVALID_ARGUMENT|NOT_FOUND/,
      () => f.call(...args), () => f.call(...continueArgs));
  }
  const changed = await requireCommandState(stateId, f.home);
  await states.delete({}, stateId, { expectedRevision: changed.revision });
  await rejectsWithoutSideEffects(/NOT_FOUND/, () => f.call(...args), () => f.call(...continueArgs));
  await states.create({}, stateId, original);

  const delivered = (await readTask(sent.id, f.home))!;
  await updateTask(delivered, { input: { ...sent.input, roundId: "old-round" } }, f.home);
  await rejectsWithoutSideEffects(/REVIEW_CONFLICT/, () => f.call(...args), () => f.call(...continueArgs));
  await updateTask((await readTask(sent.id, f.home))!, { input: sent.input }, f.home);
  await f.setAsync(false);
  await rejectsWithoutSideEffects(/PERMISSION_DENIED/, () => f.call(...args), () => f.call(...continueArgs));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { claude: { identity_enabled: false } } }));
  await rejectsWithoutSideEffects(/AGENT_SESSION_REQUIRED/, () => f.call(...args), () => f.call(...continueArgs));
  await f.setAsync(true);

  assert.equal((await f.waitForTask("completed")).value.claudeDelivery?.readAt, undefined);
  if (process.getuid!() !== 0) {
    // Fail only the read-back write on the existing row. The Review Store and
    // atomic record data remain readable and the lock inode stays in place.
    const lock = daemonTaskLock(f.home, sent.id);
    await chmod(lock, 0o400);
    try {
      const before = await observableState();
      const read = await f.call(...args);
      assert.match(read.stdout, /roundId[:：]/);
      assert.match(read.stderr, /NOTIFICATION_READ_RECEIPT_FAILED/);
      assert.deepEqual(await observableState(), before);
    } finally {
      await chmod(lock, 0o600);
    }
  }
  assert.match((await f.call(...continueArgs)).stdout, /roundId[:：]/);
  const firstRead = (await f.waitForTask("completed")).value.claudeDelivery?.readAt;
  assert.ok(firstRead);
  assert.match((await f.call(...args)).stdout, /roundId[:：]/);
  assert.equal((await f.waitForTask("completed")).value.claudeDelivery?.readAt, firstRead);
});

test("Claude exploration notifications return only the Review bound to the original session", {
  skip: process.platform !== "linux", timeout: 90000
}, async t => {
  const f = await claudeNotificationFixture(t, "", "exploration");
  const { listTasks, readTask, updateTask } = await import("../../../src/daemon/tasks.js");
  const stateId = "claude-origin-session";
  const states = (await openCommandStates(false, f.home))!;
  const original = (await requireCommandState(stateId, f.home)).value;
  const { runId } = f.started;
  const native = ["run", "review", "wait", "--review", f.reviewId];
  const continuation = ["continue", "review", "wait"];
  const callback = (ref: string, args: string[]) => f.call(...args, "--callback", ref);
  const context = async () => ({
    run: await f.service.snapshot(runId),
    state: await states.get({}, stateId),
    dispatch: await readdir(join(f.root, ".runtime", "review-dispatch")).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return [];
    })
  });
  const failsWithoutChanges = async (diagnostic: RegExp, ...calls: Array<() => ReturnType<typeof f.call>>) => {
    const before = { context: await context(), tasks: await listTasks(f.home) };
    for (const call of calls) {
      await assert.rejects(call, (error: Error & { stdout?: string }) => {
        assert.match(error.message, diagnostic);
        assert.equal(error.stdout ?? "", "");
        return true;
      });
    }
    assert.deepEqual({ context: await context(), tasks: await listTasks(f.home) }, before);
  };
  const bind = async (review?: string) => {
    const previous = await requireCommandState(stateId, f.home);
    const parameters = { project: "test-project", ...(review ? { review } : {}) };
    await states.update({}, stateId, { ...original, parameters }, { expectedRevision: previous.revision });
  };

  await f.startDaemon();
  assert.match((await f.call(...native)).stdout, /taskId[:：]/);
  const registered = await f.waitForTask("running");
  assert.match((await f.call(...continuation)).stdout, new RegExp(registered.id));
  assert.deepEqual(registered.value.input, {
    project: "test-project", runId, reviewId: f.reviewId, roundId: (await f.reviewState()).round.id,
    configPath: join(f.root, "config.json"), cwd: f.root
  });
  assert.equal(registered.value.claudeDelivery, undefined);
  // Reserve a delivery identity while the controlled Reviewer is still pending.
  // The daemon cannot issue a notification until the result becomes ready.
  const earlyId = randomUUID();
  await updateTask(registered, { claudeDelivery: { id: earlyId } }, f.home);
  const early = `${registered.id}:${earlyId}`;
  await failsWithoutChanges(/REVIEW_NOT_READY/, () => callback(early, native), () => callback(early, continuation));
  await updateTask((await readTask(registered.id, f.home))!, { claudeDelivery: undefined }, f.home);

  await f.completeAgent();
  const sent = await f.waitForTask("completed", registered.id);
  assert.ok(sent.value.claudeDelivery?.sentAt);
  assert.equal(sent.value.claudeDelivery.readAt, undefined);
  const ref = `${sent.id}:${sent.value.claudeDelivery.id}`;
  const expected = `${notification(f.reviewId)} --callback '${ref}'`;
  assert.deepEqual(await f.waitForMessages(1), [expected]);
  await failsWithoutChanges(/INVALID_ARGUMENT/,
    () => callback("bogus", native), () => callback("bogus", continuation));
  await failsWithoutChanges(/PERMISSION_DENIED/,
    () => callback(early, native), () => callback(early, continuation),
    () => f.nativeCall({ ...f.env, CLAUDE_CODE_SESSION_ID: "different-session" }, ...native, "--callback", ref));
  await updateTask(sent, { input: { ...sent.value.input, roundId: "obsolete-round" } }, f.home);
  await failsWithoutChanges(/REVIEW_NOT_READY/, () => callback(ref, native), () => callback(ref, continuation));
  await updateTask((await readTask(sent.id, f.home))!, { input: sent.value.input }, f.home);

  assert.ok(f.otherReviewId);
  await bind(f.otherReviewId);
  await failsWithoutChanges(/SESSION_CONTEXT_CONFLICT|PERMISSION_DENIED/, () => callback(ref, native), () => callback(ref, continuation));
  await bind();
  await failsWithoutChanges(/SESSION_CONTEXT_CONFLICT|INVALID_ARGUMENT/, () => callback(ref, native), () => callback(ref, continuation));
  await bind(f.reviewId);

  const beforeRead = await context();
  const stdout = (await callback(ref, native)).stdout;
  assert.ok(stdout.includes(f.reviewId));
  assert.ok(stdout.includes(sent.value.input.roundId));
  assert.match(stdout, /scope[:：] ?opinion/);
  const read = (await readTask(sent.id, f.home))!;
  assert.ok(read.value.claudeDelivery?.readAt);
  assert.deepEqual(read.value, {
    ...sent.value, updatedAt: read.value.updatedAt,
    claudeDelivery: { ...sent.value.claudeDelivery, readAt: read.value.claudeDelivery.readAt }
  });
  const nativeReceipt = JSON.parse((await callback(ref, [...native, "--output", "json"])).stdout);
  const continuedReceipt = JSON.parse((await callback(ref, [...continuation, "--output", "json"])).stdout);
  assert.deepEqual(continuedReceipt, nativeReceipt);
  assert.equal(nativeReceipt.roundId, sent.value.input.roundId);
  assert.doesNotMatch(JSON.stringify(nativeReceipt), /--callback|claudeDelivery|inbox/);
  assert.deepEqual(await context(), beforeRead);
  assert.deepEqual(await listTasks(f.home), [read]);
  assert.deepEqual(f.messages, [expected]);
});

test("Claude notification restart distinguishes interrupted attempts and never resends without retry", {
  skip: process.platform !== "linux", timeout: 90000
}, async t => {
  const gates = await processGates(t.signal);
  t.after(() => gates.close());
  const gateModule = new URL("../../fixtures/process-gates.mjs", import.meta.url).href;
  const f = await claudeNotificationFixture(t, `
    const { existsSync } = require("node:fs");
    const { processGate } = await import(${JSON.stringify(gateModule)});
    if (existsSync(require("node:path").join(process.cwd(), "hold-claude-roster"))) {
      await processGate(${JSON.stringify(gates.endpoint)}, "publish", "roster-held");
      await processGate(${JSON.stringify(gates.endpoint)}, "wait", "release-roster");
    }
  `);
  f.beforeCleanup(() => { gates.publish("release-roster"); });
  await f.startDaemon();
  await f.call("continue", "review", "wait");
  const registered = (await f.waitForTask("running")).value;
  assert.equal(registered.claudeDelivery, undefined);
  const { readTask, updateTask } = await import("../../../src/daemon/tasks.js");
  const earlyId = randomUUID();
  await updateTask((await readTask(registered.id, f.home))!, { claudeDelivery: { id: earlyId } }, f.home);
  const early = (await readTask(registered.id, f.home))!;
  await assert.rejects(f.call("run", "review", "wait", "--review", f.reviewId, "--callback", `${registered.id}:${earlyId}`), /REVIEW_NOT_READY/);
  await assert.rejects(f.call("continue", "review", "wait", "--callback", `${registered.id}:${earlyId}`), /REVIEW_NOT_READY/);
  assert.deepEqual(await readTask(registered.id, f.home), early);
  await updateTask(early, { claudeDelivery: undefined }, f.home);
  await f.interruptDaemon();
  await f.startDaemon();
  const beforeSend = (await f.waitForTask("failed", registered.id)).value;
  assert.equal(beforeSend.claudeDelivery, undefined);
  assert.equal(beforeSend.error?.code, "execution_interrupted");
  assert.match(beforeSend.error!.message, /before attempting to write/);
  assert.equal(f.messages.length, 0);

  const retry = () => f.call("run", "review", "wait", "retry", "--review", f.reviewId, "--round", registered.input.roundId);
  await retry();
  const holdRoster = join(f.root, "hold-claude-roster");
  await writeFile(holdRoster, "");
  await f.completeAgent();
  await gates.wait("roster-held");
  const inFlight = (await readTask(registered.id, f.home))!.value;
  const interruptedDelivery = inFlight.claudeDelivery!.id;
  assert.equal(inFlight.claudeDelivery?.sentAt, undefined);

  let lockReady!: () => void, releaseLock!: () => void;
  const locked = new Promise<void>(resolve => { lockReady = resolve; });
  const unlocked = new Promise<void>(resolve => { releaseLock = resolve; });
  const taskWriteLock = withNativeFileLock(daemonTaskLock(f.home, registered.id), async () => {
    lockReady();
    await unlocked;
  }, { signal: t.signal });
  try {
    await Promise.race([locked, taskWriteLock]);
    gates.publish("release-roster");
    assert.deepEqual(await f.waitForMessages(1), [
      `${notification(f.reviewId)} --callback '${registered.id}:${interruptedDelivery}'`
    ]);
    assert.equal((await readTask(registered.id, f.home))!.value.claudeDelivery?.sentAt, undefined);
    await f.interruptDaemon();
  } finally {
    releaseLock();
    await taskWriteLock;
    await rm(holdRoster, { force: true });
  }
  await f.startDaemon();
  const afterWrite = (await f.waitForTask("failed", registered.id)).value;
  assert.deepEqual(afterWrite.claudeDelivery, { id: interruptedDelivery });
  assert.match(afterWrite.error!.message, /may have been sent/);
  assert.equal(f.messages.length, 1);

  await retry();
  const succeeded = (await f.waitForTask("completed", registered.id)).value;
  const nextDelivery = succeeded.claudeDelivery!.id;
  assert.notEqual(nextDelivery, interruptedDelivery);
  const wait = (deliveryId: string) => f.call("continue", "review", "wait", "--callback", `${registered.id}:${deliveryId}`);
  await assert.rejects(wait(interruptedDelivery), /PERMISSION_DENIED/);
  assert.deepEqual((await readTask(registered.id, f.home))!.value, succeeded);
  assert.match((await wait(nextDelivery)).stdout, /roundId[:：]/);
  await f.waitForMessages(2);
  await f.stopDaemon();
  await f.startDaemon();
  assert.ok((await readTask(registered.id, f.home))!.value.claudeDelivery?.readAt);
  assert.equal(f.messages.length, 2);
});

test("Claude callback can read a ready Review before the daemon commits the send receipt", {
  skip: process.platform !== "linux", timeout: 90000
}, async t => {
  const gates = await processGates(t.signal);
  t.after(() => gates.close());
  const f = await claudeNotificationFixture(t, `
    const { copyFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const target = join(process.cwd(), "send-receipt-lock");
    if (existsSync(target)) copyFileSync(target, join(process.cwd(), "hold-send-receipt"));
  `);
  const gateModule = new URL("../../fixtures/process-gates.mjs", import.meta.url).href;
  const trigger = join(f.root, "hold-send-receipt");
  const preload = join(f.directory, "receive-before-send.mjs");
  // Isolate the write barrier to the daemon's process. Review wait runs in
  // another CLI process and can use the actual row lock while the daemon waits.
  await writeFile(preload, `
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { processGate } from ${JSON.stringify(gateModule)};
const trigger = ${JSON.stringify(trigger)};
const open = fs.open;
let held = false;
fs.open = async (path, ...args) => {
  if (!held && existsSync(trigger) && String(path) === readFileSync(trigger, "utf8")) {
    held = true;
    await processGate(${JSON.stringify(gates.endpoint)}, "publish", "committing-send");
    await processGate(${JSON.stringify(gates.endpoint)}, "wait", "finish-send");
  }
  return open(path, ...args);
};
syncBuiltinESMExports();
`);
  f.beforeCleanup(() => { gates.publish("finish-send"); });
  await f.startDaemon(preload);
  await f.call("continue", "review", "wait");
  const registered = (await f.waitForTask("running")).value;
  assert.equal(registered.claudeDelivery, undefined);
  // The initial delivery identity and the send receipt use the same row lock.
  // The roster fixture arms the barrier after the daemon records the identity.
  await writeFile(join(f.root, "send-receipt-lock"), daemonTaskLock(f.home, registered.id));
  const { readTask, listTasks } = await import("../../../src/daemon/tasks.js");
  await f.completeAgent();
  await gates.wait("committing-send");
  const before = (await readTask(registered.id, f.home))!;
  assert.equal(before.value.status, "running");
  assert.equal(before.value.claudeDelivery?.sentAt, undefined);
  const callback = `${registered.id}:${before.value.claudeDelivery!.id}`;
  const expected = `${notification(f.reviewId)} --callback '${callback}'`;
  assert.deepEqual(await f.waitForMessages(1), [expected]);
  const contextBefore = await f.reviewState();
  const stateBefore = await requireCommandState("claude-origin-session", f.home);
  const dispatch = () => readdir(join(f.root, ".runtime", "review-dispatch")).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  const dispatchBefore = await dispatch();
  try {
    const result = await f.call("run", "review", "wait", "--review", f.reviewId, "--callback", callback);
    assert.ok(result.stdout.includes(f.reviewId));
    assert.match(result.stdout, /roundStatus[:：]/);
    const early = (await readTask(registered.id, f.home))!;
    assert.equal(early.value.status, "running");
    assert.equal(early.value.claudeDelivery?.sentAt, undefined);
    assert.ok(early.value.claudeDelivery?.readAt);
    assert.match((await f.call("continue", "review", "wait", "--callback", callback)).stdout, /roundId[:：]/);
    assert.deepEqual(await readTask(registered.id, f.home), early);
    assert.deepEqual(await f.reviewState(), contextBefore);
    assert.deepEqual(await requireCommandState("claude-origin-session", f.home), stateBefore);
    assert.deepEqual(await dispatch(), dispatchBefore);
    gates.publish("finish-send");
    const completed = await f.waitForTask("completed", registered.id);
    assert.ok(completed.value.claudeDelivery?.sentAt);
    assert.equal(completed.value.claudeDelivery?.readAt, early.value.claudeDelivery?.readAt);
    assert.deepEqual(await listTasks(f.home), [completed]);
    assert.deepEqual(f.messages, [expected]);
  } finally {
    gates.publish("finish-send");
  }
});

test("asynchronous review wait notifies its original session without waiting for Human", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "success", true, true);
  const { call, queue } = f;
  await f.startDaemon();
  const wait = await call("continue", "review", "wait");
  assert.match(wait.stdout, /taskId[:：]/);
  await f.completeAgent();
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
  await f.waitForTask("completed");
  const sent: string[] = JSON.parse(await readFile(queue, "utf8"));
  assert.equal(sent[0], "queue"); assert.equal(sent[2], "origin-session");
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
  assert.equal(sent[4], notification(f.reviewId));
  assert.doesNotMatch(sent[4], /approve|投票|状态|Reviewer/);
  const ready = await call("continue", "review", "wait");
  assert.ok(ready.stdout.includes(f.reviewId));
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.equal((await f.reviewState()).round.assignments.find(a => a.actorId === "human")!.status, "draft");
});

test("explicit retry delivers the same continuation to the original session", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  const { call, queue } = f;
  await f.startDaemon();
  await call("continue", "review", "wait");
  await f.completeAgent();
  const task = await f.waitForTask("completed");
  const { updateTask } = await import("../../../src/daemon/tasks.js");
  await updateTask(task, { status: "failed", error: { stage: "send", code: "fixture", message: "Explicit retry fixture" } }, f.home);
  await rm(queue);
  const retry = await call("run", "review", "wait", "retry", "--review", task.value.input.reviewId, "--round", task.value.input.roundId);
  assert.match(retry.stdout, /mayRepeatNotification[:：] ?true/);
  await f.waitForTask("completed");
  const retriedMessage = JSON.parse(await readFile(queue, "utf8"));
  assert.equal(retriedMessage[2], "origin-session");
  assert.equal(retriedMessage[4], notification(f.reviewId));
});

test("Continue refuses missing, ambiguous, disabled and invalid session identities without creating state", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const { snapshotTree } = await import("../../helpers/business-data.js");
  for (const [enabled, code, trae] of [[true, "", ""], [true, "one", "two"], [false, "one", ""], [true, "../bad", ""]] as const) {
    await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: enabled } } }));
    const before = await snapshotTree(f.home);
    await assert.rejects(exec(process.execPath, [cli, "continue", "report", "--artifact", "must not be written"], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: code, TRAECLI_THREAD_ID: trae } }));
    assert.deepEqual(await snapshotTree(f.home), before);
  }
});

test("task registration deduplicates active waits while preserving terminal history", async t => {
  const f = await businessFixture(t, {});
  const { registerTask, listTasks, updateTask } = await import("../../../src/daemon/tasks.js");
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
  const start = await call("view", "start", "--output", "json");
  const { url: origin } = JSON.parse(start.stdout).view;
  assert.equal((await fetch(origin)).status, 200);
  const first = JSON.parse((await call("daemon", "status", "--output", "json")).stdout);
  assert.equal(first.view.desiredState, "running"); assert.equal(first.view.running, true);
  const restarted = JSON.parse((await call("daemon", "restart", "--output", "json")).stdout);
  assert.equal(restarted.view.desiredState, "running"); assert.equal(restarted.view.running, true);
  assert.equal(Object.hasOwn(restarted, "instanceId"), false);
  await call("view", "stop");
  const stopped = JSON.parse((await call("daemon", "status", "--output", "json")).stdout);
  assert.equal(stopped.running, true); assert.equal(stopped.view.running, false);
  const again = JSON.parse((await call("daemon", "restart", "--output", "json")).stdout);
  assert.equal(again.view.desiredState, "stopped"); assert.equal(again.view.running, false);
});

test("daemon recovery reports interrupted execution and cancels disabled queued tasks before accessing their Project", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const { registerTask, listTasks, updateTask } = await import("../../../src/daemon/tasks.js");
  const input = { input: { project: "unavailable", runId: "r", reviewId: "v", roundId: "one", configPath: join(f.directory, "missing-config"), cwd: f.root }, recipient: { agentType: "codex" as const, sessionId: "disabled", agentCommand: "/must-not-be-run" } };
  await registerTask(input, f.home);
  await registerTask({ ...input, recipient: { ...input.recipient, sessionId: "interrupted" } }, f.home);
  const interrupted = (await listTasks(f.home)).find(row => row.value.recipient.sessionId === "interrupted")!;
  await updateTask(interrupted, { status: "running", daemonInstanceId: "old-instance" }, f.home);
  const call = (...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, MEMSPHERE_HOME: f.home } });
  f.beforeCleanup(async () => { await call("daemon", "stop"); });
  await call("daemon", "start");
  const rows = await observe(t, join(f.home, "data", "daemon-tasks"), () => listTasks(f.home), rows =>
    rows.every(row => row.value.status !== "queued" && row.value.status !== "running"));
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
  await assert.rejects(call("run", "start", "--file", procedure, "--name", "Denied", "--review-config", bindings, "--output", "json"), (error: unknown) => {
    const { stdout, stderr } = error as { stdout: string; stderr: string };
    assert.equal(stdout, "");
    assert.deepEqual(JSON.parse(stderr), { error: { code: "PERMISSION_DENIED" } });
    return true;
  });
  const { listTasks } = await import("../../../src/daemon/tasks.js");
  const { daemonStatus } = await import("../../../src/daemon/service.js");
  assert.deepEqual(await listTasks(f.home), []);
  assert.equal((await daemonStatus(f.home)).running, false);
});

test("daemon notification for a requested revision contains only the continuation command", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  await f.startDaemon();
  await f.call("continue", "review", "wait");
  await f.stopDaemon();
  await f.voteHuman("request_changes");
  assert.equal((await f.reviewState()).review.status, "awaiting_revision");
  await f.startDaemon();
  await f.waitForTask("completed");
  const sent = JSON.parse(await readFile(f.queue, "utf8"));
  const sync = await f.call("run", "review", "wait", "--review", f.reviewId);
  assert.equal(sent[2], "origin-session");
  assert.equal(sent[4], notification(f.reviewId));
  assert.ok(sync.stdout.includes(f.reviewId));
});

test("failed wakeup remains queryable without sending a second notification", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "all-fail");
  await f.startDaemon();
  await f.call("continue", "review", "wait");
  await f.voteHuman("approve");
  const task = await f.waitForTask("failed");
  assert.equal(task.value.error?.stage, "send");
  const attempts: string[][] = (await readFile(f.queueLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0][2], "origin-session");
  assert.equal(attempts[0][4], notification(f.reviewId));
  const ready = await f.call("run", "review", "wait", "--review", f.reviewId);
  assert.ok(ready.stdout.includes(f.reviewId));
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.equal((await readFile(f.queueLog, "utf8")).trim().split("\n").length, 1);
  assert.equal((await f.waitForTask("failed")).value.error?.stage, "send");
});

test("unusable identity rejects Continue while native synchronous review remains available", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t);
  await f.voteHuman("approve");
  const { requireCommandState } = await import("../../../src/home/command-state-store.js");
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
  const { listTasks } = await import("../../../src/daemon/tasks.js");
  assert.deepEqual(await listTasks(f.home), []);
});

for (const state of ["passed", "awaiting_revision"] as const) {
  test(`already-returnable ${state} result bypasses daemon and task registration`, { timeout: 90000 }, async t => {
    const f = await reviewFixture(t);
    await f.voteHuman(state === "passed" ? "approve" : "request_changes");
    if ((await f.reviewState()).review.status === "awaiting_runner_vote") {
      const { submitArtifactReviewRunnerVote } = await import("../../../src/context_control/review-repository.js");
      await submitArtifactReviewRunnerVote({ runsRoot: join(f.root, "runs"), reviewId: f.reviewId,
        roundId: (await f.reviewState()).round.id, vote: state === "passed" ? "approve" : "request_changes", comment: "Fixture decision" });
    }
    assert.equal((await f.reviewState()).review.status, state);
    const sync = await f.call("run", "review", "wait", "--review", f.reviewId);
    const ready = await f.call("run", "review", "wait", "--review", f.reviewId);
    assert.equal(ready.stdout, sync.stdout);
    assert.ok(!ready.stdout.startsWith("[Memsphere 自动消息]"));
    const { listTasks } = await import("../../../src/daemon/tasks.js");
    const { daemonStatus } = await import("../../../src/daemon/service.js");
    assert.deepEqual(await listTasks(f.home), []);
    assert.equal((await daemonStatus(f.home)).running, false);
    await assert.rejects(readFile(f.queue), { code: "ENOENT" });
  });
}

test("native report refuses another session binding until the caller explicitly enters its target", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "success", true, true);
  const { openContextControl } = await import("../../../src/project/context-control.js");
  const service = (await openContextControl(f.root))!;
  // The fixture session is already bound to a different (graph) Run.
  const a = await service.start("Report target");
  const before = await service.snapshot(a.id);
  await assert.rejects(f.call("run", "report", "--run", a.id, "--name", "Candidate", "--artifact", "must not be written", "--output", "json"), /SESSION_CONTEXT_CONFLICT/);
  assert.deepEqual(await service.snapshot(a.id), before);
  await f.call("run", "enter", "--run", a.id);
  await f.call("run", "report", "--run", a.id, "--name", "Candidate", "--artifact", "accepted after explicit enter");
  assert.equal((await service.snapshot(a.id)).artifacts.length, 1);
});

test("daemon control refuses unauthorized stop requests without changing its instance", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const { stopDaemon, daemonStatus } = await import("../../../src/daemon/service.js");
  f.beforeCleanup(async () => { await stopDaemon(f.home); });
  // Launch through the real entrypoint: ensureDaemon captures its caller's CLI.
  const started = JSON.parse((await exec(process.execPath, [cli, "daemon", "start", "--output", "json"],
    { env: { ...process.env, MEMSPHERE_HOME: f.home } })).stdout);
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
    const after = await daemonStatus(f.home);
    assert.equal(after.running, true); assert.equal(after.instanceId, state.instanceId);
    assert.equal(Object.hasOwn(started, "instanceId"), false);
  }
});


for (const async of [false, true]) test(`Human-only wait returns immediately with async=${async} and never registers a task`, { timeout: 30000 }, async t => {
  const f = await reviewFixture(t, "success", false);
  await f.setAsync(async);
  const result = await f.call("continue", "review", "wait");
  assert.doesNotMatch(result.stdout, /已登记/);
  assert.match(result.stdout, /run review vote/);
  assert.equal((await f.reviewState()).round.assignments[0].status, "draft");
  const { listTasks } = await import("../../../src/daemon/tasks.js");
  assert.deepEqual(await listTasks(f.home), []);
});

test("a completed historical wait does not block a fresh pending wait in the same round", { timeout: 90000 }, async t => {
  const f = await reviewFixture(t, "success", true, true);
  const { listTasks, updateTask } = await import("../../../src/daemon/tasks.js");
  await f.startDaemon();
  const first = await f.call("continue", "review", "wait");
  const repeated = await f.call("continue", "review", "wait");
  assert.equal(/task-[a-zA-Z0-9-]+/.exec(first.stdout)![0], /task-[a-zA-Z0-9-]+/.exec(repeated.stdout)![0]);
  await f.stopDaemon();
  const previous = (await listTasks(f.home))[0];
  await updateTask(previous, { status: "completed", daemonInstanceId: undefined }, f.home);
  await f.startDaemon();
  const outputs = await Promise.all([f.call("continue", "review", "wait"), f.call("continue", "review", "wait")]);
  const ids = outputs.map(r => /task-[a-zA-Z0-9-]+/.exec(r.stdout)![0]);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], previous.id);
  const rows = await listTasks(f.home);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(r => ["queued", "running"].includes(r.value.status)).length, 1);
  await f.voteHuman("approve");
  await f.waitForTask("completed", ids[0]);
  assert.equal((await readFile(f.queueLog, "utf8")).trim().split("\n").length, 1);
  const ready = await f.call("continue", "review", "wait");
  assert.doesNotMatch(ready.stdout, /已登记/);
  assert.ok(ready.stdout.includes(f.reviewId));
  assert.equal((await listTasks(f.home)).length, 2);
  const status = JSON.parse((await f.call("run", "review", "wait", "status", "--review", f.reviewId, "--output", "json")).stdout);
  assert.equal(status.total, 2);
  assert.equal(status.items.length, 2);
  assert.ok(status.items.every((task: { status: string }) => task.status === "completed"));
});


test("explicit task retry and fresh registration share the active-task deduplication lock", async t => {
  const f = await businessFixture(t, {});
  const { registerTask, retryFailedTask, listTasks, updateTask } = await import("../../../src/daemon/tasks.js");
  const input = { input: { project: "p", runId: "r", reviewId: "v", roundId: "one", configPath: "/config", cwd: "/work" }, recipient: { agentType: "codex" as const, sessionId: "one", agentCommand: "/codex" } };
  const first = await registerTask(input, f.home);
  await updateTask((await listTasks(f.home))[0], { status: "failed", error: { stage: "send", code: "fixture", message: "Failed" } }, f.home);
  const [retry, registration] = await Promise.all([retryFailedTask(first.id, f.home), registerTask(input, f.home)]);
  assert.equal(retry.id, registration.id);
  assert.equal((await listTasks(f.home)).filter(r => ["queued", "running"].includes(r.value.status)).length, 1);
});


test("synchronous CLI wait observes pending Agent work and returns its completed result without queue registration",{timeout:30000},async t=>{
 const f=await reviewFixture(t),gates=await processGates(t.signal);t.after(()=>gates.close());
 await f.setAsync(false);
 const child=spawn(process.execPath,["--import",new URL("../../fixtures/review-wait-barrier.mjs",import.meta.url).href,cli,"--project","test-project","continue","review","wait"],{cwd:f.root,env:{...f.env,REVIEW_WAIT_GATES:String(gates.endpoint)},stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.on("data",data=>stdout+=data);child.stderr.on("data",data=>stderr+=data);
 const exited=once(child,"exit",{signal:t.signal});
 f.beforeCleanup(async()=>{gates.publish("release-poll");if(child.exitCode===null&&child.signalCode===null){const done=once(child,"exit",{signal:AbortSignal.timeout(10000)});child.kill();await done;}});
 await Promise.race([gates.wait("pending-poll"),exited.then(()=>{throw Error(`wait exited before observing pending work: ${stderr}`);})]);
 assert.equal((await f.reviewState()).round.assignments.find(a=>a.actorId==="agent")!.status,"running");
 await f.completeAgent();gates.publish("release-poll");
 const [code]=await exited;assert.equal(code,0,stderr);assert.ok(stdout.includes(f.reviewId));assert.doesNotMatch(stdout,/已登记异步等待/);
 const {listTasks}=await import("../../../src/daemon/tasks.js");assert.deepEqual(await listTasks(f.home),[]);
});

test("daemon suspends a delivered notification after terminal CAS conflict until explicit recovery",{timeout:30000},async t=>{
 const f=await reviewFixture(t),gates=await processGates(t.signal);t.after(()=>gates.close());
 const gateModule=new URL("../../fixtures/process-gates.mjs",import.meta.url).href;
 await writeTestCommand(f.queueCommand,`#!${process.execPath}\nimport {writeFile,appendFile} from 'node:fs/promises';import {processGate} from ${JSON.stringify(gateModule)};const args=process.argv.slice(2);if(args[0]==='--version')console.log('codex test');else if(args.includes('--help'))console.log('queue --thread --message');else{await writeFile(${JSON.stringify(f.queue)},JSON.stringify(args));await appendFile(${JSON.stringify(f.queueLog)},JSON.stringify(args)+'\\n');await processGate(${gates.endpoint},'publish','send-observed');await processGate(${gates.endpoint},'wait','release-send');}`);
 f.beforeCleanup(()=>{gates.publish("release-send");});
 await f.startDaemon();await f.call("continue","review","wait");await f.completeAgent();await gates.wait("send-observed");
 const {listTasks,updateTask}=await import("../../../src/daemon/tasks.js");const row=(await listTasks(f.home))[0];
 await updateTask(row,{status:"running"},f.home); // Real concurrent writer advances revision while send is held.
 gates.publish("release-send");
 const {daemonStatus}=await import("../../../src/daemon/service.js");
 // Status is an actual control request. Await the observable failure; no elapsed-time inference.
 let status:any;const deadline=Date.now()+10000;
 do{status=await daemonStatus(f.home);assert.ok(Date.now()<deadline,"daemon exposes terminal write conflict");}while(!status.taskErrors.some((e:any)=>e.id===row.id));
 assert.match(status.taskErrors.find((e:any)=>e.id===row.id).error,/TASK_STATE_WRITE_FAILED/);
 assert.equal((await listTasks(f.home))[0].value.status,"running");
 assert.equal((await readFile(f.queueLog,"utf8")).trim().split("\n").length,1);
 await f.stopDaemon();await f.startDaemon();const recovered=(await listTasks(f.home))[0];
 assert.equal(recovered.value.status,"failed");assert.equal(recovered.value.error?.code,"execution_interrupted");
 assert.equal((await readFile(f.queueLog,"utf8")).trim().split("\n").length,1,"restart exposes uncertain outcome without automatic redelivery");
});
