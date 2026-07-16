import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skillInitCommand } from "../src/commands/skill.js";

test("skill init installs only the unified memsphere skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-skill-test-"));

  try {
    await skillInitCommand({ directory: dir });

    assert.deepEqual(await readdir(dir), ["memsphere"]);

    const source = await readFile(join(dir, "memsphere", "SKILL.md"), "utf8");
    assert.match(source, /^---\nname: memsphere\n/);
    assert.match(source, /memsphere memory list --output yaml/);
    assert.match(source, /memsphere memory read <reference>/);
    assert.doesNotMatch(source, /\.memsphere\/memory\/concepts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
