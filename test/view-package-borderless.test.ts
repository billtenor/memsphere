import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import { readProjectConfig } from "../src/config.js";

test("borderless content Package removes solid Memory and Run card outlines", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-borderless-package-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const packageRoot = resolve("examples/view-packages/borderless-content");
  await mkdir(join(projectRoot, "memory"), { recursive: true });
  await mkdir(join(projectRoot, "runs"), { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_composition: {
      packages: [{ id: "org.example.memsphere.borderless-content", version: "1.0.0", enabled: true }],
      slots: {
        "styles.global@1": ["org.example.memsphere.borderless-content:org.example.memsphere.borderless-content:borderless-content"]
      }
    }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "test" }
  }));
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({
    format_version: 1,
    name: "demo",
    created_at: new Date(0).toISOString()
  }));
  await writeFile(join(home, "registry.json"), JSON.stringify({
    format_version: 1,
    projects: { demo: { root: projectRoot } },
    workspaces: {}
  }));

  const server = createViewServer(await readProjectConfig("demo", home));
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/projects/demo/memories`);
    await page.locator('style[data-view-package-scope="global"]').waitFor({ state: "attached" });
    const result = await page.evaluate(() => {
      const memoryModule = document.createElement("div");
      memoryModule.className = "memory-module";
      memoryModule.style.setProperty("--soft", "#eef1ed");
      memoryModule.style.setProperty("--surface", "#ffffff");
      const memoryFlow = document.createElement("div");
      memoryFlow.className = "memory-flow";
      const memoryCard = document.createElement("div");
      memoryCard.className = "memory-flow-item";
      memoryFlow.append(memoryCard);
      memoryModule.append(memoryFlow);
      const runModule = document.createElement("div");
      runModule.className = "run-module";
      runModule.style.setProperty("--soft", "#eef1ed");
      runModule.style.setProperty("--surface", "#ffffff");
      const runCard = document.createElement("div");
      runCard.className = "run-step";
      runModule.append(runCard);
      const artifactSummary = document.createElement("span");
      artifactSummary.className = "memory-artifact-summary";
      const artifactName = document.createElement("span");
      artifactName.textContent = "交付物";
      const artifactDetails = document.createElement("span");
      artifactDetails.className = "memory-artifact-details";
      artifactDetails.textContent = "markdown";
      artifactSummary.append(artifactName, artifactDetails);
      const reviewSummary = document.createElement("span");
      reviewSummary.className = "memory-review-summary";
      const reviewCount = document.createElement("span");
      reviewCount.className = "memory-review-count";
      reviewCount.textContent = "评审人：2";
      const reviewDetails = document.createElement("span");
      reviewDetails.className = "memory-review-details";
      reviewDetails.textContent = "产品负责人、架构师";
      reviewSummary.append(reviewCount, reviewDetails);
      const collapsible = document.createElement("details");
      collapsible.className = "memory-collapsible-list memory-list-block";
      collapsible.open = true;
      const collapsibleSummary = document.createElement("summary");
      const collapsibleLabel = document.createElement("span");
      collapsibleLabel.className = "memory-block-title";
      collapsibleLabel.textContent = "必须遵守";
      collapsibleSummary.append(collapsibleLabel);
      collapsible.append(collapsibleSummary, document.createElement("div"));
      memoryModule.append(artifactSummary, reviewSummary, collapsible);
      document.body.append(memoryModule, runModule);
      return {
        memoryBorder: getComputedStyle(memoryCard).borderTopStyle,
        memoryRail: getComputedStyle(memoryCard).boxShadow,
        memoryStepGap: getComputedStyle(memoryFlow).gap,
        memoryStepBackground: getComputedStyle(memoryCard).backgroundColor,
        runBorder: getComputedStyle(runCard).borderTopStyle,
        runRail: getComputedStyle(runCard).boxShadow,
        artifactName: artifactName.textContent,
        reviewCount: reviewCount.textContent,
        disclosureBorder: getComputedStyle(collapsibleSummary).borderTopStyle,
        disclosureBackground: getComputedStyle(collapsibleSummary).backgroundColor,
        artifactDetailsVisibility: getComputedStyle(artifactDetails).visibility,
        reviewDetailsVisibility: getComputedStyle(reviewDetails).visibility
      };
    });
    assert.deepEqual({ ...result, memoryStepBackground: undefined }, {
      memoryBorder: "none",
      memoryRail: "rgb(156, 186, 181) 3px 0px 0px 0px inset",
      memoryStepGap: "16px",
      memoryStepBackground: undefined,
      runBorder: "none",
      runRail: "rgb(156, 186, 181) 3px 0px 0px 0px inset",
      artifactName: "交付物",
      reviewCount: "评审人：2",
      disclosureBorder: "none",
      disclosureBackground: "rgba(0, 0, 0, 0)",
      artifactDetailsVisibility: "hidden",
      reviewDetailsVisibility: "hidden"
    });
    assert.notEqual(result.memoryStepBackground, "rgba(0, 0, 0, 0)");
    await page.locator(".memory-collapsible-list > summary").click();
    assert.equal(await page.locator(".memory-collapsible-list").getAttribute("open"), null);
    await page.locator(".memory-artifact-summary").hover();
    assert.equal(await page.locator(".memory-artifact-details").evaluate(node => getComputedStyle(node).visibility), "visible");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await page.locator(".memory-review-summary").hover();
    assert.equal(await page.locator(".memory-review-details").evaluate(node => getComputedStyle(node).visibility), "visible");
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(temporary, { recursive: true, force: true });
  }
});
