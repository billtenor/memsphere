import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const sdk = transpile(await readFile(new URL("../src/view/view-sdk.ts", import.meta.url), "utf8"));
const runtime = transpile(await readFile(new URL("../src/view/view-runtime.ts", import.meta.url), "utf8"));
const plugin = (await build({
  entryPoints: [resolve("modules/org.memsphere.settings/adapter/view/index.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["@memsphere/view-sdk"]
})).outputFiles[0]!.text;

test("Settings Builtin Mount loads both scopes and validates an edited global draft", async () => {
  let validated: unknown;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/assets/view-sdk.js") return javascript(response, sdk);
    if (path === "/assets/view-runtime.js") return javascript(response, runtime);
    if (path === "/assets/settings.js") return javascript(response, plugin);
    if (path === "/api/settings/meta") return json(response, { requiresToken: false });
    if (path === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (path === "/api/settings/global") return json(response, globalSettings());
    if (path === "/api/settings/project") return json(response, projectSettings());
    if (path === "/api/settings/global/validate") {
      validated = await requestBody(request);
      return json(response, {
        valid: true,
        changes: [{ path: "language", kind: "changed", before: "zh-CN", after: "en" }],
        normalizedJson: JSON.stringify({ language: "en" }, null, 2)
      });
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(harness());
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/settings/overview`);
    await page.getByRole("heading", { name: "Memsphere 设置", exact: true }).waitFor();
    assert.match(await page.locator("#settings-status").textContent() ?? "", /没有未保存修改/);
    await page.getByRole("button", { name: "常规", exact: true }).click();
    await page.waitForURL("**/settings/general");
    await page.locator('.settings-nav-item[data-section="general"][aria-current="page"]').waitFor();
    await page.evaluate(() => {
      document.body.style.minHeight = "2000px";
      scrollTo(0, 600);
    });
    assert(await page.evaluate(() => scrollY > 0));
    await page.getByRole("button", { name: "界面服务", exact: true }).click();
    await page.waitForURL("**/settings/view");
    await page.locator('.settings-nav-item[data-section="view"][aria-current="page"]').waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.getByRole("button", { name: "常规", exact: true }).click();
    await page.waitForURL("**/settings/general");
    await page.locator('.settings-nav-item[data-section="general"][aria-current="page"]').waitFor();
    const language = page.getByRole("combobox", { name: "工作语言", exact: true });
    await language.click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    assert.equal((await language.textContent())?.trim(), "English⌄");
    assert.match(await page.locator("#settings-status").textContent() ?? "", /未保存修改/);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("heading", { name: "确认配置变更", exact: true }).waitFor();
    assert.deepEqual(validated, { expectedRevision: "sha256:global", config: { language: "en" } });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

function harness(): string {
  return `<!doctype html><html><body><main id="root"></main>
    <script type="importmap">{"imports":{"@memsphere/view-sdk":"/assets/view-sdk.js"}}</script>
    <script type="module">
      import { startViewHost } from "/assets/view-runtime.js";
      import plugin from "/assets/settings.js";
      window.activeSettingsHost = await startViewHost({ root: document.getElementById("root"), instances: [{
        plugin, config: { locale: "zh-CN", messages: {} }, routeBasePath: "/",
        module: { projectId: "memsphere", moduleId: "org.memsphere.settings", moduleVersion: "1.0.0", instanceId: "settings" }
      }]});
    </script></body></html>`;
}

function globalSettings(): Record<string, unknown> {
  return {
    diskRevision: "sha256:global",
    runningRevision: "sha256:global",
    restartRequired: false,
    configPath: "/home/config.json",
    config: { language: "zh-CN" },
    defaults: { view: { host: "127.0.0.1", port: 3000 } },
    acpProviderCatalog: [],
    providerReferences: {}
  };
}

function projectSettings(): Record<string, unknown> {
  return {
    projectName: "demo",
    diskRevision: "sha256:project",
    configPath: "/projects/demo/config.json",
    config: {},
    defaults: {},
    store: { type: "managed" },
    resolvedPaths: { memoryRoot: "/memory", runsRoot: "/runs", archiveRoot: "/archives" },
    permissionCatalog: []
  };
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  let value = "";
  for await (const chunk of request) value += chunk;
  return JSON.parse(value);
}

function javascript(response: ServerResponse, source: string): void {
  response.writeHead(200, { "content-type": "text/javascript" });
  response.end(source);
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function transpile(source: string): string {
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
}
