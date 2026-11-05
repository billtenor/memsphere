import { processGates } from './fixtures/process-gates.mjs';
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { release as osRelease } from "node:os";
import test from "node:test";
import { captureProcessGroup, captureProcessIdentity, stopRewindWorker } from "../src/context_control/review-process.js";
import { terminateProcessTree } from "../src/platform-process.js";

for (const scenario of ["tree", "identity", "orphan", "unrecorded-orphan"] as const) test(`Windows native rewind process safety: ${scenario}`, {
  skip: process.platform !== "win32", timeout: 120000
}, async t => {
  t.diagnostic(`Windows ${osRelease()}, Node ${process.version}; native PowerShell/CIM and taskkill /T`);
  const gates = await processGates(t.signal);
  const workers: Array<ReturnType<typeof fork>> = [];
  t.after(async () => {
    gates.publish("release");
    for (const worker of workers) {
      await terminateProcessTree(worker.pid!).catch(() => undefined);
      if (worker.connected) worker.disconnect();
    }
    await gates.close();
  });
  const start = async () => {
    const worker = fork(new URL("./fixtures/rewind-process-tree.mjs", import.meta.url), [String(gates.endpoint)], {
      detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"]
    });
    workers.push(worker);
    const [ready] = await once(worker, "message");
    const identity = await captureProcessIdentity(worker.pid!);
    assert.ok(identity);
    const members = await captureProcessGroup(worker.pid!);
    const child = members.find(p => p.pid === ready.childPid);
    assert.ok(child, "CIM observes the real child creation identity");
    return { worker, child, rewind: { pid: worker.pid!, identity, members, reviewId: "review", attemptId: "attempt" } };
  };
  const related = await start(), unrelated = await start();
  if (scenario === "identity") {
    await assert.rejects(stopRewindWorker({ ...related.rewind, identity: { ...related.rewind.identity, started: "recycled PID" } }), { code: "PROCESS_IDENTITY_CHANGED" });
    assert.deepEqual(await captureProcessIdentity(related.worker.pid!), related.rewind.identity);
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child);
  } else if (scenario === "orphan" || scenario === "unrecorded-orphan") {
    const exited = once(related.worker, "exit");
    related.worker.send("orphan");
    await exited;
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child, "fixture child survives leader exit");
    const evidence = scenario === "unrecorded-orphan" ? { ...related.rewind, members: undefined } : related.rewind;
    await assert.rejects(stopRewindWorker(evidence), { code: scenario === "unrecorded-orphan" ? "PROCESS_IDENTITY_UNAVAILABLE" : "PROCESS_TERMINATION_PENDING" });
    assert.deepEqual(await captureProcessIdentity(related.child.pid), related.child);
    gates.publish("release");
    // Retry the actual OS probe until descendants have received their release message.
    const deadline = Date.now() + 20000;
    while (await captureProcessIdentity(related.child.pid)) {
      assert.ok(Date.now() < deadline, "orphan child exits");
    }
    await stopRewindWorker(related.rewind);
  } else {
    await stopRewindWorker(related.rewind);
    for (const member of related.rewind.members) assert.equal(await captureProcessIdentity(member.pid), undefined);
    assert.deepEqual(await captureProcessIdentity(unrelated.worker.pid!), unrelated.rewind.identity);
    assert.deepEqual(await captureProcessIdentity(unrelated.child.pid), unrelated.child);
  }
});
