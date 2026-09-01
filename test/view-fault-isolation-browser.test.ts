import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../src/view/host.js";

const memoryBundlePath = "/assets/modules/org.memsphere.memory/index.js";
const runBundlePath = "/assets/modules/org.memsphere.run/index.js";

test("Memory builtin keeps valid Memory usable and isolates an unavailable ChangeSet detail", async () => {
  await withBuiltinFixture(["org.memsphere.memory"], async ({ page, origin }) => {
    await page.goto(`${origin}/memories`);
    await assertHostReady(page);
    const initialBody = await page.locator("body").innerText();
    assert.match(initialBody, /demo-memory/, initialBody);
    assert.equal(await page.getByText("invalid persisted ChangeSet", { exact: false }).count(), 0);
    await page.locator("summary.memory-related").click();
    await page.getByRole("button", { name: /change-invalid/ }).click();
    await page.waitForURL(url => url.pathname === "/projects/demo/changes/change-invalid");
    assert.equal(new URL(page.url()).searchParams.get("section"), "project");
    await page.locator(".memory-error").waitFor();
    assert.match(await page.locator(".memory-error").textContent() ?? "", /invalid persisted ChangeSet/);
    assert.equal(await page.getByText("Failed to load Memsphere", { exact: true }).count(), 0);
  });
});

test("a failed Run detail remains local to the Run page instead of failing ViewHost", async () => {
  await withBuiltinFixture(["org.memsphere.run"], async ({ page, origin }) => {
    await page.goto(`${origin}/tasks`);
    await assertHostReady(page);
    await page.getByRole("button", { name: /Invalid historical Run/ }).click();
    await page.locator(".run-error").waitFor();
    assert.match(await page.locator(".run-error").textContent() ?? "", /invalid persisted Run detail/);
    assert.equal(await page.locator('html[data-view-host-state="failed"]').count(), 0);
  });
});

async function withBuiltinFixture(
  moduleIds: readonly string[],
  run: (fixture: { page: import("playwright").Page; origin: string }) => Promise<void>
): Promise<void> {
  const [bundles, sdk, runtime] = await Promise.all([
    Promise.all(moduleIds.map(async moduleId => [moduleId, await bundle(moduleId)] as const)),
    browserModule("../src/view/view-sdk.ts"),
    browserRuntimeBundle()
  ]);
  const bundleByModule = new Map(bundles);
  const selected = builtinModuleCatalog.filter(entry => moduleIds.includes(entry.moduleId));
  const instances: ViewHostBootInstance[] = selected.map(entry => ({
    pluginPath: entry.moduleId === "org.memsphere.memory" ? memoryBundlePath : runBundlePath,
    routeGrants: entry.routes,
    module: { projectId: "demo", moduleId: entry.moduleId, moduleVersion: "0.1.2", instanceId: entry.instanceId }
  }));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === memoryBundlePath) return send(response, 200, "text/javascript", bundleByModule.get("org.memsphere.memory") ?? "");
    if (url.pathname === runBundlePath) return send(response, 200, "text/javascript", bundleByModule.get("org.memsphere.run") ?? "");
    if (url.pathname === viewSdkBundlePath) return send(response, 200, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, 200, "text/javascript", runtime);
    if (url.pathname === "/api/projects") return json(response, 200, { current: "demo", projects: [{ name: "demo" }] });
    if (url.pathname === "/api/memories") return json(response, 200, { memories: [{ id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", names: ["demo-memory"], system: false }] });
    if (url.pathname === "/api/memories/concepts/demo-memory") return json(response, 200, { memory: { id: "concepts/demo-memory", kind: "concepts", path: "concepts/demo-memory.yaml", entity: { names: ["demo-memory"], defines: ["A valid Memory remains visible."] } } });
    if (url.pathname === "/api/changes") return json(response, 200, { changes: [{ id: "change-invalid", status: "unavailable", active: false, memoryPaths: [], error: "invalid persisted ChangeSet" }] });
    if (url.pathname === "/api/changes/change-invalid") return json(response, 500, { error: "invalid persisted ChangeSet" });
    if (url.pathname === "/api/runs" && url.searchParams.get("representation") === "summary") return json(response, 200, { runs: [{ id: "run-invalid-detail", name: "Invalid historical Run", status: "running", procedureName: "procedure", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", readOnly: false, eventCount: 1 }] });
    if (url.pathname === "/api/runs/run-invalid-detail") return json(response, 500, { error: "invalid persisted Run detail" });
    return send(response, 200, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await run({ page, origin });
  } finally {
    await browser.close();
    await close(server);
  }
}

async function bundle(packageDirectory: string): Promise<string> {
  const result = await build({ entryPoints: [`modules/${packageDirectory}/adapter/view/index.ts`], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}

async function assertHostReady(page: import("playwright").Page): Promise<void> {
  await page.locator('html[data-view-host-state="ready"]').waitFor();
}

async function browserModule(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
}


async function browserRuntimeBundle(): Promise<string> {
  const result = await build({ entryPoints: ["src/view/view-runtime.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk", "./view-sdk.js"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}

function send(response: import("node:http").ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8` }); response.end(body);
}
function json(response: import("node:http").ServerResponse, status: number, body: unknown): void { send(response, status, "application/json", JSON.stringify(body)); }
async function listen(server: Server): Promise<string> { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function close(server: Server): Promise<void> {
  server.close();
  server.closeAllConnections();
}
