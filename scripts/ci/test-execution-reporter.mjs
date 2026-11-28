import { readFile } from "node:fs/promises";

export default async function* testExecutionReporter(source) {
  let executed = 0;
  let failedEvents = 0;
  let summary;
  for await (const { type, data } of source) {
    // Node can emit a passing file wrapper without running a single test.
    if (type === "test:pass" && data.details?.type === "test" && Number.isInteger(data.line)
      && !data.skip && !data.todo) executed++;
    // Node 22 can report a late suite or root hook failure with summary.failed=0.
    if (type === "test:fail" && !data.skip && !data.todo) failedEvents++;
    if (type === "test:summary" && !data.file) summary = data.counts;
  }
  if (summary) yield JSON.stringify({ executed, failedEvents, ...summary }) + "\n";
}

const count = value => Number.isSafeInteger(value) && value >= 0;
export function interpretTestExecution(raw, { code, signal }) {
  let counts;
  try { counts = JSON.parse(raw); } catch { /* Missing or truncated report. */ }
  const valid = counts && ["executed", "failedEvents", "tests", "passed", "failed", "cancelled", "skipped", "todo"]
    .every(field => count(counts[field])) && counts.executed <= counts.passed;
  const status = signal ? "cancelled"
    : (valid && (counts.failed > 0 || (counts.failedEvents > 0 && counts.cancelled === 0))) ? "failed"
    : (valid && counts.cancelled > 0) ? "cancelled"
    : code !== 0 ? "failed"
    : !valid || counts.executed === 0 ? "incomplete" : "passed";
  return {
    status,
    ...(valid ? { counts } : { reason: raw ? "invalid_execution_report" : "missing_execution_report" })
  };
}

export async function readTestExecutionReport(path, result) {
  const raw = await readFile(path, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  return interpretTestExecution(raw, result);
}
