import { readdir, readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectTests, testSuites } from "./test-plan.mjs";

const testDirectory = new URL("../test/", import.meta.url);
const files = (await readdir(testDirectory)).filter(name => name.endsWith(".test.ts"))
  .sort().map(name => fileURLToPath(new URL(name, testDirectory)));
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
try {
  console.log(`Running ${selected.length}/${files.length} files, suite ${title}, concurrency ${concurrency}`);
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const file = selected[next++];
      console.log(`# Starting: ${basename(file)}`);
      const home = await mkdtemp(join(testHome, "file-"));
      const fileStarted = performance.now();
      const result = await new Promise(resolveResult => {
        const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...nodeArguments, file], {
          env: { ...process.env, MEMSPHERE_HOME: home },
          stdio: ["ignore", "pipe", "pipe"]
        });
        const output = [];
        child.stdout.on("data", data => output.push(data));
        child.stderr.on("data", data => output.push(data));
        child.on("error", error => output.push(Buffer.from(`${error.stack}\n`)));
        child.on("close", (code, signal) => resolveResult({ code: code ?? 1, signal, output: Buffer.concat(output).toString() }));
      });
      const seconds = (performance.now() - fileStarted) / 1000;
      // Keep each file's TAP intact even when files execute concurrently.
      console.log(`\n# File: ${basename(file)} (${seconds.toFixed(2)}s)`);
      process.stdout.write(result.output);
      results.push({ file: basename(file), seconds, exitCode: result.code, signal: result.signal });
      await rm(home, { recursive: true, force: true });
    }
  }));
} finally {
  await rm(testHome, { recursive: true, force: true });
  if (resultsPath) {
    const path = resolve(resultsPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ platform: process.platform, suite, title,
      seconds: (performance.now() - started) / 1000, planned: selected.map(file => basename(file)), results }, null, 2) + "\n");
  }
}
const failures = results.filter(result => result.exitCode !== 0);
console.log(`\nFiles: ${results.length}; failed: ${failures.length}; elapsed: ${((performance.now() - started) / 1000).toFixed(2)}s`);
process.exitCode = failures.length ? 1 : 0;
