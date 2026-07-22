import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { enterSchema, reportRun, startRun } from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("View API exposes the active Schema production projection and managed draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-schema-view-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "schema.yaml"), withCurrentMemorySyntax(`!procedure
name: schema-in-view
flow:
  - !action
    action: Produce a complete delivery.
    asserts: [Keep it coherent.]
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        names: [Delivery]
        fields: [summary]
`));

  const started = await startRun({ memoryRoot, runsRoot, procedureName: "schema-in-view" });
  await enterSchema({ memoryRoot, runsRoot, runId: started.id });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });

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
    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      runs: Array<{
        id: string;
        schemaWriting?: {
          parentStepId: string;
          progress: { completed: number; total: number; current?: string };
          currentField?: { sources: Array<{ path: string }> };
          draft?: { filePath: string; content: string; renderedContent: string };
        };
      }>;
    };
    const run = payload.runs.find((candidate) => candidate.id === started.id);
    assert(run?.schemaWriting);
    assert.equal(run.schemaWriting.parentStepId, "flow[1]");
    assert.equal(run.schemaWriting.progress.completed, 1);
    assert.equal(run.schemaWriting.progress.total, 2);
    assert.match(run.schemaWriting.progress.current ?? "", /summary$/);
    assert.equal(run.schemaWriting.currentField?.sources[0]?.path, "inline:flow[1]:delivery");
    assert.match(run.schemaWriting.draft?.filePath ?? "", /delivery-[a-f0-9]+\.draft\.md$/);
    assert.match(run.schemaWriting.draft?.content ?? "", /memsphere:pending field=.*summary/);
    assert.match(run.schemaWriting.draft?.renderedContent ?? "", /<h1>Delivery<\/h1>/);
  } finally {
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});
