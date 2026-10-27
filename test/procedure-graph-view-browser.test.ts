import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

test("graph View renders Markdown and submits a Human inline opinion through the existing Review overlay", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, names: ["browser-graph"], defines: ["Graph review browser contract"], mode: "graph", actions: [{ tag: "!action", id: "A", description: "Prepare the candidate", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Candidate", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" }, review: ["reviewer"] } }] };
  const report = await service.withGraph(async g => {
    const start = await g.start({ name: "Graph Human review", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }, acpProviders: {} }, reviewConfiguration: { reviews: { "browser-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "browser-graph::reviewer": { actorIds: ["human"] } } } });
    await g.enter(start.run.id, start.steps[0].id); return g.report(start.run.id, start.steps[0].id, { text: "# Graph candidate\n\nEvidence is pending." });
  });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/test-project/tasks/${report.snapshot.run.id}`);
    await page.locator(".cc-work-step > summary").click();
    await page.getByRole("button", { name: "查看与参与评审", exact: true }).click();
    const modal = page.locator("#artifact-review-modal"); await modal.waitFor();
    assert.equal(await modal.locator("#artifact-review-artifact-pane h1").innerText(), "Graph candidate");
    await modal.locator(".inline-plus").first().click();
    const editor = modal.locator(".inline-comment-editor"); await editor.getByPlaceholder("这里应该如何修改？").fill("补充验收依据");
    const saved = page.waitForResponse(r => r.url().endsWith("/draft") && r.request().method() === "PATCH");
    await editor.getByRole("button", { name: "添加意见", exact: true }).click(); assert.equal((await saved).status(), 200);
    await modal.getByText("补充验收依据", { exact: true }).waitFor();
    await modal.getByRole("radio", { name: "要求修改", exact: true }).click();
    await modal.getByRole("button", { name: "提交评审", exact: true }).click();
    const confirm = page.locator("dialog.mem-view-confirm"); await confirm.waitFor();
    const submitted = page.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
    await confirm.getByRole("button", { name: "提交评审", exact: true }).click(); assert.equal((await submitted).status(), 200);
    const snapshot = await service.snapshot(report.snapshot.run.id);
    assert.equal(snapshot.steps[0].id, report.step.id); assert.equal(snapshot.steps[0].status, "running");
    assert.equal(snapshot.reviews[0].comments[0].anchor!.location, "markdown:h1:0");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".run-error,.memory-error")].map(n => n.textContent)), []);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
