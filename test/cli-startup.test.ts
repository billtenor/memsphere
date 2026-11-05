import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("CLI output remains usable with a warm, disabled or unavailable compile cache", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-cli-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blocker = join(directory, "file");
  await writeFile(blocker, "not a cache directory");
  const enabled = { ...process.env, NODE_COMPILE_CACHE: join(directory, "cache") };
  delete enabled.NODE_DISABLE_COMPILE_CACHE;
  const first = await exec(process.execPath, [cli, "--version"], { env: enabled });
  assert.match(first.stdout, /^\d+\.\d+\.\d+.*\n$/);
  assert.equal(first.stderr, "");
  for (const env of [enabled, { ...enabled, NODE_DISABLE_COMPILE_CACHE: "1" }, { ...enabled, NODE_COMPILE_CACHE: blocker }]) {
    const result = await exec(process.execPath, [cli, "--version"], { env });
    assert.equal(result.stdout, first.stdout);
    assert.equal(result.stderr, "");
  }
});
