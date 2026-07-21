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
  advisor: bob
flow:
  - !action
    action: 产出需要人工评审的结果。
    artifact: !artifact
      name: 人工评审结果
      format: markdown
      review: artifact_acceptance.unanimous
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
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole("button", { name: "Task", exact: true }).click();
    let identity = page.getByRole("combobox", { name: "评审身份" });
    await identity.waitFor();
    assert.equal(await page.getByRole("button", { name: "Create Review", exact: true }).isVisible(), false);

    await selectIdentity(page, identity, "alice");
    await page.getByText("Visible only after identity authorization.", { exact: true }).waitFor();
    assert.equal(await page.getByText("decider", { exact: true }).count(), 0);
    const composer = page.getByPlaceholder("补充整体评审意见");
    await composer.fill("Alice private draft");
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
}

async function selectIdentity(
  page: import("playwright").Page,
  select: import("playwright").Locator,
  identityId: string
): Promise<void> {
  const loaded = page.waitForResponse((response) =>
    response.url().includes("/api/artifact-reviews/")
    && response.url().includes(`identity_id=${identityId}`)
    && response.request().method() === "GET"
  );
  await select.selectOption(identityId);
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
