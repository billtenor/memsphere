import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";


import { join, relative, resolve, sep } from "node:path";
import { discoverTestFiles, selectWindowsPackageSmokeTests } from "../../scripts/ci/test-plan.mjs";

test("the real test runner schedules all discovered tests assigned to the regular runner", async () => {
  const plan = JSON.parse(execFileSync(process.execPath, ["scripts/ci/run-tests.mjs", "--suite=all", "--list"], { encoding: "utf8" }));
  const files = plan.files.map((file: string) => relative(resolve("test"), file).split(sep).join("/")).sort();
  const discovered = await discoverTestFiles("test");
  const packaged = selectWindowsPackageSmokeTests(discovered);
  assert(packaged.length > 0);
  assert.deepEqual([...files, ...packaged].sort(), discovered);
  for (const file of ["ci-workflow.unit", "test-plan.integration", "test-plan.system", "full-health.integration", "full-health.system", "ci-change-guard.integration", "ci-change-guard.system"]) {
    assert(files.includes(`ci/${file}.test.ts`), `${file} must not disappear after splitting`);
  }
});
