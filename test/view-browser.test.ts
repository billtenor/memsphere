import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import { isViewPagePath, renderMarkdownContent } from "../src/commands/view.js";

test("View page routes are the union of the builtin Module route grants", () => {
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

  assert.deepEqual(
    builtinModuleCatalog.flatMap(module => module.routes.flatMap(route => [route.path, ...(route.aliases ?? [])])),
    [
      "/", "/memories", "/market", "/memory-market", "/memories/:kind/:name",
      "/projects/:projectId/memories", "/projects/:projectId/memories/:kind/:name",
      "/projects/:projectId/market", "/projects/:projectId/changes/:changeId",
      "/tasks", "/tasks/:runId", "/tasks/:runId/artifact-reviews/:reviewId",
      "/settings/:module"
    ]
  );
});

test("each builtin View entry is a separately compiled Plugin source", async () => {
  for (const entry of builtinModuleCatalog) {
    const source = await readFile(resolve("modules", entry.packageDirectory, "adapter/view/index.ts"), "utf8");
    assert.match(source, /from "@memsphere\/view-sdk"/);
    assert.match(source, /export default defineViewPlugin/);
    assert.match(source, /slots\.mainView/);
  }
});

test("Memory summaries do not reuse full Memory readers", async () => {
  const source = await readFile(new URL("../src/commands/view.ts", import.meta.url), "utf8");
  const body = source.match(/async function loadMemorySummaryPayload[\s\S]*?\r?\n}\r?\n\r?\nasync function loadMemoryDetailPayload/)?.[0] ?? "";
  assert.match(body, /readMemoryFileSummary/);
  assert.doesNotMatch(body, /loadMemoryPayload|readMemoryFile\(/);
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
