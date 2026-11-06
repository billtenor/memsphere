import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { fixture } from "./helpers/project-upgrade.js";

test("project upgrade command tree selects explicit name over global project over Primary before resource work", async () => {
  const f = await fixture();
  try {
    f.git(["init", "-b", "master"]);
    // Selection needs registered identities, not installed models or an upgrade.
    // A deliberately absent Memory repository fails preflight after selection.
    const projects: Record<string, { root: string }> = {};
    for (const name of ["primary", "other"]) {
      const root = join(f.home, "projects", name);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name, created_at: "2026-10-06T00:00:00.000Z" }));
      await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
      projects[name] = { root };
    }
    const workspace = await resolveWorkspaceIdentity(f.workspace);
    await writeFile(join(f.home, "registry.json"), JSON.stringify({ format_version: 1, projects, workspaces: { [workspace.key]: { primary: "primary", mounted: [] } } }));
    for (const [args, expected] of [
      [["project", "upgrade", "--output", "json"], "primary"],
      [["--project", "other", "project", "upgrade", "--output", "json"], "other"],
      [["--project", "other", "project", "upgrade", "primary", "--output", "json"], "primary"]
    ] as const) {
      const result = await f.moduleRun([...args]);
      assert.notEqual(result.status, 0);
      const value = JSON.parse(result.stdout);
      assert.equal(value.project, expected);
      assert.equal(value.failure.stage, "preflight");
      assert.equal(value.models.status, "not_run");
    }
    const missing = await f.moduleRun(["project", "upgrade", "missing", "--output", "json"]);
    assert.notEqual(missing.status, 0);
    assert.equal(JSON.parse(missing.stdout).failure.stage, "target");
    const unbound = join(f.root, "unbound");
    await mkdir(unbound);
    const noPrimary = await f.moduleRun(["project", "upgrade", "--output", "json"], unbound);
    assert.notEqual(noPrimary.status, 0);
    const noPrimaryError = JSON.parse(noPrimary.stdout || noPrimary.stderr);
    assert.equal(noPrimaryError.failure.stage, "target");
  } finally { await f.cleanup(); }
});

test("project upgrade rejects unknown options and invalid output formats as JSON errors", async () => {
  const f = await fixture();
  try {
    const invalid = await f.moduleRun(["project", "upgrade", "--unknown", "--output", "json"]);
    assert.notEqual(invalid.status, 0);
    assert.ok(JSON.parse(invalid.stderr).error);
    assert.equal(invalid.stdout, "");
    const badOutput = await f.moduleRun(["project", "upgrade", "--output", "xml"]);
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
