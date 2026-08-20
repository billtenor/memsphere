import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      withCurrentMemorySyntax("!statement\nnames: [review-target, Review target]\nasserts: [Keep Memory Review available.]\n")
    );
    await writeFile(
      join(memoryRoot, "statements", "lazy-header.yaml"),
      withCurrentMemorySyntax("!statement\nnames: [lazy-header, Lazy header]\nasserts: [\n  summary-must-not-parse-this-broken-body\n")
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
          memoryId: "statements/review-target",
          memoryName: "Review target",
          memoryPath: "statements/review-target.yaml"
        })
      });
      assert.equal(created.status, 201);
      const review = (await created.json() as { review: { id: string; source: string } }).review;
      assert.equal(review.source, "memory");
      const persistedReviewSummary = JSON.parse(
        await readFile(join(reviewsRoot, review.id, "summary.json"), "utf8")
      ) as { summary: { id: string; commentCount: number; comments?: unknown } };
      assert.equal(persistedReviewSummary.summary.id, review.id);
      assert.equal(persistedReviewSummary.summary.commentCount, 0);
      assert.equal(persistedReviewSummary.summary.comments, undefined);

      const memorySummariesResponse = await fetch(`${url}/api/memories?representation=summary`);
      assert.equal(memorySummariesResponse.status, 200);
      const memorySummariesSource = await memorySummariesResponse.text();
      const memorySummaries = JSON.parse(memorySummariesSource) as {
        memories: Array<{ id: string; names?: string[]; entity?: unknown }>;
      };
      const memorySummary = memorySummaries.memories.find((memory) => memory.id === "statements/review-target");
      assert(memorySummary, memorySummariesSource);
      assert.deepEqual(memorySummary.names, ["review-target", "Review target"]);
      assert.equal(memorySummary?.entity, undefined);
      assert.doesNotMatch(memorySummariesSource, /Keep Memory Review available/);
      const lazySummary = memorySummaries.memories.find((memory) => memory.id === "statements/lazy-header");
      assert.deepEqual(lazySummary?.names, ["lazy-header", "Lazy header"]);
      assert.doesNotMatch(memorySummariesSource, /summary-must-not-parse-this-broken-body/);

      const memoryDetail = await fetch(`${url}/api/memories/statements/review-target`);
      assert.equal(memoryDetail.status, 200);
      assert.match(await memoryDetail.text(), /Keep Memory Review available/);
      const lazyDetail = await fetch(`${url}/api/memories/statements/lazy-header`);
      assert.equal(lazyDetail.status, 200);
      assert.match(await lazyDetail.text(), /could not be loaded|Flow sequence/i);

      const reviewSummariesResponse = await fetch(
        `${url}/api/reviews?representation=summary&memory_id=${encodeURIComponent("statements/review-target")}`
        + `&memory_path=${encodeURIComponent("statements/review-target.yaml")}`
      );
      assert.equal(reviewSummariesResponse.status, 200);
      const reviewSummariesSource = await reviewSummariesResponse.text();
      const reviewSummaries = JSON.parse(reviewSummariesSource) as {
        reviews: Array<{ id: string; source: string; commentCount: number; comments?: unknown }>;
      };
      assert.equal(reviewSummaries.reviews[0]?.id, review.id);
      assert.equal(reviewSummaries.reviews[0]?.source, "memory");
      assert.equal(reviewSummaries.reviews[0]?.commentCount, 0);
      assert.equal(reviewSummaries.reviews[0]?.comments, undefined);

      await rm(join(reviewsRoot, review.id, "summary.json"), { force: true });
      const legacySummary = await fetch(
        `${url}/api/reviews?representation=summary&memory_id=${encodeURIComponent("statements/review-target")}`
      );
      assert.equal(legacySummary.status, 200);
      assert.equal(
        (JSON.parse(await readFile(join(reviewsRoot, review.id, "summary.json"), "utf8")) as { summary: { id: string } }).summary.id,
        review.id
      );

      const summaryPath = join(reviewsRoot, review.id, "summary.json");
      await rm(summaryPath, { force: true });
      await mkdir(summaryPath);
      const updatedWithoutCache = await fetch(`${url}/api/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "submitted" })
      });
      assert.equal(updatedWithoutCache.status, 200, await updatedWithoutCache.text());
      assert.match(await readFile(join(reviewsRoot, review.id, "review.yaml"), "utf8"), /status: submitted/);
      await rm(summaryPath, { recursive: true });
      const rebuiltAfterCacheFailure = await fetch(
        `${url}/api/reviews?representation=summary&memory_id=${encodeURIComponent("statements/review-target")}`
      );
      assert.equal(rebuiltAfterCacheFailure.status, 200);
      assert.equal(
        ((await rebuiltAfterCacheFailure.json()) as { reviews: Array<{ status: string }> }).reviews[0]?.status,
        "submitted"
      );

      const reviewDetail = await fetch(`${url}/api/reviews/${review.id}`);
      assert.equal(reviewDetail.status, 200);
      assert.deepEqual((await reviewDetail.json() as { review: { comments: unknown[] } }).review.comments, []);

      const snapshot = await fetch(`${url}/api/reviews/${review.id}/snapshot?kind=memory`);
      assert.equal(snapshot.status, 200);
      const payload = await snapshot.json() as { memory: { id: string } };
      assert.equal(payload.memory.id, "statements/review-target");

      const removedSnapshot = await fetch(`${url}/api/reviews/${review.id}/snapshot?kind=task`);
      assert.equal(removedSnapshot.status, 410);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
