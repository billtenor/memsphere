// Opt-in investigation only; regular CI discovery and coverage are unchanged.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { availableParallelism, totalmem, freemem } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const exec = promisify(execFile);
const mode = process.argv[2];
if (!["isolated", "parallel"].includes(mode)) throw new Error("Expected isolated or parallel");
await mkdir(process.env.MEMSPHERE_TEST_PROFILE_DIR, { recursive: true });
console.log(JSON.stringify({ mode, platform: process.platform, cpu: availableParallelism(), memory: totalmem(), freeMemory: freemem() }));
for (let sample = 1; sample <= 3; sample++) {
  const start = performance.now();
  await exec(process.execPath, [resolve("dist/cli.js"), "--version"]);
  console.log(JSON.stringify({ startupControl: "CLI --version", sample, milliseconds: Math.round(performance.now() - start) }));
}
const files = ["test/platform/cli/data-command.system.test.ts", "test/procedure-graph-cli.system.test.ts"];
const args = ["--import", "tsx", "--test", `--test-concurrency=${mode === "isolated" ? 1 : 4}`];
if (mode === "isolated") args.push("--test-name-pattern=external absolute directories|CLI rewind preview is read only");
else files.push("test/models-builtin-view-browser.system.test.ts", "test/artifact-review-browser.system.test.ts");
const child = spawn(process.execPath, [...args, ...files], { env: process.env, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
