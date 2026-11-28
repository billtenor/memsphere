import assert from "node:assert/strict";
import test from "node:test";
import { createChangedTestPlan, readChanges } from "../../scripts/ci/changed-test-plan.mjs";
import { summarizeChangedTests } from "../../scripts/ci/changed-test-results.mjs";
import testExecutionReporter, { interpretTestExecution } from "../../scripts/ci/test-execution-reporter.mjs";

const reviewerConsumers = [
  "changeset-external.system.test.ts",
  "list-pagination-cli.system.test.ts",
  "platform/memory-publication/memory-change-show-cli.system.test.ts",
  "platform/memory-publication/memory-checkpoint-corruption.system.test.ts",
  "platform/memory-publication/memory-checkpoint-evidence.system.test.ts",
  "platform/memory-publication/memory-publication-race-cli.system.test.ts",
  "reviewer-export-race.system.test.ts",
  "reviewer-session-integration.system.test.ts"
];
const platformNames = ["ubuntu-24.04", "macos-latest", "windows-latest"];
const files = [
  "unit.unit.test.ts", "plain.integration.test.ts", "native.integration.test.ts",
  "single.system.test.ts", "journey.e2e.test.ts", "packaged-cli/windows-package-smoke.system.test.ts",
  "app-settings-browser.system.test.ts", "app-settings-http.system.test.ts", "app-settings.integration.test.ts",
  "platform/cli/app-settings.integration.test.ts",
  ...reviewerConsumers
];
const sources = Object.fromEntries(files.map(file => [file,
  file === "native.integration.test.ts" ? "// @integration-platform: native" : ""]));
const base = "a".repeat(40), candidate = "b".repeat(40);
const plan = (changes: {status: string; path: string; source?: string}[]) =>
  createChangedTestPlan({ base, candidate, files, sources, changes });
const changed = (path: string) => ({ status: "M", path });

test("changed Full-only files follow the actual platform and suite split", () => {
  const result = plan(["single.system.test.ts", "journey.e2e.test.ts", "plain.integration.test.ts",
    "native.integration.test.ts"].map(file => changed("test/" + file)));
  assert.deepEqual(result.jobs.map(job => [job.os, job.layer, job.files.map(file => file.path)]), [
    ["ubuntu-24.04", "system", ["single.system.test.ts"]],
    ["ubuntu-24.04", "e2e", ["journey.e2e.test.ts"]],
    ["macos-latest", "system", ["single.system.test.ts"]],
    ["macos-latest", "e2e", ["journey.e2e.test.ts"]],
    ["macos-latest", "integration", ["plain.integration.test.ts"]],
    ["windows-latest", "system", ["single.system.test.ts"]],
    ["windows-latest", "e2e", ["journey.e2e.test.ts"]],
    ["windows-latest", "integration", ["plain.integration.test.ts"]]
  ]);
  assert.ok(result.jobs.every(job => job.timeoutMinutes === 30));
  assert.deepEqual(result.excluded.map(entry => entry.path), ["test/native.integration.test.ts"]);
});

test("the reviewer-session helper selects all eight direct and indirect consumers", () => {
  const result = plan([changed("test/helpers/reviewer-session.ts")]);
  assert.deepEqual(result.jobs.map(job => job.os), platformNames);
  for (const job of result.jobs) {
    assert.equal(job.suite, "system");
    assert.deepEqual(job.files.map(file => file.path).sort(), reviewerConsumers);
    assert.ok(job.files.every(file => file.triggers[0].path === "test/helpers/reviewer-session.ts"));
  }
  assert.equal(result.pending.length, 0);
  assert.equal(plan([changed("test/helpers/change-show.ts")]).jobs[0].files.length, 5);
});

test("the App settings helper only schedules the Full-only platforms of its consumers", () => {
  const result = plan([changed("test/helpers/app-settings.ts")]);
  assert.deepEqual(result.jobs.filter(job => job.layer === "system").map(job => [job.os, job.files.length]),
    platformNames.map(os => [os, 2]));
  assert.deepEqual(result.jobs.filter(job => job.layer === "integration").map(job => [job.os, job.files.map(file => file.path)]), [
    ["macos-latest", ["app-settings.integration.test.ts"]],
    ["windows-latest", ["app-settings.integration.test.ts"]]
  ]);
  assert.deepEqual(result.excluded.map(entry => entry.path), ["test/platform/cli/app-settings.integration.test.ts"]);
});

test("packaged-only, deletion, and unknown impacts are distinct from an empty plan", () => {
  const packaged = plan([changed("test/packaged-cli/windows-shell-smoke.cmd")]);
  assert.equal(packaged.status, "needs_evidence");
  assert.equal(packaged.jobs.length, 0);
  assert.match(packaged.pending[0].next, /Windows packaged CLI shells.*PowerShell 5.1.*Git Bash/);
  assert.equal(summarizeChangedTests(packaged, []).status, "incomplete");
  const unknown = plan([
    { status: "D", path: "test/old.system.test.ts" }, changed("scripts/ci/run-tests.mjs"),
    changed("test/helpers/unlisted.ts")
  ]);
  assert.equal(unknown.status, "needs_evidence");
  assert.deepEqual(unknown.pending.slice(0, 3).map(entry => entry.reason), [
    "Deleted path requires coverage review.", "Runner or repository-wide configuration may affect multiple suites.",
    "No known Full-only target mapping."
  ]);
  const missingFiles = files.filter(file => file !== "app-settings-browser.system.test.ts");
  const missing = createChangedTestPlan({ base, candidate, files: missingFiles, sources,
    changes: [changed("test/helpers/app-settings.ts")] });
  assert.ok(missing.pending.some(entry => entry.reason.startsWith("Mapped consumer is missing")));
  const empty = plan([changed("README.md"), changed("test/unit.unit.test.ts")]);
  assert.equal(empty.status, "empty");
  assert.equal(summarizeChangedTests(empty, []).status, "empty");
});

test("NUL-delimited Git moves choose the destination and keep the trigger source", () => {
  const moves = readChanges("R100\0test/old\nfile.system.test.ts\0test/single.system.test.ts\0");
  assert.deepEqual(moves, [{ status: "R100", path: "test/single.system.test.ts", source: "test/old\nfile.system.test.ts" }]);
  const result = plan(moves);
  assert.equal(result.status, "planned");
  assert.deepEqual(result.jobs[0].files.map(file => file.path), ["single.system.test.ts"]);
  assert.equal(result.jobs[0].files[0].triggers[0].source, "test/old\nfile.system.test.ts");
  assert.throws(() => readChanges("R100\0source\0"), /Incomplete/);
});

const counts = {executed: 1, failedEvents: 0, tests: 2, passed: 1, failed: 0, cancelled: 0, skipped: 1, todo: 0};
test("execution evidence distinguishes synthetic passes, bad reports and a failed hook", async () => {
  const clean = { code: 0, signal: null };
  assert.equal(interpretTestExecution(JSON.stringify(counts), clean).status, "passed");
  assert.equal(interpretTestExecution(JSON.stringify({...counts, executed: 0}), clean).status, "incomplete");
  for (const raw of ["", '{"tests":1', "{}", JSON.stringify({...counts, executed: 2})]) {
    assert.equal(interpretTestExecution(raw, clean).status, "incomplete");
  }
  assert.equal(interpretTestExecution(JSON.stringify({...counts, failed: 1}), {code: 1, signal: null}).status, "failed");
  assert.equal(interpretTestExecution(JSON.stringify({...counts, failedEvents: 1}), clean).status, "failed");
  assert.equal(interpretTestExecution("", {code: 1, signal: "SIGTERM"}).status, "cancelled");

  const pass = { type: "test:pass", data: { line: 10, details: { type: "test" }, nesting: 1 } };
  const events = async function* () {
    yield { type: "test:pass", data: { details: { type: "test" } } };
    yield { ...pass, data: { ...pass.data, skip: "platform" } };
    yield { ...pass, data: { ...pass.data, todo: true } };
    yield { ...pass, data: { ...pass.data, details: { type: "suite" } } };
    yield pass;
    yield { type: "test:summary", data: { counts: { tests: 2, passed: 1, failed: 0, cancelled: 0, skipped: 1, todo: 0 } } };
  };
  const records = [];
  for await (const record of testExecutionReporter(events())) records.push(JSON.parse(record));
  assert.deepEqual(records, [counts]);
  const noSummary = async function* () { yield pass; };
  for await (const record of testExecutionReporter(noSummary())) assert.fail(record);
});

test("aggregate requires one genuine result for each candidate, platform, suite and file", () => {
  const planned = plan([changed("test/single.system.test.ts")]);
  const reports = planned.jobs.map(({ os, suite }) => ({
    base, candidate, os, suite, actualPlatform: os, status: "passed", exitCode: 0,
    files: [{ file: "single.system.test.ts", exitCode: 0, signal: null, execution: {status: "passed", counts} }]
  }));
  assert.equal(summarizeChangedTests(planned, reports).status, "passed");
  const incompatible = [
    [{...reports[0], base: candidate}, "wrong_commit"],
    [{...reports[0], candidate: base}, "wrong_commit"],
    [{...reports[0], actualPlatform: "windows-latest"}, "wrong_platform"],
    [{...reports[0], suite: "e2e"}, "unexpected_job"],
    [{...reports[0], files: []}, "missing_file"],
    [{...reports[0], files: [...reports[0].files, ...reports[0].files]}, "unexpected_or_duplicate_file"],
    [{...reports[0], status: "skipped"}, "job_not_passed"],
    [{...reports[0], files: [{...reports[0].files[0], execution: {status: "incomplete", counts}}]}, "file_not_passed"]
  ] as const;
  for (const [bad, reason] of incompatible) {
    const result = summarizeChangedTests(planned, [bad, ...reports.slice(1)]);
    assert.equal(result.status, "incomplete");
    assert.ok(result.issues.some(item => item.reason === reason), reason);
  }
  assert.equal(summarizeChangedTests(planned, reports.slice(1)).issues[0].reason, "missing_job");
  assert.equal(summarizeChangedTests(planned, [reports[0], ...reports]).issues[0].reason, "duplicate_job");
  assert.equal(summarizeChangedTests(planned, [{...reports[0], status: "cancelled"}, ...reports.slice(1)]).status, "cancelled");
});
