import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { readBundledSystemModels } from "../src/reserved/models.js";
import { applyEmbeddedSystemMemoryRepair, prepareEmbeddedSystemMemoryRepair } from "../src/commands/project.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

const cli = resolve("dist/cli.js");
const memoryPath = "concepts/memsphere-framework.yaml";
const systemModel = readBundledSystemModels().find(model => model.registration.modelRef === "memsphere/model-registration.json")!;
const definitionPath = "models/registrations/system/definitions/json-schema/draft-07/memsphere/model-registration.json";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "memsphere-upgrade-cli-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const gitconfig = join(root, "gitconfig");
  await writeFile(gitconfig, "[user]\n name = Upgrade Test\n email = upgrade@example.invalid\n");
  const env = { ...process.env, HOME: root, USERPROFILE: root, MEMSPHERE_HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.MEMSPHERE_PROJECT;
  const run = (args: string[], cwd = workspace) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
  const git = (args: string[], cwd = workspace) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const create = (name: string, options: string[] = []) => {
    const result = run(["project", "create", name, ...options]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return join(home, "projects", name);
  };
  const upgrade = (name: string, args: string[] = [], cwd = workspace) => {
    const result = run(["project", "upgrade", name, "--output", "json", ...args], cwd);
    assert.ok(result.stdout.trim(), result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(result.stdout.trim().split("\n").length, 1, "JSON stdout is a single object");
    return { result, value };
  };
  return { root, home, workspace, env, run, git, create, upgrade, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function alterDefinition(projectRoot: string) {
  const path = join(projectRoot, definitionPath);
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.description = "Previous supported system definition";
  await writeFile(path, `${JSON.stringify(definition, null, 2)}\n`);
}
async function managedDrift(f: Fixture, projectRoot: string) {
  const path = join(projectRoot, "memory", memoryPath);
  await writeFile(path, `${await readFile(path, "utf8")}\n# Previous bundled version\n`);
  f.git(["add", "."], join(projectRoot, "memory"));
  f.git(["commit", "-m", "Previous published system memory"], join(projectRoot, "memory"));
  const configPath = join(projectRoot, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = f.git(["rev-parse", "HEAD"], join(projectRoot, "memory"));
  await writeFile(configPath, JSON.stringify(config));
}
async function registrations(projectRoot: string) {
  const directory = join(projectRoot, "models/registrations/system/registrations");
  return Promise.all((await readdir(directory)).map(async name => ({ name, path: join(directory, name), bytes: await readFile(join(directory, name), "utf8") })));
}

test("project upgrade CLI upgrades both Managed resources through dedicated publication and repeats without writes", async () => {
  const f = await fixture();
  try {
    const project = f.create("managed");
    const user = join(project, "models/json-schema/draft-07/user.json");
    await mkdir(dirname(user), { recursive: true });
    const userBytes = ' {"type":"string","description":"user content"}\n';
    await writeFile(user, userBytes);
    const initialized = f.run(["project", "models", "initialize", "managed"]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const beforeRecords = await registrations(project);
    await managedDrift(f, project);
    await alterDefinition(project);
    const first = f.upgrade("managed");
    assert.equal(first.result.status, 0, JSON.stringify(first.value));
    assert.equal(first.value.overall, "upgraded");
    assert.equal(first.value.models.status, "upgraded");
    assert.equal(first.value.memory.status, "upgraded");
    assert.equal(first.value.memory.changeSet.intent, "system_upgrade");
    assert.equal(first.value.memory.changeSet.status, "completed");
    assert.equal(first.value.memory.changeSet.validation, "passed");
    assert.equal(first.value.validation, "passed");
    assert.equal(await readFile(join(project, definitionPath), "utf8"), systemModel.source);
    assert.equal(await readFile(user, "utf8"), userBytes);
    assert.deepEqual(await registrations(project), beforeRecords, "Definition upgrades preserve unchanged registration bytes and identities");
    const revision = JSON.parse(await readFile(join(project, "config.json"), "utf8")).store.published_revision;
    const changeIds = await readdir(join(project, "changes"));
    const repeat = f.upgrade("managed");
    assert.equal(repeat.result.status, 0, JSON.stringify(repeat.value));
    assert.equal(repeat.value.overall, "unchanged");
    assert.equal(repeat.value.models.status, "unchanged");
    assert.equal(repeat.value.memory.status, "unchanged");
    assert.equal(repeat.value.memory.changeSet, undefined);
    assert.equal(JSON.parse(await readFile(join(project, "config.json"), "utf8")).store.published_revision, revision);
    assert.deepEqual(await readdir(join(project, "changes")), changeIds);
    assert.deepEqual(await registrations(project), beforeRecords);
  } finally { await f.cleanup(); }
});

test("project upgrade CLI checks both phases when only Memory or only models need updating", async () => {
  const f = await fixture();
  try {
    for (const kind of ["memory", "models"] as const) {
      const project = f.create(kind);
      const revision = JSON.parse(await readFile(join(project, "config.json"), "utf8")).store.published_revision;
      const changesBefore = await readdir(join(project, "changes"));
      if (kind === "memory") await managedDrift(f, project);
      else await alterDefinition(project);
      const { result, value } = f.upgrade(kind);
      assert.equal(result.status, 0, JSON.stringify(value));
      assert.equal(value.overall, "upgraded");
      assert.equal(value.memory.status, kind === "memory" ? "upgraded" : "unchanged");
      assert.equal(value.models.status, kind === "models" ? "upgraded" : "unchanged");
      assert.equal(value.validation, "passed");
      if (kind === "models") {
        assert.equal(value.memory.changeSet, undefined);
        assert.equal(JSON.parse(await readFile(join(project, "config.json"), "utf8")).store.published_revision, revision);
        assert.deepEqual(await readdir(join(project, "changes")), changesBefore);
      }
    }
  } finally { await f.cleanup(); }
});

test("project upgrade CLI updates only system registration issuance metadata and preserves envelope identity", async () => {
  const f = await fixture();
  try {
    const project = f.create("metadata");
    const record = (await registrations(project)).find(item => JSON.parse(item.bytes).value.modelRef === systemModel.registration.modelRef)!;
    const original = JSON.parse(record.bytes);
    const old = { ...original, value: { ...original.value, name: "Old name", description: "Old description", package_name: "Old package", tags: ["old"] } };
    await writeFile(record.path, JSON.stringify(old));
    const { result, value } = f.upgrade("metadata");
    assert.equal(result.status, 0, JSON.stringify(value));
    assert.equal(value.models.status, "upgraded");
    assert.equal(value.memory.status, "unchanged");
    const upgraded = JSON.parse(await readFile(record.path, "utf8"));
    assert.deepEqual(upgraded.value, systemModel.registration);
    assert.equal(upgraded.id, original.id);
    assert.equal(upgraded.createdAt, original.createdAt);
    const bytes = await readFile(record.path, "utf8");
    const repeated = f.upgrade("metadata");
    assert.equal(repeated.result.status, 0, JSON.stringify(repeated.value));
    assert.equal(repeated.value.overall, "unchanged");
    assert.equal(await readFile(record.path, "utf8"), bytes);
  } finally { await f.cleanup(); }
});

test("project upgrade CLI reports failed models, preserves Memory and succeeds after repair", async () => {
  const f = await fixture();
  try {
    const project = f.create("failure");
    const changesBefore = await readdir(join(project, "changes"));
    await managedDrift(f, project);
    const memoryBefore = await readFile(join(project, "memory", memoryPath), "utf8");
    const modelPath = join(project, definitionPath);
    const original = await readFile(modelPath, "utf8");
    await writeFile(modelPath, "{invalid");
    const failed = f.upgrade("failure");
    assert.notEqual(failed.result.status, 0);
    assert.equal(failed.value.overall, "failed");
    assert.equal(failed.value.failure.stage, "models");
    assert.equal(failed.value.models.status, "failed");
    assert.equal(failed.value.memory.status, "not_run");
    assert.equal(await readFile(join(project, "memory", memoryPath), "utf8"), memoryBefore);
    assert.equal(await readFile(modelPath, "utf8"), "{invalid");
    assert.deepEqual(await readdir(join(project, "changes")), changesBefore);
    await writeFile(modelPath, original);
    const retry = f.upgrade("failure");
    assert.equal(retry.result.status, 0, JSON.stringify(retry.value));
    assert.equal(retry.value.memory.status, "upgraded");
  } finally { await f.cleanup(); }
});

test("project upgrade CLI preserves a failed Memory publication after models succeeded and retries the dedicated ID", async () => {
  const f = await fixture();
  try {
    const project = f.create("partial");
    await managedDrift(f, project);
    await alterDefinition(project);
    const configPath = join(project, "config.json");
    const beforeRevision = JSON.parse(await readFile(configPath, "utf8")).store.published_revision;
    const beforeMemory = await readFile(join(project, "memory", memoryPath), "utf8");
    const hook = join(project, "memory/.git/hooks/pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'Temporary upgrade publication rejection' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    const failed = f.upgrade("partial");
    assert.notEqual(failed.result.status, 0, JSON.stringify(failed.value));
    assert.equal(failed.value.overall, "failed");
    assert.equal(failed.value.models.status, "upgraded", "Already completed model work must be reported");
    assert.equal(failed.value.memory.status, "failed");
    assert.equal(failed.value.failure.stage, "memory");
    assert.ok(failed.value.failure.message);
    assert.equal(await readFile(join(project, definitionPath), "utf8"), systemModel.source);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).store.published_revision, beforeRevision);
    assert.equal(f.git(["rev-parse", "HEAD"], join(project, "memory")), beforeRevision);
    assert.equal(await readFile(join(project, "memory", memoryPath), "utf8"), beforeMemory);
    const id = failed.value.memory.changeSet.id;
    assert.equal(failed.value.memory.changeSet.intent, "system_upgrade");
    const changePath = join(project, "changes", id, "change.json");
    const failedChange = JSON.parse(await readFile(changePath, "utf8"));
    assert.equal(failedChange.status, "active", "Failure must retain the dedicated candidate");
    assert.equal(failedChange.checkpoint.valid, true, "Publication failure must retain validated candidate evidence");
    const ids = await readdir(join(project, "changes"));
    const registrationsBeforeRetry = await registrations(project);
    await rm(hook);
    const retry = f.upgrade("partial", ["--change", id]);
    assert.equal(retry.result.status, 0, JSON.stringify(retry.value));
    assert.equal(retry.value.overall, "upgraded");
    assert.equal(retry.value.models.status, "unchanged");
    assert.equal(retry.value.memory.status, "upgraded");
    assert.equal(retry.value.memory.changeSet.id, id);
    assert.equal(retry.value.memory.changeSet.status, "completed");
    assert.equal(retry.value.validation, "passed");
    assert.notEqual(JSON.parse(await readFile(configPath, "utf8")).store.published_revision, beforeRevision);
    assert.deepEqual(await readdir(join(project, "changes")), ids, "Retry reuses the dedicated record");
    assert.deepEqual(await registrations(project), registrationsBeforeRetry, "Retry does not rewrite completed model work");
  } finally { await f.cleanup(); }
});

test("project upgrade CLI selects explicit name over global project over Primary and routes JSON errors", async () => {
  const f = await fixture();
  try {
    f.git(["init", "-b", "master"]);
    f.create("primary", ["--bind"]);
    f.create("other");
    for (const [args, expected] of [
      [["project", "upgrade", "--output", "json"], "primary"],
      [["--project", "other", "project", "upgrade", "--output", "json"], "other"],
      [["--project", "other", "project", "upgrade", "primary", "--output", "json"], "primary"]
    ] as const) {
      const result = f.run([...args]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).project, expected);
    }
    const missing = f.upgrade("missing");
    assert.notEqual(missing.result.status, 0);
    assert.equal(missing.value.overall, "failed");
    assert.equal(missing.value.failure.stage, "target");
    const unbound = join(f.root, "unbound");
    await mkdir(unbound);
    const noPrimary = f.run(["project", "upgrade", "--output", "json"], unbound);
    assert.notEqual(noPrimary.status, 0);
    const noPrimaryError = JSON.parse(noPrimary.stdout || noPrimary.stderr);
    assert.ok(noPrimaryError.failure || noPrimaryError.error);
    const invalid = f.run(["project", "upgrade", "--unknown", "--output", "json"]);
    assert.notEqual(invalid.status, 0);
    assert.ok(JSON.parse(invalid.stderr).error);
    assert.equal(invalid.stdout, "");
    const badOutput = f.run(["project", "upgrade", "--output", "xml"]);
    assert.notEqual(badOutput.status, 0);
  } finally { await f.cleanup(); }
});

async function embeddedFixture(f: Fixture, branch = "master") {
  f.git(["init", "-b", branch]);
  const memoryRoot = join(f.workspace, ".memsphere/memory");
  await mkdir(memoryRoot, { recursive: true });
  const project = f.create("embedded", ["--embedded", memoryRoot, "--bind"]);
  await writeFile(join(memoryRoot, memoryPath), `${await readFile(join(memoryRoot, memoryPath), "utf8")}\n# Previous bundled version\n`);
  await writeFile(join(memoryRoot, "concepts/user.yaml"), withCurrentMemorySyntax("!concept\nnames: [user]\ndefines: [User-owned concept.]\n"));
  f.git(["add", "."]);
  f.git(["commit", "-m", "Previous project baseline"]);
  return { project, memoryRoot };
}

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

test("skill upgrade CLI refreshes only default, global and directory Memsphere targets", async () => {
  const f = await fixture();
  try {
    for (const [args, directory] of [
      [[], join(f.workspace, ".agents/skills")],
      [["--global"], join(f.root, ".agents/skills")],
      [["--directory", join(f.root, "custom-skills")], join(f.root, "custom-skills")]
    ] as [string[], string][]) {
      await mkdir(join(directory, "memsphere"), { recursive: true });
      await mkdir(join(directory, "other"), { recursive: true });
      await writeFile(join(directory, "memsphere/SKILL.md"), "old skill");
      await writeFile(join(directory, "other/SKILL.md"), "user skill");
      const result = f.run(["skill", "upgrade", ...args]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(await readFile(join(directory, "memsphere/SKILL.md"), "utf8"), await readFile(resolve("dist/skills/memsphere/SKILL.md"), "utf8"));
      assert.equal(await readFile(join(directory, "other/SKILL.md"), "utf8"), "user skill");
    }
    const conflict = f.run(["skill", "upgrade", "--global", "--directory", join(f.root, "custom-skills")]);
    assert.notEqual(conflict.status, 0);
    const file = join(f.root, "not-directory");
    await writeFile(file, "protected file");
    assert.notEqual(f.run(["skill", "upgrade", "--directory", file]).status, 0);
    assert.equal(await readFile(file, "utf8"), "protected file");
  } finally { await f.cleanup(); }
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
