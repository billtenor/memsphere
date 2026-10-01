import { readdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = new URL("../test/", import.meta.url);
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => fileURLToPath(new URL(name, testDirectory)));
const testRunnerArguments = process.argv.slice(2);

const testHome = mkdtempSync(join(tmpdir(), "memsphere-test-home-"));
let result;
try {
  result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testRunnerArguments, ...testFiles], {
    stdio: "inherit",
    env: { ...process.env, MEMSPHERE_HOME: testHome }
  });
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
