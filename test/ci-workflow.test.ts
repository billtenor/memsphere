import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { ciProfile, createCiPlan } from "../scripts/ci-plan.mjs";
import { platformTests, selectTests, testSuites } from "../scripts/test-plan.mjs";

const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
const files = (await readdir("test")).filter(file => file.endsWith(".test.ts"));
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`test/${file}`, "utf8")])));

test("PR runs every retained test on Linux and every declared native risk on macOS and Windows", () => {
  const rows = createCiPlan("default", files, sources).include;
  assert.equal(rows.length + 1, 8, "eight complete test/package builds");
  let executions = 0;
  for (const os of ["ubuntu-24.04", "macos-latest", "windows-latest"]) {
    const assigned = rows.filter(row => row.os === os).flatMap(row => selectTests(files, sources, {}, row.suite));
    executions += assigned.length;
    assert.equal(new Set(assigned).size, assigned.length, `${os}: no duplicate files`);
    if (os === "ubuntu-24.04") assert.deepEqual([...assigned].sort(), [...files].sort());
    else {
      for (const file of [...platformTests, ...files.filter(file => file.startsWith("project-upgrade"))]) {
        assert(assigned.includes(file), `${os}: required native protection ${file}`);
      }
      assert(assigned.length < files.length, `${os}: avoid a second complete copy`);
    }
  }
  assert(executions <= 266, "at least 40% fewer file executions than the 444-file baseline");
  assert(platformTests.includes("project-command.test.ts"), "repair CAS, literal Git paths, symlink rejection and rollback remain platform checks");
  assert(platformTests.includes("project-resolver.test.ts"));
  assert(platformTests.includes("run-memory-backfill.test.ts"));
  assert.throws(() => createCiPlan("default", files.filter(file => file !== "project-resolver.test.ts"), sources), /protection is missing/);
});

test("Full CI retains complete exactly-once coverage on all platforms, including future files", () => {
  const future = "unmeasured-new-feature.test.ts";
  const allFiles = [...files, future];
  const allSources = { ...sources, [future]: "" };
  const rows = createCiPlan("full", allFiles, allSources).include;
  assert.equal(rows.length, 17);
  for (const os of ["ubuntu-24.04", "macos-latest", "windows-latest"]) {
    const assigned = rows.filter(row => row.os === os).flatMap(row => selectTests(allFiles, allSources, {}, row.suite));
    assert.deepEqual([...assigned].sort(), [...allFiles].sort(), `${os}: no missing or duplicate files`);
  }
  for (const profile of ["default", "full"]) {
    for (const row of createCiPlan(profile, files, sources).include) {
      assert.equal(row.title, testSuites[row.suite].title);
      assert(row.workers > 0);
      const selected = selectTests(files, sources, {}, row.suite);
      assert.equal(row.browser, selected.some(file => sources[file].includes("helpers/browser") || /from ["']playwright["']/.test(sources[file])));
    }
  }
});

test("CI separates full and default cancellation, trigger and result policies", async () => {
  assert.equal(ciProfile("pull_request", "full"), "default");
  assert.equal(ciProfile("push", "full"), "default");
  assert.equal(ciProfile("schedule"), "full");
  assert.equal(ciProfile("workflow_dispatch", "full"), "full");
  assert.equal(ciProfile("workflow_dispatch", "default"), "default");
  assert.throws(() => ciProfile("workflow_dispatch", "unknown"), /Unknown CI profile/);
  const full = "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.profile == 'full')";
  assert.equal(workflow.concurrency.group, "ci-${{ github.workflow }}-${{ (" + full + ") && 'full' || 'default' }}-${{ github.event.pull_request.number || github.ref }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], "${{ !(" + full + ") }}");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.profile.options, ["default", "full"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.profile.default, "full");
  assert.deepEqual(workflow.on.schedule, [{ cron: "30 2 * * *" }]);
  assert.equal(workflow.jobs.test.strategy.matrix, "${{ fromJSON(needs.plan.outputs.matrix) }}");
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").run, 'node scripts/ci-plan.mjs >> "$GITHUB_OUTPUT"');
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").env.CI_PROFILE, "${{ inputs.profile || 'default' }}");
  assert.equal(workflow.jobs.budget.if, "always() && needs.plan.outputs.profile == 'default'");
  assert.equal(workflow.jobs["full-result"].if, "always() && needs.plan.outputs.profile == 'full'");
  for (const name of ["budget", "full-result"]) {
    assert.deepEqual(workflow.jobs[name].needs, ["plan", "test", "windows-package-smoke"]);
    const result = workflow.jobs[name].steps.at(-1);
    assert.equal(result.env.TEST_RESULT, "${{ needs.test.result }}");
    assert.equal(result.env.PACKAGE_RESULT, "${{ needs.windows-package-smoke.result }}");
    assert.match(result.run, /test "\$TEST_RESULT" = success/);
    assert.match(result.run, /test "\$PACKAGE_RESULT" = success/);
  }
  assert.match(workflow.jobs.budget.steps.at(-1).run, /node scripts\/ci-budget.mjs/);
  assert.equal(workflow.jobs.test["timeout-minutes"], "${{ needs.plan.outputs.profile == 'full' && 10 || 5 }}");
  const steps = workflow.jobs.test.steps;
  const browserInstall = steps.find(step => step.name === "Install Playwright Chromium");
  assert.equal(browserInstall.if, "matrix.browser");
  assert.equal(browserInstall.run, "npx playwright install chromium");
  assert(steps.some(step => step.run?.startsWith("npm run test:ci")));
  assert.equal(steps.some(step => step.run === "npm run build"), false);
  const normalizedWindowsPackageSmoke = (await readFile("scripts/windows-package-smoke.mjs", "utf8")).replaceAll("\r\n", "\n");
  assert.match(
    normalizedWindowsPackageSmoke,
    /names:\s*\n\s*- windows-ci-smoke\n\s*- Windows CI smoke/
  );
  assert.match(
    normalizedWindowsPackageSmoke,
    /\["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"\]/
  );
});
