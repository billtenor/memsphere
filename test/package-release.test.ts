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

test("release metadata uses the package version consistently", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  const packageLock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };
  const acpClient = await readFile("src/acp/client.ts", "utf8");
  const thirdPartyNotices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
  const moduleManifests = await Promise.all([
    "org.memsphere.memory",
    "org.memsphere.reference",
    "org.memsphere.run",
    "org.memsphere.settings"
  ].map(async (moduleId) => JSON.parse(
    await readFile(`modules/${moduleId}/module.json`, "utf8")
  ) as { version: string }));

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""]?.version, packageJson.version);
  for (const manifest of moduleManifests) assert.equal(manifest.version, packageJson.version);
  assert.match(acpClient, new RegExp(`clientInfo: \\{[^}]*version: "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(thirdPartyNotices, new RegExp(`for Memsphere ${packageJson.version.replaceAll(".", "\\.")}\\.`));
});
