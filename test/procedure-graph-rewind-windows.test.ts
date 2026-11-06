import { processGates } from './fixtures/process-gates.mjs';
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { release as osRelease } from "node:os";
import test from "node:test";
import { captureProcessGroup, captureProcessIdentity, stopRewindWorker, queryWindowsProcesses } from "../src/context_control/review-process.js";
import { inspectWindowsReviewJob } from "../src/context_control/windows-review-job.js";
import {createFixtureProcesses, stopFixtureChild, stopFixtureJob} from "./helpers/fixture-process.js";
import {pinWindowsProcess} from "./helpers/windows-process-handle.js";
import type {ProcessIdentity} from "../src/context_control/review-process.js";

for (const scenario of ["tree", "identity", "orphan", "unrecorded-orphan", "late-descendant", "host-loss"] as const) test(`Windows native rewind process safety: ${scenario}`, {
  skip: process.platform !== "win32", timeout: 120000
}, async t => {
  t.diagnostic(`Windows ${osRelease()}, Node ${process.version}; native PowerShell/CIM, kernel Job Objects; owned ChildProcess/immutable Job fixture cleanup`);
  const gates = await processGates(t.signal);
  const workers: Array<ReturnType<typeof fork>> = [];
  const jobs: string[] = [];
  const observed=await createFixtureProcesses(t.signal);
  const alive=async(pid:number)=>(await observed.alive(pid))[0];
  t.after(async () => {
    gates.publish("release");
    try {
      for (const job of jobs) await stopFixtureJob(job);
      for (const worker of workers) await stopFixtureChild(worker);
    } finally { await gates.close(); }
  });
  t.after(()=>observed.close());
  const start = async () => {
    const worker = fork(new URL("./fixtures/rewind-process-tree.mjs", import.meta.url), [String(gates.endpoint), scenario], {
      detached: true, execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"]
    });
    workers.push(worker);
    const exitedEarly = once(worker, "exit").then(([code]) => { throw new Error(`Native worker exited before readiness (${code})`); });
    const [request] = await Promise.race([once(worker, "message"), exitedEarly]);
    assert.equal(request.identityRequired, true);
    const identity = await captureProcessIdentity(worker.pid!);
    assert.ok(identity);
    const waiting = once(worker, "message");
    worker.send(identity);
    const [ready] = await Promise.race([waiting, exitedEarly]);
    jobs.push(ready.job);
    const members = await captureProcessGroup(worker.pid!);
    const child = members.find(p => p.pid === ready.childPid);
    assert.ok(child, "CIM observes the real child creation identity");
    observed.rememberSnapshot(...members);
    return { worker, child, host:ready.host as ProcessIdentity|undefined, rewind: { pid: worker.pid!, identity, members, job: ready.job, reviewId: "review", attemptId: "attempt" } };
  };
  const [related, unrelated] = await Promise.all([start(), start()]);
  if (scenario === "identity") {
    await assert.rejects(stopRewindWorker({ ...related.rewind, identity: { ...related.rewind.identity, started: "recycled PID" } }), { code: "PROCESS_IDENTITY_CHANGED" });
    assert.deepEqual(await captureProcessIdentity(related.worker.pid!), related.rewind.identity);
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child);
  } else if(scenario === "host-loss"){
    assert.ok(related.host);
    const controller=await pinWindowsProcess(related.host,t.signal);
    t.after(()=>controller.close());
    // armed proves identity on the retained handle before host-loss injection.
    await controller.terminate();
    const deadline=Date.now()+20000;
    for(const member of related.rewind.members)while(await alive(member.pid))assert.ok(Date.now()<deadline,`Original Job member ${member.pid} exits after host loss: ${observed.diagnostic(member.pid)}`);
    assert.deepEqual(await captureProcessIdentity(unrelated.worker.pid!),unrelated.rewind.identity);
    assert.deepEqual(await captureProcessIdentity(unrelated.child.pid),unrelated.child);
  } else if (scenario === "late-descendant") {
    const exited = once(related.worker, "exit"), message = once(related.worker, "message");
    related.worker.send("late-orphan");
    const [late] = await message;
    await exited;
    assert.equal(await alive(related.worker.pid!), false);
    await observed.remember(late.latePid);
    const exitedDeadline = Date.now() + 20000;
    while (await alive(related.child.pid)) assert.ok(Date.now() < exitedDeadline, "recorded parent exits");
    assert.ok(await alive(late.latePid), "late descendant survives all recorded ancestors");
    assert.equal(related.rewind.members.some(p => p.pid === late.latePid), false, "late PID is not in the original snapshot");
    await assert.rejects(stopRewindWorker(related.rewind), {code:"PROCESS_TERMINATION_PENDING"});
    assert.ok(await alive(late.latePid), "pending cleanup never mistakes missing old PIDs for complete exit");
    gates.publish("release");
    const deadline = Date.now() + 20000;
    while (await alive(late.latePid)) assert.ok(Date.now() < deadline, "late descendant exits");
    await stopRewindWorker(related.rewind);
  } else if (scenario === "orphan" || scenario === "unrecorded-orphan") {
    const exited = once(related.worker, "exit");
    related.worker.send("orphan");
    await exited;
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child, "fixture child survives leader exit");
    const evidence = scenario === "unrecorded-orphan" ? { ...related.rewind, job: undefined, members: undefined } : related.rewind;
    await assert.rejects(stopRewindWorker(evidence), { code: scenario === "unrecorded-orphan" ? "PROCESS_IDENTITY_UNAVAILABLE" : "PROCESS_TERMINATION_PENDING" });
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child);
    gates.publish("release");
    // Retry the actual OS probe until descendants have received their release message.
    const deadline = Date.now() + 20000;
    while (await alive(related.child.pid)) {
      assert.ok(Date.now() < deadline, "orphan child exits");
    }
    await stopRewindWorker(related.rewind);
  } else {
    await t.test("terminates the owned worker tree", async () => {
      await stopRewindWorker(related.rewind);
      for (const member of related.rewind.members) assert.equal(await alive(member.pid), false, observed.diagnostic(member.pid));
    });
    await t.test("an empty retired Job tolerates PID reuse without harming the new process", async () => {
      // Simulate reuse of a historical PID with a real unrelated live process.
      // The retired Job is empty; neither the replacement nor its child may die.
      await stopFixtureJob(related.rewind.job);
      await stopRewindWorker({
        ...related.rewind, pid: unrelated.worker.pid!,
        identity: { pid: unrelated.worker.pid!, group: unrelated.worker.pid!, started: "1" }
    });
    assert.deepEqual(await captureProcessIdentity(unrelated.worker.pid!), unrelated.rewind.identity);
    assert.deepEqual(await captureProcessIdentity(unrelated.child.pid), unrelated.child);
    });
  }
});

// Exercise the query adapter separately from tree termination: failed probes must
// never become empty membership/exit evidence.
test("Windows process query requires explicit successful identity evidence", async () => {
  assert.deepEqual(await queryWindowsProcesses(undefined, async () => ({stdout:'{"ok":true,"processes":[]}'})), []);
  // Unrelated protected/system rows may lack creation times. Preserve the row
  // rather than treating it as absent; selected identities must still be proven.
  assert.deepEqual(await queryWindowsProcesses(undefined, async () => ({stdout:'{"ok":true,"processes":[{"ProcessId":0,"ParentProcessId":0,"Started":null}]}'})), [{pid:0,group:0,parent:0,started:null}]);
  for (const stdout of ["", "[]", '{"ok":false,"processes":[]}', '{"ok":true,"processes":[{"ProcessId":1,"ParentProcessId":0,"Started":"invalid"}]}'])
    await assert.rejects(queryWindowsProcesses(undefined, async () => ({stdout})));
  for (const code of [1, 2, "ENOENT", "ETIMEDOUT"])
    await assert.rejects(queryWindowsProcesses(undefined, async () => {throw Object.assign(new Error("probe failed"), {code});}), {code});
});

test("Windows native CIM errors propagate from the identity query", {skip:process.platform !== "win32", timeout:30000}, async () => {
  const {execFile} = await import("node:child_process");
  const {promisify} = await import("node:util");
  const exec = promisify(execFile);
  await assert.rejects(queryWindowsProcesses(undefined, script => exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "function Get-CimInstance { throw 'injected CIM query failure' }; " + script
  ], {timeout:10000})), error => {
    assert.equal((error as {code?:unknown}).code, 2);
    assert.match((error as {stderr:string}).stderr, /injected CIM query failure/);
    return true;
  });
});


test("legacy or malformed Job names cannot provide complete process exit evidence",async()=>{
 for(const name of ["Global\\Memsphere.Reviewer.00000000-0000-4000-8000-000000000000","Local\\Memsphere.Reviewer.00000000-0000-4000-8000-000000000000","untrusted"])
  await assert.rejects(inspectWindowsReviewJob(name),{code:"PROCESS_IDENTITY_UNAVAILABLE"});
});
