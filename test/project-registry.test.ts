import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertProjectName } from "../src/project/model.js";
import { readProjectRegistry, updateProjectRegistry } from "../src/project/registry.js";
import { resolveMainWorkspacePath, resolveWorkspaceIdentity } from "../src/project/workspace.js";

test("project names are readable stable identifiers", () => {
  for (const name of ["memsphere", "career-memory", "team.memory_1"]) assert.equal(assertProjectName(name), name);
  for (const name of [
    "", "Team", "space name", "项目", ".", "..", "project.",
    "con", "con.memory", "prn", "aux", "nul", "com1", "com9.log", "lpt1", "lpt9.yaml"
  ]) assert.throws(() => assertProjectName(name));
});

test("Registry updates serialize concurrent writers", async () => {
  const home = await mkdtemp(join(tmpdir(), "memsphere-registry-"));
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => updateProjectRegistry(home, async (registry) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      registry.projects[`p-${index}`] = { root: join(home, `p-${index}`) };
    })));
    const registry = await readProjectRegistry(home);
    assert.equal(Object.keys(registry.projects).length, 8);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("linked worktrees share a Workspace key", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-workspace-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  try {
    await mkdir(main);
    const { runGit } = await import("../src/git.js");
    try {
      await runGit(["init", "-b", "master"], { cwd: main });
      await writeFile(join(main, "README.md"), "fixture\n");
      await runGit(["add", "README.md"], { cwd: main });
      await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"], { cwd: main });
      await runGit(["worktree", "add", "-b", "linked", linked], { cwd: main });
    } catch (error) {
      t.skip(`git worktree unavailable: ${String(error)}`);
      return;
    }
    assert.equal((await resolveWorkspaceIdentity(main)).key, (await resolveWorkspaceIdentity(linked)).key);
    assert.equal(await resolveMainWorkspacePath(linked), await realpath(main));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
