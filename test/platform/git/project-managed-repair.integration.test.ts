
import { managedProjectFixture } from "../../helpers/project.js";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import test from "node:test";
import { projectMountCommand, prepareManagedSystemMemoryChange, projectRepairCommand } from "../../../src/commands/project.js";
import { runGit } from "../../../src/git.js";
import { readProjectRegistry } from "../../../src/project/registry.js";

import { currentMemorySyntax } from "../../../src/memory/syntax.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";

import { bundledSystemMemoryRoot, readReservedMemoryManifest } from "../../../src/reserved/store.js";
import { editMemories, memoryChangeSetSchema, publishMemoryChange, validateMemoryChange, type MemoryChangeSet } from "../../../src/memory/changeset.js";

async function readOnlyNewChange(
  projectRoot: string,
  before: Set<string>
): Promise<{ id: string; record: MemoryChangeSet }> {
  const created = [...await changeIds(projectRoot)].filter((id) => !before.has(id));
  assert.equal(created.length, 1);
  return {
    id: created[0],
    record: memoryChangeSetSchema.parse(
      JSON.parse(await readFile(join(projectRoot, "changes", created[0], "change.json"), "utf8"))
    )
  };
}

async function changeIds(projectRoot: string): Promise<Set<string>> {
  return new Set(await readdir(join(projectRoot, "changes")));
}

async function captureProjectRepair(name?: string): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  try {
    console.log = (...values: unknown[]) => lines.push(values.join(" "));
    await projectRepairCommand(name);
  } finally {
    console.log = original;
  }
  return lines;
}

async function publishDirectStoreCommit(projectRoot: string, message: string): Promise<string> {
  const memoryRoot = join(projectRoot, "memory");
  await runGit(["add", "-A"], { cwd: memoryRoot });
  await runGit(["commit", "-m", message], { cwd: memoryRoot });
  const revision = await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot }).then((result) => result.stdout);
  const configPath = join(projectRoot, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = revision;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return revision;
}

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

    await managedProjectFixture("existing", { bind: true });
    assert.equal(await prepareManagedSystemMemoryChange(), undefined);

    const registry = await readProjectRegistry(home);
    const projectRoot = registry.projects.existing.root;
    const memoryRoot = join(projectRoot, "memory");
    const personalizedSoftwarePath = join(memoryRoot, "concepts", "memsphere-personalized-software.yaml");
    await rm(personalizedSoftwarePath);
    const legacyTargets = [
      {
        relativePath: join("concepts", "memsphere-framework.yaml"),
        source: `!concept
syntax: ${currentMemorySyntax}
names: [memsphere-framework, Memsphere]
defines:
  - Legacy framework definition.
`
      },
      {
        relativePath: join("procedures", "memsphere-tutorial-chapter-01.yaml"),
        source: `!procedure
syntax: ${currentMemorySyntax}
names: [memsphere-tutorial-chapter-01]
defines:
  - Legacy tutorial definition.
flow:
  - !action
    action: Explain the legacy tutorial.
    artifact: !artifact
      name: Legacy explanation
`
      }
    ];
    for (const { relativePath, source } of legacyTargets) {
      await writeFile(join(memoryRoot, relativePath), source);
    }
    await runGit(["add", "-A"], { cwd: memoryRoot });
    await runGit(["commit", "-m", "Simulate Project created before new System Memory"], { cwd: memoryRoot });
    const legacyRevision = await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot }).then((result) => result.stdout);
    const legacyConfigPath = join(projectRoot, "config.json");
    const legacyConfig = JSON.parse(await readFile(legacyConfigPath, "utf8"));
    legacyConfig.store.published_revision = legacyRevision;
    await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
    await assert.rejects(access(personalizedSoftwarePath), /ENOENT/);

    const localEdit = await editMemories({ references: ["concepts/memsphere-memory"] });
    const localTarget = localEdit.change.targets[0];
    const localCandidate = join(localEdit.candidateRoot, localTarget.path);
    await writeFile(localCandidate, `${await readFile(localCandidate, "utf8")}\n# local divergence\n`);
    await publishMemoryChange(localEdit.change.id, "Diverge System Memory for test");

    await projectRepairCommand("existing");
    assert.equal(await prepareManagedSystemMemoryChange("existing"), undefined);
    for (const relativePath of [
      join("concepts", "memsphere-personalized-software.yaml"),
      ...legacyTargets.map((target) => target.relativePath)
    ]) {
      assert.equal(
        await readFile(join(memoryRoot, relativePath), "utf8"),
        await readFile(join(bundledSystemMemoryRoot(), relativePath), "utf8")
      );
    }
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

    const manifest = await readReservedMemoryManifest();
    const missingPath = manifest.system_memory.install[0];
    const driftedPath = manifest.system_memory.install[1];
    const legacyPath = "concepts/memory.yaml";
    const mixedChangesBefore = await changeIds(projectRoot);
    const commitsBeforeMixedRepair = Number(await runGit(
      ["rev-list", "--count", "HEAD"],
      { cwd: join(projectRoot, "memory") }
    ).then((result) => result.stdout));
    await rm(join(projectRoot, "memory", missingPath));
    await writeFile(
      join(projectRoot, "memory", driftedPath),
      `${await readFile(join(projectRoot, "memory", driftedPath), "utf8")}\n# mixed divergence\n`
    );
    await writeFile(
      join(projectRoot, "memory", legacyPath),
      withCurrentMemorySyntax("!concept\nnames: [legacy-memory]\ndefines: [Unlisted user Memory.]\n")
    );
    await publishDirectStoreCommit(projectRoot, "Create mixed System Memory repair fixture");

    const mixedOutput = await captureProjectRepair("existing");
    assert(mixedOutput.includes("System Memory changes: 1 create, 1 update, 0 delete"));
    const mixedChange = await readOnlyNewChange(projectRoot, mixedChangesBefore);
    assert.equal(mixedChange.record.status, "completed");
    assert.deepEqual(
      mixedChange.record.targets.map((target: { operation: string }) => target.operation).sort(),
      ["create", "update"]
    );
    assert.equal(
      Number(await runGit(["rev-list", "--count", "HEAD"], { cwd: join(projectRoot, "memory") })
        .then((result) => result.stdout)),
      commitsBeforeMixedRepair + 2
    );
    assert.deepEqual(
      await readFile(join(projectRoot, "memory", missingPath)),
      await readFile(join(bundledSystemMemoryRoot(), missingPath))
    );
    assert.deepEqual(
      await readFile(join(projectRoot, "memory", driftedPath)),
      await readFile(join(bundledSystemMemoryRoot(), driftedPath))
    );
    assert.match(await readFile(join(projectRoot, "memory", legacyPath), "utf8"), /Unlisted user Memory/);
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

test("Managed System Memory repair updates canonical identity at its current storage path", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-repair-identity-path-"));
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

    await managedProjectFixture("identity-path", { bind: true });
    const registry = await readProjectRegistry(home);
    const projectRoot = registry.projects["identity-path"].root;
    const memoryRoot = join(projectRoot, "memory");
    const originalPath = (await readReservedMemoryManifest()).system_memory.install[0];
    const currentPath = posix.join(posix.dirname(originalPath), "relocated-system-memory.yaml");
    await runGit(["mv", originalPath, currentPath], { cwd: memoryRoot });
    await writeFile(
      join(memoryRoot, currentPath),
      `${await readFile(join(memoryRoot, currentPath), "utf8")}\n# identity path divergence\n`
    );
    await publishDirectStoreCommit(projectRoot, "Relocate and diverge System Memory");

    const repair = await prepareManagedSystemMemoryChange("identity-path");
    assert(repair);
    assert.equal(repair.created, 0);
    assert.equal(repair.updated, 1);
    assert.equal(repair.deleted, 0);
    assert.equal(repair.change.targets.length, 1);
    assert.equal(repair.change.targets[0].path, currentPath);
    assert.deepEqual((await validateMemoryChange(repair.change.id)).issues, []);
    await publishMemoryChange(repair.change.id, "Repair relocated System Memory");

    assert.deepEqual(
      await readFile(join(memoryRoot, currentPath)),
      await readFile(join(bundledSystemMemoryRoot(), originalPath))
    );
    await assert.rejects(readFile(join(memoryRoot, originalPath)), /ENOENT/);
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

test("System Memory repair honors explicit, global, Primary, and Mounted selection boundaries", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-repair-selection-"));
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
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);

    await managedProjectFixture("primary", { bind: true });
    await managedProjectFixture("mounted", {});
    await managedProjectFixture("explicit", {});
    await projectMountCommand("mounted");
    const registry = await readProjectRegistry(home);
    const systemPath = (await readReservedMemoryManifest()).system_memory.install[0];
    for (const name of ["primary", "mounted", "explicit"]) {
      const projectRoot = registry.projects[name].root;
      const target = join(projectRoot, "memory", systemPath);
      await writeFile(target, `${await readFile(target, "utf8")}\n# ${name} divergence\n`);
      await publishDirectStoreCommit(projectRoot, `Diverge ${name}`);
    }
    const bundled = await readFile(join(bundledSystemMemoryRoot(), systemPath));

    process.env.MEMSPHERE_PROJECT = "mounted";
    await captureProjectRepair("explicit");
    assert.deepEqual(await readFile(join(registry.projects.explicit.root, "memory", systemPath)), bundled);
    assert.match(await readFile(join(registry.projects.mounted.root, "memory", systemPath), "utf8"), /mounted divergence/);
    assert.match(await readFile(join(registry.projects.primary.root, "memory", systemPath), "utf8"), /primary divergence/);

    await captureProjectRepair();
    assert.deepEqual(await readFile(join(registry.projects.mounted.root, "memory", systemPath)), bundled);
    assert.match(await readFile(join(registry.projects.primary.root, "memory", systemPath), "utf8"), /primary divergence/);

    delete process.env.MEMSPHERE_PROJECT;
    await captureProjectRepair();
    assert.deepEqual(await readFile(join(registry.projects.primary.root, "memory", systemPath)), bundled);
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

test("System Memory repair freezes validation and publish failures without changing the formal Store", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-project-repair-failure-"));
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
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);
    await managedProjectFixture("validation-failure", { bind: true });
    await managedProjectFixture("publish-failure", {});
    const registry = await readProjectRegistry(home);
    const systemPath = (await readReservedMemoryManifest()).system_memory.install[0];

    const validationRoot = registry.projects["validation-failure"].root;
    const validationMemoryRoot = join(validationRoot, "memory");
    const validationTarget = join(validationMemoryRoot, systemPath);
    await writeFile(validationTarget, `${await readFile(validationTarget, "utf8")}\n# validation divergence\n`);
    for (const suffix of ["one", "two"]) {
      await writeFile(
        join(validationMemoryRoot, "concepts", `duplicate-${suffix}.yaml`),
        withCurrentMemorySyntax("!concept\nnames: [duplicate-user]\ndefines: [Duplicate fixture.]\n")
      );
    }
    const validationRevision = await publishDirectStoreCommit(validationRoot, "Create invalid catalog fixture");
    const validationConfig = await readFile(join(validationRoot, "config.json"), "utf8");
    const validationChangesBefore = await changeIds(validationRoot);
    await assert.rejects(captureProjectRepair("validation-failure"), /System Memory repair validation failed/);
    assert.equal(await runGit(["rev-parse", "HEAD"], { cwd: validationMemoryRoot }).then((result) => result.stdout), validationRevision);
    assert.equal(await readFile(join(validationRoot, "config.json"), "utf8"), validationConfig);
    assert.match(await readFile(validationTarget, "utf8"), /validation divergence/);
    const validationFailure = await readOnlyNewChange(validationRoot, validationChangesBefore);
    assert.equal(validationFailure.record.status, "abandoned");
    assert.equal(validationFailure.record.failure.stage, "validate");
    assert.equal(validationFailure.record.checkpoint.valid, false);
    assert(validationFailure.record.checkpoint.issues.length > 0);
    await assert.rejects(access(join(workspace, ".memsphere-work", "changes", validationFailure.id)));

    const publishRoot = registry.projects["publish-failure"].root;
    const publishMemoryRoot = join(publishRoot, "memory");
    const publishTarget = join(publishMemoryRoot, systemPath);
    await writeFile(publishTarget, `${await readFile(publishTarget, "utf8")}\n# publish divergence\n`);
    const publishRevision = await publishDirectStoreCommit(publishRoot, "Create publish failure fixture");
    const publishConfig = await readFile(join(publishRoot, "config.json"), "utf8");
    const publishChangesBefore = await changeIds(publishRoot);
    const preCommit = join(publishMemoryRoot, ".git", "hooks", "pre-commit");
    await writeFile(preCommit, "#!/bin/sh\nexit 1\n");
    await chmod(preCommit, 0o755);
    await assert.rejects(captureProjectRepair("publish-failure"));
    assert.equal(await runGit(["rev-parse", "HEAD"], { cwd: publishMemoryRoot }).then((result) => result.stdout), publishRevision);
    assert.equal(await readFile(join(publishRoot, "config.json"), "utf8"), publishConfig);
    assert.match(await readFile(publishTarget, "utf8"), /publish divergence/);
    assert.equal(await runGit(["status", "--porcelain"], { cwd: publishMemoryRoot }).then((result) => result.stdout), "");
    const publishFailure = await readOnlyNewChange(publishRoot, publishChangesBefore);
    assert.equal(publishFailure.record.status, "abandoned");
    assert.equal(publishFailure.record.failure.stage, "publish");
    assert.equal(publishFailure.record.checkpoint.valid, true);
    assert.deepEqual(publishFailure.record.checkpoint.issues, []);
    await assert.rejects(access(join(workspace, ".memsphere-work", "changes", publishFailure.id)));
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
