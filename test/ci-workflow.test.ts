import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

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
  const npmTest = steps.find((step) => step.run === "npm run test:ci");

  assert.equal(
    workflow.concurrency?.group,
    "ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"
  );
  assert.equal(workflow.concurrency?.["cancel-in-progress"], true);
  assert.equal(testJob?.["timeout-minutes"], 30);
  assert.deepEqual(testJob?.strategy?.matrix?.os, [
    "ubuntu-latest",
    "macos-latest",
    "windows-latest"
  ]);

  assert.equal(browserInstall?.if, undefined);
  assert.equal(browserInstall?.run, "npx playwright install chromium");
  assert.equal(
    steps.some((step) => step.run?.includes("playwright install --with-deps")),
    false
  );
  assert.equal(npmTest?.if, undefined);
  assert.equal(packageJson.scripts?.["test:ci"], "node scripts/run-tests.mjs --test-concurrency=1");
  assert.match(
    normalizedWindowsPackageSmoke,
    /names:\s*\n\s*- windows-ci-smoke\n\s*- Windows CI smoke/
  );
  assert.match(
    normalizedWindowsPackageSmoke,
    /\["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"\]/
  );
});
