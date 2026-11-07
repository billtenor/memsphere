import { browserScope, type TestBrowser } from "./helpers/browser.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

test("graph draft dialog shows positioned progress and Markdown on desktop and narrow screens", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-browser"], defines: ["Draft preview"], actions: [{ tag: "!action", id: "write", description: "Write a report", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nformat: {name: markdown, layout: outline}\nfields: [Summary, !schema {name: Risks, type: number}]\n" }, payload: { contentType: "text/markdown" } } }] };
  const state = await service.withGraph(async g => {
    const start = await g.start({ name: "Schema browser", procedure }), run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step); let draft = await g.enterSchema(run, step);
    draft = await g.schemaWrite(run, step, "report", draft.position!, "# Report");
    draft = await g.schemaWrite(run, step, "report", draft.position!, "Visible summary");
    return { run, step, draft };
  });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let browser: TestBrowser | undefined;
  try {
    browser = await browserScope();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/test-project/tasks/${state.run}`);
    await page.locator('.pg-node[data-action-id="write"]').click();
    const execution = page.locator(".cc-execution-info");
    const openExecution = async () => {
      if (!await execution.evaluate(node => (node as HTMLDetailsElement).open)) await execution.locator("summary").click();
    };
    const progress = execution.getByRole("region", { name: "Schema 撰写进度", includeHidden: true });
    await progress.waitFor({ state: "attached" });
    assert.equal(await progress.isVisible(), false, "draft execution progress follows the collapsed execution disclosure");
    const headingStyles = await page.locator(".cc-action-definition > summary, .cc-execution-info > summary").evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node); return { fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, markerColor: getComputedStyle(node, "::marker").color };
    }));
    assert.equal(headingStyles.length, 2); assert.deepEqual(headingStyles[0], headingStyles[1]);
    await openExecution(); await progress.waitFor();
    assert.match(await progress.innerText(), /2\/3/); assert.match(await progress.innerText(), /Report.Risks/);
    await page.locator(".cc-document").getByText("Visible summary", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "产物内容", exact: true }).click();
    assert.ok(await progress.isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await assert.rejects(service.withGraph(g => g.schemaWrite(state.run, state.step, "report", state.draft.position!, "invalid number")));
    const failure = await service.withGraph(g => g.schemaShow(state.run, state.step));
    const issue = failure.validation!.issues[0].message;
    const { contextRunPayload } = await import("../src/context_control/view.js");
    const full = await service.withGraph(async g => contextRunPayload(await g.snapshot(state.run)));
    assert.equal(full.context.artifacts.find(a => a.id === state.draft.draft!.id)!.writingProgress!.validation!.issues[0].message, issue);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator('.pg-node[data-action-id="write"]').click();
    await openExecution();
    await execution.locator(".cc-schema-issue").getByText(issue, { exact: true }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await service.withGraph(g => g.schemaWrite(state.run, state.step, "report", state.draft.position!, "42"));
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator('.pg-node[data-action-id="write"]').click();
    await openExecution();
    await progress.getByText(/3\/3/).waitFor();
    await page.locator(".cc-document").getByText("42", { exact: true }).waitFor();
    assert.equal(await page.locator(".cc-schema-issue").count(), 0);
    await assert.rejects(service.withGraph(g => g.report(state.run, state.step, { contentRef: { storeId: "context_control/artifacts", dataId: `${state.run}/${state.draft.draft!.id}`, sha256: "0".repeat(64) } })), /SHA-256 mismatch/);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator('.pg-node[data-action-id="write"]').click();
    await openExecution();
    await execution.locator(".cc-schema-issue").getByText(/SHA-256 mismatch/).waitFor();
    await openExecution();
    await progress.getByText(/3\/3/).waitFor();
    assert.equal((await service.withGraph(g => g.schemaShow(state.run, state.step))).draft!.content!.payload.content.includes("42"), true);

  } finally { try { await browser?.close(); } finally { await new Promise<void>(resolve => server.close(() => resolve())); } }
});

test("reopening a revised Schema Step shows its current draft while the preceding submission remains selectable", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-revision-browser"], defines: ["Revision preview"], actions: [{ tag: "!action", id: "write", description: "Revise report", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nformat: {layout: outline}\nfields: [Summary, Risks]\n" }, payload: { contentType: "text/markdown" }, review: ["approval"] } }] };
  const state = await service.withGraph(async g => {
    const started = await g.start({ name: "Revision browser", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.write", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }, acpProviders: {} }, reviewConfiguration: { reviews: { "schema-revision-browser#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-revision-browser::approval": { actorIds: ["human"] } } } });
    const run = started.run.id, step = started.steps[0].id; await g.enter(run, step);
    let first = await g.enterSchema(run, step);
    for (const value of ["# Original report", "Original summary", "Original risks"]) first = await g.schemaWrite(run, step, "report", first.position!, value);
    const submitted = await g.report(run, step, { text: first.draft!.content!.payload.content });
    await g.submitReview(run, step, submitted.step.reviewRounds![0].id, "runner", "request_changes", [], "Clarify summary");
    let draft = await g.enterSchema(run, step);
    for (const value of ["# Revised report", "Revised summary"]) draft = await g.schemaWrite(run, step, "report", draft.position!, value);
    return { run, step, originalId: submitted.artifact.id, originalRoundId: submitted.step.reviewRounds![0].id, draftId: draft.draft!.id, cli: await g.schemaShow(run, step) };
  });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let browser: TestBrowser | undefined;
  try {
    browser = await browserScope(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/test-project/tasks/${state.run}`);
    const openCurrent = async () => {
      await page.locator('.pg-node[data-action-id="write"]').click();
      const dialog = page.locator(".cc-dialog[open]"); await dialog.locator(".cc-artifact-header").waitFor();
      assert.equal(await dialog.getAttribute("data-artifact-id"), state.cli.draft!.id);
      await dialog.locator(".cc-document").getByText("Revised summary", { exact: true }).waitFor();
      const info = dialog.locator(".cc-execution-info");
      if (!await info.evaluate(node => (node as HTMLDetailsElement).open)) await info.locator("summary").click();
      const progress = info.getByRole("region", { name: "Schema 撰写进度" });
      await progress.waitFor(); assert.match(await progress.innerText(), /2\/3/); assert.match(await progress.innerText(), /Report.Risks/);
      return dialog;
    };
    let dialog = await openCurrent();
    await dialog.getByRole("combobox", { name: "产物版本", exact: true }).selectOption(state.originalId);
    await dialog.getByText("Original summary", { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await dialog.getAttribute("data-artifact-id"), state.originalId);
    const historicalRound = dialog.locator("select:has(option[data-round-id])");
    await historicalRound.waitFor(); assert.equal(await historicalRound.inputValue(), state.originalRoundId);
    await page.getByRole("button", { name: "刷新", exact: true }).dispatchEvent("click");
    await dialog.getByText("Original summary", { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await dialog.getAttribute("data-artifact-id"), state.originalId, "refresh preserves an explicitly selected historical submission");
    await page.reload(); dialog = await openCurrent();
    assert.equal(await dialog.getAttribute("data-artifact-id"), state.draftId);
    assert.equal((await service.withGraph(g => g.schemaShow(state.run, state.step))).draft!.id, state.draftId);
  } finally { try { await browser?.close(); } finally { await new Promise<void>(resolve => server.close(() => resolve())); } }
});
