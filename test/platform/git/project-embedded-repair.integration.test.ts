

import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { projectCreateCommand, applyEmbeddedSystemMemoryRepair, prepareEmbeddedSystemMemoryRepair, projectRepairCommand } from "../../../src/commands/project.js";
import { gitOutput, runGit } from "../../../src/git.js";



import { withCurrentMemorySyntax } from "../../helpers/memory.js";

import { bundledReservedMemoryRoot, bundledSystemMemoryRoot, readBundledSystemMemories, readReservedMemoryManifest } from "../../../src/reserved/store.js";


async function installBundledSystemMemory(memoryRoot: string): Promise<void> {
  const sourceRoot = bundledReservedMemoryRoot();
  const manifest = await readReservedMemoryManifest(sourceRoot);
  const sources = new Map((await readBundledSystemMemories(sourceRoot)).map((memory) => [memory.path, memory.sourcePath]));
  for (const path of manifest.system_memory.install) {
    await mkdir(dirname(join(memoryRoot, path)), { recursive: true });
    await cp(sources.get(path)!, join(memoryRoot, path));
  }
}

test("Embedded System Memory repair creates and updates without deleting unlisted Memory", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(workspace);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await mkdir(memoryRoot, { recursive: true });

    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-repair", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });

    const createdPath = "concepts/memsphere-memory.yaml";
    const updatedPath = "concepts/memsphere-framework.yaml";
    const removedPath = "concepts/memory.yaml";
    await rm(join(memoryRoot, createdPath));
    await writeFile(join(memoryRoot, updatedPath), `${await readFile(join(memoryRoot, updatedPath), "utf8")}\n# drift\n`);
    await writeFile(join(memoryRoot, removedPath), withCurrentMemorySyntax("!concept\nnames: [legacy-memory]\ndefines: [Legacy System Memory.]\n"));
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "drift system memory"], { cwd: workspace });

    const headBefore = await gitOutput(["rev-parse", "HEAD"], workspace);
    await projectRepairCommand("embedded-repair");

    assert.deepEqual(await readFile(join(memoryRoot, createdPath)), await readFile(join(bundledSystemMemoryRoot(), createdPath)));
    assert.deepEqual(await readFile(join(memoryRoot, updatedPath)), await readFile(join(bundledSystemMemoryRoot(), updatedPath)));
    assert.match(await readFile(join(memoryRoot, removedPath), "utf8"), /Legacy System Memory/);
    assert.equal(await gitOutput(["rev-parse", "HEAD"], workspace), headBefore);
    const statusAfterRepair = await gitOutput(["status", "--short"], workspace);
    assert.match(statusAfterRepair, /memsphere-memory\.yaml/);
    assert.match(statusAfterRepair, /memsphere-framework\.yaml/);
    assert.doesNotMatch(statusAfterRepair, /concepts\/memory\.yaml/);

    await projectRepairCommand("embedded-repair");
    assert.equal(await gitOutput(["status", "--short"], workspace), statusAfterRepair);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair rejects dirty targets and stale preparations", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-cas-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const targetPath = join(memoryRoot, "concepts", "memsphere-framework.yaml");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(workspace);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await installBundledSystemMemory(memoryRoot);
    const bundled = await readFile(targetPath, "utf8");
    await writeFile(targetPath, `${bundled}\n# committed drift\n`);
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "drift system memory"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-cas", { embedded: memoryRoot, bind: true });

    await writeFile(targetPath, `${bundled}\n# dirty target\n`);
    await assert.rejects(projectRepairCommand("embedded-cas"), /target has uncommitted changes/);
    assert.match(await readFile(targetPath, "utf8"), /dirty target/);

    await runGit(["restore", "--", ".memsphere/memory/concepts/memsphere-framework.yaml"], { cwd: workspace });
    const prepared = await prepareEmbeddedSystemMemoryRepair("embedded-cas");
    assert(prepared);
    await writeFile(targetPath, `${bundled}\n# concurrent edit\n`);
    await assert.rejects(applyEmbeddedSystemMemoryRepair(prepared), /target changed during repair/);
    assert.match(await readFile(targetPath, "utf8"), /concurrent edit/);

    await runGit(["restore", "--", ".memsphere/memory/concepts/memsphere-framework.yaml"], { cwd: workspace });
    if (process.platform !== "win32") {
      const modePrepared = await prepareEmbeddedSystemMemoryRepair("embedded-cas");
      assert(modePrepared);
      await chmod(targetPath, 0o755);
      await assert.rejects(applyEmbeddedSystemMemoryRepair(modePrepared), /target changed during repair/);
      assert.equal((await stat(targetPath)).mode & 0o777, 0o755);
    }

    await runGit(["restore", "--", ".memsphere/memory/concepts/memsphere-framework.yaml"], { cwd: workspace });
    const first = await prepareEmbeddedSystemMemoryRepair("embedded-cas");
    const overlapping = await prepareEmbeddedSystemMemoryRepair("embedded-cas");
    assert(first && overlapping);
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    const activeRepair = applyEmbeddedSystemMemoryRepair(first, { afterApply: async () => {
      ready(); await resumed;
      await writeFile(targetPath, `${bundled}\n# newer external edit\n`);
      throw Error("receipt failure");
    } });
    const failedRepair = assert.rejects(activeRepair, /rollback was incomplete/);
    await started;
    try {
      await assert.rejects(applyEmbeddedSystemMemoryRepair(overlapping), { code: "MEMORY_REPAIR_BUSY" });
    } finally { release(); await failedRepair; }
    assert.match(await readFile(targetPath, "utf8"), /newer external edit/);
    await runGit(["restore", "--", ".memsphere/memory/concepts/memsphere-framework.yaml"], { cwd: workspace });
    const rollbackPrepared = await prepareEmbeddedSystemMemoryRepair("embedded-cas");
    assert(rollbackPrepared);
    await writeFile(
      join(memoryRoot, "concepts", "invalid-alias.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [invalid-alias, Memory]\ndefines: [Concurrent invalid Memory.]\n")
    );
    await assert.rejects(applyEmbeddedSystemMemoryRepair(rollbackPrepared), /post-write validation failed/);
    assert.match(await readFile(targetPath, "utf8"), /committed drift/);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair treats dirty target paths as literal Git pathspecs", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-pathspec-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, "mem[ory]");
  const targetPath = join(memoryRoot, "concepts", "memsphere-framework.yaml");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(workspace);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await installBundledSystemMemory(memoryRoot);
    const bundled = await readFile(targetPath, "utf8");
    await writeFile(targetPath, `${bundled}\n# committed drift\n`);
    await runGit(["add", "-A"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "pathspec fixture"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-pathspec", { embedded: memoryRoot, bind: true });

    await writeFile(targetPath, `${bundled}\n# dirty target\n`);
    await assert.rejects(projectRepairCommand("embedded-pathspec"), /target has uncommitted changes/);
    assert.match(await readFile(targetPath, "utf8"), /dirty target/);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair rejects ignored targets", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-ignored-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const targetPath = join(memoryRoot, "concepts", "memsphere-framework.yaml");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(memoryRoot, { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-ignored", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });
    await rm(targetPath);
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "remove repair target"], { cwd: workspace });
    await writeFile(join(workspace, ".gitignore"), ".memsphere/memory/concepts/memsphere-framework.yaml\n");
    await runGit(["add", ".gitignore"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "ignore repair target"], { cwd: workspace });
    await writeFile(
      targetPath,
      `${await readFile(join(bundledSystemMemoryRoot(), "concepts", "memsphere-framework.yaml"), "utf8")}\n# ignored drift\n`
    );

    await assert.rejects(projectRepairCommand("embedded-ignored"), /target has uncommitted changes/);
    assert.match(await readFile(targetPath, "utf8"), /ignored drift/);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair validates the complete candidate before writing", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-validation-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const targetPath = join(memoryRoot, "concepts", "memsphere-framework.yaml");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(memoryRoot, { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-validation", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });
    const drifted = `${await readFile(targetPath, "utf8")}\n# committed drift\n`;
    await writeFile(targetPath, drifted);
    await writeFile(
      join(memoryRoot, "concepts", "invalid-alias.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [invalid-alias, Memory]\ndefines: [Conflicting alias.]\n")
    );
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "invalid candidate fixture"], { cwd: workspace });

    await assert.rejects(projectRepairCommand("embedded-validation"), /repair validation failed/);
    assert.equal(await readFile(targetPath, "utf8"), drifted);
    assert.equal(await gitOutput(["status", "--short"], workspace), "");
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair never stages through a symbolic-link kind directory", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-symlink-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const outsideConcepts = join(fixture, "outside-concepts");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(memoryRoot, { recursive: true });
    await mkdir(outsideConcepts);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-symlink", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });
    await rm(join(memoryRoot, "concepts"), { recursive: true });
    await symlink(outsideConcepts, join(memoryRoot, "concepts"), "dir");
    await runGit(["add", "-A", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "replace concepts with symlink"], { cwd: workspace });

    await assert.rejects(projectRepairCommand("embedded-symlink"), /symbolic links are not allowed/);
    assert.deepEqual(await readdir(outsideConcepts), []);
    assert.equal(await gitOutput(["status", "--short"], workspace), "");
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair validates a no-op Store before reporting success", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-noop-validation-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(memoryRoot, { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-noop-validation", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });
    await writeFile(
      join(memoryRoot, "concepts", "invalid-alias.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [invalid-alias, Memory]\ndefines: [Conflicting alias.]\n")
    );
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "invalid no-op fixture"], { cwd: workspace });

    await assert.rejects(projectRepairCommand("embedded-noop-validation"), /repair validation failed/);
    assert.equal(await gitOutput(["status", "--short"], workspace), "");
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair rejects install path identity reuse before writing", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-conflict-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const occupiedPath = join(memoryRoot, "concepts", "memsphere-memory.yaml");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(memoryRoot, { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-conflict", { embedded: memoryRoot, bind: true });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });
    const userMemory = withCurrentMemorySyntax("!concept\nnames: [user-memory]\ndefines: [User-owned Memory.]\n");
    await writeFile(occupiedPath, userMemory);
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "path conflict fixture"], { cwd: workspace });

    await assert.rejects(projectRepairCommand("embedded-conflict"), /install path conflict.*concepts\/memsphere-memory\.yaml/);
    assert.equal(await readFile(occupiedPath, "utf8"), userMemory);
    assert.equal(await gitOutput(["status", "--short"], workspace), "");
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});
