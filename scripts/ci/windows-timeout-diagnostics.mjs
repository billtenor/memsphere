// Opt-in investigation only; regular CI discovery and coverage are unchanged.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { availableParallelism, totalmem, freemem } from "node:os";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
const exec = promisify(execFile);
const mode = process.argv[2];
if (!["isolated", "parallel", "contended", "full-baseline"].includes(mode)) throw new Error("Unknown diagnostic mode");
await mkdir(process.env.MEMSPHERE_TEST_PROFILE_DIR, { recursive: true });
console.log(JSON.stringify({ mode, platform: process.platform, cpu: availableParallelism(), memory: totalmem(), freeMemory: freemem() }));
for (let sample = 1; sample <= 3; sample++) {
  const start = performance.now();
  await exec(process.execPath, [resolve("dist/cli.js"), "--version"]);
  console.log(JSON.stringify({ startupControl: "CLI --version", sample, milliseconds: Math.round(performance.now() - start) }));
}
const files = ["test/platform/cli/data-command.system.test.ts", "test/procedure-graph-cli.system.test.ts"];
if (mode === "full-baseline") {
  // Match the original runner and coverage. Disable profiling overhead; retain
  // opt-in lightweight step timestamps only.
  const env = { ...process.env }; delete env.MEMSPHERE_TEST_PROFILE_DIR;
  const child = spawn(process.execPath, ["scripts/ci/run-tests.mjs", "--suite=system", "--results=windows-full-system-trace.json"], { env, stdio: "inherit" });
  child.on("error", error => { console.error(error); process.exitCode = 1; });
  child.on("close", code => { process.exitCode = code ?? 1; });
} else if (mode === "contended") {
  const ready = await mkdtemp(resolve(tmpdir(), "memsphere-diagnostic-ready-"));
  const background = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=3",
    "test/models-builtin-view-browser.system.test.ts", "test/artifact-review-browser.system.test.ts", "test/view-responsive.system.test.ts"], {
    env: { ...process.env, MEMSPHERE_DIAGNOSTIC_READY_DIR: ready }, stdio: "inherit"
  });
  const backgroundDone = new Promise(resolve => background.on("close", code => resolve(code ?? 1)));
  const deadline = performance.now() + 60_000;
  while ((await readdir(ready)).length < 3) {
    if (performance.now() > deadline) { background.kill(); throw new Error("Browser workers did not become ready"); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log("Three real browser workers are ready; starting command controls and original target cases");
  for (let sample = 1; sample <= 3; sample++) {
    const start = performance.now();
    await exec(process.execPath, [resolve("dist/cli.js"), "--version"]);
    console.log(JSON.stringify({ startupControl: "CLI --version under load", sample, milliseconds: Math.round(performance.now() - start) }));
  }
  const foreground = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1",
    "--test-name-pattern=external absolute directories|CLI rewind preview is read only", ...files], { env: process.env, stdio: "inherit" });
  const foregroundDone = new Promise(resolve => foreground.on("close", code => resolve(code ?? 1)));
  const codes = await Promise.all([backgroundDone, foregroundDone]);
  process.exitCode = codes.some(code => code !== 0) ? 1 : 0;
} else {
const args = ["--import", "tsx", "--test", `--test-concurrency=${mode === "isolated" ? 1 : 4}`];
if (mode === "isolated") args.push("--test-name-pattern=external absolute directories|CLI rewind preview is read only");
else files.push("test/models-builtin-view-browser.system.test.ts", "test/artifact-review-browser.system.test.ts");
const child = spawn(process.execPath, [...args, ...files], { env: process.env, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
}
