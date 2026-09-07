import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createViewServer } from "../src/commands/view.js";
import { readProjectConfig } from "../src/config.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import { startRun } from "../src/run/store.js";
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
    assert.deepEqual(await page.locator("details.memory-collapsible-list").first().evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, border: style.borderStyle, shadow: style.boxShadow };
    }), { background: "rgba(0, 0, 0, 0)", border: "none", shadow: "none" });
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
    plan: [{
      id: "step-1", kind: "action", instruction: "Inspect default style",
      artifact: { name: "report", type: "object", format: { name: "markdown", options: {} }, final: true, review: "artifact_acceptance.unanimous" }
    }],
    events: [],
    reviewConfiguration: { slots: { "default-style::reviewer": { actorIds: ["human"] } } },
    controlPlane: { actors: { human: { kind: "human", name: "Human" } } }
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
    const artifactSummary = page.locator(".run-detail-content .mem-content-artifact-summary").first();
    const artifactDetails = artifactSummary.locator(":scope > .mem-content-artifact-details");
    assert.equal(await artifactDetails.evaluate(node => getComputedStyle(node).visibility), "hidden");
    assert.equal(await artifactSummary.evaluate(node => {
      (node as HTMLElement).focus();
      return document.activeElement === node;
    }), true);
    await artifactDetails.waitFor({ state: "visible" });
    assert.equal(await artifactDetails.evaluate(node => getComputedStyle(node).visibility), "visible");
    const reviewSummary = page.locator(".run-detail-content .mem-content-review-summary").first();
    const reviewDetails = reviewSummary.locator(":scope > .mem-content-review-details");
    assert.equal(await reviewDetails.evaluate(node => getComputedStyle(node).visibility), "hidden");
    await reviewSummary.hover();
    await reviewDetails.waitFor({ state: "visible" });
    assert.equal(await reviewDetails.evaluate(node => getComputedStyle(node).visibility), "visible");
  });
});

test("a selected global View Package overrides Memory and Run defaults after route remounts", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-default-style-package-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const memoryRoot = join(projectRoot, "memory");
  const runsRoot = join(projectRoot, "runs");
  const packageRoot = join(temporary, "global-style-package");
  const packageId = "org.example.memsphere.default-style-override";
  const styleSource = `${packageId}:${packageId}:override`;
  await mkdir(join(memoryRoot, "statements"), { recursive: true });
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(memoryRoot, "statements", "default-style.yaml"), `!statement
syntax: ${currentMemorySyntax}
names: [default-style, Default style]
defines: [Visible content]
sections:
  - !statement
    names: [Nested section]
    asserts: [Nested rule]
`);
  await writeFile(join(memoryRoot, "procedures", "style-procedure.yaml"), `!procedure
syntax: ${currentMemorySyntax}
names: [style-procedure, Style procedure]
flow:
  - !action
    action: Inspect global style.
    artifact: !artifact
      name: report
      format: markdown
`);
  const run = await startRun({ name: "Style run", memoryRoot, runsRoot, procedureName: "style-procedure" });
  await writeFile(join(packageRoot, "index.js"), `import { defineViewPlugin } from "@memsphere/view-sdk";
export default defineViewPlugin({ name: "default-style-override", apiVersion: 1, inject: [], apply() {} });
`);
  await writeFile(join(packageRoot, "override.css"), `
.memory-module .memory-section.memory-node.memory-statement-document { border-left: 7px solid rgb(201, 75, 64); }
.run-module .mem-content-document .run-step { border: 7px solid rgb(201, 75, 64); }
`);
  await writeFile(join(packageRoot, "module.json"), JSON.stringify({
    schemaVersion: 1, id: packageId, version: "1.0.0",
    view: {
      entry: "./index.js", sdk: "^1.0.0", capabilities: ["styles.global"],
      styles: [{ id: "override", file: "./override.css", scope: "global" }]
    }
  }));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({
    language: "en", view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_composition: {
      packages: [{ id: packageId, version: "1.0.0", enabled: true }],
      slots: { "styles.global@1": [styleSource] }
    }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "test" }
  }));
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({
    format_version: 1, name: "demo", created_at: new Date(0).toISOString()
  }));
  await writeFile(join(home, "registry.json"), JSON.stringify({
    format_version: 1, projects: { demo: { root: projectRoot } }, workspaces: {}
  }));

  const server = createViewServer(await readProjectConfig("demo", home));
  try {
    await withBrowserPage(server, async (origin, page) => {
      const expectOverride = async (selector: string) => {
        const target = page.locator(selector).first();
        await target.waitFor({ timeout: 5_000 }).catch(async () => assert.fail(await page.locator("body").innerText()));
        const actual = await target.evaluate(node => {
          const style = getComputedStyle(node);
          return { color: style.borderLeftColor, style: style.borderLeftStyle, width: style.borderLeftWidth };
        });
        assert.deepEqual(actual, { color: "rgb(201, 75, 64)", style: "solid", width: "7px" });
      };

      await page.goto(`${origin}/projects/demo/memories/statements/default-style`, { waitUntil: "networkidle" });
      await page.locator(".memory-module").waitFor().catch(async () => assert.fail(await page.locator("body").innerText()));
      assert.equal(await page.locator('style[data-view-package-scope="global"]').count(), 1, JSON.stringify(
        await page.evaluate(() => (window as Window & { __memsphereViewDiagnostics?: () => unknown }).__memsphereViewDiagnostics?.())
      ));
      await expectOverride(".memory-section.memory-node.memory-statement-document");
      assert.equal(await page.locator('style[data-view-package-scope="global"]').evaluate(node => node.parentElement?.tagName), "BODY");

      await page.getByRole("button", { name: "Runs", exact: true }).click();
      await page.getByRole("button", { name: /Style run/ }).first().click();
      await page.locator(".run-step").waitFor().catch(async () => assert.fail(await page.locator("body").innerText()));
      await expectOverride(".run-step");

      await page.getByRole("button", { name: "Memory", exact: true }).click();
      await page.getByRole("button", { name: /Default style/ }).first().click();
      await page.locator(".memory-module").waitFor().catch(async () => assert.fail(await page.locator("body").innerText()));
      await expectOverride(".memory-section.memory-node.memory-statement-document");
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
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
