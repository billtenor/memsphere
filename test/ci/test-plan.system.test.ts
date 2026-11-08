import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";


import { join, relative, resolve, sep } from "node:path";
import { discoverTestFiles } from "../../scripts/ci/test-plan.mjs";

test("the real test runner schedules the relocated CI tests alongside all discovered tests", async () => {
  const plan = JSON.parse(execFileSync(process.execPath, ["scripts/ci/run-tests.mjs", "--suite=all", "--list"], { encoding: "utf8" }));
  const files = plan.files.map((file: string) => relative(resolve("test"), file).split(sep).join("/")).sort();
  assert.deepEqual(files, await discoverTestFiles("test"));
  for (const file of ["ci-workflow.unit", "test-plan.integration", "test-plan.system", "full-health.integration", "full-health.system", "ci-change-guard.integration", "ci-change-guard.system"]) {
    assert(files.includes(`ci/${file}.test.ts`), `${file} must not disappear after splitting`);
  }
});