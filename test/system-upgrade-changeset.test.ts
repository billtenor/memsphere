import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCreateCommand } from "../src/commands/project.js";
import { gitOutput, runGit } from "../src/git.js";
import { resolveProjectContext } from "../src/project/resolver.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { managedProjectFixture } from "./helpers/project.js";
import * as changes from "../src/memory/changeset.js";
import { systemMemoryRemovalDigest } from "../src/reserved/store.js";

const reference = "concepts/shared";
const path = "concepts/shared.yaml";
const baseline = `!concept\nsyntax: ${currentMemorySyntax}\nnames: [shared]\ndefines: [Published]\n`;
const content = baseline.replace("Published", "Upgraded");
const targets: changes.SystemUpgradeMemoryTarget[] = [{ reference, path, operation: "update", content }];

async function fixture(store: "embedded" | "managed", run: (main: string, linked: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "system-upgrade-changeset-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, config: process.env.GIT_CONFIG_GLOBAL };
  const main = join(root, "main"), linked = join(root, "linked");
  try {
    await mkdir(main);
    const config = join(root, "gitconfig");
    await writeFile(config, "[user]\n name = Test\n email = test@example.invalid\n");
    process.env.GIT_CONFIG_GLOBAL = config; process.env.MEMSPHERE_HOME = join(root, "home"); process.env.MEMSPHERE_PROJECT = "test";
    await runGit(["init", "-b", "master"], { cwd: main }); process.chdir(main);
    if (store === "embedded") {
      const memory = join(main, ".memsphere/memory");
      for (const kind of ["concepts", "statements", "schemas", "procedures"]) await mkdir(join(memory, kind), { recursive: true });
      await writeFile(join(memory, path), baseline);
      await runGit(["add", "."], { cwd: main }); await runGit(["commit", "-m", "baseline"], { cwd: main });
      await projectCreateCommand("test", { embedded: memory, bind: true });
      // Bootstrap installation may update the initial tree; freeze the full baseline.
      await runGit(["add", "."], { cwd: main });
      await runGit(["commit", "--allow-empty", "-m", "installed baseline"], { cwd: main });
    } else {
      await managedProjectFixture("test", { bind: true });
      const context = await resolveProjectContext();
      await writeFile(join(context.primary.memoryRoot, path), baseline);
      await runGit(["add", "."], { cwd: context.primary.memoryRoot });
      await runGit(["commit", "-m", "test concept"], { cwd: context.primary.memoryRoot });
      const configPath = context.primary.paths.configPath;
      const cfg = JSON.parse(await readFile(configPath, "utf8"));
      cfg.store.published_revision = await gitOutput(["rev-parse", "HEAD"], context.primary.memoryRoot);
      await writeFile(configPath, JSON.stringify(cfg));
      await writeFile(join(main, "baseline"), "baseline"); await runGit(["add", "."], { cwd: main }); await runGit(["commit", "-m", "baseline"], { cwd: main });
    }
    await runGit(["worktree", "add", "-b", "upgrade", linked], { cwd: main });
    await run(main, linked);
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries({ MEMSPHERE_HOME: previous.home, MEMSPHERE_PROJECT: previous.project, GIT_CONFIG_GLOBAL: previous.config })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

function rejectedOperations(changeId: string, home: string) {
  const actor = { kind: "human" as const, id: "test", name: "Test" };
  const common = { home, project: "test", changeId };
  return [
    ["claim", () => changes.claimMemoryChange({ changeId })],
    ["force claim", () => changes.claimMemoryChange({ changeId, force: true })],
    ["scope", () => changes.addMemoryChangeScope({ ...common, reference })],
    ["edit", () => changes.editMemories({ references: [reference], changeId })],
    ["delete", () => changes.editMemories({ references: [reference], operation: "delete", changeId })],
    ["identity edit", () => changes.editMemoriesByIdentity({ targets: [{ reference, path, operation: "update", baseDigest: "digest" }], changeId })],
    ["identity delete", () => changes.deleteMemoriesByIdentity({ targets: [{ reference, path, baseDigest: "digest" }], changeId })],
    ["rename", () => changes.renameMemory({ reference, newName: "other", changeId })],
    ["resume", () => changes.resumeMemoryChange(changeId)],
    ["finish", () => changes.finishMemoryChange({ changeId })],
    ["publish", () => changes.publishMemoryChange(changeId)],
    ["complete", () => changes.completeMemoryChange(changeId)],
    ["fail", () => changes.failMemoryChange(changeId, "validate", new Error("failure"))],
    ["comment create", () => changes.createMemoryChangeComment({ ...common, actor, memoryReference: reference, path, body: "comment" })],
    ["comment update", () => changes.updateMemoryChangeComment({ ...common, actor, commentId: "missing", body: "comment" })],
    ["comment delete", () => changes.deleteMemoryChangeComment({ ...common, actor, commentId: "missing" })]
  ] as const;
}

for (const store of ["managed", "embedded"] as const) {
  test(`${store}: dedicated records reject every general write entry in both worktrees before mutation`, async () => fixture(store, async (main, linked) => {
    process.chdir(linked);
    const context = await resolveProjectContext();
    await changes.assertSystemUpgradeWorkspace(context);
    if (store === "embedded") await writeFile(join(context.primary.memoryRoot, path), content);
    const created = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
    const file = join(context.primary.paths.changesRoot, created.change.id, "change.json");
    const original = await readFile(file, "utf8");
    const originalMemory = await readFile(join(context.primary.memoryRoot, path), "utf8");
    for (const cwd of [linked, main]) {
      process.chdir(cwd);
      for (const [name, operation] of rejectedOperations(created.change.id, context.home)) {
        await assert.rejects(operation, undefined, `${cwd}: ${name}`);
        assert.equal(await readFile(file, "utf8"), original, `${name} changed record`);
        assert.equal(await readFile(join(context.primary.memoryRoot, path), "utf8"), originalMemory, `${name} changed Memory`);
      }
    }
    process.chdir(linked);
    const result = await changes.validateMemoryChange(created.change.id);
    assert.deepEqual(result.issues, []);
    process.chdir(main);
    await assert.rejects(changes.validateMemoryChange(created.change.id), /another worktree/);
    const abandoned = await changes.abandonMemoryChange({ project: "test", home: context.home, changeId: created.change.id });
    assert.equal(abandoned.status, "abandoned");
    await changes.archiveMemoryChange({ project: "test", home: context.home, changeId: created.change.id });
  }));
}

test("Embedded frozen targets cannot disappear, revert, change version or expand; ordinary same-HEAD records remain unchanged", async () => fixture("embedded", async (main, linked) => {
  const ordinaryContext = await resolveProjectContext();
  await writeFile(join(ordinaryContext.primary.memoryRoot, path), baseline.replace("Published", "User edit"));
  const ordinary = await changes.validateMemoryChange();
  const userRecord = join(ordinaryContext.primary.paths.changesRoot, ordinary.changeId, "change.json");
  await changes.addMemoryChangeScope({ project: "test", changeId: ordinary.changeId, reference });
  await changes.createMemoryChangeComment({ project: "test", changeId: ordinary.changeId,
    actor: { kind: "human", id: "test", name: "Test" }, memoryReference: reference, path, body: "User review" });
  await changes.claimMemoryChange({ changeId: ordinary.changeId });
  const userBytes = await readFile(userRecord, "utf8");
  process.chdir(linked);
  const context = await resolveProjectContext();
  await changes.assertSystemUpgradeWorkspace(context);
  await writeFile(join(context.primary.memoryRoot, path), content);
  const { change } = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
  assert.notEqual(change.id, ordinary.changeId);
  await assert.rejects(changes.validateMemoryChange(), /Use memsphere memory change validate/);
  await changes.validateMemoryChange(change.id);
  for (const bad of [baseline, content.replace("Upgraded", "Wrong version")]) {
    await writeFile(join(context.primary.memoryRoot, path), bad);
    await assert.rejects(changes.validateMemoryChange(change.id), /frozen version/);
    await assert.rejects(changes.validateSystemUpgradeRetry({ context, changeId: change.id, targets, sourceDigest: "bundle-v1" }), /frozen version/);
  }
  await writeFile(join(context.primary.memoryRoot, path), content);
  await writeFile(join(context.primary.memoryRoot, "concepts/unrelated.yaml"), baseline.replaceAll("shared", "unrelated"));
  await assert.rejects(changes.validateMemoryChange(change.id), /unauthorized targets/);
  await rm(join(context.primary.memoryRoot, "concepts/unrelated.yaml"));
  await writeFile(join(context.primary.memoryRoot, "README.md"), "Unrelated documentation");
  await assert.rejects(changes.validateMemoryChange(change.id), /unauthorized targets/);
  await rm(join(context.primary.memoryRoot, "README.md"));
  await assert.rejects(changes.validateSystemUpgradeRetry({ context, changeId: change.id, targets, sourceDigest: "bundle-v2" }), /source.*changed/);
  assert.equal(await readFile(userRecord, "utf8"), userBytes);
  await changes.validateMemoryChange(change.id);
  await runGit(["add", ".memsphere/memory"], { cwd: linked }); await runGit(["commit", "-m", "System upgrade only"], { cwd: linked });
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "active");
  // Remove the user workspace difference so integration can proceed. The record itself is never modified.
  await writeFile(join(main, ".memsphere/memory", path), baseline);
  await runGit(["merge", "--ff-only", "upgrade"], { cwd: main });
  process.chdir(main); await runGit(["worktree", "remove", linked], { cwd: main });
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "completed");
}));

test("Dedicated intent and metadata must be paired", () => {
  const base = { format_version: 1, id: "change-test", project: "test", workspace_key: "workspace", base_revision: "base", status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), store_type: "embedded", targets: [] };
  assert.throws(() => changes.memoryChangeSetSchema.parse({ ...base, intent: "system_upgrade" }), /must be paired/);
});

test("System upgrade metadata reads old delete targets and freezes new approved digests", () => {
  const base = { format_version: 1, id: "change-test", project: "test", workspace_key: "workspace", base_revision: "base", status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), store_type: "managed", targets: [], intent: "system_upgrade" };
  const target = { reference: "procedures/legacy", path: "procedures/legacy.yaml", operation: "delete" };
  const metadata = { source_digest: "old-bundle", instance_key: "workspace", targets: [target] };
  assert.equal(changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: metadata }).system_upgrade?.targets[0]?.approvedContentDigest, undefined);
  const digest = "a".repeat(64);
  assert.equal(changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: { ...metadata, targets: [{ ...target, approvedContentDigest: digest }] } }).system_upgrade?.targets[0]?.approvedContentDigest, digest);
  assert.throws(() => changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: { ...metadata, targets: [{ ...target, approvedContentDigest: "invalid" }] } }));
});

test("Embedded preparation rejects original workspace, detached HEAD, dirty Memory and missing master before writes", async () => fixture("embedded", async (main, linked) => {
  await assert.rejects(changes.assertSystemUpgradeWorkspace(await resolveProjectContext()), /separate linked worktree/);
  process.chdir(linked);
  let context = await resolveProjectContext();
  await runGit(["checkout", "--detach"], { cwd: linked });
  await assert.rejects(changes.assertSystemUpgradeWorkspace(context), /detached HEAD/);
  await runGit(["checkout", "upgrade"], { cwd: linked });
  await writeFile(join(context.primary.memoryRoot, path), content);
  await assert.rejects(changes.assertSystemUpgradeWorkspace(context), /existing Memory differences/);
  await writeFile(join(context.primary.memoryRoot, path), baseline);
  await runGit(["branch", "-m", "master", "main"], { cwd: main });
  await assert.rejects(changes.assertSystemUpgradeWorkspace(context), /requires refs\/heads\/master/);
}));

test("Embedded master ancestry alone cannot complete a reverted upgrade; squash integrates by frozen content", async () => fixture("embedded", async (main, linked) => {
  process.chdir(linked);
  const context = await resolveProjectContext();
  await changes.assertSystemUpgradeWorkspace(context);
  await writeFile(join(context.primary.memoryRoot, path), content);
  const { change } = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
  await changes.validateMemoryChange(change.id);
  await runGit(["add", ".memsphere/memory"], { cwd: linked }); await runGit(["commit", "-m", "upgrade"], { cwd: linked });
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "active");
  const base = change.base_revision;
  await runGit(["merge", "--ff-only", "upgrade"], { cwd: main });
  await writeFile(join(main, ".memsphere/memory", path), baseline);
  await runGit(["add", ".memsphere/memory"], { cwd: main }); await runGit(["commit", "-m", "revert target"], { cwd: main });
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "active");
  await runGit(["update-ref", "refs/heads/master", base], { cwd: linked });
  await runGit(["reset", "--hard", "master"], { cwd: main });
  await runGit(["merge", "--squash", "upgrade"], { cwd: main }); await runGit(["commit", "-m", "squashed upgrade"], { cwd: main });
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "completed");
}));

test("Managed dedicated publication validates frozen content, preserves failed evidence and publishes only authorized targets", async () => fixture("managed", async (main, linked) => {
  process.chdir(linked);
  const context = await resolveProjectContext();
  await changes.assertSystemUpgradeWorkspace(context);
  const { change, candidateRoot } = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
  await assert.rejects(changes.validateMemoryChange(), /Use memsphere memory change validate/);
  await writeFile(join(candidateRoot, path), baseline);
  await assert.rejects(changes.publishSystemUpgradeMemoryChange(change.id, { context }), /frozen version/);
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "active");
  assert.equal(await readFile(join(context.primary.memoryRoot, path), "utf8"), baseline);
  await writeFile(join(candidateRoot, path), content);
  const published = await changes.publishSystemUpgradeMemoryChange(change.id, { context });
  assert.equal(published.status, "completed");
  assert.equal(published.checkpoint?.valid, true);
  assert.equal(await readFile(join(context.primary.memoryRoot, path), "utf8"), content);
  await assert.rejects(changes.validateSystemUpgradeRetry({ context, changeId: change.id, targets, sourceDigest: "bundle-v1" }), /already completed/);
}));

test("Managed repair deletion rejects a content change between planning and ChangeSet creation", async () => fixture("managed", async (_main, linked) => {
  process.chdir(linked);
  const context = await resolveProjectContext();
  const source = join(context.primary.memoryRoot, path);
  const approvedContentDigest = systemMemoryRemovalDigest(Buffer.from(baseline));
  const custom = `${baseline}# user customization\n`;
  await writeFile(source, custom);
  await runGit(["add", path], { cwd: context.primary.memoryRoot });
  await runGit(["commit", "-m", "user customized target"], { cwd: context.primary.memoryRoot });
  const configPath = context.primary.paths.configPath;
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = await gitOutput(["rev-parse", "HEAD"], context.primary.memoryRoot);
  await writeFile(configPath, JSON.stringify(config));
  const currentDigest = await gitOutput(["hash-object", source], context.primary.memoryRoot);
  const changesBefore = await readdir(context.primary.paths.changesRoot);
  await assert.rejects(changes.deleteMemoriesByIdentity({
    targets: [{ reference, path, baseDigest: currentDigest, approvedContentDigest }]
  }), /content changed before deletion/);
  assert.equal(await readFile(source, "utf8"), custom);
  assert.deepEqual(await readdir(context.primary.paths.changesRoot), changesBefore);
}));

test("Managed system upgrade preserves a customized target after its frozen base becomes stale", async () => fixture("managed", async (_main, linked) => {
  process.chdir(linked);
  const context = await resolveProjectContext();
  await changes.assertSystemUpgradeWorkspace(context);
  const target: changes.SystemUpgradeMemoryTarget = { reference, path, operation: "delete", approvedContentDigest: systemMemoryRemovalDigest(Buffer.from(baseline)) };
  const { change } = await changes.createSystemUpgradeMemoryChange({ context, targets: [target], sourceDigest: "bundle-v1" });
  assert.deepEqual((await changes.validateMemoryChange(change.id)).issues, []);
  const source = join(context.primary.memoryRoot, path);
  const custom = `${baseline}# user customization\n`;
  await writeFile(source, custom);
  await runGit(["add", path], { cwd: context.primary.memoryRoot });
  await runGit(["commit", "-m", "user customized target"], { cwd: context.primary.memoryRoot });
  const configPath = context.primary.paths.configPath;
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = await gitOutput(["rev-parse", "HEAD"], context.primary.memoryRoot);
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(changes.publishSystemUpgradeMemoryChange(change.id, { context }));
  await assert.rejects(changes.validateSystemUpgradeRetry({ context, changeId: change.id, targets: [target], sourceDigest: "bundle-v1" }));
  assert.equal(await readFile(source, "utf8"), custom);
  assert.equal((await changes.readMemoryChange({ project: "test", changeId: change.id })).status, "active");
  await changes.abandonMemoryChange({ project: "test", home: context.home, changeId: change.id });
  const changesBefore = await readdir(context.primary.paths.changesRoot);
  const candidateDirectory = join(linked, ".memsphere-work/changes");
  const candidatesBefore = await readdir(candidateDirectory).catch(() => []);
  await assert.rejects(changes.createSystemUpgradeMemoryChange({ context: await resolveProjectContext(), targets: [target], sourceDigest: "bundle-v1" }), /content changed before ChangeSet creation/);
  assert.deepEqual(await readdir(context.primary.paths.changesRoot), changesBefore);
  assert.deepEqual(await readdir(candidateDirectory).catch(() => []), candidatesBefore);
  await writeFile(source, baseline);
  await runGit(["add", path], { cwd: context.primary.memoryRoot });
  await runGit(["commit", "-m", "restore issued original"], { cwd: context.primary.memoryRoot });
  config.store.published_revision = await gitOutput(["rev-parse", "HEAD"], context.primary.memoryRoot);
  await writeFile(configPath, JSON.stringify(config));
  const retry = await changes.createSystemUpgradeMemoryChange({ context: await resolveProjectContext(), targets: [target], sourceDigest: "bundle-v1" });
  assert.equal(retry.change.status, "active");
}));

test("Embedded system upgrade rejects a stale master before deleting a user-customized target", async () => fixture("embedded", async (main, linked) => {
  const custom = `${baseline}# user customization\n`;
  await writeFile(join(main, ".memsphere/memory", path), custom);
  await runGit(["add", ".memsphere/memory"], { cwd: main });
  await runGit(["commit", "-m", "user customized target"], { cwd: main });
  process.chdir(linked);
  const context = await resolveProjectContext();
  const source = join(context.primary.memoryRoot, path);
  await rm(source);
  const target: changes.SystemUpgradeMemoryTarget = { reference, path, operation: "delete", approvedContentDigest: systemMemoryRemovalDigest(Buffer.from(baseline)) };
  const changesBefore = await readdir(context.primary.paths.changesRoot);
  await assert.rejects(changes.createSystemUpgradeMemoryChange({ context, targets: [target], sourceDigest: "bundle-v1" }));
  assert.deepEqual(await readdir(context.primary.paths.changesRoot), changesBefore);
  assert.equal(await readFile(join(main, ".memsphere/memory", path), "utf8"), custom);
  await writeFile(join(main, ".memsphere/memory", path), baseline);
  await runGit(["add", ".memsphere/memory"], { cwd: main });
  await runGit(["commit", "-m", "restore issued original"], { cwd: main });
  await runGit(["reset", "--hard", "master"], { cwd: linked });
  await rm(source);
  const retry = await changes.createSystemUpgradeMemoryChange({ context: await resolveProjectContext(), targets: [target], sourceDigest: "bundle-v1" });
  assert.equal(retry.change.status, "active");
}));

test("Embedded upgrades without retired-entry removal retain their existing base behavior", async () => fixture("embedded", async (main, linked) => {
  await writeFile(join(main, "unrelated.txt"), "Main branch advanced\n");
  await runGit(["add", "unrelated.txt"], { cwd: main });
  await runGit(["commit", "-m", "unrelated main change"], { cwd: main });
  process.chdir(linked);
  const context = await resolveProjectContext();
  await writeFile(join(context.primary.memoryRoot, path), content);
  const { change } = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
  await changes.assertSystemUpgradeWorkspace(context, change.id);
  assert.deepEqual((await changes.validateMemoryChange(change.id)).issues, []);
}));


for (const store of ["managed", "embedded"] as const) {
  test(`${store}: multiple active system upgrades can coexist in one worktree`, async () => fixture(store, async (_main, linked) => {
    process.chdir(linked);
    const context = await resolveProjectContext();
    if (store === "embedded") await writeFile(join(context.primary.memoryRoot, path), content);
    const first = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
    const second = await changes.createSystemUpgradeMemoryChange({ context, targets, sourceDigest: "bundle-v1" });
    assert.notEqual(first.change.id, second.change.id);
    const active = await changes.listMemoryChanges({ project: "test", home: context.home });
    assert.equal(active.filter(change => change.intent === "system_upgrade" && change.status === "active").length, 2);
  }));
}
