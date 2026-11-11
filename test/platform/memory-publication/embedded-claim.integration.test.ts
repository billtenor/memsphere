import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitOutput, runGit } from "../../../src/git.js";
import { claimMemoryChange, readMemoryChange, validateMemoryChange } from "../../../src/memory/changeset.js";
import { EmbeddedClaimWriteError } from "../../../src/memory/embedded-claim.js";
import { concept, fixture, claimFixture } from "../../helpers/embedded-continuation.js";

test("claim preflights every file and refuses conflicts before writing the first target", async () => fixture(async f => claimFixture(f, async (id, root) => {
  await writeFile(join(root, "memory/concepts/second.yaml"), concept("User", "second"));
  await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: id })).claim, undefined);
})));

for (const userEdit of [false, true]) {
  test(`claim reports partial real writes and ${userEdit ? "preserves subsequent user edits" : "can safely retry"}`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    await assert.rejects(claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => { if (index === 1) throw new Error("injected EIO"); } }), error => {
      assert(error instanceof EmbeddedClaimWriteError); assert.deepEqual(error.details.writtenPaths, ["concepts/example.yaml"]); assert.deepEqual(error.details.pendingPaths, ["concepts/second.yaml"]); assert.equal(error.details.metadataConfirmed, false); return true;
    });
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Changed"));
    assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: id })).claim, undefined);
    if (userEdit) {
      await writeFile(join(root, "memory/concepts/example.yaml"), concept("User"));
      await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
      assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("User"));
    } else {
      const claimed = await claimMemoryChange({ changeId: id }); assert(claimed.change.claim);
      assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
    }
  })));
}

for (const acknowledged of [false, true]) {
  test(`claim all writes then ${acknowledged ? "acknowledgement" : "metadata commit"} fails with accurate state`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    const fail = async () => { throw new Error("metadata boundary"); };
    const pending = claimMemoryChange({ changeId: id, ...(acknowledged ? { afterMetadataCommit: fail } : { beforeMetadataCommit: fail }) });
    if (acknowledged) assert.match((await pending).warnings.join(" "), /confirmed by re-reading/);
    else await assert.rejects(pending, error => { assert(error instanceof EmbeddedClaimWriteError); assert.equal(error.details.writtenPaths.length, 2); assert.deepEqual(error.details.pendingPaths, []); return true; });
    assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
    const before = await readMemoryChange({ home: f.home, project: "embedded", changeId: id }); assert.equal(Boolean(before.claim), acknowledged);
    assert((await claimMemoryChange({ changeId: id })).change.claim);
  })));
}

test("claim holds context admission through writes and metadata so validate cannot publish between them", { timeout: 30_000 }, async t => fixture(async f => claimFixture(f, async (id, root) => {
  let resume!: () => void, entered!: () => void;
  let allowWrite = false;
  const gate = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const claiming = claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => { if (!index) { entered(); await gate; t.signal.throwIfAborted(); if (!allowWrite) throw new Error("Claim test cancelled before write"); } } });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const releaseOnAbort = () => resume();
  t.signal.addEventListener("abort", releaseOnAbort, { once: true });
  try {
    await Promise.race([ready, claiming.then(() => { throw new Error("Claim ended before the write boundary"); }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Claim did not reach its write boundary")), 10_000); })]);
    await writeFile(join(root, "memory/concepts/third.yaml"), concept("Third", "third"));
    await assert.rejects(validateMemoryChange(id), { code: "MEMORY_PUBLISH_BUSY" });
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
    allowWrite = true;
  } finally { clearTimeout(deadline); t.signal.removeEventListener("abort", releaseOnAbort); resume(); if (allowWrite) await claiming; else await assert.rejects(claiming); }
  assert((await claiming).change.claim);
})));

test("rename uses destination attributes and claim preflights both ends before copying", async () => fixture(async f => {
  await writeFile(join(f.main, ".gitattributes"), "memory/concepts/renamed.yaml text eol=crlf\n");
  await runGit(["add", ".gitattributes"], { cwd: f.main }); await runGit(["commit", "-m", "attributes"], { cwd: f.main }); await runGit(["merge", "master"]);
  await rm(join(f.memory, "concepts/example.yaml")); await writeFile(join(f.memory, "concepts/renamed.yaml"), concept("Base").replaceAll("\n", "\r\n"));
  const first = await validateMemoryChange();
  const record = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(record.targets[0]?.operation, "rename");
  const destination = join(f.home, "rename"); await runGit(["worktree", "add", "--detach", destination]); process.chdir(destination);
  await writeFile(join(destination, "memory/concepts/renamed.yaml"), concept("Conflict"));
  await assert.rejects(claimMemoryChange({ changeId: first.changeId }), /edit conflict/);
  assert.equal(await readFile(join(destination, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  await rm(join(destination, "memory/concepts/renamed.yaml"));
  await claimMemoryChange({ changeId: first.changeId });
  await assert.rejects(readFile(join(destination, "memory/concepts/example.yaml")), { code: "ENOENT" });
  assert.equal(await readFile(join(destination, "memory/concepts/renamed.yaml"), "utf8"), concept("Base").replaceAll("\n", "\r\n"));
}));

test("claim refuses changed conversion context before writing", async () => fixture(async f => claimFixture(f, async (id, root) => {
  await writeFile(join(root, ".gitattributes"), "memory/**/*.yaml text eol=crlf\n");
  await assert.rejects(claimMemoryChange({ changeId: id }), /Git attributes changed/);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
})));

test("process exit after claim metadata leaves complete bindings and releases native admission", async () => fixture(async f => claimFixture(f, async (id, root) => {
  const worker = join(f.home, "after-claim.mts");
  await writeFile(worker, `import {claimMemoryChange} from ${JSON.stringify(new URL("../../../src/memory/changeset.ts", import.meta.url).href)};
    await claimMemoryChange({changeId:${JSON.stringify(id)},afterMetadataCommit:async()=>{process.exit(24)}});`);
  await assert.rejects(promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), worker], { cwd: root, env: process.env }), { code: 24 });
  const saved = await readMemoryChange({ home: f.home, project: "embedded", changeId: id });
  assert(saved.claim); assert.equal(saved.bindings?.worktrees.length, 2);
  await writeFile(join(root, "memory/concepts/example.yaml"), concept("Later user edit"));
  assert((await claimMemoryChange({ changeId: id })).change.claim);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Later user edit"));
})));

test("cancelling a claim at its first write boundary drains rejection without new bytes or metadata", { timeout: 30_000 }, async () => fixture(async f => claimFixture(f, async (id, root) => {
  const controller = new AbortController();
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { enter = resolve; });
  const metadata = join(f.changes, id, "change.json"), before = await readFile(metadata);
  const claiming = claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => {
    if (!index) { enter(); await gate; controller.signal.throwIfAborted(); }
  } });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ready, claiming.then(() => { throw new Error("Unexpected early completion"); }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Write boundary not reached")), 10_000); })]);
    controller.abort(new Error("controlled cancellation")); release();
    await assert.rejects(claiming, error => {
      assert(error instanceof EmbeddedClaimWriteError); assert.deepEqual(error.details.writtenPaths, []);
      assert.equal(error.details.metadataConfirmed, false); assert.match(error.message, /controlled cancellation/); return true;
    });
    assert.deepEqual(await readFile(metadata), before);
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
    await assert.rejects(readFile(join(root, "memory/concepts/second.yaml")), { code: "ENOENT" });
  } finally { clearTimeout(deadline); controller.abort(); release(); await claiming.catch(() => undefined); }
})));

for (const evidence of ["record-missing", "context-missing", "generation-unavailable", "same-root-recycled"] as const) {
  test(`unverified existing claim requires force: ${evidence}`, async () => fixture(async f => {
    const owner = join(f.home, "owner");
    await runGit(["worktree", "add", "--detach", owner]); process.chdir(owner);
    await writeFile(join(owner, "memory/concepts/example.yaml"), concept("Claimed candidate"));
    const first = await validateMemoryChange(); await claimMemoryChange({ changeId: first.changeId });
    const metadata = join(f.changes, first.changeId, "change.json");
    const filesystem = (await import("node:fs/promises")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalStat = filesystem.stat;
    try {
      if (evidence === "same-root-recycled") {
        process.chdir(f.main); await runGit(["worktree", "remove", "--force", owner]);
        await runGit(["worktree", "add", "--detach", owner]); process.chdir(owner);
      } else {
        const record = JSON.parse(await readFile(metadata, "utf8"));
        if (evidence !== "context-missing") for (const binding of record.bindings.worktrees) delete binding.generation;
        await writeFile(metadata, JSON.stringify(record));
        if (evidence === "generation-unavailable" || evidence === "context-missing") {
          const admin = await gitOutput(["rev-parse", "--absolute-git-dir"]);
          filesystem.stat = (async (path: unknown, options: unknown) => {
            const result = await (originalStat as Function)(path, options);
            if (path === admin && (options as { bigint?: boolean })?.bigint) result.birthtimeNs = 0n;
            return result;
          }) as typeof originalStat;
          syncBuiltinESMExports();
        }
      }
      const before = await readFile(metadata), body = await readFile(join(owner, "memory/concepts/example.yaml"));
      const candidate = join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml");
      const frozen = await readFile(candidate);
      await assert.rejects(validateMemoryChange(first.changeId), /claim ownership cannot be confirmed/);
      await assert.rejects(claimMemoryChange({ changeId: first.changeId }), /use --force/);
      assert.deepEqual(await readFile(metadata), before); assert.deepEqual(await readFile(candidate), frozen);
      assert.deepEqual(await readFile(join(owner, "memory/concepts/example.yaml")), body);
      assert((await claimMemoryChange({ changeId: first.changeId, force: true })).change.claim);
    } finally { filesystem.stat = originalStat; syncBuiltinESMExports(); }
  }));
}
