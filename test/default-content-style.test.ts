import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { defaultContentStyles } from "../modules/shared/view/default-content-styles.js";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const memoryBundlePath = "/assets/builtin/org.memsphere.memory.js";
const runBundlePath = "/assets/builtin/org.memsphere.run.js";

test("Memory uses the system content style by default", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildBuiltinBundle("../modules/org.memsphere.memory/adapter/view/index.ts"),
    browserModule("../src/view/view-sdk.ts"),
    browserRuntimeBundle()
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
  }];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [] });
    if (url.pathname === "/api/memories") return json(response, {
      memories: [{ id: "statements/default-style", kind: "statements", path: "statements/default-style.yaml", names: ["Default style"], system: false }]
    });
    if (url.pathname.startsWith("/api/memories/")) return json(response, {
      memory: { id: "statements/default-style", kind: "statements", path: "statements/default-style.yaml", entity: { names: ["Default style"], defines: ["Visible content"], sections: [{ names: ["Nested section"], asserts: ["Nested rule"] }] } }
    });
    return send(response, "text/html", renderViewHostHtml("en", instances));
  });

  await withBrowserPage(server, async (origin, page) => {
    await page.goto(`${origin}/memories/statements/default-style`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Default style", exact: true, level: 1 }).waitFor();
    assert.deepEqual(await page.locator(".memory-section.memory-node").first().evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, borderLeft: style.borderLeftStyle, shadow: style.boxShadow };
    }), { background: "rgba(0, 0, 0, 0)", borderLeft: "none", shadow: "none" });
  });
});

test("Run uses the system content style by default", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildBuiltinBundle("../modules/org.memsphere.run/adapter/view/index.ts"),
    browserModule("../src/view/view-sdk.ts"),
    browserRuntimeBundle()
  ]);
  const catalog = builtinModuleCatalog.find(entry => entry.moduleId === "org.memsphere.run")!;
  const instances: ViewHostBootInstance[] = [{
    pluginPath: runBundlePath,
    routeGrants: catalog.routes,
    module: { projectId: "demo", moduleId: catalog.moduleId, moduleVersion: "0.1.2", instanceId: catalog.instanceId }
  }];
  const run = {
    id: "run-default-style", name: "Default style", procedureName: "default-style", status: "running", readOnly: true,
    updatedAt: "2026-09-07T00:00:00.000Z",
    stack: [{ type: "procedure", index: 0, steps: [{ id: "step-1", instruction: "Inspect default style", artifact: "report" }] }],
    assertTree: { entries: [], sections: [] },
    plan: [{ id: "step-1", kind: "action", instruction: "Inspect default style", artifact: "report" }],
    events: [], reviewConfiguration: { slots: {} }, controlPlane: { actors: {} }
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === runBundlePath) return send(response, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
    if (url.pathname === "/api/runs") return json(response, { runs: [{ ...run, eventCount: 0 }] });
    if (url.pathname === "/api/runs/run-default-style") return json(response, { run });
    return send(response, "text/html", renderViewHostHtml("en", instances));
  });

  await withBrowserPage(server, async (origin, page) => {
    await page.goto(`${origin}/tasks/run-default-style`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Default style", exact: true, level: 1 }).waitFor();
    assert.deepEqual(await page.locator(".run-step").first().evaluate(node => {
      const style = getComputedStyle(node);
      return { border: style.borderStyle, shadow: style.boxShadow };
    }), { border: "none", shadow: "none" });
  });
});

test("selected global View Package styles override the system content defaults", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <main>
        <style>${defaultContentStyles}</style>
        <section class="memory-module"><div class="memory-section memory-node"></div></section>
        <section class="run-module"><div class="run-panel"></div></section>
      </main>
      <style>
        .memory-module .memory-section.memory-node { border-left: 7px solid rgb(201, 75, 64); }
        .run-module .run-panel { border-left: 7px solid rgb(201, 75, 64); }
      </style>
    `);
    for (const selector of [".memory-section.memory-node", ".run-panel"]) {
      assert.deepEqual(await page.locator(selector).evaluate(node => {
        const style = getComputedStyle(node);
        return { color: style.borderLeftColor, style: style.borderLeftStyle, width: style.borderLeftWidth };
      }), { color: "rgb(201, 75, 64)", style: "solid", width: "7px" });
    }
  } finally {
    await browser.close();
  }
});

async function buildBuiltinBundle(relativePath: string): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))], bundle: true, write: false,
    format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

async function browserModule(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
}

async function browserRuntimeBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/view/view-runtime.ts", import.meta.url))], bundle: true, write: false,
    format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk", "./view-sdk.js"], logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

async function withBrowserPage(server: Server, run: (origin: string, page: import("playwright").Page) => Promise<void>): Promise<void> {
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    await run(origin, await browser.newPage());
  } finally {
    await browser.close();
    await close(server);
  }
}

function send(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, { "content-type": `${contentType}; charset=utf-8` });
  response.end(body);
}

function json(response: ServerResponse, body: unknown): void {
  send(response, "application/json", JSON.stringify(body));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
