import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import { renderViewHostHtml, viewRuntimeBundlePath, viewSdkBundlePath, type ViewHostBootInstance } from "../src/view/host.js";

const bundlePath = "/assets/modules/org.memsphere.run/index.js";

test("Run builtin renders a deep-linked Run and opens its Artifact Review", async () => {
  const [bundle, sdk, runtime] = await Promise.all([
    buildRunBundle(), browserModule("../src/view/view-sdk.ts"), browserRuntimeBundle()
  ]);
  const catalog = builtinModuleCatalog.find(entry => entry.moduleId === "org.memsphere.run")!;
  const instances: ViewHostBootInstance[] = [{
    pluginPath: bundlePath, routeGrants: catalog.routes,
    module: { projectId: "demo", moduleId: catalog.moduleId, moduleVersion: "0.1.2", instanceId: catalog.instanceId }
  }];
  const run = {
    id: "run-demo", name: "Demo Run", procedureName: "demo-procedure", status: "running", readOnly: true,
    updatedAt: "2026-08-30T00:00:00.000Z",
    stack: [{ type: "procedure", index: 0, steps: [{ id: "step-1", instruction: "Inspect the result", artifact: "report" }] }],
    assertTree: { entries: [{ kind: "reference", target: "statements/run-rules", entries: [{ kind: "rule", text: "Keep evidence." }] }], sections: [] },
    plan: [{
      id: "step-1", kind: "branch", instruction: "Inspect the result", artifact: { name: "report", type: "object", format: { name: "markdown", options: { layout: "outline" } }, final: true, review: "artifact_acceptance.unanimous" },
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
  let runDetailRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === bundlePath) return send(response, "text/javascript", bundle);
    if (url.pathname === viewSdkBundlePath) return send(response, "text/javascript", sdk);
    if (url.pathname === viewRuntimeBundlePath) return send(response, "text/javascript", runtime);
    if (url.pathname === "/api/runs") return json(response, { runs: [{ ...run, eventCount: 0 }] });
    if (url.pathname === "/api/runs/run-demo") { runDetailRequests += 1; return json(response, { run }); }
    if (url.pathname === "/api/runs/run-demo/artifact-reviews/review-1/rounds/round-1") {
      const assignment = {
        actorId: "human", actorName: "Human", actorKind: "human", binding: "decision", status: "submitted", draft: { comments: [] },
        submitted: { comments: [], vote: "approve", submittedAt: "2026-08-30T01:00:00.000Z", delegation: { kind: "runner", runId: "run-demo", humanActorId: "human", authorizationNote: "Human explicitly authorized this submission." } }
      };
      return json(response, {
        review: { id: "review-1", currentRoundId: "round-1", status: "awaiting_runner_vote", round: { id: "round-1", revision: 2, status: "awaiting_runner_vote", assignments: [assignment] } },
        rounds: [{ id: "round-1", sequence: 1, revision: 2, status: "awaiting_runner_vote", assignments: [assignment] }],
        submission: { id: "submission-1", artifact: { name: "report", value: "Review this artifact" } }, assignment
      });
    }
    return send(response, "text/html", renderViewHostHtml("en", instances));
  });
  const origin = await listen(server); const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/tasks/run-demo`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Demo Run", level: 1 }).waitFor();
    assert.match(await page.locator(".run-workspace").innerText(), /Inspect the result/);
    assert.equal(await page.locator(".run-procedure-asserts .mem-content-disclosure-title").innerText(), "Required rules");
    assert.equal(await page.locator("details.run-collapsible[open]").count(), 0, "Run fields are collapsed by default");
    const standaloneArtifact = page.locator("details.run-artifact").first();
    assert.equal(await standaloneArtifact.getAttribute("open"), null, "Run artifacts are collapsed by default");
    assert.equal(await standaloneArtifact.locator(".artifact-review-artifact-content").isVisible(), false);
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    assert.equal(await page.locator("details.run-collapsible:not([open])").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Collapse all", exact: true }).count(), 1);
    assert.equal(await page.locator(".mem-view-list-item.active").count(), 1);
    assert.equal(await page.locator(".mem-view-list-item-row:has(.mem-view-list-item.active) .mem-view-list-item-actions").count(), 0);
    assert.equal(await page.locator(".flow-item.branch").count(), 2);
    assert.equal(await page.locator(".flow-item.call").count(), 1);
    assert.equal(await page.locator('[data-current-task-step="true"]').getAttribute("data-step-id"), "step-1");
    assert.equal(await page.locator('[aria-current="step"]').count(), 1);
    assert.equal(await page.locator('.run-current-step-marker').innerText(), "Current step");
    assert.equal(await page.locator('[aria-current="step"] > .mem-content-flow-head > .mem-content-flow-label').count(), 1);
    assert.equal(await page.locator('.run-current-step-marker').getAttribute("class").then(value => value?.includes("mem-content-flow-label")), true);
    assert.match(await page.locator(".schema-writing").innerText(), /Managed draft/);
    assert.match(await page.locator(".run-procedure-asserts").innerText(), /run-rules/);
    const reviewers = page.locator(".mem-content-review-summary");
    assert.equal(await reviewers.count(), 1);
    assert.equal(await reviewers.locator(".mem-content-review-count").innerText(), "Reviewer: 1");
    assert.equal(await reviewers.locator(".mem-content-review-details").textContent(), "artifact_acceptance.unanimous");
    assert.equal(await page.locator("details.run-step").count(), 0, "Run steps use the same non-collapsible flow-node skeleton as Memory");
    await page.locator(".run-bindings .mem-view-disclosure > button").click();
    assert.match(await page.locator(".run-binding-body").innerText(), /Human/);
    assert.match(await page.locator(".task-result").first().innerText(), /Rendered report/);
    assert.equal(await page.locator(".run-step > .task-result > summary h3").first().innerText(), "Output");
    assert.equal(await page.locator(".task-result > summary .artifact-meta-line").count(), 0);
    assert.match(await page.locator(".task-result > .run-disclosure-body > .artifact-meta-line").first().innerText(), /Time:/);
    assert.doesNotMatch(await page.locator(".task-result > .run-disclosure-body > .artifact-meta-line").first().innerText(), /procedure|object|markdown|Final/);
    await page.getByRole("button", { name: /Artifact review/ }).click();
    await page.locator(".view-overlay-layer .artifact-review-modal").waitFor();
    assert.match(await page.locator("#artifact-review-artifact-pane").innerText(), /Review this artifact/);
    assert.match(await page.locator("#artifact-review-review-pane").innerText(), /Runner delegated/);
    assert.match(await page.locator("#artifact-review-review-pane").innerText(), /Human explicitly authorized this submission/);
    assert.equal(new URL(page.url()).pathname, "/tasks/run-demo/artifact-reviews/review-1");
    assert.equal(runDetailRequests, 1, "opening the review should reuse the Run detail already loaded by the page");
    const [surfaceBox, modalBox] = await Promise.all([
      page.locator(".view-overlay-surface").boundingBox(),
      page.locator(".view-overlay-layer .artifact-review-modal").boundingBox()
    ]);
    assert(surfaceBox && modalBox);
    assert(Math.abs(surfaceBox.width - modalBox.width) < 1);
    assert(Math.abs(surfaceBox.height - modalBox.height) < 1);
    assert(modalBox.x + modalBox.width <= (await page.evaluate(() => innerWidth)) + 1);
  } finally { await browser.close(); await close(server); }
});

async function buildRunBundle(): Promise<string> {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../modules/org.memsphere.run/adapter/view/index.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent" });
  return result.outputFiles[0]?.text ?? "";
}
async function browserModule(path: string): Promise<string> { const source=await readFile(new URL(path,import.meta.url),"utf8");return transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText; }
async function browserRuntimeBundle():Promise<string>{const result=await build({entryPoints:[fileURLToPath(new URL("../src/view/view-runtime.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",external:["@memsphere/view-sdk","./view-sdk.js"],logLevel:"silent"});return result.outputFiles[0]?.text??"";}
function send(response:ServerResponse,type:string,body:string):void{response.writeHead(200,{"content-type":`${type}; charset=utf-8`});response.end(body);}function json(response:ServerResponse,body:unknown):void{send(response,"application/json",JSON.stringify(body));}
async function listen(server:Server):Promise<string>{await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}async function close(server:Server):Promise<void>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
