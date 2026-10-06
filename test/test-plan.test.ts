import assert from "node:assert/strict";
import test from "node:test";
import { selectTests, testCategory } from "../scripts/test-plan.mjs";

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
