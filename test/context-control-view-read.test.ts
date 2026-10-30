import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { beforeEach, describe, type TestContext } from "node:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { withNativeFileLock } from "../src/file-lock.js";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { withContextControlViewRead } from "../src/project/context-control-access.js";
import { commitModelOperation, withModelMaintenance } from "../src/project/model-operation.js";
import { textContent } from "../src/context_control/types.js";

describe("View reads with initialized model Stores", () => {
  type Fixture = Awaited<ReturnType<typeof businessFixture>> & { service: NonNullable<Awaited<ReturnType<typeof openContextControl>>> };
  const fixtures = new Map<string, Fixture>();
  beforeEach(async t => {
    const f = await businessFixture(t, {});
    fixtures.set(t.name, { ...f, service: (await openContextControl(f.root, true))! });
    t.after(() => { fixtures.delete(t.name); });
  });
  function preparedFixture(t: TestContext) { return fixtures.get(t.name)!; }

// Holding the former settings lock must not block reads. No elapsed-time
// performance threshold: the read must finish while the lock is still owned.
test("View identity and frozen content do not wait for unrelated settings access", async t => {
  const f = preparedFixture(t), service = f.service;
  const run = await service.start("View"), result = await service.report(run.id, { name: "A", content: textContent("Body") });
  await mkdir(join(f.root, ".runtime"), { recursive: true });
  await withNativeFileLock(join(f.root, ".runtime/settings.lock"), async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await Promise.race([
        withContextControlViewRead(f.root, async () => {
          assert.equal((await service.findViewRun(run.id))?.name, "View");
          assert.equal(Buffer.from((await service.readViewArtifact(run.id, result.artifact.id)).bytes).toString(), "Body");
        }),
        new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("View waited for settings lock")), { once: true }))
      ]);
    } finally { clearTimeout(timer); }
  });
});

test("View and artifact reads bypass a held Run lock without repairing an incomplete draft", { timeout: 5000 }, async t => {
  const { root, service } = preparedFixture(t);
  const run = await service.start("View Run lock");
  const result = await service.report(run.id, { name: "body", content: textContent("frozen") });
  const store = service.stores.step, create = store.create.bind(store);
  let missingKey = "", unfinishedArtifact = "";
  store.create = async (_context, key, value) => {
    missingKey = key; unfinishedArtifact = (value as { artifact: { id: string } }).artifact.id;
    throw Error("unfinished draft");
  };
  try { await assert.rejects(service.createArtifact(run.id, { name: "draft" }), /unfinished draft/); }
  finally { store.create = create; }
  const key = createHash("sha256").update(run.id).digest("hex");
  await mkdir(join(root, ".runtime/context-control"), { recursive: true });
  await withNativeFileLock(join(root, ".runtime/context-control", `${key}.lock`), async () => {
    assert.deepEqual(await service.findViewRun(run.id), run);
    assert.equal(await service.findViewRun("missing"), undefined);
    assert.equal(await service.viewProjection(run.id, "overview"), undefined);
    assert.equal(Buffer.from((await service.readViewArtifact(run.id, result.artifact.id)).bytes).toString(), "frozen");
    await assert.rejects(service.readViewArtifact(run.id, unfinishedArtifact), { code: "NOT_FOUND" });
    assert.equal(Buffer.from((await service.readArtifact(run.id, result.artifact.id)).bytes).toString(), "frozen");
    await assert.rejects(service.readArtifact(run.id, unfinishedArtifact), { code: "NOT_FOUND" });
    await assert.rejects(service.readArtifact(run.id, "missing"), { code: "NOT_FOUND" });
    assert.equal(await store.get({}, missingKey), undefined);
  });
  await service.snapshot(run.id);
  assert.ok(await store.get({}, missingKey));
  await assert.rejects(service.readArtifact(run.id, unfinishedArtifact), { code: "INCOMPLETE_ARTIFACT" });
});
});

test("View discards a result when a model publication overlaps its read", async t => {
  const f = await businessFixture(t, {});
  let entered!: () => void, release!: () => void, attempts = 0;
  const ready = new Promise<void>(r => { entered = r; }), resume = new Promise<void>(r => { release = r; });
  const reading = withContextControlViewRead(f.root, async () => {
    const value = ++attempts;
    if (value === 1) { entered(); await resume; }
    return value;
  });
  await ready;
  try { await withModelMaintenance(f.root, () => commitModelOperation(f.root, "test", [{
    path: join(f.root, "models/json-schema/draft-07/note.json"), before: undefined, after: Buffer.from('{"type":"string"}')
  }])); }
  finally { release(); }
  assert.equal(await reading, 2);
});

test("View refuses a pending model publication without running the read", async t => {
  const f = await businessFixture(t, {});
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), resume = new Promise<void>(r => { release = r; });
  const writing = withModelMaintenance(f.root, () => commitModelOperation(f.root, "test", [{
    path: join(f.root, "models/json-schema/draft-07/note.json"), before: undefined, after: Buffer.from('{"type":"string"}')
  }], { afterPending: async () => { entered(); await resume; } }));
  await ready;
  try { await assert.rejects(withContextControlViewRead(f.root, async () => { throw Error("read must not run"); }), { code: "MODEL_OPERATION_PENDING" }); }
  finally { release(); await writing; }
});
