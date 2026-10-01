import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import type { MemsphereConfig } from "../src/config.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";

test("trusted local Package replaces Memory and Run through formal composition and appears in Settings", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-view-package-browser-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const memoryRoot = join(projectRoot, "memory");
  const runsRoot = join(projectRoot, "runs");
  const packageRoot = join(temporary, "copied-custom-view");
  await cp(resolve("examples/view-packages/custom-view-showcase"), packageRoot, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(runsRoot, { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_theme: { mode: "dark", selected_source: "org.example.memsphere.custom-view:sea-glass" },
    view_composition: { packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true }] }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "test" }
  }));
  await writeFile(join(home, "registry.json"), JSON.stringify({
    format_version: 1,
    projects: { demo: { root: projectRoot } },
    workspaces: {}
  }));
  const config: MemsphereConfig = {
    configPath: join(projectRoot, "config.json"), scopeRoot: projectRoot, homeRoot: home,
    language: "en", memoryRoot, runsRoot, archiveRoot: join(projectRoot, "archives"),
    debug: { agentReview: false, root: join(home, ".runtime", "debug") },
    view: { host: "127.0.0.1", port: 0 },
    viewPackages: { installed: [{ path: packageRoot }] },
    viewTheme: { mode: "dark", selected_source: "org.example.memsphere.custom-view:sea-glass" },
    viewComposition: { packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true }] },
    project: {
      name: "demo", store: { type: "managed", branch: "master", published_revision: "test" }, mounted: []
    }
  };
  const server = createViewServer(config);
  let disabledServer: ReturnType<typeof createViewServer> | undefined;
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${origin}/projects/demo/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-custom-showcase=memory]").count(), 1);
    assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
    assert.equal(await page.locator("[data-custom-showcase=memory]").evaluate(node => getComputedStyle(node).getPropertyValue("--mem-view-color-accent").trim()), "#71d2c6");
    assert.equal(await page.locator('style[data-view-package-scope="global"]').count(), 1);
    assert.equal(await page.locator('style[data-view-package-scope="module"]').count(), 1);
    assert.equal(await page.evaluate(() => {
      const scoped = document.querySelector('style[data-view-package-scope="module"]');
      const global = document.querySelector('style[data-view-package-scope="global"]');
      return Boolean(scoped && global && (scoped.compareDocumentPosition(global) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true, "global Package styles stay after Module styles in document order");
    if (process.env.MEMSPHERE_CAPTURE_VIEW_PACKAGE === "1") {
      await page.screenshot({ path: resolve("changes/active/20260905-view-package-customization/memory-custom-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve("changes/active/20260905-view-package-customization/memory-custom-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    await page.goto(`${origin}/projects/demo/tasks`);
    await page.getByText("My Run workspace", { exact: true }).waitFor();

    await page.goto(`${origin}/projects/demo/settings/appearance`);
    await page.getByText("org.example.memsphere.custom-view@1.0.0", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("Appearance & Themes", { exact: true }).count() > 0, true);
    assert.equal(await page.getByText("界面 Package", { exact: true }).count(), 0);
    assert.equal(await page.getByText("界面组合", { exact: true }).count(), 0);
    assert.equal(await page.getByText("当前运行诊断", { exact: true }).count(), 0);
    assert.equal(await page.getByText(/running [0-9a-f]+ · disk [0-9a-f]+/).count(), 0);

    const disabledConfig = structuredClone(config) as MemsphereConfig;
    (disabledConfig.viewComposition!.packages[0] as { enabled: boolean }).enabled = false;
    disabledServer = createViewServer(disabledConfig);
    await new Promise<void>((resolveListen, reject) => {
      disabledServer!.once("error", reject);
      disabledServer!.listen(0, "127.0.0.1", resolveListen);
    });
    const disabledOrigin = `http://127.0.0.1:${(disabledServer.address() as AddressInfo).port}`;
    await page.goto(`${disabledOrigin}/projects/demo/memories`);
    await page.locator(".memory-detail-surface").waitFor();
    const disabledBoot = await page.locator("#memsphere-view-boot").textContent().then(text => JSON.parse(text ?? "{}"));
    assert.equal(disabledBoot.instances.some((instance: { themes?: Array<{ selected?: boolean }> }) => instance.themes?.some(theme => theme.selected)), true);
    const disabledDiagnostics = await page.evaluate(() => (window as Window & { __memsphereViewDiagnostics(): { instances: Array<{ module: { moduleId: string }; status: string; message?: string }> } }).__memsphereViewDiagnostics());
    assert.deepEqual(disabledDiagnostics.instances.filter(instance => instance.module.moduleId === "org.example.memsphere.custom-view").map(instance => ({ status: instance.status, message: instance.message })), [{ status: "active", message: undefined }]);
    assert.equal(await page.locator("[data-custom-showcase]").count(), 0);
    assert.equal(await page.locator('style[data-view-package-scope]').count(), 0);
    assert.equal(await page.locator("[data-view-shell]").evaluate(node => getComputedStyle(node).getPropertyValue("--mem-view-color-accent").trim()), "#71d2c6");
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    if (disabledServer) await new Promise<void>(resolveClose => disabledServer!.close(() => resolveClose()));
  }
});

test("Settings completes the local Package installation and Project enablement flow", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-view-package-settings-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const packageRoot = resolve("examples/view-packages/custom-view-showcase");
  await mkdir(join(projectRoot, "memory"), { recursive: true });
  await mkdir(join(projectRoot, "runs"), { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({ view: { host: "127.0.0.1", port: 0 } }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date(0).toISOString() }));
  await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root: projectRoot } }, workspaces: {} }));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  const launch = async () => {
    const config = await readProjectConfig("demo", home);
    const server = createViewServer(config);
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  const stop = (server: ReturnType<typeof createViewServer>) => new Promise<void>(resolveClose => server.close(() => resolveClose()));
  const save = async () => {
    await page.locator('.settings-detail-surface [data-action="save-appearance"]').click();
    await page.waitForFunction(() => !document.querySelector("#settings-status-appearance")?.textContent?.includes("未保存"));
  };
  let active: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    active = await launch();
    await page.goto(`${active.origin}/projects/demo/settings/appearance`);
    assert.equal(await page.locator(".settings-scope-heading").count(), 0);
    assert.equal(await page.locator(".settings-appearance-intro").count(), 0);
    await page.locator("#settings-package-path").fill(packageRoot);
    await page.locator('[data-action="add-view-package"]').click();
    await save();
    await page.getByText(/重启/).first().waitFor();
    await page.getByText("界面组合已保存，当前服务仍使用启动快照；请执行 memsphere view restart 后生效。", { exact: true }).waitFor();
    const pendingInstall = await page.evaluate(async () => (await fetch("/api/settings/global")).json());
    assert.equal(pendingInstall.restartPending, true);
    assert.notEqual(pendingInstall.composition.runningDigest, pendingInstall.composition.diskDigest);
    await page.goto(`${active.origin}/projects/demo/memories`);
    await page.locator(".memory-detail-surface").waitFor();
    assert.equal(await page.locator("[data-custom-showcase]").count(), 0);
    await stop(active.server); active = undefined;
    assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).view_packages.installed[0].path, packageRoot);

    active = await launch();
    await page.goto(`${active.origin}/projects/demo/settings/packages`);
    await page.getByText("界面与主题", { exact: true }).first().waitFor();
    await page.getByText("org.example.memsphere.custom-view@1.0.0", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("权限设置", { exact: true }).count(), 0);
    await page.locator('[data-select-field="view_theme.mode"]').click();
    await page.locator('[data-select-option="view_theme.mode"][data-value="dark"]').click();
    await page.locator('[data-select-field="view_theme.selected_source"]').click();
    await page.locator('[data-select-option="view_theme.selected_source"][data-value="org.example.memsphere.custom-view:sea-glass"]').click();
    await save();
    await stop(active.server); active = undefined;
    const homeConfig = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    assert.deepEqual(homeConfig.view_theme, {
      mode: "dark",
      selected_source: "org.example.memsphere.custom-view:sea-glass"
    });

    active = await launch();
    await page.goto(`${active.origin}/projects/demo/settings/composition`);
    await page.getByText("安装新扩展包", { exact: true }).waitFor();
    await page.getByText("已安装扩展包（1）", { exact: true }).waitFor();
    await page.getByText("已安装", { exact: true }).waitFor();
    await page.getByRole("button", { name: "卸载", exact: true }).waitFor();
    await page.getByText("主题配置", { exact: true }).waitFor();
    await page.getByText("界面配置", { exact: true }).waitFor();
    await page.getByText("全局样式", { exact: true }).waitFor();
    await page.getByText("记忆模块 / 整体页面", { exact: true }).waitFor();
    await page.getByText("记忆模块 / 详情正文", { exact: true }).waitFor();
    await page.getByText("运行模块 / 整体页面", { exact: true }).waitFor();
    await page.getByText("运行模块 / 产物正文", { exact: true }).waitFor();
    for (const label of ["公共组件 / 内容画布", "公共组件 / 流程展示", "公共组件 / 折叠字段"]) {
      await page.getByText(label, { exact: true }).waitFor();
    }
    assert.equal(await page.locator(".settings-config-table").first().locator("tbody tr").count(), 20);
    assert.equal(await page.getByText("暂无可选扩展，使用系统默认", { exact: true }).count(), 15);
    assert.equal(await page.locator(".settings-select-disabled").count(), 15);
    assert.equal(await page.getByRole("button", { name: "保存", exact: true }).count(), 1);
    assert.equal(await page.locator('[data-select-field="project_view.theme"]').count(), 0);
    assert.equal(await page.getByText(/^[123]\. /).count(), 0);
    assert.equal(await page.locator("[data-project-view-package]").count(), 0);
    const finalSlotSelect = page.getByRole("combobox", { name: "选择运行模块 / 产物正文使用的内容" });
    await finalSlotSelect.click();
    const finalSlotMenu = finalSlotSelect.locator("xpath=following-sibling::*[contains(@class, 'settings-select-menu')]");
    assert.equal(await finalSlotMenu.getAttribute("data-placement"), "top");
    assert.equal(await finalSlotMenu.isVisible(), true);
    const finalMenuGeometry = await finalSlotMenu.evaluate(node => {
      const menu = node.getBoundingClientRect();
      const trigger = node.previousElementSibling!.getBoundingClientRect();
      const table = node.closest(".settings-table-wrap")!.getBoundingClientRect();
      return { aboveTrigger: menu.bottom <= trigger.top, insideTable: menu.top >= table.top && menu.bottom <= table.bottom };
    });
    assert.deepEqual(finalMenuGeometry, { aboveTrigger: true, insideTable: true });
    await finalSlotSelect.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.body.scrollWidth), await page.evaluate(() => document.documentElement.clientWidth));
    const tableWidths = await page.locator(".settings-table-wrap").first().evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
    assert.equal(tableWidths.client < tableWidths.scroll, true);
    await page.setViewportSize({ width: 1280, height: 800 });
    const initialGlobalStyles = page.locator('[data-multiselect-field="styles.global@1"]');
    assert.equal(await initialGlobalStyles.locator("[data-multiselect-summary]").innerText(), "未选择");
    await page.locator('[data-apply-view-package="org.example.memsphere.custom-view@1.0.0"]').click();
    await page.getByText(/已选用 org\.example\.memsphere\.custom-view/).waitFor();
    const globalStyles = page.locator('[data-multiselect-field="styles.global@1"]');
    assert.equal(await globalStyles.locator("[data-multiselect-summary]").innerText(), "org.example.memsphere.custom-view · shared");
    await globalStyles.locator("summary").click();
    const sharedStyle = globalStyles.locator('[data-project-view-slot-list="styles.global@1"]');
    assert.equal(await sharedStyle.isChecked(), true);
    await sharedStyle.uncheck();
    assert.equal(await globalStyles.getAttribute("open"), "");
    assert.equal(await globalStyles.locator("[data-multiselect-summary]").innerText(), "未选择");
    await sharedStyle.check();
    await sharedStyle.press("Escape");
    assert.equal(await globalStyles.getAttribute("open"), null);
    await save();
    await page.getByText(/重启/).first().waitFor();
    await page.getByText("界面组合已保存，当前服务仍使用启动快照；请执行 memsphere view restart 后生效。", { exact: true }).waitFor();
    const pendingComposition = await page.evaluate(async () => (await fetch("/api/settings/global")).json());
    assert.equal(pendingComposition.restartPending, true);
    assert.notEqual(pendingComposition.composition.runningDigest, pendingComposition.composition.diskDigest);
    await page.goto(`${active.origin}/projects/demo/memories`);
    await page.locator(".memory-detail-surface").waitFor();
    assert.equal(await page.locator("[data-custom-showcase]").count(), 0);
    await stop(active.server); active = undefined;
    const savedHome = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    assert.equal(savedHome.view_composition.packages[0].enabled, true);
    assert.equal(Object.keys(savedHome.view_composition.slots).length, 5);
    assert.deepEqual(savedHome.view_composition.slots["styles.global@1"], ["org.example.memsphere.custom-view:org.example.memsphere.custom-view:shared"]);
    assert.equal(savedHome.view_composition.styles, undefined);
    assert.equal(JSON.parse(await readFile(join(projectRoot, "config.json"), "utf8")).view, undefined);

    active = await launch();
    await page.goto(`${active.origin}/projects/demo/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
    assert.equal(await page.locator('style[data-view-package-scope="module"]').count(), 1);
    assert.equal(await page.locator('style[data-view-package-scope="global"]').count(), 1);
  } finally {
    if (active) await stop(active.server);
    await browser.close();
  }
});

test("real Run Artifact uses a custom renderer and restores the official body when disabled", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-view-run-artifact-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const packageRoot = join(temporary, "artifact-package");
  const runId = "run-custom-artifact";
  const runRoot = join(projectRoot, "runs", runId);
  await mkdir(join(projectRoot, "memory"), { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await mkdir(runRoot, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "module.json"), JSON.stringify({
    schemaVersion: 1,
    id: "org.example.run-artifact-only",
    version: "1.0.0",
    view: {
      entry: "./index.js",
      sdk: "^1.0.0",
      contributions: [{ id: "artifact", cell: "org.memsphere.run.artifact.renderer@1:artifact", priority: 100 }]
    }
  }));
  await writeFile(join(packageRoot, "index.js"), `
    import { portableSlots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots"], apply(context) {
      context.slots.register(portableSlots.runArtifactRenderer, { id: "artifact", key: "artifact", priority: 999, value: {
        render(input) { const node = document.createElement("pre"); node.dataset.customArtifact = "true"; node.textContent = input.content; return node; }
      }});
    }};
  `);
  await writeFile(join(runRoot, `${runId}.json`), JSON.stringify({
    contractVersion: 2,
    memorySyntax: currentMemorySyntax,
    id: runId,
    name: "Artifact renderer fixture",
    status: "done",
    procedureName: "Artifact renderer fixture",
    memoryRoot: join(projectRoot, "memory"),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    stack: [],
    events: [{
      at: new Date(0).toISOString(),
      frame: "procedure",
      stepId: "flow[1]",
      artifact: {
        name: "result",
        type: "string",
        format: { name: "markdown", options: {} },
        storage: "inline",
        value: "actual artifact body"
      }
    }]
  }));
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_composition: { packages: [{ id: "org.example.run-artifact-only", version: "1.0.0", enabled: true }] }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date(0).toISOString() }));
  await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root: projectRoot } }, workspaces: {} }));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const launch = async () => {
    const server = createViewServer(await readProjectConfig("demo", home));
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  let active: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    active = await launch();
    await page.goto(`${active.origin}/projects/demo/tasks/${runId}`);
    await page.locator("[data-custom-artifact=true]").waitFor({ state: "attached" });
    assert.equal(await page.locator("[data-custom-artifact=true]").count(), 1, JSON.stringify({
      body: await page.locator("body").innerText(),
      diagnostics: await page.evaluate(() => (window as any).__memsphereViewDiagnostics?.())
    }));
    assert.equal(await page.locator("[data-custom-artifact=true]").textContent(), "actual artifact body");
    await new Promise<void>(resolveClose => active!.server.close(() => resolveClose())); active = undefined;

    await writeFile(join(home, "config.json"), JSON.stringify({
      view: { host: "127.0.0.1", port: 0 },
      view_packages: { installed: [{ path: packageRoot }] },
      view_composition: { packages: [{ id: "org.example.run-artifact-only", version: "1.0.0", enabled: false }] }
    }));
    active = await launch();
    await page.goto(`${active.origin}/projects/demo/tasks/${runId}`);
    await page.locator(".artifact-review-artifact-content").waitFor({ state: "attached" });
    await page.locator("details.task-result > summary").first().click();
    await page.locator(".artifact-review-artifact-content").waitFor();
    assert.equal(await page.locator("[data-custom-artifact]").count(), 0);
    await page.getByText("actual artifact body", { exact: true }).waitFor();
  } finally {
    await browser.close();
    if (active) await new Promise<void>(resolveClose => active!.server.close(() => resolveClose()));
  }
});

test("global composition applies to every Project and stays frozen across disk changes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-view-package-snapshot-"));
  const home = join(temporary, "home");
  const packageRoot = resolve("examples/view-packages/custom-view-showcase");
  const roots = { a: join(home, "projects", "a"), b: join(home, "projects", "b") };
  for (const [name, root] of Object.entries(roots)) {
    await mkdir(join(root, "memory"), { recursive: true });
    await mkdir(join(root, "runs"), { recursive: true });
    await mkdir(join(root, "archives"), { recursive: true });
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name, created_at: new Date(0).toISOString() }));
  }
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_composition: { packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true }] }
  }));
  await writeFile(join(roots.a, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
  await writeFile(join(roots.b, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
  await writeFile(join(home, "registry.json"), JSON.stringify({
    format_version: 1,
    projects: { a: { root: roots.a }, b: { root: roots.b } },
    workspaces: {}
  }));
  const server = createViewServer(await readProjectConfig("a", home));
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/projects/a/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
    await page.goto(`${origin}/projects/b/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();

    await writeFile(join(home, "config.json"), JSON.stringify({
      view: { host: "127.0.0.1", port: 0 },
      view_packages: { installed: [{ path: packageRoot }] },
      view_composition: { packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: false }] }
    }));

    await page.goto(`${origin}/projects/b/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
    const bDiagnostics = await page.evaluate(async () => (await fetch("/api/projects/b/settings/view-packages")).json());
    assert.equal(bDiagnostics.composition.restartPending, true);

    await page.goto(`${origin}/projects/a/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
    const aDiagnostics = await page.evaluate(async () => (await fetch("/api/projects/a/settings/view-packages")).json());
    assert.equal(aDiagnostics.composition.restartPending, true);
    assert.equal(aDiagnostics.composition.runningDigest, bDiagnostics.composition.runningDigest);

    await writeFile(join(home, "registry.json"), JSON.stringify({
      format_version: 1,
      projects: { a: { root: roots.a } },
      workspaces: {}
    }));
    const removed = await page.goto(`${origin}/projects/b/memories`);
    assert.equal(removed?.status(), 404);
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: {}, workspaces: {} }));
    const removedStartup = await page.goto(`${origin}/projects/a/memories`);
    assert.equal(removedStartup?.status(), 404);
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});
