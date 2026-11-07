import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { ciProfile, createCiPlan } from "../../scripts/ci/ci-plan.mjs";
import { defaultTestExclusions, discoverTestFiles, selectTests, testSuites } from "../../scripts/ci/test-plan.mjs";

const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
const files = await discoverTestFiles("test");
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`test/${file}`, "utf8")])));

test("exclusion-based selection preserves every prior default suite", async () => {
  const baseline = JSON.parse(await readFile("test/ci/fixtures/selection-before-exclusions.json", "utf8"));
  const existing = baseline.files.filter((file: string) => files.includes(file));
  for (const [suite, selected] of Object.entries(baseline.suites)) {
    assert.deepEqual(selectTests(existing, sources, {}, suite).sort(), (selected as string[]).filter(file => files.includes(file)), suite);
  }
});

function assertDefaultGroups(files: string[], sources: Record<string, string>) {
  const full = createCiPlan("full", files, sources).include;
  const defaults = createCiPlan("default", files, sources).include;
  for (const row of defaults) {
    assert.ok(selectTests(files, sources, {}, row.suite).length > 0, "only nonempty categories become jobs");
    const suite = row.suite.replace(/^native-/, "");
    const previous = full.find(candidate => candidate.os === row.os && candidate.suite === suite);
    assert(previous);
    assert.equal(row.workers, previous.workers);
    assert.equal(row.title, previous.title);
    const expected = selectTests(files, sources, {}, suite).filter(file => row.os === "ubuntu-24.04" || !defaultTestExclusions.includes(file));
    assert.deepEqual(selectTests(files, sources, {}, row.suite), expected);
  }
  for (const os of ["ubuntu-24.04", "macos-latest", "windows-latest"]) {
    const assigned = defaults.filter(row => row.os === os).flatMap(row => selectTests(files, sources, {}, row.suite)).sort();
    assert.deepEqual(assigned, (os === "ubuntu-24.04" ? files : files.filter(file => !defaultTestExclusions.includes(file))).slice().sort(), `${os}: every eligible file runs exactly once`);
  }
}

test("default preserves native coverage while using full's category groups and workers", () => assertDefaultGroups(files, sources));

test("default excludes only fixed paths; all future files run once and full remains exhaustive", async () => {
  const future = {
    "nested/unmeasured-new-feature.test.ts": "",
    "nested/daemon-integration.test.ts": "",
    "project-upgrade-future.test.ts": "",
    "model-future-browser.test.ts": "helpers/browser",
    "review-future-browser.test.ts": "helpers/browser",
    "future-cli.test.ts": ""
  };
  const exclusions = defaultTestExclusions;
  assert.equal(new Set(exclusions).size, exclusions.length);
  assert(exclusions.every((path: string) => typeof path === "string" && !/[?*]/.test(path) && !path.includes("..") && !path.startsWith("/")));
  const allFiles = [...files, ...Object.keys(future)];
  const allSources = { ...sources, ...future };
  assertDefaultGroups(allFiles, allSources);
  for (const profile of ["default", "full"]) {
    const rows = createCiPlan(profile, allFiles, allSources).include;
    for (const os of ["macos-latest", "windows-latest"]) assert.ok(rows.some(row => row.os === os && selectTests(allFiles, allSources, {}, row.suite).includes("model-future-browser.test.ts")), "future browser tests activate native UI jobs");
    for (const os of ["ubuntu-24.04", "macos-latest", "windows-latest"]) {
      const assigned = rows.filter(row => row.os === os).flatMap(row => selectTests(allFiles, allSources, {}, row.suite));

      const expected = profile === "default" && os !== "ubuntu-24.04" ? allFiles.filter(file => !exclusions.includes(file)) : allFiles;
      assert.deepEqual([...assigned].sort(), [...expected].sort(), `${profile}/${os}: no missing or duplicate files`);
      for (const file of Object.keys(future)) assert(assigned.includes(file), file);
    }
    for (const row of rows) {
      assert.equal(row.title, testSuites[row.suite].title);
      assert(row.workers > 0);
      const selected = selectTests(allFiles, allSources, {}, row.suite);
      assert.equal(row.browser, selected.some(file => allSources[file].includes("helpers/browser") || /from ["']playwright["']/.test(allSources[file])));
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
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").run, 'node scripts/ci/ci-plan.mjs >> "$GITHUB_OUTPUT"');
  assert.equal(workflow.jobs.plan.steps.find(step => step.id === "plan").env.CI_PROFILE, "${{ inputs.profile || 'default' }}");
  assert.equal(workflow.jobs.budget, undefined, "queueing is not a failure");
  assert.equal(workflow.jobs["full-result"].if, "always() && needs.plan.outputs.profile == 'full'");
  for (const name of ["full-result"]) {
    assert.deepEqual(workflow.jobs[name].needs, ["plan", "test", "windows-package-smoke"]);
    const result = workflow.jobs[name].steps.at(-1);
    assert.equal(result.env.TEST_RESULT, "${{ needs.test.result }}");
    assert.equal(result.env.PACKAGE_RESULT, "${{ needs.windows-package-smoke.result }}");
    assert.match(result.run, /test "\$TEST_RESULT" = success/);
    assert.match(result.run, /test "\$PACKAGE_RESULT" = success/);
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
  const compileCache = steps.find(step => step.name === "Reuse Node compilation within this job");
  assert.equal(compileCache.if, undefined, "all platforms reuse bytecode within their own job");
  assert.equal(compileCache.shell, "bash");
  assert.match(compileCache.run, /NODE_COMPILE_CACHE=\$RUNNER_TEMP\/memsphere-node-compile-cache/);
  assert(steps.indexOf(compileCache) < steps.findIndex(step => step.run?.startsWith("npm run test:ci")));
  assert.equal(steps.some(step => step.run === "npm run build"), false);
  const normalizedWindowsPackageSmoke = (await readFile("scripts/ci/windows-package-smoke.mjs", "utf8")).replaceAll("\r\n", "\n");
  assert.match(
    normalizedWindowsPackageSmoke,
    /names:\s*\n\s*- windows-ci-smoke\n\s*- Windows CI smoke/
  );
  assert.match(
    normalizedWindowsPackageSmoke,
    /\["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"\]/
  );
});
