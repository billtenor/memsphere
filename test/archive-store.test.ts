import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveChangeDirectory, archiveRun, listArchived, restoreRun } from "../src/archive/store.js";

async function writeRunFixture(
  runsRoot: string,
  id: string,
  status: "running" | "done" | "abandoned",
  legacy = false
): Promise<void> {
  const run = status === "abandoned"
    ? {
        contractVersion: 2,
        id,
        name: id,
        procedureName: "test",
        memoryRoot: "/tmp/memory",
        status,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        stack: [],
        events: []
      }
    : {
        formatVersion: 2,
        id,
        name: id,
        procedure: "procedures/test",
        status,
        startedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        events: [],
        artifacts: {}
      };
  if (legacy) {
    await mkdir(runsRoot, { recursive: true });
    await writeFile(join(runsRoot, `${id}.json`), `${JSON.stringify(run, null, 2)}\n`);
  } else {
    await mkdir(join(runsRoot, id), { recursive: true });
    await writeFile(join(runsRoot, id, `${id}.json`), `${JSON.stringify(run, null, 2)}\n`);
  }
}

test("archives and restores done run directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-run-"));
  try {
    const runsRoot = join(dir, "runs");
    const archiveRoot = join(dir, "archives");
    await writeRunFixture(runsRoot, "run-done", "done");
    const archived = await archiveRun({ archiveRoot, runsRoot, id: "run-done" });
    assert.equal(archived.kind, "runs");
    assert.deepEqual((await listArchived({ archiveRoot })).map((entry) => entry.id), ["run-done"]);
    const restored = await restoreRun({ archiveRoot, runsRoot, id: "run-done" });
    assert.equal(restored.id, "run-done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives and restores abandoned runs without changing their terminal status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-abandoned-run-"));
  try {
    const runsRoot = join(dir, "runs");
    const archiveRoot = join(dir, "archives");
    await writeRunFixture(runsRoot, "run-abandoned", "abandoned");
    await archiveRun({ archiveRoot, runsRoot, id: "run-abandoned" });
    const restored = await restoreRun({ archiveRoot, runsRoot, id: "run-abandoned" });
    assert.equal(restored.status, "abandoned");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives and restores legacy root-level run files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-legacy-run-"));
  try {
    const runsRoot = join(dir, "runs");
    const archiveRoot = join(dir, "archives");
    await writeRunFixture(runsRoot, "run-legacy", "done", true);
    await archiveRun({ archiveRoot, runsRoot, id: "run-legacy" });
    await restoreRun({ archiveRoot, runsRoot, id: "run-legacy" });
    assert.match(await readFile(join(runsRoot, "run-legacy.json"), "utf8"), /run-legacy/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses non-terminal runs and active restore conflicts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-conflict-"));
  try {
    const runsRoot = join(dir, "runs");
    const archiveRoot = join(dir, "archives");
    await writeRunFixture(runsRoot, "run-running", "running");
    await assert.rejects(archiveRun({ archiveRoot, runsRoot, id: "run-running" }), /only done or abandoned runs/);
    await writeRunFixture(runsRoot, "run-conflict", "done");
    await archiveRun({ archiveRoot, runsRoot, id: "run-conflict" });
    await writeRunFixture(runsRoot, "run-conflict", "done");
    await assert.rejects(restoreRun({ archiveRoot, runsRoot, id: "run-conflict" }), /target already exists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives complete ChangeSet directories without exposing an active copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-change-"));
  try {
    const changesRoot = join(dir, "changes");
    const archiveRoot = join(dir, "archives");
    const id = "change-completed";
    await mkdir(join(changesRoot, id, "checkpoints", "digest"), { recursive: true });
    await writeFile(join(changesRoot, id, "change.json"), "complete ChangeSet\n");
    await writeFile(join(changesRoot, id, "checkpoints", "digest", "memory.yaml"), "candidate\n");

    const archived = await archiveChangeDirectory({ archiveRoot, changesRoot, id });
    assert.equal(archived.kind, "changes");
    assert.equal(await readFile(join(archived.path, "change.json"), "utf8"), "complete ChangeSet\n");
    assert.equal(await readFile(join(archived.path, "checkpoints", "digest", "memory.yaml"), "utf8"), "candidate\n");
    await assert.rejects(readFile(join(changesRoot, id, "change.json"), "utf8"), /ENOENT/);
    assert.deepEqual((await listArchived({ archiveRoot, kind: "changes" })).map((entry) => entry.id), [id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
