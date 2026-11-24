import { runGit } from "../src/git.js";
import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { readProjectConfig } from "../src/config.js";
import { openCommandStates } from "../src/home/command-state-store.js";
import { createViewServer } from "../src/commands/view.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startRun, reportRun } from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Run list shares the Home query, omits unknown counts, and refreshes selected exploration details", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!, run = await service.start("list and detail");
  const first = (await service.report(run.id, { name: "first result", content: textContent("first body") })).artifact;
  const config = await readProjectConfig("test-project", f.home);
  await mkdir(join(config.memoryRoot, "procedures"), { recursive: true });
  await writeFile(join(config.memoryRoot, "procedures/counts.yaml"), withCurrentMemorySyntax(`!procedure
name: counts
flow:
  - !action
    action: first
    artifact: !artifact
      name: first
  - !action
    action: second
    artifact: !artifact
      name: second
`));
  const legacyOptions = { memoryRoot: config.memoryRoot, runsRoot: config.runsRoot, procedureName: "counts" };
  const zero = await startRun({ ...legacyOptions, name: "known zero" }), one = await startRun({ ...legacyOptions, name: "known one" });
  await reportRun({ runsRoot: config.runsRoot, runId: one.id, artifact: { kind: "inline", value: "complete" } });
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, browser = await browserScope();
  try {
    const page = await browser.newPage(); let summaries = 0;
    page.on("request", r => { const u = new URL(r.url()); if (u.pathname.endsWith("/runs") && u.searchParams.get("representation") === "summary") summaries++; });
    await page.goto(`${origin}/projects/test-project/tasks`);
    const row = page.locator(`[data-item-id="${run.id}"]`);
    try { await row.waitFor({ state: "visible" }); }
    catch (error) { t.diagnostic((await page.locator("body").innerText()).slice(0, 5000)); throw error; }
    assert.equal(summaries, 1);
    assert.doesNotMatch(await row.innerText(), /·\s*0/);
    assert.match(await page.locator(`[data-item-id="${zero.id}"]`).innerText(), /·\s*0/);
    assert.match(await page.locator(`[data-item-id="${one.id}"]`).innerText(), /·\s*1/);
    await row.click();
    await page.getByRole("button", { name: /first result/ }).waitFor();
    const second = (await service.report(run.id, { name: "new result", content: textContent("new body"), dependencies: [{ kind: "artifact", id: first.id }] })).artifact;
    await service.review(run.id, second.id, "human", ["latest opinion"]);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    const newNode = page.getByRole("button", { name: /new result/ });
    await newNode.waitFor(); await newNode.click();
    await page.getByRole("dialog").getByText("new body", { exact: true }).waitFor();
    await page.getByRole("dialog").getByText("latest opinion", { exact: true }).waitFor();
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("a delayed terminal list cannot replace the latest running selection", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  const running = await service.start("current running"), terminal = await service.start("terminal result");
  await service.finish(terminal.id);
  const server = createViewServer(await readProjectConfig("test-project", f.home));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, browser = await browserScope();
  let release!: () => void, arrive!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { arrive = resolve; });
  try {
    const page = await browser.newPage();
    await page.route("**/runs?representation=summary&status=done*", async route => { arrive(); await held; await route.continue(); });
    await page.goto(`${origin}/projects/test-project/tasks`);
    await page.locator(`[data-item-id="${running.id}"]`).waitFor();
    await page.getByRole("button", { name: "已完成", exact: true }).click();
    await entered;
    await page.getByRole("button", { name: "运行中", exact: true }).click();
    const returned = page.waitForResponse(r => new URL(r.url()).searchParams.get("status") === "done");
    release(); await returned;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator(`[data-item-id="${running.id}"]`).waitFor({ state: "visible" });
    assert.equal(await page.locator(`[data-item-id="${terminal.id}"]`).count(), 0);
    assert.equal(new URL(page.url()).searchParams.has("status"), false);
  } finally { release(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Run header finishes exploration, archives it, and restores it without reopening production", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!, run = await service.start("页面结束归档");
  const a = (await service.report(run.id, { name: "交付", content: textContent("可交付正文") })).artifact;
  const commandStore = (await openCommandStates(true, f.home))!;
  await commandStore.create({}, "codex-lifecycle", {id:"codex-lifecycle",agentType:"codex",sessionId:"lifecycle",updatedAt:new Date().toISOString(),commandGroup:"run",groupId:run.id,status:"active",parameters:{project:"test-project"},state:{}});
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
    assert.equal((await commandStore.get({},"codex-lifecycle"))!.value.status,"closed");
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
    assert.equal((await commandStore.get({},"codex-lifecycle"))!.value.status,"closed");
    assert.equal(await page.getByRole("button", { name: "结束运行", exact: true }).count(), 0);
    await page.getByRole("button", { name: "产物视角" }).click();
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
    await page.getByRole("button", { name: "产物视角" }).click();
    await page.getByRole("button", { name: "方案 v2", exact: true }).waitFor();
    await page.locator(".cc-graph[data-layout-ready]").waitFor();
    assert.equal(await page.locator(".cc-node").count(), 3);
    await page.locator(".cc-history").getByText("历史版本 · 1", { exact: true }).click();
    await page.evaluate(() => { (window as any).__graph = document.querySelector(".cc-graph"); });
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/runs/${run.id}`)), page.getByRole("button", { name: "刷新", exact: true }).click()]);
    assert.equal(await page.evaluate(() => (window as any).__graph === document.querySelector(".cc-graph") && !!document.querySelector(".cc-history[open]")), true);
    await page.getByRole("button", { name: "v1 · 方案", exact: true }).click();
    assert.equal(await page.locator("dialog.cc-dialog[open]").count(), 0);
    assert.equal(await page.locator(".cc-node").count(), 2);
    await page.getByRole("button", { name: "方案 v1", exact: true }).click();
    await page.getByText("旧正文", { exact: true }).waitFor();
    await page.evaluate(() => { (window as any).__dialog = document.querySelector<HTMLDialogElement>("dialog.cc-dialog"); });
    assert.equal(await page.getByRole("button",{name:/^(上一版|下一版)$/}).count(),0);
    await page.locator(".cc-version-select").selectOption({label:"v2 · 方案"});
    await page.getByText("新正文", { exact: true }).waitFor(); await page.getByText("新版本意见", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).__dialog === document.querySelector<HTMLDialogElement>("dialog.cc-dialog") && document.querySelector<HTMLDialogElement>("dialog.cc-dialog")!.open), true);
    await page.locator('.cc-related').getByRole('button',{name:'需求',exact:true}).click();await page.getByText('固定需求',{exact:true}).waitFor();await page.getByRole('button',{name:'← 返回',exact:true}).click();await page.getByText('新正文',{exact:true}).waitFor();
    const review=page.locator(".cc-pane-review"),divider=page.getByRole("separator",{name:"调整评审栏宽度",exact:true});
    assert.ok(Math.abs((await review.boundingBox())!.width/(await page.locator(".cc-modal-columns").boundingBox())!.width-.3)<.01);
    const handle=(await divider.boundingBox())!;await page.mouse.move(handle.x+handle.width/2,handle.y+80);await page.mouse.down();await page.mouse.move(handle.x-60,handle.y+80);await page.mouse.up();
    assert.ok((await review.boundingBox())!.width>330);
    await divider.focus();await page.keyboard.press("ArrowLeft");const resized=(await review.boundingBox())!.width;
    await page.getByRole("button",{name:"收起评审",exact:true}).click();assert.equal(await review.isVisible(),false);assert.equal(await divider.isVisible(),false);
    await page.getByRole("button",{name:"展开评审",exact:true}).click();assert.ok(Math.abs((await review.boundingBox())!.width-resized)<2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "评审", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "评审", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("region", { name: "产物内容", exact: true }).isVisible(), false);
    await page.keyboard.press("Escape"); await page.locator("dialog.cc-dialog").waitFor({ state: "detached" });
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
    await page.getByRole("button", { name: "产物视角" }).click();
    await page.getByRole("button", { name: /共享外部来源/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /历史独占来源/ }).count(), 0);
    await page.getByRole("button", { name: /尚未使用的资料/ }).waitFor();
    await page.locator(".cc-graph[data-layout-ready]").waitFor();
    assert.ok((await page.locator('.cc-graph-card .pg-metadata').innerText()).includes('自由探索'));
    assert.equal(await page.locator('.cc-graph-card .pg-controls button').count(), 4);
    const normalEdge = await page.locator('.cc-edge').first().evaluate(el => { const css=getComputedStyle(el);return {stroke:css.stroke,opacity:css.opacity,width:css.strokeWidth,expected:(()=>{const probe=document.createElement('span');probe.style.color='var(--mem-view-color-text-muted)';el.parentElement!.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;})()}; });
    assert.equal(normalEdge.stroke, normalEdge.expected); assert.equal(normalEdge.opacity, '1'); assert.equal(normalEdge.width, '1.5px');
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
    await page.reload(); await page.getByRole("button", { name: "产物视角" }).click(); await page.getByRole("button", { name: /尚未使用的资料/ }).waitFor();
    assert.equal(await page.locator("[data-artifact-id]").count(), 0); assert.equal(await page.locator(".cc-external").count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("exploration shares Run perspectives and keeps the selected Review and configuration during refresh", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {}), service = (await openContextControl(f.root, true))!;
  await runGit(["init", "-b", "master"], { cwd: f.root });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Embedded fixture"], { cwd: f.root });
  const configuration = join(f.root, "config.json");
  const project = JSON.parse(await readFile(configuration, "utf8"));
  await writeFile(configuration, JSON.stringify({ ...project, store: { type: "embedded", repository_path: f.root, memory_path: "memory" } }));
  const config = await readProjectConfig("test-project", f.home);
  const { ExplorationReviews } = await import("../src/context_control/exploration-review.js");
  const { freezeExplorationSchema } = await import("../src/context_control/exploration-contract.js");
  await mkdir(join(config.memoryRoot, "schemas"), { recursive: true });
  await mkdir(join(config.memoryRoot, "statements"), { recursive: true });
  await writeFile(join(config.memoryRoot, "schemas", "shared-report.yaml"), withCurrentMemorySyntax("!schema\nnames: [shared-report]\ntype: object\nformat: {layout: outline}\nfields: [Summary]\n"));
  const statement = join(config.memoryRoot, "statements", "review-fact.yaml");
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [review-fact]\nasserts: [Inspect the source]\n"));
  const run = await service.start("Shared exploration page");
  const draft = await service.enterExplorationSchema(run.id, { name: "Visible draft", contentType: "text/markdown",
    contract: await freezeExplorationSchema(config, "Visible draft", "shared-report", "text/markdown") });
  const { artifact, step } = await service.report(run.id, { name: "Exploration candidate", content: textContent("Candidate content") });
  await service.configureExplorationStep(run.id, step.id, { asserts: ["statements/review-fact"], reviewer: "runner" });
  const repository = new ExplorationReviews(service);
  const original = await repository.start(config, run.id, artifact.id);
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [review-fact]\nasserts: [Inspect the updated source]\nsuggests: [Follow the suggested check]\n"));
  await writeFile(join(config.memoryRoot, "statements", "later-fact.yaml"), withCurrentMemorySyntax("!statement\nnames: [later-fact]\nsuggests: [Keep the later edit]\n"));
  await repository.start(config, run.id, artifact.id);
  const browser = await browserScope(), server = createViewServer(config);
  let closing: Promise<void> | undefined;
  let resumeResponse!: () => void;
  const resume = new Promise<void>(resolve => { resumeResponse = resolve; });
  const close = () => closing ??= (async () => {
    resumeResponse();
    try { await browser.close(); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  })();
  f.beforeCleanup(close);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const runUrl = `${origin}/api/projects/test-project/runs/${run.id}`;
    const failed = await fetch(`${runUrl}/exploration/reviews/${draft.artifactId}`, { method: "POST", body: "{}" });
    assert.equal((await failed.json()).code, "INCOMPLETE_ARTIFACT");
    const unconfigured = (await service.report(run.id, { name: "Unconfigured", content: textContent("Unconfigured") })).artifact;
    const missing = await fetch(`${runUrl}/exploration/reviews/${unconfigured.id}`, { method: "POST", body: "{}" });
    assert.equal((await missing.json()).code, "REVIEWER_REQUIRED");
    assert.equal((await repository.list(run.id)).length, 2);
    const page = await browser.newPage();
    await page.goto(`${origin}/projects/test-project/tasks`);
    await page.locator(`[data-item-id="${run.id}"]`).click();
    await page.getByRole("button", { name: "流程视角" }).waitFor();
    await page.getByRole("button", { name: /Visible draft/ }).click();
    const dialog = page.locator('dialog.cc-dialog[open]');
    await dialog.getByText("执行信息", { exact: true }).click();
    await dialog.getByText("schemas/shared-report", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "产物视角" }).click();
    await page.locator(`[data-artifact-id="${artifact.id}"]`).click();
    const round = dialog.getByLabel("评审轮次");
    const id = `exploration-review-${run.id}__${original.id}`;
    await round.selectOption(id);
    await dialog.getByText("渐进评审节点", { exact: true }).click();
    await dialog.getByText("Inspect the source", { exact: true }).waitFor();
    await dialog.getByText("评审配置", { exact: true }).click();
    const input = dialog.getByLabel("建议 Statement（每行一个引用）");
    await input.fill("unsaved local configuration");
    const field = await input.elementHandle();
    await service.review(run.id, artifact.id, "human", ["new review comment"]);
    await page.getByRole("button", { name: "刷新", exact: true }).evaluate(el => (el as HTMLButtonElement).click());
    await dialog.getByText("new review comment", { exact: true }).waitFor();
    assert.equal(await field?.evaluate(node => node.isConnected), false);
    assert.equal(await input.inputValue(), "unsaved local configuration");
    assert.equal(await round.inputValue(), id);
    await dialog.getByText("Inspect the source", { exact: true }).waitFor();
    const gate = new EventEmitter();
    const configPath = `**/exploration/steps/${step.id}`;
    await page.route(configPath, async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const response = await route.fetch({ timeout: 10000 });
      gate.emit("response");
      await resume;
      await route.fulfill({ response });
    });
    const save = dialog.getByRole("button", { name: "保存配置" });
    try {
      await input.fill("statements/review-fact");
      const held = once(gate, "response", { signal: AbortSignal.any([t.signal, AbortSignal.timeout(10000)]) });
      await Promise.all([held, save.click()]);
      await input.fill("statements/later-fact");
    } finally { resumeResponse(); }
    await dialog.getByText("仍有未保存的编辑", { exact: true }).waitFor();
    assert.deepEqual((await service.explorationStep(run.id, step.id)).reviewConfiguration?.suggests, ["statements/review-fact"]);
    assert.equal(await input.inputValue(), "statements/later-fact");
    await page.unroute(configPath);
    await save.click();
    await dialog.getByText("配置已保存", { exact: true }).waitFor();
    assert.deepEqual((await service.explorationStep(run.id, step.id)).reviewConfiguration?.suggests, ["statements/later-fact"]);
    await page.route(`**/exploration/reviews/${artifact.id}`, async route => {
      const response = await route.fetch();
      const result = await response.json();
      await route.fulfill({ response, json: { ...result, warning: `Review saved. Resume dispatch with run review wait --review ${result.reviewId}` } });
    });
    await dialog.getByRole("button", { name: "发起评审" }).click();
    const warning = dialog.getByText(/Review saved\. Resume dispatch with run review wait/);
    await warning.waitFor();
    assert.match(await warning.innerText(), new RegExp(await round.inputValue()));
    assert.equal((await repository.list(run.id)).some(r => r.exploration?.configuration.suggests?.includes("statements/later-fact")), true);
    const failedReview = await round.inputValue();
    await page.route(`**/exploration/reviews/${failedReview}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), status: "running", attempt: {
        completion: { kind: "failed", failure: { stage: "prompt", code: "provider_exited", message: "Fixture reviewer exited" } }
      } } });
    });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(`[data-artifact-id="${artifact.id}"]`).click();
    await round.selectOption(failedReview);
    const diagnostic = dialog.getByText(/prompt \[provider_exited\] Fixture reviewer exited/);
    await diagnostic.waitFor({ state: "attached" });
    const nodes = dialog.getByText("渐进评审节点", { exact: true });
    if (!await nodes.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await nodes.click();
    await diagnostic.waitFor();
    await dialog.getByText(`memsphere run review retry --review ${failedReview}`, { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await page.locator("dialog.cc-dialog[open]").count(), 0);
  } finally { await close(); }
});
