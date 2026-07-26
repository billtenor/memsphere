import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("npm package preserves the memsphere first-use bootstrap contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files?: string[];
    scripts?: Record<string, string>;
  };
  const readme = await readFile("README.md", "utf8");

  assert.deepEqual(packageJson.files, [
    "dist",
    "reserved-memory",
    "LICENSE",
    "NOTICE",
    "README.md",
    "THIRD_PARTY_NOTICES.md"
  ]);
  assert.equal(packageJson.scripts?.prepack, "npm run build");
  assert.equal(packageJson.scripts?.prepublishOnly, "npm test");

  for (const instruction of [
    "npm install -g memsphere",
    "memsphere skill init --global",
    "memsphere init",
    "memsphere 教学流程-第一章"
  ]) {
    assert.match(readme, new RegExp(instruction));
  }
});
