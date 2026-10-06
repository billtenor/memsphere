import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { readdir } from "node:fs/promises";
import { selectTests, testSuites } from "../scripts/test-plan.mjs";

type WorkflowStep = {
  if?: string;
  name?: string;
  run?: string;
};

type Workflow = {
  concurrency?: {
    "cancel-in-progress"?: boolean;
    group?: string;
  };
  jobs?: {
    test?: {
      steps?: WorkflowStep[];
      strategy?: {
        matrix?: {
          os?: string[];
          shard?: number[];
          include?: Array<{ os: string; suite: string; title: string; workers: number; browser: boolean }>;
        };
      };
      "timeout-minutes"?: number;
    };
  };
};

test("CI bounds and supersedes cross-platform browser test runs", async () => {
  const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8")) as Workflow;
  const windowsPackageSmoke = await readFile("scripts/windows-package-smoke.mjs", "utf8");
  const normalizedWindowsPackageSmoke = windowsPackageSmoke.replaceAll("\r\n", "\n");
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const testJob = workflow.jobs?.test;
  const steps = testJob?.steps ?? [];
  const browserInstall = steps.find((step) => step.name === "Install Playwright Chromium");
  const npmTest = steps.find((step) => step.run?.startsWith("npm run test:ci"));

  assert.equal(
    workflow.concurrency?.group,
    "ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"
  );
  assert.equal(workflow.concurrency?.["cancel-in-progress"], true);
  assert.equal(testJob?.["timeout-minutes"], 5);
  const matrix = testJob?.strategy?.matrix?.include ?? [];
  assert.deepEqual([...new Set(matrix.map(row => row.os))], [
    "ubuntu-latest",
    "macos-latest",
    "windows-latest"
  ]);
  const files = (await readdir("test")).filter(file => file.endsWith(".test.ts"));
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`test/${file}`, "utf8")])));
  for (const os of new Set(matrix.map(row => row.os))) {
    const rows = matrix.filter(row => row.os === os);
    assert(rows.every(row => row.workers > 0 && row.title === testSuites[row.suite].title));
    for (const row of rows) {
      const selected = selectTests(files, sources, {}, row.suite);
      const requiresBrowser = selected.some(file => sources[file].includes("helpers/browser") || /from ["']playwright["']/.test(sources[file]));
      assert.equal(row.browser, requiresBrowser, `${os}/${row.suite}: Chromium is available when required`);
    }
    const assigned = rows.flatMap(row => selectTests(files, sources, {}, row.suite));
    assert.deepEqual([...assigned].sort(), [...files].sort(), `${os}: no missing or duplicate test files`);
  }

  assert.equal(browserInstall?.if, "matrix.browser");
  assert.equal(browserInstall?.run, "npx playwright install chromium");
  assert.equal(
    steps.some((step) => step.run?.includes("playwright install --with-deps")),
    false
  );
  assert.equal(npmTest?.if, undefined);
  assert.equal(packageJson.scripts?.["test:ci"], "node scripts/run-tests.mjs --test-concurrency=2");
  assert.match(npmTest?.run ?? "", /--suite=\$\{\{ matrix.suite \}\}/);
  assert.equal(steps.some(step => step.run === "npm run build"), false);
  assert.match(
    normalizedWindowsPackageSmoke,
    /names:\s*\n\s*- windows-ci-smoke\n\s*- Windows CI smoke/
  );
  assert.match(
    normalizedWindowsPackageSmoke,
    /\["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"\]/
  );
});
