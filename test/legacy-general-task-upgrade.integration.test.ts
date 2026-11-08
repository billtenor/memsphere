import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { embeddedFixture, fixture } from "./helpers/project-upgrade.js";
import { systemMemoryRemovalDigest } from "../src/reserved/store.js";
import { readSystemMemoryUpgradeTargets } from "../src/commands/project.js";

type Historical = { path: string; reference: string; sha256: string; source: string };
const root = join(process.cwd(), "test/fixtures/legacy-general-task");
const historical = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Historical[];
// Version bodies share the same publication path once their identity/digest is accepted.
const upgradeRepresentatives = [...new Map(historical.map(entry => [`${entry.path}:${entry.reference}`, entry])).values()];

test("removal planning accepts every issued historical body with its exact identity and digest", async () => {
  const f = await fixture();
  const previousHome = process.env.MEMSPHERE_HOME;
  const previousDirectory = process.cwd();
  try {
    const { memoryRoot } = await embeddedFixture(f);
    process.env.MEMSPHERE_HOME = f.home;
    process.chdir(f.workspace);
    for (const entry of historical) {
      for (const path of new Set(historical.map(row => row.path))) await rm(join(memoryRoot, path), { force: true });
      const content = await readFile(join(root, `${entry.sha256}.yaml`));
      assert.equal(systemMemoryRemovalDigest(content), entry.sha256);
      await writeFile(join(memoryRoot, entry.path), content);
      const plan = await readSystemMemoryUpgradeTargets("embedded");
      const deletes = plan.targets.filter(target => target.operation === "delete");
      assert.deepEqual(deletes, [{ reference: entry.reference, path: entry.path, operation: "delete", approvedContentDigest: entry.sha256 }]);
      assert.deepEqual(await readFile(join(memoryRoot, entry.path)), content, "planning is read-only");
    }
  } finally {
    process.chdir(previousDirectory);
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = previousHome;
    await f.cleanup();
  }
});
