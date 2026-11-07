import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { AUTHORIZATION_MESSAGE, CONTEXT, HUMAN_INSTRUCTIONS, PROTECTED_FILES, failureDescription, failureLines, isProtected, protectedChanges } from "../../scripts/ci/ci-change-guard.mjs";

const changed = (filename: string, status = "modified", extra = {}) => ({ filename, status, ...extra });


// Protect CI policy, while preserving normal product implementation and test changes.
test("every protected CI file rejects changes while normal product files remain allowed", () => {
  for (const filename of [...PROTECTED_FILES, ".github/workflows/future.yml", "test/ci/future.test.ts", "scripts/ci/future-helper.mjs"]) {
    assert.deepEqual(protectedChanges([changed(filename)]), [filename], filename);
  }
  assert.deepEqual(protectedChanges([changed("src/cli.ts"), changed("test/run-store.test.ts"), changed("docs/usage.md")]), []);
});


test("added and deleted CI files and both directions of rename require Human authorization", () => {
  for (const status of ["added", "removed", "modified"]) {
    assert.deepEqual(protectedChanges([changed(".github/workflows/ci.yml", status)]), [".github/workflows/ci.yml"]);
  }
  assert.deepEqual(protectedChanges([changed("docs/old-ci.txt", "renamed", { previous_filename: ".github/workflows/ci.yml" })]), [".github/workflows/ci.yml"]);
  assert.deepEqual(protectedChanges([changed(".github/workflows/new.yml", "renamed", { previous_filename: "docs/new-ci.txt" })]), [".github/workflows/new.yml"]);
  assert.deepEqual(protectedChanges([changed(".github/workflows/new.yml", "renamed", { previous_filename: ".github/workflows/ci.yml" })]), [".github/workflows/ci.yml", ".github/workflows/new.yml"]);
  assert.throws(() => protectedChanges([changed("docs/new.txt", "renamed")]), /Invalid PR file path/);
});


test("failure output names every actual CI file and preserves the requested Human authorization message", () => {
  const paths = [".github/workflows/ci.yml", "scripts/ci/ci-plan.mjs"];
  const output = failureLines(paths).join("\n");
  for (const path of paths) assert(output.includes(JSON.stringify(path)));
  assert(output.includes(AUTHORIZATION_MESSAGE));
  assert(output.includes(HUMAN_INSTRUCTIONS));
  assert(!output.includes("xxx"));
  const one = failureDescription([paths[0]]);
  assert(one.includes(paths[0]));
  assert(one.includes(AUTHORIZATION_MESSAGE));
  assert(one.length <= 140);
});


test("long and command-shaped paths remain complete in safe logs with an explicit short-description fallback", () => {
  const paths = Array.from({ length: 120 }, (_, n) => `.github/workflows/${n}-${"a".repeat(80)}.yml`);
  paths.push(".github/workflows/a\n::error::forged.yml");
  const lines = failureLines(paths);
  for (const path of paths) assert(lines.some(line => line.includes(JSON.stringify(path))));
  assert(lines.every(line => !line.includes("\n") && !line.startsWith("::")));
  assert.match(failureDescription(paths), /121.*完整文件列表.*见日志/);
  assert(failureDescription(paths).length <= 140);
});


test("the trusted guard cannot run a PR's modified guard or dependencies", async () => {
  const workflow = parse(await readFile(".github/workflows/ci-change-guard.yml", "utf8"));
  assert.deepEqual(workflow.on.pull_request_target.branches, ["master"]);
  assert(workflow.on.pull_request_target.types.includes("synchronize"));
  assert(workflow.on.pull_request_target.types.includes("edited"));
  assert.deepEqual(workflow.on.push.branches, ["master"]);
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read", statuses: "write" });
  assert.deepEqual(workflow.concurrency, { group: "ci-change-guard-publisher", "cancel-in-progress": false });
  const job = workflow.jobs.guard;
  assert.notEqual(job.name, CONTEXT);
  assert.equal(job["timeout-minutes"], 5);
  const checkout = job.steps.find((s: any) => s.uses?.startsWith("actions/checkout@"));
  assert.deepEqual(checkout.with, { ref: "refs/heads/master", "persist-credentials": false });
  assert.deepEqual(job.steps.filter((s: any) => s.run).map((s: any) => s.run), ["node scripts/ci/ci-change-guard.mjs --publish"]);
  for (const script of ["scripts/ci/ci-change-guard.mjs", "scripts/ci/full-health.mjs"]) {
    const text = await readFile(script, "utf8");
    for (const match of text.matchAll(/from ["']([^"']+)["']/g)) assert(match[1].startsWith("node:") || match[1].startsWith("./"), "no installed package dependency");
  }
});


test("workflow CI entrypoints and CI-policy tests remain protected", async () => {
  const workflowSources = await Promise.all((await readdir(".github/workflows")).map(file => readFile(`.github/workflows/${file}`, "utf8")));
  for (const source of workflowSources) {
    for (const match of source.matchAll(/scripts\/ci\/[a-zA-Z0-9_/-]+\.(?:mjs|sh|json)/g)) assert(isProtected(match[0]), `Unprotected CI entrypoint ${match[0]}`);
  }
  for (const file of ["test/ci/ci-workflow.test.ts", "test/ci/test-plan.test.ts", "test/ci/full-health.test.ts", "test/ci/ci-change-guard.test.ts"]) assert(isProtected(file));
});


test("product builds, dependencies and compiler configuration do not require CI-policy authorization", () => {
  const files = [
    "scripts/check-reserved-models.mjs", "scripts/build-view-assets.mjs",
    "scripts/build-example-view-package.mjs", "scripts/build-example-app.mjs",
    "scripts/future-product-build.mjs", "test/future-product.test.ts",
    "package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc", ".nvmrc",
    "tsconfig.json", "tsconfig.modules.json"
  ];
  for (const filename of files) assert.equal(isProtected(filename), false, filename);
  assert.deepEqual(protectedChanges(files.map(filename => changed(filename))), []);
});


test("security policy remains protected independently of CI directories", () => {
  assert.deepEqual(PROTECTED_FILES, [
    "scripts/security-check.sh", "scripts/security-setup.sh",
    ".gitleaks-privacy.toml", ".gitleaksignore"
  ]);
  for (const filename of PROTECTED_FILES) {
    assert.deepEqual(protectedChanges([changed(filename)]), [filename]);
  }
});
