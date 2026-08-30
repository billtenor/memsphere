import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const memoryBundlePath = "/assets/builtin/org.memsphere.memory.js";

test("Memory builtin independently registers its route pages and renders Memory detail", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(),
    browserModule("../src/view/view-sdk.ts"),
    browserModule("../src/view/view-runtime.ts")
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: {
      projectId: "demo",
      moduleId: "org.memsphere.memory",
      moduleVersion: "0.1.2",
      instanceId: "memory"
    }
  }];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [] });
    if (url.pathname === "/api/memories") return json(response, {
      memories: [{ id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", names: ["demo-memory"], system: false }]
    });
    if (url.pathname === "/api/memories/concepts/demo-memory") return json(response, {
      memory: { id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", entity: { names: ["Demo Memory"], defines: ["Independent builtin detail"] } }
    });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/memories/concepts/demo-memory`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Memory", exact: true, level: 2 }).waitFor();
    assert.match(await page.locator(".memory-workspace").innerText(), /Independent builtin detail/);
    assert.equal(await page.locator(".memory-module").count(), 1);
    assert.equal(await page.locator(".memory-source-tabs").count(), 1);
  } finally {
    await browser.close();
    await close(server);
  }
});

test("Memory builtin renders Market status and opens an importing ChangeSet", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildMemoryBundle(), browserModule("../src/view/view-sdk.ts"), browserModule("../src/view/view-runtime.ts")
  ]);
  const instances: ViewHostBootInstance[] = [{
    pluginPath: memoryBundlePath,
    routeBasePath: "/",
    module: { projectId: "demo", moduleId: "org.memsphere.memory", moduleVersion: "0.1.2", instanceId: "memory" }
  }];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/changes") return json(response, { changes: [{ id: "change-market", status: "active", memoryPaths: [] }] });
    if (url.pathname === "/api/memories") return json(response, { memories: [] });
    if (url.pathname === "/api/market/memories") return json(response, { memories: [{ reference: "concepts/market-memory", kind: "concepts", status: "importing", changeId: "change-market", entity: { names: ["Market Memory"], defines: ["Market content"] } }] });
    if (url.pathname === "/api/changes/change-market") return json(response, { change: { id: "change-market", status: "active", memoryPaths: [] }, targetMemories: [], comments: [] });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/market`, { waitUntil: "networkidle" });
    const market = page.getByRole("button", { name: /Market Memory.*Importing/ });
    await market.waitFor();
    await market.click();
    await page.waitForURL(`${origin}/projects/demo/changes/change-market`);
    await page.getByRole("heading", { name: "change-market", exact: true }).waitFor();
  } finally {
    await browser.close();
    await close(server);
  }
});

async function buildMemoryBundle(): Promise<string> {
  const result = await build({
    entryPoints: [new URL("../modules/org.memsphere.memory/adapter/view/index.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["@memsphere/view-sdk"],
    logLevel: "silent"
  });
  return result.outputFiles[0]?.text ?? "";
}

async function browserModule(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
}

function send(response: import("node:http").ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": `${contentType}; charset=utf-8` }); response.end(body);
}
function json(response: import("node:http").ServerResponse, body: unknown): void { send(response, 200, "application/json", JSON.stringify(body)); }
async function listen(server: Server): Promise<string> { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
