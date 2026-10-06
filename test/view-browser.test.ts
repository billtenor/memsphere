import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createViewServer, isViewPagePath, renderMarkdownContent } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("View page routing accepts supported pages and rejects API, asset, and unknown paths", () => {
  const concretePaths = [
    "/",
    "/memories",
    "/market",
    "/memory-market",
    "/memories/concepts/Memory",
    "/projects/alpha/memories",
    "/projects/alpha/memories/concepts/Memory",
    "/projects/alpha/market",
    "/projects/alpha/changes/change-1",
    "/tasks",
    "/tasks/run-1",
    "/tasks/run-1/artifact-reviews/review-1",
    "/model-prototype",
    "/models",
    "/models/market",
    "/model-prototype/storage",
    "/reference",
    "/reference/dialog",
    "/reference/drawer",
    "/settings/overview",
    "/settings/participants"
  ];
  for (const path of concretePaths) assert.equal(isViewPagePath(path), true, path);

  for (const path of [
    "/api/memories",
    "/api/unknown",
    "/unknown",
    "/projects/alpha/changes",
    "/tasks/run-1/other/review-1",
    "/settings",
    "/assets/modules/unknown/index.js"
  ]) assert.equal(isViewPagePath(path), false, path);

});

test("Memory summary API lists valid headers even when the body cannot be parsed", async t => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-summary-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const memoryRoot = join(root, "memory");
  await mkdir(join(memoryRoot, "concepts"), { recursive: true });
  await writeFile(join(memoryRoot, "concepts/broken.yaml"), withCurrentMemorySyntax(
    "!concept\nnames: [valid-name, Valid name]\ndefines: [\n"
  ));
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, homeRoot: root,
    language: "en", memoryRoot, runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    debug: { agentReview: false, root: join(root, ".runtime") }, view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const summaryResponse = await fetch(`${origin}/api/memories?representation=summary`);
  assert.equal(summaryResponse.status, 200);
  const summary = (await summaryResponse.json()).memories;
  assert.equal(summary.length, 1);
  assert.equal(summary[0].id, "concepts/valid-name");
  assert.deepEqual(summary[0].names, ["valid-name", "Valid name"]);
  assert.equal(summary[0].error, undefined);
  assert.equal(summary[0].entity, undefined);

  const fullResponse = await fetch(`${origin}/api/memories`);
  assert.equal(fullResponse.status, 200);
  const full = (await fullResponse.json()).memories;
  assert.equal(full.length, 1);
  assert.equal(full[0].path, "concepts/broken.yaml");
  assert.ok(full[0].error);
});

test("renderMarkdownContent renders GFM blocks while escaping unsafe HTML and links", () => {
  const rendered = renderMarkdownContent([
    "# Report",
    "",
    "| Name | Value |",
    "| --- | ---: |",
    "| safe | [docs](https://example.com) |",
    "",
    "<script>alert(1)</script>",
    "[unsafe](javascript:alert(1))"
  ].join("\n"));
  assert.match(rendered, /<h1>Report<\/h1>/);
  assert.match(rendered, /<div class="markdown-table-scroll"><table>/);
  assert.match(rendered, /href="https:\/\/example\.com"/);
  assert.match(rendered, /rel="noopener noreferrer nofollow"/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /href="javascript:/);
});
