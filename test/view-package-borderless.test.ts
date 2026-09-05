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
      const memoryCard = document.createElement("div");
      memoryCard.className = "memory-flow-item";
      memoryModule.append(memoryCard);
      const runModule = document.createElement("div");
      runModule.className = "run-module";
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
      memoryModule.append(artifactSummary, reviewSummary);
      document.body.append(memoryModule, runModule);
      return {
        memoryBorder: getComputedStyle(memoryCard).borderTopStyle,
        runBorder: getComputedStyle(runCard).borderTopStyle,
        artifactName: artifactName.textContent,
        reviewCount: reviewCount.textContent,
        artifactDetailsVisibility: getComputedStyle(artifactDetails).visibility,
        reviewDetailsVisibility: getComputedStyle(reviewDetails).visibility
      };
    });
    assert.deepEqual(result, {
      memoryBorder: "none",
      runBorder: "none",
      artifactName: "交付物",
      reviewCount: "评审人：2",
      artifactDetailsVisibility: "hidden",
      reviewDetailsVisibility: "hidden"
    });
    await page.locator(".memory-artifact-summary").hover();
    assert.equal(await page.locator(".memory-artifact-details").evaluate(node => getComputedStyle(node).visibility), "visible");
    await page.locator(".memory-review-summary").hover();
    assert.equal(await page.locator(".memory-review-details").evaluate(node => getComputedStyle(node).visibility), "visible");
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(temporary, { recursive: true, force: true });
  }
});
