import assert from "node:assert/strict";
import test from "node:test";
import { ensureRunWorkersExited } from "../src/archive/worker-guard.js";

const run = { artifactReviews: [{ rounds: [{ assignments: [{ attempts: [{ workerPid: 123 }, { workerPid: 456 }] }] }] }] };

test("archive permits transfer only after every recorded Worker PID is confirmed absent", () => {
  const checked: number[] = [];
  ensureRunWorkersExited(run, (pid) => { checked.push(pid); throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
  assert.deepEqual(checked, [123, 456]);
});

test("an existing or reused PID blocks archive without attempting termination", () => {
  assert.throws(() => ensureRunWorkersExited(run, () => undefined), /still exists.*retry/);
});

for (const error of [Object.assign(new Error("permission"), { code: "EPERM" }), new Error("unknown probe failure"), "unexpected probe result"]) {
  test(`an uncertain Worker probe blocks transfer: ${String(error)}`, () => {
    assert.throws(() => ensureRunWorkersExited(run, () => { throw error; }), /Cannot confirm.*retry/);
  });
}

test("records without Worker PID retain the existing archive eligibility", () => {
  ensureRunWorkersExited({ artifactReviews: [{ rounds: [{ assignments: [{ attempts: [{}] }] }] }] }, () => assert.fail("no PID to probe"));
});

test("retry checks Worker exit again instead of remembering an earlier probe", () => {
  let exited = false;
  const probe = () => { if (exited) throw Object.assign(new Error("gone"), { code: "ESRCH" }); };
  assert.throws(() => ensureRunWorkersExited(run, probe), /still exists/);
  exited = true;
  ensureRunWorkersExited(run, probe);
});
