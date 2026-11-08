import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { addMemoryChangeScope, editMemories, publishMemoryChange, renameMemory, validateMemoryChange } from "../../../src/memory/changeset.js";
import { checkpointRecordToken, publishCheckpoint, withCheckpointRecordLock } from "../../../src/memory/checkpoint-publication.js";
import { currentMemorySyntax } from "../../../src/memory/syntax.js";
import { assertChangeShowRejected, changeShowFixture } from "../../helpers/change-show.js";

test("Checkpoint evidence stays fixed across unvalidated body, scope and target edits until revalidation", async t => {
  const f = await changeShowFixture(t);
  const original = await f.snapshot();
  await writeFile(f.candidate, (await readFile(f.candidate, "utf8")).replace("Pinned content", "Unvalidated content"));
  assert.deepEqual(await f.snapshot(), original);
  await addMemoryChangeScope({ home: f.home, project: "project", changeId: f.edit.change.id, reference: "concepts/scope-only" });
  assert.deepEqual(await f.snapshot(), original);
  assertChangeShowRejected(f.invoke(["--part", "memory", "--reference", "concepts/scope-only"]), 1, /reference not found or ambiguous/);
  await editMemories({ references: ["concepts/later-target"], changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  await editMemories({ references: ["concepts/late-delete"], operation: "delete", changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  await renameMemory({ reference: "concepts/late-rename", newName: "late-renamed", changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  const newer = await validateMemoryChange(f.edit.change.id);
  assert.notEqual(newer.checkpointDigest, f.checkpoint.checkpointDigest);
  assertChangeShowRejected(f.invoke(), 1, /checkpoint mismatch/);
  f.setDigest(newer.checkpointDigest);
  assert.ok((await f.readMaterial()).files.some((file: { reference: string }) => file.reference === "concepts/later-target"));
});

test("Checkpoint validation identity changes with a non-target dependency and preserves identical revalidation", async t => {
  const f = await changeShowFixture(t);
  const added = await editMemories({ references: ["statements/uses-dependency"], changeId: f.edit.change.id });
  await writeFile(join(added.candidateRoot, "statements/uses-dependency.yaml"), `!statement\nsyntax: ${currentMemorySyntax}\nnames: [uses-dependency]\nasserts:\n  - !ref\n    target: statements/dependency\n`);
  const first = await validateMemoryChange(f.edit.change.id); assert.deepEqual(first.issues, []);
  f.setDigest(first.checkpointDigest);
  const before = await f.snapshot();
  const identical = await validateMemoryChange(f.edit.change.id);
  assert.equal(identical.checkpointDigest, first.checkpointDigest);
  assert.deepEqual(await f.snapshot(), before);
  const other = await editMemories({ references: ["statements/dependency"], operation: "delete" });
  await publishMemoryChange(other.change.id);
  assert.deepEqual(await f.snapshot(), before);
  const failed = await validateMemoryChange(f.edit.change.id);
  assert.ok(failed.issues.length > 0);
  assert.notEqual(failed.checkpointDigest, first.checkpointDigest);
  assertChangeShowRejected(f.invoke(), 1, /checkpoint mismatch/);
  f.setDigest(failed.checkpointDigest);
  const validation = (await f.readMaterial(["--part", "validation"])).validation;
  assert.equal(validation.valid, false); assert.ok(validation.issues.length > 0);
  const repeated = await validateMemoryChange(f.edit.change.id);
  assert.equal(repeated.checkpointDigest, failed.checkpointDigest);
  assert.deepEqual((await f.readMaterial(["--part", "validation"])).validation, validation);
});

test("Candidate metadata writes coordinate with checkpoint publication and preserve its current reference", async t => {
  const f = await changeShowFixture(t);
  const original = await f.snapshot();
  await withCheckpointRecordLock(join(f.projectRoot, ".runtime"), f.edit.change.id, async () => {
    await assert.rejects(addMemoryChangeScope({ home: f.home, project: "project", changeId: f.edit.change.id, reference: "concepts/scope-only" }), { code: "CHANGESET_WRITE_BUSY" });
  });
  await addMemoryChangeScope({ home: f.home, project: "project", changeId: f.edit.change.id, reference: "concepts/scope-only" });
  assert.deepEqual(await f.snapshot(), original);
  assert.equal(JSON.parse(await readFile(f.metadata, "utf8")).checkpoint.digest, f.checkpoint.checkpointDigest);
});

test("Checkpoint commit failure leaves the previous four CLI evidence views intact and validation can retry", async t => {
  const f = await changeShowFixture(t);
  const before = await f.snapshot();
  const original = JSON.parse(await readFile(f.metadata, "utf8"));
  const description = JSON.parse(await readFile(join(f.versionRoot(), "checkpoint.json"), "utf8"));
  await assert.rejects(publishCheckpoint({
    runtimeRoot: join(f.projectRoot, ".runtime"), changeId: f.edit.change.id,
    checkpointsRoot: join(f.projectRoot, "changes", f.edit.change.id, "checkpoints"),
    digest: "f".repeat(64), candidateRoot: f.edit.candidateRoot, description,
    expectedToken: checkpointRecordToken(original),
    readCurrent: async () => { const current = JSON.parse(await readFile(f.metadata, "utf8")); return { token: checkpointRecordToken(current), digest: current.checkpoint.digest }; },
    verify: async directory => JSON.parse(await readFile(join(directory, "checkpoint.json"), "utf8")),
    commit: async () => { throw new Error("Injected after directory preparation, before reference commit"); }
  }), /Injected/);
  assert.deepEqual(await f.snapshot(), before);
  await writeFile(f.candidate, (await readFile(f.candidate, "utf8")).replace("Pinned content", "Retry content"));
  const retried = await validateMemoryChange(f.edit.change.id);
  assert.deepEqual(retried.issues, []); assert.notEqual(retried.checkpointDigest, f.checkpoint.checkpointDigest);
  f.setDigest(retried.checkpointDigest);
  assert.equal((await f.readMaterial(["--part", "validation"])).checkpointDigest, retried.checkpointDigest);
  assert.match((await f.readMaterial(["--part", "memory", "--reference", "concepts/review-evidence"])).content, /Retry content/);
});
