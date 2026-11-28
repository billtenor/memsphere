import { resolve } from "node:path";
import { ciPlatform, jobKey } from "./changed-test-plan.mjs";
import { runTestFiles } from "./run-tests.mjs";
import { readTestExecutionReport } from "./test-execution-reporter.mjs";

const reporter = new URL("./test-execution-reporter.mjs", import.meta.url).href;

export async function runChangedTestJob({ root, base, candidate, fileCount }, job, build) {
  const actualPlatform = ciPlatform(process.platform);
  if (actualPlatform !== job.os) throw new Error(`Job requires ${job.os}, current platform is ${actualPlatform}`);
  const testDirectory = resolve(root, "test");
  const execution = await runTestFiles({
    cwd: root, testDirectory, fileCount, suite: job.suite, title: job.title, build,
    selected: job.files.map(({ path }) => resolve(testDirectory, path)),
    executionProof: { reporter, read: readTestExecutionReport }
  });
  const status = execution.cancelled ? "cancelled"
    : execution.results.some(result => result.execution.status === "failed") ? "failed"
    : execution.results.some(result => result.execution.status === "cancelled") ? "cancelled"
    : execution.exitCode !== 0 ? "failed"
    : execution.results.length !== job.files.length ||
      execution.results.some(result => result.execution.status !== "passed") ? "incomplete" : "passed";
  return { base, candidate, os: job.os, suite: job.suite, actualPlatform, status,
    exitCode: execution.exitCode, files: execution.results };
}

export function summarizeChangedTests(plan, reports) {
  const issues = [];
  const receiptByJob = new Map();
  const expected = new Map(plan.jobs.map(job => [jobKey(job), job]));
  for (const report of reports) {
    if (!report || typeof report !== "object") {
      issues.push({ reason: "invalid_report" });
      continue;
    }
    const key = jobKey(report);
    if (!expected.has(key)) issues.push({ job: key, reason: "unexpected_job" });
    else if (receiptByJob.has(key)) issues.push({ job: key, reason: "duplicate_job" });
    else receiptByJob.set(key, report);
  }
  for (const [key, job] of expected) {
    const report = receiptByJob.get(key);
    if (!report) {
      issues.push({ job: key, reason: "missing_job" });
      continue;
    }
    if (report.base !== plan.base || report.candidate !== plan.candidate) {
      issues.push({ job: key, reason: "wrong_commit" });
    }
    if (report.actualPlatform !== job.os) issues.push({ job: key, reason: "wrong_platform" });
    if (report.status !== "passed" || report.exitCode !== 0) {
      issues.push({ job: key, reason: "job_not_passed", status: report.status, exitCode: report.exitCode });
    }
    const expectedFiles = new Set(job.files.map(({ path }) => path));
    const seen = new Set();
    for (const file of Array.isArray(report.files) ? report.files : []) {
      if (!file || !expectedFiles.has(file.file) || seen.has(file.file)) {
        issues.push({ job: key, file: file?.file, reason: "unexpected_or_duplicate_file" });
        continue;
      }
      seen.add(file.file);
      if (file.exitCode !== 0 || file.signal !== null || file.execution?.status !== "passed"
        || !Number.isSafeInteger(file.execution.counts?.executed) || file.execution.counts.executed < 1
        || file.execution.counts.failed !== 0 || file.execution.counts.failedEvents !== 0
        || file.execution.counts.cancelled !== 0) {
        issues.push({ job: key, file: file.file, reason: "file_not_passed", status: file.execution?.status });
      }
    }
    for (const file of expectedFiles) {
      if (!seen.has(file)) issues.push({ job: key, file, reason: "missing_file" });
    }
  }
  const status = reports.some(report => report?.status === "failed") ? "failed"
    : reports.some(report => report?.status === "cancelled") ? "cancelled"
    : issues.length || plan.pending.length ? "incomplete"
    : plan.jobs.length ? "passed" : "empty";
  return { base: plan.base, candidate: plan.candidate, status, pending: plan.pending, issues,
    jobs: reports,
    ...(issues.length ? { next: "Check the candidate and run or retrieve the missing verification." } : {}) };
}
