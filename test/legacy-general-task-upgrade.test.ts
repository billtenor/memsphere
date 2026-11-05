import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function seedManaged(f: Awaited<ReturnType<typeof fixture>>, name: string, entry: Historical, content: Buffer) {
  const project = f.create(name);
  const memory = join(project, "memory");
  await writeFile(join(memory, entry.path), content);
  f.git(["add", "."], memory);
  f.git(["commit", "-m", "Legacy general task"], memory);
  const configPath = join(project, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = f.git(["rev-parse", "HEAD"], memory);
  await writeFile(configPath, JSON.stringify(config));
  return { project, memory };
}

test("Managed upgrade publishes deletion for each historical identity/path", async () => {
  const f = await fixture();
  try {
    for (const [index, entry] of upgradeRepresentatives.entries()) {
      const content = await readFile(join(root, `${entry.sha256}.yaml`));
      assert.equal(systemMemoryRemovalDigest(content), entry.sha256);
      const name = `legacy-${index}`;
      const { project, memory } = await seedManaged(f, name, entry, content);
      const { result, value } = f.upgrade(name);
      assert.equal(result.status, 0, JSON.stringify(value));
      assert.equal(value.memory.deleted, 1);
      assert.equal(value.memory.changeSet.validation, "passed");
      const change = JSON.parse(await readFile(join(project, "changes", value.memory.changeSet.id, "change.json"), "utf8"));
      assert.equal(change.system_upgrade.targets.find((target: { operation: string }) => target.operation === "delete").approvedContentDigest, entry.sha256);
      assert(!((await readdir(join(memory, "procedures"))).includes(entry.path.split("/").at(-1)!)));
    }
  } finally { await f.cleanup(); }
});

test("Managed upgrade preserves a same-path customized Procedure and accepts CRLF stock", async () => {
  const f = await fixture();
  try {
    const entry = historical.find(row => row.reference === "procedures/memsphere-general-task-execution")!;
    const original = await readFile(join(root, `${entry.sha256}.yaml`), "utf8");
    const customName = "customized";
    const { project, memory } = await seedManaged(f, customName, entry, Buffer.from(`${original}\n# user customization\n`));
    const changesBefore = await readdir(join(project, "changes"));
    const conflict = f.upgrade(customName);
    assert.equal(conflict.result.status, 1);
    assert.match(conflict.value.failure.message, /removal identity or content conflict/);
    assert.match(await readFile(join(memory, entry.path), "utf8"), /user customization/);
    assert.deepEqual(await readdir(join(project, "changes")), changesBefore);

    const crlfName = "crlf-original";
    await seedManaged(f, crlfName, entry, Buffer.from(original.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")));
    const upgraded = f.upgrade(crlfName);
    assert.equal(upgraded.result.status, 0, JSON.stringify(upgraded.value));
    assert.equal(upgraded.value.memory.deleted, 1);
  } finally { await f.cleanup(); }
});

test("Managed repair deletes an issued historical original through an ordinary ChangeSet", async () => {
  const f = await fixture();
  try {
    const entry = historical.find(row => row.reference === "procedures/memsphere-general-task-execution")!;
    const content = await readFile(join(root, `${entry.sha256}.yaml`));
    const { project, memory } = await seedManaged(f, "legacy-repair", entry, content);
    const result = f.run(["project", "repair", "legacy-repair"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert(!(await readdir(join(memory, "procedures"))).includes(entry.path.split("/").at(-1)!));
    const changeIds = await readdir(join(project, "changes"));
    const deletes = await Promise.all(changeIds.map(async id => {
      const change = JSON.parse(await readFile(join(project, "changes", id, "change.json"), "utf8"));
      return change.targets.filter((target: { operation: string; path: string }) => target.operation === "delete" && target.path === entry.path)
        .map(() => change);
    }));
    assert.equal(deletes.flat().length, 1);
    assert.equal(deletes.flat()[0].status, "completed");
    assert.equal(deletes.flat()[0].system_upgrade, undefined, "repair uses an ordinary ChangeSet");
  } finally { await f.cleanup(); }
});

test("Managed repair preserves a customized historical Procedure before any ChangeSet write", async () => {
  const f = await fixture();
  try {
    const entry = historical.find(row => row.reference === "procedures/memsphere-general-task-execution")!;
    const original = await readFile(join(root, `${entry.sha256}.yaml`), "utf8");
    const custom = `${original}\n# user customization\n`;
    const { project, memory } = await seedManaged(f, "custom-repair", entry, Buffer.from(custom));
    const changesBefore = await readdir(join(project, "changes"));
    const result = f.run(["project", "repair", "custom-repair"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr || result.stdout, /removal identity or content conflict/);
    assert.equal(await readFile(join(memory, entry.path), "utf8"), custom);
    assert.deepEqual(await readdir(join(project, "changes")), changesBefore);
  } finally { await f.cleanup(); }
});
