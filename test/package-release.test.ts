import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("npm package preserves the memsphere first-use bootstrap contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files?: string[];
    scripts?: Record<string, string>;
  };
  const readmeZhCn = await readFile("README.md", "utf8");
  const readmeEn = await readFile("README.en.md", "utf8");

  assert.deepEqual(packageJson.files, [
    "dist",
    "reserved-memory",
    "LICENSE",
    "NOTICE",
    "README.md",
    "README.en.md",
    "THIRD_PARTY_NOTICES.md"
  ]);
  assert.equal(packageJson.scripts?.prepack, "npm run build");
  assert.equal(packageJson.scripts?.prepublishOnly, "npm test");

  for (const instruction of [
    "npm install -g memsphere",
    "memsphere skill init --global",
    "memsphere project create my-project --bind",
    "After setup succeeds, do not stop with a summary",
    "memsphere-tutorial-chapter-01"
  ]) {
    assert.match(readmeEn, new RegExp(instruction));
  }

  assert.match(readmeEn, /\[简体中文\]\(README\.md\)/);
  assert.match(readmeZhCn, /\[English\]\(README\.en\.md\)/);
  assert.match(readmeZhCn, /安装配置成功后不要停在总结/);
  assert.match(readmeZhCn, /memsphere 教学流程-第一章/);
});

test("npm package includes every Memory Market manifest source", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { files?: string[] };
  const manifest = JSON.parse(await readFile("reserved-memory/manifest.json", "utf8")) as {
    version: number;
    market_memory?: { install?: string[] };
  };
  assert(packageJson.files?.includes("reserved-memory"));
  assert.equal(manifest.version, 4);
  assert((manifest.market_memory?.install?.length ?? 0) > 0);
  await Promise.all((manifest.market_memory?.install ?? []).map(async (path) => {
    const source = await readFile(`reserved-memory/${path}`, "utf8");
    assert.match(source, /^!(concept|statement|schema|procedure)\n/);
  }));
});
