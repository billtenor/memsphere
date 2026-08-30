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
  submitArtifactReviewAssignment,
  updateArtifactReviewDraft,
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

test("Human Artifact Review keeps each participant's draft private", async () => {
  const fixture = await createTwoActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=${fixture.review.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const reviewModal = page.locator("#artifact-review-modal[open]");
      await reviewModal.waitFor();
      assert.equal(await page.locator("#memsphere-view-root > .run-loading").count(), 0);
      const modalColors = await reviewModal.evaluate(element => ({
        background: getComputedStyle(element).backgroundColor,
        backdrop: getComputedStyle(element, "::backdrop").backgroundColor,
        reviewPane: getComputedStyle(element.querySelector("#artifact-review-review-pane")!).backgroundColor,
      }));
      assert.notEqual(modalColors.background, "rgba(0, 0, 0, 0)");
      assert.notEqual(modalColors.backdrop, "rgba(0, 0, 0, 0)");
      assert.notEqual(modalColors.reviewPane, "rgba(0, 0, 0, 0)");
      for (const heading of ["评审材料", "评审范围", "我的评审", "参与进度", "评审记录"]) {
        await reviewModal.getByRole("heading", { name: heading, exact: true }).waitFor();
      }
      assert((await reviewModal.locator(".artifact-review-material-meta .run-pill").count()) >= 4);
      assert((await reviewModal.locator(".artifact-review-participant").count()) >= 2);
      const identity = page.getByRole("combobox", { name: "评审身份" });
      await selectIdentity(page, identity, "alice");
      const composer = reviewModal.getByPlaceholder("补充整体评审意见");
      await composer.fill("Alice private draft");
      await clickAndWaitForDraftSave(
        page,
        reviewModal.getByRole("button", { name: "添加意见", exact: true })
      );
      await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();

      await selectIdentity(page, identity, "bob");
      assert.equal(await reviewModal.getByText("Alice private draft", { exact: true }).count(), 0);
      await selectIdentity(page, identity, "alice");
      await reviewModal.getByText("Alice private draft", { exact: true }).waitFor();
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Human Artifact Review completes once after a revised second round", async () => {
  const fixture = await createTwoActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=${fixture.review.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      let reviewModal = page.locator("#artifact-review-modal[open]");
      await reviewModal.waitFor();
      let identity = page.getByRole("combobox", { name: "评审身份" });

      await selectIdentity(page, identity, "alice");
      await reviewModal.getByPlaceholder("补充整体评审意见").fill("Please revise the candidate.");
      await clickAndWaitForDraftSave(
        page,
        reviewModal.getByRole("button", { name: "添加意见", exact: true })
      );
      await clickAndWaitForDraftSave(page, reviewModal.getByRole("radio", { name: "要求修改", exact: true }));
      await submitThroughConfirmation(page);

      await selectIdentity(page, identity, "bob");
      await clickAndWaitForDraftSave(page, reviewModal.getByRole("radio", { name: "通过", exact: true }));
      await submitThroughConfirmation(page);
      const rejected = await readRun(fixture.runsRoot, fixture.runId);
      assert.equal(currentArtifactReview(rejected)?.status, "awaiting_revision");

      const revised = await reportRun({
        runsRoot: fixture.runsRoot,
        runId: fixture.runId,
        artifact: { kind: "inline", value: "# Revised candidate\n\nThe requested change is complete.\n" },
        revisionSummary: "Addressed the requested change."
      });
      const secondReview = currentArtifactReview(revised);
      assert(secondReview);
      assert.equal(secondReview.rounds.length, 2);

      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${secondReview.id}?round=${secondReview.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      reviewModal = page.locator("#artifact-review-modal[open]");
      await reviewModal.waitFor();
      identity = page.getByRole("combobox", { name: "评审身份" });
      await selectIdentity(page, identity, "alice");
      await clickAndWaitForDraftSave(page, reviewModal.getByRole("radio", { name: "通过", exact: true }));
      await submitThroughConfirmation(page);
      await selectIdentity(page, identity, "bob");
      await clickAndWaitForDraftSave(page, reviewModal.getByRole("radio", { name: "通过", exact: true }));
      await submitThroughConfirmation(page);

      await submitArtifactReviewRunnerVote({
        runsRoot: fixture.runsRoot,
        reviewId: secondReview.id,
        roundId: secondReview.currentRoundId,
        vote: "approve"
      });
      await page.getByText("已完成", { exact: true }).first().waitFor({ timeout: 6_000 });
      const completed = await readRun(fixture.runsRoot, fixture.runId);
      assert.equal(completed.status, "done");
      assert.equal(completed.events.length, 1);
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("failed Artifact Review draft saves retain input and retry exactly once", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=${fixture.review.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const modal = page.locator("#artifact-review-modal[open]");
      await modal.waitFor();
      await selectIdentity(page, page.getByRole("combobox", { name: "评审身份" }), "alice");

      await modal.locator(".inline-plus").first().click();
      let inlineEditor = modal.locator(".inline-comment-editor").first();
      let inlineInput = inlineEditor.getByPlaceholder("这里应该如何修改？");
      let inlineSave = inlineEditor.getByRole("button", { name: "添加意见", exact: true });
      await inlineInput.fill("Inline text survives a failed save");
      await failNextDraftSave(page, "inline draft outage", () => inlineSave.click());
      inlineEditor = modal.locator(".inline-comment-editor").first();
      inlineInput = inlineEditor.getByPlaceholder("这里应该如何修改？");
      inlineSave = inlineEditor.getByRole("button", { name: "添加意见", exact: true });
      assert.equal(await inlineInput.inputValue(), "Inline text survives a failed save");
      assert.equal(await inlineSave.isEnabled(), true);
      await clickAndWaitForDraftSave(page, inlineSave);

      const composer = modal.getByPlaceholder("补充整体评审意见");
      const composerSave = modal.locator("#artifact-review-my-content")
        .getByRole("button", { name: "添加意见", exact: true });
      await composer.fill("Overall text survives a failed save");
      await failNextDraftSave(page, "composer draft outage", () => composerSave.click());
      assert.equal(await composer.inputValue(), "Overall text survives a failed save");
      assert.equal(await composerSave.isEnabled(), true);
      await clickAndWaitForDraftSave(page, composerSave);

      const persisted = currentArtifactReview(await readRun(fixture.runsRoot, fixture.runId));
      const comments = persisted?.rounds[0]?.assignments.find(
        (assignment) => assignment.actorId === "alice"
      )?.draft.comments ?? [];
      assert.equal(comments.filter((comment) => comment.body === "Inline text survives a failed save").length, 1);
      assert.equal(comments.filter((comment) => comment.body === "Overall text survives a failed save").length, 1);
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review persists and restores the panel split", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      const reviewUrl = `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=${fixture.review.currentRoundId}`;
      await page.goto(reviewUrl, { waitUntil: "domcontentloaded" });
      const resizer = page.getByRole("separator", { name: "调整产物与评审区域宽度" });
      await resizer.waitFor();
      const initial = Number(await resizer.getAttribute("aria-valuenow"));
      await resizer.press("ArrowRight");
      await page.waitForFunction((previous) => {
        const element = document.querySelector('[role="separator"][aria-label="调整产物与评审区域宽度"]');
        return Number(element?.getAttribute("aria-valuenow")) > previous
          && Number(localStorage.getItem("memsphere.artifactReviewSplit.v1")) > previous;
      }, initial);
      const persisted = Number(await resizer.getAttribute("aria-valuenow"));

      await page.reload({ waitUntil: "domcontentloaded" });
      const restored = page.getByRole("separator", { name: "调整产物与评审区域宽度" });
      await restored.waitFor();
      assert.equal(Number(await restored.getAttribute("aria-valuenow")), persisted);
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review makes historical rounds read-only", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    const revised = await createRevisedSingleActorReview(fixture);
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${revised.id}?round=${revised.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const modal = page.locator("#artifact-review-modal[open]");
      await modal.waitFor();
      await selectIdentity(page, page.getByRole("combobox", { name: "评审身份" }), "alice");
      const roundSelector = page.getByRole("button", { name: "轮次", exact: true });
      await roundSelector.click();
      const roundMenu = page.getByRole("listbox", { name: "轮次" });
      await roundMenu.locator(`[data-round-id="${fixture.review.currentRoundId}"]`).click();

      await modal.getByText("历史轮次仅供查看，不能投票、添加意见或重新提交。", { exact: true }).waitFor();
      assert.equal(await modal.getByRole("radio").count(), 0);
      assert.equal(await modal.getByRole("button", { name: "添加意见", exact: true }).count(), 0);
      assert.equal(await modal.getByRole("button", { name: "提交评审", exact: true }).isVisible(), false);
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review keeps a selected historical round across polling", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    const revised = await createRevisedSingleActorReview(fixture);
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${revised.id}?round=${revised.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const modal = page.locator("#artifact-review-modal[open]");
      await modal.waitFor();
      await selectIdentity(page, page.getByRole("combobox", { name: "评审身份" }), "alice");
      const roundSelector = page.getByRole("button", { name: "轮次", exact: true });
      await roundSelector.click();
      let roundMenu = page.getByRole("listbox", { name: "轮次" });
      await roundMenu.locator(`[data-round-id="${fixture.review.currentRoundId}"]`).click();
      await modal.getByText("历史轮次 · 只读", { exact: true }).waitFor();

      await roundSelector.click();
      roundMenu = page.getByRole("listbox", { name: "轮次" });
      await roundMenu.waitFor();
      await page.waitForResponse((response) =>
        response.request().method() === "GET"
        && response.url().includes(`/artifact-reviews/${revised.id}/rounds/${fixture.review.currentRoundId}`)
      );
      assert.equal(await roundMenu.isVisible(), true);
      assert.equal(
        await roundMenu.locator(`[data-round-id="${fixture.review.currentRoundId}"]`).getAttribute("aria-selected"),
        "true"
      );
      await modal.getByText("历史轮次 · 只读", { exact: true }).waitFor();
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review locates an anchored historical comment in its artifact", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    const revised = await createRevisedSingleActorReview(fixture, "Locate this historical comment");
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${revised.id}?round=${revised.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const modal = page.locator("#artifact-review-modal[open]");
      await modal.waitFor();
      await selectIdentity(page, page.getByRole("combobox", { name: "评审身份" }), "alice");
      const roundSelector = page.getByRole("button", { name: "轮次", exact: true });
      await roundSelector.click();
      await page.getByRole("listbox", { name: "轮次" })
        .locator(`[data-round-id="${fixture.review.currentRoundId}"]`).click();
      const comment = modal.locator(".comment-card").filter({ hasText: "Locate this historical comment" });
      await comment.getByRole("button", { name: "定位", exact: true }).click();
      const located = modal.locator('[data-anchor="markdown:h1:0"].artifact-review-target-located');
      await located.waitFor();
      assert.match(await located.innerText(), /Focused candidate/);
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review normalizes invalid Round and Material URLs and syncs material selection", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=round-missing&material=material-missing`,
        { waitUntil: "domcontentloaded" }
      );
      const modal = page.locator("#artifact-review-modal[open]");
      await modal.waitFor();
      await page.waitForFunction((roundId) => {
        const params = new URLSearchParams(location.search);
        return params.get("round") === roundId && !params.has("material");
      }, fixture.review.currentRoundId);

      const material = modal.getByRole("combobox", { name: "选择评审材料", exact: true });
      await material.click();
      await modal.getByRole("option", { name: /^冻结契约/ }).click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get("material") === "contract");
      await material.click();
      await modal.getByRole("option", { name: /^待评审产物/ }).click();
      await page.waitForFunction(() => !new URLSearchParams(location.search).has("material"));
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("completed Artifact Review isolates dialog scrolling without mutating Host page state", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    await approveSingleActorReview(fixture.runsRoot, fixture.runId, fixture.review.id, fixture.review.currentRoundId);
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(`${origin}/tasks/${fixture.runId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("已完成", { exact: true }).first().waitFor();
      await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".content");
        const button = document.querySelector<HTMLElement>(".task-result [data-artifact-review-id]");
        if (content) content.style.paddingTop = "1400px";
        button?.scrollIntoView({ block: "center" });
      });
      const reviewButton = page.locator(".task-result").getByRole("button", { name: "产物评审", exact: true });
      const beforeOpen = await reviewButton.evaluate((button) => ({
        scrollY: window.scrollY,
        top: button.getBoundingClientRect().top
      }));
      assert(beforeOpen.scrollY > 0);

      await reviewButton.click();
      const reviewModal = page.locator("#artifact-review-modal");
      await reviewModal.waitFor();
      const artifactPane = reviewModal.locator("#artifact-review-artifact-pane");
      await artifactPane.evaluate((pane) => {
        if (pane.firstElementChild instanceof HTMLElement) pane.firstElementChild.style.minHeight = "1800px";
      });
      await artifactPane.hover();
      await page.mouse.wheel(0, 1200);
      await waitForAnimationFrames(page, 2);
      assert((await artifactPane.evaluate((pane) => pane.scrollTop)) > 0);

      await reviewModal.getByRole("button", { name: "关闭", exact: true }).click();
      await reviewModal.waitFor({ state: "hidden" });
      await reviewButton.waitFor({ state: "visible" });
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Artifact Review uses desktop panes and mobile tabs without horizontal overflow", async () => {
  const fixture = await createSingleActorReviewFixture();
  try {
    await withReviewBrowser(fixture.config, { width: 1440, height: 900 }, async (page, origin) => {
      await page.goto(
        `${origin}/tasks/${fixture.runId}/artifact-reviews/${fixture.review.id}?round=${fixture.review.currentRoundId}`,
        { waitUntil: "domcontentloaded" }
      );
      const reviewModal = page.locator("#artifact-review-modal[open]");
      await reviewModal.waitFor();
      assert.equal(await page.locator("#artifact-review-artifact-pane").isVisible(), true);
      assert.equal(await page.locator("#artifact-review-review-pane").isVisible(), true);

      await page.setViewportSize({ width: 390, height: 844 });
      const artifactPane = page.locator("#artifact-review-artifact-pane");
      const reviewPane = page.locator("#artifact-review-review-pane");
      await page.locator("#artifact-review-review-tab").click();
      assert.equal(await artifactPane.isVisible(), false);
      assert.equal(await reviewPane.isVisible(), true);
      await page.locator("#artifact-review-artifact-tab").click();
      assert.equal(await artifactPane.isVisible(), true);
      assert.equal(await reviewPane.isVisible(), false);
      const overflow = await reviewModal.evaluate((modal) => ({
        clientWidth: modal.clientWidth,
        scrollWidth: modal.scrollWidth
      }));
      assert(overflow.scrollWidth <= overflow.clientWidth, JSON.stringify(overflow));
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
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
    await page.getByRole("button", { name: "运行", exact: true }).click();
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
    await page.getByRole("button", { name: "运行", exact: true }).click();
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
    const attemptChooser = agentRow.getByRole("combobox", { name: "选择尝试" });
    assert.equal(await attemptChooser.evaluate((element) => element.tagName), "BUTTON");
    assert.equal(await attemptChooser.evaluate((element) => element.getBoundingClientRect().width <= 260), true);
    await attemptChooser.click();
    const currentAttempt = agentRow.getByRole("option", { name: /尝试 1 · 已提交/ });
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
    await page.waitForResponse((response) =>
      response.url().includes(`/attempts/${completedAgent.attempts?.[0]?.sequence}/activity`)
      && response.request().method() === "GET"
    );
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

type BrowserReviewFixture = {
  dir: string;
  runsRoot: string;
  runId: string;
  review: NonNullable<ReturnType<typeof currentArtifactReview>>;
  config: MemsphereConfig;
};

async function createTwoActorReviewFixture(): Promise<BrowserReviewFixture> {
  return createReviewFixture({
    procedureName: "two-actor-review-browser",
    reviewSlots: "[Decider, Advisor]",
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
    },
    slots: { Decider: ["alice"], Advisor: ["bob"] }
  });
}

async function createSingleActorReviewFixture(): Promise<BrowserReviewFixture> {
  return createReviewFixture({
    procedureName: "focused-review-browser",
    reviewSlots: "[Decider]",
    actors: {
      alice: {
        kind: "human",
        name: "Decider",
        permissions: ["artifact.read", "decision.decide"]
      }
    },
    slots: { Decider: ["alice"] }
  });
}

async function createReviewFixture(input: {
  procedureName: string;
  reviewSlots: string;
  actors: Record<string, {
    kind: "human";
    name: string;
    permissions: Array<"artifact.read" | "decision.decide" | "decision.assess">;
  }>;
  slots: Record<string, string[]>;
}): Promise<BrowserReviewFixture> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-focused-review-browser-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "focused-review.yaml"), withCurrentMemorySyntax(`!procedure
name: ${input.procedureName}
flow:
  - !action
    action: Produce one reviewed Artifact.
    artifact: !artifact
      name: focused candidate
      format: markdown
      review: ${input.reviewSlots}
`));
  const controlPlane = parseControlPlaneConfig({
    runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
    actors: input.actors
  });
  const started = await startRun({
    name: "Focused review",
    memoryRoot,
    runsRoot,
    procedureName: input.procedureName,
    controlPlane,
    reviewConfiguration: reviewConfiguration({
      procedure: input.procedureName,
      slots: input.slots
    })
  });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Focused candidate\n\nReview body.\n" }
  });
  const review = currentArtifactReview(pending);
  assert(review);
  return {
    dir,
    runsRoot,
    runId: started.id,
    review,
    config: {
      configPath: join(dir, "config.json"),
      scopeRoot: dir,
      memoryRoot,
      reviewsRoot,
      runsRoot,
      archiveRoot: join(dir, "archives"),
      view: { host: "127.0.0.1", port: 0 },
      controlPlane
    }
  };
}

async function approveSingleActorReview(
  runsRoot: string,
  runId: string,
  reviewId: string,
  roundId: string
): Promise<void> {
  const run = await readRun(runsRoot, runId);
  const revision = currentArtifactReview(run)?.rounds.find((round) => round.id === roundId)?.revision;
  assert.equal(typeof revision, "number");
  const drafted = await updateArtifactReviewDraft({
    runsRoot,
    reviewId,
    roundId,
    actorId: "alice",
    expectedRevision: revision,
    draft: { vote: "approve", comments: [] }
  });
  await submitArtifactReviewAssignment({
    runsRoot,
    reviewId,
    roundId,
    actorId: "alice",
    expectedRevision: drafted.round.revision
  });
  await submitArtifactReviewRunnerVote({ runsRoot, reviewId, roundId, vote: "approve" });
}

async function createRevisedSingleActorReview(
  fixture: BrowserReviewFixture,
  anchoredComment?: string
): Promise<BrowserReviewFixture["review"]> {
  const round = fixture.review.rounds[0];
  const submission = fixture.review.submissions.find((candidate) => candidate.id === round.submissionId);
  assert(submission);
  const now = new Date().toISOString();
  const drafted = await updateArtifactReviewDraft({
    runsRoot: fixture.runsRoot,
    reviewId: fixture.review.id,
    roundId: round.id,
    actorId: "alice",
    expectedRevision: round.revision,
    draft: {
      vote: "request_changes",
      comments: [{
        id: "historical-anchored-comment",
        body: anchoredComment ?? "Request a focused revision",
        severity: "risk",
        ...(anchoredComment ? { anchor: {
          submissionId: submission.id,
          target: "markdown:h1:0",
          location: "markdown:h1:0",
          sourceHash: submission.digest,
          context: "Focused candidate"
        } } : {}),
        createdAt: now,
        updatedAt: now
      }]
    }
  });
  await submitArtifactReviewAssignment({
    runsRoot: fixture.runsRoot,
    reviewId: fixture.review.id,
    roundId: round.id,
    actorId: "alice",
    expectedRevision: drafted.round.revision
  });
  const rejected = currentArtifactReview(await readRun(fixture.runsRoot, fixture.runId));
  assert.equal(rejected?.status, "awaiting_revision");
  const revisedRun = await reportRun({
    runsRoot: fixture.runsRoot,
    runId: fixture.runId,
    artifact: { kind: "inline", value: "# Revised focused candidate\n\nReview body revised.\n" },
    revisionSummary: "Addressed the focused review."
  });
  const revised = currentArtifactReview(revisedRun);
  assert(revised);
  return revised;
}

async function withReviewBrowser(
  config: MemsphereConfig,
  viewport: { width: number; height: number },
  action: (page: import("playwright").Page, origin: string) => Promise<void>
): Promise<void> {
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(10_000);
    await action(page, `http://127.0.0.1:${address.port}`);
  } finally {
    await browser.close();
    server.close();
    await once(server, "close");
  }
}

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

async function failNextDraftSave(
  page: import("playwright").Page,
  message: string,
  action: () => Promise<unknown>
): Promise<void> {
  let failed = false;
  await page.route("**/draft", async (route) => {
    if (!failed && route.request().method() === "PATCH") {
      failed = true;
      await route.fulfill({ status: 503, body: message });
      return;
    }
    await route.continue();
  });
  try {
    await action();
    await page.getByText(message, { exact: true }).waitFor();
    assert.equal(failed, true);
  } finally {
    await page.unroute("**/draft");
  }
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
    return;
  }
  await option.click();
  const expectedLabel = actorId === "alice" ? "Decider" : actorId === "bob" ? "Advisor" : actorId;
  await page.waitForFunction((label) => {
    const trigger = document.querySelector(".artifact-review-actor-select .artifact-review-select-trigger");
    return Boolean(trigger?.textContent?.includes(label));
  }, expectedLabel);
}

async function waitForAnimationFrames(page: import("playwright").Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
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
