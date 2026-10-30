import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { withNativeFileLock } from "../src/file-lock.js";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { withContextControlViewRead } from "../src/project/context-control-access.js";
import { commitModelOperation, withModelMaintenance } from "../src/project/model-operation.js";
import { textContent } from "../src/context_control/types.js";

// Holding the former settings lock must not block reads. No elapsed-time
// performance threshold: the read must finish while the lock is still owned.
test("View identity and frozen content do not wait for unrelated settings access", async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
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
