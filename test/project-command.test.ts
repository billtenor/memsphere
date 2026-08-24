import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import {
  projectBindCommand,
  projectCloneCommand,
  projectCreateCommand,
  projectMountCommand,
  prepareManagedSystemMemoryChange,
  projectPruneCommand,
  projectRepairCommand,
  projectUnbindCommand,
  projectUnmountCommand
} from "../src/commands/project.js";
import { runGit } from "../src/git.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import { readReservedMemoryManifest } from "../src/reserved/store.js";
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
    await assert.rejects(projectRepairCommand("embedded"), /requires a Managed Project/);
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
