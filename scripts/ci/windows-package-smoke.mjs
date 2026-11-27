import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, selectWindowsPackageSmokeTests } from "./test-plan.mjs";

if (process.platform !== "win32") throw new Error("windows-package-smoke must run on Windows");

const testDirectory = fileURLToPath(new URL("../../test/", import.meta.url));
const files = selectWindowsPackageSmokeTests(await discoverTestFiles(testDirectory));
if (files.length === 0) throw new Error("No Windows packaged CLI tests discovered");
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1",
  ...files.map(file => resolve(testDirectory, file))], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
