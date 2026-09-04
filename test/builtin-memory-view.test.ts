import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const memoryBundlePath = "/assets/builtin/org.memsphere.memory.js";

test("Memory builtin independently registers its route pages and renders Memory detail", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(),
    browserModule("../src/view/view-sdk.ts"),
    browserRuntimeBundle()
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: {
      projectId: "demo",
      moduleId: "org.memsphere.memory",
      moduleVersion: "0.1.2",
      instanceId: "memory"
    }
  }];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [
      { id: "change-related", status: "active", memoryPaths: ["concepts/demo-memory.yaml"] },
      { id: "change-unrelated", status: "active", memoryPaths: ["statements/not-installed.yaml"] }
    ] });
    if (url.pathname === "/api/memories") return json(response, {
      memories: [{ id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", names: ["demo-memory"], system: false }]
    });
    if (url.pathname === "/api/memories/concepts/demo-memory") return json(response, {
      memory: { id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", entity: { names: ["Demo Memory"], defines: ["Independent builtin detail"] } }
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/memories/concepts/demo-memory`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Memory", exact: true, level: 1 }).waitFor();
    assert.match(await page.locator(".memory-workspace").innerText(), /Independent builtin detail/);
    assert.equal(await page.locator(".memory-workspace .memory-inline-plus").count(), 0, "published Memory detail must not expose ChangeSet comment controls");
    assert.equal(await page.locator(".mem-view-content-list").count(), 1, "the list surface uses the public Content List primitive");
    assert.equal(await page.locator(".memory-detail-module").count(), 1, "the domain detail remains an independent Module surface");
    assert.equal(await page.locator('[data-view-slot="navigation.secondary"] [aria-current="page"]').count(), 1);
    assert.equal(await page.locator(".mem-view-list-item").count(), 1);
    assert.equal(await page.getByText("Other ChangeSets", { exact: false }).count(), 0);
    assert.equal(await page.getByText("change-unrelated", { exact: false }).count(), 0, "unrelated ChangeSets belong only in the dedicated ChangeSets navigation");
    const relatedToggle = page.locator(".mem-view-list-item-actions button");
    await relatedToggle.click();
    assert.equal(await relatedToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator(".mem-view-list-item-details").count(), 1);
    const relatedLink = page.getByRole("button", { name: "change-related · Active", exact: true });
    assert.equal(await relatedLink.getAttribute("class"), "mem-view-button memory-related-link");
    assert.deepEqual(await relatedLink.evaluate(node => {
      const style = getComputedStyle(node);
      return { border: style.borderStyle, background: style.backgroundColor, decoration: style.textDecorationLine };
    }), { border: "none", background: "rgba(0, 0, 0, 0)", decoration: "underline" });
    await relatedToggle.click();
    assert.equal(await relatedToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".mem-view-list-item-details").count(), 0);
    assert.equal(await page.locator('.memory-workspace button', { hasText: "Edit" }).count(), 0);
    assert.equal(await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Create ChangeSet", exact: true }).count(), 1);
    await page.locator('[data-view-slot="navigation.secondary"] [data-secondary-id="recent"]').click();
    await page.waitForURL("**/memories?section=recent");
    assert.equal(await page.locator('[data-secondary-id="recent"]').getAttribute("aria-current"), "page");
  } finally {
    await browser.close();
    await close(server);
  }
});

test("Memory builtin renders Market status and opens an importing ChangeSet", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
  }];
  let validatedPreviewRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "change-market", status: "active", memoryPaths: [] }] });
    if (url.pathname === "/api/memories") {
      if (url.searchParams.has("change")) {
        validatedPreviewRequests += 1;
        return send(response, 400, "application/json", JSON.stringify({ code: "changeset_unavailable", error: "ChangeSet has no validated checkpoint" }));
      }
      return json(response, { memories: [] });
    }
    if (url.pathname === "/api/market/memories") return json(response, { memories: [{ reference: "concepts/market-memory", kind: "concepts", status: "importing", changeId: "change-market", entity: { names: ["Market Memory"], defines: ["Market content"] } }] });
    if (url.pathname === "/api/changes/change-market") return json(response, {
      change: { id: "change-market", status: "active", memoryPaths: ["concepts/market-memory.yaml"] },
      targetMemories: [{
        reference: "concepts/market-memory",
        operation: "create",
        memory: { id: "concepts/market-memory", kind: "concepts", path: "concepts/market-memory.yaml", entity: { names: ["market-memory", "Market Memory"], defines: ["Market content"] } }
      }],
      comments: []
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/market`, { waitUntil: "networkidle" });
    const market = page.getByRole("button", { name: /Market Memory.*Importing/ });
    await market.waitFor();
    assert.equal(await page.locator('.memory-workspace button', { hasText: "View the corresponding ChangeSet" }).count(), 0);
    await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "View the corresponding ChangeSet", exact: true }).click();
    await page.waitForURL(`${origin}/projects/demo/changes/change-market?section=market`);
    await page.locator(".memory-title", { hasText: "change-market" }).waitFor();
    await page.locator(".memory-change-layout").getByRole("heading", { name: "Market Memory", exact: true }).waitFor();
    assert.match(await page.locator(".memory-change-layout").innerText(), /Market content/);
    assert.equal(validatedPreviewRequests, 0);
    assert.equal(await page.getByRole("button", { name: "← Back to Memory", exact: true }).count(), 0);
  } finally {
    await browser.close();
    await close(server);
  }
});

test("Memory builtin compares a real ChangeSet with the existing Memory renderer", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
  }];
  const submittedComments: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/market/memories") return json(response, { count: 0, memories: [] });
    if (url.pathname === "/api/memories") return json(response, { memories: [] });
    if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "change-diff", status: "active", memoryPaths: ["statements/delivery.yaml", "procedures/delivery.yaml", "statements/created.yaml", "statements/deleted.yaml"] }] });
    if (url.pathname === "/api/changes/change-diff/comments" && request.method === "POST") {
      let value = "";
      for await (const chunk of request) value += chunk;
      const submittedComment = JSON.parse(value) as Record<string, unknown>;
      submittedComments.push(submittedComment);
      return json(response, { comment: { id: `comment-${submittedComments.length}`, ...submittedComment } });
    }
    if (url.pathname === "/api/changes/change-diff") return json(response, {
      change: { id: "change-diff", status: "active", valid: true, baseRevision: "1234567890", digest: "abcdef1234", memoryPaths: ["statements/delivery.yaml", "procedures/delivery.yaml"] },
      targetMemories: [{
        reference: "statements/delivery",
        operation: "update",
        baseMemory: { id: "statements/delivery", kind: "statements", path: "statements/delivery.yaml", entity: { names: ["delivery", "Delivery"], defines: ["Before definition", "Definition stays unchanged"], asserts: ["Keep evidence", "Last rule stays unchanged"], suggests: ["Remove stale copy"] } },
        memory: { id: "statements/delivery", kind: "statements", path: "statements/delivery.yaml", entity: { names: ["delivery", "Delivery"], defines: ["After definition", "Definition stays unchanged"], asserts: ["Keep evidence", "Open the ChangeSet View", "Last rule stays unchanged"] } }
      }, {
        reference: "procedures/delivery",
        operation: "update",
        baseMemory: { id: "procedures/delivery", kind: "procedures", path: "procedures/delivery.yaml", entity: { names: ["delivery", "Procedure delivery"], flow: [{ tag: "!action", action: "Deliver the result", artifact: { name: "Old artifact", format: "markdown", review: ["Product"] } }] } },
        memory: { id: "procedures/delivery", kind: "procedures", path: "procedures/delivery.yaml", entity: { names: ["delivery", "Procedure delivery"], flow: [{ tag: "!action", action: "Deliver the result", artifact: { name: "New artifact", format: "markdown", review: ["Product"] } }] } }
      }, {
        reference: "statements/created",
        operation: "create",
        memory: { id: "statements/created", kind: "statements", path: "statements/created.yaml", entity: { names: ["created", "Created Memory"], defines: ["Only candidate content"], asserts: ["Created rule"] } }
      }, {
        reference: "statements/deleted",
        operation: "delete",
        baseMemory: { id: "statements/deleted", kind: "statements", path: "statements/deleted.yaml", entity: { names: ["deleted", "Deleted Memory"], defines: ["Only base content"], asserts: ["Deleted rule"] } }
      }],
      comments: []
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let dialogCount = 0;
    page.on("dialog", dialog => { dialogCount += 1; void dialog.dismiss(); });
    await page.goto(`${origin}/projects/demo/changes/change-diff`, { waitUntil: "networkidle" });
    await page.locator(".memory-inline-diff-pair, li.memory-inline-diff-item").first().waitFor();
    const inlineDiff = page.locator(".memory-list-block").filter({ hasText: "Before definition" });
    assert.equal(await inlineDiff.count(), 1);
    assert.match(await inlineDiff.innerText(), /Before\s+Before definition\s+After\s+After definition/);
    assert.equal(await page.locator(".memory-inline-old").count() > 0, true);
    assert.equal(await page.locator(".memory-inline-new").count() > 0, true);
    const replacedDefinition = inlineDiff.locator("li.memory-inline-diff-item");
    assert.equal(await replacedDefinition.count(), 1);
    assert.equal(await replacedDefinition.locator(":scope > .memory-inline-old, :scope > .memory-inline-new").count(), 2);
    assert.equal(await replacedDefinition.locator(":scope > .memory-inline-old, :scope > .memory-inline-new").evaluateAll(nodes => nodes.every(node => node.tagName === "DIV")), true);
    const unchangedDefinitionLeft = await inlineDiff.locator("li").filter({ hasText: "Definition stays unchanged" }).evaluate(node => node.getBoundingClientRect().left);
    assert.equal(Math.abs(await replacedDefinition.evaluate(node => node.getBoundingClientRect().left) - unchangedDefinitionLeft) < 1, true);
    assert.notEqual(await replacedDefinition.evaluate(node => getComputedStyle(node, "::marker").color), "rgb(201, 75, 64)");
    assert.notEqual(await replacedDefinition.evaluate(node => getComputedStyle(node, "::marker").color), "rgb(25, 128, 113)");
    assert.equal(await page.locator("li.memory-inline-marker-old").first().evaluate(node => getComputedStyle(node, "::marker").color), "rgb(201, 75, 64)");
    assert.equal(await page.locator("li.memory-inline-marker-new").first().evaluate(node => getComputedStyle(node, "::marker").color), "rgb(25, 128, 113)");
    const replacementLineBox = await page.locator(".memory-inline-new").filter({ hasText: "After definition" }).evaluate(node => node.getBoundingClientRect().toJSON());
    const additionLine = page.locator(".memory-inline-new").filter({ hasText: "Open the ChangeSet View" });
    assert.match(await additionLine.innerText(), /^Added\s+Open the ChangeSet View/);
    assert.doesNotMatch(await additionLine.innerText(), /^After\b/);
    const additionLineBox = await additionLine.evaluate(node => node.getBoundingClientRect().toJSON());
    assert.equal(Math.abs(replacementLineBox.left - additionLineBox.left) < 1, true);
    assert.equal(Math.abs(replacementLineBox.right - additionLineBox.right) < 1, true);
    assert.equal(await page.locator(".memory-inline-old, .memory-inline-new").filter({ hasText: "Last rule stays unchanged" }).count(), 0);
    const removedSuggestion = page.locator(".memory-inline-removed");
    assert.match(await removedSuggestion.innerText(), /Deleted\s+Remove stale copy/);
    assert.doesNotMatch(await removedSuggestion.innerText(), /Before\s+Remove stale copy/);
    await removedSuggestion.locator(".memory-inline-old").hover();
    const removedPlus = removedSuggestion.locator(".memory-inline-plus");
    assert.equal(await removedPlus.count(), 1);
    assert.equal(await removedPlus.isVisible(), true);
    await removedPlus.click();
    const removedEditor = page.locator(".memory-inline-comment-editor");
    assert.equal(await removedEditor.count(), 1);
    await removedEditor.locator("textarea").fill("Comment on locally deleted content");
    await removedEditor.getByRole("button", { name: "Submit comment", exact: true }).click();
    await removedEditor.waitFor({ state: "detached" });
    assert.equal(submittedComments.at(-1)?.body, "Comment on locally deleted content");
    assert.equal(submittedComments.at(-1)?.memoryReference, "statements/delivery");
    assert.equal((submittedComments.at(-1)?.location as Record<string, unknown>)?.anchor, "statement.suggests[1]");
    const viewbar = page.locator(".memory-change-viewbar");
    assert.match(await viewbar.innerText(), /Diff\s+Full content\s+base\s+1234567\s+candidate\s+abcdef1/);
    assert.equal(await viewbar.evaluate(node => node.getBoundingClientRect().top < (node.nextElementSibling?.getBoundingClientRect().top ?? 0)), true);
    const breadcrumbButtons = page.locator(".view-shell-breadcrumbs button");
    assert.deepEqual(await breadcrumbButtons.allTextContents(), ["Memory", "ChangeSets"]);
    assert.equal(await page.locator(".view-shell-breadcrumb-separator").count(), 1);
    assert.equal(await page.locator(".memory-version").count(), 0);
    assert.match(await page.locator(".mem-view-progress").innerText(), /Reviewed 0 \/ 4/);
    const validation = page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Validation passed", exact: true });
    assert.equal(await validation.getAttribute("data-tone"), "success");
    assert.match(await validation.innerHTML(), /seal-check\.svg/);
    const validationIcon = validation.locator(".mem-view-system-icon");
    assert.equal(await validationIcon.evaluate(node => getComputedStyle(node).backgroundColor), await validation.evaluate(node => getComputedStyle(node).color));
    await page.locator("#memsphere-view-root").evaluate(node => { node.scrollTop = 0; });
    await page.setViewportSize({ width: 1900, height: 900 });
    const collapseComments = page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Collapse comments", exact: true });
    await collapseComments.click();
    const expandComments = page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Expand comments", exact: true });
    await expandComments.waitFor();
    const collapsedMainWidth = await page.locator(".memory-change-main").evaluate(node => node.getBoundingClientRect().width);
    assert.equal(collapsedMainWidth >= 900 && collapsedMainWidth <= 961, true);
    const collapsedGeometry = await page.locator(".memory-change-main").evaluate(node => {
      const main = node.getBoundingClientRect();
      const root = document.querySelector("#memsphere-view-root")!.getBoundingClientRect();
      const toolbar = node.querySelector(".memory-change-viewbar")!.getBoundingClientRect();
      const children = [...node.querySelector(".memory-change-viewbar")!.children].map(child => child.getBoundingClientRect());
      const groupLeft = Math.min(...children.map(child => child.left));
      const groupRight = Math.max(...children.map(child => child.right));
      const segmentTextDeltas = [...node.querySelectorAll<HTMLElement>(".memory-diff-toolbar > button")].map(button => {
        const box = button.getBoundingClientRect();
        const label = button.querySelector("span")!.getBoundingClientRect();
        return Math.abs((box.left + box.right) / 2 - (label.left + label.right) / 2);
      });
      return {
        mainCenterDelta: Math.abs((main.left + main.right) / 2 - (root.left + root.right) / 2),
        toolbarCenterDelta: Math.abs((groupLeft + groupRight) / 2 - (toolbar.left + toolbar.right) / 2),
        segmentTextDeltas,
        overflowsRoot: main.left < root.left || main.right > root.right,
        rootScrollLeft: document.querySelector<HTMLElement>("#memsphere-view-root")!.scrollLeft
      };
    });
    assert.equal(collapsedGeometry.mainCenterDelta < 14, true);
    assert.equal(collapsedGeometry.toolbarCenterDelta < 2, true);
    assert.equal(collapsedGeometry.segmentTextDeltas.every(delta => delta < 2), true);
    assert.equal(collapsedGeometry.overflowsRoot, false);
    assert.equal(collapsedGeometry.rootScrollLeft, 0);
    await expandComments.click();
    const commentsRail = page.locator(".memory-comments");
    assert.equal(await commentsRail.locator(".memory-comments-header, .memory-comments-body").count(), 2);
    assert.equal(await commentsRail.locator(".memory-comments-footer, .memory-comment-composer").count(), 0);
    assert.equal(await commentsRail.evaluate(node => node.getBoundingClientRect().width <= 261), true);
    const workspaceTop = await page.locator(".memory-workspace").evaluate(node => node.getBoundingClientRect().top);
    assert.equal(Math.abs(await commentsRail.evaluate(node => node.getBoundingClientRect().top) - workspaceTop) < 1, true);
    const largeWorkspaceRight = await page.locator(".memory-change-workspace").evaluate(node => node.getBoundingClientRect().right);
    assert.equal(Math.abs(await commentsRail.evaluate(node => node.getBoundingClientRect().right) - largeWorkspaceRight) < 1, true);
    assert.equal(await page.locator(".memory-change-main").evaluate(node => node.getBoundingClientRect().width <= 721), true);
    const changedDefinition = page.locator(".memory-inline-new").filter({ hasText: "After definition" });
    const diffBodyTypography = await changedDefinition.evaluate(node => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    assert.equal(diffBodyTypography.fontSize, "13px");
    await changedDefinition.hover();
    const changedCommentButton = changedDefinition.locator(".memory-inline-plus");
    assert.equal(await changedCommentButton.count(), 1, await changedDefinition.evaluate(node => node.outerHTML));
    assert.equal(await changedCommentButton.isVisible(), true);
    assert.equal(await changedCommentButton.evaluate(node => getComputedStyle(node).position), "static");
    assert.equal(await page.locator(".text-list > li > .memory-commentable").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === "inline" && getComputedStyle(node.querySelector(".memory-inline-plus")!).position === "static")), true);
    const changedCommentPlacement = await changedDefinition.locator(".memory-commentable").evaluate(node => {
      const plus = node.querySelector<HTMLElement>(".memory-inline-plus")!;
      const text = document.createRange();
      text.selectNodeContents(node);
      text.setEndBefore(plus);
      const textBox = [...text.getClientRects()].at(-1)!;
      const plusBox = plus.getBoundingClientRect();
      return { gap: plusBox.left - textBox.right, trailingSpace: node.getBoundingClientRect().right - plusBox.right };
    });
    assert.equal(changedCommentPlacement.gap >= 7 && changedCommentPlacement.gap <= 9, true);
    assert.equal(changedCommentPlacement.trailingSpace < 1, true);
    const statementSection = page.locator(".memory-section.memory-commentable").first();
    await statementSection.locator(":scope > .memory-section-header").hover();
    assert.equal(await statementSection.locator(":scope > .memory-inline-plus").evaluate(node => getComputedStyle(node).display), "block");
    assert.equal(await statementSection.locator(".memory-section-body .memory-inline-plus").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === "0")), true);
    await changedDefinition.hover();
    assert.equal(await changedCommentButton.evaluate(node => getComputedStyle(node).opacity), "1");
    assert.equal(await statementSection.locator(":scope > .memory-inline-plus").evaluate(node => getComputedStyle(node).display), "none");
    await changedCommentButton.click();
    const inlineEditor = page.locator(".memory-inline-comment-editor");
    assert.equal(await inlineEditor.count(), 1);
    assert.equal(await commentsRail.locator(".memory-inline-comment-editor").count(), 0);
    assert.equal(await inlineEditor.locator(".memory-inline-comment-target").count(), 0);
    const inlineComposer = inlineEditor.locator("textarea");
    await inlineComposer.fill("Keep comment composition inline");
    await inlineEditor.getByRole("button", { name: "Submit comment", exact: true }).click();
    await inlineEditor.waitFor({ state: "detached" });
    assert.equal(dialogCount, 0);
    assert.equal(submittedComments.at(-1)?.body, "Keep comment composition inline");
    await commentsRail.getByRole("button", { name: "Collapse comments", exact: true }).click();
    await expandComments.waitFor();
    await expandComments.click();
    assert.equal(await page.locator(".mem-view-list-header").count(), 1);
    const listSurfaceRight = await page.locator('[data-view-slot="content.list"]').evaluate(node => node.getBoundingClientRect().right);
    assert.equal(await page.locator(".mem-view-content-list .mem-view-badge").evaluateAll((nodes, right) => nodes.every(node => node.getBoundingClientRect().right <= Number(right)), listSurfaceRight), true);
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    assert.equal(await page.locator(".memory-inline-old").count(), 0);
    assert.match(await page.locator(".memory-change-layout").innerText(), /After definition/);
    const fullBodyTypography = await page.locator(".text-list > li").filter({ hasText: "After definition" }).evaluate(node => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    assert.deepEqual(fullBodyTypography, diffBodyTypography);
    await page.getByRole("button", { name: "Procedure delivery", exact: true }).click();
    await page.getByRole("radio", { name: "Diff", exact: true }).click();
    const artifactDiff = page.locator(".memory-inline-diff-pair").filter({ hasText: "Old artifact" });
    assert.equal(await artifactDiff.locator(".memory-artifact-row").count(), 2);
    assert.equal(await artifactDiff.locator(".memory-artifact-row").evaluateAll(rows => rows.every(row => /Artifact/.test(row.textContent ?? "") && /markdown/.test(row.textContent ?? "") && /Product/.test(row.textContent ?? ""))), true);
    const candidateArtifactRow = artifactDiff.locator(".memory-inline-new .memory-artifact-row");
    assert.equal(await candidateArtifactRow.locator(".memory-inline-plus").count(), 1);
    assert.equal(await candidateArtifactRow.locator(".memory-pill .memory-inline-plus").count(), 0);
    await candidateArtifactRow.hover();
    assert.equal(await candidateArtifactRow.locator(".memory-inline-plus").isVisible(), true);
    const reviewCard = page.locator(".memory-review-complete");
    assert.equal(await reviewCard.evaluate(node => node.firstElementChild?.tagName === "BUTTON"), true);
    await page.getByRole("button", { name: "Mark reviewed and continue", exact: true }).click();
    assert.match(await page.locator(".mem-view-progress").innerText(), /Reviewed 1 \/ 4/);
    assert.equal(await page.locator(".mem-view-list-item .mem-view-badge", { hasText: "Reviewed" }).count(), 1);
    await page.getByRole("button", { name: /Created Memory/ }).click();
    assert.equal(await page.locator(".memory-inline-old").count(), 0);
    assert.equal(await page.locator(".memory-inline-new").count() > 0, true);
    assert.match(await page.locator(".memory-change-main").innerText(), /Only candidate content/);
    assert.match(await page.locator(".memory-inline-new").first().innerText(), /^Added\b/);
    await page.getByRole("button", { name: /Deleted Memory/ }).click();
    assert.equal(await page.locator(".memory-inline-new").count(), 0);
    assert.equal(await page.locator(".memory-inline-old").count() > 0, true);
    assert.match(await page.locator(".memory-change-main").innerText(), /Only base content/);
    assert.match(await page.locator(".memory-inline-old").first().innerText(), /^Deleted\b/);
    const deletedLine = page.locator(".memory-inline-old").filter({ hasText: "Only base content" });
    await deletedLine.hover();
    const deletedPlus = deletedLine.locator(".memory-inline-plus");
    assert.equal(await deletedPlus.count(), 1);
    assert.equal(await deletedPlus.isVisible(), true);
    await deletedPlus.click();
    const deletedEditor = page.locator(".memory-inline-comment-editor");
    assert.equal(await deletedEditor.count(), 1);
    await deletedEditor.locator("textarea").fill("Comment on deleted content");
    await deletedEditor.getByRole("button", { name: "Submit comment", exact: true }).click();
    await deletedEditor.waitFor({ state: "detached" });
    assert.equal(submittedComments.at(-1)?.body, "Comment on deleted content");
    assert.equal(submittedComments.at(-1)?.memoryReference, "statements/deleted");
    assert.equal((submittedComments.at(-1)?.location as Record<string, unknown>)?.anchor, "statement.defines[1]");
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    assert.match(await page.locator(".memory-deleted-candidate").innerText(), /Not present after deletion/);
    assert.match(await page.locator(".memory-before-full-content").innerText(), /Full content before deletion[\s\S]*Only base content/);
  } finally {
    await browser.close();
    await close(server);
  }
});

test("Memory builtin keeps Procedure content structured instead of exposing object-shaped YAML", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
  }];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [] });
    if (url.pathname === "/api/memories") return json(response, {
      memories: [{ id: "procedures/demo-flow", kind: "procedures", path: "procedures/demo-flow.yaml", names: ["demo-flow", "Demo Flow"], system: false }]
    });
    if (url.pathname === "/api/memories/procedures/demo-flow") return json(response, {
      memory: {
        id: "procedures/demo-flow", kind: "procedures", path: "procedures/demo-flow.yaml",
        entity: {
          names: ["demo-flow", "Demo Flow"], defines: ["A readable flow"],
          flow: [
            {
              tag: "!action", action: "Prepare input",
              asserts: ["Use traceable source material"],
              suggests: ["Prefer concise supporting context"],
              artifact: {
                name: "input", type: "object", format: { name: "markdown", options: { layout: "outline" } },
                schema: {
                  tag: "!schema", type: "object", format: "markdown", fields: [
                    "Source material",
                    { tag: "!schema", names: ["Test plan"], type: "object", fields: ["Scenarios", "Expected result"] }
                  ]
                }
              }
            },
            { tag: "!while", condition: { tag: "!action", action: "Needs another pass", artifact: "decision", format: "plain" }, do: [] }
          ]
        }
      }
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/memories/procedures/demo-flow`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Flow", exact: true, level: 1 }).waitFor();
    assert.equal(await page.locator(".memory-flow-item").count(), 2);
    assert.match(await page.locator(".memory-flow").innerText(), /Prepare input/);
    assert.match(await page.locator(".memory-flow").innerText(), /Needs another pass/);
    const inlineSchema = page.locator('[data-anchor="procedure.flow[1].artifact.schema"]');
    assert.equal(await inlineSchema.count(), 1);
    assert.equal(await inlineSchema.evaluate(node => node.classList.contains("open")), false);
    assert.match(await inlineSchema.innerText(), /Artifact format & structure/);
    assert.doesNotMatch(await inlineSchema.innerText(), /Source material|Expected result/);
    await inlineSchema.locator(":scope > .memory-section-header").click();
    assert.equal(await inlineSchema.evaluate(node => node.classList.contains("open")), true);
    assert.match(await inlineSchema.innerText(), /Artifact format & structure[\s\S]*Source material[\s\S]*Test plan[\s\S]*Scenarios[\s\S]*Expected result/);
    assert.match(await inlineSchema.innerText(), /type: object[\s\S]*format: markdown/i);
    const contractBox = await page.locator(".action-contracts").first().evaluate(node => node.getBoundingClientRect().toJSON());
    const schemaBox = await inlineSchema.evaluate(node => node.getBoundingClientRect().toJSON());
    assert.equal(Math.abs(schemaBox.left - contractBox.left) < 1, true);
    assert.equal(Math.abs(schemaBox.right - contractBox.right) < 1, true);
    assert.equal(await page.locator(".memory-flow-action").first().evaluate(node => getComputedStyle(node).fontSize), "13px");
    assert.equal(await inlineSchema.locator(".memory-schema-field-name").first().evaluate(node => getComputedStyle(node).fontSize), "13px");
    assert.equal(await inlineSchema.locator(".schema-field-type").first().evaluate(node => getComputedStyle(node).fontSize), "11px");
    assert.equal(await page.locator(".memory-block-title").first().evaluate(node => getComputedStyle(node).fontSize), "13px");
    assert.doesNotMatch(await page.locator(".memory-workspace").innerText(), /\[object Object\]|name:\s*markdown|options:\s*\{\}/);
  } finally {
    await browser.close();
    await close(server);
  }
});

async function buildMemoryBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../modules/org.memsphere.memory/adapter/view/index.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["@memsphere/view-sdk"],
    logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

async function browserModule(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
}

async function browserRuntimeBundle(): Promise<string> {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/view/view-runtime.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk", "./view-sdk.js"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}

function send(response: import("node:http").ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": `${contentType}; charset=utf-8` }); response.end(body);
}
function json(response: import("node:http").ServerResponse, body: unknown): void { send(response, 200, "application/json", JSON.stringify(body)); }
async function listen(server: Server): Promise<string> { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
