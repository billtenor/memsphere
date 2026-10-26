import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { ciProfile, createCiPlan } from "../scripts/ci-plan.mjs";
import { packagePlatformTests, platformTests, selectTests, testSuites } from "../scripts/test-plan.mjs";

const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
const files = (await readdir("test")).filter(file => file.endsWith(".test.ts"));
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`test/${file}`, "utf8")])));

test("PR runs every retained test on Linux and every declared native risk on macOS and Windows", () => {
  const rows = createCiPlan("default", files, sources).include;
  assert.equal(rows.length + 1, 8, "eight complete test/package builds");
  let executions = 0;
  for (const os of ["ubuntu-24.04", "macos-latest", "windows-latest"]) {
    const assigned = rows.filter(row => row.os === os).flatMap(row => selectTests(files, sources, {}, row.suite));
    if (os === "windows-latest") assigned.push(...packagePlatformTests);
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
  const packaged = workflow.jobs["windows-package-smoke"].steps.find(step => step.name === "Native platform contracts");
  assert.equal(packaged.if, "needs.plan.outputs.profile == 'default'");
  assert.match(packaged.run, /node scripts\/run-tests\.mjs --suite=package-platform --test-concurrency=2/);
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
  assert.equal(ciProfile("push"), "full");
  assert.equal(ciProfile("workflow_dispatch", "full"), "full");
  assert.equal(ciProfile("workflow_dispatch", "default"), "default");
  assert.throws(() => ciProfile("workflow_dispatch", "unknown"), /Unknown CI profile/);
  const full = "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.profile == 'full')";
  assert.equal(workflow["run-name"], "${{ inputs.full_health_bootstrap && 'Initialize PR merge gate' || ((" + full + ") && 'CI (full)' || 'CI (default)') }}");
  assert.equal(workflow.concurrency.group, "ci-${{ github.workflow }}-${{ inputs.full_health_bootstrap && 'bootstrap' || ((" + full + ") && 'full' || 'default') }}-${{ (" + full + ") && github.run_id || (github.event.pull_request.number || github.ref) }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], "${{ !inputs.full_health_bootstrap && github.event_name != 'push' && !(github.event_name == 'workflow_dispatch' && inputs.profile == 'full') }}");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.profile.options, ["default", "full"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.profile.default, "full");
  assert.equal(workflow.on.schedule, undefined);
  assert.deepEqual(workflow.on.push.branches, ["master"]);
  assert.equal(workflow.jobs.plan.if, "${{ !inputs.full_health_bootstrap }}");
  assert.equal(workflow.jobs.test.strategy.matrix, "${{ fromJSON(needs.plan.outputs.matrix) }}");
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").run, 'node scripts/ci-plan.mjs >> "$GITHUB_OUTPUT"');
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").env.CI_PROFILE, "${{ inputs.profile || 'default' }}");
  assert.equal(workflow.jobs.budget, undefined, "queueing is not a failure");
  assert.equal(workflow.jobs["full-result"].if, "always() && needs.plan.outputs.profile == 'full'");
  assert.equal(workflow.jobs["all-tests"].if, "needs.plan.outputs.profile == 'full'");
  assert.deepEqual(workflow.jobs["all-tests"].needs, "plan");
  assert(workflow.jobs["all-tests"].steps.some(step => step.run === "npx playwright install chromium"));
  assert(workflow.jobs["all-tests"].steps.some(step => step.run === "npm test"));
  for (const name of ["full-result"]) {
    assert.deepEqual(workflow.jobs[name].needs, ["plan", "test", "windows-package-smoke", "all-tests"]);
    const result = workflow.jobs[name].steps.at(-1);
    assert.equal(result.env.TEST_RESULT, "${{ needs.test.result }}");
    assert.equal(result.env.PACKAGE_RESULT, "${{ needs.windows-package-smoke.result }}");
    assert.equal(result.env.ALL_TESTS_RESULT, "${{ needs.all-tests.result }}");
    assert.match(result.run, /test "\$TEST_RESULT" = success/);
    assert.match(result.run, /test "\$PACKAGE_RESULT" = success/);
    assert.match(result.run, /test "\$ALL_TESTS_RESULT" = success/);
  }
  const security = parse(await readFile(".github/workflows/security.yml", "utf8"));
  assert.equal(security.jobs.gitleaks["timeout-minutes"], 5);
  assert.equal(security.jobs.gitleaks.steps.some(step => step.run?.includes("ci-budget")), false);
  assert.equal(workflow.jobs["full-result"]["timeout-minutes"], 5);
  assert.equal(workflow.jobs.test["timeout-minutes"], "${{ needs.plan.outputs.profile == 'full' && 20 || 5 }}");
  assert.equal(workflow.jobs["windows-package-smoke"]["timeout-minutes"], "${{ needs.plan.outputs.profile == 'full' && 20 || 5 }}");
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
