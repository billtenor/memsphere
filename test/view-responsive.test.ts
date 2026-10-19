import { browserScope, type TestBrowser } from "./helpers/browser.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type Page } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { parseControlPlaneConfig } from "../src/control-plane.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { runGit } from "../src/git.js";
import { editMemories, validateMemoryChange } from "../src/memory/changeset.js";
import type { RunState } from "../src/run/store.js";

const runId = "run-responsive-view";
const legacyRunId = "run-responsive-legacy";
const runName = `本次Run名称-${"x".repeat(120)}`;

async function withResponsiveView(
  fn: (browser: TestBrowser, url: string, fixture: { dir: string; homeRoot: string; memoryRoot: string }) => Promise<void>,
  options: { includeBrokenMemory?: boolean; extraMemoryCount?: number; initializeGit?: boolean } = {}
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-responsive-view-"));
  const homeRoot = join(dir, "home");
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
    mkdir(join(memoryRoot, "statements"), { recursive: true }),
    mkdir(join(reservedRoot, "concepts"), { recursive: true }),
    mkdir(homeRoot, { recursive: true }),
    mkdir(reviewsRoot, { recursive: true }),
    mkdir(join(runDir, "artifacts"), { recursive: true }),
    mkdir(legacyRunDir, { recursive: true })
  ]);
  await writeFile(join(homeRoot, "registry.json"), `${JSON.stringify({
    format_version: 1,
    projects: { responsive: { root: dir } },
    workspaces: {}
  }, null, 2)}\n`);
  await writeFile(join(dir, "project.json"), `${JSON.stringify({
    format_version: 1,
    name: "responsive",
    created_at: "2026-07-19T00:00:00.000Z"
  }, null, 2)}\n`);
  await writeFile(join(dir, "config.json"), `${JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "responsive-revision" },
    control_plane: {
      runner: { permissions: [] },
      actors: {
        alice: { kind: "human", name: "Alice", permissions: [] },
        bob: { kind: "human", name: "Bob", permissions: [] }
      }
    }
  }, null, 2)}\n`);

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
  await writeFile(join(memoryRoot, "concepts", "canonical-only.yaml"), [
    "!concept",
    `syntax: ${currentMemorySyntax}`,
    "names: [ canonical-only ]",
    "defines: [ A canonical-only memory fixture. ]"
  ].join("\n"));
  await Promise.all(Array.from({ length: options.extraMemoryCount ?? 0 }, async (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    await writeFile(join(memoryRoot, "concepts", `overflow-${suffix}.yaml`), [
      "!concept",
      `syntax: ${currentMemorySyntax}`,
      `names: [ overflow-${suffix}, Overflow ${suffix} ]`,
      "defines: [ A fixture that makes the memory list overflow. ]"
    ].join("\n"));
  }));
  if (options.includeBrokenMemory !== false) {
    await writeFile(join(memoryRoot, "concepts", "broken-memory.yaml"), [
      "!concept",
      "names: ["
    ].join("\n"));
  }
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
    "      - !ref",
    "        target: statements/shared-rules",
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
    "optional: true",
    "asserts:",
    "  - A newly added comment must remain current.",
    "fields:",
    "  - !schema",
    "    names: [ Background ]",
    "    fields:",
    "      - !schema",
    "        names: [ Requirement source ]",
    "  - Summary"
  ].join("\n"));
  await writeFile(join(memoryRoot, "statements", "shared-rules.yaml"), [
    "!statement",
    `syntax: ${currentMemorySyntax}`,
    "names: [ shared-rules, shared-rules-alias, Shared rules ]",
    "defines: [ Shared rules fixture. ]",
    "asserts:",
    "  - The shared assertion applies.",
    "sections:",
    "  - !statement",
    "    names: [ Evidence ]",
    "    defines: [ Evidence-specific context. ]",
    "    asserts:",
    "      - Cite supporting evidence."
  ].join("\n"));
  await writeFile(join(memoryRoot, "statements", "referencing-rules.yaml"), [
    "!statement",
    `syntax: ${currentMemorySyntax}`,
    "names: [ referencing-rules, Referencing rules ]",
    "defines: [ Reference fixture. ]",
    "asserts:",
    "  - Keep the local assertion.",
    "  - !ref",
    "    target: statements/shared-rules"
  ].join("\n"));
  await writeFile(join(memoryRoot, "statements", "referencing-alias.yaml"), [
    "!statement",
    `syntax: ${currentMemorySyntax}`,
    "names: [ referencing-alias, Referencing alias ]",
    "defines: [ Invalid alias reference fixture. ]",
    "asserts:",
    "  - !ref",
    "    target: statements/shared-rules-alias"
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
    assertTree: {
      channel: "asserts",
      entries: [{
        kind: "rule",
        text: "The local rule before the reference applies.",
        ruleId: "procedures/responsive-browser-fixture#asserts[0]"
      }, {
        kind: "reference",
        target: "statements/shared-rules",
        entries: [{
          kind: "rule",
          text: "The shared assertion applies.",
          ruleId: "statements/shared-rules#asserts[0]"
        }],
        sections: [{
          name: "Evidence",
          defines: ["Evidence-specific context."],
          entries: [{
            kind: "rule",
            text: "Cite supporting evidence.",
            ruleId: "statements/shared-rules#sections[0].asserts[0]"
          }],
          sections: []
        }]
      }, {
        kind: "rule",
        text: "The local rule after the reference applies.",
        ruleId: "procedures/responsive-browser-fixture#asserts[2]"
      }],
      sections: []
    },
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

  if (options.initializeGit) {
    await runGit(["init", "-b", "master"], { cwd: memoryRoot });
    await runGit(["add", "."], { cwd: memoryRoot });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Memory fixture"], { cwd: memoryRoot });
    await runGit(["tag", "responsive-revision"], { cwd: memoryRoot });
    const configuration = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    configuration.store.published_revision = (await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot })).stdout;
    await writeFile(join(dir, "config.json"), JSON.stringify(configuration));
  }
  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    homeRoot,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    controlPlane: parseControlPlaneConfig({
      runner: { permissions: [] },
      actors: {
        alice: { kind: "human", name: "Alice", permissions: [] },
        bob: { kind: "human", name: "Bob", permissions: [] }
      }
    }),
    view: { host: "127.0.0.1", port: 0 },
    project: {
      name: "responsive",
      store: { type: "managed", branch: "master", published_revision: "responsive-revision" },
      mounted: []
    }
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const browser = await browserScope();

  try {
    await fn(browser, `http://127.0.0.1:${address.port}`, { dir, homeRoot, memoryRoot });
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    // Windows may briefly retain file handles after the server/browser close.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function candidateProcedureChange(
  fixture: { dir: string; homeRoot: string; memoryRoot: string },
  mutate: (candidateRoot: string) => Promise<void>,
  includeStatement = false
): Promise<string> {
  const workspace = join(fixture.dir, "workspace");
  await mkdir(workspace);
  await runGit(["init", "-b", "master"], { cwd: workspace });
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT };
  try {
    process.chdir(workspace);
    process.env.MEMSPHERE_HOME = fixture.homeRoot;
    process.env.MEMSPHERE_PROJECT = "responsive";
    const edited = await editMemories({ references: ["procedures/reviewable-procedure", ...(includeStatement ? ["statements/shared-rules"] : [])] });
    await mutate(edited.candidateRoot);
    // Invalid candidates are still checkpointed and must remain reviewable.
    await validateMemoryChange(edited.change.id);
    return edited.change.id;
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous.project;
  }
}

async function openTaskPage(browser: TestBrowser, url: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(5_000);
  await page.goto(`${url}/projects/responsive/tasks/${runId}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  // Initial Module loading competes with other browser suites on CI runners.
  await page.locator(".run-title").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
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
      assert(await compactPage.locator("#memsphere-view-root").evaluate(element => element.scrollHeight > element.clientHeight));
    } finally {
      await compactPage.close();
    }

    const narrowPage = await openTaskPage(browser, url, 1024);
    try {
      assert.equal(await narrowPage.locator(".run-title").textContent(), runName);
      assert.equal(await narrowPage.locator(".mem-view-list-item-heading strong").first().textContent(), runName);
      await narrowPage.locator(".run-meta .mem-view-badge", { hasText: "流程: Responsive browser fixture" }).waitFor();
      await assertPageDoesNotOverflow(narrowPage);
      assert.ok(await narrowPage.locator(".run-step").first().boundingBox());
      const scrollState = await narrowPage.locator(".markdown-table-scroll").first().evaluate(element => {
        if (!(element instanceof HTMLElement)) throw new Error("markdown table wrapper is missing");
        if (element.scrollWidth > element.clientWidth) element.scrollLeft = 240;
        return {
          clientWidth: element.clientWidth,
          scrollLeft: element.scrollLeft,
          scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX
        };
      });
      assert.match(scrollState.overflowX, /auto|scroll/);
      if (scrollState.scrollWidth > scrollState.clientWidth) assert(scrollState.scrollLeft > 0);
      await assertPageDoesNotOverflow(narrowPage);
    } finally {
      await narrowPage.close();
    }
  });
});

test("Shell panel widths support pointer drag, reload persistence, keyboard adjustment, and reset", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(`${url}/projects/responsive/memories`);
      await page.locator('html[data-view-host-state="ready"]').waitFor();
      const secondary = page.locator('[data-view-resizer="secondary"]');
      const contentList = page.locator('[data-view-resizer="content-list"]');
      await secondary.waitFor();
      await contentList.waitFor();
      assert.deepEqual(await secondary.evaluate(node => [node.getAttribute("aria-valuemin"), node.getAttribute("aria-valuemax")]), ["176", "360"]);
      assert.deepEqual(await contentList.evaluate(node => [node.getAttribute("aria-valuemin"), node.getAttribute("aria-valuemax")]), ["260", "520"]);

      const initialSecondary = Number(await secondary.getAttribute("aria-valuenow"));
      const secondaryBox = await secondary.boundingBox();
      assert(secondaryBox);
      await page.mouse.move(secondaryBox.x + secondaryBox.width / 2, secondaryBox.y + 80);
      await page.mouse.down();
      await page.mouse.move(secondaryBox.x + secondaryBox.width / 2 + 60, secondaryBox.y + 80, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction((expected) => (
        Number(document.querySelector('[data-view-resizer="secondary"]')?.getAttribute("aria-valuenow")) === expected
      ), initialSecondary + 60);
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("memsphere.view.shell-widths.v1") ?? "{}")),
        { secondary: initialSecondary + 60, "content-list": 326 }
      );

      await page.reload();
      await page.locator('html[data-view-host-state="ready"]').waitFor();
      const restoredSecondary = page.locator('[data-view-resizer="secondary"]');
      assert.equal(Number(await restoredSecondary.getAttribute("aria-valuenow")), initialSecondary + 60);
      await restoredSecondary.press("ArrowRight");
      assert.equal(Number(await restoredSecondary.getAttribute("aria-valuenow")), initialSecondary + 72);
      await restoredSecondary.dblclick();
      assert.equal(Number(await restoredSecondary.getAttribute("aria-valuenow")), 218);

      const restoredList = page.locator('[data-view-resizer="content-list"]');
      await restoredList.press("Shift+ArrowRight");
      assert.equal(Number(await restoredList.getAttribute("aria-valuenow")), 374);
      await restoredList.dblclick();
      assert.equal(Number(await restoredList.getAttribute("aria-valuenow")), 326);
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("memsphere.view.shell-widths.v1") ?? "{}")),
        { secondary: 218, "content-list": 326 }
      );
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.close();
    }
  });
});

test("builtin Memory, ChangeSet, and Settings stay within desktop and mobile viewports", async () => {
  await withResponsiveView(async (browser, url) => {
    const created = await fetch(`${url}/api/projects/responsive/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memoryReference: "concepts/user-note",
        operator: { kind: "human", id: "alice" }
      })
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const changeId = (JSON.parse(createdText) as { change: { id: string } }).change.id;
    for (const [path, ready] of [
      ["/projects/responsive/memories/concepts/user-note", "#memsphere-view-root .memory-module"],
      [`/projects/responsive/changes/${changeId}`, "#memsphere-view-root .memory-module"],
      ["/projects/responsive/settings/overview", "#memsphere-view-root .settings-detail-surface"]
    ] as const) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.setDefaultTimeout(5_000);
      try {
        await page.goto(url + path);
        await page.locator(ready).waitFor().catch(async () => assert.fail(JSON.stringify({ url: page.url(), body: await page.locator("body").innerText() }, null, 2)));
        await page.locator('html[data-view-host-state="ready"]').waitFor();
        if (path.includes("/changes/")) {
          const bodyText = await page.locator("body").innerText();
          assert.match(bodyText, new RegExp(changeId), bodyText);
          await page.locator(".memory-error").waitFor();
        }
        await assertPageDoesNotOverflow(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await assertPageDoesNotOverflow(page);
      } finally {
        await page.close();
      }
    }
  }, { includeBrokenMemory: false });
});

test("Run effective rule references and sections collapse and survive rerenders", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await openTaskPage(browser, url, 1366);
    try {
      const reference = page.locator(".run-procedure-asserts .effective-reference").first();
      const referenceHeading = reference.locator(":scope > .section-header");
      const referenceBody = reference.locator(":scope > .section-body");
      await referenceHeading.waitFor();
      const readRuleLayout = () => page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>(
          ".run-procedure-asserts > .effective-rule-tree > .mem-content-disclosure-body > .effective-rule-list > li"
        )];
        const firstRule = items[0];
        const referenceItem = items[1];
        const referenceHeadingElement = referenceItem?.querySelector<HTMLElement>(
          ":scope > .effective-reference > .section-header"
        );
        const nestedRule = referenceItem?.querySelector<HTMLElement>(
          ":scope > .effective-reference > .section-body > .effective-rule-list > li"
        );
        if (!firstRule || !referenceItem || !referenceHeadingElement || !nestedRule) return null;
        const referenceStyle = getComputedStyle(referenceItem);
        return {
          tagNames: items.map(item => item.tagName),
          texts: items.map(item => item.innerText),
          display: referenceStyle.display,
          listStyleType: referenceStyle.listStyleType,
          firstRuleX: firstRule.getBoundingClientRect().x,
          referenceItemX: referenceItem.getBoundingClientRect().x,
          referenceContentX: referenceItem.getBoundingClientRect().x + parseFloat(referenceStyle.paddingLeft),
          referenceHeadingX: referenceHeadingElement.getBoundingClientRect().x,
          nestedRuleX: nestedRule.getBoundingClientRect().x
        };
      });
      const ruleLayout = await readRuleLayout();
      assert(ruleLayout);
      assert.deepEqual(ruleLayout.tagNames, ["LI", "LI", "LI"]);
      assert.match(ruleLayout.texts[0] ?? "", /local rule before/);
      assert.match(ruleLayout.texts[1] ?? "", /statements\/shared-rules/);
      assert.match(ruleLayout.texts[2] ?? "", /local rule after/);
      assert.equal(ruleLayout.display, "list-item");
      assert.equal(ruleLayout.listStyleType, "disc");
      assert.equal(Math.abs(ruleLayout.firstRuleX - ruleLayout.referenceItemX) < 1, true);
      assert.equal(Math.abs(ruleLayout.referenceContentX - ruleLayout.referenceHeadingX) <= 1, true);
      assert.equal(await referenceHeading.getAttribute("aria-expanded"), "true");
      assert.equal(ruleLayout.nestedRuleX > ruleLayout.referenceHeadingX, true);

      await referenceHeading.click({ position: { x: 8, y: 8 } });
      assert.equal(await referenceHeading.getAttribute("aria-expanded"), "false");
      assert.equal(await referenceBody.isHidden(), true);

      const beforeRefresh = await page.locator(".run-detail-content").elementHandle();
      assert.equal(await page.locator("details.run-collapsible:not([open])").count(), 0);
      const refreshCompleted = page.waitForResponse(response => (
        new URL(response.url()).pathname === `/api/projects/responsive/runs/${runId}` && response.ok()
      ));
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await refreshCompleted;
      await page.waitForFunction(() => document.querySelector('.view-shell-action[aria-busy="true"]') === null);
      const rerenderedReference = page.locator(".run-procedure-asserts .effective-reference").first();
      const rerenderedHeading = rerenderedReference.locator(":scope > .section-header");
      await page.waitForFunction(old => !old?.isConnected, beforeRefresh);
      await page.getByRole("button", { name: "收起全部", exact: true }).waitFor();
      assert.equal(await page.locator("details.run-collapsible:not([open])").count(), 0, "refresh preserves every expanded native Run disclosure");
      await rerenderedHeading.waitFor();
      assert.equal(await rerenderedHeading.getAttribute("aria-expanded"), "false");
      assert.equal(await rerenderedReference.locator(":scope > .section-body").isHidden(), true);
      const rerenderedRuleLayout = await readRuleLayout();
      assert(rerenderedRuleLayout);
      assert.deepEqual(rerenderedRuleLayout.tagNames, ["LI", "LI", "LI"]);
      assert.equal(rerenderedRuleLayout.display, "list-item");
      assert.equal(rerenderedRuleLayout.listStyleType, "disc");

      await rerenderedHeading.press("Enter");
      assert.equal(await rerenderedHeading.getAttribute("aria-expanded"), "true");
      const effectiveSection = rerenderedReference.locator(".effective-section").first();
      assert.deepEqual(
        await effectiveSection.locator(":scope > .section-body .block-title").allTextContents(),
        ["定义", "规则"]
      );
      const groupedText = await effectiveSection.locator(":scope > .section-body .text-list").allTextContents();
      assert.equal(groupedText.length, 2);
      assert.match(groupedText[0] ?? "", /Evidence-specific context\./);
      assert.doesNotMatch(groupedText[0] ?? "", /Cite supporting evidence\./);
      assert.equal(groupedText[1], "Cite supporting evidence.");
      const sectionHeading = effectiveSection.locator(":scope > .section-header");
      await sectionHeading.press(" ");
      assert.equal(await sectionHeading.getAttribute("aria-expanded"), "false");
      assert.equal(await effectiveSection.locator(":scope > .section-body").isHidden(), true);

    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.close();
    }
  });
});

test("Run titles fall back to the Procedure name for historical Runs", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(`${url}/projects/responsive/tasks/${legacyRunId}`);
      await page.locator(".run-title").waitFor();
      assert.equal(await page.locator(".run-title").textContent(), "Legacy procedure fallback");
      await page.locator(".run-meta .mem-view-badge", { hasText: "流程: Legacy procedure fallback" }).waitFor();
      await assertPageDoesNotOverflow(page);
    } finally {
      await page.close();
    }
  });
});

test("Run status list refreshes only when the user asks", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(10_000);
    let status = "running";
    let summaryRequests = 0;
    await page.route("**/api/projects/responsive/runs*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname === "/api/projects/responsive/runs") summaryRequests += 1;
      requestUrl.searchParams.delete("status");
      const response = await route.fetch({ url: requestUrl.toString() });
      const payload = await response.json() as { runs?: Array<Record<string, unknown>>; run?: Record<string, unknown> };
      if (payload.runs) payload.runs = payload.runs.map((run) => ({ ...run, status }));
      if (payload.run) payload.run = { ...payload.run, status };
      await route.fulfill({ response, json: payload });
    });
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await page.locator(".mem-view-list-item").first().waitFor();
      assert.equal(await page.getByRole("button", { name: "运行中", exact: true }).getAttribute("aria-current"), "page");
      status = "done";
      const requestsBeforeWait = summaryRequests;
      // Bounded negative observation after the loaded state; explicit refresh is verified below.
      await page.waitForTimeout(4_250);
      assert.equal(summaryRequests, requestsBeforeWait);
      const refreshed = page.waitForResponse((response) => (
        new URL(response.url()).pathname === "/api/projects/responsive/runs"
        && new URL(response.url()).searchParams.get("status") === "running"
      ));
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await refreshed;
      await page.locator(".mem-view-content-list").getByText("当前状态下没有 Run。", { exact: true }).waitFor();
      assert.equal(await page.locator(".mem-view-list-item").count(), 0);
      await page.locator('.view-host-mount[data-view-location="/projects/responsive/tasks"]').waitFor();
      const doneLoaded = page.waitForResponse((response) => (
        new URL(response.url()).pathname === "/api/projects/responsive/runs"
        && new URL(response.url()).searchParams.get("status") === "done"
      ));
      await page.getByRole("button", { name: "已完成", exact: true }).click();
      await doneLoaded;
      await page.locator(".mem-view-list-item").first().waitFor();
      assert.equal(await page.getByRole("button", { name: "已完成", exact: true }).getAttribute("aria-current"), "page");
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/tasks");
      assert.match(await page.locator(".run-workspace").innerText(), /选择一个 Run/);
      await page.unrouteAll({ behavior: "wait" });
    } finally {
      await page.close();
    }
  });
});

test("Run status switching does not load a detail until the user selects one", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    let detailRequests = 0;
    await page.route("**/api/projects/responsive/runs*", async (route) => {
      const requestUrl = new URL(route.request().url());
      requestUrl.searchParams.delete("status");
      const response = await route.fetch({ url: requestUrl.toString() });
      const payload = await response.json() as { runs?: Array<Record<string, unknown>>; run?: Record<string, unknown> };
      if (payload.runs) {
        payload.runs = payload.runs.map((run) => ({
          ...run,
          status: "running"
        }));
      }
      await route.fulfill({ response, json: payload });
    });
    await page.route("**/api/projects/responsive/runs/*", async (route) => {
      detailRequests += 1;
      const response = await route.fetch();
      const payload = await response.json() as { run?: Record<string, unknown> };
      if (payload.run) payload.run = { ...payload.run, status: "running" };
      await route.fulfill({ response, json: payload });
    });
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await page.locator(".mem-view-list-item").first().waitFor();
      assert.equal(detailRequests, 0);
      assert.match(await page.locator(".run-workspace").innerText(), /选择一个 Run/);
      await page.locator(".mem-view-list-item").first().click();
      await page.locator(".run-title").waitFor();
      assert.equal(detailRequests, 1);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.close();
    }
  });
});

test("Run detail refresh is manual", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    let detailRequests = 0;
    await page.route("**/api/projects/responsive/runs/*", async (route) => {
      detailRequests += 1;
      await route.continue();
    });
    try {
      await page.goto(`${url}/projects/responsive/tasks/${runId}`);
      await page.locator(".run-title", { hasText: runName }).waitFor();
      const initialRequests = detailRequests;
      // Bounded negative observation after the loaded state; explicit refresh is verified below.
      await page.waitForTimeout(4_250);
      assert.equal(detailRequests, initialRequests);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/responsive/runs/${runId}`);
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await refreshed;
      assert.equal(detailRequests, initialRequests + 1);
    } finally {
      await page.close();
    }
  });
});

test("missing Run detail is reported as not found", async () => {
  await withResponsiveView(async (_browser, url) => {
    const response = await fetch(`${url}/api/projects/responsive/runs/run-missing`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /run not found/i);
  });
});

test("archiving the selected Run returns to the current status list", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await openTaskPage(browser, url, 1024);
    try {
      assert.equal(await page.locator(".run-title").textContent(), runName);
      const archived = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/projects/responsive/archive/runs/${runId}`
      );
      await page.locator(".mem-view-list-item-row:has(.mem-view-list-item.active) .mem-view-list-item-actions button").click();
      await page.locator("dialog.mem-view-confirm").getByRole("button", { name: "归档", exact: true }).click();
      assert.equal((await archived).status(), 200);
      await page.locator('.view-host-mount[data-view-location="/projects/responsive/tasks"]').waitFor();
      assert.match(await page.locator(".run-workspace").innerText(), /选择一个 Run/);
      assert.doesNotMatch(await page.locator(".run-workspace").textContent() ?? "", /加载中|Loading/);
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/tasks");
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
      await page.getByRole("button", { name: "记忆", exact: true }).click();
      await page.waitForURL(`${url}/projects/responsive/memories`);
      await page.getByRole("button", { name: "User note", exact: true }).waitFor();
      const hideSystem = page.getByLabel("隐藏系统记忆");
      assert.equal(await hideSystem.isChecked(), true);
      const listLayout = await page.locator(".view-host-list-mount.memory-list-surface").evaluate(element => {
        const content = element.querySelector<HTMLElement>(".mem-view-content-list");
        const accessory = element.querySelector<HTMLElement>(".memory-list-accessory");
        if (!(element instanceof HTMLElement) || !content || !accessory) throw new Error("Memory list layout is incomplete");
        const panelBox = element.getBoundingClientRect();
        const accessoryBox = accessory.getBoundingClientRect();
        return {
          contentOverflows: content.scrollHeight > content.clientHeight,
          panelClientHeight: element.clientHeight,
          panelScrollHeight: element.scrollHeight,
          accessoryTop: accessoryBox.top,
          accessoryBottom: accessoryBox.bottom,
          panelTop: panelBox.top,
          panelBottom: panelBox.bottom
        };
      });
      assert.equal(listLayout.contentOverflows, true, JSON.stringify(listLayout));
      assert.equal(listLayout.panelScrollHeight, listLayout.panelClientHeight, JSON.stringify(listLayout));
      assert.equal(listLayout.accessoryTop >= listLayout.panelTop, true, JSON.stringify(listLayout));
      assert.equal(listLayout.accessoryBottom <= listLayout.panelBottom, true, JSON.stringify(listLayout));
      await page.locator(".mem-view-list-item", { hasText: "User note" }).waitFor();
      const systemMemoryButton = page.getByRole("button", { name: "Memory", exact: true });
      assert.equal(await systemMemoryButton.count(), 0);
      assert.equal(await page.locator(".mem-view-list-item", { hasText: "reserved-tip" }).count(), 0);
      await hideSystem.uncheck();
      await systemMemoryButton.waitFor();
      await hideSystem.check();
      assert.equal(await systemMemoryButton.count(), 0);
      assert.equal(await page.locator(".mem-view-list-item", { hasText: "reserved-tip" }).count(), 0);
    } finally {
      await page.close();
    }
  }, { extraMemoryCount: 20 });
});

test("Memory navigation uses aliases while the detail header exposes the canonical reference", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "记忆", exact: true }).click();
      await page.waitForURL(`${url}/projects/responsive/memories`);
      await page.getByRole("button", { name: "User note", exact: true }).waitFor();
      await page.getByRole("button", { name: "User note", exact: true }).click();
      await page.waitForURL(`${url}/projects/responsive/memories/concepts/user-note`);
      await page.locator(".memory-title", { hasText: "User note" }).waitFor();
      assert.equal(await page.locator(".memory-title").textContent(), "User note");
      assert.match(await page.locator('[data-view-slot="header.title"] p').textContent() ?? "", /concepts\/user-note/);
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/memories/concepts/user-note");

      await page.getByPlaceholder("搜索当前项目").fill("concepts/user-note");
      await page.getByRole("button", { name: "User note", exact: true }).waitFor();
      await page.getByPlaceholder("搜索当前项目").fill("user-note");
      await page.getByRole("button", { name: "User note", exact: true }).waitFor();
      await page.getByPlaceholder("搜索当前项目").fill("User note");
      await page.getByRole("button", { name: "User note", exact: true }).waitFor();

      await page.getByPlaceholder("搜索当前项目").fill("canonical-only");
      await page.getByRole("button", { name: "canonical-only", exact: true }).click();
      await page.waitForURL(`${url}/projects/responsive/memories/concepts/canonical-only`);
      await page.locator(".memory-title", { hasText: "canonical-only" }).waitFor();
      assert.equal(await page.locator(".memory-title").textContent(), "canonical-only");
      assert.match(await page.locator('[data-view-slot="header.title"] p').textContent() ?? "", /concepts\/canonical-only/);

      await page.getByPlaceholder("搜索当前项目").fill("concepts/broken-memory.yaml");
      await page.getByRole("button", { name: "broken-memory", exact: true }).click();
      await page.waitForURL(`${url}/projects/responsive/memories/concepts/broken-memory`);
      await page.locator(".memory-error").waitFor();
      assert.equal(await page.locator(".memory-error h3").textContent(), "记忆 YAML 无效");
      assert.equal(await page.locator(".mem-view-list-item.active .mem-view-list-item-heading strong").textContent(), "broken-memory");
      assert.match(await page.locator(".memory-error").textContent() ?? "", /记忆 YAML 无效|YAML|Flow sequence/);
    } finally {
      await page.close();
    }
  });
});

test("Memory detail keeps rule references raw unless effective expansion is requested", async () => {
  await withResponsiveView(async (_browser, url) => {
    const summaryResponse = await fetch(`${url}/api/projects/responsive/memories?representation=summary`);
    assert.equal(summaryResponse.status, 200, await summaryResponse.text());
    const rawResponse = await fetch(`${url}/api/projects/responsive/memories/statements/referencing-rules`);
    const raw = await rawResponse.json() as { memory: { entity: Record<string, unknown> } };
    assert.equal(rawResponse.status, 200);
    assert.deepEqual((raw.memory.entity.asserts as unknown[])[1], {
      tag: "!ref",
      target: "statements/shared-rules"
    });
    assert.equal(Object.hasOwn(raw.memory.entity, "effectiveRules"), false);

    const effectiveResponse = await fetch(`${url}/api/projects/responsive/memories/statements/referencing-rules?effective=true`);
    const effective = await effectiveResponse.json() as {
      memory: { entity: { effectiveRules: { asserts: unknown[] } } };
    };
    assert.equal(effectiveResponse.status, 200);
    assert.deepEqual(effective.memory.entity.effectiveRules.asserts, [
      "Keep the local assertion.",
      {
        reference: "statements/shared-rules",
        asserts: ["The shared assertion applies."],
        sections: [{
          name: "Evidence",
          defines: ["Evidence-specific context."],
          asserts: ["Cite supporting evidence."]
        }]
      }
    ]);
    assert.doesNotMatch(JSON.stringify(effective), /"entries"|"sections":\[\]|"defines":\[\]/);
    assert.doesNotMatch(JSON.stringify(effective), /ruleId|source_path|imported_at/);

    const aliasResponse = await fetch(`${url}/api/projects/responsive/memories/statements/referencing-alias?effective=true`);
    assert.equal(aliasResponse.status, 400);
    assert.match(await aliasResponse.text(), /Statement not found: statements\/shared-rules-alias/);
  });
});

test("default Chinese Memory detail renders Schema labels without fixed English UI copy", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(`${url}/projects/responsive/memories/schemas/reviewable-schema`);
      await page.locator(".memory-title", { hasText: "Reviewable schema" }).waitFor();
      assert.match(await page.locator(".node-badges").first().textContent() ?? "", /可选: true/);
      assert.equal(await page.locator(".schema-field-type").first().textContent(), "短文本");
      assert.equal(await page.getByText("optional: true", { exact: true }).count(), 0);
      assert.equal(await page.getByText("string", { exact: true }).count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("published Statement references expand in place without ChangeSet comment controls", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    try {
      await page.goto(`${url}/projects/responsive/memories/statements/referencing-alias`);
      await page.locator('[data-view-slot="header.title"] p', { hasText: "statements/referencing-alias" }).waitFor();
      const invalidAlias = page.getByRole("button", { name: "statements/shared-rules-alias", exact: true });
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      await invalidAlias.waitFor();
      assert.match(await invalidAlias.getAttribute("class") ?? "", /missing/);
      await invalidAlias.click();
      assert.match(await page.locator('[data-view-slot="header.title"] p').textContent() ?? "", /statements\/referencing-alias/);

      await page.goto(`${url}/projects/responsive/memories/statements/referencing-rules`);
      await page.locator(".memory-title", { hasText: "Referencing rules" }).waitFor();
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const reference = page.locator(".rule-reference", { hasText: "statements/shared-rules" }).first();
      await reference.waitFor();
      assert.equal(await page.locator(".memory-inline-plus").count(), 0);
      const toggle = reference.locator(".rule-reference-toggle");
      await toggle.waitFor();
      assert.equal(await toggle.textContent(), "2 条生效规则");
      const body = reference.locator(".effective-rule-inline");
      assert.equal(await body.isHidden(), true);
      assert.equal(await page.getByRole("button", { name: "查看生效规则", exact: true }).count(), 0);

      await toggle.click();
      await body.waitFor();
      assert.match(await body.textContent() ?? "", /The shared assertion applies\./);
      assert.match(await body.textContent() ?? "", /Evidence/);
      assert.match(await body.textContent() ?? "", /Evidence-specific context\./);
      assert.match(await body.textContent() ?? "", /Cite supporting evidence\./);

      await reference.getByRole("button", { name: "statements/shared-rules", exact: true }).click();
      await page.locator('[data-view-slot="header.title"] p', { hasText: "statements/shared-rules" }).waitFor();
    } finally {
      await page.close();
    }
  });
});

test("published Procedure Action references do not expose ChangeSet comment controls", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    try {
      await page.goto(`${url}/projects/responsive/memories/procedures/reviewable-procedure`);
      await page.locator(".memory-title", { hasText: "Reviewable procedure" }).waitFor();
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const reference = page.locator(".rule-reference", { hasText: "statements/shared-rules" });
      await reference.waitFor();
      assert.equal(await page.locator(".memory-inline-plus").count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("ChangeSet Action references expand and open unchanged Statements from the candidate snapshot", async () => {
  await withResponsiveView(async (browser, url) => {
    const created = await fetch(`${url}/api/projects/responsive/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryReference: "procedures/reviewable-procedure", operator: { kind: "human", id: "alice" } })
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const changeId = (JSON.parse(createdText) as { change: { id: string } }).change.id;
    const detailResponse = await fetch(`${url}/api/projects/responsive/changes/${changeId}`);
    assert.equal(detailResponse.status, 200, await detailResponse.clone().text());
    const detail = await detailResponse.json() as {
      targetMemories: Array<{ reference: string; memory: { entity: unknown }; baseMemory: { entity: unknown } }>;
      referenceMemories: Array<{ id: string }>;
    };
    assert.equal(detail.targetMemories.some(memory => memory.reference === "statements/shared-rules"), false);
    assert.equal(detail.referenceMemories.some(memory => memory.id === "statements/shared-rules"), true);
    assert.match(JSON.stringify(detail.targetMemories[0]?.memory.entity), /The shared assertion applies/);
    assert.match(JSON.stringify(detail.targetMemories[0]?.baseMemory.entity), /Cite supporting evidence/);
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(`${url}/projects/responsive/changes/${changeId}?section=changes`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const reference = page.locator(".rule-reference", { hasText: "statements/shared-rules" }).first();
      const link = reference.getByRole("button", { name: "statements/shared-rules", exact: true });
      assert.doesNotMatch(await link.getAttribute("class") ?? "", /missing/);
      const toggle = reference.locator(".rule-reference-toggle");
      assert.equal(await toggle.textContent(), "2 条生效规则");
      await toggle.click();
      const body = reference.locator(".effective-rule-inline");
      await body.waitFor();
      assert.match(await body.textContent() ?? "", /The shared assertion applies/);
      assert.match(await body.textContent() ?? "", /Evidence-specific context/);
      await toggle.click();
      assert.equal(await body.isHidden(), true);
      await link.click();
      await page.waitForURL(`${url}/projects/responsive/memories/statements/shared-rules?change=${changeId}`);
      await page.locator('[data-view-slot="header.title"] p', { hasText: "statements/shared-rules" }).waitFor();
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      await page.getByText("The shared assertion applies.", { exact: true }).waitFor();
      assert.equal(await page.locator(".memory-error").count(), 0, await page.locator("body").innerText());
    } finally {
      await page.close();
    }
  }, { includeBrokenMemory: false, initializeGit: true });
});

test("ChangeSet unresolved rule references keep the candidate reviewable", async () => {
  await withResponsiveView(async (browser, url) => {
    const created = await fetch(`${url}/api/projects/responsive/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryReference: "statements/referencing-alias", operator: { kind: "human", id: "alice" } })
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const changeId = (JSON.parse(createdText) as { change: { id: string } }).change.id;
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(`${url}/projects/responsive/changes/${changeId}`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const reference = page.locator(".rule-reference", { hasText: "statements/shared-rules-alias" }).first();
      assert.match(await reference.locator(".memory-ref-link").getAttribute("class") ?? "", /missing/);
      assert.equal(await reference.locator(".rule-reference-toggle").count(), 0);
      assert.equal(await page.locator(".memory-error").count(), 0);
    } finally {
      await page.close();
    }
  }, { includeBrokenMemory: false, initializeGit: true });
});

test("ChangeSet valid references remain expandable beside a missing reference in the same field", async () => {
  await withResponsiveView(async (browser, url, fixture) => {
    const changeId = await candidateProcedureChange(fixture, async root => {
      const path = join(root, "procedures/reviewable-procedure.yaml");
      await writeFile(path, (await readFile(path, "utf8")).replace("    artifact:", "      - !ref\n        target: statements/missing-rules\n    artifact:"));
    });
    const response = await fetch(`${url}/api/projects/responsive/changes/${changeId}`);
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json() as { targetMemories: Array<{ memory: { entity: { flow: Array<{ effectiveRules: { asserts: unknown[] } }> } } }> };
    assert.deepEqual(payload.targetMemories[0]?.memory.entity.flow[0]?.effectiveRules.asserts, [
      "Action field comments must be available.",
      { reference: "statements/shared-rules", asserts: ["The shared assertion applies."], sections: [{ name: "Evidence", defines: ["Evidence-specific context."], asserts: ["Cite supporting evidence."] }] }
    ]);
    const page = await browser.newPage();
    try {
      await page.goto(`${url}/projects/responsive/changes/${changeId}`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const valid = page.locator(".rule-reference", { hasText: "statements/shared-rules" }).first();
      await valid.locator(".rule-reference-toggle").click();
      await valid.locator(".effective-rule-inline").waitFor();
      assert.match(await valid.innerText(), /The shared assertion applies/);
      const invalid = page.locator(".rule-reference", { hasText: "statements/missing-rules" }).first();
      assert.match(await invalid.locator(".memory-ref-link").getAttribute("class") ?? "", /missing/);
      assert.equal(await invalid.locator(".rule-reference-toggle").count(), 0);
    } finally { await page.close(); }
  }, { includeBrokenMemory: false, initializeGit: true });
});

test("ChangeSet compares each version's Statement rules and opens the candidate version", async () => {
  await withResponsiveView(async (browser, url, fixture) => {
    const changeId = await candidateProcedureChange(fixture, async root => {
      const statementPath = join(root, "statements/shared-rules.yaml");
      await writeFile(statementPath, (await readFile(statementPath, "utf8")).replace("  - The shared assertion applies.", "  - Candidate assertion.\n  - Candidate extra assertion."));
      const procedurePath = join(root, "procedures/reviewable-procedure.yaml");
      await writeFile(procedurePath, (await readFile(procedurePath, "utf8")).replace("Inspect an action field.", "Inspect the candidate action field."));
    }, true);
    for (let request = 0; request < 3; request += 1) {
      const response = await fetch(`${url}/api/projects/responsive/changes/${changeId}`);
      assert.equal(response.status, 200, await response.clone().text());
      type ProjectedProcedure = { entity: { flow: Array<{ effectiveRules: { asserts: unknown[] } }> } };
      const payload = await response.json() as { targetMemories: Array<{ reference: string; memory: ProjectedProcedure; baseMemory: ProjectedProcedure }> };
      const procedure = payload.targetMemories.find(memory => memory.reference === "procedures/reviewable-procedure")!;
      const section = { name: "Evidence", defines: ["Evidence-specific context."], asserts: ["Cite supporting evidence."] };
      assert.deepEqual(procedure.baseMemory.entity.flow[0]?.effectiveRules.asserts, ["Action field comments must be available.", { reference: "statements/shared-rules", asserts: ["The shared assertion applies."], sections: [section] }]);
      assert.deepEqual(procedure.memory.entity.flow[0]?.effectiveRules.asserts, ["Action field comments must be available.", { reference: "statements/shared-rules", asserts: ["Candidate assertion.", "Candidate extra assertion."], sections: [section] }]);
    }
    const page = await browser.newPage();
    try {
      await page.goto(`${url}/projects/responsive/changes/${changeId}`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      const reference = page.locator(".rule-reference", { hasText: "statements/shared-rules" }).first();
      assert.equal(await reference.locator(".rule-reference-toggle").textContent(), "3 条生效规则");
      await reference.locator(".rule-reference-toggle").click();
      const body = reference.locator(".effective-rule-inline");
      await body.waitFor();
      assert.match(await body.innerText(), /Candidate extra assertion/);
      assert.doesNotMatch(await body.innerText(), /The shared assertion applies/);
      await reference.locator(".memory-ref-link").click();
      await page.waitForURL(`${url}/projects/responsive/memories/statements/shared-rules?change=${changeId}`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      await page.getByText("Candidate extra assertion.", { exact: true }).waitFor();
    } finally { await page.close(); }
  }, { includeBrokenMemory: false, initializeGit: true });
});

test("leaving and reentering a ChangeSet keeps formal and candidate Memory sources separate", async () => {
  await withResponsiveView(async (browser, url, fixture) => {
    const changeId = await candidateProcedureChange(fixture, async root => {
      const path = join(root, "statements/shared-rules.yaml");
      await writeFile(path, (await readFile(path, "utf8"))
        .replace("The shared assertion applies.", "Candidate-only assertion.")
        .replace("names: [ shared-rules, shared-rules-alias, Shared rules ]", "names: [ shared-rules, Candidate-only title ]"));
    }, true);
    const page = await browser.newPage();
    const formalPath = `/projects/responsive/memories/statements/shared-rules`;
    const expandedPaths = new Set([formalPath]);
    const navigate = async (path: string) => {
      await page.evaluate(path => {
        history.pushState({}, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
      await page.waitForURL(`${url}${path}`);
      await page.locator('[data-view-slot="header.title"] p', { hasText: "statements/shared-rules" }).waitFor();
      await page.locator(".memory-title").filter(path.includes("?change=")
        ? { hasText: "Candidate-only title" }
        : { hasNotText: "Candidate-only title" }).waitFor();
      if (!expandedPaths.has(path)) {
        await page.getByRole("button", { name: "展开全部", exact: true }).click();
        expandedPaths.add(path);
      }
      await page.getByRole("button", { name: "收起全部", exact: true }).waitFor();
      assert.equal(await page.locator(".memory-disclosure-root details:not([open])").count(), 0, "returning to a Memory preserves its expanded native disclosures");
      assert.equal(await page.locator(".memory-disclosure-root .memory-section:not(.open)").count(), 0, "returning to a Memory preserves its expanded sections");
    };
    try {
      await page.goto(`${url}${formalPath}`);
      await page.getByRole("button", { name: "展开全部", exact: true }).click();
      await page.getByText("The shared assertion applies.", { exact: true }).waitFor();
      await navigate(`${formalPath}?change=${changeId}`);
      await page.getByText("Candidate-only assertion.", { exact: true }).waitFor();
      await page.locator(".memory-title", { hasText: "Candidate-only title" }).waitFor();
      const formalReload = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/memories") && new URL(response.url()).search === "?representation=summary" && response.ok());
      await navigate(formalPath);
      await formalReload;
      await page.getByText("The shared assertion applies.", { exact: true }).waitFor();
      assert.equal(await page.getByText("Candidate-only assertion.", { exact: true }).count(), 0);
      assert.equal(await page.locator(".mem-view-list-item-heading strong", { hasText: "Candidate-only title" }).count(), 0);
      assert.equal(await page.locator(".memory-change-context").count(), 0);
      await navigate(`${formalPath}?change=${changeId}`);
      await page.getByText("Candidate-only assertion.", { exact: true }).waitFor();
      assert.equal(await page.getByText("The shared assertion applies.", { exact: true }).count(), 0);
      await navigate(formalPath);
      await page.getByText("The shared assertion applies.", { exact: true }).waitFor();
    } finally { await page.close(); }
  }, { includeBrokenMemory: false, initializeGit: true });
});

test("retired Memory Review API and page routes return 404", async () => {
  await withResponsiveView(async (_browser, url) => {
    const api = await fetch(`${url}/api/reviews`);
    assert.equal(api.status, 404);
    const memoryReview = await fetch(`${url}/projects/responsive/memories/concepts/user-note/reviews/review-1`);
    assert.equal(memoryReview.status, 404);
    const changeReview = await fetch(`${url}/projects/responsive/changes/change-1/reviews/review-1`);
    assert.equal(changeReview.status, 404);
    const changeList = await fetch(`${url}/projects/responsive/changes`);
    assert.equal(changeList.status, 404);
  });
});

test("multiple Human identities require and persist a Project-local ChangeSet selection", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(`${url}/projects/responsive/memories`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => localStorage.getItem("memsphere.changeActorSelection.v1")), null);
      const dialogs: string[] = [];
      await page.locator(".mem-view-list-item").first().click();
      await page.locator(".memory-title").waitFor();
      const created = page.waitForRequest((request) => (
        request.method() === "POST" && new URL(request.url()).pathname === "/api/projects/responsive/changes"
      ));
      await page.getByRole("button", { name: "创建变更", exact: true }).click();
      const operatorPrompt = page.waitForEvent("dialog");
      const confirmClick = page.locator("dialog.mem-view-confirm").getByRole("button", { name: "修改", exact: true }).click();
      const promptDialog = await operatorPrompt;
      dialogs.push(promptDialog.type());
      await promptDialog.accept("bob");
      await confirmClick;
      const request = await created;
      assert.deepEqual(request.postDataJSON().operator, { kind: "human", id: "bob" });
      assert.deepEqual(dialogs, ["prompt"]);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("memsphere.changeActorSelection.v1") ?? "{}")), { responsive: "bob" });
      await page.reload({ waitUntil: "networkidle" });
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("memsphere.changeActorSelection.v1") ?? "{}")), { responsive: "bob" });
    } finally {
      await page.close();
    }
  });
});

test("Run pages do not expose the retired Task Review entry or inline comments", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(5_000);
    try {
      await page.goto(url);
      const runsLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/projects/responsive/runs" && response.ok()
      );
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await runsLoaded;
      await page.getByRole("button", { name: "已完成", exact: true }).click();
      await page.locator(".mem-view-list-item").first().click();
      assert.equal(await page.getByRole("button", { name: /^(Review|产物评审)$/ }).count(), 0);
      assert.equal(await page.locator('[data-anchor^="task:"] .memory-inline-plus:visible').count(), 0);
      assert.equal(await page.locator(".run-review-dialog").count(), 0);
    } finally {
      await page.close();
    }
  });
});

test("View deep links restore Memory, Run, and browser history", async () => {
  await withResponsiveView(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(`${url}/projects/responsive/memories/concepts/user-note`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".memory-title").textContent(), "User note", await page.locator("body").innerText());
      assert.match(await page.locator(".memory-workspace").textContent() ?? "", /A user memory fixture/);
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/memories/concepts/user-note");

      await page.goto(`${url}/projects/responsive/memories/schemas/reviewable-schema`);
      await page.locator(".memory-title", { hasText: "Reviewable schema" }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/memories/schemas/reviewable-schema");

      const runsLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/projects/responsive/runs" && response.ok()
      );
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await runsLoaded;
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/tasks");
      const selectedDetailLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/projects/responsive/runs/${runId}` && response.ok()
      );
      await page.getByRole("button", { name: "已完成", exact: true }).click();
      await page.locator(".mem-view-list-item").first().click();
      await selectedDetailLoaded;
      await page.waitForLoadState("networkidle");
      assert.equal(new URL(page.url()).pathname, `/projects/responsive/tasks/${runId}`);
      await page.evaluate(() => history.back());
      await page.waitForURL(url + "/projects/responsive/tasks?status=done");
      await page.waitForLoadState("networkidle");
      assert.equal(new URL(page.url()).pathname, "/projects/responsive/tasks");
      assert.equal(new URL(page.url()).searchParams.get("status"), "done");
      await page.locator(".run-workspace").getByText("选择一个 Run 查看详情。", { exact: true }).waitFor();
      assert.equal(await page.locator(".mem-view-list-item.active").count(), 0);
      const forwardDetailLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/projects/responsive/runs/${runId}` && response.ok()
      );
      await page.evaluate(() => history.forward());
      await page.waitForURL(url + `/projects/responsive/tasks/${runId}?status=done`);
      await forwardDetailLoaded;
      await page.waitForLoadState("networkidle");
      await page.locator(".run-title", { hasText: runName }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/projects/responsive/tasks/${runId}`);
      assert.equal(new URL(page.url()).searchParams.get("status"), "done");

      await page.evaluate(() => {
        history.pushState({}, "", "/projects/responsive/tasks");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.waitForURL(url + "/projects/responsive/tasks");

      let releaseStaleRunDetail!: () => void;
      let captureStaleRunDetail!: () => void;
      const staleRunDetailGate = new Promise<void>((resolve) => { releaseStaleRunDetail = resolve; });
      const staleRunDetailCaptured = new Promise<void>((resolve) => { captureStaleRunDetail = resolve; });
      let delayedRunDetail = false;
      await page.route(`**/api/projects/responsive/runs/${runId}`, async (route) => {
        if (delayedRunDetail) return route.continue();
        delayedRunDetail = true;
        const response = await route.fetch();
        captureStaleRunDetail();
        await staleRunDetailGate;
        await route.fulfill({ response });
      });
      const staleRunDetailResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/projects/responsive/runs/${runId}`
      );
      await page.evaluate((path) => {
        history.pushState({}, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, `/projects/responsive/tasks/${runId}`);
      await staleRunDetailCaptured;

      const latestRunDetailResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/projects/responsive/runs/${legacyRunId}`
      );
      await page.evaluate((path) => {
        history.pushState({}, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, `/projects/responsive/tasks/${legacyRunId}`);
      releaseStaleRunDetail();
      assert.equal((await staleRunDetailResponse).status(), 200);
      assert.equal((await latestRunDetailResponse).status(), 200);
      await page.locator(".run-title", { hasText: "Legacy procedure fallback" }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/projects/responsive/tasks/${legacyRunId}`);
      assert.equal(await page.locator(".run-title").textContent(), "Legacy procedure fallback");

      const missing = await browser.newPage();
      await missing.goto(`${url}/projects/responsive/memories/concepts/${encodeURIComponent("Missing memory")}`);
      await missing.locator(".memory-error").waitFor();
      assert.match(await missing.locator(".memory-error").textContent() ?? "", /未找到|not found/i);
      await missing.close();

      assert.equal((await fetch(`${url}/unknown-page`)).status, 404);
      assert.equal((await fetch(`${url}/api/unknown-page`)).status, 404);
    } finally {
      await page.close();
    }
  });
});
