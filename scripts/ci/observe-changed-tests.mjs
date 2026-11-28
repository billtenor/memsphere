import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createChangedTestPlan, jobKey, readCandidate } from "./changed-test-plan.mjs";
import { runChangedTestJob, summarizeChangedTests } from "./changed-test-results.mjs";

const env = process.env;
const expected = { candidate: env.OBSERVATION_CANDIDATE, head: env.OBSERVATION_HEAD };
const mode = process.argv[2];
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
};
const print = value => console.log(JSON.stringify(value, null, 2));

try {
  if (mode === "plan" || mode === "run") {
    const context = await readCandidate(process.cwd(), env.OBSERVATION_BASE, expected);
    const plan = createChangedTestPlan(context);
    if (mode === "plan") {
      await writeJson(env.OBSERVATION_PLAN_PATH, plan);
      const include = plan.jobs.map(({ os, suite, layer, timeoutMinutes, browser }) =>
        ({ os, suite, layer, timeoutMinutes, browser }));
      await writeFile(env.GITHUB_OUTPUT, `has_jobs=${!!include.length}\nmatrix=${JSON.stringify({ include })}\n`, { flag: "a" });
      print({ phase: "plan", ...plan });
    } else {
      const fixedPlan = await readJson(env.OBSERVATION_PLAN_PATH);
      if (JSON.stringify(fixedPlan) !== JSON.stringify(plan)) throw new Error("Plan differs from the fixed candidate");
      const key = jobKey({ os: env.OBSERVATION_OS, suite: env.OBSERVATION_SUITE });
      const job = plan.jobs.find(row => jobKey(row) === key);
      if (!job) throw new Error(`No planned job for ${key}`);
      const report = await runChangedTestJob({ ...context, fileCount: context.files.length }, job);
      await writeJson(env.OBSERVATION_RESULT_PATH, report);
      print(report);
      process.exitCode = report.status === "passed" ? 0 : report.exitCode || (report.status === "failed" ? 1 : 2);
    }
  } else if (mode === "summarize") {
    const plan = await readJson(env.OBSERVATION_PLAN_PATH);
    const directory = env.OBSERVATION_RESULT_DIRECTORY;
    const paths = await readdir(directory, { recursive: true }).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return [];
    });
    const reports = await Promise.all(paths.filter(path => path.endsWith(".json"))
      .map(path => readJson(join(directory, path)).catch(() => null)));
    const result = summarizeChangedTests(plan, reports);
    const expectedJobStatus = plan.jobs.length ? "success" : "skipped";
    const jobStatus = env.OBSERVATION_JOBS_STATUS;
    if (jobStatus !== expectedJobStatus) {
      result.issues.push({ reason: "matrix_not_complete", status: jobStatus });
      if (["passed", "empty"].includes(result.status)) result.status = "incomplete";
    }
    print({ phase: "result", ...result });
    if (env.GITHUB_STEP_SUMMARY) {
      await writeFile(env.GITHUB_STEP_SUMMARY, `### Changed Full-only observation: ${result.status}\n\n`
        + `Base \`${result.base}\`, candidate \`${result.candidate}\`\n\n`
        + "See the plan, per-job receipts and log for reasons and missing evidence.\n", { flag: "a" });
    }
    process.exitCode = ["passed", "empty"].includes(result.status) ? 0 : 1;
  } else {
    throw new Error("Use plan, run or summarize");
  }
} catch (error) {
  print({ phase: mode, status: "unavailable", reason: error.message });
  process.exitCode = 2;
}
