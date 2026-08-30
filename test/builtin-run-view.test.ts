import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import { renderViewHostHtml, viewRuntimeBundlePath, viewSdkBundlePath, type ViewHostBootInstance } from "../src/view/host.js";

const bundlePath = "/assets/modules/org.memsphere.run/index.js";

test("Run builtin renders a deep-linked Run and opens its Artifact Review", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildRunBundle(), browserModule("../src/view/view-sdk.ts"), browserModule("../src/view/view-runtime.ts")
  ]);
  const catalog = builtinModuleCatalog.find(entry => entry.moduleId === "org.memsphere.run")!;
  const instances: ViewHostBootInstance[] = [{
    pluginPath: bundlePath, routeGrants: catalog.routes,
    module: { projectId: "demo", moduleId: catalog.moduleId, moduleVersion: "0.1.2", instanceId: catalog.instanceId }
  }];
  const run = {
    id: "run-demo", name: "Demo Run", procedureName: "demo-procedure", status: "running",
    updatedAt: "2026-08-30T00:00:00.000Z",
    stack: [{ type: "procedure", index: 0, steps: [{ id: "step-1", instruction: "Inspect the result", artifact: "report" }] }],
    assertTree: { entries: [{ kind: "reference", target: "statements/run-rules", entries: [{ kind: "rule", text: "Keep evidence." }] }], sections: [] },
    plan: [{
      id: "step-1", kind: "branch", instruction: "Inspect the result", artifact: { name: "report", type: "object", format: { name: "markdown", options: { layout: "outline" } }, final: true },
      branches: {
        truthy: [{ id: "step-child", kind: "action", instruction: "Follow the accepted branch", artifact: "child result" }],
        falsy: [{ id: "step-fallback", kind: "call", target: "fallback-procedure" }]
      }
    }, { id: "step-loop", kind: "loop", instruction: "Repeat checks", artifact: "condition", loop: { body: [] } }],
    events: [{ stepId: "step-1", frame: "procedure", at: "2026-08-30T00:00:00.000Z", artifact: { name: "report", type: "object", format: { name: "markdown" }, final: true, renderedContent: "<p>Rendered report</p>" } }],
    schemaWriting: { parentStepId: "step-1", progress: { completed: 1, total: 2, remaining: 1 }, currentField: { path: "report.summary", sources: [] }, draft: { status: "awaiting_finalization", filePath: "/tmp/report.md", validation: { status: "passed" }, renderedContent: "<p>Managed draft</p>" } },
    reviewConfiguration: { slots: { "demo-procedure::reviewer": { actorIds: ["human"] } } },
    controlPlane: { actors: { human: { kind: "human", name: "Human" } } },
    artifactReview: { id: "review-1", currentRoundId: "round-1", round: { id: "round-1", submitted: 0, total: 1, assignments: [] } }
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === bundlePath) return send(response, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
    if (url.pathname === "/api/runs") return json(response, { runs: [{ ...run, eventCount: 0 }] });
    if (url.pathname === "/api/runs/run-demo") return json(response, { run });
    if (url.pathname === "/api/runs/run-demo/artifact-reviews/review-1/rounds/round-1") return json(response, {
      review: { id: "review-1", currentRoundId: "round-1", status: "pending", round: { id: "round-1", revision: 1, status: "collecting", assignments: [] } },
      submission: { id: "submission-1", artifact: { name: "report", value: "Review this artifact" } }, assignment: null
    });
    return send(response, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server); const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/tasks/run-demo`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Run", level: 1 }).waitFor();
    assert.match(await page.locator(".run-workspace").innerText(), /Inspect the result/);
    assert.equal(await page.locator(".flow-item.branch").count(), 2);
    assert.equal(await page.locator(".flow-item.call").count(), 1);
    assert.equal(await page.locator('[data-current-task-step="true"]').getAttribute("data-step-id"), "step-1");
    assert.match(await page.locator(".schema-writing").innerText(), /Managed draft/);
    assert.match(await page.locator(".run-procedure-asserts").innerText(), /run-rules/);
    await page.locator(".run-binding-toggle").click();
    assert.match(await page.locator(".run-binding-body").innerText(), /Human/);
    assert.match(await page.locator(".task-result").first().innerText(), /Rendered report/);
    await page.getByRole("button", { name: /Artifact review/ }).click();
    await page.locator("#artifact-review-modal[open]").waitFor();
    assert.match(await page.locator("#artifact-review-artifact-pane").innerText(), /Review this artifact/);
    assert.equal(new URL(page.url()).pathname, "/tasks/run-demo/artifact-reviews/review-1");
  } finally { await browser.close(); await close(server); }
});

async function buildRunBundle(): Promise<string> {
  const result = await build({ entryPoints: [new URL("../modules/org.memsphere.run/adapter/view/index.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}
async function browserModule(path: string): Promise<string> { const source=await readFile(new URL(path,import.meta.url),"utf8");return transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText; }
function send(response:ServerResponse,type:string,body:string):void{response.writeHead(200,{"content-type":`${type}; charset=utf-8`});response.end(body);}function json(response:ServerResponse,body:unknown):void{send(response,"application/json",JSON.stringify(body));}
async function listen(server:Server):Promise<string>{await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}async function close(server:Server):Promise<void>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
