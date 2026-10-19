import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import { renderViewHostHtml, viewRuntimeBundlePath, viewSdkBundlePath, type ViewHostBootInstance } from "../src/view/host.js";

const bundlePath = "/assets/modules/org.memsphere.run/index.js";

test("Run builtin renders a deep-linked Run and opens its Artifact Review", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildRunBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
  ]);
  const catalog = builtinModuleCatalog.find(entry => entry.moduleId === "org.memsphere.run")!;
  const instances: ViewHostBootInstance[] = [{
    pluginPath: bundlePath, routeGrants: catalog.routes,
    module: { projectId: "demo", moduleId: catalog.moduleId, moduleVersion: "0.1.2", instanceId: catalog.instanceId }
  }];
  const run = {
    id: "run-demo", name: "Demo Run", procedureName: "demo-procedure", status: "running", readOnly: true,
    updatedAt: "2026-08-30T00:00:00.000Z",
    stack: [{ type: "procedure", index: 0, steps: [{ id: "step-1", instruction: "Inspect the result", artifact: "report" }] }],
    assertTree: { entries: [{ kind: "reference", target: "statements/run-rules", entries: [{ kind: "rule", text: "Keep evidence." }] }], sections: [] },
    plan: [{
      id: "step-1", kind: "branch", instruction: "Inspect the result", artifact: { name: "report", type: "object", format: { name: "markdown", options: { layout: "outline" } }, final: true, review: "artifact_acceptance.unanimous" },
      branches: {
        truthy: [{ id: "step-child", kind: "action", instruction: "Follow the accepted branch", artifact: "child result" }],
        falsy: [{ id: "step-fallback", kind: "call", target: "fallback-procedure" }]
      }
    }, { id: "step-loop", kind: "loop", instruction: "Repeat checks", artifact: "condition", loop: { body: [] } }],
    events: [{ stepId: "step-1", frame: "procedure", at: "2026-08-30T00:00:00.000Z", artifact: { name: "report", type: "object", format: { name: "markdown" }, final: true, renderedContent: "<p>Rendered report</p>" } }],
    schemaWriting: { parentStepId: "step-1", progress: { completed: 1, total: 2, remaining: 1 }, currentField: { path: "report.summary", sources: [] }, draft: { status: "awaiting_finalization", filePath: "/tmp/report.md", validation: { status: "passed" }, renderedContent: "<p>Managed draft</p>" } },
    reviewConfiguration: { slots: { "demo-procedure::reviewer": { actorIds: ["human"] } } },
    controlPlane: { actors: { human: { kind: "human", name: "Human" } } },
    artifactReview: { id: "review-1", currentRoundId: "round-1", round: { id: "round-1", submitted: 0, total: 1, assignments: [] } }
  };
  let runDetailRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === bundlePath) return send(response, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
    if (url.pathname === "/api/runs") return json(response, { runs: [{ ...run, eventCount: 0 }, { ...run, id: "run-other", name: "Other Run", eventCount: 0 }] });
    if (url.pathname === "/api/runs/run-other") return json(response, { run: { ...run, id: "run-other", name: "Other Run" } });
    if (url.pathname === "/api/runs/run-demo") { runDetailRequests += 1; return json(response, { run }); }
    if (url.pathname === "/api/runs/run-demo/artifact-reviews/review-1/rounds/round-1") {
      const assignment = {
        actorId: "human", actorName: "Human", actorKind: "human", binding: "decision", status: "submitted", draft: { comments: [] },
        submitted: { comments: [], vote: "approve", submittedAt: "2026-08-30T01:00:00.000Z", delegation: { kind: "runner", runId: "run-demo", humanActorId: "human", authorizationNote: "Human explicitly authorized this submission." } }
      };
      return json(response, {
        review: { id: "review-1", currentRoundId: "round-1", status: "awaiting_runner_vote", round: { id: "round-1", revision: 2, status: "awaiting_runner_vote", assignments: [assignment] } },
        rounds: [{ id: "round-1", sequence: 1, revision: 2, status: "awaiting_runner_vote", assignments: [assignment] }],
        submission: { id: "submission-1", artifact: { name: "report", value: "Review this artifact" } }, assignment
      });
    }
    return send(response, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server); const browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/tasks/run-demo`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Run", level: 1 }).waitFor();
    assert.match(await page.locator(".run-workspace").innerText(), /Inspect the result/);
    assert.equal(await page.locator(".run-procedure-asserts .mem-content-disclosure-title").innerText(), "Required rules");
    assert.equal(await page.locator("details.run-collapsible[open]").count(), 0, "Run fields are collapsed by default");
    const standaloneArtifact = page.locator("details.run-artifact").first();
    assert.equal(await standaloneArtifact.getAttribute("open"), null, "Run artifacts are collapsed by default");
    assert.equal(await standaloneArtifact.locator(".artifact-review-artifact-content").isVisible(), false);
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    assert.equal(await page.locator("details.run-collapsible:not([open])").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Collapse all", exact: true }).count(), 1);
    assert.equal(await page.locator(".mem-view-list-item.active").count(), 1);
    assert.equal(await page.locator(".mem-view-list-item-row:has(.mem-view-list-item.active) .mem-view-list-item-actions").count(), 0);
    assert.equal(await page.locator(".flow-item.branch").count(), 2);
    assert.equal(await page.locator(".flow-item.call").count(), 1);
    assert.equal(await page.locator('[data-current-task-step="true"]').getAttribute("data-step-id"), "step-1");
    assert.equal(await page.locator('[aria-current="step"]').count(), 1);
    assert.equal(await page.locator('.run-current-step-marker').innerText(), "Current step");
    assert.equal(await page.locator('[aria-current="step"] > .mem-content-flow-head > .mem-content-flow-label').count(), 1);
    assert.equal(await page.locator('.run-current-step-marker').getAttribute("class").then(value => value?.includes("mem-content-flow-label")), true);
    assert.match(await page.locator(".schema-writing").innerText(), /Managed draft/);
    assert.match(await page.locator(".run-procedure-asserts").innerText(), /run-rules/);
    const reviewers = page.locator(".mem-content-review-summary");
    assert.equal(await reviewers.count(), 1);
    assert.equal(await reviewers.locator(".mem-content-review-count").innerText(), "Reviewer: 1");
    assert.equal(await reviewers.locator(".mem-content-review-details").textContent(), "artifact_acceptance.unanimous");
    assert.equal(await page.locator("details.run-step").count(), 0, "Run steps use the same non-collapsible flow-node skeleton as Memory");
    await page.locator(".run-bindings .mem-view-disclosure > button").click();
    assert.match(await page.locator(".run-binding-body").innerText(), /Human/);
    assert.match(await page.locator(".task-result").first().innerText(), /Rendered report/);
    assert.equal(await page.locator(".run-step > .task-result > summary h3").first().innerText(), "Output");
    assert.equal(await page.locator(".task-result > summary .artifact-meta-line").count(), 0);
    assert.match(await page.locator(".task-result > .run-disclosure-body > .artifact-meta-line").first().innerText(), /Time:/);
    assert.doesNotMatch(await page.locator(".task-result > .run-disclosure-body > .artifact-meta-line").first().innerText(), /procedure|object|markdown|Final/);
    run.readOnly = false;
    // Preserve a mixture of native details and custom effective-rule controls.
    const closedArtifact = page.locator("details.run-artifact").first();
    await closedArtifact.locator(":scope > summary").click();
    const rule = page.locator(".effective-reference > .section-header").first();
    await rule.click();
    const detailBeforeRefresh = await page.locator(".run-detail-content").elementHandle();
    run.updatedAt = "2026-08-30T02:00:00.000Z";
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.waitForFunction(old => !old?.isConnected, detailBeforeRefresh);
    await page.locator(".run-detail-content").waitFor();
    assert.equal(await page.locator("details.run-artifact").first().getAttribute("open"), null);
    assert.equal(await page.locator("details.schema-writing[open], .schema-writing details[open]").count() > 0, true, "expanded Schema draft survives refresh");
    assert.equal(await rule.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("details.run-collapsible[open]").count() > 0, true);

    await page.locator(".schema-draft-preview > summary").click();
    assert.equal(await page.locator(".schema-draft-preview").getAttribute("open"), null);

    // New content at the previous rule position must use its default state.
    run.assertTree.entries.unshift({ kind: "reference", target: "statements/new-rules", entries: [{ kind: "rule", text: "New rule." }] });
    run.events[0]!.artifact.renderedContent = "<p>Revised report</p>";
    run.updatedAt = "2026-08-30T03:00:00.000Z";
    const previousRules = await page.locator(".run-detail-content").elementHandle();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.waitForFunction(old => !old?.isConnected, previousRules);
    assert.equal(await page.locator(".schema-draft-preview").getAttribute("open"), null, "explicitly collapsed draft overrides its default open state after refresh");
    const newRule = page.locator(".effective-reference").filter({ hasText: "statements/new-rules" }).first();
    const stepArtifact = page.locator(".run-step > details.task-result").first();
    assert.equal(await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open), true, "revising a step artifact keeps the same artifact expanded");
    assert.equal(await stepArtifact.locator(".artifact-review-artifact-content").isVisible(), true);
    assert.match(await stepArtifact.locator(".artifact-review-artifact-content").innerText(), /Revised report/);
    assert.equal(await closedArtifact.evaluate(node => (node as HTMLDetailsElement).open), false, "the independently collapsed final-artifact presentation stays collapsed after revision");
    const procedureRules = page.locator(".run-procedure-asserts > details").first();
    assert.equal(await procedureRules.evaluate(node => (node as HTMLDetailsElement).open), true, "adding a rule keeps the same procedure-rule container expanded");
    await newRule.waitFor();
    assert.equal(await newRule.locator(".section-body").isVisible(), true, "new rule is visible inside its still-expanded parent");
    assert.equal(await newRule.locator(":scope > .section-header").getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator(".effective-reference").filter({ hasText: "statements/run-rules" }).first().locator(":scope > .section-header").getAttribute("aria-expanded"), "false");

    const refreshDetail = async () => {
      const previous = await page.locator(".run-detail-content").elementHandle();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(old => !old?.isConnected, previous);
      await page.locator(".run-detail-content").waitFor();
    };
    // Removing a sibling and revising the existing reference preserve their containers.
    run.assertTree.entries.shift();
    run.assertTree.entries[0]!.entries[0]!.text = "Revised rule evidence.";
    run.updatedAt = "2026-08-30T04:00:00.000Z";
    await refreshDetail();
    assert.equal(await procedureRules.evaluate(node => (node as HTMLDetailsElement).open), true, "removing a rule keeps its stable parent expanded");
    assert.equal(await rule.getAttribute("aria-expanded"), "false", "same reference remains collapsed when its rules change");
    assert.equal(await page.locator(".effective-reference").first().isVisible(), true);

    // Ambiguous references must not inherit the unique old reference's collapsed state.
    run.assertTree.entries.push({ kind: "reference", target: "statements/run-rules", entries: [{ kind: "rule", text: "A separate reference with the same target." }] });
    run.updatedAt = "2026-08-30T05:00:00.000Z";
    await refreshDetail();
    assert.equal(await procedureRules.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await page.locator(".effective-reference > .section-header[aria-expanded=true]").count(), 2, "ambiguous duplicate identities retain default expanded state");
    assert.equal(await page.locator(".effective-reference > .section-body").first().isVisible(), true);
    assert.equal(await page.locator(".effective-reference > .section-body").last().isVisible(), true);

    // Explicitly collapsed containers also survive subsequent body revisions.
    await procedureRules.locator(":scope > summary").click();
    await stepArtifact.locator(":scope > summary").click();
    run.assertTree.entries[0]!.entries[0]!.text = "Another rule revision.";
    run.events[0]!.artifact.renderedContent = "<p>Second report revision</p>";
    run.updatedAt = "2026-08-30T06:00:00.000Z";
    await refreshDetail();
    assert.equal(await procedureRules.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await stepArtifact.locator(".artifact-review-artifact-content").isVisible(), false);
    // Leave the step artifact accessible for the existing review-entry check below.
    await stepArtifact.locator(":scope > summary").click();

    // Loop/call events can share stepId and contract while remaining different accepted outputs.
    run.events.push({ ...structuredClone(run.events[0]!), at: "2026-08-30T07:00:00.000Z", artifact: { ...structuredClone(run.events[0]!.artifact), renderedContent: "<p>Second accepted event</p>" } });
    await refreshDetail();
    const eventCards = page.locator("details.run-artifact");
    await eventCards.nth(0).locator(":scope > summary").click();
    assert.equal(await eventCards.nth(0).evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await eventCards.nth(1).evaluate(node => (node as HTMLDetailsElement).open), false);
    await refreshDetail();
    assert.equal(await eventCards.nth(0).evaluate(node => (node as HTMLDetailsElement).open), true, "different accepted events with the same stepId keep independent choices");
    assert.equal(await eventCards.nth(1).evaluate(node => (node as HTMLDetailsElement).open), false);
    run.events[0]!.artifact.renderedContent = "<p>Revised first accepted event</p>";
    run.events.push({ ...structuredClone(run.events[1]!), at: "2026-08-30T08:00:00.000Z", artifact: { ...structuredClone(run.events[1]!.artifact), renderedContent: "<p>New third accepted event</p>" } });
    await refreshDetail();
    assert.equal(await eventCards.nth(0).evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await eventCards.nth(0).locator(".artifact-review-artifact-content").isVisible(), true);
    assert.match(await eventCards.nth(0).locator(".artifact-review-artifact-content").innerText(), /Revised first accepted event/);
    assert.equal(await eventCards.nth(1).evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await eventCards.nth(2).evaluate(node => (node as HTMLDetailsElement).open), false, "new accepted event uses its default");

    // Accepted events can share the same millisecond, frame, step and contract.
    // The preceding non-final event belongs to the same full-history identity group.
    const sameClockEvent = (body: string, final = true) => ({ ...structuredClone(run.events[0]!), at: "2026-08-30T09:00:00.000Z", artifact: { ...structuredClone(run.events[0]!.artifact), final, renderedContent: `<p>${body}</p>` } });
    run.events.push(sameClockEvent("Non-final same-clock event", false), sameClockEvent("First same-clock final"), sameClockEvent("Second same-clock final"));
    await refreshDetail();
    const sameClockFirst = eventCards.nth(3), sameClockSecond = eventCards.nth(4);
    assert.equal(await eventCards.count(), 5, "the non-final event is filtered from the final collection");
    await sameClockFirst.locator(":scope > summary").click();
    await stepArtifact.locator(":scope > summary").click();
    assert.equal(await sameClockFirst.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await sameClockSecond.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.match(await stepArtifact.locator(".artifact-review-artifact-content").innerText(), /Second same-clock final/);
    assert.equal(await stepArtifact.locator(".artifact-review-artifact-content").isVisible(), true, "latest step output has an independent choice from its final-collection presentation");
    await refreshDetail();
    assert.equal(await sameClockFirst.evaluate(node => (node as HTMLDetailsElement).open), true, "same-clock accepted events preserve independent choices across refresh");
    assert.equal(await sameClockSecond.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open), true);
    run.events[4]!.artifact.renderedContent = "<p>Revised first same-clock final</p>";
    await refreshDetail();
    assert.equal(await sameClockFirst.locator(".artifact-review-artifact-content").isVisible(), true);
    assert.match(await sameClockFirst.locator(".artifact-review-artifact-content").innerText(), /Revised first same-clock final/);
    assert.equal(await sameClockSecond.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open), true, "editing an earlier output leaves the latest accepted output unchanged");
    run.events.push(sameClockEvent("Second same-clock final"));
    await refreshDetail();
    assert.equal(await eventCards.count(), 6);
    assert.equal(await sameClockFirst.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await sameClockSecond.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await eventCards.nth(5).evaluate(node => (node as HTMLDetailsElement).open), false, "appended same-clock output with identical body starts collapsed");
    assert.equal(await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open), false, "a new latest accepted event starts collapsed even when its tuple and body match the previous latest");
    await stepArtifact.locator(":scope > summary").click();
    assert.equal(await stepArtifact.locator(".artifact-review-artifact-content").isVisible(), true);
    assert.match(await stepArtifact.locator(".artifact-review-artifact-content").innerText(), /Second same-clock final/);

    // Real RunFrame owners keep anonymous rule trees separate through nested calls.
    const ownerRules = (label: string) => ({ entries: [{ kind: "reference", target: "statements/shared-owner-rules", entries: [{ kind: "rule", text: label }] }], sections: [] });
    run.assertTree = ownerRules("Root owner");
    const stack = run.stack as Array<Record<string, any>>;
    Object.assign(stack[0]!, { memoryName: run.procedureName, assertTree: structuredClone(run.assertTree) });
    stack.push(
      { type: "procedure", memoryName: "parent-procedure", returnTo: "call-parent", steps: [], index: 0, assertTree: ownerRules("Callee owner") },
      { type: "procedure", memoryName: "leaf-procedure", returnTo: "recurse", steps: [], index: 0, assertTree: ownerRules("Leaf owner") }
    );
    await refreshDetail();
    const ownerTree = (label: string) => page.locator(".run-procedure-asserts > details").filter({ hasText: label });
    const rootOwner = ownerTree("Root owner"), calleeOwner = ownerTree("Callee owner"), leafOwner = ownerTree("Leaf owner");
    assert.equal(await page.locator(".run-procedure-asserts > details").count(), 3, "root frame retains the existing body-dedup display");
    await rootOwner.locator(":scope > summary").click();
    await rootOwner.locator(".section-header").click();
    await calleeOwner.locator(":scope > summary").click();
    await leafOwner.locator(":scope > summary").click();
    await leafOwner.locator(".section-header").click();
    await leafOwner.locator(":scope > summary").click();
    await refreshDetail();
    assert.equal(await rootOwner.evaluate(node => (node as HTMLDetailsElement).open), true, "root rule owner keeps its independently expanded container");
    assert.equal(await calleeOwner.evaluate(node => (node as HTMLDetailsElement).open), true, "callee rule owner keeps its independently expanded container");
    assert.equal(await leafOwner.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal(await rootOwner.locator(".section-header").isVisible(), true);
    assert.equal(await rootOwner.locator(".section-header").getAttribute("aria-expanded"), "false");
    assert.equal(await calleeOwner.locator(".section-body").isVisible(), true);
    assert.equal(await leafOwner.locator(".section-header").getAttribute("aria-expanded"), "false", "same reference target under a nested owner has its own choice");

    // A real recursive frame reuses its frozen procedure tree and stays body-deduplicated.
    stack.push({ type: "procedure", memoryName: "leaf-procedure", returnTo: "recurse", steps: [], index: 0, assertTree: structuredClone(stack[2]!.assertTree) });
    await refreshDetail();
    assert.equal(await page.locator(".run-procedure-asserts > details").count(), 3, "same-procedure recursion retains the existing body deduplication");
    assert.equal(await rootOwner.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await calleeOwner.locator(".section-body").isVisible(), true);
    stack.pop();
    await refreshDetail();

    stack.push(
      { type: "procedure", memoryName: "new-procedure", returnTo: "recurse", steps: [{ id: "write-schema", instruction: "Write nested output", artifact: "nested output" }], index: 0, assertTree: ownerRules("Pushed owner") },
      { type: "schema", memoryName: "nested-schema", sourceStepId: "write-schema", steps: [], index: 0 }
    );
    await refreshDetail();
    assert.equal(await rootOwner.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await calleeOwner.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await ownerTree("Pushed owner").evaluate(node => (node as HTMLDetailsElement).open), false, "a pushed callee starts with its default collapsed container");
    assert.equal(await ownerTree("Pushed owner").locator(".section-header").getAttribute("aria-expanded"), "true");
    stack.splice(-2);
    await refreshDetail();
    assert.equal(await ownerTree("Pushed owner").count(), 0);
    assert.equal(await calleeOwner.locator(".section-body").isVisible(), true, "popping a nested frame preserves its surviving callers");
    await leafOwner.locator(":scope > summary").click();
    stack[1]!.memoryName = "alternate-parent";
    await refreshDetail();
    assert.equal(await rootOwner.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await leafOwner.evaluate(node => (node as HTMLDetailsElement).open), false, "same leaf memoryName/returnTo under a different prefix is a new owner");
    assert.equal(await leafOwner.locator(".section-header").getAttribute("aria-expanded"), "true", "changed call chain does not borrow the previous reference state");
    await leafOwner.locator(":scope > summary").click();
    await leafOwner.locator(".section-header").click();
    stack[2]!.returnTo = "other-call-site";
    await refreshDetail();
    assert.equal(await leafOwner.evaluate(node => (node as HTMLDetailsElement).open), false, "same procedure reached through another call step is a new owner");
    assert.equal(await leafOwner.locator(".section-header").getAttribute("aria-expanded"), "true");

    await page.locator(".mem-view-list-item").filter({ hasText: "Other Run" }).click();
    await page.getByRole("heading", { name: "Other Run", level: 1 }).waitFor();
    assert.equal(await page.locator("details.run-collapsible[open]").count(), 0, "a different Run retains default collapsed details");
    assert.equal(await page.locator(".effective-reference > .section-header[aria-expanded=false]").count(), 0, "rule collapse does not leak to another Run");
    await page.locator(".mem-view-list-item").filter({ hasText: "Demo Run" }).click();
    await page.getByRole("heading", { name: "Demo Run", level: 1 }).waitFor();
    if (!await stepArtifact.evaluate(node => (node as HTMLDetailsElement).open)) await stepArtifact.locator(":scope > summary").click();
    const requestsBeforeReview = runDetailRequests;
    await page.getByRole("button", { name: /Artifact review/ }).click();
    await page.locator(".view-overlay-layer .artifact-review-modal").waitFor();
    assert.match(await page.locator("#artifact-review-artifact-pane").innerText(), /Review this artifact/);
    assert.match(await page.locator("#artifact-review-review-pane").innerText(), /Runner delegated/);
    assert.match(await page.locator("#artifact-review-review-pane").innerText(), /Human explicitly authorized this submission/);
    assert.equal(new URL(page.url()).pathname, "/tasks/run-demo/artifact-reviews/review-1");
    assert.equal(runDetailRequests, requestsBeforeReview, "opening the review should reuse the Run detail already loaded by the page");
    const [surfaceBox, modalBox] = await Promise.all([
      page.locator(".view-overlay-surface").boundingBox(),
      page.locator(".view-overlay-layer .artifact-review-modal").boundingBox()
    ]);
    assert(surfaceBox && modalBox);
    assert(Math.abs(surfaceBox.width - modalBox.width) < 1);
    assert(Math.abs(surfaceBox.height - modalBox.height) < 1);
    assert(modalBox.x + modalBox.width <= (await page.evaluate(() => innerWidth)) + 1);
  } finally { await browser.close(); await close(server); }
});

for (const locale of ["en", "zh-CN"]) {
  test(`Run identifies Human executors in current, completed and nested steps (${locale})`, async () => {
    const [bundle, sdk, runtime] = await Promise.all([
      buildRunBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
    ]);
    const catalog = builtinModuleCatalog.find(entry => entry.moduleId === "org.memsphere.run")!;
    const instances: ViewHostBootInstance[] = [{
      pluginPath: bundlePath, routeGrants: catalog.routes,
      module: { projectId: "demo", moduleId: catalog.moduleId, moduleVersion: "0.1.2", instanceId: catalog.instanceId }
    }];
    const action = (id: string, actor?: string) => ({ id, kind: "action", instruction: id, actor, artifact: { name: `${id} result` } });
    const current = action("current-human", "human");
    const run = {
      id: "executors", name: "Executor Run", procedureName: "executors", status: "running",
      stack: [{ type: "procedure", index: 0, steps: [current] }],
      plan: [action("completed-human", "human"), current, action("agent", "agent"), action("default"),
        { ...action("human-if", "human"), kind: "branch", branches: {
          truthy: [action("nested-human", "human")], falsy: [action("nested-false-human", "human"), action("nested-agent", "agent")]
        } },
        { ...action("human-while", "human"), kind: "loop", loop: { body: [action("loop-human", "human")] } },
        { id: "call", kind: "call", target: "other-procedure" }],
      events: [{ stepId: "completed-human", artifact: { name: "completed-human result", renderedContent: "<p>Completed</p>" } }]
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === bundlePath) return send(response, "text/javascript", bundle);
      if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
      if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
      if (url.pathname === "/api/runs") return json(response, { runs: [{ ...run, eventCount: 1 }] });
      if (url.pathname === "/api/runs/executors") return json(response, { run });
      return send(response, "text/html", renderViewHostHtml(locale, instances));
    });
    const origin = await listen(server);
    const browser = await browserScope();
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}/tasks/executors`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Executor Run", exact: true }).waitFor();
      const label = locale === "en" ? "Executor Human" : "执行者 Human";
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const id of ["completed-human", "current-human", "human-if", "nested-human", "nested-false-human", "human-while", "loop-human"]) {
          const head = page.locator(`[data-step-id="${id}"] > .mem-content-flow-head`);
          assert.equal(await head.locator(".run-flow-actor").count(), 1, `${id} exposes its Human executor`);
          assert.equal(await head.locator(".run-flow-actor").textContent(), label);
          assert.equal(await head.locator(".run-flow-actor").isVisible(), true);
          assert.equal(await head.locator(".mem-content-artifact-contract .run-flow-actor").count(), 0);
          assert.match(await head.locator(".mem-content-artifact-contract").innerText(), new RegExp(`${id} result`));
        }
        for (const id of ["agent", "default", "nested-agent", "call"]) {
          assert.equal(await page.locator(`[data-step-id="${id}"] > .mem-content-flow-head .run-flow-actor`).count(), 0);
        }
        assert.equal(await page.locator('[aria-current="step"] .run-current-step-marker').innerText(), locale === "en" ? "Current step" : "当前步骤");
        if (width === 390) {
          const head = page.locator('[data-step-id="current-human"] > .mem-content-flow-head');
          const [headBox, actionBox] = await Promise.all([head.boundingBox(), head.locator(".mem-content-flow-action").boundingBox()]);
          assert(headBox && actionBox && actionBox.width > headBox.width / 2, "executor metadata leaves room to read the step on mobile");
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    } finally { await browser.close(); await close(server); }
  });
}

async function buildRunBundle(): Promise<string> {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../modules/org.memsphere.run/adapter/view/index.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}
async function browserModule(path: string): Promise<string> { const source=await readFile(new URL(path,import.meta.url),"utf8");return transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText; }
async function browserRuntimeBundle():Promise<string>{const result=await build({entryPoints:[fileURLToPath(new URL("../src/view/view-runtime.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",external:["@memsphere/view-sdk","./view-sdk.js"],logLevel:"silent"});return result.outputFiles[0]?.text??"";}
function send(response:ServerResponse,type:string,body:string):void{response.writeHead(200,{"content-type":`${type}; charset=utf-8`});response.end(body);}function json(response:ServerResponse,body:unknown):void{send(response,"application/json",JSON.stringify(body));}
async function listen(server:Server):Promise<string>{await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}async function close(server:Server):Promise<void>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
