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

test("browser renders Schema Repeat structure and its Run control command", () => {
  assert.match(browserHtml, /function renderSchemaRepeat\(node, depth, path\)/);
  assert.match(browserHtml, /child\.tag === "!repeat"/);
  assert.match(browserHtml, /body\.append\(children\)/);
  assert.doesNotMatch(browserHtml, /body\.append\(blockTitle\("body"\), children\)/);
  assert.match(browserHtml, /"memsphere run repeat <count> --run "/);
  assert.match(browserHtml, /const isRepeat = step\.kind === "repeat" && step\.repeat/);
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

test("renderMarkdownContent renders GFM tables with semantic structure", () => {
  const html = renderMarkdownContent("| Name | Value |\n| --- | --- |\n| Alpha | `one` |\n| Beta | &lt;safe&gt; |");

  assert.match(html, /<div class="markdown-table-scroll"><table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>Alpha<\/td>/);
  assert.match(html, /<td><code>one<\/code><\/td>/);
  assert.match(html, /&lt;safe&gt;/);
});

test("renderMarkdownContent does not mistake pipe text or code fences for tables", () => {
  const pipeText = renderMarkdownContent("Alpha | Beta");
  const codeBlock = renderMarkdownContent("```text\n| Name | Value |\n| --- | --- |\n| Alpha | Beta |\n```");

  assert.doesNotMatch(pipeText, /<table>/);
  assert.doesNotMatch(codeBlock, /<table>/);
  assert.match(codeBlock, /<pre><code class="language-text">/);
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

test("markdown tables use a horizontal scrolling container", () => {
  assert.match(browserHtml, /\.markdown-table-scroll \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
  assert.match(browserHtml, /\.markdown-body table \{[^}]*width: max-content;[^}]*min-width: 100%;/);
});

test("task view switches to two columns on compact desktop screens", () => {
  const compactLayout = browserHtml.match(/@media \(max-width: 1400px\) \{([\s\S]*?)\n    \}/)?.[1];
  const narrowLayout = browserHtml.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\n    \}/)?.[1];

  assert(compactLayout);
  assert(narrowLayout);
  assert.match(compactLayout, /body\.task-mode \.shell \{ grid-template-columns: 280px minmax\(0, 1fr\) 0; \}/);
  assert.match(narrowLayout, /\.flow-head \{ grid-template-columns: 1fr;/);
  assert.match(narrowLayout, /\.artifact-row \{ justify-content: flex-start; min-width: 0; \}/);
});

test("Review expands the shell into a third layout column on demand", () => {
  assert.match(browserHtml, /\.shell \{ display: grid; grid-template-columns: 300px minmax\(0, 1fr\) 0;/);
  assert.match(browserHtml, /body\.review-drawer-open \.shell \{ grid-template-columns: 300px minmax\(0, 1fr\) minmax\(300px, 380px\); \}/);
  assert.match(browserHtml, /\.review \{ min-width: 0; overflow: hidden; visibility: hidden;/);
  assert.doesNotMatch(browserHtml, /position: fixed; z-index: 30;/);
  assert.doesNotMatch(browserHtml, /function isCompactReviewLayout/);
});

test("flow cards can shrink inside the task grid", () => {
  assert.match(browserHtml, /\.flow-item \{ min-width: 0;/);
});

test("Review has accessible open and close controls", () => {
  assert.match(browserHtml, /id="review-toggle"[^>]*aria-controls="review-panel"[^>]*aria-expanded="false"/);
  assert.match(browserHtml, /id="review-close"/);
  assert.match(browserHtml, /function setReviewDrawer\(open\)/);
  assert.match(browserHtml, /event\.key === "Escape" && state\.reviewDrawerOpen/);
  assert.match(browserHtml, /body\.review-drawer-open \.review \{ overflow: auto; visibility: visible; pointer-events: auto;/);
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

test("browser renders recursive Statement sections and keeps suggestions separate", () => {
  assert.match(browserHtml, /suggests: \{ zh: "建议", yaml: "suggests" \}/);
  assert.match(browserHtml, /sections: \{ zh: "章节", yaml: "sections" \}/);
  assert.match(browserHtml, /appendList\(target, t\("suggests"\), node\.suggests, "suggests"\)/);
  assert.match(browserHtml, /memory\.kind === "statements"\) el\.detail\.append\(renderStatement/);
  assert.match(browserHtml, /function renderStatement\(node, depth, path, fallbackName = t\("statements"\), anchor = "statement:" \+ path\)/);
  assert.match(browserHtml, /for \(const \[index, child\] of node\.sections\.entries\(\)\)/);
  assert.match(browserHtml, /children\.append\(renderStatement\(child, depth \+ 1, childPath, t\("statements"\), anchor \+ ":sections\["/);
  assert.match(browserHtml, /sectionHeader\(name, "!statement", path, anchor\)/);
  assert.match(browserHtml, /renderStatement\(definition, 1, path, "", path\)/);
});

test("browser renders Action contracts, inline schemas, and final artifacts as distinct task UI", () => {
  assert.match(browserHtml, /function renderActionContracts\(step\)/);
  assert.match(browserHtml, /step\.asserts/);
  assert.match(browserHtml, /step\.suggests/);
  assert.match(browserHtml, /function renderInlineSchemaDetails\(step, expanded = false\)/);
  assert.match(browserHtml, /inline schema/);
  assert.match(browserHtml, /const section = renderSchema\(schema, 1, "inline-schema:" \+ identity, t\("inlineSchema"\)\)/);
  assert.match(browserHtml, /section\.classList\.add\("inline-schema-section"\)/);
  assert.match(browserHtml, /wrap\.append\(blockTitle\(t\("artifact"\)\), section\)/);
  assert.match(browserHtml, /body\.append\(blockTitle\(t\("fields"\)\), children\)/);
  assert.match(browserHtml, /function renderSimpleSchemaField\(name, path\)[\s\S]*field\.className = "schema-field-plain"/);
  assert.doesNotMatch(browserHtml, /function renderSimpleSchemaField\(name, path\)[\s\S]*sectionHeader\(name, "string"/);
  assert.match(browserHtml, /function renderFinalArtifacts\(run\)/);
  assert.match(browserHtml, /event\.artifact\.final/);
  assert.match(browserHtml, /renderStructuredAction\(step, anchor\)[\s\S]*renderActionContracts\(step\)/);
  assert.match(browserHtml, /renderStructuredControlHead\(step, anchor, labelText[\s\S]*renderInlineSchemaDetails\(step\)/);
  assert.match(browserHtml, /function inlineSchemaTogglePill\(schema\)/);
  assert.match(browserHtml, /function inlineSchemaSummary\(schema\)/);
});

test("browser renders Procedure assertions in memory and active run views", () => {
  assert.match(browserHtml, /appendTextBlocks\(wrap, entity\)/);
  assert.match(browserHtml, /function renderRunProcedureAsserts\(run\)/);
  assert.match(browserHtml, /function activeRunProcedureAsserts\(run\)/);
  assert.match(browserHtml, /frame\.asserts/);
});

test("memory details render names as a field while retaining the primary name as the page title", () => {
  assert.match(browserHtml, /names: \{ zh: "名称", yaml: "names" \}/);
  assert.match(browserHtml, /appendList\(target, t\("names"\), node\.names, "names"\)/);
  assert.match(browserHtml, /el\.title\.textContent = primaryName\(memory\.entity\);/);
});
