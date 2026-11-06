import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { captureProcessIdentity, type ProcessIdentity } from "../src/context_control/review-process.js";
import { bounded, createFixtureProcesses, fixtureProcesses, sameProcess, stopFixtureChild, verifyFixtureTreeExit } from "./helpers/fixture-process.js";
import { pinWindowsProcess } from "./helpers/windows-process-handle.js";

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

async function liveChild(t: test.TestContext) {
  const child = spawn(process.execPath, ["-e", "process.on('message',()=>{});process.send('ready');"], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => stopFixtureChild(child));
  await bounded(once(child, "message"), "fixture readiness");
  const identity = await captureProcessIdentity(child.pid!);
  assert.ok(identity);
  return { child, identity };
}

test("owned child cleanup after exit leaves a real unrelated fixture alive", async t => {
  const old = await liveChild(t), unrelated = await liveChild(t);
  assert.ok(sameProcess(old.identity, await captureProcessIdentity(old.child.pid!)));
  await stopFixtureChild(old.child); // The check-to-cleanup window closes here.
  await stopFixtureChild(old.child);
  assert.ok(sameProcess(unrelated.identity, await captureProcessIdentity(unrelated.child.pid!)));
});

test("Windows pinned handle converts the creation epoch and terminates only the original object", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const old = await liveChild(t), unrelated = await liveChild(t);
  // A controlled retired token for a real live PID proves the old boolean
  // probe cannot identify the original owner. This does not force OS PID reuse.
  assert.doesNotThrow(() => process.kill(unrelated.child.pid!, 0));
  assert.equal(sameProcess({ ...unrelated.identity, started: "1" }, await captureProcessIdentity(unrelated.child.pid!)), false);
  const controller = await pinWindowsProcess(old.identity, t.signal);
  t.after(() => controller.close());
  assert.equal(BigInt(controller.started) / 10n, BigInt(old.identity.started) / 10n);
  await stopFixtureChild(old.child);
  // Termination now uses the retained old handle, after the original exited.
  await controller.terminate();
  assert.ok(sameProcess(unrelated.identity, await captureProcessIdentity(unrelated.child.pid!)));
});

test("Windows pinned handle refuses a different creation identity before arming", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const live = await liveChild(t);
  await assert.rejects(pinWindowsProcess({ ...live.identity, started: String(BigInt(live.identity.started) + 1000n) }, t.signal), /identity changed/);
  assert.ok(sameProcess(live.identity, await captureProcessIdentity(live.child.pid!)));
});

test("Windows controller channel failure closes the handle without killing its target", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const live = await liveChild(t);
  const controller = await pinWindowsProcess(live.identity, t.signal);
  t.after(() => controller.close());
  await assert.rejects(controller.closeChannel(), /Control channel closed/);
  assert.ok(sameProcess(live.identity, await captureProcessIdentity(live.child.pid!)));
});

test("Windows controller cancellation closes its owned process without terminating the target", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const live = await liveChild(t), cancel = new AbortController();
  const controller = await pinWindowsProcess(live.identity, cancel.signal);
  t.after(() => controller.close());
  cancel.abort();
  await assert.rejects(controller.close(), /controller/i);
  assert.ok(sameProcess(live.identity, await captureProcessIdentity(live.child.pid!)));
});

test("Windows fixture CIM host reads fresh identities and never reuses evidence after it closes", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const old = await liveChild(t), unrelated = await liveChild(t);
  const watched = await createFixtureProcesses(t.signal);
  t.after(() => watched.close());
  await watched.remember(old.child.pid!, unrelated.child.pid!);
  assert.deepEqual(await watched.alive(old.child.pid!, unrelated.child.pid!), [true, true]);
  await stopFixtureChild(old.child);
  assert.deepEqual(await watched.alive(old.child.pid!, unrelated.child.pid!), [false, true]);
  await watched.close();
  await assert.rejects(watched.alive(unrelated.child.pid!), /observer is closed/);
  assert.ok(sameProcess(unrelated.identity, await captureProcessIdentity(unrelated.child.pid!)));
});
