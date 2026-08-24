import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("npm package preserves the memsphere first-use bootstrap contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files?: string[];
    scripts?: Record<string, string>;
  };
  const readmeEn = await readFile("README.md", "utf8");
  const readmeZhCn = await readFile("README.zh-CN.md", "utf8");

  assert.deepEqual(packageJson.files, [
    "dist",
    "reserved-memory",
    "LICENSE",
    "NOTICE",
    "README.md",
    "README.zh-CN.md",
    "THIRD_PARTY_NOTICES.md"
  ]);
  assert.equal(packageJson.scripts?.prepack, "npm run build");
  assert.equal(packageJson.scripts?.prepublishOnly, "npm test");

  for (const instruction of [
    "npm install -g memsphere",
    "memsphere skill init --global",
    "memsphere project create my-project --bind",
    "memsphere-tutorial-chapter-01"
  ]) {
    assert.match(readmeEn, new RegExp(instruction));
  }

  assert.match(readmeEn, /\[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(readmeZhCn, /\[English\]\(README\.md\)/);
  assert.match(readmeZhCn, /memsphere 教学流程-第一章/);
});
