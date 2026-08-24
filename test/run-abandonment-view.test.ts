import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { enterSchema, readRun, reportRun, startRun } from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("View abandons a running Run without auto-archiving it", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-abandon-view-"));
  const memoryRoot = join(root, "memory");
  const runsRoot = join(root, "runs");
  const reviewsRoot = join(root, "reviews");
  const archiveRoot = join(root, "archive");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "abandon.yaml"), withCurrentMemorySyntax(`!procedure
name: abandon-from-view
flow:
  - !action
    action: Produce a result.
    artifact: !artifact
      name: result
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        name: Result
        fields: [summary]
`));
  const started = await startRun({ name: "Abandon in View", memoryRoot, runsRoot, procedureName: "abandon-from-view" });
  await enterSchema({ memoryRoot, runsRoot, runId: started.id });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Result" } });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "Unaccepted summary" } });
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"),
    scopeRoot: root,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot,
    view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const abandoned = await fetch(`${base}/api/runs/${started.id}/abandon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(abandoned.status, 200);
    const payload = await abandoned.json() as {
      run: {
        status: string;
        abandonment?: { reason?: string };
        schemaWriting?: { readOnly?: boolean; draft?: { status?: string; content?: string } };
      };
    };
    assert.equal(payload.run.status, "abandoned");
    assert.equal(payload.run.abandonment?.reason, undefined);
    assert.equal(payload.run.schemaWriting?.readOnly, true);
    assert.equal(payload.run.schemaWriting?.draft?.status, "awaiting_finalization");
    assert.match(payload.run.schemaWriting?.draft?.content ?? "", /Unaccepted summary/);
    assert.equal((await readRun(runsRoot, started.id)).status, "abandoned");

    const active = await fetch(`${base}/api/runs?representation=summary`).then((response) => response.json()) as {
      runs: Array<{ id: string; status: string }>;
    };
    assert.deepEqual(active.runs.find((run) => run.id === started.id)?.status, "abandoned");

    const archived = await fetch(`${base}/api/archive/runs/${started.id}`, { method: "POST" });
    assert.equal(archived.status, 200);
    const afterArchive = await fetch(`${base}/api/runs?representation=summary`).then((response) => response.json()) as {
      runs: Array<{ id: string }>;
    };
    assert.equal(afterArchive.runs.some((run) => run.id === started.id), false);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});
