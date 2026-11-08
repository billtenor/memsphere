import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { type ProcessIdentity } from "../src/context_control/review-process.js";
import { fixtureProcesses, stopFixtureChild, verifyFixtureTreeExit, windowsFixtureIdentities } from "./helpers/fixture-process.js";


const original = { pid: 123, group: 123, started: "original creation" };


test("a recycled live PID cannot make an exited Reviewer identity look alive", async () => {
  let current: ProcessIdentity | undefined = original;
  const watched = fixtureProcesses(async () => new Map(current ? [[current.pid, current]] : []));
  await watched.remember(original.pid);
  assert.deepEqual(await watched.alive(original.pid), [true], "a real original survivor must still fail an exit assertion");
  current = { ...original, started: "unrelated replacement creation" };
  assert.ok(current, "the old numeric-PID presence oracle would report alive");
  assert.deepEqual(await watched.alive(original.pid), [false], "the original execution has ended");
  assert.equal(watched.original(original.pid)?.started, original.started);
  await assert.rejects(watched.remember(original.pid), /Cannot replace original identity/);
  current = undefined;
  assert.deepEqual(await watched.alive(original.pid), [false]);
});


test("missing readiness and failed identity probes cannot become exit evidence", async () => {
  const failure = new Error("controlled query failure");
  let rows = new Map<number, ProcessIdentity>();
  let failed = false;
  const watched = fixtureProcesses(async () => { if (failed) throw failure; return rows; });
  await assert.rejects(watched.remember(original.pid), /no process identity/);
  rows = new Map([[original.pid, original]]);
  await watched.remember(original.pid);
  failed = true;
  await assert.rejects(watched.alive(original.pid), error => error === failure);
  failed = false;
  rows = new Map([[original.pid, { ...original, started: "" }]]);
  await assert.rejects(watched.alive(original.pid), /identity is missing/);
  await assert.rejects(watched.alive(999), /not recorded at readiness/);
});


test("a ready-time group snapshot preserves its original identities without adopting later owners", async () => {
  const captured = { ...original };
  let current = { ...original };
  const watched = fixtureProcesses(async () => new Map([[current.pid, current]]));
  watched.rememberSnapshot(captured);
  captured.started = "caller mutated snapshot";
  assert.deepEqual(await watched.alive(original.pid), [true]);
  current = { ...original, started: "new owner" };
  assert.deepEqual(await watched.alive(original.pid), [false]);
  assert.throws(() => watched.rememberSnapshot(current), /Cannot replace original identity/);
  assert.throws(() => fixtureProcesses().rememberSnapshot({ ...original, started: "" }), /no process identity/);
});


test("a live original workload still fails even if its keeper is already gone", async () => {
  const watched=fixtureProcesses(async()=>new Map([[original.pid,original]]));
  watched.rememberSnapshot(original);
  await assert.rejects(verifyFixtureTreeExit(watched,[original.pid],[]),/Original fixture workload has not exited/);
});


test("fixture completion waits for the original external keeper after workload exit", async () => {
  const keeper={...original,pid:456,group:456};
  let keeperAlive=true,observedKeeper!:()=>void,finished=false;
  const reached=new Promise<void>(resolve=>{observedKeeper=resolve;});
  const watched=fixtureProcesses(async pids=>{
    const snapshot=new Map(keeperAlive?[[keeper.pid,keeper]]:[]);
    if(pids.includes(keeper.pid))observedKeeper();
    return snapshot;
  });
  watched.rememberSnapshot(original,keeper);
  const completion=verifyFixtureTreeExit(watched,[original.pid],[keeper.pid]).then(()=>{finished=true;});
  await reached;
  assert.equal(finished,false,'a live keeper cannot be ignored');
  keeperAlive=false;
  await completion;
  assert.equal(finished,true);
});


test("cleanup addresses the owned ChildProcess object even if its numeric PID has a new owner", async () => {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: original.pid, exitCode: null, signalCode: null });
  let originalHandleSignals = 0, replacementSignals = 0;
  const replacement = { pid: original.pid, kill: () => { replacementSignals++; } };
  // Simulate the kernel changing ownership after an identity check; only the
  // already-owned object is callable. The cleanup has no kill-by-PID callback.
  child.kill = () => { originalHandleSignals++; child.emit("exit", 0, null); return false; };
  await stopFixtureChild(child);
  assert.equal(originalHandleSignals, 1);
  assert.equal(replacementSignals, 0);
  assert.equal(replacement.pid, child.pid);
  Object.assign(child, { exitCode: 0 });
  await stopFixtureChild(child);
  assert.equal(originalHandleSignals, 1, "an exited child is not signalled again");
});

test("Windows fixture uses fresh CIM identities when numeric PID signal access is denied", async () => {
  const identity = { pid: 2147483647, group: 2147483647, started: "1000" };
  const kill = process.kill;
  let current: typeof identity | undefined = identity;
  process.kill = ((pid, signal) => {
    if (pid === identity.pid) throw Object.assign(Error("Signal probe access denied"), { code: "EPERM" });
    return kill(pid, signal);
  }) as typeof process.kill;
  try {
    const watched = fixtureProcesses(pids => windowsFixtureIdentities(pids, async () => current ? [{ ...current, parent: 1 }] : []));
    watched.rememberSnapshot(identity);
    assert.deepEqual(await watched.alive(identity.pid), [true], "CIM must still identify an original survivor");
    current = { ...identity, started: "2000" };
    assert.deepEqual(await watched.alive(identity.pid), [false], "a later owner is not the original process");
    current = undefined;
    assert.deepEqual(await watched.alive(identity.pid), [false], "a fresh successful CIM absence proves exit");
  } finally { process.kill = kill; }
});

test("Windows fixture never converts failed or incomplete CIM evidence into process exit", async () => {
  const failed = Error("controlled CIM failure");
  await assert.rejects(windowsFixtureIdentities([123], async () => { throw failed; }), error => error === failed);
  await assert.rejects(windowsFixtureIdentities([123], async () => [{ pid: 123, group: 123, parent: 1, started: null }]), /no creation identity/);
});
