import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveReview, archiveRun, listArchived, restoreReview, restoreRun } from "../src/archive/store.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-archive-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeReviewFixture(reviewsRoot: string, id: string, status: "draft" | "submitted" | "processing" | "done"): Promise<void> {
  const reviewRoot = join(reviewsRoot, id);
  await mkdir(join(reviewRoot, "snapshots"), { recursive: true });
  await writeFile(join(reviewRoot, "snapshots", "snapshot.md"), "snapshot\n");
  await writeFile(join(reviewRoot, "review.yaml"), `id: ${id}
title: Demo review
status: ${status}
createdAt: 2026-07-08T00:00:00.000Z
updatedAt: 2026-07-08T00:00:00.000Z
memoryRoot: /tmp/memory
snapshots:
  - label: demo.md
    path: snapshots/snapshot.md
    kind: memory
    createdAt: 2026-07-08T00:00:00.000Z
comments: []
`);
}

async function writeRunFixture(
  runsRoot: string,
  id: string,
  status: "running" | "done",
  layout: "directory" | "legacy-file" = "directory",
  name?: string
): Promise<void> {
  const payload = `${JSON.stringify({
    id,
    ...(name ? { name } : {}),
    status,
    procedureName: "demo",
    memoryRoot: "/tmp/memory",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    stack: [],
    events: []
  }, null, 2)}\n`;

  if (layout === "legacy-file") {
    await mkdir(runsRoot, { recursive: true });
    await writeFile(join(runsRoot, `${id}.json`), payload);
    return;
  }

  await mkdir(join(runsRoot, id), { recursive: true });
  await writeFile(join(runsRoot, id, `${id}.json`), payload);
}

test("archives and restores done reviews", async () => {
  await withTempDir(async (dir) => {
    const archiveRoot = join(dir, "archives");
    const reviewsRoot = join(dir, "reviews");
    const id = "review-done";
    await writeReviewFixture(reviewsRoot, id, "done");

    const entry = await archiveReview({ archiveRoot, reviewsRoot, id });

    assert.equal(entry.kind, "reviews");
    assert.equal(await pathExists(join(reviewsRoot, id)), false);
    assert.equal(await pathExists(join(archiveRoot, "reviews", id, "review.yaml")), true);
    assert.equal((await listArchived({ archiveRoot, kind: "reviews" })).length, 1);

    const restored = await restoreReview({ archiveRoot, reviewsRoot, id });

    assert.equal(restored.id, id);
    assert.equal(await pathExists(join(reviewsRoot, id, "review.yaml")), true);
    assert.equal(await pathExists(join(archiveRoot, "reviews", id)), false);
  });
});

test("refuses to archive non-done reviews and runs", async () => {
  await withTempDir(async (dir) => {
    const archiveRoot = join(dir, "archives");
    const reviewsRoot = join(dir, "reviews");
    const runsRoot = join(dir, "runs");
    await writeReviewFixture(reviewsRoot, "review-draft", "draft");
    await writeRunFixture(runsRoot, "run-running", "running");

    await assert.rejects(
      archiveReview({ archiveRoot, reviewsRoot, id: "review-draft" }),
      /only done reviews can be archived/
    );
    await assert.rejects(
      archiveRun({ archiveRoot, runsRoot, id: "run-running" }),
      /only done runs can be archived/
    );
    assert.equal(await pathExists(join(reviewsRoot, "review-draft", "review.yaml")), true);
    assert.equal(await pathExists(join(runsRoot, "run-running", "run-running.json")), true);
  });
});

test("archives and restores done run directories", async () => {
  await withTempDir(async (dir) => {
    const archiveRoot = join(dir, "archives");
    const runsRoot = join(dir, "runs");
    const id = "run-done";
    await writeRunFixture(runsRoot, id, "done", "directory", "Archived delivery");

    await archiveRun({ archiveRoot, runsRoot, id });

    assert.equal(await pathExists(join(runsRoot, id)), false);
    assert.equal(await pathExists(join(archiveRoot, "runs", id, `${id}.json`)), true);

    const restored = await restoreRun({ archiveRoot, runsRoot, id });

    assert.equal(restored.id, id);
    assert.equal(await pathExists(join(runsRoot, id, `${id}.json`)), true);
    assert.match(await readFile(join(runsRoot, id, `${id}.json`), "utf8"), /"name": "Archived delivery"/);
  });
});

test("archives and restores legacy root-level run files", async () => {
  await withTempDir(async (dir) => {
    const archiveRoot = join(dir, "archives");
    const runsRoot = join(dir, "runs");
    const id = "run-legacy";
    await writeRunFixture(runsRoot, id, "done", "legacy-file");

    await archiveRun({ archiveRoot, runsRoot, id });

    assert.equal(await pathExists(join(runsRoot, `${id}.json`)), false);
    assert.equal(await pathExists(join(archiveRoot, "runs", id, `${id}.json`)), true);

    await restoreRun({ archiveRoot, runsRoot, id });

    assert.equal(await pathExists(join(runsRoot, `${id}.json`)), true);
    assert.match(await readFile(join(runsRoot, `${id}.json`), "utf8"), /"status": "done"/);
    assert.doesNotMatch(await readFile(join(runsRoot, `${id}.json`), "utf8"), /"name"/);
  });
});

test("restore refuses to overwrite active items", async () => {
  await withTempDir(async (dir) => {
    const archiveRoot = join(dir, "archives");
    const reviewsRoot = join(dir, "reviews");
    const runsRoot = join(dir, "runs");
    await writeReviewFixture(reviewsRoot, "review-conflict", "done");
    await writeRunFixture(runsRoot, "run-conflict", "done");

    await archiveReview({ archiveRoot, reviewsRoot, id: "review-conflict" });
    await archiveRun({ archiveRoot, runsRoot, id: "run-conflict" });
    await writeReviewFixture(reviewsRoot, "review-conflict", "done");
    await writeRunFixture(runsRoot, "run-conflict", "done");

    await assert.rejects(
      restoreReview({ archiveRoot, reviewsRoot, id: "review-conflict" }),
      /target already exists/
    );
    await assert.rejects(
      restoreRun({ archiveRoot, runsRoot, id: "run-conflict" }),
      /target already exists/
    );
  });
});
