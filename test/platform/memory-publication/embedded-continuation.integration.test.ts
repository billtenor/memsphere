import assert from "node:assert/strict";
import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runGit, gitOutput } from "../../../src/git.js";
import { readMemoryChange, validateMemoryChange, queryActiveEmbeddedChanges, claimMemoryChange, createViewMemoryChange } from "../../../src/memory/changeset.js";
import { resolveProjectContext } from "../../../src/project/resolver.js";
import { EmbeddedChangeAmbiguityError } from "../../../src/memory/embedded-bindings.js";
import { resolveWorkspaceIdentity } from "../../../src/project/workspace.js";
import { concept, fixture } from "../../helpers/embedded-continuation.js";

for (const sameRoot of [false, true]) {
  test(`recycled detached worktree administrative path cannot silently reuse a ChangeSet at ${sameRoot ? "the same" : "another"} root`, async () => fixture(async f => {
    const oldRoot = join(f.home, "old", "task"), nextRoot = sameRoot ? oldRoot : join(f.home, "new", "task");
    await runGit(["worktree", "add", "--detach", oldRoot], { cwd: f.main }); process.chdir(oldRoot);
    const identity = await resolveWorkspaceIdentity();
    await writeFile(join(oldRoot, "memory/concepts/example.yaml"), concept("Old task"));
    const first = await validateMemoryChange();
    const metadata = join(f.changes, first.changeId, "change.json"), before = await readFile(metadata, "utf8");
    process.chdir(f.main); await runGit(["worktree", "remove", "--force", oldRoot]);
    await runGit(["worktree", "add", "--detach", nextRoot]); process.chdir(nextRoot);
    assert.equal((await resolveWorkspaceIdentity()).instanceKey, identity.instanceKey);
    await writeFile(join(nextRoot, "memory/concepts/example.yaml"), concept("New task"));
    try { assert.notEqual((await validateMemoryChange()).changeId, first.changeId); }
    catch (error) { if (!(error instanceof EmbeddedChangeAmbiguityError)) throw error; }
    assert.equal(await readFile(metadata, "utf8"), before);
    assert.equal(await readFile(join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml"), "utf8"), concept("Old task"));
  }));
}

test("ordinary Embedded retains its ID and complete baseline across commit, clean validation and detached-to-branch", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await writeFile(file, concept("First")); const first = await validateMemoryChange();
  assert.deepEqual(first.issues, []);
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "first"]);
  const clean = await validateMemoryChange(); assert.equal(clean.changeId, first.changeId); assert.equal(clean.baseRevision, first.baseRevision);
  await writeFile(file, concept("Revised")); const revised = await validateMemoryChange(first.changeId);
  assert.equal(revised.changeId, first.changeId); assert.deepEqual(revised.issues, []);
  await runGit(["switch", "-c", "feature"]);
  const branched = await validateMemoryChange(); assert.equal(branched.changeId, first.changeId);
  assert.deepEqual(branched.bindings?.branches, [{ ref: "refs/heads/feature" }]);
  const old = join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml");
  assert.equal(await readFile(old, "utf8"), concept("First"));
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "active"); assert.equal(change.targets.length, 1);
  assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [first.changeId]);
}));

test("committed delete restored as untracked original is a zero candidate, not a same-path rename", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await rm(file); const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "delete"]);
  await writeFile(file, concept("Base"));
  const restored = await validateMemoryChange(first.changeId); assert.equal(restored.empty, true);
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "active"); assert.deepEqual(change.targets, []);
  await writeFile(file, concept("Again")); assert.equal((await validateMemoryChange()).changeId, first.changeId);
}));

test("first validation after commit captures submitted Memory and completes after actual master integration", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Feature"));
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "feature"]);
  const first = await validateMemoryChange(); assert.deepEqual(first.issues, []);
  await runGit(["merge", "--no-ff", "feature", "-m", "integrate"], { cwd: f.main });
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "completed");
  await assert.rejects(validateMemoryChange(first.changeId), /already completed/);
  await assert.rejects(validateMemoryChange(), /no Embedded Memory changes/);
}));

test("active invalid candidate preserves bindings and repairs under the same ID", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await writeFile(file, "!concept\nnames: [broken\n");
  const invalid = await validateMemoryChange(); assert(invalid.issues.length);
  await writeFile(file, concept("Fixed")); const fixed = await validateMemoryChange();
  assert.equal(fixed.changeId, invalid.changeId); assert.deepEqual(fixed.issues, []);
}));

test("CRLF attributes compare target Git blobs and recognize actual integration", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await runGit(["config", "core.autocrlf", "false"]);
  await writeFile(join(f.main, ".gitattributes"), "memory/concepts/*.yaml text eol=crlf\n");
  // Keep attributes in both baseline and feature without introducing Memory changes.
  await runGit(["add", ".gitattributes"], { cwd: f.main }); await runGit(["commit", "-m", "attributes"], { cwd: f.main });
  await runGit(["merge", "master"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Base").replaceAll("\n", "\r\n"));
  await assert.rejects(validateMemoryChange(), /no Embedded Memory changes/);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("CRLF feature").replaceAll("\n", "\r\n"));
  const changed = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "memory"]);
  await runGit(["merge", "feature"], { cwd: f.main });
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: changed.changeId })).status, "completed");
}));

test("same HEAD worktrees stay separate and switching unrelated branches does not inherit ownership", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await runGit(["switch", "-c", "a"]); await writeFile(file, concept("A"));
  const a = await validateMemoryChange();
  await runGit(["switch", "-c", "b"]); await writeFile(file, concept("B"));
  const b = await validateMemoryChange(); assert.notEqual(b.changeId, a.changeId);
  await runGit(["switch", "a"]); assert.equal((await validateMemoryChange()).changeId, a.changeId);
  const another = join(f.home, "another");
  await runGit(["worktree", "add", "--detach", another]); process.chdir(another);
  await writeFile(join(another, "memory/concepts/example.yaml"), concept("Separate"));
  const other = await validateMemoryChange(); assert.notEqual(other.changeId, a.changeId); assert.notEqual(other.changeId, b.changeId);
  const before = await readFile(join(f.changes, b.changeId, "change.json"), "utf8");
  await validateMemoryChange(a.changeId);
  assert.equal(await readFile(join(f.changes, b.changeId, "change.json"), "utf8"), before);
  await assert.rejects(validateMemoryChange(), EmbeddedChangeAmbiguityError);
}));

test("merge master, amend and rebase retain full Memory changes and the same ID", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Feature"));
  const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "feature"]);
  await runGit(["commit", "--amend", "-m", "amended"]);
  assert.equal((await validateMemoryChange()).changeId, first.changeId);
  await writeFile(join(f.main, "upstream.txt"), "upstream");
  await runGit(["add", "upstream.txt"], { cwd: f.main }); await runGit(["commit", "-m", "upstream"], { cwd: f.main });
  await runGit(["rebase", "master"]);
  const rebased = await validateMemoryChange(); assert.equal(rebased.changeId, first.changeId); assert.notEqual(rebased.baseRevision, first.baseRevision);
  await writeFile(join(f.main, "memory/concepts/upstream.yaml"), concept("Upstream only", "upstream"));
  await runGit(["add", "memory"], { cwd: f.main }); await runGit(["commit", "-m", "upstream Memory"], { cwd: f.main });
  await runGit(["merge", "--no-ff", "master", "-m", "merge divergent master"]);
  assert.equal((await gitOutput(["rev-list", "--parents", "-n", "1", "HEAD"])).split(" ").length, 3);
  const merged = await validateMemoryChange(); assert.equal(merged.changeId, first.changeId);
  assert.equal(merged.baseRevision, await gitOutput(["rev-parse", "master"]));
  const record = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.deepEqual(record.targets.map(t => t.path), ["concepts/example.yaml"]);
  assert.equal(await readFile(join(f.memory, "concepts/upstream.yaml"), "utf8"), concept("Upstream only", "upstream"));
  await runGit(["merge", "--squash", "feature"], { cwd: f.main }); await runGit(["commit", "-m", "squash"], { cwd: f.main });
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId })).status, "completed");
}));

test("active query ignores corrupt archives and does not reconcile completion", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate")); const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "candidate"]);
  await runGit(["merge", await gitOutput(["rev-parse", "HEAD"], f.linked)], { cwd: f.main });
  const { primary, workspace } = await resolveProjectContext({ project: "embedded" });
  const corrupt = join(primary.paths.archiveRoot, "changes", "broken"); await mkdir(corrupt, { recursive: true }); await writeFile(join(corrupt, "change.json"), "bad JSON");
  const before = await readFile(join(f.changes, first.changeId, "change.json"), "utf8");
  const active = await queryActiveEmbeddedChanges(primary, workspace.key);
  assert.equal(active.length, 1); assert.equal(active[0].status, "active");
  assert.equal(await readFile(join(f.changes, first.changeId, "change.json"), "utf8"), before);
}));

test("View uses canonical branch binding and repeated creation reuses that record", async () => fixture(async f => {
  const a = await createViewMemoryChange({ home: f.home, project: "embedded", reference: "concepts/example", actor: { kind: "human", id: "reviewer", name: "Reviewer" } });
  const b = await createViewMemoryChange({ home: f.home, project: "embedded", reference: "concepts/example", actor: { kind: "human", id: "reviewer", name: "Reviewer" } });
  assert.equal(a.id, b.id); assert.deepEqual(a.bindings?.branches, [{ ref: "refs/heads/master" }]);
  const first = await claimMemoryChange({ changeId: a.id }); assert.equal(first.change.id, a.id);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("View edit"));
  assert.equal((await validateMemoryChange()).changeId, a.id);
}));
