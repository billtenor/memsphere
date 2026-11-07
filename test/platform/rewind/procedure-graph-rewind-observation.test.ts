import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { captureProcessIdentity, type ProcessIdentity } from "../../../src/context_control/review-process.js";
import { bounded, cleanupFixtureResources, createFixtureProcesses, fixtureProcesses, sameProcess, stopFixtureChild, verifyFixtureTreeExit } from "../../helpers/fixture-process.js";
import { pinWindowsProcess } from "../../helpers/windows-process-handle.js";
import { ownedProcessObserver } from "../../helpers/windows-process-observer.js";
import { rewindFixtureResources } from "../../helpers/fixture-process.js";
import { processGates } from "../../fixtures/process-gates.mjs";
import { createConnection } from "node:net";

const original = { pid: 123, group: 123, started: "original creation" };

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

test("a failed Job probe cannot skip other owned Jobs, workers or transport cleanup", async t => {
  const [first, second] = await Promise.all([0, 1].map(async () => {
    const child = spawn(process.execPath, ["-e", "process.on('message',()=>{});process.send('ready');"], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    t.after(() => stopFixtureChild(child));
    await bounded(once(child, "message"), "cleanup regression child readiness");
    return child;
  }));
  const failedProbe = Error("first Job inspection rejected"), failedClose = Error("gate close rejected");
  const attempts: string[] = [];
  await assert.rejects(cleanupFixtureResources([
    () => { attempts.push("first Job"); throw failedProbe; },
    () => { attempts.push("second Job"); },
    () => stopFixtureChild(first),
    () => stopFixtureChild(second),
    () => { attempts.push("gates"); throw failedClose; },
    () => { attempts.push("observer"); }
  ]), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failedProbe, failedClose], "cleanup reports every failure");
    return true;
  });
  assert.deepEqual(attempts, ["first Job", "second Job", "gates", "observer"]);
  assert.notEqual(first.signalCode ?? first.exitCode, null);
  assert.notEqual(second.signalCode ?? second.exitCode, null);
});

test("a timed out CIM transport closes its owned host and rejects queued queries instead of consuming late responses", async t => {
  // The host never answers A. B is queued before A times out; a deliberately
  // late line would resemble an empty process result if the host were reused.
  const host = spawn(process.execPath, ["-e", `
    require('node:readline').createInterface({input:process.stdin}).on('line',()=>{});
    process.stdout.write('{"ready":true}\\n');
  `], { stdio: "pipe" });
  t.after(() => stopFixtureChild(host));
  const observer = await ownedProcessObserver(host, t.signal, 50);
  t.after(() => observer.close());
  const first = observer.query([123]), queued = observer.query([456]);
  const outcomes = await Promise.allSettled([first, queued]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "rejected");
  if (outcomes[0].status === "rejected" && outcomes[1].status === "rejected") {
    assert.match(String(outcomes[0].reason), /Timed out: fresh fixture CIM response/);
    assert.equal(outcomes[1].reason, outcomes[0].reason);
  }
  assert.notEqual(host.signalCode ?? host.exitCode, null, "failed host is already terminated");
  host.stdout.emit("data", Buffer.from('{"ok":true,"processes":[]}\n'));
  await assert.rejects(observer.query([789]), /Timed out: fresh fixture CIM response/);
});

test("observer initialization failure closes the already-listening rewind gate", async t => {
  const failure = Error("injected observer readiness failure");
  let endpoint = 0;
  await assert.rejects(rewindFixtureResources(t, {
    createGates: async signal => {
      const gates = await processGates(signal);
      endpoint = gates.endpoint;
      return gates;
    },
    createObserver: async () => { throw failure; }
  }), error => error === failure);
  assert.ok(endpoint, "the real gate had acquired a listening port before failure");
  const connection = createConnection({ host: "127.0.0.1", port: endpoint, signal: AbortSignal.timeout(5_000) });
  try { await assert.rejects(once(connection, "connect"), { code: "ECONNREFUSED" }); }
  finally { connection.destroy(); }
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
