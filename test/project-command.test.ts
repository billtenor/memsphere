import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  projectBindCommand,
  projectCloneCommand,
  projectCreateCommand,
  projectMountCommand,
  projectPruneCommand,
  projectUnbindCommand,
  projectUnmountCommand
} from "../src/commands/project.js";
import { runGit } from "../src/git.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

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
      "reviews",
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
    const registry = await readProjectRegistry(home);
    const config = JSON.parse(await readFile(join(registry.projects.embedded.root, "config.json"), "utf8"));
    assert.deepEqual(config.store, { type: "embedded", memory_path: memoryRoot });
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
    await writeFile(join(source, "concepts", "valid.yaml"), withCurrentMemorySyntax("!concept\nnames: [Valid]\ndefines: []\n"));
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
