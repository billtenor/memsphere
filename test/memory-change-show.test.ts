import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { addMemoryChangeScope, editMemories, publishMemoryChange, renameMemory, validateMemoryChange } from "../src/memory/changeset.js";
import { checkpointRecordToken, publishCheckpoint, withCheckpointRecordLock } from "../src/memory/checkpoint-publication.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { changeShowFixture } from "./helpers/change-show.js";

test("Reviewer default part and side are equivalent to explicit summary and after; reference only filters", async t => {
  const f = await changeShowFixture(t);
  assert.deepEqual(f.read(), f.read(["--part", "summary"]));
  const reference = ["--reference", "concepts/review-evidence"];
  assert.deepEqual(f.read(reference), f.read([...reference, "--part", "summary"]));
  assert.equal(f.read(reference).files.length, 1);
  assert.equal(f.read(reference).content, undefined);
  assert.deepEqual(f.read([...reference, "--part", "memory"]), f.read([...reference, "--part", "memory", "--side", "after"]));
});

test("Reviewer reads correct checkpoint bodies and diffs for create, update, delete and rename", async t => {
  const f = await changeShowFixture(t);
  const body = (reference: string, side = "after") => f.read(["--part", "memory", "--reference", reference, "--side", side]).content;
  assert.match(body("concepts/review-evidence"), /Pinned content/);
  assert.equal(body("concepts/review-evidence", "before"), null);
  assert.match(body("concepts/existing", "before"), /defines: \[\]/);
  assert.match(body("concepts/existing"), /Updated existing content/);
  assert.equal(body("concepts/deleted"), null);
  assert.match(body("concepts/deleted", "before"), /deleted/);
  const renamed = f.read().files.find((file: { operation: string }) => file.operation === "rename");
  assert.ok(renamed);
  assert.match(body(renamed.reference, "before"), /old-name/);
  assert.match(body(renamed.reference), /new-name/);
  const diffs = f.read(["--part", "diff"]).files;
  assert.equal(diffs.length, 4);
  assert.ok(diffs.every((file: { diff: string }) => file.diff.includes("@@")));
  const single = f.read(["--part", "diff", "--reference", "concepts/review-evidence"]).files;
  assert.equal(single.length, 1); assert.match(single[0].diff, /\+.*Pinned content/);
  assert.equal(f.read(["--part", "validation"]).validation.valid, true);
});

test("Checkpoint evidence stays fixed across unvalidated body, scope and target edits until revalidation", async t => {
  const f = await changeShowFixture(t);
  const original = await f.snapshot();
  await writeFile(f.candidate, (await readFile(f.candidate, "utf8")).replace("Pinned content", "Unvalidated content"));
  assert.deepEqual(await f.snapshot(), original);
  await addMemoryChangeScope({ home: f.home, project: "project", changeId: f.edit.change.id, reference: "concepts/scope-only" });
  assert.deepEqual(await f.snapshot(), original);
  assert.notEqual(f.invoke(["--part", "memory", "--reference", "concepts/scope-only"]).status, 0);
  await editMemories({ references: ["concepts/later-target"], changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  await editMemories({ references: ["concepts/late-delete"], operation: "delete", changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  await renameMemory({ reference: "concepts/late-rename", newName: "late-renamed", changeId: f.edit.change.id });
  assert.deepEqual(await f.snapshot(), original);
  const newer = await validateMemoryChange(f.edit.change.id);
  assert.notEqual(newer.checkpointDigest, f.checkpoint.checkpointDigest);
  assert.match(f.invoke().stderr, /checkpoint mismatch/);
  f.setDigest(newer.checkpointDigest);
  assert.ok(f.read().files.some((file: { reference: string }) => file.reference === "concepts/later-target"));
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
  assert.match(f.invoke().stderr, /checkpoint mismatch/);
  f.setDigest(failed.checkpointDigest);
  const validation = f.read(["--part", "validation"]).validation;
  assert.equal(validation.valid, false); assert.ok(validation.issues.length > 0);
  const repeated = await validateMemoryChange(f.edit.change.id);
  assert.equal(repeated.checkpointDigest, failed.checkpointDigest);
  assert.deepEqual(f.read(["--part", "validation"]).validation, validation);
});

test("Reviewer ChangeSet entrypoint remains read-only and rejects unauthorized selectors and writes", async t => {
  const f = await changeShowFixture(t);
  const original = await readFile(f.metadata, "utf8");
  const material = await f.snapshot();
  assert.doesNotMatch(JSON.stringify(material), /candidateRoot|source_worktree|memoryRoot/);
  assert.equal(await readFile(f.metadata, "utf8"), original);
  for (const extra of [["--part", "memory"], ["--reference", "../../config.json"], ["--project", "other"], ["--project=other"], ["--project", "project", "--project=other"]]) assert.notEqual(f.invoke(extra).status, 0);
  for (const operation of ["validate", "claim", "resume", "complete", "finish"]) {
    const result = f.command(["memory", "change", operation, f.edit.change.id]);
    assert.equal(result.status, 2); assert.match(result.stderr, /not allowed/);
  }
});

for (const damage of ["directory", "body", "description", "legacy", "version"] as const) {
  test(`Reviewer rejects ${damage} checkpoint damage without a fallback`, async t => {
    const f = await changeShowFixture(t);
    if (damage === "directory") await rm(f.versionRoot(), { recursive: true, force: true });
    if (damage === "body") await writeFile(join(f.versionRoot(), "memory/concepts/review-evidence.yaml"), "corrupt");
    if (damage === "description") await writeFile(join(f.versionRoot(), "checkpoint.json"), "not-json");
    if (damage === "legacy") await rm(join(f.versionRoot(), "checkpoint.json"));
    if (damage === "version") {
      const file = join(f.versionRoot(), "checkpoint.json");
      const value = JSON.parse(await readFile(file, "utf8")); value.format_version = 2;
      await writeFile(file, JSON.stringify(value));
    }
    const result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    if (damage === "legacy") assert.match(result.stderr, /validate again/);
  });
}

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
  assert.equal(f.read(["--part", "validation"]).checkpointDigest, retried.checkpointDigest);
  assert.match(f.read(["--part", "memory", "--reference", "concepts/review-evidence"]).content, /Retry content/);
});
