import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import test from "node:test";
import { ownTestProcess } from "./helpers/owned-process.js";

function fixture(pid: number | undefined, kill: () => boolean) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, kill });
  const controller = new AbortController();
  let cleanup!: () => Promise<void>;
  ownTestProcess(child as unknown as ChildProcess, controller.signal, value => { cleanup = value; });
  return { child, controller, cleanup };
}

test("failed spawn has no running process to reclaim", async () => {
  const f = fixture(undefined, () => assert.fail("must not kill a failed spawn"));
  f.child.emit("error", Object.assign(new Error("missing executable"), { code: "ENOENT" }));
  await f.cleanup();
});

for (const mode of ["error-event", "false", "throw"] as const) {
  test(`owned process ${mode} termination failure blocks fixture cleanup until a real exit`, async () => {
    const error = Object.assign(new Error("kill denied"), { code: "EPERM" });
    let calls = 0;
    const f = fixture(42, () => {
      calls++;
      if (mode === "throw") throw error;
      if (mode === "error-event") f.child.emit("error", error);
      return false;
    });
    f.controller.abort();
    await assert.rejects(f.cleanup(), /kill denied|Could not terminate/);
    assert.equal(calls, 2, "a failed kill must not mark the child as exited");
    f.child.emit("exit", 1, null);
    await f.cleanup();
    assert.equal(calls, 2, "confirmed exit stops further kills");
  });
}

test("fixture deletion waits for the asynchronous exit event after a successful kill", async () => {
  const f = fixture(42, () => true);
  let reclaimed = false;
  const pending = f.cleanup().then(() => { reclaimed = true; });
  await Promise.resolve();
  assert.equal(reclaimed, false);
  f.child.emit("exit", null, "SIGKILL");
  await pending;
  assert.equal(reclaimed, true);
});
