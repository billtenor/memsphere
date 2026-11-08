import assert from "node:assert/strict";
import test from "node:test";
import { selectTests, testCategory } from "../../scripts/ci/test-plan.mjs";


test("Test categories describe the primary contract and automatically include new tests", () => {
  assert.equal(testCategory("app-install.test.ts", ""), "app-cli");
  assert.equal(testCategory("memory-cli.test.ts", ""), "memory-cli");
  assert.equal(testCategory("project-command.test.ts", ""), "project-core");
  assert.equal(testCategory("embedded-changeset.test.ts", "helpers/browser"), "memory-core");
  assert.equal(testCategory("models-builtin-view-browser.test.ts", "helpers/browser"), "model-ui");
  assert.equal(testCategory("artifact-review-browser.test.ts", "helpers/browser"), "review-ui");
  const file = "unmeasured-new-feature.test.ts";
  assert.deepEqual(selectTests([file], { [file]: "" }, "runtime-core"), [file]);
});


test("Test selection is stable without measured durations and preserves suite membership", () => {
  const files = ["cli-errors.test.ts", "memory-cli.test.ts", "run-start-cli.test.ts"];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, "memory-cli"), files);
  assert.deepEqual(selectTests([...files].reverse(), sources, "memory-cli"), files);
  assert.throws(() => selectTests(files, sources, "unknown"), /Unknown test suite/);
});

test("New project upgrade tests enter their CI suite and remain in aggregate project runs", () => {
  const upgrade = "project-upgrade-extra.test.ts";
  const lifecycle = "project-command.test.ts";
  const files = [upgrade, lifecycle];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, "project-upgrade"), [upgrade]);
  assert.deepEqual(selectTests(files, sources, "project-core"), [lifecycle]);
  for (const suite of ["core", "memory-and-projects"]) {
    assert.deepEqual(selectTests(files, sources, suite).sort(), [...files].sort());
  }
});


test("system and historical upgrades run in upgrade groups instead of runtime groups", () => {
  const upgrades = ["legacy-general-task-upgrade.test.ts", "system-upgrade-changeset.test.ts"];
  const files = [...upgrades, "daemon-integration.test.ts"];
  const sources = Object.fromEntries(files.map(file => [file, ""]));
  assert.deepEqual(selectTests(files, sources, "runtime-core"), ["daemon-integration.test.ts"]);
  for (const suite of ["project-upgrade", "memory-and-projects"]) {
    assert.deepEqual(selectTests(files, sources, suite).sort(), upgrades);
  }
});
