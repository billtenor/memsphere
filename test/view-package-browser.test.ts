import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import type { MemsphereConfig } from "../src/config.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";

test("trusted local Package replaces Memory and Run through formal composition and appears in Settings", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-view-package-browser-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const memoryRoot = join(projectRoot, "memory");
  const runsRoot = join(projectRoot, "runs");
  const packageRoot = resolve("examples/view-packages/dsh-custom-view");
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(runsRoot, { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  const grants = ["theme.override", "styles.scoped", "styles.global"] as const;
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot, allow: grants }] },
    view_theme: { mode: "dark" }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "test" },
    view: {
      packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true, allow: grants }],
      theme: { selected_source: "org.example.memsphere.custom-view:sea-glass" }
    }
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
    viewPackages: { installed: [{ path: packageRoot, allow: [...grants] }] },
    viewTheme: { mode: "dark" },
    project: {
      name: "demo", store: { type: "managed", branch: "master", published_revision: "test" }, mounted: [],
      view: {
        packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true, allow: [...grants] }],
        theme: { selected_source: "org.example.memsphere.custom-view:sea-glass" }
      }
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
    if (process.env.MEMSPHERE_CAPTURE_VIEW_PACKAGE === "1") {
      await page.screenshot({ path: resolve("changes/active/20260905-view-package-customization/memory-custom-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve("changes/active/20260905-view-package-customization/memory-custom-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    await page.goto(`${origin}/projects/demo/tasks`);
    await page.getByText("My Run workspace", { exact: true }).waitFor();

    await page.goto(`${origin}/projects/demo/settings/composition`);
    await page.getByText("org.example.memsphere.custom-view@1.0.0", { exact: true }).waitFor();
    await page.getByText("当前运行诊断", { exact: true }).waitFor();

    const disabledConfig = structuredClone(config) as MemsphereConfig;
    (disabledConfig.project!.view!.packages[0] as { enabled: boolean }).enabled = false;
    disabledServer = createViewServer(disabledConfig);
    await new Promise<void>((resolveListen, reject) => {
      disabledServer!.once("error", reject);
      disabledServer!.listen(0, "127.0.0.1", resolveListen);
    });
    const disabledOrigin = `http://127.0.0.1:${(disabledServer.address() as AddressInfo).port}`;
    await page.goto(`${disabledOrigin}/projects/demo/memories`);
    await page.locator(".memory-detail-surface").waitFor();
    assert.equal(await page.locator("[data-custom-showcase]").count(), 0);
    assert.equal(await page.locator('style[data-view-package-scope]').count(), 0);
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
  const packageRoot = resolve("examples/view-packages/dsh-custom-view");
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
    await page.locator('.settings-detail-surface [data-action="validate"]').click();
    await page.locator('.settings-detail-surface [data-action="save"]').waitFor();
    await page.locator('.settings-detail-surface [data-action="save"]').click();
    await page.locator('.settings-detail-surface [data-action="validate"]').waitFor();
  };
  let active: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    active = await launch();
    await page.goto(`${active.origin}/projects/demo/settings/packages`);
    await page.locator("#settings-package-path").fill(packageRoot);
    await page.locator('[data-action="add-view-package"]').click();
    await save();
    await stop(active.server); active = undefined;
    assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).view_packages.installed[0].path, packageRoot);

    active = await launch();
    await page.goto(`${active.origin}/projects/demo/settings/packages`);
    await page.getByText("org.example.memsphere.custom-view@1.0.0", { exact: true }).waitFor();
    for (const capability of ["theme.override", "styles.scoped", "styles.global"]) {
      await page.locator(`[data-home-view-capability="${capability}"]`).check();
    }
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
    await page.locator('[data-project-view-package="org.example.memsphere.custom-view@1.0.0"]').check();
    for (const capability of ["theme.override", "styles.scoped", "styles.global"]) {
      await page.locator(`[data-project-view-capability="${capability}"]`).check();
    }
    await page.locator('[data-select-field="project_view.theme"]').click();
    await page.locator('[data-select-option="project_view.theme"][data-value="org.example.memsphere.custom-view:sea-glass"]').click();
    await save();
    await stop(active.server); active = undefined;
    const project = JSON.parse(await readFile(join(projectRoot, "config.json"), "utf8"));
    assert.equal(project.view.packages[0].enabled, true);
    assert.deepEqual(new Set(project.view.packages[0].allow), new Set(["theme.override", "styles.scoped", "styles.global"]));
    assert.deepEqual(project.view.theme, { selected_source: "org.example.memsphere.custom-view:sea-glass" });

    active = await launch();
    await page.goto(`${active.origin}/projects/demo/memories`);
    await page.getByText("My Memory workspace", { exact: true }).waitFor();
  } finally {
    if (active) await stop(active.server);
    await browser.close();
  }
});
