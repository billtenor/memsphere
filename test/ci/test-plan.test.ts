import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { discoverTestFiles, selectTests, selectTestShard, testCategory } from "../../scripts/ci/test-plan.mjs";

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

test("balanced shards retain each whole file once, independently of discovery order", () => {
  const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "future.test.ts"];
  const durations = { "a.test.ts": 100, "b.test.ts": 80, "c.test.ts": 30, "d.test.ts": 20 };
  const shards = ["1/2", "2/2"].map(shard => selectTestShard(files, durations, shard));
  assert.deepEqual(shards, [["a.test.ts", "d.test.ts"], ["b.test.ts", "c.test.ts", "future.test.ts"]]);
  assert.deepEqual(shards.flat().sort(), [...files].sort());
  assert.deepEqual(selectTestShard([...files].reverse(), durations, "1/2"), shards[0]);
  assert.deepEqual(files, ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "future.test.ts"]);
  for (const shard of ["1/2", "2/2"]) assert(selectTestShard(files, {}, shard).length > 0);
  for (const shard of ["1/2", "2/2"]) assert(selectTestShard(files, Object.fromEntries(files.map(file => [file, 0])), shard).length > 0);
  assert.deepEqual(selectTestShard(files, durations, "1/1").sort(), [...files].sort());
});

test("invalid shard selectors fail instead of silently running an incomplete or whole suite", () => {
  const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "future.test.ts"];
  for (const shard of ["0/2", "3/2", "1/0", "1.5/2", "1/6", "1/9007199254740992", "invalid"]) {
    assert.throws(() => selectTestShard(files, {}, shard), /Shard must be/);
  }
  assert.throws(() => execFileSync(process.execPath, ["scripts/ci/run-tests.mjs", "--shard=", "--list"], { stdio: "pipe" }), /Command failed/);
});

test("planner and workers assign the same relative, absolute and native path identities", () => {
  const files = ["nested/b.test.ts", "a.test.ts", "nested/c.test.ts", "d.test.ts"];
  const durations = { "a.test.ts": 20, "b.test.ts": 20, "c.test.ts": 10, "d.test.ts": 10 };
  for (const shard of ["1/2", "2/2"]) {
    const expected = selectTestShard(files, durations, shard);
    assert.deepEqual(selectTestShard(files.map(file => resolve("test", file)), durations, shard)
      .map(file => relative(resolve("test"), file).split(sep).join("/")), expected);
    assert.deepEqual(selectTestShard(files.map(file => file.replaceAll("/", "\\")), durations, shard)
      .map(file => file.replaceAll("\\", "/")), expected);
  }
});

test("the actual runner lists disjoint shards whose union is the unsharded suite", () => {
  const list = (shard?: string) => JSON.parse(execFileSync(process.execPath,
    ["scripts/ci/run-tests.mjs", "--suite=runtime-core", "--list", ...(shard ? [`--shard=${shard}`] : [])], { encoding: "utf8" }));
  const all = list(), first = list("1/2"), second = list("2/2");
  assert.equal(first.shard, "1/2"); assert.equal(second.shard, "2/2");
  assert(first.files.length > 0 && second.files.length > 0);
  assert.deepEqual([...first.files, ...second.files].sort(), [...all.files].sort());
});

test("the actual runner executes every shard file once and records its complete results", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-shard-execution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scripts/ci"), { recursive: true });
  await mkdir(join(directory, "test"));
  for (const name of ["run-tests.mjs", "test-plan.mjs", "test-processes.mjs", "test-durations.json"]) {
    await copyFile(resolve("scripts/ci", name), join(directory, "scripts/ci", name));
  }
  const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"];
  for (const file of files) await writeFile(join(directory, "test", file),
    `import test from "node:test";test(${JSON.stringify(file)},()=>{});`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const assigned: string[] = [];
  for (const shard of ["1/2", "2/2"]) {
    const result = join(directory, `shard-${shard[0]}.json`);
    execFileSync(process.execPath, [join(directory, "scripts/ci/run-tests.mjs"), `--shard=${shard}`, `--results=${result}`, "--test-concurrency=1"], { env, stdio: "pipe" });
    const actual = JSON.parse(await readFile(result, "utf8"));
    assert.equal(actual.shard, shard);
    assert.deepEqual(actual.results.map((row: { file: string }) => row.file).sort(), [...actual.planned].sort());
    assert(actual.results.every((row: { exitCode: number }) => row.exitCode === 0));
    assigned.push(...actual.planned);
  }
  assert.deepEqual(assigned.sort(), files);
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

test("system and historical upgrades run in upgrade groups instead of runtime groups", () => {
  const upgrades = ["legacy-general-task-upgrade.test.ts", "system-upgrade-changeset.test.ts"];
  const files = [...upgrades, "daemon-integration.test.ts"];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, {}, "runtime-core"), ["daemon-integration.test.ts"]);
  for (const suite of ["project-upgrade", "memory-and-projects"]) {
    assert.deepEqual(selectTests(files, sources, {}, suite).sort(), upgrades);
  }
});
