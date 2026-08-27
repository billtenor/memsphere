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
  validateMemoryChange
} from "../src/memory/changeset.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { readProjectRegistry } from "../src/project/registry.js";

type Environment = {
  cwd: string;
  home?: string;
  project?: string;
  gitConfig?: string;
};

type MarketFixture = {
  home: string;
  project: "managed" | "embedded";
  workspace: string;
  memoryRoot: string;
};

function currentEnvironment(): Environment {
  return {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
}

function restoreEnvironment(previous: Environment): void {
  process.chdir(previous.cwd);
  if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
  else process.env.MEMSPHERE_HOME = previous.home;
  if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
  else process.env.MEMSPHERE_PROJECT = previous.project;
  if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
}

async function withManagedMarket(run: (fixture: MarketFixture) => Promise<void>): Promise<void> {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-managed-market-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = currentEnvironment();
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
    await run({ home, project: "managed", workspace, memoryRoot: join(project.root, "memory") });
  } finally {
    restoreEnvironment(previous);
    await rm(fixture, { recursive: true, force: true });
  }
}

async function withEmbeddedMarket(run: (fixture: MarketFixture) => Promise<void>): Promise<void> {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-market-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "repository");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const gitConfig = join(fixture, "gitconfig");
  const previous = currentEnvironment();
  try {
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(
      join(memoryRoot, "concepts", "base.yaml"),
      "!concept\nsyntax: memsphere-20260721-stable\nnames: [base]\ndefines: [Base]\n"
    );
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "embedded";
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    await runGit(["commit", "-m", "memory fixture"], { cwd: workspace });
    process.chdir(workspace);
    await projectCreateCommand("embedded", { embedded: memoryRoot, bind: true });
    await run({ home, project: "embedded", workspace, memoryRoot });
  } finally {
    restoreEnvironment(previous);
    await rm(fixture, { recursive: true, force: true });
  }
}

async function createImport(fixture: MarketFixture, reference: string) {
  const plan = await planMemoryMarketImport(fixture.memoryRoot, reference);
  const change = await createMarketMemoryChange({
    home: fixture.home,
    project: fixture.project,
    actor: { kind: "human", id: "owner", name: "Owner" },
    targets: plan.targets
  });
  return { change, plan };
}

async function validateAndRelease(changeId: string): Promise<void> {
  await claimMemoryChange({ changeId });
  assert.deepEqual((await validateMemoryChange(changeId)).issues, []);
  await finishMemoryChange({ changeId });
}

test("Managed Market import stays inactive until publish completes its ChangeSet", async () => {
  await withManagedMarket(async (fixture) => {
    const { change, plan } = await createImport(fixture, "statements/memsphere-general-testing-rules");
    await validateAndRelease(change.id);

    await assert.rejects(readFile(join(fixture.memoryRoot, plan.targets[0]!.path)), /ENOENT/);
    const published = await publishMemoryChange(change.id);
    assert.equal(published.status, "completed");
    assert.match(await readFile(join(fixture.memoryRoot, plan.targets[0]!.path), "utf8"), /!statement/);
  });
});

test("Managed Market imports aggregate in one active ChangeSet", async () => {
  await withManagedMarket(async (fixture) => {
    const first = await createImport(fixture, "statements/memsphere-general-testing-rules");
    const second = await createImport(fixture, "statements/memsphere-general-development-rules");
    const duplicate = await createImport(fixture, "statements/memsphere-general-testing-rules");

    assert.equal(second.change.id, first.change.id);
    assert.equal(duplicate.change.id, first.change.id);
    assert.deepEqual(
      new Set(duplicate.change.targets.map((target) => target.reference)),
      new Set([...first.plan.targets, ...second.plan.targets].map((target) => target.reference))
    );
  });
});

test("appending a Managed Market import invalidates its validated checkpoint", async () => {
  await withManagedMarket(async (fixture) => {
    const first = await createImport(fixture, "statements/memsphere-general-testing-rules");
    await claimMemoryChange({ changeId: first.change.id });
    assert.deepEqual((await validateMemoryChange(first.change.id)).issues, []);
    assert((await readMemoryChange({
      home: fixture.home,
      project: fixture.project,
      changeId: first.change.id
    })).checkpoint);
    await finishMemoryChange({ changeId: first.change.id });

    const expanded = await createImport(fixture, "statements/memsphere-general-development-rules");
    assert.equal(expanded.change.id, first.change.id);
    assert.equal(expanded.change.checkpoint, undefined);
  });
});

test("Managed Market ChangeSets reject validation and publish from another Workspace", async () => {
  await withManagedMarket(async (fixture) => {
    const { change } = await createImport(fixture, "statements/memsphere-general-testing-rules");
    const otherWorkspace = join(fixture.home, "other-workspace");
    await mkdir(otherWorkspace);
    await runGit(["init", "-b", "master"], { cwd: otherWorkspace });
    process.chdir(otherWorkspace);

    await assert.rejects(validateMemoryChange(change.id), /belongs to another Workspace/);
    await assert.rejects(publishMemoryChange(change.id), /belongs to another Workspace/);
  });
});

test("Embedded Market publish applies without committing or completing the ChangeSet", async () => {
  await withEmbeddedMarket(async (fixture) => {
    const { change, plan } = await createImport(fixture, "statements/memsphere-general-testing-rules");
    const target = plan.targets[0]!;
    await claimMemoryChange({ changeId: change.id });
    assert.deepEqual((await validateMemoryChange(change.id)).issues, []);
    await assert.rejects(readFile(join(fixture.memoryRoot, target.path)), /ENOENT/);

    const applied = await publishMemoryChange(change.id);
    assert.equal(applied.status, "active");
    assert.match(await readFile(join(fixture.memoryRoot, target.path), "utf8"), /!statement/);
    assert.match(
      await gitOutput(["status", "--porcelain", "--", `.memsphere/memory/${target.path}`], fixture.workspace),
      /^\?\?/
    );
    assert.equal((await readMemoryChange({
      home: fixture.home,
      project: fixture.project,
      changeId: change.id
    })).status, "active");
  });
});

test("additional Embedded Market imports can be applied through the same active ChangeSet", async () => {
  await withEmbeddedMarket(async (fixture) => {
    const first = await createImport(fixture, "statements/memsphere-general-testing-rules");
    await claimMemoryChange({ changeId: first.change.id });
    assert.deepEqual((await validateMemoryChange(first.change.id)).issues, []);
    await publishMemoryChange(first.change.id);
    await finishMemoryChange({ changeId: first.change.id });

    const second = await createImport(fixture, "statements/memsphere-general-development-rules");
    assert.equal(second.change.id, first.change.id);
    await validateAndRelease(second.change.id);
    assert.equal((await publishMemoryChange(second.change.id)).status, "active");
    assert.match(await readFile(join(fixture.memoryRoot, first.plan.targets[0]!.path), "utf8"), /!statement/);
    assert.match(await readFile(join(fixture.memoryRoot, second.plan.targets[0]!.path), "utf8"), /!statement/);
  });
});

test("Embedded Market publish rejects a target personalized after its previous apply", async () => {
  await withEmbeddedMarket(async (fixture) => {
    const first = await createImport(fixture, "statements/memsphere-general-testing-rules");
    const target = first.plan.targets[0]!;
    await claimMemoryChange({ changeId: first.change.id });
    assert.deepEqual((await validateMemoryChange(first.change.id)).issues, []);
    await publishMemoryChange(first.change.id);
    await finishMemoryChange({ changeId: first.change.id });
    await writeFile(join(fixture.memoryRoot, target.path), Buffer.concat([
      await readFile(join(fixture.memoryRoot, target.path)),
      Buffer.from("\n# personalized\n")
    ]));

    const expanded = await createImport(fixture, "statements/memsphere-general-delivery-rules");
    await validateAndRelease(expanded.change.id);
    await assert.rejects(publishMemoryChange(expanded.change.id), /uncommitted changes/);
  });
});
