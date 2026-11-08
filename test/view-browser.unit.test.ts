import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { isViewPagePath, renderMarkdownContent } from "../src/commands/view.js";


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
