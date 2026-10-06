import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import crossSpawn from "cross-spawn";

// Run after a successful build; packing must not race by rebuilding dist.
const root = mkdtempSync(join(tmpdir(), "memsphere-package-smoke-"));
const install = join(root, "install");
function run(command, args) {
  const result = crossSpawn.sync(command, args, { encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
try {
  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root]));
  assert.equal(packed.length, 1);
  run("npm", ["install", "--prefix", install, "--no-audit", "--no-fund", join(root, packed[0].filename)]);
  const cli = join(install, "node_modules", "memsphere", "dist", "cli.js");
  process.stdout.write(run(process.execPath, [resolve("scripts/model-data-smoke.mjs"), "--cli", cli]));
  console.log(`Installed-package native lock and model/data CLI smoke passed on ${process.platform}, Node ${process.versions.node}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
