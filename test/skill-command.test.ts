import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skillInitCommand, skillUpgradeCommand } from "../src/commands/skill.js";

test("skill init installs only the unified memsphere skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-skill-test-"));

  try {
    await skillInitCommand({ directory: dir });

    assert.deepEqual(await readdir(dir), ["memsphere"]);

    const source = (await readFile(join(dir, "memsphere", "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
    assert.equal(source, (await readFile(join(process.cwd(), "src/skills/memsphere/SKILL.md"), "utf8")).replace(/\r\n/g, "\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skill upgrade replaces only the selected Skill and matches init --force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-skill-upgrade-"));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "other"));
    await writeFile(join(dir, "other/SKILL.md"), "keep");
    await skillInitCommand({ directory: dir });
    const expected = await readFile(join(dir, "memsphere/SKILL.md"));
    await writeFile(join(dir, "memsphere/SKILL.md"), "old");
    await skillUpgradeCommand({ directory: dir });
    assert.deepEqual(await readFile(join(dir, "memsphere/SKILL.md")), expected);
    assert.equal(await readFile(join(dir, "other/SKILL.md"), "utf8"), "keep");
    await assert.rejects(skillUpgradeCommand({ directory: dir, global: true }), /cannot be used together/);
    const bad = join(dir, "file");
    await writeFile(bad, "not a directory");
    await assert.rejects(skillUpgradeCommand({ directory: bad }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
