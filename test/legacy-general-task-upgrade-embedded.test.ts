import assert from "node:assert/strict";
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { embeddedFixture, fixture } from "./helpers/project-upgrade.js";
import { historical, root } from "./helpers/legacy-general-task-upgrade.js";

test("Embedded upgrade deletes each issued historical general task original", async () => {
  const f = await fixture();
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    for (const [index, entry] of historical.entries()) {
      await writeFile(join(memoryRoot, entry.path), await readFile(join(root, `${entry.sha256}.yaml`)));
      f.git(["add", "."]);
      f.git(["commit", "-m", `Historical general task ${index}`]);
      const linked = join(f.root, `upgrade-worktree-${index}`);
      f.git(["worktree", "add", "-b", `upgrade/system-${index}`, linked, "master"]);
      const { result, value } = f.upgrade("embedded", [], linked);
      assert.equal(result.status, 0, JSON.stringify(value));
      assert.equal(value.memory.deleted, 1);
      assert.equal(value.memory.integrationStatus, "pending");
      const change = JSON.parse(await readFile(join(project, "changes", value.memory.changeSet.id, "change.json"), "utf8"));
      assert.equal(change.system_upgrade.targets.find((target: { operation: string }) => target.operation === "delete").approvedContentDigest, entry.sha256);
      assert(!(await readdir(join(linked, ".memsphere/memory/procedures"))).includes(entry.path.split("/").at(-1)!));
      assert.equal((await readFile(join(memoryRoot, entry.path))).length > 0, true, "original worktree stays unchanged");
      await rm(join(memoryRoot, entry.path));
      f.git(["add", "."]);
      f.git(["commit", "-m", `Reset historical fixture ${index}`]);
    }
  } finally { await f.cleanup(); }
});

test("Embedded upgrade preserves a same-path customized Procedure", async () => {
  const f = await fixture();
  try {
    const { memoryRoot } = await embeddedFixture(f);
    const entry = historical.find(row => row.reference === "procedures/memsphere-general-task-execution")!;
    const original = await readFile(join(root, `${entry.sha256}.yaml`), "utf8");
    const custom = `${original}\n# user customization\n`;
    await writeFile(join(memoryRoot, entry.path), custom);
    f.git(["add", "."]);
    f.git(["commit", "-m", "Customized historical procedure"]);
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const { result, value } = f.upgrade("embedded", [], linked);
    assert.equal(result.status, 1);
    assert.match(value.failure.message, /removal identity or content conflict/);
    assert.equal(await readFile(join(linked, ".memsphere/memory", entry.path), "utf8"), custom);
  } finally { await f.cleanup(); }
});
