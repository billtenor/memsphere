import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownContent } from "../src/commands/view.js";
import { browserHtml, canCreateTaskReview, shouldRenderMarkdownArtifact, shouldRenderTaskStepArtifact } from "../src/view/browser.js";

test("embedded browser script is valid JavaScript", () => {
  const script = browserHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert(script);
  assert.doesNotThrow(() => new Function(script));
});

test("memory view recognizes only tagged actions and renders recursive typed structures", () => {
  assert.match(browserHtml, /step\.tag === "!action"/);
  assert.match(browserHtml, /while \(branch\)/);
  assert.match(browserHtml, /definition\.tag === "!schema"/);
  assert.match(browserHtml, /typeof child === "string"/);
});

test("task step artifact area is hidden when no event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact(undefined), false);
  assert.equal(shouldRenderTaskStepArtifact(null), false);
});

test("task step artifact area is shown when an event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact({ stepId: "flow-1", artifact: { value: "done" } }), true);
});

test("only done tasks enable task review creation", () => {
  assert.equal(canCreateTaskReview("done"), true);
  assert.equal(canCreateTaskReview("running"), false);
  assert.match(browserHtml, /Only done tasks can create a review/);
});

test("markdown artifacts use rendered markdown content when available", () => {
  assert.equal(shouldRenderMarkdownArtifact({ format: "markdown", renderedContent: "<h1>Title</h1>" }), true);
  assert.equal(shouldRenderMarkdownArtifact({ format: "markdown" }), false);
  assert.equal(shouldRenderMarkdownArtifact({ format: "string", renderedContent: "<h1>Title</h1>" }), false);
});

test("renderMarkdownContent renders basic markdown blocks", () => {
  const html = renderMarkdownContent("# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```");

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code class="language-ts">const x = 1;\n<\/code><\/pre>/);
});

test("renderMarkdownContent escapes raw HTML", () => {
  const html = renderMarkdownContent("<script>alert(1)</script>");

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("renderMarkdownContent rejects unsafe links and annotates safe links", () => {
  const unsafe = renderMarkdownContent("[bad](javascript:alert(1))");
  assert.doesNotMatch(unsafe, /href="javascript:/i);

  const safe = renderMarkdownContent("[ok](https://example.com)");
  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener noreferrer nofollow"/);
});

test("markdown body resets inherited pre-wrap whitespace", () => {
  assert.match(browserHtml, /\.markdown-body \{[^}]*white-space: normal;/);
});

test("browser exposes reserved memory controls", () => {
  assert.match(browserHtml, /\/api\/reserved-memories/);
  assert.match(browserHtml, /\/api\/reserved-memories\/import/);
  assert.match(browserHtml, /Reserved/);
  assert.match(browserHtml, /Import/);
  assert.match(browserHtml, /Imported/);
});

test("browser exposes archive controls for done reviews and runs", () => {
  assert.match(browserHtml, /review-archive/);
  assert.match(browserHtml, /task-card-archive/);
  assert.match(browserHtml, /\/api\/archive\/reviews\//);
  assert.match(browserHtml, /\/api\/archive\/runs\//);
  assert.match(browserHtml, /archiveDoneOnly/);
});

test("browser renders Statement suggestions separately from assertions", () => {
  assert.match(browserHtml, /suggests: \{ zh: "建议", yaml: "suggests" \}/);
  assert.match(browserHtml, /appendList\(target, t\("suggests"\), node\.suggests, "suggests"\)/);
});
