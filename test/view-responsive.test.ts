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
const legacyRunId = "run-responsive-legacy";
const runName = `本次Run名称-${"x".repeat(120)}`;

async function withResponsiveView(fn: (browser: Browser, url: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-responsive-view-"));
  const memoryRoot = join(dir, "memory");
  const reservedRoot = join(dir, "reserved-memory");
  const reviewsRoot = join(dir, "reviews");
  const runsRoot = join(dir, "runs");
  const runDir = join(runsRoot, runId);
  const legacyRunDir = join(runsRoot, legacyRunId);
  await Promise.all([
    mkdir(join(memoryRoot, "concepts"), { recursive: true }),
    mkdir(join(memoryRoot, "procedures"), { recursive: true }),
    mkdir(join(memoryRoot, "schemas"), { recursive: true }),
    mkdir(join(reservedRoot, "concepts"), { recursive: true }),
    mkdir(reviewsRoot, { recursive: true }),
    mkdir(join(runDir, "artifacts"), { recursive: true }),
    mkdir(legacyRunDir, { recursive: true })
  ]);

  await writeFile(join(memoryRoot, "concepts", "memory-8aaf6c34fc49.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ memsphere-memory, Memory ]",
    "defines: [ A system memory fixture. ]"
  ].join("\n"));
  await writeFile(join(memoryRoot, "concepts", "user-note.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ user-note, User note ]",
    "defines: [ A user memory fixture. ]"
  ].join("\n"));
  await writeFile(join(memoryRoot, "procedures", "reviewable-procedure.yaml"), [
    "!procedure",
    `syntax: ${currentMemorySyntax}`,
    "names: [ reviewable-procedure, Reviewable procedure ]",
    "defines: [ A procedure fixture for inline task field review. ]",
    "goals:",
    "  - Verify comments on action fields.",
    "flow:",
    "  - !action",
    "    action: Inspect an action field.",
    "    asserts:",
    "      - Action field comments must be available.",
    "    artifact: !artifact",
    "      name: Field comment target",
    "      format: markdown"
  ].join("\n"));
  await writeFile(join(reservedRoot, "concepts", "reserved-tip.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ reserved-tip, Reserved tip ]",
    "defines: [ A non-system reserved memory fixture. ]"
  ].join("\n"));

  await writeFile(join(memoryRoot, "schemas", "reviewable-schema.yaml"), [
    "!schema",
    `syntax: ${currentMemorySyntax}`,
    "names: [ reviewable-schema, Reviewable schema ]",
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
    name: runName,
    status: "done",
    procedureName: "Responsive browser fixture",
    memoryRoot,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    stack: [],
    asserts: ["The task-level procedure contract remains reviewable."],
    plan: Array.from({ length: 24 }, (_, index) => ({
      id: `flow[${index + 1}]`,
      kind: (index === 1 ? "call" : "action") as "action" | "call",
      instruction: `A deliberately long instruction ${index + 1} verifies that the flow header can shrink inside its column.`,
      target: index === 1 ? "reviewable-procedure" : undefined,
      asserts: index === 0 ? ["The task action contract remains reviewable."] : undefined,
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
  await writeFile(join(legacyRunDir, `${legacyRunId}.json`), `${JSON.stringify({
    contractVersion: 2,
    memorySyntax: currentMemorySyntax,
    id: legacyRunId,
    status: "done",
    procedureName: "Legacy procedure fallback",
    memoryRoot,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    stack: [],
    events: []
  })}\n`);

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
  await gotoViewAndWaitForRuns(page, url);
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.locator(".task-card-main").first().click();
  await page.locator(".markdown-table-scroll").first().waitFor();
  return page;
}

async function gotoViewAndWaitForRuns(page: Page, url: string): Promise<void> {
  const runsLoaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/runs"
      && response.request().method() === "GET"
      && response.ok(),
    { timeout: 10_000 }
  );
  await page.goto(url);
  await runsLoaded;
}

async function openMemoryPage(browser: Browser, url: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url);
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page.getByRole("button", { name: "reviewable-schema", exact: true }).click();
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
    } finally {
      await widePage.close();
    }

    const compactPage = await openTaskPage(browser, url, 1366);
    try {
      await assertPageDoesNotOverflow(compactPage);
      assert(await compactPage.evaluate(() => document.documentElement.scrollHeight > window.innerHeight));
    } finally {
      await compactPage.close();
    }

    const narrowPage = await openTaskPage(browser, url, 1024);
    try {
      assert.equal(await narrowPage.locator("#title").textContent(), runName);
      assert.equal(await narrowPage.locator(".task-card-main b").first().textContent(), runName);
      await narrowPage.locator(".meta .pill", { hasText: "流程: Responsive browser fixture" }).waitFor();
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

test("Task titles fall back to the Procedure name for historical Runs", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    try {
      await gotoViewAndWaitForRuns(page, url);
      await page.getByRole("button", { name: "Task", exact: true }).click();
      const legacy = page.locator(".task-card-main", { hasText: "Legacy procedure fallback" });
      await legacy.click();
      assert.equal(await page.locator("#title").textContent(), "Legacy procedure fallback");
      await page.locator(".meta .pill", { hasText: "流程: Legacy procedure fallback" }).waitFor();
      await assertPageDoesNotOverflow(page);
    } finally {
      await page.close();
    }
  });
});

test("Memory Review panel can resize the content layout", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await openMemoryPage(browser, url, 1366);
    try {
      await assertReviewPanelCanResizeLayout(page);
    } finally {
      await page.close();
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
      await page.getByRole("button", { name: "reviewable-schema", exact: true }).click();
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
      const assertComment = page.locator('[data-anchor="reviewable-schema.asserts[1]"] .inline-plus, [data-legacy-anchor="asserts[1]"] .inline-plus').first();
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

test("Memory nav only shows the Project Catalog and can hide installed system memory", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Memory", exact: true }).click();
      const hideSystem = page.getByLabel("隐藏系统记忆");
      assert.equal(await hideSystem.isChecked(), true);
      await page.locator(".memory-button", { hasText: "user-note" }).waitFor();
      assert.equal(await page.locator(".memory-button", { hasText: "memsphere-memory" }).count(), 0);
      assert.equal(await page.locator(".memory-button", { hasText: "reserved-tip" }).count(), 0);
      await hideSystem.uncheck();
      await page.locator(".memory-button", { hasText: "memsphere-memory" }).waitFor();
      await hideSystem.check();
      assert.equal(await page.locator(".memory-button", { hasText: "memsphere-memory" }).count(), 0);
      assert.equal(await page.locator(".memory-button", { hasText: "reserved-tip" }).count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("Memory API identifies installed system memory independently of its file path", async () => {
  await withResponsiveView(async (_browser, url) => {
    const response = await fetch(`${url}/api/memories`);
    const payload = await response.json() as {
      memories: Array<{ path: string; system: boolean; entity?: { names?: string[] } }>;
      systemMemoryPaths?: unknown;
    };
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(payload, "systemMemoryPaths"), false);
    const systemMemory = payload.memories.find((memory) => memory.entity?.names?.[0] === "memsphere-memory");
    assert.equal(systemMemory?.path, "concepts/memory-8aaf6c34fc49.yaml");
    assert.equal(systemMemory?.system, true);
    const userMemory = payload.memories.find((memory) => memory.entity?.names?.[0] === "user-note");
    assert.equal(userMemory?.system, false);
  });
});

test("procedure action contract fields can receive review comments", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Memory", exact: true }).click();
      await page.getByRole("button", { name: "reviewable-procedure", exact: true }).click();
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("button", { name: "Create Review", exact: true }).click();
      await page.waitForFunction(() => document.body.classList.contains("review-active"));
      const fieldComment = page.locator('[data-anchor="flow[1].asserts[1]"] .inline-plus').first();
      await fieldComment.click({ force: true });
      await page.getByPlaceholder("What should change here?").fill("This action field can be reviewed.");
      await page.getByRole("button", { name: "Add comment", exact: true }).click();
      await page.locator(".comment-card").waitFor();
      assert.equal(await page.locator(".pill.outdated").count(), 0);
      await page.locator('[data-anchor="flow[1].asserts[1]"] .inline-thread-item').waitFor();
      await page.getByRole("button", { name: "Go to", exact: true }).click();
      await page.locator('[data-anchor="flow[1].asserts[1]"] .inline-thread-item').waitFor();
      await page.getByRole("button", { name: "Edit", exact: true }).last().click();
      const editor = page.locator('[data-anchor="flow[1].asserts[1]"] .thread-edit-editor textarea');
      await editor.fill("This action field remains reviewable after editing.");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.reload();
      await page.locator('[data-anchor="flow[1].asserts[1]"] .inline-thread-item').waitFor();
      assert.equal(await page.locator(".pill.outdated").count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("Task pages do not expose the retired Task Review entry or inline comments", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Task", exact: true }).click();
      await page.locator(".task-card-main").first().click();
      assert.equal(await page.getByRole("button", { name: "Review", exact: true }).count(), 0);
      assert.equal(await page.locator('[data-anchor^="task:"] .inline-plus:visible').count(), 0);
      assert.equal(await page.locator(".review-drawer.open").count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("View deep links restore Memory, Task, Memory Review, and browser history", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(`${url}/memories/concepts/memsphere-memory`);
      await page.getByRole("heading", { name: "memsphere-memory", exact: true }).waitFor();
      assert.match(await page.locator("#detail").textContent() ?? "", /A system memory fixture/);
      assert.equal(new URL(page.url()).pathname, "/memories/concepts/memsphere-memory");

      await page.goto(`${url}/memories/schemas/reviewable-schema`);
      await page.getByRole("heading", { name: "reviewable-schema", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/memories/schemas/reviewable-schema");

      await page.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("button", { name: "Create Review", exact: true }).click();
      await page.waitForFunction(() => location.pathname.startsWith("/memory-reviews/"));
      const reviewPath = new URL(page.url()).pathname;
      const reopenedReview = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await reopenedReview.goto(url + reviewPath);
      await reopenedReview.waitForFunction(() => document.body.classList.contains("review-drawer-open"));
      assert.equal(new URL(reopenedReview.url()).pathname, reviewPath);
      await reopenedReview.close();

      await page.getByRole("button", { name: "Task", exact: true }).click();
      assert.equal(new URL(page.url()).pathname, "/tasks");
      await page.locator(".task-card-main").first().click();
      assert.equal(new URL(page.url()).pathname, `/tasks/${runId}`);
      await page.goBack();
      await page.waitForURL(url + "/tasks");
      assert.equal(new URL(page.url()).pathname, "/tasks");
      await page.goForward();
      await page.waitForURL(url + `/tasks/${runId}`);
      await page.getByRole("heading", { name: runName, exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/tasks/${runId}`);

      const missing = await browser.newPage();
      await missing.goto(`${url}/memories/concepts/${encodeURIComponent("Missing memory")}`);
      await missing.getByRole("heading", { name: "Not found", exact: true }).waitFor();
      assert.match(await missing.locator("#detail").textContent() ?? "", /Memory not found/);
      await missing.close();

      assert.equal((await fetch(`${url}/unknown-page`)).status, 404);
      assert.equal((await fetch(`${url}/api/unknown-page`)).status, 404);
    } finally {
      await page.close();
    }
  });
});
