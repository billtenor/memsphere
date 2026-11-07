import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { discoverTestFiles, selectTests, testCategory } from "../../scripts/ci/test-plan.mjs";

test("test discovery retains root tests and recursively includes CI subdirectories", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-test-discovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "ci", "nested"), { recursive: true });
  await Promise.all(["root.test.ts", "ci/guard.test.ts", "ci/nested/future.test.ts", "ci/helper.ts", "README.md"]
    .map(file => writeFile(join(directory, file), "")));
  assert.deepEqual(await discoverTestFiles(directory), ["ci/guard.test.ts", "ci/nested/future.test.ts", "root.test.ts"]);
});

test("the real test runner schedules the relocated CI tests alongside all discovered tests", async () => {
  const plan = JSON.parse(execFileSync(process.execPath, ["scripts/ci/run-tests.mjs", "--list"], { encoding: "utf8" }));
  const files = plan.files.map((file: string) => relative(resolve("test"), file).split(sep).join("/")).sort();
  assert.deepEqual(files, await discoverTestFiles("test"));
  for (const file of ["ci-workflow", "test-plan", "full-health", "ci-change-guard"]) {
    assert(files.includes(`ci/${file}${file === "ci-workflow" ? ".unit" : ""}.test.ts`), `${file} must not disappear after moving`);
  }
});
