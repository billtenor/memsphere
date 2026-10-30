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
    assert(files.includes(`ci/${file}.test.ts`), `${file} must not disappear after moving`);
  }
});

test("Test categories describe the primary contract and automatically include new tests", () => {
  assert.equal(testCategory("app-install.test.ts", ""), "app-cli");
  assert.equal(testCategory("memory-cli.test.ts", ""), "memory-cli");
  assert.equal(testCategory("project-command.test.ts", ""), "project-core");
  assert.equal(testCategory("embedded-changeset.test.ts", "helpers/browser"), "memory-core");
  assert.equal(testCategory("models-builtin-view-browser.test.ts", "helpers/browser"), "model-ui");
  assert.equal(testCategory("artifact-review-browser.test.ts", "helpers/browser"), "review-ui");
  const file = "unmeasured-new-feature.test.ts";
  assert.deepEqual(selectTests([file], { [file]: "" }, {}, "runtime-core"), [file]);
});

test("Scheduling orders expensive files first within their category without changing membership", () => {
  const files = ["cli-errors.test.ts", "memory-cli.test.ts", "run-start-cli.test.ts"];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  const durations = { "cli-errors.test.ts": 1, "memory-cli.test.ts": 80, "run-start-cli.test.ts": 10 };
  assert.deepEqual(selectTests(files, sources, durations, "memory-cli"), [files[1], files[2], files[0]]);
  assert.deepEqual(selectTests([...files].reverse(), sources, durations, "memory-cli"), selectTests(files, sources, durations, "memory-cli"));
  assert.throws(() => selectTests(files, sources, durations, "unknown"), /Unknown test suite/);
});

test("New project upgrade tests enter their CI suite and remain in aggregate project runs", () => {
  const upgrade = "project-upgrade-extra.test.ts";
  const lifecycle = "project-command.test.ts";
  const files = [upgrade, lifecycle];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, {}, "project-upgrade"), [upgrade]);
  assert.deepEqual(selectTests(files, sources, {}, "project-core"), [lifecycle]);
  for (const suite of ["core", "memory-and-projects"]) {
    assert.deepEqual(selectTests(files, sources, {}, suite).sort(), [...files].sort());
  }
});

test("system and historical upgrades run in upgrade groups without duplicating native PR protection", () => {
  const upgrades = ["legacy-general-task-upgrade.test.ts", "system-upgrade-changeset.test.ts"];
  const files = [...upgrades, "daemon-integration.test.ts"];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, {}, "runtime-core"), ["daemon-integration.test.ts"]);
  for (const suite of ["project-upgrade", "memory-and-projects"]) {
    assert.deepEqual(selectTests(files, sources, {}, suite).sort(), upgrades);
  }
  for (const suite of ["platform-upgrades", "platform-and-upgrades"]) {
    assert.deepEqual(selectTests(files, sources, {}, suite), ["system-upgrade-changeset.test.ts"]);
  }
});
