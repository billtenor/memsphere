import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
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
      { id: "change-related", status: "active", memoryPaths: ["statements/demo-memory.yaml"] },
      { id: "change-unrelated", status: "active", memoryPaths: ["statements/not-installed.yaml"] }
    ] });
    if (url.pathname === "/api/memories") return json(response, {
      memories: [{ id: "statements/demo-memory", kind: "statements", path: "statements/demo-memory.yaml", names: ["demo-memory"], system: false }]
    });
    if (url.pathname === "/api/memories/statements/demo-memory") return json(response, {
      memory: { id: "statements/demo-memory", kind: "statements", path: "statements/demo-memory.yaml", entity: { names: ["Demo Memory"], defines: ["Independent builtin detail"], sections: [{ names: ["nested", "Nested section"], asserts: ["Nested rule"] }] } }
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/memories/statements/demo-memory`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Memory", exact: true, level: 1 }).waitFor();
    assert.equal(await page.locator(".memory-statement-document > .memory-section-header").isVisible(), false, "the untitled document container has no redundant disclosure arrow");
    await page.locator("details.memory-list-block").filter({ hasText: "Defines" }).locator(":scope > summary").click();
    assert.match(await page.locator(".memory-workspace").innerText(), /Independent builtin detail/);
    const sectionsList = page.locator("details.memory-sections-block");
    assert.equal(await sectionsList.getAttribute("open"), null);
    assert.equal(await sectionsList.locator(":scope > summary .memory-list-count").innerText(), "1");
    assert.equal(await page.getByText("Nested section", { exact: true }).isVisible(), false);
    await sectionsList.locator(":scope > summary").click();
    assert.equal(await page.getByText("Nested section", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("!statement", { exact: true }).count(), 0);
    const disclosureToggle = page.getByRole("button", { name: "Expand all", exact: true });
    await disclosureToggle.click();
    assert.equal(await page.locator("details.memory-collapsible-list:not([open])").count(), 0);
    assert.equal(await page.locator(".memory-disclosure-root .memory-section:not(.open)").count(), 0);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    assert.equal(await page.locator("details.memory-collapsible-list[open]").count(), 0);
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
  const browser = await browserScope();
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
    for (const summary of await page.locator("details.memory-collapsible-list > summary").all()) await summary.click();
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
        baseMemory: { id: "procedures/delivery", kind: "procedures", path: "procedures/delivery.yaml", entity: { names: ["delivery", "Procedure delivery"], flow: [{ tag: "!action", action: "Deliver the result", actor: "agent", artifact: { name: "Old artifact", format: "markdown", review: ["Product"] } }] } },
        memory: { id: "procedures/delivery", kind: "procedures", path: "procedures/delivery.yaml", entity: { names: ["delivery", "Procedure delivery"], flow: [{ tag: "!action", action: "Deliver the result", actor: "human", artifact: { name: "New artifact", format: "markdown", review: ["Product"] } }] } }
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
  const browser = await browserScope();
  try {
    const page = await browser.newPage();
    let dialogCount = 0;
    page.on("dialog", dialog => { dialogCount += 1; void dialog.dismiss(); });
    await page.goto(`${origin}/projects/demo/changes/change-diff`, { waitUntil: "networkidle" });
    const collapsedDiffLists = page.locator("details.memory-collapsible-list");
    await collapsedDiffLists.first().locator(":scope > summary").waitFor();
    assert.equal(await collapsedDiffLists.evaluateAll(nodes => nodes.every(node => !(node as HTMLDetailsElement).open)), true);
    for (const summary of await collapsedDiffLists.locator(":scope > summary").all()) await summary.click();
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
    const diffColors = await inlineDiff.evaluate(node => {
      const probe = document.createElement("span");
      node.append(probe);
      probe.style.color = "var(--mem-view-color-danger)";
      const removed = getComputedStyle(probe).color;
      probe.style.color = "var(--mem-view-color-success)";
      const added = getComputedStyle(probe).color;
      probe.remove();
      return { removed, added };
    });
    assert.notEqual(await replacedDefinition.evaluate(node => getComputedStyle(node, "::marker").color), diffColors.removed);
    assert.notEqual(await replacedDefinition.evaluate(node => getComputedStyle(node, "::marker").color), diffColors.added);
    assert.equal(await page.locator("li.memory-inline-marker-old").first().evaluate(node => getComputedStyle(node, "::marker").color), diffColors.removed);
    assert.equal(await page.locator("li.memory-inline-marker-new").first().evaluate(node => getComputedStyle(node, "::marker").color), diffColors.added);
    const replacementLineBox = await page.locator(".memory-inline-new").filter({ hasText: "After definition" }).evaluate(node => node.getBoundingClientRect().toJSON());
    const additionLine = page.locator(".memory-inline-new").filter({ hasText: "Open the ChangeSet View" });
    assert.match(await additionLine.innerText(), /^Added\s+Open the ChangeSet View/);
    assert.doesNotMatch(await additionLine.innerText(), /^After\b/);
    const additionLineBox = await additionLine.evaluate(node => node.getBoundingClientRect().toJSON());
    assert.equal(Math.abs(replacementLineBox.left - additionLineBox.left) < 1, true);
    assert.equal(Math.abs(replacementLineBox.right - additionLineBox.right) < 1, true);
    assert.equal(await page.locator(".memory-inline-old, .memory-inline-new").filter({ hasText: "Last rule stays unchanged" }).count(), 0);
    const removedSuggestion = page.locator(".memory-inline-removed");
    assert.match(await removedSuggestion.innerText(), /Deleted[\s\S]*Remove stale copy/);
    assert.doesNotMatch(await removedSuggestion.innerText(), /Before\s+Remove stale copy/);
    await removedSuggestion.locator(".memory-inline-old").hover();
    const removedPlus = removedSuggestion.locator(".memory-inline-plus");
    assert.equal(await removedPlus.count(), 0, "baseline-only content cannot target a candidate Comment");
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
    assert.equal(collapsedMainWidth > 960, true);
    const collapsedGeometry = await page.locator(".memory-change-main").evaluate(node => {
      const main = node.getBoundingClientRect();
      const workspace = node.closest(".memory-change-workspace")!.getBoundingClientRect();
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
        leftGutter: main.left - workspace.left,
        rightGutter: workspace.right - main.right,
        mainCenterDelta: Math.abs((main.left + main.right) / 2 - (root.left + root.right) / 2),
        toolbarCenterDelta: Math.abs((groupLeft + groupRight) / 2 - (toolbar.left + toolbar.right) / 2),
        segmentTextDeltas,
        overflowsRoot: main.left < root.left || main.right > root.right,
        rootScrollLeft: document.querySelector<HTMLElement>("#memsphere-view-root")!.scrollLeft
      };
    });
    assert.equal(collapsedGeometry.mainCenterDelta < 14, true);
    assert.equal(collapsedGeometry.rightGutter > 0, true, "collapsed comments retain a right gutter");
    assert.equal(Math.abs(collapsedGeometry.leftGutter - collapsedGeometry.rightGutter) < 1, true, "collapsed content has symmetric gutters");
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
    assert.equal(await page.locator(".memory-change-main").evaluate(node => node.getBoundingClientRect().width) > 720, true);
    assert.equal(await page.locator(".memory-change-main").evaluate(node => node.getBoundingClientRect().width) < collapsedMainWidth, true);
    await page.locator("details.memory-collapsible-list").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
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
    assert.equal(await statementSection.locator(":scope > .memory-section-header").evaluate(node => getComputedStyle(node).display), "none");
    assert.equal(await statementSection.locator(":scope > .memory-inline-plus").evaluate(node => getComputedStyle(node).display), "none");
    await changedDefinition.hover();
    assert.equal(await changedCommentButton.evaluate(node => getComputedStyle(node).opacity), "1");
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
    await page.locator("details.memory-collapsible-list").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    assert.equal(await page.locator(".memory-inline-old").count(), 0);
    assert.match(await page.locator(".memory-change-layout").innerText(), /After definition/);
    const fullBodyTypography = await page.locator(".text-list > li").filter({ hasText: "After definition" }).evaluate(node => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    assert.deepEqual(fullBodyTypography, diffBodyTypography);
    await page.getByRole("button", { name: "Procedure delivery", exact: true }).click();
    await page.getByRole("radio", { name: "Diff", exact: true }).click();
    const actorDiff = page.locator('.memory-inline-new [data-anchor="procedure.flow[1].actor"]');
    assert.match(await actorDiff.textContent() ?? "", /Executor Human/);
    assert.equal(await page.locator('.memory-inline-old .memory-flow-actor').count(), 0);
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    assert.match(await page.locator('.memory-flow-actor').textContent() ?? "", /Executor Human/);
    await page.getByRole("radio", { name: "Diff", exact: true }).click();
    const artifactDiff = page.locator(".memory-inline-diff-pair").filter({ hasText: "Old artifact" });
    assert.equal(await artifactDiff.locator(".memory-artifact-row").count(), 2);
    assert.equal(await artifactDiff.locator(".memory-artifact-row").evaluateAll(rows => rows.every(row => /Artifact/.test(row.textContent ?? "") && /markdown/.test(row.textContent ?? "") && /Product/.test(row.textContent ?? ""))), true);
    await actorDiff.hover();
    await actorDiff.locator('.memory-inline-plus').click();
    const actorEditor = page.locator('.memory-inline-comment-editor');
    await actorEditor.locator('textarea').fill('Keep this step assigned to Human');
    await actorEditor.getByRole('button', { name: 'Submit comment', exact: true }).click();
    await actorEditor.waitFor({ state: 'detached' });
    assert.equal(submittedComments.at(-1)?.memoryReference, 'procedures/delivery');
    assert.equal((submittedComments.at(-1)?.location as Record<string, unknown>)?.anchor, 'procedure.flow[1].actor');
    const candidateArtifactRow = artifactDiff.locator(".memory-inline-new .memory-artifact-row");
    assert.equal(await candidateArtifactRow.locator(":scope > .memory-artifact-summary").count(), 1);
    assert.equal(await candidateArtifactRow.locator(":scope > .memory-review-summary").count(), 1);
    assert.equal(await candidateArtifactRow.locator(".memory-review-count").innerText(), "Reviewers: 1");
    assert.equal(await candidateArtifactRow.locator(".memory-review-details").textContent(), "Product");
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
    await page.locator("details.memory-collapsible-list").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    assert.equal(await page.locator(".memory-inline-old").count(), 0);
    assert.equal(await page.locator(".memory-inline-new").count() > 0, true);
    assert.match(await page.locator(".memory-change-main").innerText(), /Only candidate content/);
    assert.match(await page.locator(".memory-inline-new").first().innerText(), /^Added\b/);
    await page.getByRole("button", { name: /Deleted Memory/ }).click();
    await page.locator("details.memory-collapsible-list").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    assert.equal(await page.locator(".memory-inline-new").count(), 0);
    assert.equal(await page.locator(".memory-inline-old").count() > 0, true);
    assert.match(await page.locator(".memory-change-main").innerText(), /Only base content/);
    assert.match(await page.locator(".memory-inline-old").first().innerText(), /^Deleted\b/);
    const deletedLine = page.locator(".memory-inline-old").filter({ hasText: "Only base content" });
    await deletedLine.hover();
    const deletedPlus = deletedLine.locator(".memory-inline-plus");
    assert.equal(await deletedPlus.count(), 0, "a deleted Memory has no candidate comment target");
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    await page.locator("details.memory-collapsible-list").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
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
              tag: "!action", action: "Prepare input", actor: "agent",
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
            { tag: "!action", action: "Approve input", actor: "human" },
            { tag: "!if", condition: { tag: "!action", action: "Accept input", actor: "human", artifact: "acceptance" }, then: [] },
            { tag: "!while", condition: { tag: "!action", action: "Needs another pass", actor: "human", artifact: "decision", format: "plain" }, do: [] }
          ]
        }
      }
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/memories/procedures/demo-flow`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Flow", exact: true, level: 1 }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Expand all", exact: true }).count(), 1, "Procedure Memory exposes the shared disclosure control");
    const namesList = page.locator("details.memory-list-block").filter({ hasText: "Aliases" }).first();
    assert.equal(await namesList.getAttribute("open"), null);
    assert.equal(await namesList.locator(":scope > summary .memory-list-count").innerText(), "2");
    assert.equal(await namesList.locator(":scope > .memory-collapsible-body").isVisible(), false);
    await namesList.locator(":scope > summary").press("Enter");
    assert.equal(await namesList.getAttribute("open"), "");
    assert.equal(await namesList.locator(":scope > .memory-collapsible-body").isVisible(), true);
    await namesList.locator(":scope > summary").click();
    assert.equal(await namesList.getAttribute("open"), null);
    const rulesList = page.locator("details.action-contracts").first();
    assert.equal(await rulesList.getAttribute("open"), null);
    assert.equal(await rulesList.locator(":scope > summary .memory-block-title").innerText(), "Required rules");
    assert.equal(await rulesList.locator(":scope > summary .memory-list-count").innerText(), "1");
    assert.equal(await page.locator(".memory-flow-item").count(), 4);
    assert.match(await page.locator(".memory-flow").innerText(), /Prepare input/);
    assert.match(await page.locator(".memory-flow").innerText(), /Needs another pass/);
    assert.equal(await page.locator('.memory-flow-actor').count(), 3);
    for (const path of ['procedure.flow[2].actor', 'procedure.flow[3].condition.actor', 'procedure.flow[4].condition.actor']) {
      assert.equal(await page.locator(`[data-anchor="${path}"]`).textContent(), 'Executor Human');
    }
    assert.equal(await page.locator('.memory-flow-item').first().locator('.memory-flow-actor').count(), 0);
    const inlineSchema = page.locator('[data-anchor="procedure.flow[1].artifact.schema"]');
    assert.equal(await inlineSchema.count(), 1);
    assert.equal(await inlineSchema.evaluate(node => node.classList.contains("open")), false);
    assert.match(await inlineSchema.innerText(), /Artifact format & structure/);
    assert.doesNotMatch(await inlineSchema.innerText(), /Source material|Expected result/);
    await inlineSchema.locator(":scope > .memory-section-header").click();
    assert.equal(await inlineSchema.evaluate(node => node.classList.contains("open")), true);
    assert.match(await inlineSchema.innerText(), /Artifact format & structure[\s\S]*Source material[\s\S]*Test plan[\s\S]*Scenarios[\s\S]*Expected result/);
    assert.match(await inlineSchema.textContent() ?? "", /type: object[\s\S]*format: markdown/i);
    const contractBox = await page.locator(".action-contracts").first().evaluate(node => node.getBoundingClientRect().toJSON());
    const schemaBox = await inlineSchema.evaluate(node => node.getBoundingClientRect().toJSON());
    assert.equal(Math.abs(schemaBox.left - contractBox.left) < 1, true);
    assert.equal(await page.locator(".memory-flow-action").first().evaluate(node => getComputedStyle(node).fontSize), "13px");
    assert.equal(await inlineSchema.locator(".memory-schema-field-name").first().evaluate(node => getComputedStyle(node).fontSize), "13px");
    assert.equal(await inlineSchema.locator(".schema-field-type").first().evaluate(node => getComputedStyle(node).fontSize), "11px");
    assert.equal(await page.locator(".memory-block-title").first().evaluate(node => getComputedStyle(node).fontSize), "12px");
    assert.doesNotMatch(await page.locator(".memory-workspace").innerText(), /\[object Object\]|name:\s*markdown|options:\s*\{\}/);
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    assert.equal(await page.locator(".memory-disclosure-root details.memory-collapsible-list:not([open])").count(), 0);
    assert.equal(await page.locator(".memory-disclosure-root .memory-section:not(.open)").count(), 0);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    assert.equal(await page.locator(".memory-disclosure-root details.memory-collapsible-list[open]").count(), 0);
    assert.equal(await page.locator(".memory-disclosure-root .memory-section.open").count(), 0);
  } finally {
    await browser.close();
    await close(server);
  }
});

for (const locale of ["en", "zh-CN"] as const) {
  test(`Human executor visibility and anchors cover nested steps and both ChangeSet directions (${locale})`, async () => {
    const [bundle, sdk, runtime] = await Promise.all([
      buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
    ]);
    const instances: ViewHostBootInstance[] = [{
      pluginPath: memoryBundlePath, routeBasePath: "/",
      module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
    }];
    const action = (name: string, actor?: string) => ({
      tag: "!action", action: name, ...(actor ? { actor } : {}), artifact: { name: `${name} result`, review: ["Product"] }
    });
    const memory = {
      id: "procedures/executors", kind: "procedures", path: "procedures/executors.yaml",
      entity: { names: ["executors", "Executor Flow"], flow: [
        action("Human step", "human"), action("Agent step", "agent"), action("Default step"),
        { tag: "!if", condition: action("Human condition", "human"), then: [action("Nested human", "human"), action("Nested agent", "agent"), action("Nested default")] },
        { tag: "!while", condition: action("Human loop condition", "human"), do: [action("Human loop body", "human")] },
        action("New human", "human"), action("Former human", "agent"),
        { tag: "!call", target: "procedures/executors" }
      ] }
    };
    const baseMemory = structuredClone(memory);
    Object.assign(baseMemory.entity.flow[5]!, { actor: "agent" });
    Object.assign(baseMemory.entity.flow[6]!, { actor: "human" });
    const comments: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
      if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
      if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
      if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
      if (url.pathname === "/api/memories") return json(response, { memories: [memory] });
      if (url.pathname === "/api/memories/procedures/executors") return json(response, { memory });
      if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "change-executors", status: "active", memoryPaths: [memory.path] }] });
      if (url.pathname === "/api/changes/change-executors/comments" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const comment = JSON.parse(body) as Record<string, unknown>;
        comments.push(comment);
        return json(response, { comment: { id: `comment-${comments.length}`, ...comment } });
      }
      if (url.pathname === "/api/changes/change-executors") return json(response, {
        change: { id: "change-executors", status: "active", valid: true, memoryPaths: [memory.path] },
        targetMemories: [{ reference: memory.id, operation: "update", baseMemory, memory }], comments: []
      });
      return send(response, 200, "text/html", renderViewHostHtml(locale, instances));
    });
    const origin = await listen(server);
    const browser = await browserScope();
    try {
      const page = await browser.newPage();
      const label = locale === "en" ? "Executor Human" : "执行者 Human";
      const humanPaths = ["flow[1].actor", "flow[4].condition.actor", "flow[4].then[1].actor", "flow[5].condition.actor", "flow[5].do[1].actor", "flow[6].actor"];
      await page.goto(`${origin}/memories/procedures/executors`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Executor Flow", exact: true }).waitFor();
      assert.equal(await page.locator(".memory-flow-actor").count(), humanPaths.length);
      for (const path of humanPaths) assert.equal(await page.locator(`[data-anchor="procedure.${path}"]`).textContent(), label);
      for (const path of ["flow[2]", "flow[3]", "flow[4].then[2]", "flow[4].then[3]", "flow[7]", "flow[8]"]) {
        assert.equal(await page.locator(`[data-flow-node-path="procedure.${path}"] > .memory-flow-head .memory-flow-actor`).count(), 0);
      }
      await page.goto(`${origin}/projects/demo/changes/change-executors`, { waitUntil: "networkidle" });
      await page.locator(".memory-change-layout").getByRole("heading", { name: "Executor Flow", exact: true }).waitFor();
      assert.match(await page.locator('.memory-inline-new [data-anchor="procedure.flow[6].actor"]').textContent() ?? "", new RegExp(label));
      assert.match(await page.locator('.memory-inline-old [data-baseline-anchor="procedure.flow[7].actor"]').textContent() ?? "", new RegExp(label));
      assert.equal(await page.locator(".memory-artifact-row .memory-flow-actor").count(), 0, "actor changes stay outside the Artifact contract");
      await page.getByRole("radio", { name: locale === "en" ? "Full content" : "完整内容", exact: true }).click();
      assert.equal(await page.locator(".memory-flow-actor").count(), humanPaths.length);
      for (const path of humanPaths) {
        const actor = page.locator(`[data-anchor="procedure.${path}"]`);
        assert.match(await actor.textContent() ?? "", new RegExp(label));
        await actor.hover();
        await actor.locator(".memory-inline-plus").click();
        const editor = page.locator(".memory-inline-comment-editor");
        await editor.locator("textarea").fill(`Check ${path}`);
        await editor.getByRole("button", { name: locale === "en" ? "Submit comment" : "提交意见", exact: true }).click();
        await editor.waitFor({ state: "detached" });
        assert.equal(comments.at(-1)?.memoryReference, memory.id);
        assert.equal((comments.at(-1)?.location as Record<string, unknown>)?.anchor, `procedure.${path}`);
      }
    } finally {
      await browser.close();
      await close(server);
    }
  });
}

test("ChangeSet keeps replaced branches, deleted rules and new loops in their parent, with fluid desktop width", async () => {
  const [bundle, sdk, runtime] = await Promise.all([buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()]);
  const instances: ViewHostBootInstance[] = [{ pluginPath: memoryBundlePath, routeBasePath: "/", module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" } }];
  const action = (name: string) => ({ tag: "!action", action: name, artifact: { name: `${name} result`, format: "markdown" } });
  const base = { names: ["structure", "Structure"], asserts: ["Rule to remove", "Rule retained"], flow: [action("First unchanged"), { tag: "!if", condition: { ...action("Old human PR decision"), actor: "human" }, then: [action("Old PR branch")] }, { ...action("Tail unchanged"), artifact: { name: "Tail result", format: "markdown", final: true } }] };
  const candidate = { names: base.names, asserts: ["Rule retained"], flow: [action("Inserted before first"), action("First unchanged"), action("Submit PR directly"), { tag: "!while", condition: { ...action("New CI condition"), asserts: ["New condition constraint"] }, do: [action("New repair body")] }, { ...action("Tail unchanged"), artifact: { name: "Tail result", format: "markdown" } }] };
  const memory = { id: "procedures/structure", kind: "procedures", path: "procedures/structure.yaml", entity: candidate };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/memories") return json(response, { memories: [] });
    if (url.pathname === "/api/market/memories") return json(response, { count: 0, memories: [] });
    if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "change-structure", status: "active", memoryPaths: [memory.path] }] });
    if (url.pathname === "/api/changes/change-structure") return json(response, { change: { id: "change-structure", status: "active", valid: true, memoryPaths: [memory.path] }, targetMemories: [{ reference: memory.id, operation: "update", memory, baseMemory: { ...memory, entity: base } }], comments: [] });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server); const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    await page.goto(`${origin}/projects/demo/changes/change-structure`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    const oldBranch = page.locator('.memory-inline-old [data-flow-node-path="procedure.flow[2]"]');
    assert.match(await oldBranch.innerText(), /Old human PR decision[\s\S]*Old PR branch/);
    const flowText = await page.locator('.memory-flow[data-diff-path="procedure.flow"]').innerText();
    assert.equal(flowText.indexOf("Old human PR decision") < flowText.indexOf("Submit PR directly"), true, "the deleted branch stays in its old sequence slot before the replacement steps");
    assert.equal(await page.locator(".memory-inline-old .memory-inline-plus").count(), 0);
    assert.equal(await page.locator('.memory-inline-old [data-anchor]').count(), 0);
    assert.equal(await page.locator('.memory-inline-old, .memory-inline-new').filter({ hasText: 'First unchanged' }).count(), 0);
    const rules = page.locator('[data-diff-path="procedure.asserts"]');
    assert.match(await rules.innerText(), /Deleted[\s\S]*Rule to remove[\s\S]*Rule retained/);
    const loop = page.locator('.memory-inline-new [data-flow-node-path="procedure.flow[4]"]');
    assert.match(await loop.innerText(), /New CI condition[\s\S]*New condition constraint[\s\S]*New repair body/);
    assert.equal(await loop.locator('[data-anchor="procedure.flow[4].condition.action"]').count(), 1);
    const finalBefore = page.locator('.memory-inline-old .memory-artifact-details').filter({ hasText: "final" });
    assert.equal(await finalBefore.isVisible(), true);
    const main = page.locator(".memory-change-main"); const wide = await main.evaluate(n => n.getBoundingClientRect().width);
    assert.equal(wide > 960, true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    assert.equal(await main.evaluate(n => n.getBoundingClientRect().width) < wide, true);
    for (const width of [1280, 500]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await main.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true, `diff stays inside the body at ${width}px`);
    }
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    assert.equal(await page.locator(".memory-inline-old").count(), 0);
    await page.getByRole("radio", { name: "Diff", exact: true }).click();
    assert.equal(await oldBranch.count(), 1);
  } finally { await browser.close(); await close(server); }
});

test("ChangeSet comment saves preserve mixed disclosure choices", async () => {
  const fixture = await disclosureFixture();
  const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/changes/disclosure-change`, { waitUntil: "networkidle" });
    const defines = page.locator('details[data-diff-path="statement.defines"]');
    await defines.locator(":scope > summary").click();
    await defines.locator(".memory-inline-new").hover();
    await defines.locator(".memory-inline-new .memory-inline-plus").first().click();
    const editor = page.locator(".memory-inline-comment-editor");
    await editor.locator("textarea").fill("First located review comment");
    if (!(await defines.evaluate(node => (node as HTMLDetailsElement).open))) await defines.locator(":scope > summary").click();
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const firstSection = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    await firstSection.locator(":scope > .memory-section-header").click();
    const assertMixed = async () => {
      assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
      assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), true);
      assert.equal(await firstSection.evaluate(node => node.classList.contains("open")), false);
      assert.equal(await page.locator('details[data-diff-path="statement.asserts"]').evaluate(node => (node as HTMLDetailsElement).open), false);
    };
    const saved = page.waitForResponse(response => response.url().endsWith("/comments") && response.request().method() === "POST");
    await editor.getByRole("button", { name: "Submit comment", exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.locator(".memory-comments .memory-comment-body").getByText("First located review comment", { exact: true }).waitFor();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true, "saving a comment must retain the expanded definitions list");
    await assertMixed();
    await defines.locator(".memory-inline-new").hover();
    await defines.locator(".memory-inline-new .memory-inline-plus").click();
    await editor.locator("textarea").fill("Second located review comment");
    await editor.getByRole("button", { name: "Submit comment", exact: true }).click();
    await page.locator(".memory-comments").getByText("Second located review comment", { exact: true }).waitFor();
    assert.equal(fixture.comments.length, 2);
    await assertMixed();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
    const firstComment = page.locator(".memory-comments .memory-comment").filter({ hasText: "First located review comment" });
    await firstComment.getByRole("button", { name: "编辑", exact: true }).click();
    await firstComment.locator("textarea").fill("Edited located review comment");
    await firstComment.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".memory-comments").getByText("Edited located review comment", { exact: true }).waitFor();
    assert.equal(fixture.comments[0]?.body, "Edited located review comment");
    await defines.locator(".memory-inline-comments").getByText("Edited located review comment", { exact: true }).waitFor();
    await assertMixed();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
    await page.locator(".memory-comments .memory-comment").filter({ hasText: "Edited located review comment" }).getByRole("button", { name: "删除", exact: true }).click();
    await page.locator(".memory-comments").getByText("Edited located review comment", { exact: true }).waitFor({ state: "detached" });
    assert.equal(fixture.comments.length, 1);
    assert.equal(await page.locator(".memory-inline-comments").getByText("Edited located review comment", { exact: true }).count(), 0);
    assert.equal(await page.locator(".memory-comments").getByText("Second located review comment", { exact: true }).count(), 1);
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
    await assertMixed();
    await defines.locator(":scope > summary").click();
    await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Collapse comments", exact: true }).click();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), false, "inline comments must not reopen a deliberately collapsed source");
    await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Expand comments", exact: true }).click();
    assert.equal(await defines.locator(".memory-inline-comments").isVisible(), false);
    await defines.locator(":scope > summary").click();
    await assertMixed();
    const overall = await page.request.post(`${fixture.origin}/api/changes/disclosure-change/comments`, { data: { operator: fixture.comments[0]!.operator, memoryReference: fixture.memory.id, path: fixture.memory.path, body: "Overall review through the supported comment API" } });
    assert.equal(overall.status(), 200);
    await refreshDisclosureView(page, "Refresh ChangeSet");
    await page.getByText("Overall review through the supported comment API", { exact: true }).waitFor();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
    await assertMixed();
  } finally { await browser.close(); await close(fixture.server); }
});

test("ChangeSet disclosure modes, bulk choices and inserted sections remain isolated", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/changes/disclosure-change`, { waitUntil: "networkidle" });
    const defines = page.locator('details[data-diff-path="statement.defines"]');
    await defines.locator(":scope > summary").click();
    await page.getByRole("radio", { name: "Full content", exact: true }).click();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), false, "candidate mode starts with its own defaults");
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    const expandedComment = await page.request.post(`${fixture.origin}/api/changes/disclosure-change/comments`, { data: { operator: { kind: "browser", id: "bulk-reviewer" }, memoryReference: fixture.memory.id, path: fixture.memory.path, body: "Candidate comment after expanding all" } });
    assert.equal(expandedComment.status(), 200);
    await refreshDisclosureView(page, "Refresh ChangeSet");
    await page.getByText("Candidate comment after expanding all", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Collapse all", exact: true }).waitFor();
    assert.equal(await page.locator("details.memory-collapsible-list:not([open])").count(), 0);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    const overall = await page.request.post(`${fixture.origin}/api/changes/disclosure-change/comments`, { data: { operator: fixture.comments[0]!.operator, memoryReference: fixture.memory.id, path: fixture.memory.path, body: "Candidate overall comment after collapsing all" } });
    assert.equal(overall.status(), 200);
    await refreshDisclosureView(page, "Refresh ChangeSet");
    await page.getByText("Candidate overall comment after collapsing all", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Expand all", exact: true }).waitFor();
    assert.equal(await page.locator("details.memory-collapsible-list[open]").count(), 0);
    assert.equal(await page.locator(".memory-section .memory-section.open").count(), 0);
    await page.getByRole("radio", { name: "Diff", exact: true }).click();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true, "candidate collapse-all does not overwrite diff choices");
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const firstSection = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    await firstSection.locator(":scope > .memory-section-header").click();
    assert.equal(await firstSection.evaluate(node => node.classList.contains("open")), false);
    fixture.memory.entity.sections.unshift({ names: ["inserted", "Inserted section"], defines: ["New nested definition"] });
    const response = page.waitForResponse(response => response.url().endsWith("/api/changes/disclosure-change"));
    await refreshDisclosureView(page, "Refresh ChangeSet");
    await response;
    await page.locator('.memory-section[data-diff-path="statement.sections[1]"] .memory-node-title').getByText("Inserted section", { exact: true }).waitFor({ state: "attached" });
    assert.equal(await firstSection.evaluate(node => node.classList.contains("open")), true, "a new section must not inherit the removed positional key's collapsed state");
  } finally { await browser.close(); await close(fixture.server); }
});

test("Memory detail keeps choices across in-page refresh and isolates another Memory", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/memories/statements/disclosure`, { waitUntil: "networkidle" });
    const defines = page.locator('details[data-diff-path="statement.defines"]');
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await defines.locator(":scope > summary").click();
    await sections.locator(":scope > summary").click();
    const firstSection = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    await firstSection.locator(":scope > .memory-section-header").click();
    const refreshed = page.waitForResponse(response => response.url().includes("/api/memories/statements/disclosure?"));
    await refreshDisclosureView(page, "Refresh list");
    await refreshed;
    await page.getByRole("heading", { name: "Disclosure Memory", exact: true, level: 1 }).waitFor();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await firstSection.evaluate(node => node.classList.contains("open")), false);
    assert.equal(await page.locator('details[data-diff-path="statement.asserts"]').evaluate(node => (node as HTMLDetailsElement).open), false);
    await page.locator(".mem-view-list-item").filter({ hasText: "Other Memory" }).click();
    await page.getByRole("heading", { name: "Other Memory", exact: true, level: 1 }).waitFor();
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), false);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Memory does not give an inserted identical section the previous positional disclosure choices", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/memories/statements/disclosure`, { waitUntil: "networkidle" });
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const first = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    const firstDefines = first.locator('details[data-diff-path="statement.sections[1].defines"]');
    await firstDefines.locator(":scope > summary").click();
    await first.locator(":scope > .memory-section-header").click();
    fixture.memory.entity.sections.unshift(structuredClone(fixture.memory.entity.sections[0]!));
    await refreshDisclosureView(page, "Refresh list");
    assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), true, "the existing sections container stays expanded after insertion");
    assert.equal(await first.evaluate(node => node.classList.contains("open")), true, "the newly inserted identical section starts expanded by default");
    assert.equal(await firstDefines.evaluate(node => (node as HTMLDetailsElement).open), false, "the inserted section's list must not inherit the previous positional node's expansion");
    const second = page.locator('.memory-section[data-diff-path="statement.sections[2]"]');
    assert.equal(await second.evaluate(node => node.classList.contains("open")), true, "neither indistinguishable section borrows the previous collapsed choice after insertion");
    assert.equal(await second.locator('details[data-diff-path="statement.sections[2].defines"]').evaluate(node => (node as HTMLDetailsElement).open), false);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Memory keeps independent choices for identical sections when the document structure stays unchanged", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  fixture.memory.entity.sections[1] = structuredClone(fixture.memory.entity.sections[0]!);
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/memories/statements/disclosure`, { waitUntil: "networkidle" });
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const first = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    const second = page.locator('.memory-section[data-diff-path="statement.sections[2]"]');
    const firstDefines = first.locator('details[data-diff-path="statement.sections[1].defines"]');
    const secondDefines = second.locator('details[data-diff-path="statement.sections[2].defines"]');
    await firstDefines.locator(":scope > summary").click();
    await first.locator(":scope > .memory-section-header").click();
    await refreshDisclosureView(page, "Refresh list");
    assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await first.evaluate(node => node.classList.contains("open")), false);
    assert.equal(await second.evaluate(node => node.classList.contains("open")), true);
    assert.equal(await firstDefines.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await secondDefines.evaluate(node => (node as HTMLDetailsElement).open), false);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Memory distinguishes equal lists belonging to differently named sections across an unrelated structure change", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  fixture.memory.entity.sections[1]!.defines = [...fixture.memory.entity.sections[0]!.defines];
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/memories/statements/disclosure`, { waitUntil: "networkidle" });
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const firstDefines = page.locator('details[data-diff-path="statement.sections[1].defines"]');
    const secondDefines = page.locator('details[data-diff-path="statement.sections[2].defines"]');
    await firstDefines.locator(":scope > summary").click();
    fixture.memory.entity.asserts.push("An unrelated added root rule");
    await refreshDisclosureView(page, "Refresh list");
    assert.equal(await firstDefines.evaluate(node => (node as HTMLDetailsElement).open), true, "equal values under distinct semantic parents remain unambiguous");
    assert.equal(await secondDefines.evaluate(node => (node as HTMLDetailsElement).open), false);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Memory gives a renamed parent section's unchanged list its default disclosure state", async () => {
  const fixture = await disclosureFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/memories/statements/disclosure`, { waitUntil: "networkidle" });
    const sections = page.locator('details[data-diff-path="statement.sections"]');
    await sections.locator(":scope > summary").click();
    const first = page.locator('.memory-section[data-diff-path="statement.sections[1]"]');
    const defines = first.locator('details[data-diff-path="statement.sections[1].defines"]');
    await defines.locator(":scope > summary").click();
    fixture.memory.entity.sections[0]!.names = ["different-parent", "Different parent section"];
    await refreshDisclosureView(page, "Refresh list");
    assert.equal(await sections.evaluate(node => (node as HTMLDetailsElement).open), true, "the existing sections container stays expanded after parent replacement");
    await first.getByText("Different parent section", { exact: true }).waitFor();
    assert.equal(await first.evaluate(node => node.classList.contains("open")), true, "the new parent follows its default expansion");
    assert.equal(await defines.evaluate(node => (node as HTMLDetailsElement).open), false, "an unchanged list under a new parent must not inherit the previous parent's reading choice");
  } finally { await browser.close(); await close(fixture.server); }
});

for (const surface of ["Memory", "Diff", "Full content"] as const) {
  test(`${surface} stable semantic identity preserves a moved section and its child choices`, async () => {
    const fixture = await disclosureFixture(true); const browser = await browserScope();
    try {
      const page = await browser.newPage();
      const view = await openStableDisclosureScenario(page, fixture, surface);
      fixture.memory.entity.sections.unshift({ names: ["inserted", "Inserted section"], defines: ["New definition"] });
      await refreshDisclosureView(page, surface === "Memory" ? "Refresh list" : "Refresh ChangeSet");
      await view.assertBaseline();
      const inserted = page.locator('.memory-section[data-anchor="statement.sections[1]"]');
      const moved = page.locator('.memory-section[data-anchor="statement.sections[2]"]');
      assert.deepEqual({
        sectionsOpen: await view.sections.evaluate(node => (node as HTMLDetailsElement).open),
        insertedOpen: await inserted.evaluate(node => node.classList.contains("open")),
        insertedListOpen: await inserted.locator('details[data-diff-path="statement.sections[1].defines"]').evaluate(node => (node as HTMLDetailsElement).open),
        movedOpen: await moved.evaluate(node => node.classList.contains("open")),
        movedListOpen: await moved.locator('details[data-diff-path="statement.sections[2].defines"]').evaluate(node => (node as HTMLDetailsElement).open),
      }, { sectionsOpen: true, insertedOpen: true, insertedListOpen: false, movedOpen: false, movedListOpen: true }, "unique named nodes retain choices after moving while new nodes use defaults");
    } finally { await browser.close(); await close(fixture.server); }
  });

  test(`${surface} stable semantic identity preserves a named parent when its contents grow and shrink`, async () => {
    const fixture = await disclosureFixture(true); const browser = await browserScope();
    try {
      const page = await browser.newPage();
      const view = await openStableDisclosureScenario(page, fixture, surface);
      for (const operation of ["add", "remove"] as const) {
        if (operation === "add") fixture.memory.entity.sections[0]!.defines.push("Additional child content");
        else fixture.memory.entity.sections[0]!.defines.pop();
        await refreshDisclosureView(page, surface === "Memory" ? "Refresh list" : "Refresh ChangeSet");
        await view.assertBaseline();
        assert.deepEqual({
          sectionsOpen: await view.sections.evaluate(node => (node as HTMLDetailsElement).open),
          parentOpen: await view.first.evaluate(node => node.classList.contains("open")),
          listOpen: await view.firstDefines.evaluate(node => (node as HTMLDetailsElement).open),
        }, { sectionsOpen: true, parentOpen: false, listOpen: true }, `${operation} child content keeps the stable parent and list reading choices`);
      }
    } finally { await browser.close(); await close(fixture.server); }
  });
}

async function openStableDisclosureScenario(
  page: import("playwright").Page,
  fixture: Awaited<ReturnType<typeof disclosureFixture>>,
  surface: "Memory" | "Diff" | "Full content"
) {
  await page.goto(`${fixture.origin}/projects/demo/${surface === "Memory" ? "memories/statements/disclosure" : "changes/disclosure-change"}`, { waitUntil: "networkidle" });
  if (surface === "Full content") await page.getByRole("radio", { name: "Full content", exact: true }).click();
  const sections = page.locator('details[data-diff-path="statement.sections"]').filter({ has: page.locator('.memory-section[data-anchor="statement.sections[1]"]') });
  await sections.locator(":scope > summary").click();
  const first = page.locator('.memory-section[data-anchor="statement.sections[1]"]');
  const firstDefines = first.locator('details[data-diff-path="statement.sections[1].defines"]');
  await firstDefines.locator(":scope > summary").click();
  await first.locator(":scope > .memory-section-header").click();
  const baseline = page.locator('.memory-section[data-baseline-anchor="statement.sections[3]"]');
  if (surface === "Diff") {
    await baseline.locator('details[data-diff-path="statement.sections[3].defines"] > summary').click();
    await baseline.locator(":scope > .memory-section-header").click();
  }
  const assertBaseline = async () => {
    if (surface !== "Diff") return;
    assert.deepEqual({
      open: await baseline.evaluate(node => node.classList.contains("open")),
      listOpen: await baseline.locator('details[data-diff-path="statement.sections[3].defines"]').evaluate(node => (node as HTMLDetailsElement).open),
    }, { open: false, listOpen: true }, "candidate changes do not reset the frozen baseline's reading choices");
  };
  return { sections, first, firstDefines, assertBaseline };
}

async function refreshDisclosureView(page: import("playwright").Page, label: string): Promise<void> {
  const previous = await page.locator(".memory-detail-module").elementHandle();
  assert(previous);
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForFunction(node => !node.isConnected, previous);
  await page.locator(".memory-detail-module").waitFor();
}

async function disclosureFixture(freezeBaseline = false) {
  const [bundle, sdk, runtime] = await Promise.all([buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()]);
  const instances: ViewHostBootInstance[] = [{ pluginPath: memoryBundlePath, routeBasePath: "/", module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" } }];
  const entity = { names: ["disclosure", "Disclosure Memory"], defines: ["A definition to review"], asserts: ["A rule to keep closed"], sections: [{ names: ["first", "First section"], defines: ["First nested definition"] }, { names: ["second", "Second section"], defines: ["Second nested definition"] }] };
  const memory = { id: "statements/disclosure", kind: "statements", path: "statements/disclosure.yaml", names: entity.names, entity };
  const baseEntity = structuredClone(entity);
  baseEntity.defines = ["Previous definition"];
  if (freezeBaseline) baseEntity.sections.push({ names: ["baseline-only", "Baseline-only section"], defines: ["Frozen baseline definition"] });
  const other = { ...memory, id: "statements/other", path: "statements/other.yaml", names: ["other", "Other Memory"], entity: { ...entity, names: ["other", "Other Memory"] } };
  const comments: Record<string, unknown>[] = [];
  let commentSequence = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/market/memories") return json(response, { memories: [] });
    if (url.pathname === "/api/memories") return json(response, { memories: [memory, other] });
    if (url.pathname === "/api/memories/statements/disclosure") return json(response, { memory });
    if (url.pathname === "/api/memories/statements/other") return json(response, { memory: other });
    if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "disclosure-change", status: "active", memoryPaths: [memory.path] }] });
    if (url.pathname === "/api/changes/disclosure-change/comments" && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw) as Record<string, unknown>;
      const comment = { ...input, id: `comment-${++commentSequence}`, status: "pending" };
      comments.push(comment); return json(response, { comment });
    }
    if (url.pathname.startsWith("/api/changes/disclosure-change/comments/")) {
      const index = comments.findIndex(comment => comment.id === url.pathname.split("/").at(-1));
      if (request.method === "DELETE") { comments.splice(index, 1); return json(response, { deleted: true }); }
      if (request.method === "PATCH") { let raw = ""; for await (const chunk of request) raw += chunk; Object.assign(comments[index]!, JSON.parse(raw)); return json(response, { comment: comments[index] }); }
    }
    if (url.pathname === "/api/changes/disclosure-change") return json(response, { change: { id: "disclosure-change", status: "active", valid: true, memoryPaths: [memory.path] }, targetMemories: [{ reference: memory.id, operation: "update", baseMemory: { ...memory, entity: freezeBaseline ? baseEntity : { ...entity, defines: ["Previous definition"] } }, memory }], comments });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  return { origin, server, comments, memory };
}

test("Created schema diff keeps its block geometry while hovering Added and its section comment button", async () => {
  const fixture = await createdSchemaFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${fixture.origin}/projects/demo/changes/change-created`, { waitUntil: "networkidle" });
    const root = page.locator('.memory-inline-diff-content > [data-anchor="schema"]');
    await root.waitFor();
    const before = await root.boundingBox();
    await page.locator(".memory-inline-diff-label").hover();
    assert.equal(await root.evaluate(n => getComputedStyle(n).display), "block");
    assert.deepEqual(await root.boundingBox(), before, "hovering Added must not reflow the document");
    assert.equal(await root.evaluate(n => n.getBoundingClientRect().width >= n.parentElement!.clientWidth - 1), true);
    const section = page.locator('[data-anchor="schema.fields[1]"]');
    await section.locator(":scope > .memory-section-header").hover();
    await section.locator(":scope > .memory-inline-plus").click();
    const editor = section.locator(":scope > .memory-section-body > .memory-inline-comment-editor");
    await editor.locator("textarea").fill("Review this schema field");
    assert.equal(await editor.getByRole("button", { name: "Submit comment", exact: true }).isEnabled(), true);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.setViewportSize({ width: 500, height: 1000 });
    assert.equal(await page.locator(".memory-change-main").evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Saved section comments follow the section disclosure without hiding the sidebar record", async () => {
  const fixture = await createdSchemaFixture(); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/changes/change-created`, { waitUntil: "networkidle" });
    const section = page.locator('[data-anchor="schema.fields[1]"]');
    const header = section.locator(":scope > .memory-section-header");
    await header.click();
    assert.equal(await section.evaluate(n => n.classList.contains("open")), false);
    await header.hover();
    await section.locator(":scope > .memory-inline-plus").click();
    const editor = section.locator(":scope > .memory-section-body > .memory-inline-comment-editor");
    await editor.locator("textarea").fill("Section discussion");
    await editor.getByRole("button", { name: "Submit comment", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    const inline = section.locator(":scope > .memory-section-body > .memory-inline-comments");
    await inline.getByText("Section discussion", { exact: true }).waitFor();
    await header.click();
    assert.equal(await inline.isVisible(), false, "collapsing the section hides its own comments");
    assert.equal(await page.locator(".memory-comments").getByText("Section discussion", { exact: true }).isVisible(), true);
    await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Collapse comments", exact: true }).click();
    await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Expand comments", exact: true }).click();
    assert.equal(await section.evaluate(n => n.classList.contains("open")), false);
    assert.equal(await inline.isVisible(), false, "rerendering must not reopen saved comments");
    await header.click();
    assert.equal(await inline.getByText("Section discussion", { exact: true }).isVisible(), true);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Saved comments render at their own Memory and source row in both ChangeSet modes", async () => {
  const fixture = await createdSchemaFixture(); const browser = await browserScope();
  fixture.comments.push(
    { id: "legacy", status: "pending", memory_reference: fixture.memory.id, target: "schema.names[2]", body: "Existing alias comment" },
    { id: "foreign", status: "pending", memory_reference: "schemas/other", location: { anchor: "schema.names[2]" }, body: "Other Memory comment" },
    { id: "missing", status: "pending", memory_reference: fixture.memory.id, target: "schema.missing", body: "Missing source comment" }
  );
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}/projects/demo/changes/change-created`, { waitUntil: "networkidle" });
    for (const mode of ["Diff", "Full content"]) {
      await page.getByRole("radio", { name: mode, exact: true }).click();
      const names = page.locator('details[data-diff-path="schema.names"]');
      if (!(await names.evaluate(n => (n as HTMLDetailsElement).open))) await names.locator(":scope > summary").click();
      const row = page.locator('[data-anchor="schema.names[2]"]').locator('..');
      await row.locator('.memory-commentable').first().hover();
      await row.locator('.memory-inline-plus').click();
      const editor = page.locator(".memory-inline-comment-editor");
      const body = `${mode} alias comment`;
      await editor.locator("textarea").fill(body);
      await editor.getByRole("button", { name: "Submit comment", exact: true }).click();
      await editor.waitFor({ state: "detached" });
      await row.locator('.memory-inline-comments').getByText(body, { exact: true }).waitFor();
      assert.equal(await row.locator('.memory-inline-comments').getByText("Existing alias comment", { exact: true }).isVisible(), true);
      assert.equal(await page.locator('.memory-inline-comments').getByText("Other Memory comment", { exact: true }).count(), 0);
      assert.equal(await page.locator('.memory-inline-comments').getByText("Missing source comment", { exact: true }).count(), 0);
      await page.locator('.memory-comments').getByText("Missing source comment", { exact: true }).waitFor();
      assert.equal(fixture.comments.at(-1)?.memoryReference, fixture.memory.id);
      assert.equal((fixture.comments.at(-1)?.location as Record<string, unknown>).anchor, "schema.names[2]");
      await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Collapse comments", exact: true }).click();
      assert.equal(await row.locator('.memory-inline-comments').isVisible(), true);
      await page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: "Expand comments", exact: true }).click();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("radio", { name: mode, exact: true }).click();
      if (!(await names.evaluate(n => (n as HTMLDetailsElement).open))) await names.locator(":scope > summary").click();
      await row.locator('.memory-inline-comments').getByText(body, { exact: true }).waitFor();
    }
    await page.locator('.mem-view-list-item').filter({ hasText: 'Other schema' }).click();
    const names = page.locator('details[data-diff-path="schema.names"]');
    if (!(await names.evaluate(n => (n as HTMLDetailsElement).open))) await names.locator(":scope > summary").click();
    await page.locator('.memory-inline-comments').getByText("Other Memory comment", { exact: true }).waitFor();
    assert.equal(await page.locator('.memory-inline-comments').getByText("Existing alias comment", { exact: true }).count(), 0);
  } finally { await browser.close(); await close(fixture.server); }
});

test("Terminal or claimed ChangeSets expose saved comments without comment mutation controls", async () => {
  const fixture = await createdSchemaFixture(); const browser = await browserScope();
  fixture.comments.push({ id: "saved", status: "pending", memory_reference: fixture.memory.id, location: { anchor: "schema.names[2]" }, body: "Saved before completion" });
  try {
    const page = await browser.newPage();
    for (const state of [{ status: "completed", claimed: false }, { status: "abandoned", claimed: false }, { status: "active", claimed: true }]) {
      Object.assign(fixture.change, state);
      await page.goto(`${fixture.origin}/projects/demo/changes/change-created`, { waitUntil: "networkidle" });
      for (const mode of ["Diff", "Full content"]) {
        await page.getByRole("radio", { name: mode, exact: true }).click();
        await page.locator('.memory-comments').getByText('Saved before completion', { exact: true }).waitFor();
        assert.equal(await page.locator('.memory-inline-plus').count(), 0);
        assert.equal(await page.locator('.memory-comment-actions').count(), 0);
        assert.equal(await page.locator('.memory-inline-comment-editor').count(), 0);
        const names = page.locator('details[data-diff-path="schema.names"]');
        if (!(await names.evaluate(n => (n as HTMLDetailsElement).open))) await names.locator(":scope > summary").click();
        assert.equal(await page.locator('.memory-inline-comments').getByText('Saved before completion', { exact: true }).isVisible(), true);
      }
    }
  } finally { await browser.close(); await close(fixture.server); }
});

async function createdSchemaFixture() {
  const [bundle, sdk, runtime] = await Promise.all([buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()]);
  const instances: ViewHostBootInstance[] = [{ pluginPath: memoryBundlePath, routeBasePath: "/", module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" } }];
  const memory = { id: "schemas/created", kind: "schemas", path: "schemas/created.yaml", entity: {
    names: ["created", "Created schema"], defines: ["Schema definition"], type: "object",
    fields: [{ names: ["information", "Information"], type: "object", fields: ["Impact"] }]
  } };
  const other = { ...memory, id: "schemas/other", path: "schemas/other.yaml", entity: { ...memory.entity, names: ["other", "Other schema"] } };
  const change = { id: "change-created", status: "active", claimed: false, valid: true, memoryPaths: [memory.path, other.path] };
  const comments: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/memories") return json(response, { memories: [] });
    if (url.pathname === "/api/market/memories") return json(response, { count: 0, memories: [] });
    if (url.pathname === "/api/changes") return json(response, { changes: [change] });
    if (url.pathname === "/api/changes/change-created/comments" && request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk;
      const comment = { id: `comment-${comments.length}`, status: "pending", ...JSON.parse(body) };
      comments.push(comment); return json(response, { comment });
    }
    if (url.pathname === "/api/changes/change-created") return json(response, {
      change, targetMemories: [memory, other].map(memory => ({ reference: memory.id, operation: "create", memory })), comments
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  return { origin: await listen(server), server, memory, change, comments };
}

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

test('graph Memory details open model-backed nodes from the keyboard-accessible canvas without a permanent sidebar',async()=>{
 const [bundle,sdk,runtime]=await Promise.all([buildMemoryBundle(),browserModule('../src/view/view-sdk.ts'),browserRuntimeBundle()]);
 const engine=await build({entryPoints:[fileURLToPath(new URL('../modules/shared/view/graph-layout.ts',import.meta.url))],bundle:true,format:'esm',write:false});
 const instance:ViewHostBootInstance={pluginPath:memoryBundlePath,routeBasePath:'/',module:{projectId:'demo',moduleId:'org.memsphere.memory',moduleVersion:'0.1.5',instanceId:'memory'}};
 const graph={names:['graph-memory'],defines:['Graph fixture'],mode:'graph',actions:[{id:'prepare',description:'原始工作说明',actor:'agent',asserts:['规则正文',{tag:'!ref',target:'statements/graph-rules'}],effectiveRules:{asserts:[{reference:'statements/graph-rules',asserts:['已解析的冻结要求']}]},dependencies:[{from:'START'}],artifact:{name:'原始产物',asserts:['产物层必须满足'],suggests:['产物层建议满足'],review:['测试工程师'],model:{definedBy:'json-schema/draft-07.json',definition:'{"type":"string"}'},payload:{contentType:'text/plain'}}}]};
 const server=createServer((request,response)=>{const url=new URL(request.url??'/','http://local');if(url.pathname===memoryBundlePath)return send(response,200,'text/javascript',bundle);if(url.pathname===viewSdkBundlePath)return send(response,200,'text/javascript',sdk);if(url.pathname===viewRuntimeBundlePath)return send(response,200,'text/javascript',runtime);if(url.pathname==='/api/projects')return json(response,{current:'demo',projects:[{name:'demo'}]});if(url.pathname==='/api/changes')return json(response,{changes:[]});if(url.pathname==='/api/changes/graph-change')return json(response,{change:{id:'graph-change',status:'active',valid:true},targetMemories:[{reference:'procedures/graph-memory',operation:'create',memory:{id:'procedures/graph-memory',kind:'procedures',entity:graph}}],comments:[]});if(url.pathname==='/api/memories')return json(response,{memories:[{id:'procedures/graph-memory',kind:'procedures',names:['graph-memory']},{id:'statements/graph-rules',kind:'statements',names:['graph-rules']}]});if(url.pathname==='/api/memories/statements/graph-rules')return json(response,{memory:{id:'statements/graph-rules',kind:'statements',entity:{names:['graph-rules'],defines:['规则来源正文'],asserts:['已解析的冻结要求']}}});if(url.pathname==='/api/memories/procedures/graph-memory')return json(response,{memory:{id:'procedures/graph-memory',kind:'procedures',entity:graph}});if(url.pathname==='/assets/procedure-graph-layout.js')return send(response,200,'text/javascript',engine.outputFiles[0].text);return send(response,200,'text/html',renderViewHostHtml('zh-CN',[instance]));});
 const origin=await listen(server),browser=await browserScope();
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(`${origin}/memories/procedures/graph-memory`);await page.locator('.pg').waitFor();const node=page.locator('.pg-node[data-action-id=prepare]');await node.focus();await page.keyboard.press('Enter');await page.locator('.pg-dialog').waitFor();assert.ok((await page.locator('.pg-dialog').innerText()).includes('原始产物'));assert.ok((await page.locator('.pg-dialog').innerText()).includes('产物层必须满足'));assert.ok((await page.locator('.pg-dialog').innerText()).includes('产物层建议满足'));await page.locator('.pg-dialog .rule-reference-toggle').click();await page.locator('.pg-dialog .effective-rule-inline').getByText('已解析的冻结要求',{exact:true}).waitFor();assert.equal(await page.locator('.pg-dialog').getByText('{\"tag\":\"!ref\"', {exact:true}).count(),0);assert.equal(await page.locator('.pg > aside').count(),0);await page.keyboard.press('Escape');assert.equal(await node.evaluate(e=>e===document.activeElement),true);await node.click();await page.locator('.pg-dialog .memory-ref-link').click();await page.waitForURL(/statements\/graph-rules/);await page.getByText('规则来源正文',{exact:true}).waitFor({state:'attached'});await page.goto(`${origin}/projects/demo/changes/graph-change`);await page.getByRole('radio',{name:'完整内容',exact:true}).click();await page.locator('.pg-node[data-action-id=prepare]').waitFor();assert.equal(await page.locator('.pg-node').count(),1);await page.locator('.pg-node').click();assert.equal(await page.locator('.pg-dialog .rule-reference-toggle').count(),1);assert.ok((await page.locator('.pg-dialog').innerText()).includes('产物层必须满足'));await page.keyboard.press('Escape');await page.getByRole('radio',{name:'差异',exact:true}).click();assert.equal(await page.locator('.pg').count(),0);assert.ok((await page.locator('.memory-graph-artifacts').innerText()).includes('产物列表'));assert.equal(await page.locator('.memory-node-title').filter({hasText:'原始产物'}).count(),1);await page.locator('.memory-artifact-diff-card .memory-section-header').click();assert.equal(await page.locator('.memory-artifact-model-structure [data-mem-model-definition=structure]').count(),1);assert.equal(await page.locator('.memory-artifact-info-group details').count(),0);assert.ok((await page.locator('.memory-artifact-diff-card').innerText()).includes('开始'));assert.ok((await page.locator('.memory-artifact-rule-list').first().innerText()).includes('规则正文'));const value=page.locator('.memory-artifact-diff-card .memory-kv dd>.memory-commentable').first();await value.hover();const commentGap=await value.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.firstChild!);return el.querySelector('button')!.getBoundingClientRect().left-range.getBoundingClientRect().right;});assert.ok(commentGap>=0&&commentGap<=8);const iconOffset=await value.locator('button').evaluate(button=>{const b=button.getBoundingClientRect(),icon=button.querySelector('svg')!.getBoundingClientRect();return {x:Math.abs((b.left+b.right-icon.left-icon.right)/2),y:Math.abs((b.top+b.bottom-icon.top-icon.bottom)/2)};});assert.ok(iconOffset.x<1&&iconOffset.y<1);}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
