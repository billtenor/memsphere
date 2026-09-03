import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const sdkSource = await browserModule("../src/view/view-sdk.ts");
const runtimeSource = await browserRuntimeBundle();
const referenceSource = await browserEntryBundle("../modules/org.memsphere.reference/adapter/view/index.ts");

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

test("Theme v1 is one Host-owned context applied to main and portal roots and cleaned on unload", async () => {
  const instance = {
    ...bootInstance("org.memsphere.theme", "theme", "/theme-plugin.js", "/"),
    routeGrants: [{ id: "index", path: "/theme" }]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, themeVersion: 1, inject: ["slots", "router", "theme"], apply(context) {
      const route = context.router.register({ id: "index", path: "/theme" });
      window.__pluginTheme = context.theme;
      context.theme.subscribe(() => undefined);
      context.slots.register(slots.mainView, { id: "theme", key: route.key, value: {
        mount({ element, portal }, renderContext) {
          window.__mountThemeSame = renderContext.theme === window.__pluginTheme;
          element.id = "theme-page";
          portal.id = "theme-portal";
          element.textContent = renderContext.theme.tokens["color.text"];
        }
      }});
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/theme-plugin.js", bundle]]), undefined, async page => {
    await page.locator("#theme-page").waitFor();
    assert.equal(await page.evaluate(() => (window as Window & { __mountThemeSame: boolean }).__mountThemeSame), true);
    assert.equal(await page.locator("#theme-page").getAttribute("data-view-theme-version"), "1");
    assert.equal(await page.locator("#theme-portal").getAttribute("data-view-theme-mode"), "light");
    assert.equal(await page.locator("#theme-page").evaluate(element => getComputedStyle(element).getPropertyValue("--mem-view-color-text").trim()), "#202826");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => document.querySelector("#theme-page") === null);
  }, "/theme");
});

test("UI v1 renders, updates, navigates, and disposes a standard content list", async () => {
  const instance = {
    ...bootInstance("org.memsphere.ui", "ui", "/ui-plugin.js", "/"),
    routeGrants: [{ id: "index", path: "/ui", query: ["item"] }]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, uiVersion: 1, inject: ["slots", "router", "ui"], apply(context) {
      const route = context.router.register({ id: "index", path: "/ui", query: ["item"] });
      let filter = "";
      const list = context.ui.contentList(renderContext => ({
        label: { text: "Objects" },
        filter: { label: { text: "Filter objects" }, value: filter, onInput(value) { filter = value; } },
        empty: { title: { text: "Nothing found" } },
        sections: [{ id: "all", items: ["one", "two"].filter(id => id.includes(filter)).map(id => ({
          id, title: { text: id }, selected: renderContext.route.query.item === id,
          icon: { kind: "system", name: id === "two" ? "run" : "stack" },
          route: route.to({}, { query: { item: id } })
        })) }]
      }));
      context.slots.register(slots.contentList, { id: "objects", when: route.activation, value: list });
      context.slots.register(slots.mainView, { id: "page", key: route.key, value: { mount({ element }) { element.textContent = "UI page"; } } });
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/ui-plugin.js", bundle]]), undefined, async page => {
    await page.getByRole("button", { name: "one", exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "Filter objects" }).fill("missing");
    await page.getByText("Nothing found", { exact: true }).waitFor();
    const filter = page.getByRole("searchbox", { name: "Filter objects" });
    await filter.fill("");
    await filter.focus();
    await page.keyboard.type("two", { delay: 30 });
    assert.equal(await filter.evaluate(element => element === document.activeElement), true);
    assert.equal(await filter.inputValue(), "two");
    assert.match(await page.getByRole("button", { name: "two", exact: true }).locator("img").getAttribute("src") ?? "", /play-circle\.svg$/);
    await page.getByRole("button", { name: "two", exact: true }).click();
    assert.match(page.url(), /[?&]item=two/);
    assert.equal(await page.getByRole("button", { name: "two", exact: true }).getAttribute("aria-current"), "page");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => document.querySelector(".mem-view-content-list-root") === null);
  }, "/ui");
});

test("UI v1 isolates an invalid content-list provider update", async () => {
  const instance = {
    ...bootInstance("org.memsphere.invalid-ui", "invalid-ui", "/invalid-ui.js", "/"),
    routeGrants: [{ id: "index", path: "/invalid-ui", query: ["state"] }]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, uiVersion: 1, inject: ["slots", "router", "ui"], apply(context) {
      const route = context.router.register({ id: "index", path: "/invalid-ui", query: ["state"] });
      const list = context.ui.contentList(renderContext => {
        if (renderContext.route.query.state === "invalid") return { label: { text: "broken" } };
        return { label: { text: "Objects" }, empty: { title: { text: "Empty" } }, sections: [{ id: "all", items: [{
          id: "break", title: { text: "Break provider" }, route: route.to({}, { query: { state: "invalid" } })
        }] }] };
      });
      context.slots.register(slots.contentList, { id: "objects", when: route.activation, value: list });
      context.slots.register(slots.mainView, { id: "page", key: route.key, value: { mount({ element }) { element.textContent = "Page stays available"; } } });
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/invalid-ui.js", bundle]]), undefined, async page => {
    await page.getByRole("button", { name: "Break provider", exact: true }).click();
    const diagnostic = page.locator('[data-view-slot="content.list"] .view-host-module-error');
    await diagnostic.waitFor();
    assert.match(await diagnostic.innerText(), /content list descriptor is invalid/);
    assert.equal(await page.getByText("Page stays available", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Break provider", exact: true }).count(), 0);
  }, "/invalid-ui");
});

test("Reference Module keeps its standard filter focused during multi-character typing", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.reference", "reference", "/reference.js", "/"),
    config: { locale: "zh-CN" },
    routeGrants: [
      { id: "index", path: "/reference", query: ["item"] },
      { id: "dialog", path: "/reference/dialog" },
      { id: "drawer", path: "/reference/drawer" },
    ]
  };
  await withPage(renderViewHostHtml("zh-CN", [instance]), new Map([["/reference.js", referenceSource]]), undefined, async page => {
    const filter = page.getByRole("searchbox", { name: "筛选对象" });
    await filter.focus();
    await page.keyboard.type("研究", { delay: 30 });
    assert.equal(await filter.evaluate(element => element === document.activeElement), true);
    assert.equal(await filter.inputValue(), "研究");
    assert.equal(await page.getByRole("button", { name: /研究笔记/ }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /关系画布/ }).count(), 0);
  }, "/reference");
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
    const settingsNavigation = page.getByRole("navigation").getByRole("button", { name: "Settings", exact: true });
    assert.match(await settingsNavigation.locator("img").getAttribute("src") ?? "", /gear-six\.svg$/);
    await settingsNavigation.click();
    await page.locator("#settings-view").waitFor();
  }, "/broken");
});

test("Shell navigation composes main/header descriptors and browser back restores the route", async () => {
  const memory = bootInstance("org.memsphere.memory", "memory", "/memory.js", "/");
  const instances: ViewHostBootInstance[] = [
    {
      ...memory,
      routeGrants: [
        { id: "index", path: "/memories" },
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

    await page.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#settings-view").waitFor();
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Settings");

    await page.goBack();
    await page.locator("#memory-detail-view").waitFor();
    assert.equal(new URL(page.url()).pathname, "/memories/statements");
    assert.equal(await page.locator(".view-shell-heading h1").textContent(), "Memory detail");
  }, "/memories");
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

test("related Routes can update one active Mount without remounting its page", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.memory", "memory", "/memory.js", "/"),
    routeGrants: [
      { id: "index", path: "/memories" },
      { id: "market", path: "/market" }
    ]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const index = context.router.register({ id: "index", path: "/memories" });
      const market = context.router.register({ id: "market", path: "/market" });
      const shared = {
        mount({ element }, renderContext) {
          window.__mountCount = (window.__mountCount || 0) + 1;
          element.id = "shared-page";
          element.textContent = renderContext.route.pathname;
        },
        update(renderContext) {
          window.__updateCount = (window.__updateCount || 0) + 1;
          document.querySelector("#shared-page").textContent = renderContext.route.pathname;
        }
      };
      context.slots.register(slots.navigationPrimary, { id: "market-nav", value: {
        label: { text: "Market" }, icon: { kind: "system", name: "next" }, route: market.to()
      }});
      context.slots.register(slots.mainView, { id: "index", key: index.key, value: shared });
      context.slots.register(slots.mainView, { id: "market", key: market.key, value: shared });
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/memory.js", bundle]]), undefined, async page => {
    await page.locator("#shared-page").waitFor();
    await page.getByRole("button", { name: "Market", exact: true }).click();
    await page.waitForURL(/\/market$/);
    await page.waitForFunction(() => document.querySelector("#shared-page")?.textContent === "/market");
    assert.deepEqual(await page.evaluate(() => ({
      mounts: (window as any).__mountCount,
      updates: (window as any).__updateCount
    })), { mounts: 1, updates: 1 });
  }, "/memories");
});

test("Overlay preserves the active Page portal and disposes Overlay before Page", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.run", "run", "/run.js", "/"),
    routeGrants: [
      { id: "detail", path: "/tasks/:runId" },
      { id: "review", path: "/tasks/:runId/artifact-reviews/:reviewId" }
    ]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const detail = context.router.register({ id: "detail", path: "/tasks/:runId" });
      const review = context.router.register({ id: "review", path: "/tasks/:runId/artifact-reviews/:reviewId" });
      const events = window.__portalEvents = [];
      context.slots.register(slots.mainView, { id: "detail", key: detail.key, value: {
        mount({ element, portal }) {
          events.push("page:mount");
          window.__backgroundPortal = portal;
          element.innerHTML = '<button id="open-review">Open review</button>';
          element.querySelector("button").onclick = () => context.router.navigate(review.to({ runId: "run-1", reviewId: "review-1" }));
          const marker = document.createElement("p"); marker.id = "page-portal-before"; marker.textContent = "before"; portal.append(marker);
          return () => events.push("page:dispose");
        }
      }});
      context.slots.register(slots.overlay, { id: "review", key: review.key, value: {
        label: { text: "Review" }, presentation: "dialog",
        background: context.router.project({ from: review, to: detail, params: { runId: "runId" } }),
        mount: { mount({ element }) {
          events.push("overlay:mount"); element.innerHTML = '<p id="review-overlay">Review body</p>';
          return () => events.push("overlay:dispose");
        }}
      }});
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/run.js", bundle]]), undefined, async page => {
    await page.locator("#page-portal-before").waitFor();
    await page.locator("#open-review").click();
    await page.locator("#review-overlay").waitFor();
    assert.equal(await page.locator("#page-portal-before").count(), 1);
    assert.equal(await page.evaluate(() => (window as any).__backgroundPortal.isConnected), true);
    await page.evaluate(() => {
      const marker = document.createElement("p"); marker.id = "page-portal-during"; marker.textContent = "during";
      (window as any).__backgroundPortal.append(marker);
    });
    await page.locator("#page-portal-during").waitFor();
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForURL(/\/tasks\/run-1$/);
    assert.equal(await page.locator("#page-portal-during").count(), 1);
    await page.evaluate(async () => {
      const marker = document.createElement("p"); marker.id = "page-portal-after"; marker.textContent = "after";
      (window as any).__backgroundPortal.append(marker);
      dispatchEvent(new PageTransitionEvent("pagehide"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(await page.locator("#page-portal-after").count(), 0);
    assert.deepEqual(await page.evaluate(() => (window as any).__portalEvents), [
      "page:mount", "overlay:mount", "overlay:dispose", "page:dispose"
    ]);
  }, "/tasks/run-1");
});

test("Router query targets canonicalize allowlisted values and preserve browser history", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.memory", "memory", "/memory.js", "/"),
    routeGrants: [
      { id: "index", path: "/items", query: ["filter"] },
      { id: "detail", path: "/items/:id", query: ["filter"] }
    ]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const index = context.router.register({ id: "index", path: "/items", query: ["filter"] });
      const detail = context.router.register({ id: "detail", path: "/items/:id", query: ["filter"] });
      context.slots.register(slots.navigationPrimary, { id: "detail", value: {
        label: { text: "Open item" }, icon: { kind: "system", name: "next" },
        route: detail.to({ id: "a/b" }, { query: { filter: "x y" }, hash: "anchor /" })
      }});
      const view = {
        mount({ element }, renderContext) {
          element.id = "query-view";
          element.textContent = JSON.stringify(renderContext.route);
        },
        update(renderContext) { document.querySelector("#query-view").textContent = JSON.stringify(renderContext.route); }
      };
      context.slots.register(slots.mainView, { id: "index", key: index.key, value: view });
      context.slots.register(slots.mainView, { id: "detail", key: detail.key, value: view });
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/memory.js", bundle]]), undefined, async page => {
    await page.locator("#query-view").waitFor();
    assert.equal(new URL(page.url()).search, "?filter=old");
    assert.equal(new URL(page.url()).hash, "#keep");
    assert.equal(JSON.parse(await page.locator("#query-view").textContent() ?? "{}").query.filter, "old");

    await page.getByRole("button", { name: "Open item" }).click();
    await page.waitForURL(/\/items\/a%2Fb\?filter=x\+y#anchor%20%2F$/);
    const detailRoute = JSON.parse(await page.locator("#query-view").textContent() ?? "{}");
    assert.deepEqual(detailRoute.query, { filter: "x y" });

    await page.goBack();
    await page.waitForURL(/\/items\?filter=old#keep$/);
  }, "/items?filter=old&unknown=gone#keep");
});

test("Overlay projection maps only declared query and Host dismissal replaces the deep link", async () => {
  const instance: ViewHostBootInstance = {
    ...bootInstance("org.memsphere.run", "run", "/run.js", "/"),
    routeGrants: [
      { id: "detail", path: "/tasks/:runId", query: ["status"] },
      { id: "review", path: "/tasks/:runId/artifact-reviews/:reviewId", query: ["status", "round", "material"] }
    ]
  };
  const bundle = `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const detail = context.router.register({ id: "detail", path: "/tasks/:runId", query: ["status"] });
      const review = context.router.register({ id: "review", path: "/tasks/:runId/artifact-reviews/:reviewId", query: ["status", "round", "material"] });
      context.slots.register(slots.mainView, { id: "detail", key: detail.key, value: {
        mount({ element }, renderContext) {
          element.id = "projected-detail";
          element.textContent = JSON.stringify(renderContext.route);
        }
      }});
      context.slots.register(slots.overlay, { id: "review", key: review.key, value: {
        label: { text: "Review" }, presentation: "dialog",
        background: context.router.project({
          from: review, to: detail, params: { runId: "runId" }, query: { status: "status" }, hash: "discard"
        }),
        mount: { mount({ element }) { element.innerHTML = '<p id="projected-overlay">Review</p>'; } }
      }});
    }};
  `;
  await withPage(renderViewHostHtml("en", [instance]), new Map([["/run.js", bundle]]), undefined, async page => {
    await page.locator("#projected-overlay").waitFor();
    const beforeLength = await page.evaluate(() => history.length);
    const background = JSON.parse(await page.locator("#projected-detail").textContent() ?? "{}");
    assert.deepEqual(background.query, { status: "done" });
    assert.equal(background.hash, "");
    assert.equal(background.projected, true);
    assert.equal(new URL(page.url()).search, "?status=done&round=2&material=report");

    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForURL(/\/tasks\/run-1\?status=done$/);
    assert.equal(await page.evaluate(() => history.length), beforeLength);
  }, "/tasks/run-1/artifact-reviews/review-1?status=done&round=2&material=report&unknown=gone#comment");
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

test("content.list keeps one Mount and local state across detail, query, and Overlay routes", async () => {
  const run = bootInstance("org.memsphere.run", "run", "/run.js", "/");
  const instances: ViewHostBootInstance[] = [{
    ...run,
    routeGrants: [
      { id: "index", path: "/tasks", query: ["status"] },
      { id: "detail", path: "/tasks/:runId", query: ["status"] },
      { id: "review", path: "/tasks/:runId/reviews/:reviewId", query: ["status", "round"] }
    ]
  }];
  const bundles = new Map([["/run.js", `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const index = context.router.register({ id: "index", path: "/tasks", query: ["status"] });
      const detail = context.router.register({ id: "detail", path: "/tasks/:runId", query: ["status"] });
      const review = context.router.register({ id: "review", path: "/tasks/:runId/reviews/:reviewId", query: ["status", "round"] });
      window.__listLifecycle = { mounts: 0, updates: 0, disposes: 0 };
      let listElement;
      const listMount = {
        mount({ element }, renderContext) {
          window.__listLifecycle.mounts += 1;
          listElement = element;
          element.innerHTML = '<input id="list-filter"><button id="open-detail">Run 1</button>';
          element.dataset.route = renderContext.route.pathname + renderContext.route.search;
          element.querySelector('#open-detail').onclick = () => context.router.navigate(detail.to({ runId: "run-1" }, { query: { status: "running" } }));
          return () => { window.__listLifecycle.disposes += 1; };
        },
        update(renderContext) {
          window.__listLifecycle.updates += 1;
          listElement.dataset.route = renderContext.route.pathname + renderContext.route.search;
        }
      };
      for (const [id, route] of [["index", index], ["detail", detail]]) {
        context.slots.register(slots.contentList, { id: "list." + id, when: route.activation, value: listMount });
      }
      context.slots.register(slots.mainView, { id: "index", key: index.key, when: index.activation, value: {
        mount({ element }) { element.innerHTML = '<p id="run-index">Runs</p>'; }
      }});
      context.slots.register(slots.mainView, { id: "detail", key: detail.key, when: detail.activation, value: {
        mount({ element }) {
          element.innerHTML = '<p id="run-detail">Run detail</p><button id="open-review">Review</button>';
          element.querySelector('#open-review').onclick = () => context.router.navigate(review.to(
            { runId: "run-1", reviewId: "review-1" }, { query: { status: "running", round: "2" } }
          ));
        }
      }});
      context.slots.register(slots.overlay, { id: "review", key: review.key, when: review.activation, value: {
        label: { text: "Review" }, presentation: "dialog",
        background: context.router.project({ from: review, to: detail, params: { runId: "runId" }, query: { status: "status" } }),
        mount: { mount({ element }) { element.innerHTML = '<p id="review-body">Review body</p>'; } }
      }});
    }};
  `]]);

  await withPage(renderViewHostHtml("en", instances), bundles, undefined, async page => {
    await page.locator("#list-filter").fill("keep me");
    await page.locator("#open-detail").click();
    await page.locator("#run-detail").waitFor();
    assert.equal(await page.locator("#list-filter").inputValue(), "keep me");
    await page.locator("#open-review").click();
    await page.locator("#review-body").waitFor();
    assert.equal(await page.locator("#list-filter").inputValue(), "keep me");
    await page.locator(".view-overlay-close").click();
    await page.locator("#review-body").waitFor({ state: "detached" });
    assert.equal(await page.locator("#list-filter").inputValue(), "keep me");
    const lifecycle = await page.evaluate(() => (window as Window & {
      __listLifecycle: { mounts: number; updates: number; disposes: number };
    }).__listLifecycle);
    assert.equal(lifecycle.mounts, 1);
    assert.ok(lifecycle.updates >= 1);
    assert.equal(lifecycle.disposes, 0);
  }, "/tasks?status=running");
});

test("global search filters Providers and isolates aborted or stale queries", async () => {
  const memory = bootInstance("org.memsphere.memory", "memory", "/memory.js", "/");
  const instances: ViewHostBootInstance[] = [{
    ...memory,
    routeGrants: [{ id: "index", path: "/memories" }]
  }];
  const bundles = new Map([["/memory.js", `
    import { slots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "router"], apply(context) {
      const index = context.router.register({ id: "index", path: "/memories" });
      window.__searchState = { queries: [], aborts: 0 };
      context.slots.register(slots.navigationPrimary, { id: "memory", value: {
        label: { text: "Memory" }, icon: { kind: "system", name: "memory" }, route: index.to()
      }});
      context.slots.register(slots.mainView, { id: "index", key: index.key, value: { mount({ element }) {
        element.innerHTML = '<label>Business <input id="business-input"></label>';
      }}});
      context.slots.register(slots.searchProviders, { id: "memory-search", value: {
        label: { text: "Memory" }, icon: { kind: "system", name: "memory" },
        search({ query, signal }) {
          window.__searchState.queries.push(query);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              if (query === "failure") { reject(new Error("provider failed")); return; }
              resolve([{ title: { text: query }, summary: { text: "result" }, type: { text: "Memory" }, route: index.to() }]);
            }, query === "old" ? 400 : 20);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              window.__searchState.aborts += 1;
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          });
        }
      }});
    }};
  `]]);

  await withPage(renderViewHostHtml("en", instances), bundles, undefined, async page => {
    await page.locator("#business-input").waitFor();
    await page.locator("[data-view-search-trigger]").focus();
    await page.keyboard.press("Control+K");
    await page.locator("[data-view-search-input]").waitFor();
    assert.equal(await page.locator("[data-view-search-input]").evaluate(element => element === document.activeElement), true);
    assert.deepEqual(await page.locator('[data-view-slot="search.providers"] button').allTextContents(), ["All", "Memory"]);
    await page.locator('[data-view-slot="search.providers"] button', { hasText: "Memory" }).click();
    await page.locator("[data-view-search-input]").fill("old");
    await page.waitForTimeout(230);
    await page.locator("[data-view-search-input]").fill("new");
    await page.getByRole("button", { name: /new/ }).waitFor();
    assert.equal(await page.locator(".view-shell-search-provider-error").count(), 0);
    assert.equal(await page.getByRole("button", { name: /old/ }).count(), 0);
    assert.ok(await page.evaluate(() => (window as Window & { __searchState: { aborts: number } }).__searchState.aborts) >= 1);
    await page.locator("[data-view-search-input]").fill("failure");
    await page.locator(".view-shell-search-provider-error").waitFor();
    assert.match(await page.locator(".view-shell-search-provider-error").innerText(), /provider failed/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-view-search-overlay]").isHidden(), true);
    assert.equal(await page.locator("[data-view-search-trigger]").evaluate(element => element === document.activeElement), true);
    await page.locator("#business-input").focus();
    await page.keyboard.press("Control+K");
    assert.equal(await page.locator("[data-view-search-overlay]").isHidden(), true);
  }, "/memories");
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

async function browserRuntimeBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/view/view-runtime.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    external: ["@memsphere/view-sdk", "./view-sdk.js"], logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

async function browserEntryBundle(relativePath: string): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    external: ["@memsphere/view-sdk"], logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
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
