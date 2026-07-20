import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import type { RunState } from "../src/run/store.js";

const runId = "run-responsive-view";

async function withResponsiveView(fn: (browser: Browser, url: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-responsive-view-"));
  const memoryRoot = join(dir, "memory");
  const reservedRoot = join(dir, "reserved-memory");
  const reviewsRoot = join(dir, "reviews");
  const runsRoot = join(dir, "runs");
  const runDir = join(runsRoot, runId);
  await Promise.all([
    mkdir(join(memoryRoot, "concepts"), { recursive: true }),
    mkdir(join(memoryRoot, "schemas"), { recursive: true }),
    mkdir(join(reservedRoot, "concepts"), { recursive: true }),
    mkdir(reviewsRoot, { recursive: true }),
    mkdir(join(runDir, "artifacts"), { recursive: true })
  ]);

  await writeFile(join(memoryRoot, "concepts", "memory.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ Memory ]",
    "defines: [ A system memory fixture. ]"
  ].join("\n"));
  await writeFile(join(memoryRoot, "concepts", "user-note.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ User note ]",
    "defines: [ A user memory fixture. ]"
  ].join("\n"));
  await writeFile(join(reservedRoot, "concepts", "reserved-tip.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ Reserved tip ]",
    "defines: [ A non-system reserved memory fixture. ]"
  ].join("\n"));

  await writeFile(join(memoryRoot, "schemas", "reviewable-schema.yaml"), [
    "!schema",
    `syntax: ${currentMemorySyntax}`,
    "names: [ Reviewable schema ]",
    "defines: [ A schema fixture for inline review. ]",
    "asserts:",
    "  - A newly added comment must remain current.",
    "fields:",
    "  - !schema",
    "    names: [ Background ]",
    "    fields:",
    "      - !schema",
    "        names: [ Requirement source ]"
  ].join("\n"));

  const artifactPath = join(runDir, "artifacts", "001-wide-table.md");
  await writeFile(artifactPath, [
    "| Column | Value |",
    "| --- | --- |",
    `| Wide content | ${"x".repeat(240)} |`
  ].join("\n"));
  const run: RunState = {
    contractVersion: 2,
    memorySyntax: currentMemorySyntax,
    id: runId,
    status: "done",
    procedureName: "Responsive browser fixture",
    memoryRoot,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    stack: [],
    plan: Array.from({ length: 24 }, (_, index) => ({
      id: `flow[${index + 1}]`,
      kind: "action" as const,
      instruction: `A deliberately long instruction ${index + 1} verifies that the flow header can shrink inside its column.`,
      artifact: index === 0 ? "wide table" : `result ${index + 1}`,
      type: "string",
      format: { name: "markdown", options: {} },
      final: index === 0
    })),
    events: [{
      at: "2026-07-19T00:00:00.000Z",
      frame: "procedure",
      stepId: "flow[1]",
      artifact: {
        name: "wide table",
        type: "string",
        format: { name: "markdown", options: {} },
        final: true,
        storage: "file",
        path: `${runId}/artifacts/001-wide-table.md`
      }
    }]
  };
  await writeFile(join(runDir, `${runId}.json`), `${JSON.stringify(run)}\n`);

  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });

  try {
    await fn(browser, `http://127.0.0.1:${address.port}`);
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(dir, { recursive: true, force: true });
  }
}

async function openTaskPage(browser: Browser, url: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url);
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.locator(".task-card-main").first().click();
  await page.locator(".markdown-table-scroll").first().waitFor();
  return page;
}

async function assertPageDoesNotOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.ceil(element.getBoundingClientRect().right)
      }))
      .filter((element) => element.right > window.innerWidth)
      .slice(0, 5)
  }));
  assert.equal(layout.scrollWidth <= layout.viewportWidth, true, JSON.stringify(layout));
}

async function assertReviewPanelCanResizeLayout(page: Page): Promise<void> {
  const reviewToggle = page.getByRole("button", { name: "Review", exact: true });
  const content = page.locator(".content");
  await reviewToggle.waitFor();
  assert.equal(await reviewToggle.getAttribute("aria-expanded"), "false");
  const widthBeforeOpen = await content.evaluate((element) => element.getBoundingClientRect().width);
  await reviewToggle.click();
  await page.waitForTimeout(200);
  assert.equal(await reviewToggle.getAttribute("aria-expanded"), "true");
  assert(await page.getByRole("button", { name: "Close", exact: true }).isVisible());
  assert(await page.getByRole("button", { name: "Create Review", exact: true }).isVisible());
  const widthWhileOpen = await content.evaluate((element) => element.getBoundingClientRect().width);
  assert(widthWhileOpen < widthBeforeOpen, `expected content width to shrink: ${widthBeforeOpen} -> ${widthWhileOpen}`);
  await reviewToggle.click();
  await page.waitForTimeout(200);
  assert.equal(await reviewToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await content.evaluate((element) => element.getBoundingClientRect().width), widthBeforeOpen);
  await reviewToggle.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await reviewToggle.getAttribute("aria-expanded"), "false");
  const widthAfterEscape = await content.evaluate((element) => element.getBoundingClientRect().width);
  assert.equal(widthAfterEscape, widthBeforeOpen);
}

test("View reflows task content and keeps horizontal scrolling local on compact screens", async () => {
  await withResponsiveView(async (browser, url) => {
    const widePage = await openTaskPage(browser, url, 1600);
    try {
      await assertPageDoesNotOverflow(widePage);
      await assertReviewPanelCanResizeLayout(widePage);
    } finally {
      await widePage.close();
    }

    const compactPage = await openTaskPage(browser, url, 1366);
    try {
      await assertPageDoesNotOverflow(compactPage);
      assert(await compactPage.evaluate(() => document.documentElement.scrollHeight > window.innerHeight));
      await assertReviewPanelCanResizeLayout(compactPage);
      const reviewToggle = compactPage.getByRole("button", { name: "Review", exact: true });
      await reviewToggle.click();
      await compactPage.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await reviewToggle.getAttribute("aria-expanded"), "false");
    } finally {
      await compactPage.close();
    }

    const narrowPage = await openTaskPage(browser, url, 1024);
    try {
      await assertPageDoesNotOverflow(narrowPage);
      assert.equal(await narrowPage.locator(".flow-head").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
      const scrollBox = narrowPage.locator(".markdown-table-scroll").first();
      const box = await scrollBox.boundingBox();
      assert(box);
      await narrowPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await narrowPage.mouse.wheel(240, 0);
      await narrowPage.waitForTimeout(50);
      assert(await scrollBox.evaluate((element) => element.scrollWidth > element.clientWidth));
      assert(await scrollBox.evaluate((element) => element.scrollLeft > 0));
      await assertPageDoesNotOverflow(narrowPage);
    } finally {
      await narrowPage.close();
    }
  });
});

test("a newly added memory comment is current until its source text changes", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Memory", exact: true }).click();
      await page.getByRole("button", { name: "Reviewable schema", exact: true }).click();
      const fieldHeader = page.locator(".section-header").filter({ hasText: "Background" }).first();
      const title = fieldHeader.locator(".node-title");
      assert.equal(await fieldHeader.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 3);
      assert((await title.boundingBox())!.width > 100);
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("button", { name: "Create Review", exact: true }).click();
      await fieldHeader.waitFor();
      await page.waitForFunction(() => document.body.classList.contains("review-active"));
      assert.equal(await fieldHeader.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 4);
      assert((await title.boundingBox())!.width > 100);
      const assertComment = page.locator('[data-anchor="Reviewable schema.asserts[1]"] .inline-plus, [data-legacy-anchor="asserts[1]"] .inline-plus').first();
      await assertComment.click({ force: true });
      await page.getByPlaceholder("What should change here?").fill("Keep this comment current.");
      await page.getByRole("button", { name: "Add comment", exact: true }).click();
      await page.locator(".comment-card").waitFor();
      assert.equal(await page.locator(".pill.outdated").count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("Memory nav hides installed system memory but keeps non-system reserved memory visible", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Memory", exact: true }).click();
      const hideSystem = page.getByLabel("隐藏系统记忆");
      assert.equal(await hideSystem.isChecked(), true);
      await page.locator(".memory-button", { hasText: "User note" }).waitFor();
      await page.locator(".memory-button", { hasText: "Reserved tip" }).waitFor();
      assert.equal(await page.locator(".memory-button", { hasText: "Memory" }).count(), 0);
      await hideSystem.uncheck();
      await page.locator(".memory-button", { hasText: "Memory" }).waitFor();
      await hideSystem.check();
      assert.equal(await page.locator(".memory-button", { hasText: "Memory" }).count(), 0);
      assert.equal(await page.locator(".memory-button", { hasText: "Reserved tip" }).count(), 1);
    } finally {
      await page.close();
    }
  });
});
