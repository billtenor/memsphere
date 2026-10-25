import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";

test("real Run graph changes history without opening an overlay and keeps its dialog across version navigation", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}); const service = (await openContextControl(f.root, true))!; const run = await service.start("产物图验收");
  const a = (await service.report(run.id, { name: "需求", content: textContent("固定需求"), tags: ["requirements"] })).artifact;
  const b1 = (await service.report(run.id, { name: "方案", content: textContent("旧正文"), dependencies: [{ kind: "artifact", id: a.id }], tags: ["design"] })).artifact;
  const b2 = (await service.report(run.id, { revisedFrom: b1.id, content: textContent("新正文"), tags: ["design"] })).artifact;
  await service.review(run.id, b2.id, "agent", ["新版本意见"]);
  await service.report(run.id, { name: "总结", content: textContent("总结正文"), dependencies: [{ kind: "artifact", id: b2.id }] });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${origin}/projects/test-project/tasks/${run.id}`);
    await page.getByRole("button", { name: "方案 v2", exact: true }).waitFor();
    assert.equal(await page.locator(".cc-node").count(), 3);
    await page.locator(".cc-history").getByText("历史版本 · 1", { exact: true }).click();
    await page.getByRole("button", { name: "v1 · 方案", exact: true }).click();
    assert.equal(await page.locator("dialog").count(), 0);
    assert.equal(await page.locator(".cc-node").count(), 2);
    await page.getByRole("button", { name: "方案 v1", exact: true }).click();
    await page.getByText("旧正文", { exact: true }).waitFor();
    await page.evaluate(() => { (window as any).__dialog = document.querySelector("dialog"); });
    await page.getByRole("button", { name: "下一版", exact: true }).click();
    await page.getByText("新正文", { exact: true }).waitFor(); await page.getByText("新版本意见", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).__dialog === document.querySelector("dialog") && document.querySelector("dialog")!.open), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "评审", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "评审", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("region", { name: "产物内容", exact: true }).isVisible(), false);
    await page.keyboard.press("Escape"); await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator(".cc-node").count(), 3);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
