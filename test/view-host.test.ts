import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { legacyViewBundle } from "../src/view/browser.js";
import {
  legacyViewBundlePath,
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath
} from "../src/view/host.js";

const viewSdkBundle = await transpileBrowserModule("../src/view/view-sdk.ts");
const viewRuntimeBundle = await transpileBrowserModule("../src/view/view-runtime.ts");

test("ViewHost document delegates all business UI to one external bundle", () => {
  const html = renderViewHostHtml("en");
  const bootSource = html.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(bootSource);
  const boot = JSON.parse(bootSource);

  assert.equal(boot.locale, "en");
  assert.equal(boot.pluginPath, legacyViewBundlePath);
  assert.equal(boot.runtimePath, viewRuntimeBundlePath);
  assert.equal(boot.mainViewKey, "legacy");
  assert.equal(boot.messages["common.refresh"], "Refresh");
  assert.match(html, /id="memsphere-view-root"/);
  assert.match(html, /"@memsphere\/view-sdk":"\/assets\/view-sdk\.js"/);
  assert.match(html, /import\(boot\.pluginPath\)/);
  assert.match(html, /runtimeModule\.startViewPlugin/);
  assert.doesNotMatch(html, /id="project-memory-tab"/);
  assert.doesNotMatch(html, /fetch\("\/api\/memories"\)/);
});

test("Legacy View bundle default-exports one Plugin that contributes main.view", () => {
  assert.match(legacyViewBundle, /from "@memsphere\/view-sdk"/);
  assert.equal((legacyViewBundle.match(/export default defineViewPlugin\(/g) ?? []).length, 1);
  assert.match(legacyViewBundle, /context\.slots\.register\(slots\.mainView/);
  assert.doesNotMatch(legacyViewBundle, /export function mount\(options\)/);
  assert.match(legacyViewBundle, /project-memory-tab/);
  assert.match(legacyViewBundle, /fetch\("\/api\/memories\?/);
  assert.equal((legacyViewBundle.match(/scheduleViewTask\(\(\) => \{/g) ?? []).length, 5);
  assert.equal((legacyViewBundle.match(/addOwnedDocumentPointerdown\(event => \{/g) ?? []).length, 5);
});

test("View server serves Host, SDK, Runtime, and Plugin without absorbing unknown assets", async () => {
  const server = createViewServer({ language: "en" } as MemsphereConfig);
  const origin = await listen(server);
  try {
    const pageResponse = await fetch(`${origin}/memories`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await pageResponse.text(), /data-view-host-state="loading"/);

    const bundleResponse = await fetch(`${origin}${legacyViewBundlePath}`);
    assert.equal(bundleResponse.status, 200);
    assert.match(bundleResponse.headers.get("content-type") ?? "", /^text\/javascript/);
    assert.match(await bundleResponse.text(), /export default defineViewPlugin\(/);

    const sdkResponse = await fetch(`${origin}${viewSdkBundlePath}`);
    assert.equal(sdkResponse.status, 200);
    assert.match(await sdkResponse.text(), /export const slots/);

    const runtimeResponse = await fetch(`${origin}${viewRuntimeBundlePath}`);
    assert.equal(runtimeResponse.status, 200);
    assert.match(await runtimeResponse.text(), /export async function startViewPlugin/);

    const missingResponse = await fetch(`${origin}/assets/unknown-view.js`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await close(server);
  }
});

test("ViewHost mounts a successfully imported bundle", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        context.slots.register(slots.mainView, {
          id: "page",
          key: "legacy",
          value: { mount({ element }) { element.innerHTML = '<p id="synthetic-mounted">mounted</p>'; } }
        });
      }
    `),
    async page => {
      await page.locator("#synthetic-mounted").waitFor();
      assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
      assert.equal(await page.locator("#memsphere-view-root").getAttribute("class"), "");
      assert.equal(
        await page.locator("#memsphere-view-root").evaluate(element => getComputedStyle(element).display),
        "block"
      );
    }
  );
});

test("ViewHost shows a diagnostic when the bundle is missing", async () => {
  await withBrowserHost(undefined, async page => {
    await page.locator('html[data-view-host-state="failed"]').waitFor();
    assert.equal(await page.locator("#view-host-error h1").textContent(), "Failed to load Memsphere");
    assert.ok((await page.locator("#view-host-error p").textContent())?.trim());
  });
});

test("ViewHost shows a diagnostic when the bundle cannot be imported", async () => {
  await withBrowserHost("export function mount(", async page => {
    await page.locator('html[data-view-host-state="failed"]').waitFor();
    assert.equal(await page.locator("#view-host-error h1").textContent(), "Failed to load Memsphere");
    assert.ok((await page.locator("#view-host-error p").textContent())?.trim());
  });
});

test("ViewHost shows a diagnostic when the bundle has no default Plugin", async () => {
  await withBrowserHost("export const loaded = true;", async page => {
    await page.locator('html[data-view-host-state="failed"]').waitFor();
    assert.equal(
      await page.locator("#view-host-error p").textContent(),
      "View bundle does not default export a View Plugin"
    );
  });
});

test("ViewHost rejects an incompatible View Plugin API before apply", async () => {
  await withBrowserHost(
    'export default { apiVersion: 2, inject: [], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(await page.locator("#view-host-error p").textContent(), "Unsupported View Plugin API version: 2");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
});

test("ViewHost rejects a Plugin service that is not wired into the current Context", async () => {
  await withBrowserHost(
    'export default { apiVersion: 1, inject: ["router"], apply() {} };',
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(
        await page.locator("#view-host-error p").textContent(),
        "View Plugin requests unsupported service: router"
      );
    }
  );
});

test("ViewHost shows the apply error thrown by a loaded Plugin", async () => {
  await withBrowserHost(
    pluginSource('apply() { throw new Error("synthetic apply failed"); }'),
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(await page.locator("#view-host-error p").textContent(), "synthetic apply failed");
    }
  );
});

test("ViewHost shows a diagnostic when Plugin does not register the active main.view", async () => {
  await withBrowserHost(pluginSource("apply() {}"), async page => {
    await page.locator('html[data-view-host-state="failed"]').waitFor();
    assert.equal(
      await page.locator("#view-host-error p").textContent(),
      "View Plugin did not register main.view key: legacy"
    );
  });
});

test("ViewHost rejects a conflicting keyed main.view registration atomically", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        const value = { mount() {} };
        context.slots.register(slots.mainView, { id: "first", key: "legacy", value });
        context.slots.register(slots.mainView, { id: "second", key: "legacy", value });
      }
    `),
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(
        await page.locator("#view-host-error p").textContent(),
        "Slot Entry conflicts in main.view@1: legacy"
      );
    }
  );
});

test("ViewHost rejects a main.view value that does not satisfy its Mount contract", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        context.slots.register(slots.mainView, { id: "page", key: "legacy", value: {} });
      }
    `),
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(
        await page.locator("#view-host-error p").textContent(),
        "Slot main.view@1 rejected Entry value"
      );
    }
  );
});

test("ViewHost rolls back Plugin-owned resources when apply fails", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        window.__pluginCleanup = [];
        context.lifecycle.own(() => window.__pluginCleanup.push("owned"));
        context.slots.register(slots.mainView, {
          id: "page",
          key: "legacy",
          value: { mount() {} }
        });
        throw new Error("rollback apply");
      }
    `),
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.deepEqual(await page.evaluate(() => (window as Window & { __pluginCleanup: string[] }).__pluginCleanup), ["owned"]);
    }
  );
});

test("ViewHost shows the Mount error thrown by a registered main.view", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        context.slots.register(slots.mainView, {
          id: "page",
          key: "legacy",
          value: { mount() { throw new Error("synthetic mount failed"); } }
        });
      }
    `),
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(await page.locator("#view-host-error p").textContent(), "synthetic mount failed");
    }
  );
});

test("ViewHost continues disposing resources after one cleanup fails on pagehide", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        window.__pluginCleanup = [];
        context.lifecycle.own(() => window.__pluginCleanup.push("after-failure"));
        context.lifecycle.own(() => {
          window.__pluginCleanup.push("failure");
          throw new Error("synthetic cleanup failed");
        });
        context.slots.register(slots.mainView, {
          id: "page",
          key: "legacy",
          value: {
            mount({ element }) {
              element.innerHTML = '<p id="disposable-mounted">mounted</p>';
              return () => window.__pluginCleanup.push("mount");
            }
          }
        });
      }
    `),
    async page => {
      await page.locator("#disposable-mounted").waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.waitForFunction(() => (
        (window as Window & { __pluginCleanup?: string[] }).__pluginCleanup?.join(",")
          === "mount,failure,after-failure"
      ));
    }
  );
});

test("Legacy View releases its document listeners, popstate listener, and polling timer", async () => {
  await withBrowserHost(
    legacyViewBundle,
    async page => {
      await page.locator('html[data-view-host-state="ready"]').waitFor();
      await page.waitForFunction(() => {
        const tracker = (window as Window & {
          __legacyResourceTracker?: { listeners: number; intervals: number };
        }).__legacyResourceTracker;
        return tracker?.listeners === 4 && tracker.intervals === 1;
      });

      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.waitForFunction(() => {
        const tracker = (window as Window & {
          __legacyResourceTracker?: { listeners: number; intervals: number };
        }).__legacyResourceTracker;
        return tracker?.listeners === 0 && tracker.intervals === 0;
      });
    },
    trackLegacyResources
  );
});

test("Legacy View cancels a pending selector listener task when unloaded before timeout", async () => {
  await withBrowserHost(
    legacyViewBundle,
    async page => {
      await page.locator('html[data-view-host-state="ready"]').waitFor();
      await page.evaluate(() => {
        const viewWindow = window as Window & {
          scheduleViewTask(callback: () => void, delay?: number): () => void;
          addOwnedDocumentPointerdown(listener: (event: PointerEvent) => void): () => void;
          __delayedSelectorTaskRan?: boolean;
        };
        viewWindow.__delayedSelectorTaskRan = false;
        viewWindow.scheduleViewTask(() => {
          viewWindow.__delayedSelectorTaskRan = true;
          viewWindow.addOwnedDocumentPointerdown(() => {});
        }, 50);
        window.dispatchEvent(new Event("pagehide"));
      });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => (
        window as Window & { __delayedSelectorTaskRan?: boolean }
      ).__delayedSelectorTaskRan), false);
      assert.deepEqual(await legacyResourceCounts(page), { listeners: 0, intervals: 0 });
    },
    trackLegacyResources
  );
});

test("Legacy View removes a selector listener when unloaded after timeout", async () => {
  await withBrowserHost(
    legacyViewBundle,
    async page => {
      await page.locator('html[data-view-host-state="ready"]').waitFor();
      await page.evaluate(() => {
        const viewWindow = window as Window & {
          scheduleViewTask(callback: () => void, delay?: number): () => void;
          addOwnedDocumentPointerdown(listener: (event: PointerEvent) => void): () => void;
        };
        viewWindow.scheduleViewTask(() => viewWindow.addOwnedDocumentPointerdown(() => {}));
      });
      await page.waitForFunction(() => (
        window as Window & { __legacyResourceTracker?: { listeners: number } }
      ).__legacyResourceTracker?.listeners === 5);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.waitForFunction(() => {
        const tracker = (window as Window & {
          __legacyResourceTracker?: { listeners: number; intervals: number };
        }).__legacyResourceTracker;
        return tracker?.listeners === 0 && tracker.intervals === 0;
      });
    },
    trackLegacyResources
  );
});

async function trackLegacyResources(page: Page): Promise<void> {
  await page.addInitScript({ content: `
      (() => {
        const tracker = window.__legacyResourceTracker = { listeners: 0, intervals: 0 };
        const listeners = [];
        const originalAdd = EventTarget.prototype.addEventListener;
        const originalRemove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          const tracked = (this === document && ["keydown", "click", "focusout", "pointerdown"].includes(type))
            || (this === window && type === "popstate");
          if (tracked) {
            listeners.push({ target: this, type, listener, active: true });
            tracker.listeners += 1;
          }
          return originalAdd.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
          const record = listeners.find(candidate => (
            candidate.active && candidate.target === this && candidate.type === type && candidate.listener === listener
          ));
          if (record) {
            record.active = false;
            tracker.listeners -= 1;
          }
          return originalRemove.call(this, type, listener, options);
        };
        const activeIntervals = new Set();
        const originalSetInterval = window.setInterval;
        const originalClearInterval = window.clearInterval;
        window.setInterval = function(...args) {
          const timer = originalSetInterval.apply(this, args);
          activeIntervals.add(timer);
          tracker.intervals = activeIntervals.size;
          return timer;
        };
        window.clearInterval = function(timer) {
          activeIntervals.delete(timer);
          tracker.intervals = activeIntervals.size;
          return originalClearInterval.call(this, timer);
        };
      })();
    ` });
}

async function legacyResourceCounts(page: Page): Promise<{ listeners: number; intervals: number }> {
  return page.evaluate(() => {
    const tracker = (window as Window & {
      __legacyResourceTracker?: { listeners: number; intervals: number };
    }).__legacyResourceTracker;
    if (!tracker) throw new Error("Legacy resource tracker was not installed");
    return { ...tracker };
  });
}

async function withBrowserHost(
  bundle: string | undefined,
  run: (page: Page) => Promise<void>,
  prepare?: (page: Page) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === legacyViewBundlePath) {
      if (bundle === undefined) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("missing");
      } else {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(bundle);
      }
      return;
    }
    if (url.pathname === viewSdkBundlePath) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(viewSdkBundle);
      return;
    }
    if (url.pathname === viewRuntimeBundlePath) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(viewRuntimeBundle);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(renderViewHostHtml("en"));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await prepare?.(page);
    await page.goto(origin);
    await run(page);
  } finally {
    await browser.close();
    await close(server);
  }
}

function pluginSource(body: string): string {
  return `
    import { defineViewPlugin, slots } from "@memsphere/view-sdk";
    export default defineViewPlugin({
      name: "synthetic",
      apiVersion: 1,
      inject: ["slots"],
      ${body}
    });
  `;
}

async function transpileBrowserModule(relativePath: string): Promise<string> {
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
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
