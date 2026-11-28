import { parseArgs } from "node:util";
import { ciPlatform, createChangedTestPlan, readCandidate } from "./changed-test-plan.mjs";
import { runChangedTestJob, summarizeChangedTests } from "./changed-test-results.mjs";

const print = value => console.log(JSON.stringify(value, null, 2));
try {
  const { values: { base, "dry-run": dryRun } } = parseArgs({
    options: { base: { type: "string" }, "dry-run": { type: "boolean" } }
  });
  const context = await readCandidate(process.cwd(), base);
  const plan = createChangedTestPlan(context);
  print({ phase: "plan", dryRun: !!dryRun, ...plan });
  if (dryRun) {
    process.exitCode = plan.pending.length ? 2 : 0;
  } else {
    const platform = ciPlatform(process.platform);
    if (!platform) throw new Error(`Unsupported test platform: ${process.platform}`);
    const reports = [];
    const jobs = plan.jobs.filter(job => job.os === platform);
    const npm = process.env.npm_execpath;
    if (jobs.length && !npm) throw new Error("Run selected tests using npm run test:changed");
    for (const [index, job] of jobs.entries()) {
      const result = await runChangedTestJob({ ...context, fileCount: context.files.length }, job,
        index === 0 ? [npm, "run", "build"] : undefined);
      reports.push(result);
      if (result.status === "cancelled") break;
    }
    const result = summarizeChangedTests(plan, reports);
    print({ phase: "result", platform, ...result });
    const interrupted = reports.find(report => report.status === "cancelled" && report.exitCode >= 128);
    process.exitCode = interrupted?.exitCode ?? (result.status === "failed" ? 1
      : ["passed", "empty"].includes(result.status) ? 0 : 2);
  }
} catch (error) {
  print({ phase: "result", status: "unavailable", reason: error.message });
  process.exitCode = 2;
}
