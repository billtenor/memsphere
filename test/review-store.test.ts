import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canCreateTaskReview, createViewServer, hydrateRunArtifactContent } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { createReview, getReview, readReviewSnapshot } from "../src/review/store.js";
import type { RunState } from "../src/run/store.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-review-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("task reviews snapshot the complete run directory and hydrate from that snapshot", async () => {
  await withTempDir(async (dir) => {
    const reviewsRoot = join(dir, "reviews");
    const runsRoot = join(dir, "runs");
    const runId = "run-snapshot";
    const runDir = join(runsRoot, runId);
    const artifactPath = join(runDir, "artifacts", "001-result.md");
    await mkdir(join(runDir, "artifacts"), { recursive: true });
    await writeFile(artifactPath, "original artifact\n");
    const run: RunState = {
      id: runId,
      status: "done",
      procedureName: "snapshot procedure",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      stack: [],
      events: [{
        at: "2026-07-11T00:00:00.000Z",
        frame: "procedure",
        stepId: "flow[1]",
        artifact: {
          name: "result",
          format: "markdown",
          storage: "file",
          path: `${runId}/artifacts/001-result.md`
        }
      }]
    };
    await writeFile(join(runDir, `${runId}.json`), `${JSON.stringify(run, null, 2)}\n`);

    const review = await createReview({
      source: "task",
      target: { source: "task", id: `task/${runId}`, runId },
      memoryRoot: run.memoryRoot,
      reviewsRoot,
      snapshotFiles: [{
        label: `${runId}.json`,
        path: runDir,
        kind: "task",
        directory: true,
        entryPath: `${runId}.json`,
        snapshotDirectoryPath: join("runs", runId)
      }]
    });
    const snapshot = await readReviewSnapshot(reviewsRoot, review.id, "task");
    assert(snapshot);
    assert.equal(JSON.parse(snapshot.content).memoryRoot, "snapshots/memory");
    assert.equal(await readFile(join(reviewsRoot, review.id, "snapshots", "runs", runId, "artifacts", "001-result.md"), "utf8"), "original artifact\n");

    await writeFile(artifactPath, "changed artifact\n");
    const hydrated = await hydrateRunArtifactContent(snapshot.snapshotRoot, JSON.parse(snapshot.content) as RunState);
    assert.equal(hydrated.events[0]?.artifact.content, "original artifact\n");
  });
});

test("only done tasks can create a task review", () => {
  assert.equal(canCreateTaskReview("done"), true);
  assert.equal(canCreateTaskReview("running"), false);
});

test("task review API rejects running tasks and reads artifacts from the saved snapshot", async () => {
  await withTempDir(async (dir) => {
    const reviewsRoot = join(dir, "reviews");
    const runsRoot = join(dir, "runs");
    const memoryRoot = join(dir, "memory");
    const runId = "run-api-snapshot";
    const runDir = join(runsRoot, runId);
    await mkdir(join(runDir, "artifacts"), { recursive: true });
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await mkdir(join(memoryRoot, "schemas"), { recursive: true });
    await writeFile(join(memoryRoot, "procedures", "api-procedure.yaml"), "!procedure\nnames: [api procedure]\nflow: []\n");
    await writeFile(join(memoryRoot, "procedures", "child-procedure.yaml"), "!procedure\nnames: [child procedure]\nflow:\n  - !call\n    target: grandchild procedure\n");
    await writeFile(join(memoryRoot, "procedures", "grandchild-procedure.yaml"), "!procedure\nnames: [grandchild procedure]\nflow: []\n");
    await writeFile(join(memoryRoot, "procedures", "unrelated.yaml"), "!procedure\nnames: [unrelated]\nflow: []\n");
    await writeFile(join(memoryRoot, "schemas", "used-schema.yaml"), "!schema\nnames: [used schema]\nformat: outline\nfields: []\n");
    await writeFile(join(runDir, "artifacts", "001-result.md"), "snapshot artifact\n");

    const run: RunState = {
      id: runId,
      status: "running",
      procedureName: "api procedure",
      memoryRoot,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      stack: [],
      plan: [
        { id: "flow[2]", kind: "call", instruction: "Call child", target: "child procedure" },
        { id: "flow[3]", kind: "action", instruction: "Use schema", artifact: "schema", format: "schema", schemaName: "used schema" },
        {
          id: "flow[4]",
          kind: "action",
          instruction: "Use private schema",
          artifact: "private schema",
          format: "schema",
          inlineSchemaId: "inline:flow[4]:private-schema",
          inlineSchema: { tag: "!schema", names: [], defines: [], format: "outline", fields: ["summary"] },
          asserts: ["Keep it auditable."],
          suggests: ["Prefer concise text."],
          final: true
        }
      ],
      events: [{
        at: "2026-07-11T00:00:00.000Z",
        frame: "procedure",
        stepId: "flow[1]",
        artifact: { name: "result", format: "markdown", storage: "file", path: `${runId}/artifacts/001-result.md` }
      }]
    };
    const runFile = join(runDir, `${runId}.json`);
    await writeFile(runFile, `${JSON.stringify(run)}\n`);

    const config: MemsphereConfig = {
      configPath: join(dir, "config.json"),
      scopeRoot: dir,
      memoryRoot,
      reviewsRoot,
      runsRoot,
      archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 }
    };
    const server = createViewServer(config);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();
      assert(address && typeof address === "object");
      const url = `http://127.0.0.1:${address.port}`;
      const request = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "task", runId }) };
      const rejected = await fetch(`${url}/api/reviews`, request);
      assert.equal(rejected.status, 409);

      run.status = "done";
      await writeFile(runFile, `${JSON.stringify(run)}\n`);
      const created = await fetch(`${url}/api/reviews`, request);
      assert.equal(created.status, 201);
      const review = (await created.json() as { review: { id: string } }).review;

      const savedReview = await getReview(reviewsRoot, review.id);
      assert(savedReview);
      assert.equal(savedReview.memoryRoot, "snapshots/memory");
      assert.equal(await readFile(join(reviewsRoot, review.id, "snapshots", "memory", "procedures", "api-procedure.yaml"), "utf8"), "!procedure\nnames: [api procedure]\nflow: []\n");
      assert.equal(await readFile(join(reviewsRoot, review.id, "snapshots", "memory", "procedures", "child-procedure.yaml"), "utf8"), "!procedure\nnames: [child procedure]\nflow:\n  - !call\n    target: grandchild procedure\n");
      assert.equal(await readFile(join(reviewsRoot, review.id, "snapshots", "memory", "procedures", "grandchild-procedure.yaml"), "utf8"), "!procedure\nnames: [grandchild procedure]\nflow: []\n");
      assert.equal(await readFile(join(reviewsRoot, review.id, "snapshots", "memory", "schemas", "used-schema.yaml"), "utf8"), "!schema\nnames: [used schema]\nformat: outline\nfields: []\n");
      await assert.rejects(readFile(join(reviewsRoot, review.id, "snapshots", "memory", "procedures", "unrelated.yaml")));
      assert.doesNotMatch(await readFile(join(reviewsRoot, review.id, "review.yaml"), "utf8"), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      await writeFile(join(runDir, "artifacts", "001-result.md"), "changed artifact\n");
      const snapshot = await fetch(`${url}/api/reviews/${review.id}/snapshot?kind=task`);
      assert.equal(snapshot.status, 200);
      const body = await snapshot.json() as { run: RunState };
      assert.equal((body.run.events[0]?.artifact as { content?: string }).content, "snapshot artifact\n");
      const inlineStep = body.run.plan?.find((step) => step.id === "flow[4]");
      assert.equal(inlineStep?.inlineSchemaId, "inline:flow[4]:private-schema");
      assert.deepEqual(inlineStep?.asserts, ["Keep it auditable."]);
      await assert.rejects(readFile(join(reviewsRoot, review.id, "snapshots", "memory", "schemas", "inline:flow[4]:private-schema.yaml")));
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
