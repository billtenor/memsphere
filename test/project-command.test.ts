import assert from "node:assert/strict";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import {
  projectBindCommand,
  projectCloneCommand,
  projectCreateCommand,
  applyEmbeddedSystemMemoryRepair,
  prepareEmbeddedSystemMemoryRepair,
  projectMountCommand,
  prepareManagedSystemMemoryChange,
  projectPruneCommand,
  projectRepairCommand,
  projectUnbindCommand,
  projectUnmountCommand
} from "../src/commands/project.js";
import { gitOutput, runGit } from "../src/git.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import { bundledReservedMemoryRoot, readReservedMemoryManifest } from "../src/reserved/store.js";
import { editMemories, publishMemoryChange, validateMemoryChange } from "../src/memory/changeset.js";

test("Project lifecycle keeps creation separate from Workspace binding", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-command-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);

    await projectCreateCommand("primary", { bind: true });
    await projectCreateCommand("career", {});
    const identity = await resolveWorkspaceIdentity();
    let registry = await readProjectRegistry(home);
    assert.equal(registry.workspaces[identity.key]?.primary, "primary");
    assert.deepEqual(registry.workspaces[identity.key]?.mounted, []);

    const primary = registry.projects.primary;
    await Promise.all([
      "memory",
      "changes",
      "runs",
      "archives",
      "evals",
      ".runtime"
    ].map((directory) => access(join(primary.root, directory))));
    const projectConfig = JSON.parse(await readFile(join(primary.root, "config.json"), "utf8")) as {
      store: { published_revision: string };
    };
    assert.match(projectConfig.store.published_revision, /^[0-9a-f]{40,64}$/);
    assert.deepEqual(
      await runGit(["log", "--reverse", "--format=%s"], { cwd: join(primary.root, "memory") })
        .then((result) => result.stdout.split("\n")),
      ["Initialize Memsphere Memory Store", "Bootstrap Memsphere system Memory"]
    );
    assert.deepEqual(
      (await readAllMemoryFiles(join(primary.root, "memory")))
        .map((file) => relative(join(primary.root, "memory"), file.path).replaceAll("\\", "/"))
        .sort(),
      [...(await readReservedMemoryManifest()).system_memory.install].sort()
    );

    await projectMountCommand("career");
    registry = await readProjectRegistry(home);
    assert.deepEqual(registry.workspaces[identity.key]?.mounted, ["career"]);
    await assert.rejects(projectMountCommand("career"), /already mounted/);
    await projectUnmountCommand("career");

    await assert.rejects(projectBindCommand("career"), /project unbind/);
    await projectUnbindCommand();
    await projectBindCommand("career");
    registry = await readProjectRegistry(home);
    assert.equal(registry.workspaces[identity.key]?.primary, "career");
    assert.deepEqual(registry.workspaces[identity.key]?.mounted, []);
    await projectUnbindCommand();
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Managed Project System Memory repair validates and publishes automatically", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-repair-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);

    await projectCreateCommand("existing", { bind: true });
    assert.equal(await prepareManagedSystemMemoryChange(), undefined);

    const localEdit = await editMemories({ references: ["concepts/memsphere-memory"] });
    const localTarget = localEdit.change.targets[0];
    const localCandidate = join(localEdit.candidateRoot, localTarget.path);
    await writeFile(localCandidate, `${await readFile(localCandidate, "utf8")}\n# local divergence\n`);
    await publishMemoryChange(localEdit.change.id, "Diverge System Memory for test");

    await projectRepairCommand("existing");
    assert.equal(await prepareManagedSystemMemoryChange("existing"), undefined);
    const registry = await readProjectRegistry(home);
    const projectRoot = registry.projects.existing.root;
    const repairedConfig = JSON.parse(await readFile(join(projectRoot, "config.json"), "utf8")) as {
      store: { published_revision: string };
    };
    assert.equal(
      await runGit(["log", "-1", "--format=%s"], { cwd: join(projectRoot, "memory") }).then((result) => result.stdout),
      "Repair Memsphere system Memory"
    );
    const changeCount = (await readdir(join(projectRoot, "changes"))).length;
    await projectRepairCommand("existing");
    assert.equal((await readdir(join(projectRoot, "changes"))).length, changeCount);
    const noOpConfig = JSON.parse(await readFile(join(projectRoot, "config.json"), "utf8")) as {
      store: { published_revision: string };
    };
    assert.equal(noOpConfig.store.published_revision, repairedConfig.store.published_revision);
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

test("System Memory repair deletes only v3 tombstone identities and rejects path reuse", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-repair-identity-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);

    await projectCreateCommand("legacy", { bind: true });
    let registry = await readProjectRegistry(home);
    const legacyRoot = registry.projects.legacy.root;
    const legacyMemoryRoot = join(legacyRoot, "memory");
    await writeFile(
      join(legacyMemoryRoot, "concepts", "memory.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [Memory]\ndefines: [Legacy System Memory.]\n")
    );
    await runGit(["add", "concepts/memory.yaml"], { cwd: legacyMemoryRoot });
    await runGit(["commit", "-m", "Install legacy System Memory"], { cwd: legacyMemoryRoot });
    const legacyRevision = await runGit(["rev-parse", "HEAD"], { cwd: legacyMemoryRoot }).then((result) => result.stdout);
    const legacyConfigPath = join(legacyRoot, "config.json");
    const legacyConfig = JSON.parse(await readFile(legacyConfigPath, "utf8"));
    legacyConfig.store.published_revision = legacyRevision;
    await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);

    const legacyRepair = await prepareManagedSystemMemoryChange("legacy");
    assert(legacyRepair);
    assert.equal(legacyRepair.created, 0);
    assert.equal(legacyRepair.updated, 0);
    assert.equal(legacyRepair.deleted, 1);
    assert.deepEqual(legacyRepair.change.targets.map((target) => target.reference), ["concepts/Memory"]);
    assert.deepEqual((await validateMemoryChange(legacyRepair.change.id)).issues, []);
    await publishMemoryChange(legacyRepair.change.id, "Remove legacy System Memory");
    await assert.rejects(readFile(join(legacyMemoryRoot, "concepts", "memory.yaml")), /ENOENT/);

    await projectCreateCommand("protected", {});
    registry = await readProjectRegistry(home);
    process.env.MEMSPHERE_PROJECT = "protected";
    const protectedEdit = await editMemories({
      references: ["concepts/user-memory"],
      createPaths: new Map([["concepts/user-memory", "concepts/memory.yaml"]])
    });
    await writeFile(
      join(protectedEdit.candidateRoot, "concepts", "memory.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [user-memory]\ndefines: [User-owned Memory.]\n")
    );
    await publishMemoryChange(protectedEdit.change.id, "Create user Memory at historical path");
    const changesBefore = (await readdir(join(registry.projects.protected.root, "changes"))).length;
    assert.equal(await prepareManagedSystemMemoryChange("legacy"), undefined);
    assert.equal(process.env.MEMSPHERE_PROJECT, "protected");
    await assert.rejects(
      prepareManagedSystemMemoryChange(),
      /removal identity conflict.*concepts\/memory.yaml.*concepts\/user-memory/
    );
    assert.equal((await readdir(join(registry.projects.protected.root, "changes"))).length, changesBefore);
    assert.match(await readFile(join(registry.projects.protected.root, "memory", "concepts", "memory.yaml"), "utf8"), /User-owned/);
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

test("Embedded Project reuses the current repository without nested Git", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(memoryRoot, { recursive: true }));
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded", { embedded: memoryRoot, bind: true });
    assert.deepEqual(
      (await readAllMemoryFiles(memoryRoot))
        .map((file) => relative(memoryRoot, file.path).replaceAll("\\", "/"))
        .sort(),
      [...(await readReservedMemoryManifest()).system_memory.install].sort()
    );
    assert.equal(await gitOutput(["diff", "--cached", "--name-only"], workspace), "");
    const registry = await readProjectRegistry(home);
    const config = JSON.parse(await readFile(join(registry.projects.embedded.root, "config.json"), "utf8"));
    assert.deepEqual(config.store, {
      type: "embedded",
      repository_path: await realpath(workspace),
      memory_path: ".memsphere/memory"
    });
    await assert.rejects(readFile(join(memoryRoot, ".git")), /ENOENT/);
    const other = join(fixture, "other-workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(other));
    await runGit(["init", "-b", "master"], { cwd: other });
    process.chdir(other);
    await assert.rejects(projectBindCommand("embedded"), /only be used by worktrees of its own Git repository/);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded Project creation rolls back registration when System Memory bootstrap conflicts", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-bootstrap-conflict-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const conflictPath = join(memoryRoot, "concepts", "memsphere-memory.yaml");
  const conflictSource = withCurrentMemorySyntax("!concept\nnames: [user-memory]\ndefines: [User-owned Memory.]\n");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(dirname(conflictPath), { recursive: true });
    await writeFile(conflictPath, conflictSource);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);

    await assert.rejects(
      projectCreateCommand("embedded-conflict", { embedded: memoryRoot, bind: true }),
      /System Memory install path conflict.*concepts\/memsphere-memory\.yaml.*concepts\/user-memory/
    );

    const registry = await readProjectRegistry(home);
    assert.equal(registry.projects["embedded-conflict"], undefined);
    assert.deepEqual(registry.workspaces, {});
    await assert.rejects(access(join(home, "projects", "embedded-conflict")), /ENOENT/);
    assert.equal(await readFile(conflictPath, "utf8"), conflictSource);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded System Memory repair creates, updates, and deletes only as worktree changes", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-embedded-repair-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(workspace);
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await installBundledSystemMemory(memoryRoot);
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "install system memory"], { cwd: workspace });

    const createdPath = "concepts/memsphere-memory.yaml";
    const updatedPath = "concepts/memsphere-framework.yaml";
    const removedPath = "concepts/memory.yaml";
    await rm(join(memoryRoot, createdPath));
    await writeFile(join(memoryRoot, updatedPath), `${await readFile(join(memoryRoot, updatedPath), "utf8")}\n# drift\n`);
    await writeFile(join(memoryRoot, removedPath), withCurrentMemorySyntax("!concept\nnames: [Memory]\ndefines: [Legacy System Memory.]\n"));
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "drift system memory"], { cwd: workspace });

    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCreateCommand("embedded-repair", { embedded: memoryRoot, bind: true });
    const headBefore = await gitOutput(["rev-parse", "HEAD"], workspace);
    await projectRepairCommand("embedded-repair");

    assert.deepEqual(await readFile(join(memoryRoot, createdPath)), await readFile(join(bundledReservedMemoryRoot(), createdPath)));
    assert.deepEqual(await readFile(join(memoryRoot, updatedPath)), await readFile(join(bundledReservedMemoryRoot(), updatedPath)));
    await assert.rejects(readFile(join(memoryRoot, removedPath)), /ENOENT/);
    assert.equal(await gitOutput(["rev-parse", "HEAD"], workspace), headBefore);
    const statusAfterRepair = await gitOutput(["status", "--short"], workspace);
    assert.match(statusAfterRepair, /memsphere-memory\.yaml/);
    assert.match(statusAfterRepair, /memsphere-framework\.yaml/);
    assert.match(statusAfterRepair, /concepts\/memory\.yaml/);

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
      `${await readFile(join(bundledReservedMemoryRoot(), "concepts", "memsphere-framework.yaml"), "utf8")}\n# ignored drift\n`
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

test("Embedded Project created from a linked worktree records the main worktree", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-linked-embedded-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(main, ".memsphere", "memory"), { recursive: true }));
    await writeFile(join(main, ".memsphere", "memory", ".gitkeep"), "");
    await runGit(["init", "-b", "master"], { cwd: main });
    await runGit(["add", ".memsphere"], { cwd: main });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"], { cwd: main });
    await runGit(["worktree", "add", "-b", "feature", linked], { cwd: main });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(linked);

    await projectCreateCommand("linked-embedded", {
      embedded: join(linked, ".memsphere", "memory"),
      bind: true
    });
    const registry = await readProjectRegistry(home);
    const config = JSON.parse(await readFile(join(registry.projects["linked-embedded"].root, "config.json"), "utf8"));
    assert.deepEqual(config.store, {
      type: "embedded",
      repository_path: await realpath(main),
      memory_path: ".memsphere/memory"
    });
    assert.deepEqual(
      await readFile(join(linked, ".memsphere", "memory", "concepts", "memsphere-memory.yaml")),
      await readFile(join(bundledReservedMemoryRoot(), "concepts", "memsphere-memory.yaml"))
    );
    await assert.rejects(
      readFile(join(main, ".memsphere", "memory", "concepts", "memsphere-memory.yaml")),
      /ENOENT/
    );
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Project clone accepts a valid non-empty Memory repository and rejects an empty one", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-clone-"));
  const home = join(fixture, "home");
  const source = join(fixture, "source");
  const empty = join(fixture, "empty");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, gitConfig: process.env.GIT_CONFIG_GLOBAL };
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(workspace);
    await mkdir(source);
    await mkdir(empty);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    for (const kind of ["concepts", "statements", "procedures", "schemas"]) {
      await mkdir(join(source, kind));
      await writeFile(join(source, kind, ".gitkeep"), "");
    }
    await writeFile(join(source, "concepts", "valid.yaml"), withCurrentMemorySyntax("!concept\nnames: [valid]\ndefines: []\n"));
    await runGit(["init", "-b", "master"], { cwd: source });
    await runGit(["add", "-A"], { cwd: source });
    await runGit(["commit", "-m", "Memory Store"], { cwd: source });
    await runGit(["init", "-b", "master"], { cwd: empty });
    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCloneCommand(source, { name: "cloned", bind: true });
    const registry = await readProjectRegistry(home);
    assert.equal(registry.workspaces[(await resolveWorkspaceIdentity()).key]?.primary, "cloned");
    assert.match(await runGit(["rev-parse", "HEAD"], { cwd: join(registry.projects.cloned.root, "memory") }).then((result) => result.stdout), /^[0-9a-f]{40,64}$/);
    await assert.rejects(projectCloneCommand(empty, { name: "empty" }), /empty Memory repository/);
    assert.equal((await readProjectRegistry(home)).projects.empty, undefined);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("prune removes only missing registrations and bindings", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-prune-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    process.env.MEMSPHERE_HOME = fixture;
    const { updateProjectRegistry } = await import("../src/project/registry.js");
    const workspace = await resolveWorkspaceIdentity();
    await updateProjectRegistry(fixture, (registry) => {
      registry.projects.missing = { root: join(fixture, "gone") };
      registry.workspaces[workspace.key] = { primary: "missing", mounted: [] };
    });
    await projectPruneCommand();
    const registry = await readProjectRegistry(fixture);
    assert.deepEqual(registry.projects, {});
    assert.deepEqual(registry.workspaces, {});
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("concurrent creation of one Project preserves the winning Project Root", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-concurrent-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, gitConfig: process.env.GIT_CONFIG_GLOBAL };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);
    const results = await Promise.allSettled([
      projectCreateCommand("shared", {}),
      projectCreateCommand("shared", {})
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const registry = await readProjectRegistry(home);
    const root = registry.projects.shared.root;
    assert.equal(JSON.parse(await readFile(join(root, "project.json"), "utf8")).name, "shared");
    assert.match(await runGit(["rev-parse", "HEAD"], { cwd: join(root, "memory") }).then((result) => result.stdout), /^[0-9a-f]{40,64}$/);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

async function installBundledSystemMemory(memoryRoot: string): Promise<void> {
  const sourceRoot = bundledReservedMemoryRoot();
  const manifest = await readReservedMemoryManifest(sourceRoot);
  for (const path of manifest.system_memory.install) {
    await mkdir(dirname(join(memoryRoot, path)), { recursive: true });
    await cp(join(sourceRoot, path), join(memoryRoot, path));
  }
}
