import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { artifactReviewAssignmentId } from "../src/artifact-review.js";
import { runArtifactReviewAgentWorker } from "../src/acp/review-worker.js";
import type { AgentReviewProvider } from "../src/acp/provider.js";
import { agentActivityPath, readAgentActivitySnapshot } from "../src/acp/activity.js";
import { reviewConfiguration } from "./helpers/review.js";
import { runGit } from "../src/git.js";

const browserTestDirectory = dirname(fileURLToPath(import.meta.url));
const browserFakeReviewer = join(browserTestDirectory, "fixtures", "fake-acp-reviewer.mjs");
const browserFakeCli = join(browserTestDirectory, "fixtures", "fake-review-cli.mjs");

test("Human Artifact Review completes in View with private drafts and distinct vote roles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-artifact-review-browser-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "reviewed.yaml"), withCurrentMemorySyntax(`!procedure
name: browser-review
flow:
  - !action
    action: 产出需要人工评审的结果。
    artifact: !artifact
      name: 人工评审结果
      format: markdown
      review: [Decider, Advisor]
`));
  const controlPlane = parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read", "artifact.submit", "decision.decide"]
    },
    actors: {
      alice: {
        kind: "human",
        name: "Decider",
        permissions: ["artifact.read", "decision.decide"]
      },
      bob: {
        kind: "human",
        name: "Advisor",
        permissions: ["artifact.read", "decision.assess"]
      }
    }
  });
  const started = await startRun({
    name: "Test run",
    memoryRoot,
    runsRoot,
    procedureName: "browser-review",
    controlPlane,
    reviewConfiguration: reviewConfiguration({
      procedure: "browser-review",
      slots: { Decider: ["alice"], Advisor: ["bob"] }
    })
  });
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
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => console.error("browser page error", error));
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(`http://127.0.0.1:${address.port}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    const memoryArtifact = page.locator(".artifact-row").first();
    await memoryArtifact.getByText("评审", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Review", exact: true }).isVisible(), false);
    assert.equal(await memoryArtifact.getByText("Decider", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("Advisor", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("decider", { exact: true }).count(), 0);
    assert.equal(await memoryArtifact.getByText("advisor", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const bindingPanel = page.locator(".run-bindings");
    const bindingToggle = bindingPanel.locator(".run-binding-toggle");
    const bindingBody = bindingPanel.locator(".run-binding-body");
    await bindingToggle.waitFor();
    assert.equal(await bindingToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await bindingBody.isVisible(), false);
    await bindingToggle.click();
    assert.equal(await bindingToggle.getAttribute("aria-expanded"), "true");
    await bindingBody.getByText("换绑只影响尚未创建的 Review；已创建 Review 的参与者保持不变。", { exact: true }).waitFor();
    await bindingToggle.click();
    assert.equal(await bindingToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await bindingBody.isVisible(), false);
    await page.getByRole("button", { name: /^产物评审 0\/2$/ }).click();
    const reviewModal = page.locator("#artifact-review-modal");
    await reviewModal.waitFor();
    for (const heading of ["评审范围", "我的评审", "参与进度", "评审记录"]) {
      await reviewModal.getByRole("heading", { name: heading, exact: true }).waitFor();
    }
    const scopePanel = reviewModal.locator("#artifact-review-scope-panel");
    await scopePanel.getByText("artifact_acceptance.unanimous", { exact: true }).waitFor();
    await page.waitForFunction(() => location.pathname.includes("/artifact-reviews/") && location.search.includes("round="));
    const deepReviewUrl = page.url();
    assert.match(new URL(deepReviewUrl).pathname, new RegExp(`^/tasks/${started.id}/artifact-reviews/`));
    const reopenedReview = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await reopenedReview.goto(deepReviewUrl);
    const reopenedModal = reopenedReview.locator("#artifact-review-modal[open]");
    await reopenedModal.waitFor();
    await reopenedModal.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    await reopenedReview.close();
    const staleReviewUrl = new URL(deepReviewUrl);
    const currentRoundId = staleReviewUrl.searchParams.get("round");
    staleReviewUrl.searchParams.set("round", "round-missing");
    staleReviewUrl.searchParams.set("material", "material-missing");
    const staleReview = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await staleReview.goto(staleReviewUrl.toString());
    await staleReview.locator("#artifact-review-modal[open]").waitFor();
    await staleReview.waitForFunction(expectedRound => {
      const params = new URLSearchParams(location.search);
      return params.get("round") === expectedRound && !params.has("material");
    }, currentRoundId);
    await staleReview.close();
    const material = reviewModal.getByRole("combobox", { name: "选择评审材料", exact: true });
    await material.click();
    await reviewModal.getByRole("option", { name: /^冻结契约/ }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get("material") === "contract");
    await material.click();
    await reviewModal.getByRole("option", { name: /^待评审产物/ }).click();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has("material"));
    assert.equal(await reviewModal.locator(".artifact-review-modal-header").getByText("artifact_acceptance.unanimous", { exact: true }).count(), 0);
    assert.equal(await scopePanel.getByRole("combobox", { name: "评审产物", exact: true }).count(), 1);
    assert.equal(await scopePanel.getByText("当前轮次", { exact: true }).count(), 1);
    let identity = page.getByRole("combobox", { name: "评审身份" });
    await identity.waitFor();
    assert.equal(await page.getByRole("button", { name: "Create Review", exact: true }).isVisible(), false);

    await identity.click();
    const identityMenu = page.locator(".artifact-review-actor-select .artifact-review-select-menu");
    const identityTriggerBox = await identity.boundingBox();
    const identityMenuBox = await identityMenu.boundingBox();
    assert(identityTriggerBox && identityMenuBox);
    assert(identityMenuBox.y >= identityTriggerBox.y + identityTriggerBox.height);
    assert.match(await identityMenu.locator('[data-actor-id="alice"]').innerText(), /^Decider ·/);
    assert.match(await identityMenu.locator('[data-actor-id="bob"]').innerText(), /^Advisor ·/);
    await reviewModal.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    const publicScope = await reviewModal.locator("#artifact-review-scope-panel").innerText();
    const publicProgress = await reviewModal.locator("#artifact-review-progress-panel").innerText();
    const publicRecord = await reviewModal.locator("#artifact-review-record-panel").innerText();

    await selectIdentity(page, identity, "alice");
    await reviewModal.getByRole("heading", { name: "投票", exact: true }).waitFor();
    await reviewModal.getByRole("heading", { name: "评审意见", exact: true }).waitFor();
    await reviewModal.getByRole("heading", { name: "提交评审", exact: true }).waitFor();
    const operationHeadings = (await reviewModal.locator("#artifact-review-my-panel h4").allTextContents())
      .filter((heading) => ["评审意见", "投票", "提交评审"].includes(heading));
    assert.deepEqual(operationHeadings, ["评审意见", "投票", "提交评审"]);
    await reviewModal.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    assert.equal(await reviewModal.locator("#artifact-review-scope-panel").innerText(), publicScope);
    assert.equal(await reviewModal.locator("#artifact-review-progress-panel").innerText(), publicProgress);
    assert.equal(await reviewModal.locator("#artifact-review-record-panel").innerText(), publicRecord);
    assert.equal(await reviewModal.getByText("decider", { exact: true }).count(), 0);
    const candidateTarget = reviewModal.locator(".artifact-review-target").filter({ hasText: "Candidate" }).first();
    const candidateSpacing = await candidateTarget.evaluate((target) => {
      const body = target.querySelector(".commentable-body");
      const targetStyle = getComputedStyle(target);
      const bodyStyle = body ? getComputedStyle(body) : null;
      return {
        marginBlockStart: targetStyle.marginBlockStart,
        marginBlockEnd: targetStyle.marginBlockEnd,
        whiteSpace: bodyStyle?.whiteSpace
      };
    });
    assert.deepEqual(candidateSpacing, {
      marginBlockStart: "0px",
      marginBlockEnd: "0px",
      whiteSpace: "normal"
    });
    const anchoredSaved = page.waitForResponse((response) =>
      response.url().endsWith("/draft") && response.request().method() === "PATCH"
    );
    await candidateTarget.getByTitle("Add review comment").click();
    await candidateTarget.getByPlaceholder("What should change here?").fill("Heading needs revision.");
    await candidateTarget.getByRole("button", { name: "Add comment", exact: true }).click();
    assert.equal((await anchoredSaved).status(), 200);
    await reviewModal.locator(".comment-card .artifact-review-markdown")
      .getByText("Heading needs revision.", { exact: true }).waitFor();
    const firstComment = reviewModal.locator(".comment-card").filter({ hasText: "Heading needs revision." });
    const commentHeader = firstComment.locator(".artifact-review-comment-head");
    const commentTitleBox = await commentHeader.locator("b").boundingBox();
    const severityBox = await commentHeader.locator(".pill").boundingBox();
    assert(commentTitleBox && severityBox);
    assert(severityBox.x > commentTitleBox.x);
    assert(Math.abs(severityBox.y - commentTitleBox.y) < 12);

    await reviewModal.locator(".inline-plus").first().click();
    let inlineEditor = reviewModal.locator(".inline-comment-editor").first();
    let inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    let inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await inlineTextarea.fill("Inline text before add survives refresh");
    await page.locator("#refresh").evaluate((button) => {
      if (button instanceof HTMLButtonElement) button.click();
    });
    inlineEditor = reviewModal.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await expectInlineValue(inlineTextarea, "Inline text before add survives refresh");
    await selectIdentity(page, identity, "bob");
    assert.equal(await page.getByText("Inline text before add survives refresh", { exact: true }).count(), 0);
    assert.equal(await reviewModal.locator(".inline-comment-editor").count(), 0);
    await selectIdentity(page, identity, "alice");
    inlineEditor = reviewModal.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await expectInlineValue(inlineTextarea, "Inline text before add survives refresh");
    await inlineEditor.getByRole("button", { name: "Cancel", exact: true }).click();

    await reviewModal.locator(".inline-plus").first().click();
    inlineEditor = reviewModal.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await inlineTextarea.fill("Inline canceled after failed save");
    let failNextDraftSave = true;
    await page.route("**/draft", async (route) => {
      if (failNextDraftSave && route.request().method() === "PATCH") {
        failNextDraftSave = false;
        await route.fulfill({ status: 503, body: "inline canceled outage" });
        return;
      }
      await route.continue();
    });
    await inlineSave.click();
    await page.getByText("inline canceled outage", { exact: true }).waitFor();
    await page.unroute("**/draft");
    await inlineEditor.getByRole("button", { name: "Cancel", exact: true }).click();

    await reviewModal.locator(".inline-plus").first().click();
    inlineEditor = reviewModal.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await inlineTextarea.fill("Inline text survives a failed save");
    failNextDraftSave = true;
    await page.route("**/draft", async (route) => {
      if (failNextDraftSave && route.request().method() === "PATCH") {
        failNextDraftSave = false;
        await route.fulfill({ status: 503, body: "inline draft outage" });
        return;
      }
      await route.continue();
    });
    await inlineSave.click();
    await page.getByText("inline draft outage", { exact: true }).waitFor();
    assert.equal(await inlineTextarea.inputValue(), "Inline text survives a failed save");
    assert.equal(await inlineSave.isEnabled(), true);
    await page.unroute("**/draft");
    await page.waitForTimeout(50);
    const inlineRetrySaved = page.waitForResponse((response) =>
      response.url().endsWith("/draft") && response.request().method() === "PATCH"
    );
    await inlineSave.evaluate((button) => {
      if (button instanceof HTMLButtonElement) button.click();
    });
    assert.equal((await inlineRetrySaved).status(), 200);
    let afterFailedInlineRetry = await readRun(runsRoot, started.id);
    let aliceAssignment = currentArtifactReview(afterFailedInlineRetry)?.rounds[0]?.assignments.find((assignment) => assignment.actorId === "alice");
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Inline text survives a failed save").length,
      1
    );

    const composer = reviewModal.getByPlaceholder("补充整体评审意见");
    const composerBounds = await composer.boundingBox();
    const severitySelect = composer.locator("..").getByRole("combobox", { name: "意见分类" });
    const severityBounds = await severitySelect.boundingBox();
    assert(composerBounds && severityBounds);
    assert(severityBounds.y < composerBounds.y);
    assert(severityBounds.height < composerBounds.height);
    assert.equal(await composer.locator("..").locator("select").count(), 0);
    await severitySelect.click();
    const severityMenu = composer.locator("..").getByRole("listbox", { name: "意见分类" });
    assert.equal(await severityMenu.isVisible(), true);
    await severityMenu.getByRole("option", { name: "阻塞问题", exact: true }).click();
    assert.equal(await severitySelect.textContent(), "阻塞问题⌄");
    await composer.fill("Composer text replaced after failed save");
    failNextDraftSave = true;
    await page.route("**/draft", async (route) => {
      if (failNextDraftSave && route.request().method() === "PATCH") {
        failNextDraftSave = false;
        await route.fulfill({ status: 503, body: "composer replaced outage" });
        return;
      }
      await route.continue();
    });
    await reviewModal.getByRole("button", { name: "添加意见", exact: true }).click();
    await page.getByText("composer replaced outage", { exact: true }).waitFor();
    assert.equal(await composer.isEnabled(), true);
    await page.unroute("**/draft");
    await composer.fill("Composer replacement that should wait for add");

    await composer.fill("Alice text survives a failed save");
    failNextDraftSave = true;
    await page.route("**/draft", async (route) => {
      if (failNextDraftSave && route.request().method() === "PATCH") {
        failNextDraftSave = false;
        await route.fulfill({ status: 503, body: "temporary draft outage" });
        return;
      }
      await route.continue();
    });
    await reviewModal.getByRole("button", { name: "添加意见", exact: true }).click();
    await page.getByText("temporary draft outage", { exact: true }).waitFor();
    assert.equal(await composer.inputValue(), "Alice text survives a failed save");
    assert.equal(await composer.isEnabled(), true);
    await page.unroute("**/draft");
    await clickAndWaitForDraftSave(page, reviewModal.getByRole("button", { name: "添加意见", exact: true }));
    assert.equal(await composer.isEnabled(), true);
    let afterFailedComposerRetry = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterFailedComposerRetry)?.rounds[0]?.assignments.find((assignment) => assignment.actorId === "alice");
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Alice text survives a failed save").length,
      1
    );
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Inline canceled after failed save").length,
      0
    );
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Composer text replaced after failed save").length,
      0
    );
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Composer replacement that should wait for add").length,
      0
    );
    await composer.fill("Alice private draft");
    await staleRoundWithBobDraft(address.port, firstReview.id, firstReview.currentRoundId, "Bob stale update before Alice add");
    await clickAndWaitForForcedDraftRecovery(
      page,
      reviewModal.getByRole("button", { name: "添加意见", exact: true })
    );
    await page.getByText("Alice private draft", { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder("补充整体评审意见").isEnabled(), true);
    assert.deepEqual(dialogs, []);
    let afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.actorId === "alice");
    assert.equal(aliceAssignment?.draft.comments.some((comment) => comment.body === "Alice private draft"), true);

    await staleRoundWithBobDraft(address.port, firstReview.id, firstReview.currentRoundId, "Bob stale update before Alice vote");
    const aliceVoteRecovery = waitForDraftSaveAfterExternalUpdate(page);
    await reviewModal.getByRole("radio", { name: "修改", exact: true }).click();
    await aliceVoteRecovery;
    assert.equal(await reviewModal.getByRole("radio", { name: "修改", exact: true }).getAttribute("aria-checked"), "true");
    afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.actorId === "alice");
    assert.equal(aliceAssignment?.draft.vote, "request_changes");

    await staleRoundWithBobDraft(address.port, firstReview.id, firstReview.currentRoundId, "Bob stale update before Alice delete");
    const aliceDeleteRecovery = waitForDraftSaveAfterExternalUpdate(page);
    await reviewModal.locator(".comment-card").filter({ hasText: "Alice private draft" }).getByRole("button", { name: "删除", exact: true }).click();
    await aliceDeleteRecovery;
    assert.equal(await page.getByText("Alice private draft", { exact: true }).count(), 0);
    afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.actorId === "alice");
    assert.equal(aliceAssignment?.draft.comments.some((comment) => comment.body === "Alice private draft"), false);

    await reviewModal.getByPlaceholder("补充整体评审意见").fill("Alice private draft");
    await clickAndWaitForDraftSave(
      page,
      reviewModal.getByRole("button", { name: "添加意见", exact: true })
    );
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
    await clickAndWaitForDraftSave(
      page,
      reviewModal.getByRole("button", { name: "添加意见", exact: true })
    );
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
    await page.locator("#artifact-review-modal[open]").waitFor();
    await page.locator("#artifact-review-modal-close").click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
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
    await scopePanel.getByText("历史轮次 · 只读", { exact: true }).waitFor();
    await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();
    await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
    const anchoredCard = reviewModal.locator(".comment-card").filter({ hasText: "Heading needs revision." });
    await anchoredCard.getByRole("button", { name: "定位", exact: true }).click();
    await reviewModal.locator(".artifact-review-target-located").waitFor();
    await roundSelector.click();
    await roundMenu.locator(`[data-round-id="${secondReview.currentRoundId}"]`).click();
    await scopePanel.getByText("当前轮次", { exact: true }).waitFor();
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
    await roundSelector.click();
    await roundMenu.locator(`[data-round-id="${firstReview.currentRoundId}"]`).click();
    await reviewModal.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
    assert.equal(await reviewModal.getByRole("button", { name: "处置", exact: true }).count(), 0);
    await roundSelector.click();
    await roundMenu.locator(`[data-round-id="${secondReview.currentRoundId}"]`).click();
    await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: secondReview.id,
      roundId: secondReview.currentRoundId,
      vote: "approve"
    });

    await reviewModal.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    await page.getByText("done", { exact: true }).first().waitFor({ timeout: 6_000 });
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
    const lockedScrollY = await page.evaluate(() => window.scrollY);
    assert.equal(await page.locator("html").getAttribute("class"), "artifact-review-modal-open");
    assert.match(await page.locator("body").getAttribute("class") || "", /\bartifact-review-modal-open\b/);
    await page.mouse.move(2, 2);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.scrollY), lockedScrollY);
    const reviewPane = page.locator("#artifact-review-review-pane");
    await reviewPane.evaluate((pane) => {
      pane.scrollTop = pane.scrollHeight;
    });
    const reviewPaneBox = await reviewPane.boundingBox();
    assert(reviewPaneBox);
    await page.mouse.move(
      reviewPaneBox.x + reviewPaneBox.width / 2,
      reviewPaneBox.y + reviewPaneBox.height / 2
    );
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.scrollY), lockedScrollY);
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

    await page.setViewportSize({ width: 2560, height: 1080 });
    const desktopLayout = await reviewModal.evaluate((modal) => {
      const artifactPane = modal.querySelector<HTMLElement>("#artifact-review-artifact-pane");
      const reviewPane = modal.querySelector<HTMLElement>("#artifact-review-review-pane");
      const bounds = modal.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        artifactOverflowX: artifactPane ? getComputedStyle(artifactPane).overflowX : "",
        reviewOverflowX: reviewPane ? getComputedStyle(reviewPane).overflowX : ""
      };
    });
    assert(Math.abs(desktopLayout.width - desktopLayout.viewportWidth * 0.9) < 3, JSON.stringify(desktopLayout));
    assert(Math.abs(desktopLayout.height - desktopLayout.viewportHeight * 0.9) < 3, JSON.stringify(desktopLayout));
    assert.equal(desktopLayout.artifactOverflowX, "hidden");
    assert.equal(desktopLayout.reviewOverflowX, "hidden");

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

test("Artifact Review without a Human Assignment keeps the public workspace visible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-agent-only-review-browser-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "agent-only.yaml"), withCurrentMemorySyntax(`!procedure
name: agent-only-review-browser
flow:
  - !action
    action: Produce an Agent-only reviewed Artifact.
    artifact: !artifact
      name: agent-only candidate
      format: markdown
      review: [Advisor]
`));
  const controlPlane = parseControlPlaneConfig({
    runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
    actors: {
      "reviewer-agent": {
        kind: "agent",
        name: "Advisor",
        permissions: ["artifact.read", "decision.assess"],
        agent: { provider: "traex" }
      }
    }
  });
  const started = await startRun({
    name: "Test run",
    memoryRoot,
    runsRoot,
    procedureName: "agent-only-review-browser",
    controlPlane,
    reviewConfiguration: reviewConfiguration({
      procedure: "agent-only-review-browser",
      slots: { Advisor: ["reviewer-agent"] }
    })
  });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Agent-only candidate\n\nPublic review material remains visible.\n" }
  });
  const agentOnlyReview = currentArtifactReview(pending);
  assert(agentOnlyReview);
  assert.equal(agentOnlyReview.rounds[0]?.assignments.length, 1);
  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    view: { host: "127.0.0.1", port: 0 },
    debug: { agentReview: true, root: join(dir, "debug") },
    controlPlane
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const runsResponse = await fetch(`http://127.0.0.1:${address.port}/api/runs`);
  const runsSource = await runsResponse.text();
  assert.equal(runsResponse.status, 200, runsSource);
  const runsPayload = JSON.parse(runsSource) as { runs: Array<{ artifactReview?: unknown; artifactReviewSummaries?: unknown[] }> };
  assert.equal(runsPayload.runs[0]?.artifactReviewSummaries?.length, 1);
  assert(runsPayload.runs[0]?.artifactReview);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const reviewToggle = page.locator("#review-toggle");
    await page.waitForFunction(() =>
      document.getElementById("review-toggle")?.getAttribute("aria-controls") === "artifact-review-modal"
    );
    assert.equal(await reviewToggle.getAttribute("aria-controls"), "artifact-review-modal");
    await reviewToggle.click();
    const modal = page.locator("#artifact-review-modal");
    await modal.getByText("Public review material remains visible.", { exact: true }).waitFor();
    await modal.locator("#artifact-review-my-panel").getByText("无需评审", { exact: true }).waitFor();
    assert.equal(await modal.getByRole("combobox", { name: "评审身份" }).count(), 0);
    await modal.locator("#artifact-review-scope-panel").getByText("artifact_acceptance.unanimous", { exact: true }).waitFor();
    await modal.locator("#artifact-review-progress-panel").getByText("Advisor", { exact: true }).waitFor();
    await modal.locator("#artifact-review-record-panel").getByText("本轮汇总", { exact: true }).waitFor();
  } finally {
    await browser.close();
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

test("Agent Activity expands in the participant row without disrupting Human review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-agent-activity-browser-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  const home = join(dir, "home");
  const scopeRoot = join(home, "projects", "activity-fixture");
  const memoryRoot = join(scopeRoot, "memory");
  const runsRoot = join(scopeRoot, "runs");
  const reviewsRoot = join(scopeRoot, "reviews");
  const configPath = join(scopeRoot, "config.json");
  process.env.MEMSPHERE_HOME = home;
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: scopeRoot });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "activity-review.yaml"), withCurrentMemorySyntax(`!procedure
name: agent-activity-browser
flow:
  - !action
    action: Record requirement evidence.
    artifact: !artifact
      name: current requirement
      format: markdown
  - !action
    action: Record implementation evidence.
    artifact: !artifact
      name: implementation summary
      format: markdown
  - !action
    action: Record validation evidence.
    artifact: !artifact
      name: validation report
      format: markdown
  - !action
    action: Produce an Artifact with visible Agent activity.
    artifact: !artifact
      name: activity candidate
      format: markdown
      review: [Decider, Advisor]
`));
  const controlPlane = parseControlPlaneConfig({
    runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
    actors: {
      alice: {
        kind: "human",
        name: "Decider",
        permissions: ["artifact.read", "decision.decide"]
      },
      "reviewer-agent": {
        kind: "agent",
        name: "Advisor",
        permissions: ["artifact.read", "decision.assess"],
        agent: { provider: "traex" }
      }
    }
  });
  const reviewer = controlPlane.actors["reviewer-agent"];
  if (!reviewer || reviewer.kind !== "agent") throw new Error("missing reviewer fixture");
  reviewer.agent.command = process.execPath;
  reviewer.agent.args = [browserFakeReviewer, "approve"];
  await writeFile(join(scopeRoot, "project.json"), `${JSON.stringify({
    format_version: 1,
    name: "activity-fixture",
    created_at: new Date().toISOString()
  }, null, 2)}\n`);
  await writeFile(join(home, "registry.json"), `${JSON.stringify({
    format_version: 1,
    projects: { "activity-fixture": { root: scopeRoot } },
    workspaces: {}
  }, null, 2)}\n`);
  await writeFile(join(home, "config.json"), `${JSON.stringify({
    acp_providers: { traex: {} }
  }, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify({
    store: { type: "embedded", repository_path: scopeRoot, memory_path: "memory" },
    control_plane: {
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        alice: {
          kind: "human",
          name: "Decider",
          permissions: ["artifact.read", "decision.decide"]
        },
        "reviewer-agent": {
          kind: "agent",
          name: "Advisor",
          permissions: ["artifact.read", "decision.assess"],
          agent: { provider: "traex" }
        }
      }
    }
  }, null, 2)}\n`);
  const started = await startRun({
    name: "Test run",
    memoryRoot,
    runsRoot,
    procedureName: "agent-activity-browser",
    controlPlane,
    reviewConfiguration: reviewConfiguration({
      procedure: "agent-activity-browser",
      flowIndexes: [4],
      slots: { Decider: ["alice"], Advisor: ["reviewer-agent"] }
    })
  });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Current requirement\n\nKeep Activity visible.\n" } });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Implementation summary\n\nImplemented Activity projection.\n" } });
  await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Validation report\n\nFocused tests passed.\n" } });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Activity candidate\n\nReview this implementation.\n" }
  });
  const review = currentArtifactReview(pending);
  assert(review);
  const round = review.rounds[0];
  const agent = round.assignments.find((assignment) => assignment.actorId === "reviewer-agent");
  assert(agent);
  const provider: AgentReviewProvider = {
    id: "traex",
    buildLaunch({ actor, workspaceRoot, sessionEnv }) {
      return {
        provider: "fake-browser-provider",
        command: actor.agent.command,
        args: [...actor.agent.args],
        cwd: workspaceRoot,
        env: { ...process.env, ...sessionEnv },
        startupTimeoutMs: 10_000,
        idleTimeoutMs: 10_000,
        maxRuntimeMs: 20_000,
        promptVersion: "artifact-review-v1"
      };
    }
  };
  await runArtifactReviewAgentWorker({
    config: configPath,
    review: review.id,
    round: round.id,
    assignment: artifactReviewAssignmentId(agent),
    nodeExecutable: process.execPath,
    cliEntrypoint: browserFakeCli,
    providerResolver: () => provider
  });
  const completedAgentRun = await readRun(runsRoot, started.id);
  const completedAgent = currentArtifactReview(completedAgentRun)?.rounds[0].assignments.find(
    (assignment) => assignment.actorId === "reviewer-agent"
  );
  assert(completedAgent?.attempts?.[0]);

  const config: MemsphereConfig = {
    configPath,
    scopeRoot,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(scopeRoot, "archives"),
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: /^产物评审 1\/2$/ }).click();
    const modal = page.locator("#artifact-review-modal");
    let materialChooser = modal.getByRole("combobox", { name: "选择评审材料" });
    await materialChooser.click();
    await modal.getByRole("option", { name: "前序产物 · current requirement", exact: true }).click();
    await modal.getByText("Keep Activity visible.", { exact: true }).waitFor();
    assert.equal(await modal.locator("#artifact-review-artifact-pane .artifact-review-target").count(), 0);
    materialChooser = modal.getByRole("combobox", { name: "选择评审材料" });
    await materialChooser.click();
    await modal.getByRole("option", { name: "待评审产物 · activity candidate", exact: true }).click();
    await modal.getByText("Review this implementation.", { exact: true }).waitFor();
    assert((await modal.locator("#artifact-review-artifact-pane .artifact-review-target").count()) > 0);
    assert.equal(await modal.getByText("评审证据包", { exact: true }).count(), 0);
    const composer = modal.getByPlaceholder("补充整体评审意见");
    await composer.fill("Human draft remains visible");
    materialChooser = modal.getByRole("combobox", { name: "选择评审材料" });
    await materialChooser.click();
    await modal.getByRole("option", { name: "冻结契约 · Frozen Review Contract", exact: true }).click();
    await modal.getByText(/Produce an Artifact with visible Agent activity\./).waitFor();
    materialChooser = modal.getByRole("combobox", { name: "选择评审材料" });
    await materialChooser.click();
    await modal.getByRole("option", { name: "前序产物 · validation report", exact: true }).click();
    await modal.getByText("Focused tests passed.", { exact: true }).waitFor();
    assert.equal(await composer.inputValue(), "Human draft remains visible");
    materialChooser = modal.getByRole("combobox", { name: "选择评审材料" });
    await materialChooser.click();
    await modal.getByRole("option", { name: "待评审产物 · activity candidate", exact: true }).click();
    const agentRow = modal.locator(".artifact-review-row").filter({ hasText: "Advisor" }).first();
    const detailToggle = agentRow.getByRole("button", { name: "查看详情", exact: true });
    assert.equal(await detailToggle.locator("xpath=ancestor::*[contains(@class, 'artifact-review-row-main')]").count(), 1);
    assert.equal(await agentRow.locator(".comment-actions").getByRole("button", { name: "查看详情", exact: true }).count(), 0);
    await detailToggle.click();
    await agentRow.getByRole("button", { name: "收起详情", exact: true }).waitFor();
    await agentRow.getByText("Reviewing implementation evidence.", { exact: true }).waitFor();
    const activity = agentRow.locator(".artifact-review-activity");
    await activity.getByText("消息", { exact: true }).first().waitFor();
    await activity.getByText("工具调用", { exact: true }).waitFor();
    await activity.getByText("执行计划", { exact: true }).waitFor();
    await activity.getByText("运行状态", { exact: true }).first().waitFor();
    const completedTool = activity.locator('.artifact-review-activity-event[data-kind="tool"]');
    await completedTool.waitFor();
    assert.equal(await completedTool.getByText("已完成", { exact: true }).count(), 0);
    const toolKindBox = await completedTool.locator(".artifact-review-activity-kind").boundingBox();
    const toolTimeBox = await completedTool.locator("time").boundingBox();
    const toolTitleBox = await completedTool.locator(".artifact-review-activity-event-title").boundingBox();
    assert(toolKindBox && toolTimeBox && toolTitleBox);
    assert(toolTimeBox.x > toolKindBox.x);
    assert(Math.abs(
      (toolTimeBox.y + toolTimeBox.height / 2) - (toolKindBox.y + toolKindBox.height / 2)
    ) < 3);
    assert(toolTitleBox.y >= toolKindBox.y + toolKindBox.height);
    await agentRow.getByText(/^实现证据：(已引用|未引用)$/).waitFor();
    assert.equal(await composer.inputValue(), "Human draft remains visible");
    const attemptChooser = agentRow.getByRole("combobox", { name: "选择 Attempt" });
    assert.equal(await attemptChooser.evaluate((element) => element.tagName), "BUTTON");
    assert.equal(await attemptChooser.evaluate((element) => element.getBoundingClientRect().width <= 260), true);
    await attemptChooser.click();
    const currentAttempt = agentRow.getByRole("option", { name: /尝试 1 · submitted/ });
    await currentAttempt.waitFor();
    await currentAttempt.click();
    await composer.focus();
    const log = agentRow.locator(".artifact-review-activity-log");
    assert.equal(await log.evaluate((element) => element.scrollHeight > element.clientHeight), true);
    await log.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });

    const location = {
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: round.id,
      assignmentId: artifactReviewAssignmentId(agent),
      attemptId: completedAgent.attempts[0].id
    };
    const snapshot = await readAgentActivitySnapshot(location);
    const revision = snapshot.revision + 1;
    snapshot.revision = revision;
    snapshot.events.push({
      id: "message:browser-late-update",
      sequence: Math.max(...snapshot.events.map((event) => event.sequence)) + 1,
      updatedRevision: revision,
      kind: "message",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Agent message",
      body: "Late activity must not steal scroll position."
    });
    const activityPolled = page.waitForResponse((response) =>
      response.url().includes(`/attempts/${completedAgent.attempts?.[0]?.sequence}/activity`)
      && response.request().method() === "GET"
    );
    await writeFile(agentActivityPath(location), `${JSON.stringify(snapshot, null, 2)}\n`);
    const activityResponse = await activityPolled;
    assert.equal(activityResponse.status(), 200);
    const activityPayload = await activityResponse.json() as { events: Array<{ body?: string }> };
    assert.equal(activityPayload.events.some((event) => event.body === "Late activity must not steal scroll position."), true);
    await agentRow.getByText("Late activity must not steal scroll position.", { exact: true }).waitFor();
    assert.equal(await log.evaluate((element) => element.scrollTop < 4), true);
    assert.equal(await composer.inputValue(), "Human draft remains visible");
    await log.evaluate((element) => {
      element.dataset.stabilityMarker = "preserved";
    });
    const settledScrollTop = await log.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(4_500);
    assert.equal(await log.getAttribute("data-stability-marker"), "preserved");
    assert.equal(await log.evaluate((element) => element.scrollTop), settledScrollTop);

    await page.setViewportSize({ width: 720, height: 900 });
    await modal.locator("#artifact-review-review-tab").click();
    await agentRow.getByText("Late activity must not steal scroll position.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    const identity = modal.getByRole("combobox", { name: "评审身份" });
    await identity.click();
    assert.equal(await modal.getByRole("option", { name: /Activity Agent/ }).count(), 0);
  } finally {
    await browser.close();
    server.close();
    await once(server, "close");
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
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
  await dialog.waitFor({ state: "detached" });
}

async function selectIdentity(
  page: import("playwright").Page,
  _select: import("playwright").Locator,
  actorId: string
): Promise<void> {
  const select = page.locator("#artifact-review-modal").getByRole("combobox", { name: "评审身份" });
  let option = page.locator(`.artifact-review-actor-select .artifact-review-select-menu:not([hidden]) .artifact-review-select-option[data-actor-id="${actorId}"]`);
  if (!await option.isVisible().catch(() => false)) {
    await select.waitFor({ state: "visible" });
    await select.evaluate((element) => {
      if (element instanceof HTMLElement) element.focus();
    });
    await select.click();
    option = page.locator(`.artifact-review-actor-select .artifact-review-select-menu:not([hidden]) .artifact-review-select-option[data-actor-id="${actorId}"]`);
    await option.waitFor({ state: "visible" });
  }
  if (await option.getAttribute("aria-selected") === "true") {
    await select.click();
    await page.waitForTimeout(20);
    return;
  }
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/artifact-reviews/")
      && response.url().includes(`actor_id=${actorId}`)
      && response.request().method() === "GET",
    { timeout: 5_000 }
  ).catch(() => null);
  await option.click();
  const expectedLabel = actorId === "alice" ? "Decider" : actorId === "bob" ? "Advisor" : actorId;
  await page.waitForFunction((label) => {
    const trigger = document.querySelector(".artifact-review-actor-select .artifact-review-select-trigger");
    return Boolean(trigger?.textContent?.includes(label));
  }, expectedLabel);
  await loaded;
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

async function waitForDraftSaveAfterExternalUpdate(page: import("playwright").Page): Promise<void> {
  // Task polling can observe the external update before the click. In that case
  // the first PATCH succeeds directly; otherwise conflict recovery retries it.
  // Both valid paths finish with a successful PATCH and the same server state.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/draft")
      && response.request().method() === "PATCH"
      && response.status() === 200,
    { timeout: 10_000 }
  );
  await saved;
  await page.waitForFunction(() => {
    const controls = document.querySelectorAll<HTMLButtonElement>(
      "#artifact-review-modal .artifact-review-vote button"
    );
    return controls.length > 0 && Array.from(controls).every((control) => !control.disabled);
  });
}

async function clickAndWaitForForcedDraftRecovery(
  page: import("playwright").Page,
  button: import("playwright").Locator
): Promise<void> {
  let forcedConflict = false;
  const forceFirstPatchConflict = async (route: import("playwright").Route): Promise<void> => {
    if (!forcedConflict && route.request().method() === "PATCH") {
      forcedConflict = true;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced Artifact Review draft conflict" })
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/draft", forceFirstPatchConflict);
  try {
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith("/draft")
        && response.request().method() === "PATCH"
        && response.status() === 409,
      { timeout: 10_000 }
    );
    const recovered = page.waitForResponse(
      (response) =>
        response.url().endsWith("/draft")
        && response.request().method() === "PATCH"
        && response.status() === 200,
      { timeout: 10_000 }
    );
    await button.click();
    await conflict;
    await recovered;
    assert.equal(forcedConflict, true);
    await page.waitForFunction(() => {
      const controls = document.querySelectorAll<HTMLButtonElement>(
        "#artifact-review-modal .artifact-review-vote button"
      );
      return controls.length > 0 && Array.from(controls).every((control) => !control.disabled);
    });
  } finally {
    await page.unroute("**/draft", forceFirstPatchConflict);
  }
}

async function expectInlineValue(locator: import("playwright").Locator, expected: string): Promise<void> {
  await locator.page().waitForFunction(
    ({ selector, value }) => {
      const textarea = document.querySelector(selector);
      return textarea instanceof HTMLTextAreaElement && textarea.value === value;
    },
    { selector: ".inline-comment-editor textarea", value: expected }
  );
  assert.equal(await locator.inputValue(), expected);
}

async function staleRoundWithBobDraft(
  port: number,
  reviewId: string,
  roundId: string,
  body: string
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}/api/artifact-reviews/${encodeURIComponent(reviewId)}/rounds/${encodeURIComponent(roundId)}`;
  const contextResponse = await fetch(`${baseUrl}?actor_id=bob`);
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json() as {
    review: { round: { revision: number } };
    assignment: { draft: { vote?: string; comments?: Array<{ id: string; body: string; anchor?: unknown }> } };
  };
  const draftResponse = await fetch(`${baseUrl}/assignments/bob/draft`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: context.review.round.revision,
      vote: context.assignment.draft.vote || "abstain",
      comments: [
        ...(context.assignment.draft.comments || []),
        { id: `bob-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`, body, severity: "risk" }
      ]
    })
  });
  assert.equal(draftResponse.status, 200);
}
