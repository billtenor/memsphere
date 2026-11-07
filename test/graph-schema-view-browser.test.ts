import { browserScope } from "./helpers/browser.js";
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
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-browser"], defines: ["Draft preview"], actions: [{ tag: "!action", id: "write", description: "Write a report", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nformat: {name: markdown, layout: outline}\nfields: [Summary, Risks]\n" }, payload: { contentType: "text/markdown" } } }] };
  const state = await service.withGraph(async g => {
    const start = await g.start({ name: "Schema browser", procedure }), run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step); let draft = await g.enterSchema(run, step);
    draft = await g.schemaWrite(run, step, "report", draft.position!, "# Report");
    draft = await g.schemaWrite(run, step, "report", draft.position!, "Visible summary");
    return { run, step, draft };
  });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/test-project/tasks/${state.run}`);
    await page.locator('.pg-node[data-action-id="write"]').click();
    const progress = page.getByRole("region", { name: "Schema 撰写进度" }); await progress.waitFor();
    assert.match(await progress.innerText(), /2\/3/); assert.match(await progress.innerText(), /Report.Risks/);
    await page.locator(".cc-document").getByText("Visible summary", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "产物内容", exact: true }).click();
    assert.ok(await progress.isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await service.withGraph(g => g.schemaWrite(state.run, state.step, "report", state.draft.position!, "Visible risks"));
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator('.pg-node[data-action-id="write"]').click();
    await page.getByRole("region", { name: "Schema 撰写进度" }).getByText(/3\/3/).waitFor();
    await page.locator(".cc-document").getByText("Visible risks", { exact: true }).waitFor();
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
