
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { join } from "node:path";
import test from "node:test";

import { projectCreateCommand } from "../../../src/commands/project.js";

import { runGit } from "../../../src/git.js";


import { validateMemoryChange, withMemoryChangePreview } from "../../../src/memory/changeset.js";
import { readProjectRegistry } from "../../../src/project/registry.js";
import { currentMemorySyntax } from "../../../src/memory/syntax.js";

test("Embedded validation supports a Memory root equal to the Git worktree root", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-root-change-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(main);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "root-embedded";
    await runGit(["init", "-b", "master"], { cwd: main });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(main, kind), { recursive: true });
    }
    const published = `!concept\nsyntax: ${currentMemorySyntax}\nnames: [root-memory]\ndefines: [Published root]\n`;
    await writeFile(join(main, "concepts", "root-memory.yaml"), published);
    await runGit(["add", "concepts"], { cwd: main });
    await runGit(["commit", "-m", "root memory fixture"], { cwd: main });
    process.chdir(main);
    await projectCreateCommand("root-embedded", { embedded: main, bind: true });
    await runGit(["worktree", "add", "-b", "linked", linked], { cwd: main });

    process.chdir(linked);
    await writeFile(join(linked, "concepts", "root-memory.yaml"), published.replace("Published root", "Root preview"));
    const validation = await validateMemoryChange();
    assert.equal(validation.storeType, "embedded");
    assert.deepEqual(validation.issues, []);
    assert.equal(await readFile(join(main, "concepts", "root-memory.yaml"), "utf8"), published);

    const project = (await readProjectRegistry(home)).projects["root-embedded"];
    assert(project);
    const change = JSON.parse(await readFile(join(project.root, "changes", validation.changeId, "change.json"), "utf8")) as {
      source_worktree: { memory_path: string };
    };
    assert.equal(change.source_worktree.memory_path, ".");
    await withMemoryChangePreview({
      home,
      project: "root-embedded",
      changeId: validation.changeId,
      use: async ({ memoryRoot }) => {
        assert.match(await readFile(join(memoryRoot, "concepts", "root-memory.yaml"), "utf8"), /Root preview/);
      }
    });
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous.project;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});