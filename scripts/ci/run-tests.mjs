import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, selectTests, testSuites } from "./test-plan.mjs";
import { terminateTestProcesses } from "./test-processes.mjs";

const testDirectory = fileURLToPath(new URL("../../test/", import.meta.url));
const files = (await discoverTestFiles(testDirectory)).map(name => resolve(testDirectory, name));
const testName = file => relative(testDirectory, file).split(sep).join("/");
const platformDurations = JSON.parse(await readFile(new URL("./test-durations.json", import.meta.url), "utf8"));
const durations = platformDurations[process.platform] ?? platformDurations.win32;
const nodeArguments = [];
let concurrency = 2;
let suite = "all";
let listOnly = false;
let resultsPath = process.env.CI_TEST_RESULTS;
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith("--test-concurrency=")) concurrency = Number(argument.split("=")[1]);
  else if (argument.startsWith("--suite=")) suite = argument.slice(8);
  else if (argument === "--list") listOnly = true;
  else if (argument.startsWith("--results=")) resultsPath = argument.slice(10);
  else nodeArguments.push(argument);
}
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer");
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(file, "utf8")])));
const selected = selectTests(files, sources, durations, suite);
const title = suite === "all" ? "All tests" : testSuites[suite].title;
if (listOnly) {
  console.log(JSON.stringify({ suite, title, files: selected }, null, 2));
  process.exit(0);
}

const started = performance.now();
const testHome = await mkdtemp(join(tmpdir(), "memsphere-test-home-"));
const results = [];
let next = 0;
let cancelled;
let termination;
const active = new Set();
const cancel = signal => {
  if (cancelled) return;
  cancelled = signal;
  console.error(`Cancelling tests (${signal}); reclaiming owned process trees.`);
  termination = terminateTestProcesses(active, signal).catch(error => {
    // A failed OS tree query must be reported, but must not leave the runner
    // waiting forever for its direct children to close their output pipes.
    for (const child of active) {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); }
      catch (killError) { if (killError.code !== "ESRCH") console.error(killError); }
    }
    throw error;
  });
  // Keep a rejection observed until the workers and final cleanup await it.
  void termination.catch(() => undefined);
};
const interrupt = () => cancel("SIGINT");
const terminate = () => cancel("SIGTERM");
const hangup = () => cancel("SIGHUP");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
process.on("SIGHUP", hangup);
try {
  console.log(`Running ${selected.length}/${files.length} files, suite ${title}, concurrency ${concurrency}`);
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (!cancelled && next < selected.length) {
      const file = selected[next++];
      console.log(`# Starting: ${testName(file)}`);
      const home = await mkdtemp(join(testHome, "file-"));
      if (cancelled) { await rm(home, { recursive: true, force: true }); break; }
      const fileStarted = performance.now();
      const result = await new Promise(resolveResult => {
        const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...nodeArguments, file], {
          env: { ...process.env, MEMSPHERE_HOME: home },
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"]
        });
        active.add(child);
        const output = [];
        child.stdout.on("data", data => output.push(data));
        child.stderr.on("data", data => output.push(data));
        child.on("error", error => output.push(Buffer.from(`${error.stack}\n`)));
        child.on("close", (code, signal) => {
          active.delete(child);
          resolveResult({ code: code ?? 1, signal, output: Buffer.concat(output).toString() });
        });
      });
      if (termination) await termination;
      const seconds = (performance.now() - fileStarted) / 1000;
      // Keep each file's TAP intact even when files execute concurrently.
      console.log(`\n# File: ${testName(file)} (${seconds.toFixed(2)}s)`);
      process.stdout.write(result.output);
      results.push({ file: testName(file), seconds, exitCode: result.code, signal: result.signal });
      await rm(home, { recursive: true, force: true });
    }
  }));
} finally {
  if (active.size && !cancelled) cancel("SIGTERM");
  if (termination) await termination;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  process.off("SIGHUP", hangup);
  await rm(testHome, { recursive: true, force: true });
  if (resultsPath) {
    const path = resolve(resultsPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ platform: process.platform, suite, title,
      seconds: (performance.now() - started) / 1000, planned: selected.map(testName), results }, null, 2) + "\n");
  }
}
const failures = results.filter(result => result.exitCode !== 0);
console.log(`\nFiles: ${results.length}; failed: ${failures.length}; elapsed: ${((performance.now() - started) / 1000).toFixed(2)}s`);
process.exitCode = cancelled ? ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[cancelled]) : failures.length ? 1 : 0;
