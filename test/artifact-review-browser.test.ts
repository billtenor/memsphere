import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import {
  currentArtifactReview,
  readRun,
  reportRun,
  startRun,
  submitArtifactReviewRunnerVote
} from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Human Artifact Review completes in View with private drafts and distinct vote roles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-artifact-review-browser-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "reviewed.yaml"), withCurrentMemorySyntax(`!procedure
name: browser-review
role_bindings:
  decider: alice
flow:
  - !action
    action: 产出需要人工评审的结果。
    artifact: !artifact
      name: 人工评审结果
      format: markdown
      review: artifact_acceptance.unanimous
      role_bindings:
        advisor: bob
`));
  const controlPlane = parseControlPlaneConfig({
    identities: {
      alice: { kind: "human", name: "Alice" },
      bob: { kind: "human", name: "Bob" }
    },
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      },
      decider: {
        name: "Decider",
        permissions: ["artifact.read", "decision.decide"]
      },
      advisor: {
        name: "Advisor",
        permissions: ["artifact.read", "decision.assess"]
      }
    }
  });
  const started = await startRun({ memoryRoot, runsRoot, procedureName: "browser-review", controlPlane });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Candidate\n\nVisible only after identity authorization.\n" }
  });
  const firstReview = currentArtifactReview(pending);
  assert(firstReview);

  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    view: { host: "127.0.0.1", port: 0 },
    controlPlane
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3_000);
    page.on("pageerror", (error) => console.error("browser page error", error));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const memoryArtifact = page.locator(".artifact-row").first();
    await memoryArtifact.getByText("评审", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Review", exact: true }).waitFor();
    assert.equal(await memoryArtifact.getByText("Decider", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("Advisor", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("decider", { exact: true }).count(), 0);
    assert.equal(await memoryArtifact.getByText("advisor", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByRole("button", { name: /^产物评审 0\/2$/ }).click();
    const reviewModal = page.locator("#artifact-review-modal");
    await reviewModal.waitFor();
    let identity = page.getByRole("combobox", { name: "评审身份" });
    await identity.waitFor();
    assert.equal(await page.getByRole("button", { name: "Create Review", exact: true }).isVisible(), false);

    await identity.click();
    const identityMenu = page.locator(".artifact-review-identity-select .artifact-review-select-menu");
    const identityTriggerBox = await identity.boundingBox();
    const identityMenuBox = await identityMenu.boundingBox();
    assert(identityTriggerBox && identityMenuBox);
    assert(identityMenuBox.y >= identityTriggerBox.y + identityTriggerBox.height);
    assert.match(await identityMenu.locator('[data-identity-id="alice"]').innerText(), /^Decider ·/);
    assert.match(await identityMenu.locator('[data-identity-id="bob"]').innerText(), /^Advisor ·/);

    await selectIdentity(page, identity, "alice");
    await reviewModal.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    assert.equal(await reviewModal.getByText("decider", { exact: true }).count(), 0);
    const candidateTarget = reviewModal.locator(".artifact-review-target").filter({ hasText: "Candidate" }).first();
    const anchoredSaved = page.waitForResponse((response) =>
      response.url().endsWith("/draft") && response.request().method() === "PATCH"
    );
    await candidateTarget.getByTitle("Add review comment").click();
    await candidateTarget.getByPlaceholder("What should change here?").fill("Heading needs revision.");
    await candidateTarget.getByRole("button", { name: "Add comment", exact: true }).click();
    assert.equal((await anchoredSaved).status(), 200);
    await reviewModal.locator(".comment-card .artifact-review-markdown")
      .getByText("Heading needs revision.", { exact: true }).waitFor();
    const composer = reviewModal.getByPlaceholder("补充整体评审意见");
    await composer.fill("Alice private draft");
    await reviewModal.getByRole("button", { name: "添加意见", exact: true }).click();
    await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();

    await selectIdentity(page, identity, "bob");
    assert.equal(await reviewModal.getByText("Alice private draft", { exact: true }).count(), 0);
    await selectIdentity(page, identity, "alice");
    await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();
    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "修改", exact: true }));
    await submitThroughConfirmation(page);

    await selectIdentity(page, identity, "bob");
    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "修改", exact: true }));
    await reviewModal.getByPlaceholder("补充整体评审意见").fill("Keep the accepted result concise.");
    await reviewModal.getByRole("button", { name: "添加意见", exact: true }).click();
    await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
    await submitThroughConfirmation(page);

    const rejected = await readRun(runsRoot, started.id);
    assert.equal(currentArtifactReview(rejected)?.status, "awaiting_revision");
    const revised = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Revised candidate\n\nThe first-round comments were addressed.\n" },
      revisionSummary: "Addressed the first-round comments."
    });
    const secondReview = currentArtifactReview(revised);
    assert(secondReview);
    assert.equal(secondReview.rounds.length, 2);

    await page.reload();
    await page.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByRole("button", { name: /^产物评审 0\/2$/ }).click();
    identity = page.getByRole("combobox", { name: "评审身份" });
    await identity.waitFor();
    const reviewPanel = page.locator("#artifact-review-review-pane");
    const reviewResizer = page.getByRole("separator", { name: "调整产物与评审区域宽度" });
    await page.waitForTimeout(220);
    const panelBeforeResize = await reviewPanel.boundingBox();
    const resizerBox = await reviewResizer.boundingBox();
    assert(panelBeforeResize && resizerBox);
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x - 120, resizerBox.y + 100, { steps: 4 });
    await page.mouse.up();
    const panelAfterResize = await reviewPanel.boundingBox();
    assert(panelAfterResize);
    assert(
      panelAfterResize.width >= panelBeforeResize.width + 100,
      `expected drag to grow review panel: ${panelBeforeResize.width} -> ${panelAfterResize.width}`
    );
    assert.equal(await page.evaluate(() => Number(localStorage.getItem("memsphere.artifactReviewSplit.v1")) < 58), true);
    await reviewResizer.press("ArrowRight");
    await page.waitForTimeout(220);
    const panelAfterKeyboard = await reviewPanel.boundingBox();
    assert(panelAfterKeyboard);
    assert(panelAfterKeyboard.width < panelAfterResize.width);
    await selectIdentity(page, identity, "alice");
    await reviewModal.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    assert.equal(await reviewModal.getByText("Alice private draft", { exact: true }).count(), 0);
    assert.equal(await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).count(), 0);
    if (process.env.MEMSPHERE_SCREENSHOT_DIR) {
      await page.screenshot({
        path: join(process.env.MEMSPHERE_SCREENSHOT_DIR, "artifact-review-desktop.png"),
        fullPage: true
      });
    }

    const roundSelector = page.getByRole("button", { name: "轮次", exact: true });
    await roundSelector.evaluate((select) => {
      select.dataset.pollingSentinel = "preserved";
    });
    await roundSelector.click();
    const roundMenu = page.getByRole("listbox", { name: "轮次" });
    await roundMenu.waitFor();
    const triggerBox = await roundSelector.boundingBox();
    const menuBox = await roundMenu.boundingBox();
    assert(triggerBox && menuBox);
    assert(menuBox.y >= triggerBox.y + triggerBox.height);
    await page.waitForTimeout(4_300);
    assert.equal(await roundSelector.getAttribute("data-polling-sentinel"), "preserved");
    assert.equal(await roundMenu.isVisible(), true);
    await roundMenu.locator(`[data-round-id="${firstReview.currentRoundId}"]`).click();
    await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();
    await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
    const anchoredCard = reviewModal.locator(".comment-card").filter({ hasText: "Heading needs revision." });
    await anchoredCard.getByRole("button", { name: "定位", exact: true }).click();
    await reviewModal.locator(".artifact-review-target-located").waitFor();
    await roundSelector.click();
    await roundMenu.locator(`[data-round-id="${secondReview.currentRoundId}"]`).click();
    await reviewModal.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    assert.equal(await reviewModal.getByText("Alice private draft", { exact: true }).count(), 0);
    assert.equal(await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).count(), 0);

    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "通过", exact: true }));
    await submitThroughConfirmation(page);
    await selectIdentity(page, identity, "bob");
    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "通过", exact: true }));
    await submitThroughConfirmation(page);

    const beforeRunnerVote = await readRun(runsRoot, started.id);
    assert.equal(currentArtifactReview(beforeRunnerVote)?.status, "awaiting_runner_vote");
    await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: secondReview.id,
      roundId: secondReview.currentRoundId,
      vote: "approve"
    });

    await reviewModal.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    await page.getByText("done", { exact: true }).first().waitFor();
    const completed = await readRun(runsRoot, started.id);
    assert.equal(completed.status, "done");
    assert.equal(completed.events.length, 1);

    await reviewModal.getByRole("button", { name: "关闭", exact: true }).click();
    await reviewModal.waitFor({ state: "hidden" });
    await page.evaluate(() => {
      const target = window as typeof window & { __reviewOpenPosition?: { scrollY: number; top: number } };
      const content = document.querySelector<HTMLElement>(".content");
      if (content) content.style.paddingTop = "1400px";
      const button = document.querySelector<HTMLButtonElement>(".task-result [data-artifact-review-id]");
      button?.addEventListener("click", () => {
        target.__reviewOpenPosition = { scrollY: window.scrollY, top: button.getBoundingClientRect().top };
      }, { capture: true, once: true });
    });
    await page.locator(".task-result").getByRole("button", { name: "产物评审", exact: true }).click();
    await reviewModal.waitFor();
    const completedRoundSelector = reviewModal.getByRole("button", { name: "轮次", exact: true });
    await completedRoundSelector.click();
    await reviewModal.getByRole("listbox", { name: "轮次" })
      .locator(`[data-round-id="${firstReview.currentRoundId}"]`).click();
    await reviewModal.locator(".comment-card .artifact-review-markdown")
      .getByText("Heading needs revision.", { exact: true }).waitFor();

    const reviewOpenPosition = await page.evaluate(() =>
      (window as typeof window & { __reviewOpenPosition?: { scrollY: number; top: number } }).__reviewOpenPosition
    );
    assert(reviewOpenPosition && reviewOpenPosition.scrollY > 0);
    await reviewModal.getByRole("button", { name: "关闭", exact: true }).click();
    await reviewModal.waitFor({ state: "hidden" });
    await page.waitForTimeout(100);
    const restoredPosition = await page.locator(".task-result [data-artifact-review-id]").evaluate((button) => ({
      scrollY: window.scrollY,
      top: button.getBoundingClientRect().top
    }));
    assert(Math.abs(restoredPosition.top - reviewOpenPosition.top) < 2, JSON.stringify({ reviewOpenPosition, restoredPosition }));
    await page.locator(".task-result").getByRole("button", { name: "产物评审", exact: true }).click();
    await reviewModal.waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    const artifactPane = page.locator("#artifact-review-artifact-pane");
    const mobileReviewPane = page.locator("#artifact-review-review-pane");
    await page.locator("#artifact-review-review-tab").click();
    assert.equal(await artifactPane.isVisible(), false);
    assert.equal(await mobileReviewPane.isVisible(), true);
    await page.locator("#artifact-review-artifact-tab").click();
    assert.equal(await artifactPane.isVisible(), true);
    assert.equal(await mobileReviewPane.isVisible(), false);
    const mobileOverflow = await reviewModal.evaluate((modal) => ({
      clientWidth: modal.clientWidth,
      scrollWidth: modal.scrollWidth
    }));
    assert.equal(mobileOverflow.scrollWidth <= mobileOverflow.clientWidth, true, JSON.stringify(mobileOverflow));
    if (process.env.MEMSPHERE_SCREENSHOT_DIR) {
      await page.screenshot({
        path: join(process.env.MEMSPHERE_SCREENSHOT_DIR, "artifact-review-mobile.png")
      });
    }
  } finally {
    await browser.close();
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

async function submitThroughConfirmation(page: import("playwright").Page): Promise<void> {
  await page.getByRole("button", { name: "提交评审", exact: true }).click();
  const dialog = page.locator("dialog.artifact-review-dialog");
  await dialog.waitFor();
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/submit") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "提交评审", exact: true }).click();
  const response = await submitted;
  assert.equal(response.status(), 200);
}

async function selectIdentity(
  page: import("playwright").Page,
  _select: import("playwright").Locator,
  identityId: string
): Promise<void> {
  const select = page.locator("#artifact-review-modal").getByRole("combobox", { name: "评审身份" });
  if (await select.getAttribute("aria-expanded") !== "true") await select.click();
  const option = page.locator(`.artifact-review-identity-select .artifact-review-select-option[data-identity-id="${identityId}"]`);
  await option.waitFor({ state: "visible" });
  if (await option.getAttribute("aria-selected") === "true") {
    await select.click();
    await page.waitForTimeout(20);
    return;
  }
  const loaded = page.waitForResponse((response) =>
    response.url().includes("/api/artifact-reviews/")
    && response.url().includes(`identity_id=${identityId}`)
    && response.request().method() === "GET"
  ).catch(() => undefined);
  await option.click();
  await Promise.race([
    loaded,
    page.waitForFunction(
      ({ id }) => document.querySelector(
        `.artifact-review-identity-select [data-identity-id="${id}"][aria-selected="true"]`
      ) !== null,
      { id: identityId }
    )
  ]);
  await page.waitForTimeout(20);
}

async function clickAndWaitForDraftSave(
  page: import("playwright").Page,
  button: import("playwright").Locator
): Promise<void> {
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/draft") && response.request().method() === "PATCH"
  );
  await button.click();
  const response = await saved;
  assert.equal(response.status(), 200);
}
