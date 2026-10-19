import assert from "node:assert/strict";
import { chmod, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyEmbeddedSystemMemoryRepair, prepareEmbeddedSystemMemoryRepair } from "../src/commands/project.js";
import { alterDefinition, definitionPath, embeddedFixture, fixture, memoryPath } from "./helpers/project-upgrade.js";

test("Embedded upgrade CLI isolates original user differences and creates a retryable dedicated ChangeSet", async () => {
  const f = await fixture();
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    await alterDefinition(project);
    const userPath = join(memoryRoot, "concepts/user.yaml");
    const dirtyUser = `${await readFile(userPath, "utf8")}\n# Work in progress\n`;
    await writeFile(userPath, dirtyUser);
    const captured = f.run(["memory", "change", "validate"]);
    assert.equal(captured.status, 0, captured.stderr || captured.stdout);
    const ordinaryIds = await readdir(join(project, "changes"));
    assert.equal(ordinaryIds.length, 1);
    const ordinaryPath = join(project, "changes", ordinaryIds[0]!, "change.json");
    const ordinaryBefore = await readFile(ordinaryPath, "utf8");
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const head = f.git(["rev-parse", "HEAD"], linked);
    const { result, value } = f.upgrade("embedded", [], linked);
    assert.equal(result.status, 0, JSON.stringify(value));
    assert.equal(value.memory.integrationStatus, "pending");
    assert.equal(value.models.status, "upgraded");
    const id = value.memory.changeSet.id;
    assert.notEqual(id, ordinaryIds[0]);
    const dedicated = JSON.parse(await readFile(join(project, "changes", id, "change.json"), "utf8"));
    assert.equal(dedicated.intent, "system_upgrade");
    assert.deepEqual(dedicated.targets.map((target: { path: string }) => target.path), [memoryPath]);
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head, "Command does not commit");
    assert.equal(await readFile(userPath, "utf8"), dirtyUser);
    assert.equal(await readFile(ordinaryPath, "utf8"), ordinaryBefore);
    const noId = f.upgrade("embedded", [], linked);
    assert.notEqual(noId.result.status, 0);
    assert.match(noId.value.failure.message, new RegExp(id));
    const retry = f.upgrade("embedded", ["--change", id], linked);
    assert.equal(retry.result.status, 0, JSON.stringify(retry.value));
    const wrongWorktree = f.upgrade("embedded", ["--change", id]);
    assert.notEqual(wrongWorktree.result.status, 0);
    assert.equal(wrongWorktree.value.models.status, "not_run");
    const upgradePath = join(linked, ".memsphere/memory", memoryPath);
    const upgradedBytes = await readFile(upgradePath, "utf8");
    f.git(["restore", "--", ".memsphere/memory"], linked);
    const rollback = f.upgrade("embedded", ["--change", id], linked);
    assert.notEqual(rollback.result.status, 0, "Reverting to valid old baseline must not report success");
    assert.equal(rollback.value.overall, "failed");
    const validate = f.run(["memory", "change", "validate", id], linked);
    assert.notEqual(validate.status, 0, "Direct validation also rejects rollback");
    await writeFile(upgradePath, upgradedBytes);
    assert.equal(f.upgrade("embedded", ["--change", id], linked).result.status, 0);
    assert.equal(await readFile(ordinaryPath, "utf8"), ordinaryBefore);
    f.git(["add", "--", ".memsphere/memory"], linked);
    f.git(["commit", "-m", "Upgrade System Memory only"], linked);
    assert.deepEqual(f.git(["show", "--format=", "--name-only", "HEAD"], linked).split("\n"), [`.memsphere/memory/${memoryPath}`]);
    assert.equal(JSON.parse(await readFile(join(project, "changes", id, "change.json"), "utf8")).status, "active", "A commit is not integration");
  } finally { await f.cleanup(); }
});

test("Embedded upgrade CLI refuses main-only, master, detached and dirty Memory before model writes", async () => {
  for (const boundary of ["main", "master", "detached", "dirty"] as const) {
    const f = await fixture();
    try {
      const { project, memoryRoot } = await embeddedFixture(f, boundary === "main" ? "main" : "master");
      await alterDefinition(project);
      const modelBefore = await readFile(join(project, definitionPath), "utf8");
      let upgradeWorkspace = f.workspace;
      if (boundary === "detached" || boundary === "dirty") {
        upgradeWorkspace = join(f.root, "upgrade-worktree");
        f.git(["worktree", "add", "-b", "upgrade/system", upgradeWorkspace, "master"]);
      }
      const upgradeMemory = join(upgradeWorkspace, ".memsphere/memory");
      if (boundary === "detached") f.git(["checkout", "--detach"], upgradeWorkspace);
      if (boundary === "dirty") {
        await writeFile(join(upgradeMemory, "concepts/user.yaml"), `${await readFile(join(upgradeMemory, "concepts/user.yaml"), "utf8")}\n# dirty\n`);
      }
      const memoryBefore = await readFile(join(memoryRoot, memoryPath), "utf8");
      const failed = f.upgrade("embedded", [], upgradeWorkspace);
      assert.notEqual(failed.result.status, 0, boundary);
      assert.equal(failed.value.failure.stage, "preflight", boundary);
      assert.equal(failed.value.models.status, "not_run", boundary);
      assert.equal(await readFile(join(project, definitionPath), "utf8"), modelBefore);
      assert.equal(await readFile(join(memoryRoot, memoryPath), "utf8"), memoryBefore);
      assert.deepEqual(await readdir(join(project, "changes")), []);
    } finally { await f.cleanup(); }
  }
});

test("Embedded upgrade CLI rolls back Memory when dedicated record creation fails and can restart cleanly", {
  skip: process.platform === "win32" || process.getuid?.() === 0
    ? "Requires POSIX permissions enforced for a non-root user" : false
}, async () => {
  const f = await fixture();
  let changesRoot: string | undefined;
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    await alterDefinition(project);
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const target = join(linked, ".memsphere/memory", memoryPath);
    const baseline = await readFile(target, "utf8");
    const head = f.git(["rev-parse", "HEAD"], linked);
    changesRoot = join(project, "changes");
    const recordsBefore = await readdir(changesRoot);
    await chmod(changesRoot, 0o555);
    const failed = f.upgrade("embedded", [], linked);
    assert.notEqual(failed.result.status, 0, JSON.stringify(failed.value));
    assert.equal(failed.value.overall, "failed");
    assert.equal(failed.value.models.status, "upgraded");
    assert.equal(failed.value.memory.status, "failed");
    assert.equal(failed.value.failure.stage, "memory");
    assert.match(failed.value.failure.message, /EACCES|EPERM|permission/i);
    assert.equal(failed.value.memory.changeSet, undefined, "No record ID may be claimed before persistence");
    assert.equal(await readFile(target, "utf8"), baseline, "Failed record creation must restore applied targets");
    assert.equal(await readFile(join(memoryRoot, memoryPath), "utf8"), baseline, "Original worktree is untouched");
    assert.equal(f.git(["status", "--porcelain", "--", ".memsphere/memory"], linked), "", "No orphaned upgrade diff blocks restart");
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head);
    assert.deepEqual(await readdir(changesRoot), recordsBefore);
    await chmod(changesRoot, 0o755);
    const retry = f.upgrade("embedded", [], linked);
    assert.equal(retry.result.status, 0, JSON.stringify(retry.value));
    assert.equal(retry.value.models.status, "unchanged");
    assert.equal(retry.value.memory.status, "upgraded");
    assert.equal(retry.value.memory.integrationStatus, "pending");
    assert.equal(retry.value.memory.changeSet.intent, "system_upgrade");
    assert.equal(retry.value.memory.changeSet.validation, "passed");
    const change = JSON.parse(await readFile(join(changesRoot, retry.value.memory.changeSet.id, "change.json"), "utf8"));
    assert.equal(change.status, "active");
    assert.equal(change.checkpoint.valid, true);
    assert.deepEqual(change.targets.map((item: { path: string }) => item.path), [memoryPath]);
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head);
  } finally {
    if (changesRoot) await chmod(changesRoot, 0o755);
    await f.cleanup();
  }
});

test("Embedded repair API restores updated and created targets when the afterApply callback fails", async () => {
  const f = await fixture();
  const previousCwd = process.cwd();
  const environmentKeys = ["MEMSPHERE_HOME", "MEMSPHERE_PROJECT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"] as const;
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    const createdPath = "concepts/memsphere-memory.yaml";
    await rm(join(memoryRoot, createdPath));
    f.git(["add", "--", ".memsphere/memory"]);
    f.git(["commit", "-m", "Previous bundle lacked a system file"]);
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    process.env.MEMSPHERE_HOME = f.home;
    delete process.env.MEMSPHERE_PROJECT;
    process.env.GIT_CONFIG_GLOBAL = f.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.chdir(linked);
    const target = join(linked, ".memsphere/memory", memoryPath);
    const createdTarget = join(linked, ".memsphere/memory", createdPath);
    const baseline = await readFile(target, "utf8");
    const recordsBefore = await readdir(join(project, "changes"));
    const prepared = await prepareEmbeddedSystemMemoryRepair("embedded");
    assert.ok(prepared);
    assert.ok(prepared.created > 0);
    assert.ok(prepared.updated > 0);
    let invoked = false;
    await assert.rejects(applyEmbeddedSystemMemoryRepair(prepared, { afterApply: async () => {
      invoked = true;
      assert.notEqual(await readFile(target, "utf8"), baseline, "Callback runs after actual file writes");
      assert.ok(await readFile(createdTarget, "utf8"));
      throw new Error("Injected dedicated record persistence failure");
    } }), /Injected dedicated record persistence failure/);
    assert.equal(invoked, true);
    assert.equal(await readFile(target, "utf8"), baseline);
    await assert.rejects(readFile(createdTarget), { code: "ENOENT" });
    assert.equal(f.git(["status", "--porcelain", "--", ".memsphere/memory"], linked), "");
    assert.deepEqual(await readdir(join(project, "changes")), recordsBefore);
  } finally {
    process.chdir(previousCwd);
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await f.cleanup();
  }
});
