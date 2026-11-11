import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { claimMemoryChange, createMarketMemoryChange, publishMemoryChange, validateMemoryChange } from "../../../src/memory/changeset.js";
import { concept, fixture, claimFixture } from "../../helpers/embedded-continuation.js";

function writeBoundary() {
  let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, gate, async reached(operation: Promise<unknown>) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, operation.then(() => { throw new Error("Operation ended before the write boundary"); }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Write boundary not reached")), 10_000); })]); }
    finally { clearTimeout(deadline); }
  } };
}

async function marketCandidate(home: string, root: string) {
  for (const kind of ["concepts", "procedures", "statements", "schemas"]) await mkdir(join(root, "memory", kind), { recursive: true });
  const change = await createMarketMemoryChange({ home, project: "embedded", actor: { kind: "human", id: "fixture", name: "Fixture" },
    targets: [{ reference: "concepts/example", path: "concepts/example.yaml", source: Buffer.from(concept("Market")) }] });
  await claimMemoryChange({ changeId: change.id });
  const validated = await validateMemoryChange(change.id); assert.deepEqual(validated.issues, []);
  return { change, validated };
}

test("ordinary claim excludes dedicated apply before either can overwrite the other's write", { timeout: 30_000 }, async t => fixture(async f => claimFixture(f, async (id, root) => {
  const market = await marketCandidate(f.home, root), boundary = writeBoundary();
  const metadata = join(f.changes, market.change.id, "change.json"), before = await readFile(metadata);
  const claiming = claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => { if (!index) { boundary.enter(); await boundary.gate; } } });
  t.signal.addEventListener("abort", boundary.release, { once: true });
  try {
    await boundary.reached(claiming);
    await assert.rejects(publishMemoryChange(market.change.id), { code: "MEMORY_PUBLISH_BUSY" });
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
    assert.deepEqual(await readFile(metadata), before);
  } finally { boundary.release(); await claiming; t.signal.removeEventListener("abort", boundary.release); }
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Changed"));
})));

test("dedicated apply holds physical admission through real writes and rollback, rejecting ordinary claim", { timeout: 30_000 }, async t => fixture(async f => claimFixture(f, async (id, root) => {
  const market = await marketCandidate(f.home, root), boundary = writeBoundary();
  const ordinaryRecord = join(f.changes, id, "change.json"), before = await readFile(ordinaryRecord);
  const marketRecord = join(f.changes, market.change.id, "change.json"), marketBefore = await readFile(marketRecord);
  const applying = publishMemoryChange(market.change.id, undefined, { afterEmbeddedApply: async () => {
    boundary.enter(); await boundary.gate; throw new Error("injected after dedicated writes");
  } }).then(() => undefined, error => error as Error);
  t.signal.addEventListener("abort", boundary.release, { once: true });
  try {
    await boundary.reached(applying);
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Market"));
    await assert.rejects(claimMemoryChange({ changeId: id }), { code: "MEMORY_PUBLISH_BUSY" });
    await assert.rejects(validateMemoryChange(id), { code: "MEMORY_PUBLISH_BUSY" });
    assert.deepEqual(await readFile(ordinaryRecord), before);
  } finally { boundary.release(); await applying; t.signal.removeEventListener("abort", boundary.release); }
  assert.match((await applying)?.message ?? "unexpected success", /injected after dedicated writes/);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  assert.deepEqual(await readFile(ordinaryRecord), before); assert.deepEqual(await readFile(marketRecord), marketBefore);
  assert.equal(await readFile(join(f.changes, market.change.id, "checkpoints", market.validated.checkpointDigest, "memory/concepts/example.yaml"), "utf8"), concept("Market"));
  await claimMemoryChange({ changeId: id });
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Changed"));
})));
