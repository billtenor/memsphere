import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backfillRunMemoryManifest } from "../scripts/backfill-run-memory-manifest.mjs";

for (const legacy of [false, true]) test(`Standalone manifest tool only adds a missing field, check is read-only and redo is unchanged (legacy=${legacy})`, async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-manifest-backfill-"));
  try {
    const id = "run-old";
    const runDirectory = join(root, id);
    const path = legacy ? join(root, `${id}.json`) : join(runDirectory, `${id}.json`);
    const snapshot = join(runDirectory, "memory", "concepts", "nested");
    await mkdir(snapshot, { recursive: true });
    await writeFile(join(snapshot, "arbitrary.yaml"), "original bytes");
    await writeFile(join(snapshot, ".gitkeep"), "");
    const run = { id, memorySnapshot: { path: "memory" }, events: [{ id: "kept" }], unrelated: { keep: true } };
    const original = JSON.stringify(run);
    await writeFile(path, original);
    const checked = await backfillRunMemoryManifest(path);
    assert.equal(checked.status, "needs-backfill");
    assert.equal(await readFile(path, "utf8"), original);
    const written = await backfillRunMemoryManifest(path, true);
    assert.deepEqual(written.files, [`${id}/memory/concepts/nested/arbitrary.yaml`]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...run, memorySnapshot: { ...run.memorySnapshot, files: written.files } });
    const after = await readFile(path, "utf8");
    await backfillRunMemoryManifest(path, true);
    assert.equal(await readFile(path, "utf8"), after);
    assert.equal(await readFile(join(snapshot, "arbitrary.yaml"), "utf8"), "original bytes");
    assert.equal(await readFile(join(snapshot, ".gitkeep"), "utf8"), "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Standalone manifest tool preserves state on missing directory or a linked snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-manifest-error-"));
  try {
    const id = "run-old";
    const path = join(root, `${id}.json`);
    const original = JSON.stringify({ id, memorySnapshot: { path: "memory" } });
    await writeFile(path, original);
    await assert.rejects(backfillRunMemoryManifest(path, true), { code: "ENOENT" });
    await mkdir(join(root, id));
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, id, "memory"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(backfillRunMemoryManifest(path, true), /regular directory/);
    assert.equal(await readFile(path, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
