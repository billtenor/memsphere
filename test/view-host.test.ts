import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { legacyViewBundle } from "../src/view/browser.js";
import { legacyViewBundlePath, renderViewHostHtml } from "../src/view/host.js";

test("ViewHost document delegates all business UI to one external bundle", () => {
  const html = renderViewHostHtml("en");
  const bootSource = html.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(bootSource);
  const boot = JSON.parse(bootSource);

  assert.equal(boot.locale, "en");
  assert.equal(boot.bundlePath, legacyViewBundlePath);
  assert.equal(boot.messages["common.refresh"], "Refresh");
  assert.match(html, /id="memsphere-view-root"/);
  assert.match(html, /await import\(boot\.bundlePath\)/);
  assert.doesNotMatch(html, /id="project-memory-tab"/);
  assert.doesNotMatch(html, /fetch\("\/api\/memories"\)/);
});

test("Legacy View bundle is a standalone ES module with one mount entry", async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(legacyViewBundle).toString("base64")}`;
  const loaded = await import(moduleUrl);
  assert.equal(typeof loaded.mount, "function");
  assert.equal((legacyViewBundle.match(/export function mount\(options\)/g) ?? []).length, 1);
  assert.match(legacyViewBundle, /project-memory-tab/);
  assert.match(legacyViewBundle, /fetch\("\/api\/memories\?/);
});

test("View server serves Host pages and the Legacy Bundle without absorbing unknown assets", async () => {
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
    assert.match(await bundleResponse.text(), /export function mount\(options\)/);

    const missingResponse = await fetch(`${origin}/assets/unknown-view.js`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await close(server);
  }
});

test("ViewHost mounts a successfully imported bundle", async () => {
  await withBrowserHost(
    "export function mount({ root }) { root.innerHTML = '<p id=\"synthetic-mounted\">mounted</p>'; }",
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

test("ViewHost shows a diagnostic when the bundle has no mount entry", async () => {
  await withBrowserHost("export const loaded = true;", async page => {
    await page.locator('html[data-view-host-state="failed"]').waitFor();
    assert.equal(
      await page.locator("#view-host-error p").textContent(),
      "View bundle does not export mount()"
    );
  });
});

test("ViewHost shows the mount error thrown by a loaded bundle", async () => {
  await withBrowserHost(
    'export function mount() { throw new Error("synthetic mount failed"); }',
    async page => {
      await page.locator('html[data-view-host-state="failed"]').waitFor();
      assert.equal(await page.locator("#view-host-error p").textContent(), "synthetic mount failed");
    }
  );
});

async function withBrowserHost(bundle: string | undefined, run: (page: Page) => Promise<void>): Promise<void> {
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
    response.writeHead(200, { "content-type": "text/html" });
    response.end(renderViewHostHtml("en"));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await run(page);
  } finally {
    await browser.close();
    await close(server);
  }
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
