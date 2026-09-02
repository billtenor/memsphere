import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runStartCommand } from "../src/commands/run.js";
import { createMemoryCommandCatalog } from "../src/commands/memory.js";
import { projectCreateCommand } from "../src/commands/project.js";
import { runGit } from "../src/git.js";
import { abandonMemoryChange, editMemories, validateMemoryChange } from "../src/memory/changeset.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { listRuns } from "../src/run/store.js";

const procedure = (instruction: string) => `!procedure
syntax: ${currentMemorySyntax}
names: [candidate-run]
flow:
  - !action
    action: ${instruction}
    artifact: !artifact
      name: result
`;

const statement = (rule: string) => `!statement
syntax: ${currentMemorySyntax}
names: [candidate-rule]
asserts:
  - ${rule}
`;

async function silently(action: () => Promise<void>): Promise<void> {
  const original = console.log;
  console.log = () => undefined;
  try {
    await action();
  } finally {
    console.log = original;
  }
}

test("Managed Run can start from a validated active ChangeSet without publishing it", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-managed-change-run-"));
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
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "managed";
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.chdir(workspace);
    await silently(() => projectCreateCommand("managed", { bind: true }));

    const edited = await editMemories({
      references: ["procedures/candidate-run", "statements/candidate-rule"],
      createPaths: new Map([
        ["procedures/candidate-run", "procedures/candidate-run.yaml"],
        ["statements/candidate-rule", "statements/candidate-rule.yaml"]
      ])
    });
    await writeFile(join(edited.candidateRoot, "procedures", "candidate-run.yaml"), procedure("Run the managed candidate."));
    await writeFile(join(edited.candidateRoot, "statements", "candidate-rule.yaml"), statement("Use the first checkpoint."));
    const validation = await validateMemoryChange(edited.change.id);
    assert.deepEqual(validation.issues, []);

    await assert.rejects(
      silently(() => runStartCommand("candidate-run", { name: "Published source" })),
      /was not found in procedures/
    );
    await silently(() => runStartCommand("candidate-run", {
      name: "Managed candidate source",
      change: edited.change.id
    }));

    const registry = await readProjectRegistry(home);
    const runs = await listRuns(join(registry.projects.managed.root, "runs"));
    const run = runs.find((candidate) => candidate.name === "Managed candidate source");
    assert(run);
    assert.equal(run.stack[0]?.steps[0]?.instruction, "Run the managed candidate.");
    assert.deepEqual(run.memorySource, {
      kind: "changeset",
      project: "managed",
      changeId: edited.change.id,
      checkpointDigest: validation.checkpointDigest,
      baseRevision: edited.change.base_revision
    });
    assert.equal(
      run.memoryProjects?.primary.revision,
      `changeset:${edited.change.id}@${validation.checkpointDigest}`
    );
    assert.deepEqual(run.memorySnapshot, { path: "memory" });
    const frozenCatalog = await createMemoryCommandCatalog(run.id);
    assert.deepEqual((await frozenCatalog.read("candidate-rule", { kind: "statements" })).asserts, [
      "Use the first checkpoint."
    ]);

    await writeFile(join(edited.candidateRoot, "procedures", "candidate-run.yaml"), procedure("Run the newer checkpoint."));
    await writeFile(join(edited.candidateRoot, "statements", "candidate-rule.yaml"), statement("Use the newer checkpoint."));
    const newerValidation = await validateMemoryChange(edited.change.id);
    assert.notEqual(newerValidation.checkpointDigest, validation.checkpointDigest);
    const frozenRun = (await listRuns(join(registry.projects.managed.root, "runs")))
      .find((candidate) => candidate.name === "Managed candidate source");
    assert.equal(frozenRun?.stack[0]?.steps[0]?.instruction, "Run the managed candidate.");
    assert.equal(frozenRun?.memorySource?.checkpointDigest, validation.checkpointDigest);
    assert.deepEqual((await frozenCatalog.read("candidate-rule", { kind: "statements" })).asserts, [
      "Use the first checkpoint."
    ]);

    await silently(() => runStartCommand("candidate-run", {
      name: "Newer managed candidate source",
      change: edited.change.id
    }));
    const newerRun = (await listRuns(join(registry.projects.managed.root, "runs")))
      .find((candidate) => candidate.name === "Newer managed candidate source");
    assert(newerRun);
    const newerCatalog = await createMemoryCommandCatalog(newerRun.id);
    assert.deepEqual((await newerCatalog.read("candidate-rule", { kind: "statements" })).asserts, [
      "Use the newer checkpoint."
    ]);

    await abandonMemoryChange({ home, project: "managed", changeId: edited.change.id });
    await assert.rejects(
      silently(() => runStartCommand("candidate-run", {
        name: "Terminal source",
        change: edited.change.id
      })),
      /is not active/
    );

    const unvalidated = await editMemories({
      references: ["procedures/unvalidated-run"],
      createPaths: new Map([["procedures/unvalidated-run", "procedures/unvalidated-run.yaml"]])
    });
    await assert.rejects(
      silently(() => runStartCommand("unvalidated-run", {
        name: "Unvalidated source",
        change: unvalidated.change.id
      })),
      /has no validated checkpoint/
    );
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

test("Embedded Run uses the selected ChangeSet instead of the current worktree Memory", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-change-run-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const memoryRoot = join(main, ".memsphere", "memory");
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
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "embedded";
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    await runGit(["init", "-b", "master"], { cwd: main });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(memoryRoot, kind), { recursive: true });
    }
    await writeFile(join(memoryRoot, "procedures", "candidate-run.yaml"), procedure("Run the main worktree version."));
    await runGit(["add", ".memsphere/memory"], { cwd: main });
    await runGit(["commit", "-m", "embedded run fixture"], { cwd: main });
    process.chdir(main);
    await silently(() => projectCreateCommand("embedded", { embedded: memoryRoot, bind: true }));
    await runGit(["worktree", "add", "-b", "candidate", linked], { cwd: main });
    await writeFile(
      join(linked, ".memsphere", "memory", "procedures", "candidate-run.yaml"),
      procedure("Run the ChangeSet version.")
    );
    process.chdir(linked);
    const validation = await validateMemoryChange();
    assert.deepEqual(validation.issues, []);

    process.chdir(main);
    await silently(() => runStartCommand("candidate-run", { name: "Embedded worktree source" }));
    process.chdir(linked);
    await silently(() => runStartCommand("candidate-run", {
      name: "Embedded candidate source",
      change: validation.changeId
    }));

    const registry = await readProjectRegistry(home);
    const runs = await listRuns(join(registry.projects.embedded.root, "runs"));
    const formalRun = runs.find((candidate) => candidate.name === "Embedded worktree source");
    const candidateRun = runs.find((candidate) => candidate.name === "Embedded candidate source");
    assert.equal(formalRun?.stack[0]?.steps[0]?.instruction, "Run the main worktree version.");
    assert.equal(candidateRun?.stack[0]?.steps[0]?.instruction, "Run the ChangeSet version.");
    assert.equal(candidateRun?.memorySource?.changeId, validation.changeId);
    assert.equal(candidateRun?.memorySource?.checkpointDigest, validation.checkpointDigest);
    assert.deepEqual(candidateRun?.memorySnapshot, { path: "memory" });
    assert.equal(
      await readFile(join(registry.projects.embedded.root, "runs", candidateRun!.id, "memory", "procedures", "candidate-run.yaml"), "utf8"),
      procedure("Run the ChangeSet version.")
    );
    await writeFile(
      join(linked, ".memsphere", "memory", "procedures", "candidate-run.yaml"),
      procedure("Run a later worktree version.")
    );
    const candidateCatalog = await createMemoryCommandCatalog(candidateRun!.id);
    assert.equal(
      (await candidateCatalog.read("candidate-run", { kind: "procedures" }) as { flow: Array<{ action: string }> })
        .flow[0]?.action,
      "Run the ChangeSet version."
    );
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
