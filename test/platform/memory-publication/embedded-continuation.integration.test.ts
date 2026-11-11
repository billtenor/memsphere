import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runGit, gitOutput } from "../../../src/git.js";
import { readMemoryChange, validateMemoryChange } from "../../../src/memory/changeset.js";
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

test("missing current generation keeps a known detached record ambiguous instead of implicitly creating another", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("First")); const first = await validateMemoryChange();
  const metadata = join(f.changes, first.changeId, "change.json"), before = await readFile(metadata);
  const record = JSON.parse(before.toString()); assert(record.bindings.worktrees[0].generation); assert.equal(record.claim, undefined);
  const filesystem = (await import("node:fs/promises")).default, { syncBuiltinESMExports } = await import("node:module");
  const originalStat = filesystem.stat, admin = await gitOutput(["rev-parse", "--absolute-git-dir"]);
  try {
    filesystem.stat = (async (path: unknown, options: unknown) => {
      const result = await (originalStat as Function)(path, options);
      if (path === admin && (options as { bigint?: boolean })?.bigint) result.birthtimeNs = 0n;
      return result;
    }) as typeof originalStat; syncBuiltinESMExports();
    await writeFile(join(f.memory, "concepts/example.yaml"), concept("Next"));
    await assert.rejects(validateMemoryChange(), error => {
      assert(error instanceof EmbeddedChangeAmbiguityError); assert.deepEqual(error.candidates.map(c => c.id), [first.changeId]); return true;
    });
    assert.deepEqual(await readFile(metadata), before);
    assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [first.changeId]);
    assert.equal(await readFile(join(f.memory, "concepts/example.yaml"), "utf8"), concept("Next"));
    assert.equal(await readFile(join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml"), "utf8"), concept("First"));
    assert.equal((await validateMemoryChange(first.changeId)).changeId, first.changeId);
  } finally { filesystem.stat = originalStat; syncBuiltinESMExports(); }
}));
