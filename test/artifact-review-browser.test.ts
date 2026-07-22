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
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const memoryArtifact = page.locator(".artifact-row").first();
    await memoryArtifact.getByText("评审", { exact: true }).waitFor();
    assert.equal(await memoryArtifact.getByText("Decider", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("Advisor", { exact: true }).count(), 1);
    assert.equal(await memoryArtifact.getByText("decider", { exact: true }).count(), 0);
    assert.equal(await memoryArtifact.getByText("advisor", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Task", exact: true }).click();
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
    await page.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    assert.equal(await page.getByText("decider", { exact: true }).count(), 0);

    await page.locator(".inline-plus").first().click();
    let inlineEditor = page.locator(".inline-comment-editor").first();
    let inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    let inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await inlineTextarea.fill("Inline text before add survives refresh");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    inlineEditor = page.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await expectInlineValue(inlineTextarea, "Inline text before add survives refresh");
    await selectIdentity(page, identity, "bob");
    assert.equal(await page.getByText("Inline text before add survives refresh", { exact: true }).count(), 0);
    assert.equal(await page.locator(".inline-comment-editor").count(), 0);
    await selectIdentity(page, identity, "alice");
    inlineEditor = page.locator(".inline-comment-editor").first();
    inlineTextarea = inlineEditor.getByPlaceholder("What should change here?");
    inlineSave = inlineEditor.getByRole("button", { name: "Add comment", exact: true });
    await expectInlineValue(inlineTextarea, "Inline text before add survives refresh");
    await inlineEditor.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.locator(".inline-plus").first().click();
    inlineEditor = page.locator(".inline-comment-editor").first();
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

    await page.locator(".inline-plus").first().click();
    inlineEditor = page.locator(".inline-comment-editor").first();
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
    let aliceAssignment = currentArtifactReview(afterFailedInlineRetry)?.rounds[0]?.assignments.find((assignment) => assignment.identityId === "alice");
    assert.equal(
      aliceAssignment?.draft.comments.filter((comment) => comment.body === "Inline text survives a failed save").length,
      1
    );

    const composer = page.getByPlaceholder("补充整体评审意见");
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
    await page.getByRole("button", { name: "添加意见", exact: true }).click();
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
    await page.getByRole("button", { name: "添加意见", exact: true }).click();
    await page.getByText("temporary draft outage", { exact: true }).waitFor();
    assert.equal(await composer.inputValue(), "Alice text survives a failed save");
    assert.equal(await composer.isEnabled(), true);
    await page.unroute("**/draft");
    await clickAndWaitForDraftSave(page, page.getByRole("button", { name: "添加意见", exact: true }));
    assert.equal(await composer.isEnabled(), true);
    let afterFailedComposerRetry = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterFailedComposerRetry)?.rounds[0]?.assignments.find((assignment) => assignment.identityId === "alice");
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
    const aliceAddRecovery = waitForDraftRecovery(page);
    await page.getByRole("button", { name: "添加意见", exact: true }).click();
    await aliceAddRecovery;
    await page.getByText("Alice private draft", { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder("补充整体评审意见").isEnabled(), true);
    assert.deepEqual(dialogs, []);
    let afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.identityId === "alice");
    assert.equal(aliceAssignment?.draft.comments.some((comment) => comment.body === "Alice private draft"), true);

    await staleRoundWithBobDraft(address.port, firstReview.id, firstReview.currentRoundId, "Bob stale update before Alice vote");
    const aliceVoteRecovery = waitForDraftRecovery(page);
    await page.getByRole("radio", { name: "修改", exact: true }).click();
    await aliceVoteRecovery;
    assert.equal(await page.getByRole("radio", { name: "修改", exact: true }).getAttribute("aria-checked"), "true");
    afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.identityId === "alice");
    assert.equal(aliceAssignment?.draft.vote, "request_changes");

    await staleRoundWithBobDraft(address.port, firstReview.id, firstReview.currentRoundId, "Bob stale update before Alice delete");
    const aliceDeleteRecovery = waitForDraftRecovery(page);
    await page.locator(".comment-card").filter({ hasText: "Alice private draft" }).getByRole("button", { name: "删除", exact: true }).click();
    await aliceDeleteRecovery;
    assert.equal(await page.getByText("Alice private draft", { exact: true }).count(), 0);
    afterAliceAdd = await readRun(runsRoot, started.id);
    aliceAssignment = currentArtifactReview(afterAliceAdd)?.rounds[0]?.assignments.find((assignment) => assignment.identityId === "alice");
    assert.equal(aliceAssignment?.draft.comments.some((comment) => comment.body === "Alice private draft"), false);

    await page.getByPlaceholder("补充整体评审意见").fill("Alice private draft");
    await page.getByRole("button", { name: "添加意见", exact: true }).click();
    await page.getByText("Alice private draft", { exact: true }).waitFor();

    await selectIdentity(page, identity, "bob");
    assert.equal(await page.getByText("Alice private draft", { exact: true }).count(), 0);
    await selectIdentity(page, identity, "alice");
    await page.getByText("Alice private draft", { exact: true }).waitFor();
    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "修改", exact: true }));
    await submitThroughConfirmation(page);

    await selectIdentity(page, identity, "bob");
    await clickAndWaitForDraftSave(page, page.getByRole("radio", { name: "修改", exact: true }));
    await page.getByPlaceholder("补充整体评审意见").fill("Keep the accepted result concise.");
    await page.getByRole("button", { name: "添加意见", exact: true }).click();
    await page.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
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
    identity = page.getByRole("combobox", { name: "评审身份" });
    await identity.waitFor();
    const reviewPanel = page.locator("#review-panel");
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
    assert.equal(await page.evaluate(() => Number(localStorage.getItem("memsphere.reviewPanelWidth.v1")) > 380), true);
    await reviewResizer.press("ArrowRight");
    await page.waitForTimeout(220);
    const panelAfterKeyboard = await reviewPanel.boundingBox();
    assert(panelAfterKeyboard);
    assert(panelAfterKeyboard.width < panelAfterResize.width);
    await selectIdentity(page, identity, "alice");
    await page.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alice private draft", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Keep the accepted result concise.", { exact: true }).count(), 0);

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
    await page.getByText("Alice private draft", { exact: true }).waitFor();
    await page.getByText("Keep the accepted result concise.", { exact: true }).waitFor();
    await roundSelector.click();
    await roundMenu.locator(`[data-round-id="${secondReview.currentRoundId}"]`).click();
    assert.equal(await page.getByText("Alice private draft", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Keep the accepted result concise.", { exact: true }).count(), 0);

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

    await page.getByText("The first-round comments were addressed.", { exact: true }).waitFor();
    await page.getByText("done", { exact: true }).first().waitFor();
    const completed = await readRun(runsRoot, started.id);
    assert.equal(completed.status, "done");
    assert.equal(completed.events.length, 1);
  } finally {
    await browser.close();
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

async function submitThroughConfirmation(page: import("playwright").Page): Promise<void> {
  await page.getByRole("button", { name: "提交评审", exact: true }).click();
  const dialog = page.getByRole("dialog");
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
  select: import("playwright").Locator,
  identityId: string
): Promise<void> {
  let option = page.locator(`.artifact-review-identity-select .artifact-review-select-menu:not([hidden]) .artifact-review-select-option[data-identity-id="${identityId}"]`);
  if (!await option.isVisible().catch(() => false)) {
    await select.waitFor({ state: "visible" });
    await select.evaluate((element) => {
      if (element instanceof HTMLElement) element.focus();
    });
    await select.click();
    option = page.locator(`.artifact-review-identity-select .artifact-review-select-menu:not([hidden]) .artifact-review-select-option[data-identity-id="${identityId}"]`);
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
      && response.url().includes(`identity_id=${identityId}`)
      && response.request().method() === "GET",
    { timeout: 5_000 }
  ).catch(() => null);
  await option.click();
  const expectedLabel = identityId === "alice" ? "Decider" : identityId === "bob" ? "Advisor" : identityId;
  await page.waitForFunction((label) => {
    const trigger = document.querySelector(".artifact-review-identity-select .artifact-review-select-trigger");
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

async function waitForDraftRecovery(page: import("playwright").Page): Promise<void> {
  const conflict = page.waitForResponse((response) =>
    response.url().endsWith("/draft")
    && response.request().method() === "PATCH"
    && response.status() === 409
  );
  const recovered = page.waitForResponse((response) =>
    response.url().endsWith("/draft")
    && response.request().method() === "PATCH"
    && response.status() === 200
  );
  await conflict;
  await recovered;
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
  const contextResponse = await fetch(`${baseUrl}?identity_id=bob`);
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
        { id: `bob-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`, body }
      ]
    })
  });
  assert.equal(draftResponse.status, 200);
}
