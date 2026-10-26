import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { readProjectConfig } from "../src/config.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import { createViewServer } from "../src/commands/view.js";

test("Run header finishes exploration, archives it, and restores it without reopening production", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!, run = await service.start("页面结束归档");
  const a = (await service.report(run.id, { name: "交付", content: textContent("可交付正文") })).artifact;
  const commandStore = (await openCommandStates(true, f.home))!;
  await commandStore.create({}, "context-lifecycle", {id:"context-lifecycle",commandGroup:"run",groupId:run.id,status:"active",parameters:{project:"test-project"},state:{}});
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, browser = await browserScope();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/projects/test-project/tasks/${run.id}`);
    await page.getByRole("button", { name: "结束运行", exact: true }).click();
    assert.match(await page.getByRole("dialog").innerText(), /1[\s\S]*交付/);
    await service.report(run.id, { name: "确认后新增", content: textContent("不属于本次确认") });
    await page.getByRole("dialog").getByRole("button", { name: "结束运行", exact: true }).click();
    await page.getByRole("button", { name: "归档", exact: true }).first().waitFor();
    assert.equal((await service.findRun(run.id))!.status, "done");
    assert.equal((await commandStore.get({},"context-lifecycle"))!.value.status,"closed");
    await page.getByRole("button", { name: "归档", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "归档", exact: true }).click();
    await page.waitForURL(`${origin}/projects/test-project/tasks?status=done`);
    assert.ok((await service.findRun(run.id))!.archived);
    await page.getByText("已归档", { exact: true }).click();
    await page.getByText("页面结束归档", { exact: true }).first().click();
    await page.getByRole("button", { name: "恢复归档", exact: true }).waitFor();
    await page.goto(`${origin}/projects/test-project/tasks/${run.id}`);
    await page.getByRole("button", { name: "恢复归档", exact: true }).click();
    await page.getByRole("button", { name: "归档", exact: true }).first().waitFor();
    const restored = (await service.findRun(run.id))!;
    assert.equal(restored.archived, false); assert.equal(restored.status, "done");
    assert.equal((await commandStore.get({},"context-lifecycle"))!.value.status,"closed");
    assert.equal(await page.getByRole("button", { name: "结束运行", exact: true }).count(), 0);
    await page.getByRole("button", { name: "交付 v1", exact: true }).click();
    await page.getByText("可交付正文", { exact: true }).waitFor();
    assert.deepEqual((await service.snapshot(run.id)).outputArtifactIds, [a.id]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

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
    await page.locator(".cc-graph[data-layout-ready]").waitFor();
    assert.equal(await page.locator(".cc-node").count(), 3);
    await page.locator(".cc-history").getByText("历史版本 · 1", { exact: true }).click();
    await page.evaluate(() => { (window as any).__graph = document.querySelector(".cc-graph"); });
    await Promise.all([page.waitForResponse(r => r.url().endsWith(`/runs/${run.id}`)), page.getByRole("button", { name: "刷新", exact: true }).click()]);
    assert.equal(await page.evaluate(() => (window as any).__graph === document.querySelector(".cc-graph") && !!document.querySelector(".cc-history[open]")), true);
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

test("External projection, full details, edge endpoints and two-axis grab panning use the real Run view", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!, run = await service.start("图交互");
  const external = await service.addExternal(run.id, "共享外部来源", { content: textContent("完整资料".repeat(100), "text/markdown") });
  await service.addExternal(run.id, "尚未使用的资料", { content: textContent("new") });
  const hiddenInput = await service.addExternal(run.id, "历史独占来源", { content: textContent("old") });
  const hidden = (await service.report(run.id, { name: "收起产物", content: textContent("old"), dependencies: [{ kind: "external", id: hiddenInput.id }] })).artifact;
  await service.updateOutputs(run.id, [], [hidden.id]);
  let last = (await service.report(run.id, { name: "主干", content: textContent("A"), dependencies: [{ kind: "external", id: external.id }] })).artifact;
  for (let i = 0; i < 4; i++) last = (await service.report(run.id, { name: `后续${i}`, content: textContent("B"), dependencies: [{ kind: "artifact", id: last.id }] })).artifact;
  for (let i = 0; i < 7; i++) await service.report(run.id, { name: `并行${i}`, content: textContent("C"), dependencies: [{kind:"artifact", id:last.id}] });
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${origin}/projects/test-project/tasks/${run.id}`);
    await page.getByRole("button", { name: /共享外部来源/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /历史独占来源/ }).count(), 0);
    await page.getByRole("button", { name: /尚未使用的资料/ }).waitFor();
    await page.locator(".cc-graph[data-layout-ready]").waitFor();
    await page.locator(".cc-edge-hit").first().hover();
    assert.equal(await page.locator('.cc-edge[data-highlighted="true"]').count(), 1);
    assert.equal(await page.locator('.cc-node[data-edge-highlighted="true"]').count(), 2);
    const canvas = page.locator(".cc-canvas-scroll"), box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width - 25, box.y + 210); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 205, box.y + 80, { steps: 8 }); await page.mouse.up();
    const offset = await canvas.evaluate(e => [e.scrollLeft, e.scrollTop]); assert.ok(offset[0] > 0 && offset[1] > 0);
    await page.mouse.move(box.x + 50, box.y + 50); assert.deepEqual(await canvas.evaluate(e => [e.scrollLeft, e.scrollTop]), offset);
    for (const cancel of ["pointercancel", "lostpointercapture", "blur"]) {
      await canvas.evaluate(e => { e.scrollLeft = 0; e.scrollTop = 0; });
      await page.mouse.move(box.x + box.width - 25, box.y + 210); await page.mouse.down();
      await page.mouse.move(box.x + box.width - 105, box.y + 150);
      await canvas.evaluate((e, name) => {
        if (name === "blur") window.dispatchEvent(new Event("blur"));
        else e.dispatchEvent(new PointerEvent(name, { pointerId: 1, bubbles: true }));
      }, cancel);
      const stopped = await canvas.evaluate(e => [e.scrollLeft, e.scrollTop]);
      await page.mouse.move(box.x + box.width - 205, box.y + 80);
      assert.deepEqual(await canvas.evaluate(e => [e.scrollLeft, e.scrollTop]), stopped, cancel);
      await page.mouse.up();
    }
    await page.getByRole("button", { name: /共享外部来源/ }).click();
    await page.locator(".cc-external-pane .cc-document").getByText("完整资料".repeat(100), { exact: true }).waitFor();
    assert.equal(await page.locator("dialog .cc-pane-review").count(), 0); assert.equal(await page.locator("dialog .cc-version-select").count(), 0);
    await page.keyboard.press("Escape");
    await service.updateOutputs(run.id, [], await service.outputs(run.id));
    await page.reload(); await page.getByRole("button", { name: /尚未使用的资料/ }).waitFor();
    assert.equal(await page.locator("[data-artifact-id]").count(), 0); assert.equal(await page.locator(".cc-external").count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
