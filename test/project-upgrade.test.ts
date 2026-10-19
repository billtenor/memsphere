import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { alterDefinition, definitionPath, fixture, managedDrift, memoryPath, registrations, systemModel } from "./helpers/project-upgrade.js";

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
