import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCreateCommand } from "../src/commands/project.js";
import { gitOutput, runGit } from "../src/git.js";
import { planMemoryMarketImport } from "../src/market/store.js";
import {
  claimMemoryChange,
  createMarketMemoryChange,
  finishMemoryChange,
  publishMemoryChange,
  readMemoryChange,
  validateMemoryChange,
  withMemoryChangeDetailSnapshot
} from "../src/memory/changeset.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { readProjectRegistry } from "../src/project/registry.js";

type Environment = {
  cwd: string;
  home?: string;
  project?: string;
  gitConfig?: string;
};

function restoreEnvironment(previous: Environment): void {
  process.chdir(previous.cwd);
  if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
  else process.env.MEMSPHERE_HOME = previous.home;
  if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
  else process.env.MEMSPHERE_PROJECT = previous.project;
  if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
}

test("Managed market import stays inactive until its ChangeSet is published", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-managed-market-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const otherWorkspace = join(fixture, "other-workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous: Environment = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "managed";
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.chdir(workspace);
    await projectCreateCommand("managed", { bind: true });
    const project = (await readProjectRegistry(home)).projects.managed;
    assert(project);
    const memoryRoot = join(project.root, "memory");
    const plan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-testing-rules");
    const change = await createMarketMemoryChange({
      home,
      project: "managed",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: plan.targets
    });
    assert.equal(change.intent, "market_import");
    assert.equal(change.status, "active");
    await claimMemoryChange({ changeId: change.id });
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    assert((await readMemoryChange({ home, project: "managed", changeId: change.id })).checkpoint);
    await finishMemoryChange({ changeId: change.id });
    const secondPlan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-development-rules");
    const second = await createMarketMemoryChange({
      home,
      project: "managed",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: secondPlan.targets
    });
    assert.equal(second.id, change.id);
    assert.equal(second.checkpoint, undefined);
    const thirdPlan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-delivery-rules");
    const expanded = await createMarketMemoryChange({
      home,
      project: "managed",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: thirdPlan.targets
    });
    assert.equal(expanded.id, change.id);
    assert.deepEqual(
      new Set(expanded.targets.map((target) => target.reference)),
      new Set([...plan.targets, ...secondPlan.targets, ...thirdPlan.targets].map((target) => target.reference))
    );
    const duplicate = await createMarketMemoryChange({
      home,
      project: "managed",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: plan.targets
    });
    assert.equal(duplicate.id, change.id);
    assert.equal(duplicate.targets.length, expanded.targets.length);
    await assert.rejects(readFile(join(memoryRoot, plan.targets[0]!.path)), /ENOENT/);
    await withMemoryChangeDetailSnapshot({
      home,
      project: "managed",
      changeId: change.id,
      use: async ({ files }) => assert.match(await readFile(files[0]!.path, "utf8"), /!statement/)
    });
    const claimed = await claimMemoryChange({ changeId: change.id });
    assert.match(await readFile(join(claimed.candidateRoot, plan.targets[0]!.path), "utf8"), /!statement/);
    await mkdir(otherWorkspace);
    await runGit(["init", "-b", "master"], { cwd: otherWorkspace });
    process.chdir(otherWorkspace);
    await assert.rejects(validateMemoryChange(change.id), /belongs to another Workspace/);
    await assert.rejects(publishMemoryChange(change.id), /belongs to another Workspace/);
    process.chdir(workspace);
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    const published = await publishMemoryChange(change.id);
    assert.equal(published.status, "completed");
    assert.match(await readFile(join(memoryRoot, plan.targets[0]!.path), "utf8"), /!statement/);
  } finally {
    restoreEnvironment(previous);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded market publish applies a validated candidate without committing or completing it", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-market-"));
  const home = join(fixture, "home");
  const repository = join(fixture, "repository");
  const memoryRoot = join(repository, ".memsphere", "memory");
  const gitConfig = join(fixture, "gitconfig");
  const previous: Environment = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(join(memoryRoot, "concepts", "base.yaml"), "!concept\nsyntax: memsphere-20260721-stable\nnames: [base]\ndefines: [Base]\n");
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "embedded";
    await runGit(["init", "-b", "master"], { cwd: repository });
    await runGit(["add", ".memsphere/memory"], { cwd: repository });
    await runGit(["commit", "-m", "memory fixture"], { cwd: repository });
    process.chdir(repository);
    await projectCreateCommand("embedded", { embedded: memoryRoot, bind: true });
    const plan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-testing-rules");
    const target = plan.targets[0]!;
    const change = await createMarketMemoryChange({
      home,
      project: "embedded",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: plan.targets
    });
    await assert.rejects(readFile(join(memoryRoot, target.path)), /ENOENT/);
    const claimed = await claimMemoryChange({ changeId: change.id });
    assert.match(await readFile(join(claimed.candidateRoot, target.path), "utf8"), /!statement/);
    await assert.rejects(readFile(join(memoryRoot, target.path)), /ENOENT/);
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    await assert.rejects(readFile(join(memoryRoot, target.path)), /ENOENT/);
    const applied = await publishMemoryChange(change.id);
    assert.equal(applied.status, "active");
    assert.match(await readFile(join(memoryRoot, target.path), "utf8"), /!statement/);
    assert.match(await gitOutput(["status", "--porcelain", "--", `.memsphere/memory/${target.path}`], repository), /^\?\?/);
    assert.equal((await readMemoryChange({ home, project: "embedded", changeId: change.id })).status, "active");

    await finishMemoryChange({ changeId: change.id });
    const secondPlan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-development-rules");
    const secondTarget = secondPlan.targets[0]!;
    const expanded = await createMarketMemoryChange({
      home,
      project: "embedded",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: secondPlan.targets
    });
    assert.equal(expanded.id, change.id);
    await claimMemoryChange({ changeId: change.id });
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    await finishMemoryChange({ changeId: change.id });
    const expandedApplied = await publishMemoryChange(change.id);
    assert.equal(expandedApplied.status, "active");
    assert.match(await readFile(join(memoryRoot, target.path), "utf8"), /!statement/);
    assert.match(await readFile(join(memoryRoot, secondTarget.path), "utf8"), /!statement/);
    assert.equal((await publishMemoryChange(change.id)).status, "active");

    await writeFile(join(memoryRoot, target.path), Buffer.concat([
      await readFile(join(memoryRoot, target.path)),
      Buffer.from("\n# personalized\n")
    ]));
    const thirdPlan = await planMemoryMarketImport(memoryRoot, "statements/memsphere-general-delivery-rules");
    await createMarketMemoryChange({
      home,
      project: "embedded",
      actor: { kind: "human", id: "owner", name: "Owner" },
      targets: thirdPlan.targets
    });
    await claimMemoryChange({ changeId: change.id });
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    await finishMemoryChange({ changeId: change.id });
    await assert.rejects(publishMemoryChange(change.id), /uncommitted changes/);
  } finally {
    restoreEnvironment(previous);
    await rm(fixture, { recursive: true, force: true });
  }
});
