import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("npm package preserves the memsphere first-use bootstrap contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files?: string[];
    scripts?: Record<string, string>;
  };

  assert.deepEqual(packageJson.files, [
    "dist",
    "scripts/backfill-run-memory-manifest.mjs",
    "scripts/relocate-example-models.mjs",
    "reserved-memory",
    "reserved-models",
    "LICENSE",
    "NOTICE",
    "ELK-LICENSE.md",
    "README.md",
    "README.en.md",
    "THIRD_PARTY_NOTICES.md"
  ]);
  assert.match(await readFile("ELK-LICENSE.md", "utf8"), /Eclipse Public License - v 2\.0/);
  assert.equal(packageJson.scripts?.prepack, "npm run build");
  assert.equal(packageJson.scripts?.prepublishOnly, "npm test");


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
