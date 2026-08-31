import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const sdkSource = await browserModule("../src/view/view-sdk.ts");
const runtimeSource = await browserModule("../src/view/view-runtime.ts");

test("ViewHost applies instances in catalog order and isolates one failed instance", async () => {
  const instances: ViewHostBootInstance[] = [
    bootInstance("org.memsphere.memory", "memory", "/memory.js", "/"),
    bootInstance("org.memsphere.broken", "broken", "/broken.js", "/"),
    bootInstance("org.memsphere.settings", "settings", "/settings.js", "/")
  ];
  const bundles = new Map([
    ["/memory.js", routedPlugin("memory", "/memories", "Memory")],
    ["/broken.js", `
      export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
        window.__compositionOrder.push("broken");
        context.lifecycle.own(() => window.__compositionOrder.push("broken:rollback"));
        context.router.register({ id: "broken", path: "/broken" });
        throw new Error("broken apply");
      }};
    `],
    ["/settings.js", routedPlugin("settings", "/settings", "Settings")]
  ]);

  await withPage(renderViewHostHtml("en", instances), bundles, async page => {
    await page.addInitScript(() => {
      (window as Window & { __compositionOrder: string[] }).__compositionOrder = [];
    });
  }, async page => {
    await page.locator("#active-composed-view").waitFor();
    assert.equal(await page.locator("#active-composed-view").textContent(), "Memory");
    assert.deepEqual(await page.evaluate(() => (
      window as Window & { __compositionOrder: string[] }
    ).__compositionOrder), ["memory", "broken", "broken:rollback", "settings", "memory:mount"]);
    assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
  }, "/memories");
});

test("a failed builtin route renders a local retry diagnostic while the Shell stays ready", async () => {
  const broken = bootInstance("org.memsphere.broken", "broken", "/broken.js", "/");
  const settings = bootInstance("org.memsphere.settings", "settings", "/settings.js", "/");
  const instances: ViewHostBootInstance[] = [
    { ...broken, routeGrants: [{ id: "index", path: "/broken" }] },
    { ...settings, routeGrants: [{ id: "index", path: "/settings" }] }
  ];
  const bundles = new Map([
    ["/broken.js", "export default { apiVersion: 1, inject: ['router'], apply() { throw new Error('broken import contract'); } };"],
    ["/settings.js", compositionPlugin("settings")]
  ]);
  await withPage(renderViewHostHtml("en", instances), bundles, undefined, async page => {
    await page.locator('[data-view-failed-module="org.memsphere.broken"]').waitFor();
    assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
    assert.match(await page.locator(".view-host-module-error").innerText(), /broken import contract/);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#settings-view").waitFor();
  }, "/broken");
});

test("Shell navigation composes main/header descriptors and browser back restores the route", async () => {
  const memory = bootInstance("org.memsphere.memory", "memory", "/memory.js", "/");
  const instances: ViewHostBootInstance[] = [
    {
      ...memory,
      routeGrants: [
        { id: "index", path: "/memories", aliases: ["/"] },
        { id: "detail", path: "/memories/:kind" }
      ]
    },
    {
      ...bootInstance("org.memsphere.settings", "settings", "/settings.js", "/"),
      routeGrants: [{ id: "index", path: "/settings" }]
    }
  ];
  const bundles = new Map([
    ["/memory.js", compositionPlugin("memory")],
    ["/settings.js", compositionPlugin("settings")]
  ]);

  await withPage(renderViewHostHtml("en", instances), bundles, undefined, async page => {
    await page.locator("#memory-index-view").waitFor();
    assert.equal(new URL(page.url()).pathname, "/memories");
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Memories");
    assert.notEqual(await page.locator(".view-shell-sidebar").evaluate(element => getComputedStyle(element).display), "none");
    assert.doesNotMatch(await page.locator("#memsphere-view-root").innerText(), /Loading/);
    const shellLayout = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".view-shell-sidebar")!;
      const navigationItem = document.querySelector<HTMLElement>(".view-shell-navigation-item")!;
      const footer = document.querySelector<HTMLElement>(".view-shell-footer")!;
      return {
        sidebarHeight: sidebar.getBoundingClientRect().height,
        navigationItemHeight: navigationItem.getBoundingClientRect().height,
        footerBottom: footer.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      };
    });
    assert.ok(shellLayout.sidebarHeight <= shellLayout.viewportHeight + 1);
    assert.ok(shellLayout.navigationItemHeight < 80);
    assert.ok(shellLayout.footerBottom <= shellLayout.viewportHeight + 1);

    await page.getByRole("button", { name: "Concepts" }).click();
    await page.locator("#memory-detail-view").waitFor();
    assert.equal(await page.locator("#memory-detail-view").textContent(), "Memory detail concepts");
    assert.equal(new URL(page.url()).pathname, "/memories/concepts");
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Memory detail");

    const capture = page.getByRole("button", { name: "Capture params" });
    await capture.click();
    await page.waitForFunction(() => (window as Window & { __capturedKind?: string }).__capturedKind === "concepts");
    assert.equal(await capture.getAttribute("aria-busy"), null);
    assert.equal(await page.getByRole("button", { name: "Disabled action" }).isDisabled(), true);
    const failing = page.getByRole("button", { name: "Failing action" });
    await failing.click();
    await page.waitForFunction(() => document.querySelector('[data-view-action-error="action failed"]'));
    assert.equal(await failing.getAttribute("title"), "action failed");

    await page.getByRole("button", { name: "Statements" }).click();
    await page.waitForURL(/\/memories\/statements$/);
    assert.equal(await page.locator("#memory-detail-view").textContent(), "Memory detail statements");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#settings-view").waitFor();
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Settings");

    await page.goBack();
    await page.locator("#memory-detail-view").waitFor();
    assert.equal(new URL(page.url()).pathname, "/memories/statements");
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Memory detail");
  }, "/");
});

test("ViewHost keeps the current page visible until the next Mount is ready", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.memory", "memory", "/memory.js", "/"),
    routeGrants: [
      { id: "first", path: "/first" },
      { id: "second", path: "/second" }
    ]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const first = context.router.register({ id: "first", path: "/first" });
      const second = context.router.register({ id: "second", path: "/second" });
      context.slots.register(slots.navigationPrimary, { id: "second-nav", value: {
        label: { text: "Second" }, icon: { kind: "system", name: "next" }, route: second.to()
      }});
      context.slots.register(slots.mainView, { id: "first", key: first.key, value: {
        mount({ element }) { element.innerHTML = '<p id="first-page">First page</p>'; }
      }});
      context.slots.register(slots.mainView, { id: "second", key: second.key, value: {
        async mount({ element }) {
          element.innerHTML = '<p id="next-loading">Loading next page</p>';
          await new Promise(resolve => setTimeout(resolve, 250));
          element.innerHTML = '<p id="second-page">Second page</p>';
        }
      }});
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/memory.js", bundle]]), undefined, async page => {
    await page.locator("#first-page").waitFor();
    await page.getByRole("button", { name: "Second", exact: true }).click();
    await page.waitForURL(/\/second$/);
    assert.equal(await page.locator("#first-page").count(), 1);
    assert.equal(await page.locator("#next-loading").count(), 0);
    await page.locator("#second-page").waitFor();
    assert.equal(await page.locator("#first-page").count(), 0);
  }, "/first");
});

test("built-in Route grants reject an unapproved path before composition", async () => {
  const instances: ViewHostBootInstance[] = [{
    ...bootInstance("org.memsphere.memory", "memory", "/memory.js", "/"),
    routeGrants: [{ id: "index", path: "/memories" }]
  }];
  const bundles = new Map([["/memory.js", `
    export default { apiVersion: 1, inject: ["router"], apply(context) {
      context.router.register({ id: "index", path: "/unapproved" });
    }};
  `]]);
  await withPage(renderViewHostHtml("en", instances), bundles, undefined, async page => {
    const error = page.locator(".view-host-module-error");
    await error.waitFor();
    assert.match(await error.textContent() ?? "", /does not match built-in grant index/);
    assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
  }, "/memories");
});

test("shared main.view conflicts roll back the later instance and cleanup is reverse ordered", async () => {
  const html = runtimeHarness();
  await withPage(html, new Map(), undefined, async page => {
    await page.locator("#runtime-mounted").waitFor();
    assert.deepEqual(await page.evaluate(() => (
      window as Window & { __runtimeState: { diagnostics: unknown; events: string[] } }
    ).__runtimeState.events), ["first:apply", "second:apply", "second:rollback", "first:mount"]);
    const statuses = await page.evaluate(() => (
      window as Window & {
        __runtimeState: { diagnostics: { instances: { status: string; message?: string }[] } };
      }
    ).__runtimeState.diagnostics.instances);
    assert.deepEqual(statuses.map(value => value.status), ["active", "failed"]);
    assert.match(statuses[1]?.message ?? "", /Slot Entry conflicts in main\.view@1: shared/);

    await page.evaluate(async () => {
      const state = (window as Window & {
        __runtimeState: { active: { dispose(): Promise<void> } };
      }).__runtimeState;
      await state.active.dispose();
    });
    assert.deepEqual(await page.evaluate(() => (
      window as Window & { __runtimeState: { events: string[] } }
    ).__runtimeState.events), [
      "first:apply", "second:apply", "second:rollback", "first:mount", "first:unmount", "first:dispose"
    ]);
  });
});

function bootInstance(
  moduleId: string,
  instanceId: string,
  pluginPath: string,
  routeBasePath: string,
): ViewHostBootInstance {
  return {
    pluginPath,
    routeBasePath,
    module: { projectId: "memsphere", moduleId, moduleVersion: "1.0.0", instanceId }
  };
}

function routedPlugin(name: string, path: string, label: string): string {
  return `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      window.__compositionOrder.push(${JSON.stringify(name)});
      const route = context.router.register({ id: "index", path: ${JSON.stringify(path)} });
      context.slots.register(slots.mainView, {
        id: "page", key: route.key,
        value: { mount({ element }) {
          window.__compositionOrder.push(${JSON.stringify(`${name}:mount`)});
          element.innerHTML = '<p id="active-composed-view">${label}</p>';
        }}
      });
    }};
  `;
}

function compositionPlugin(name: "memory" | "settings"): string {
  if (name === "settings") return `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const route = context.router.register({ id: "index", path: "/settings" });
      context.slots.register(slots.navigationPrimary, { id: "settings-nav", order: 30, value: {
        label: { text: "Settings" }, icon: { kind: "system", name: "settings" }, route: route.to()
      }});
      context.slots.register(slots.headerTitle, { id: "settings-title", when: route.activation,
        value: { title: { text: "Settings" }, subtitle: { text: "Configuration" } }
      });
      context.slots.register(slots.mainView, { id: "settings-view", key: route.key, value: {
        mount({ element }) { element.innerHTML = '<p id="settings-view">Settings body</p>'; }
      }});
    }};
  `;
  return `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const index = context.router.register({ id: "index", path: "/memories" });
      const detail = context.router.register({ id: "detail", path: "/memories/:kind" });
      context.slots.register(slots.navigationPrimary, { id: "memory-nav", order: 10, value: {
        label: { text: "Memory" }, icon: { kind: "system", name: "memory" }, route: index.to()
      }});
      context.slots.register(slots.navigationPrimary, { id: "concept-nav", order: 20, value: {
        label: { text: "Concepts" }, icon: { kind: "system", name: "concept" }, route: detail.to({ kind: "concepts" })
      }});
      context.slots.register(slots.navigationPrimary, { id: "statement-nav", order: 21, value: {
        label: { text: "Statements" }, icon: { kind: "system", name: "statement" }, route: detail.to({ kind: "statements" })
      }});
      context.slots.register(slots.headerTitle, { id: "memory-title", when: index.activation,
        value: { title: { text: "Memories" } }
      });
      context.slots.register(slots.headerTitle, { id: "memory-detail-title", when: detail.activation,
        value: { title: { text: "Memory detail" }, breadcrumbs: [{ label: { text: "Memories" }, route: index.to() }] }
      });
      context.slots.register(slots.headerActions, { id: "capture", when: detail.activation, value: {
        label: { text: "Capture params" }, async run() {
          await new Promise(resolve => setTimeout(resolve, 20));
          window.__capturedKind = context.router.location.params.kind;
        }
      }});
      context.slots.register(slots.headerActions, { id: "disabled", when: detail.activation, value: {
        label: { text: "Disabled action" }, disabled: true, run() { throw new Error("must not run"); }
      }});
      context.slots.register(slots.headerActions, { id: "failing", when: detail.activation, value: {
        label: { text: "Failing action" }, run() { throw new Error("action failed"); }
      }});
      context.slots.register(slots.mainView, { id: "memory-index", key: index.key, value: {
        mount({ element }) { element.innerHTML = '<p id="memory-index-view">Memory index</p>'; }
      }});
      context.slots.register(slots.mainView, { id: "memory-detail", key: detail.key, value: {
        mount({ element }, renderContext) {
          element.innerHTML = '<p id="memory-detail-view">Memory detail ' + renderContext.route.params.kind + '</p>';
        }
      }});
    }};
  `;
}

function runtimeHarness(): string {
  return `<!doctype html><html><body><main id="root"></main>
    <script type="importmap">{"imports":{"@memsphere/view-sdk":"${viewSdkBundlePath}"}}</script>
    <script type="module">
      import { slots } from "@memsphere/view-sdk";
      import { startViewHost } from "${viewRuntimeBundlePath}";
      const events = [];
      const module = instanceId => ({ projectId: "p", moduleId: "org.test." + instanceId, moduleVersion: "1.0.0", instanceId });
      const plugin = (name, conflict) => ({ apiVersion: 1, inject: ["slots"], apply(context) {
        events.push(name + ":apply");
        context.lifecycle.own(() => events.push(name + (conflict ? ":rollback" : ":dispose")));
        context.slots.register(slots.mainView, { id: "page", key: "shared", value: {
          mount({ element }) {
            events.push(name + ":mount");
            element.innerHTML = '<p id="runtime-mounted">mounted</p>';
            return () => events.push(name + ":unmount");
          }
        }});
      }});
      const active = await startViewHost({
        instances: [
          { plugin: plugin("first", false), config: {}, module: module("first") },
          { plugin: plugin("second", true), config: {}, module: module("second") }
        ],
        root: document.getElementById("root"), mainViewKey: "shared"
      });
      window.__runtimeState = { active, diagnostics: active.diagnostics(), events };
    </script></body></html>`;
}

async function withPage(
  html: string,
  bundles: ReadonlyMap<string, string>,
  prepare: ((page: Page) => Promise<void>) | undefined,
  run: (page: Page) => Promise<void>,
  pathname = "/",
): Promise<void> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const source = path === viewSdkBundlePath ? sdkSource
      : path === viewRuntimeBundlePath ? runtimeSource
        : bundles.get(path);
    if (source !== undefined) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(source);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await prepare?.(page);
    await page.goto(`${origin}${pathname}`);
    await run(page);
  } finally {
    await browser.close();
    await close(server);
  }
}

async function browserModule(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
  }).outputText;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
