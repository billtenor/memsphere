// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkpointRecordToken, publishCheckpoint } from "../src/memory/checkpoint-publication.js";

const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-checkpoint-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const versions = join(root, "versions"), candidate = join(root, "candidate"), record = join(root, "change.json");
  const d0 = "0".repeat(64), d1 = "1".repeat(64), d2 = "2".repeat(64);
  await mkdir(candidate); await writeFile(join(candidate, "body.yaml"), "Candidate");
  await mkdir(join(versions, d0, "memory"), { recursive: true });
  await writeFile(join(versions, d0, "memory/body.yaml"), "Old");
  await writeFile(join(versions, d0, "checkpoint.json"), JSON.stringify({ created_at: "original" }));
  await writeFile(record, JSON.stringify({ digest: d0 }));
  const readCurrent = async () => { const value = JSON.parse(await readFile(record, "utf8")); return { token: checkpointRecordToken(value), digest: value.digest as string }; };
  const original = await readCurrent();
  const verify = async (directory: string) => { await readFile(join(directory, "memory/body.yaml")); return JSON.parse(await readFile(join(directory, "checkpoint.json"), "utf8")) as { created_at: string }; };
  const input = (digest: string, created_at = "first") => ({ runtimeRoot: root, changeId: "change-test", checkpointsRoot: versions,
    digest, candidateRoot: candidate, description: { created_at }, expectedToken: original.token, readCurrent, verify,
    commit: async () => { await writeFile(record, JSON.stringify({ digest })); } });
  return { root, versions, candidate, record, d0, d1, d2, input, readCurrent, verify };
}

test("Different checkpoint publishers cannot interleave reference publication and old-version cleanup", { timeout: 20_000 }, async t => {
  const f = await fixture(t), reached = gate(), resume = gate();
  const a = publishCheckpoint({ ...f.input(f.d1), afterCommit: async () => { reached.release(); await resume.promise; } });
  try {
    await reached.promise;
    await assert.rejects(publishCheckpoint(f.input(f.d2)), { code: "CHANGESET_WRITE_BUSY" });
    assert.equal((await f.readCurrent()).digest, f.d1);
  } finally { resume.release(); }
  await a;
  const current = await f.readCurrent();
  await publishCheckpoint({ ...f.input(f.d2), expectedToken: current.token });
  assert.equal((await f.readCurrent()).digest, f.d2);
  await f.verify(join(f.versions, f.d2));
  await assert.rejects(readFile(join(f.versions, f.d1, "checkpoint.json")), { code: "ENOENT" });
});

test("Same-digest competitors reuse the installed description and validation time after retry", { timeout: 20_000 }, async t => {
  const f = await fixture(t), reached = gate(), resume = gate();
  const first = publishCheckpoint({ ...f.input(f.d1, "winner"), afterCommit: async () => { reached.release(); await resume.promise; } });
  try { await reached.promise; await assert.rejects(publishCheckpoint(f.input(f.d1, "loser")), { code: "CHANGESET_WRITE_BUSY" }); }
  finally { resume.release(); }
  const winner = await first;
  const reused = await publishCheckpoint(f.input(f.d1, "retry"));
  assert.equal(reused.reused, true); assert.deepEqual(reused.description, winner.description);
  assert.equal(reused.description.created_at, "winner");
});

test("Failure before checkpoint reference commit preserves the old complete version and retry can publish", async t => {
  const f = await fixture(t);
  const old = await f.verify(join(f.versions, f.d0));
  await assert.rejects(publishCheckpoint({ ...f.input(f.d1), commit: async () => { throw new Error("Injected before reference commit"); } }), /Injected/);
  assert.equal((await f.readCurrent()).digest, f.d0);
  assert.deepEqual(await f.verify(join(f.versions, f.d0)), old);
  assert.equal(await readFile(join(f.versions, f.d0, "memory/body.yaml"), "utf8"), "Old");
  const next = await publishCheckpoint(f.input(f.d1, "retry"));
  assert.equal((await f.readCurrent()).digest, f.d1);
  assert.equal(next.description.created_at, "first");
  await f.verify(join(f.versions, f.d1));
});

test("Checkpoint publication confirms a committed reference after an acknowledgement failure", async t => {
  const f = await fixture(t), input = f.input(f.d1);
  await publishCheckpoint({ ...input, commit: async () => { await input.commit(); throw new Error("Acknowledgement failed"); } });
  assert.equal((await f.readCurrent()).digest, f.d1);
  await f.verify(join(f.versions, f.d1));
});

test("A stale validation token rejects publication without overwriting updated candidate metadata", async t => {
  const f = await fixture(t);
  await writeFile(f.record, JSON.stringify({ digest: f.d0, scope: ["new-scope"] }));
  await assert.rejects(publishCheckpoint(f.input(f.d1)), { code: "CHECKPOINT_CONFLICT" });
  assert.deepEqual(JSON.parse(await readFile(f.record, "utf8")), { digest: f.d0, scope: ["new-scope"] });
  await f.verify(join(f.versions, f.d0));
});

test("ordinary publication retains history and same-digest binding metadata still requires the current token", async t => {
  const f = await fixture(t);
  await publishCheckpoint({ ...f.input(f.d1), retainHistory: true, commitSameDigest: true });
  assert.equal(await readFile(join(f.versions, f.d0, "memory/body.yaml"), "utf8"), "Old");
  const current = await f.readCurrent();
  await writeFile(f.record, JSON.stringify({ digest: f.d1, bindings: ["concurrent"] }));
  await assert.rejects(publishCheckpoint({ ...f.input(f.d1), expectedToken: current.token, commitSameDigest: true, retainHistory: true }), { code: "CHECKPOINT_CONFLICT" });
  assert.deepEqual(JSON.parse(await readFile(f.record, "utf8")).bindings, ["concurrent"]);
});

test("same digest cannot confirm failed binding metadata solely from the checkpoint pointer", async t => {
  const f = await fixture(t);
  await publishCheckpoint({ ...f.input(f.d1), retainHistory: true });
  const current = await f.readCurrent();
  await assert.rejects(publishCheckpoint({ ...f.input(f.d1), expectedToken: current.token, commitSameDigest: true, retainHistory: true,
    commit: async () => { throw new Error("binding metadata failed"); }, confirmCommit: async () => false }), /binding metadata failed/);
  assert.equal((await f.readCurrent()).digest, f.d1);
});
