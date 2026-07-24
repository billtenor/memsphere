import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-review-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("View keeps Memory Review and rejects the removed Task Review API", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const reviewsRoot = join(dir, "reviews");
    const runsRoot = join(dir, "runs");
    await mkdir(join(memoryRoot, "statements"), { recursive: true });
    await mkdir(reviewsRoot, { recursive: true });
    await mkdir(runsRoot, { recursive: true });
    await writeFile(
      join(memoryRoot, "statements", "review-target.yaml"),
      withCurrentMemorySyntax("!statement\nnames: [Review target]\ndefines: [Keep Memory Review available.]\n")
    );

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

      const removed = await fetch(`${url}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "task", runId: "run-old-review" })
      });
      assert.equal(removed.status, 410);
      assert.match(await removed.text(), /task reviews have been removed/i);

      const created = await fetch(`${url}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "memory",
          memoryId: "statements/Review target",
          memoryName: "Review target",
          memoryPath: "statements/review-target.yaml"
        })
      });
      assert.equal(created.status, 201);
      const review = (await created.json() as { review: { id: string; source: string } }).review;
      assert.equal(review.source, "memory");

      const snapshot = await fetch(`${url}/api/reviews/${review.id}/snapshot?kind=memory`);
      assert.equal(snapshot.status, 200);
      const payload = await snapshot.json() as { memory: { id: string } };
      assert.equal(payload.memory.id, "statements/Review target");

      const removedSnapshot = await fetch(`${url}/api/reviews/${review.id}/snapshot?kind=task`);
      assert.equal(removedSnapshot.status, 410);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
