import assert from "node:assert/strict";
import test from "node:test";
import { queryWindowsProcesses } from "../src/context_control/review-process.js";
import { inspectWindowsReviewJob } from "../src/context_control/windows-review-job.js";


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



test("legacy or malformed Job names cannot provide complete process exit evidence",async()=>{
 for(const name of ["Global\\Memsphere.Reviewer.00000000-0000-4000-8000-000000000000","Local\\Memsphere.Reviewer.00000000-0000-4000-8000-000000000000","untrusted"])
  await assert.rejects(inspectWindowsReviewJob(name),{code:"PROCESS_IDENTITY_UNAVAILABLE"});
});
