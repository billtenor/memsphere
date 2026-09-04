import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const syntheticBundlePath = "/assets/modules/org.example.synthetic/index.js";
const syntheticRouteKey = "org.example.synthetic@1.0.0:synthetic:route:index";

const viewSdkBundle = await transpileBrowserModule("../src/view/view-sdk.ts");
const systemIconBundle = await transpileBrowserModule("../src/view/system-icon.ts");
const viewRuntimeBundle = await browserRuntimeBundle();

test("ViewHost document boots the four builtin Module instances in catalog order", () => {
  const instances = builtinModuleCatalog.map(entry => bootInstance(
    entry.moduleId,
    entry.instanceId,
    `/assets/modules/${entry.moduleId}/index.js`,
    entry.routes
  ));
  const html = renderViewHostHtml("en", instances);
  const bootSource = html.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(bootSource);
  const boot = JSON.parse(bootSource);

  assert.equal(boot.locale, "en");
  assert.equal(boot.runtimePath, viewRuntimeBundlePath);
  assert.deepEqual(
    boot.instances.map((instance: { module: { moduleId: string } }) => instance.module.moduleId),
    builtinModuleCatalog.map(entry => entry.moduleId)
  );
  assert.deepEqual(boot.instances.map((instance: { routeGrants: unknown }) => instance.routeGrants), builtinModuleCatalog.map(entry => entry.routes));
  assert.equal(boot.messages["common.refresh"], "Refresh");
  assert.match(html, /id="memsphere-view-root"/);
  assert.match(html, /"@memsphere\/view-sdk":"\/assets\/view-sdk\.js"/);
  assert.match(html, /import\(instance\.pluginPath\)/);
  assert.match(html, /runtimeModule\.startViewHost/);
  assert.doesNotMatch(html, /legacy-view\.js|org\.memsphere\.legacy-view/);
});

test("View server serves Host, SDK, Runtime, and all builtin bundles without serving retired assets", async () => {
  const server = createViewServer({ language: "en" } as MemsphereConfig);
  const origin = await listen(server);
  try {
    const pageResponse = await fetch(`${origin}/memories`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html/);
    const host = await pageResponse.text();
    assert.match(host, /data-view-host-state="loading"/);
    const bootSource = host.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    assert(bootSource);
    const boot = JSON.parse(bootSource);
    assert.equal(boot.instances.length, 4);
    for (const instance of boot.instances) {
      const bundleResponse = await fetch(`${origin}${instance.pluginPath}`);
      assert.equal(bundleResponse.status, 200, instance.pluginPath);
      assert.match(bundleResponse.headers.get("content-type") ?? "", /^text\/javascript/);
      assert.match(await bundleResponse.text(), /defineViewPlugin/);
    }

    const sdkResponse = await fetch(`${origin}${viewSdkBundlePath}`);
    assert.equal(sdkResponse.status, 200);
    assert.match(await sdkResponse.text(), /export const slots/);

    const runtimeResponse = await fetch(`${origin}${viewRuntimeBundlePath}`);
    assert.equal(runtimeResponse.status, 200);
    assert.match(await runtimeResponse.text(), /export async function startViewHost/);

    const themeResponse = await fetch(`${origin}/assets/theme.js`);
    assert.equal(themeResponse.status, 200);
    assert.match(await themeResponse.text(), /export class RuntimeThemeStore/);

    const uiResponse = await fetch(`${origin}/assets/ui-primitives.js`);
    assert.equal(uiResponse.status, 200);
    assert.match(await uiResponse.text(), /export function createViewUi/);

    const iconResponse = await fetch(`${origin}/assets/system-icon.js`);
    assert.equal(iconResponse.status, 200);
    assert.match(await iconResponse.text(), /export function normalizeSystemIconName/);

    const referenceResponse = await fetch(`${origin}/assets/modules/org.memsphere.reference/index.js`);
    assert.equal(referenceResponse.status, 200);

    const retiredResponse = await fetch(`${origin}/assets/legacy-view.js`);
    assert.equal(retiredResponse.status, 404);

    const missingResponse = await fetch(`${origin}/assets/unknown-view.js`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await close(server);
  }
});

test("View server can expose an additional Module through explicit development options", async () => {
  const assetPath = "/assets/dev-modules/org.example.development.js" as const;
  const instance = bootInstance("org.example.development", "development", assetPath, [{ id: "index", path: "/development" }]);
  const source = 'export default { apiVersion: 1, inject: [], apply() {} };';
  const server = createViewServer({ language: "en" } as MemsphereConfig, {
    developmentModules: [{ assetPath, source, instance, pagePaths: ["/development"] }]
  });
  const origin = await listen(server);
  try {
    const pageResponse = await fetch(`${origin}/development`);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    const bootSource = page.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    assert(bootSource);
    const boot = JSON.parse(bootSource);
    assert.equal(boot.instances.at(-1)?.module.moduleId, "org.example.development");
    assert.equal(boot.instances.at(-1)?.pluginPath, assetPath);

    const assetResponse = await fetch(`${origin}${assetPath}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(await assetResponse.text(), source);
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
          key: route.key,
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
    await assertModuleFailure(page, /could not be imported/i);
  });
});

test("ViewHost shows a diagnostic when the bundle cannot be imported", async () => {
  await withBrowserHost("export function mount(", async page => {
    await assertModuleFailure(page, /could not be imported/i);
  });
});

test("ViewHost shows a diagnostic when the bundle has no default Plugin", async () => {
  await withBrowserHost("export const loaded = true;", async page => {
    await assertModuleFailure(page, "View bundle does not default export a View Plugin");
  });
});

test("ViewHost rejects an incompatible View Plugin API before apply", async () => {
  await withBrowserHost(
    'export default { apiVersion: 2, inject: [], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await assertModuleFailure(page, "Unsupported View Plugin API version: 2");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
});

test("ViewHost rejects a Plugin service that is not wired into the current Context", async () => {
  await withBrowserHost(
    'export default { apiVersion: 1, inject: ["api"], apply() {} };',
    async page => {
      await assertModuleFailure(page, "View Plugin requests unsupported service: api");
    }
  );
});

test("ViewHost requires Theme injection and Theme v1 support to be declared together", async () => {
  await withBrowserHost(
    'export default { apiVersion: 1, inject: ["theme"], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await assertModuleFailure(page, "View Plugin requests theme but does not support Host Theme version 1");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
  await withBrowserHost(
    'export default { apiVersion: 1, themeVersion: 1, inject: [], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await assertModuleFailure(page, "View Plugin declares themeVersion without injecting theme");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
});

test("ViewHost requires UI injection and UI v1 support to be declared together", async () => {
  await withBrowserHost(
    'export default { apiVersion: 1, inject: ["ui"], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await assertModuleFailure(page, "View Plugin requests ui but does not support Host UI version 1");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
  await withBrowserHost(
    'export default { apiVersion: 1, uiVersion: 1, inject: [], apply() { window.__unexpectedApply = true; } };',
    async page => {
      await assertModuleFailure(page, "View Plugin declares uiVersion without injecting ui");
      assert.equal(await page.evaluate(() => (window as Window & { __unexpectedApply?: boolean }).__unexpectedApply), undefined);
    }
  );
});

test("ViewHost shows the apply error thrown by a loaded Plugin", async () => {
  await withBrowserHost(
    pluginSource('apply() { throw new Error("synthetic apply failed"); }'),
    async page => {
      await assertModuleFailure(page, "synthetic apply failed");
    }
  );
});

test("ViewHost shows a diagnostic when Plugin does not register the active main.view", async () => {
  await withBrowserHost(pluginSource("apply() {}"), async page => {
    await assertModuleFailure(page, `ViewHost has no main.view for key: ${syntheticRouteKey}`);
  });
});

test("ViewHost rejects a conflicting keyed main.view registration atomically", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        const value = { mount() {} };
        context.slots.register(slots.mainView, { id: "first", key: route.key, value });
        context.slots.register(slots.mainView, { id: "second", key: route.key, value });
      }
    `),
    async page => {
      await assertModuleFailure(page, `Slot Entry conflicts in main.view@1: ${syntheticRouteKey}`);
    }
  );
});

test("ViewHost rejects a main.view value that does not satisfy its Mount contract", async () => {
  await withBrowserHost(
    pluginSource(`
      apply(context) {
        context.slots.register(slots.mainView, { id: "page", key: route.key, value: {} });
      }
    `),
    async page => {
      await assertModuleFailure(page, "Slot main.view@1 rejected Entry value");
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
          key: route.key,
          value: { mount() {} }
        });
        throw new Error("rollback apply");
      }
    `),
    async page => {
      await assertModuleFailure(page, "rollback apply");
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
          key: route.key,
          value: { mount() { throw new Error("synthetic mount failed"); } }
        });
      }
    `),
    async page => {
      await assertModuleFailure(page, "synthetic mount failed");
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
          key: route.key,
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

async function withBrowserHost(
  bundle: string | undefined,
  run: (page: Page) => Promise<void>,
  prepare?: (page: Page) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === syntheticBundlePath) {
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
    if (url.pathname === "/assets/system-icon.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(systemIconBundle);
      return;
    }
    if (url.pathname === viewRuntimeBundlePath) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(viewRuntimeBundle);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(renderViewHostHtml("en", [bootInstance(
      "org.example.synthetic",
      "synthetic",
      syntheticBundlePath,
      [{ id: "index", path: "/synthetic" }]
    )]));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await prepare?.(page);
    await page.goto(`${origin}/synthetic`);
    await run(page);
  } finally {
    await browser.close();
    await close(server);
  }
}

async function assertModuleFailure(page: Page, expected: string | RegExp): Promise<void> {
  await page.locator('html[data-view-host-state="ready"]').waitFor();
  const diagnostic = page.locator('.view-host-module-error[data-view-failed-module="org.example.synthetic"]');
  await diagnostic.waitFor();
  assert.match(await diagnostic.locator("h2").textContent() ?? "", /^org\.example\.synthetic(?: page)? failed to load$/);
  const message = (await diagnostic.locator("p").textContent()) ?? "";
  if (typeof expected === "string") assert.equal(message, expected);
  else assert.match(message, expected);
}

async function browserRuntimeBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/view/view-runtime.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    external: ["@memsphere/view-sdk", "./view-sdk.js"], logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

function bootInstance(
  moduleId: string,
  instanceId: string,
  pluginPath: string,
  routeGrants: readonly { id: string; path: string; aliases?: readonly string[] }[]
): ViewHostBootInstance {
  return {
    pluginPath,
    routeGrants,
    module: { projectId: "memsphere", moduleId, moduleVersion: "1.0.0", instanceId }
  };
}

function pluginSource(body: string): string {
  const routedBody = body.replace(
    /apply\(([^)]*)\)\s*\{/,
    'apply(context) { const route = context.router.register({ id: "index", path: "/synthetic" });'
  );
  return `
    import { defineViewPlugin, slots } from "@memsphere/view-sdk";
    export default defineViewPlugin({
      name: "synthetic",
      apiVersion: 1,
      inject: ["slots", "router"],
      ${routedBody}
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
