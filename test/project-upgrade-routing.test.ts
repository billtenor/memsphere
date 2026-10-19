import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fixture } from "./helpers/project-upgrade.js";

test("project upgrade CLI selects explicit name over global project over Primary and routes JSON errors", async () => {
  const f = await fixture();
  try {
    f.git(["init", "-b", "master"]);
    f.create("primary", ["--bind"]);
    f.create("other");
    for (const [args, expected] of [
      [["project", "upgrade", "--output", "json"], "primary"],
      [["--project", "other", "project", "upgrade", "--output", "json"], "other"],
      [["--project", "other", "project", "upgrade", "primary", "--output", "json"], "primary"]
    ] as const) {
      const result = f.run([...args]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).project, expected);
    }
    const missing = f.upgrade("missing");
    assert.notEqual(missing.result.status, 0);
    assert.equal(missing.value.overall, "failed");
    assert.equal(missing.value.failure.stage, "target");
    const unbound = join(f.root, "unbound");
    await mkdir(unbound);
    const noPrimary = f.run(["project", "upgrade", "--output", "json"], unbound);
    assert.notEqual(noPrimary.status, 0);
    const noPrimaryError = JSON.parse(noPrimary.stdout || noPrimary.stderr);
    assert.ok(noPrimaryError.failure || noPrimaryError.error);
    const invalid = f.run(["project", "upgrade", "--unknown", "--output", "json"]);
    assert.notEqual(invalid.status, 0);
    assert.ok(JSON.parse(invalid.stderr).error);
    assert.equal(invalid.stdout, "");
    const badOutput = f.run(["project", "upgrade", "--output", "xml"]);
    assert.notEqual(badOutput.status, 0);
  } finally { await f.cleanup(); }
});

test("skill upgrade CLI refreshes only default, global and directory Memsphere targets", async () => {
  const f = await fixture();
  try {
    for (const [args, directory] of [
      [[], join(f.workspace, ".agents/skills")],
      [["--global"], join(f.root, ".agents/skills")],
      [["--directory", join(f.root, "custom-skills")], join(f.root, "custom-skills")]
    ] as [string[], string][]) {
      await mkdir(join(directory, "memsphere"), { recursive: true });
      await mkdir(join(directory, "other"), { recursive: true });
      await writeFile(join(directory, "memsphere/SKILL.md"), "old skill");
      await writeFile(join(directory, "other/SKILL.md"), "user skill");
      const result = f.run(["skill", "upgrade", ...args]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(await readFile(join(directory, "memsphere/SKILL.md"), "utf8"), await readFile(resolve("dist/skills/memsphere/SKILL.md"), "utf8"));
      assert.equal(await readFile(join(directory, "other/SKILL.md"), "utf8"), "user skill");
    }
    const conflict = f.run(["skill", "upgrade", "--global", "--directory", join(f.root, "custom-skills")]);
    assert.notEqual(conflict.status, 0);
    const file = join(f.root, "not-directory");
    await writeFile(file, "protected file");
    assert.notEqual(f.run(["skill", "upgrade", "--directory", file]).status, 0);
    assert.equal(await readFile(file, "utf8"), "protected file");
  } finally { await f.cleanup(); }
});
