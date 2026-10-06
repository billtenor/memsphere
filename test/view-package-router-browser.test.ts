import { browserScope } from "./helpers/browser.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";

const moduleId = "com.example.crawler";
const plugin = `
import { defineViewPlugin, slots } from "@memsphere/view-sdk";
export default defineViewPlugin({
  apiVersion: 1, inject: ["slots", "router", "ui"], uiVersion: 1,
  apply(ctx, config) {
    const route = ctx.router.register({ id: "run", path: config.path ?? "/crawler/run", query: ["source"] });
    if (config.conflict) ctx.router.register({ id: "duplicate", path: "/crawler/run" });
    ctx.slots.register(slots.navigationPrimary, { id: "navigation", value: {
      label: { text: "Crawler" }, icon: { kind: "system", name: "stack" }, route: route.to()
    } });
    ctx.slots.register(slots.headerTitle, { id: "title", when: route.activation, value: { title: { text: "Crawler runs" } } });
    ctx.slots.register(slots.contentList, { id: "list", when: route.activation, value: ctx.ui.contentList(context => ({
      label: { text: "Crawler sources" }, empty: { title: { text: "No sources" } },
      sections: [{ id: "sources", items: ["alpha", "beta"].map(id => ({
        id, title: { text: "Source " + id }, selected: context.route.query.source === id,
        route: route.to({}, { query: { source: id } })
      })) }]
    })) });
    ctx.slots.register(slots.mainView, { id: "page", key: route.key, when: route.activation, value: {
      mount({ element }, context) {
        const label = document.createElement("p"); label.dataset.crawlerSource = "";
        const link = ctx.ui.button({ label: { text: "Related beta" }, run: () => ctx.router.navigate(route.to({}, { query: { source: "beta" } })) });
        const update = next => { label.textContent = "Current source: " + (next.route.query.source ?? "none"); };
        update(context); element.append(label, link);
        return () => element.replaceChildren();
      }
    } });
  }
});`;

async function fixture(capability = true, enabled = true, config: Record<string, unknown> = {}, installed = true, entry = "./index.js", source = plugin) {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-external-router-"));
  const home = join(temporary, "home");
  const root = join(home, "projects", "demo");
  const packageRoot = join(temporary, "crawler");
  for (const directory of [packageRoot, ...["memory", "runs", "archives"].map(name => join(root, name))]) {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(join(packageRoot, "module.json"), JSON.stringify({
    schemaVersion: 1, id: moduleId, version: "0.1.0", view: {
      entry, sdk: "^1.0.0", capabilities: capability ? ["router.register"] : [],
      contributions: [
        { id: "navigation", cell: "navigation.primary@1:navigation", priority: 100 },
        { id: "title", cell: "header.title@1:title", priority: 100 },
        { id: "list", cell: "content.list@1:list", priority: 100 },
        { id: "page", cell: "main.view@1:route:run", priority: 100 }
      ]
    }
  }));
  await writeFile(join(packageRoot, "index.js"), source);
  if (entry === "./index.txt") await writeFile(join(packageRoot, "index.txt"), source);
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 }, view_packages: { installed: installed ? [{ path: packageRoot }] : [] },
    view_composition: { packages: installed ? [{ id: moduleId, version: "0.1.0", instance_id: "crawler-one", enabled, config }] : [] }
  }));
  await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date(0).toISOString() }));
  await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
  await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root } }, workspaces: {} }));
  let server = createViewServer(await readProjectConfig("demo", home));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { get origin() { return origin; }, packageRoot, async restart() {
    await new Promise<void>(resolve => server.close(() => resolve()));
    server = createViewServer(await readProjectConfig("demo", home));
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, path: "/projects/demo/modules/crawler-one/crawler/run", async close() {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  } };
}

async function diagnostics(page: import("playwright").Page) {
  await page.waitForFunction(() => document.documentElement.dataset.viewHostState === "ready");
  return page.evaluate(() => (window as Window & { __memsphereViewDiagnostics(): {
    instances: Array<{ module: { moduleId: string }; status: string; message?: string }>;
    routes: Array<{ path: string }>;
  } }).__memsphereViewDiagnostics());
}

test("external Router capability supports independent pages, selection, links and browser history", async () => {
  const app = await fixture(true, true, {}, false);
  const browser = await browserScope();
  const page = await browser.newPage();
  try {
    assert.equal((await fetch(app.origin + app.path)).status, 404);
    const settings = await (await fetch(app.origin + "/api/settings/global")).json();
    settings.config.view_packages = { installed: [{ path: app.packageRoot }] };
    settings.config.view_composition = { packages: [{ id: moduleId, version: "0.1.0", instance_id: "crawler-one", enabled: true }] };
    const body = JSON.stringify({ expectedRevision: settings.diskRevision, config: settings.config });
    const headers = { "content-type": "application/json", origin: app.origin, "sec-fetch-site": "same-origin" };
    assert.equal((await fetch(app.origin + "/api/settings/global/validate", { method: "POST", headers, body })).status, 200);
    assert.equal((await fetch(app.origin + "/api/settings/global", { method: "PUT", headers, body })).status, 200);
    assert.equal((await fetch(app.origin + app.path)).status, 404, "saved config waits for restart");
    await app.restart();
    assert.equal((await page.goto(app.origin + app.path + "?source=alpha"))?.status(), 200);
    await page.getByText("Current source: alpha", { exact: true }).waitFor();
    const snapshot = await diagnostics(page);
    assert.equal(snapshot.instances.find(instance => instance.module.moduleId === moduleId)?.status, "active");
    assert.equal(snapshot.routes.some(route => route.path === app.path), true);
    await page.getByText("Source beta", { exact: true }).click();
    await page.getByText("Current source: beta", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, "?source=beta");
    await page.goBack();
    await page.getByText("Current source: alpha", { exact: true }).waitFor();
    await page.goForward();
    await page.getByText("Current source: beta", { exact: true }).waitFor();
    assert.equal((await page.reload())?.status(), 200);
    await page.getByText("Current source: beta", { exact: true }).waitFor();
    await page.getByText("Source alpha", { exact: true }).click();
    await page.getByRole("button", { name: "Related beta", exact: true }).click();
    await page.getByText("Current source: beta", { exact: true }).waitFor();
    await page.goto(app.origin + "/projects/demo");
    await diagnostics(page);
    await page.getByText("Crawler", { exact: true }).click();
    await page.getByText("Current source: none", { exact: true }).waitFor();
    for (const path of ["/projects/demo/modules/crawler-one-other/crawler/run", "/projects/demo/modules/missing/crawler/run", "/projects/demo/crawler/run", "/projects/unknown/modules/crawler-one/crawler/run"]) {
      assert.equal((await fetch(app.origin + path)).status, 404, path);
    }
    assert.equal((await page.goto(app.origin + "/projects/demo/modules/crawler-one/unknown"))?.status(), 200);
    await page.getByText(/No View Route matches/).waitFor();
  } finally { await browser.close(); await app.close(); }
});

test("external Router requires a declared capability and an enabled instance", async () => {
  for (const [capability, enabled] of [[false, true], [true, false]]) {
    const app = await fixture(capability, enabled);
    const browser = await browserScope();
    const page = await browser.newPage();
    try {
      assert.equal((await fetch(app.origin + app.path)).status, 404);
      await page.goto(app.origin + "/projects/demo");
      const snapshot = await diagnostics(page);
      const instance = snapshot.instances.find(instance => instance.module.moduleId === moduleId);
      if (enabled) {
        assert.equal(instance?.status, "failed");
        assert.match(instance?.message ?? "", /without an effective capability grant: router/);
      } else assert.equal(instance, undefined);
      assert.equal(snapshot.routes.some(route => route.path === app.path), false);
    } finally { await browser.close(); await app.close(); }
  }
});

test("external Router rejects conflicting and escaping routes atomically", async () => {
  for (const config of [{ conflict: true }, ...["/./outside", "/%2e/outside", "/../outside", "/%2e%2e/outside", "/back\\slash", "/%2foutside", "/%5coutside", "/%00outside", "/%zzoutside"].map(path => ({ path }))]) {
    const app = await fixture(true, true, config);
    const browser = await browserScope();
    const page = await browser.newPage();
    try {
      assert.equal((await page.goto(app.origin + app.path))?.status(), 200);
      const snapshot = await diagnostics(page);
      const instance = snapshot.instances.find(instance => instance.module.moduleId === moduleId);
      assert.equal(instance?.status, "failed");
      assert.match(instance?.message ?? "", /conflict|safe relative path|invalid encoding/i);
      assert.equal(snapshot.routes.some(route => route.path.includes("/modules/crawler-one")), false);
      await page.getByText(/No View Route matches/).waitFor();
      assert.equal((await fetch(app.origin + "/projects/demo/memories")).status, 200);
    } finally { await browser.close(); await app.close(); }
  }
});


test("external Router entry failures return 404 before granting a namespace", async () => {
  for (const entry of ["./missing.js", "./index.txt"]) {
    const app = await fixture(true, true, {}, true, entry);
    const browser = await browserScope();
    const page = await browser.newPage();
    try {
      assert.equal((await fetch(app.origin + app.path)).status, 404, entry);
      await page.goto(app.origin + "/projects/demo");
      const snapshot = await diagnostics(page);
      const boot = JSON.parse(await page.locator("#memsphere-view-boot").textContent() ?? "{}");
      const instance = boot.instances.find((value: { module: { moduleId: string } }) => value.module.moduleId === moduleId);
      if (entry === "./index.txt") {
        assert.match(instance?.loadError ?? "", /asset type is not allowed/);
        assert.equal(instance.allowedServices, undefined);
        assert.equal(snapshot.instances.find(value => value.module.moduleId === moduleId)?.status, "failed");
      } else {
        assert.equal(instance, undefined, "missing entry is rejected by the Package resolver");
        const settings = await (await fetch(app.origin + "/api/settings/view-packages")).json();
        assert.equal(settings.diagnostics.some((value: { state: string }) => value.state === "invalid"), true);
      }
      assert.equal(snapshot.routes.some(value => value.path.includes("/modules/crawler-one")), false);
    } finally { await browser.close(); await app.close(); }
  }
});

test("external Router browser import failure retains Shell and reports failed instance", async () => {
  const app = await fixture(true, true, {}, true, "./index.js", "export { invalid syntax");
  const browser = await browserScope();
  const page = await browser.newPage();
  try {
    assert.equal((await page.goto(app.origin + app.path))?.status(), 200);
    const snapshot = await diagnostics(page);
    const instance = snapshot.instances.find(value => value.module.moduleId === moduleId);
    assert.equal(instance?.status, "failed");
    assert.match(instance?.message ?? "", /bundle could not be imported/i);
    assert.equal(snapshot.routes.some(value => value.path.includes("/modules/crawler-one")), false);
    await page.getByText(/No View Route matches/).waitFor();
  } finally { await browser.close(); await app.close(); }
});
