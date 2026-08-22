import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { projectCreateCommand } from "../src/commands/project.js";
import { createViewServer } from "../src/commands/view.js";
import { runGit } from "../src/git.js";
import { validateCommand } from "../src/commands/validate.js";
import { readViewConfig } from "../src/config.js";
import {
  MemoryChangePreviewCache,
  validateMemoryChange,
  withMemoryChangePreview,
  withMemoryChangeReviewSnapshot
} from "../src/memory/changeset.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";

test("Embedded validation checkpoints linked-worktree changes without changing the main worktree", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-change-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const linkedTwin = join(fixture, "linked-twin");
  const mainMemory = join(main, ".memsphere", "memory");
  const linkedMemory = join(linked, ".memsphere", "memory");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(main);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "embedded";
    await runGit(["init", "-b", "master"], { cwd: main });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(mainMemory, kind), { recursive: true });
    }
    const mainSource = `!concept\nsyntax: ${currentMemorySyntax}\nnames: [shared]\ndefines: [Published]\n`;
    await writeFile(join(mainMemory, "concepts", "shared.yaml"), mainSource);
    await writeFile(
      join(mainMemory, "concepts", "delete-me.yaml"),
      `!concept\nsyntax: ${currentMemorySyntax}\nnames: [delete-me]\ndefines: [Delete me]\n`
    );
    await writeFile(
      join(mainMemory, "concepts", "rename-me.yaml"),
      `!concept\nsyntax: ${currentMemorySyntax}\nnames: [rename-me]\ndefines: [Rename me]\n`
    );
    await runGit(["add", ".memsphere/memory"], { cwd: main });
    await runGit(["commit", "-m", "memory fixture"], { cwd: main });
    process.chdir(main);
    await projectCreateCommand("embedded", { embedded: mainMemory, bind: true });
    await runGit(["worktree", "add", "-b", "linked", linked], { cwd: main });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(linkedMemory, kind), { recursive: true });
    }

    process.chdir(linked);
    const linkedSource = mainSource.replace("Published", "Linked preview");
    await writeFile(join(linkedMemory, "concepts", "shared.yaml"), linkedSource);
    const project = (await readProjectRegistry(home)).projects.embedded;
    assert(project);

    const first = await validateMemoryChange();
    assert.equal(first.storeType, "embedded");
    assert.deepEqual(first.issues, []);
    assert.equal(await readFile(join(mainMemory, "concepts", "shared.yaml"), "utf8"), mainSource);
    const changesAfterFirst = (await readdir(join(project.root, "changes"))).filter((name) => name.startsWith("change-"));
    assert.deepEqual(changesAfterFirst, [first.changeId]);

    await runGit(["worktree", "add", "-b", "linked-twin", linkedTwin], { cwd: main });
    await writeFile(join(linkedTwin, ".memsphere", "memory", "concepts", "shared.yaml"), linkedSource);
    process.chdir(linkedTwin);
    const divergentId = "change-divergent-same-base";
    const canonicalChange = JSON.parse(
      await readFile(join(project.root, "changes", first.changeId, "change.json"), "utf8")
    ) as Record<string, unknown> & { checkpoint: Record<string, unknown> };
    await mkdir(join(project.root, "changes", divergentId));
    await writeFile(join(project.root, "changes", divergentId, "change.json"), `${JSON.stringify({
      ...canonicalChange,
      id: divergentId,
      checkpoint: { ...canonicalChange.checkpoint, digest: "divergent-digest" }
    }, null, 2)}\n`);
    await assert.rejects(
      validateMemoryChange(),
      new RegExp(`multiple divergent Embedded ChangeSets.*${first.changeId}.*${divergentId}|multiple divergent Embedded ChangeSets.*${divergentId}.*${first.changeId}`)
    );
    assert.equal(
      (JSON.parse(await readFile(join(project.root, "changes", divergentId, "change.json"), "utf8")) as { status: string }).status,
      "draft"
    );
    await rm(join(project.root, "changes", divergentId), { recursive: true });
    const fromTwin = await validateMemoryChange();
    assert.equal(fromTwin.changeId, first.changeId);
    assert.equal(fromTwin.checkpointDigest, first.checkpointDigest);
    process.chdir(linked);
    const checkpoint = join(project.root, "changes", first.changeId, "checkpoints", first.checkpointDigest, "memory");
    assert.deepEqual(await readdir(checkpoint), ["concepts"]);
    assert.deepEqual(await readdir(join(checkpoint, "concepts")), ["shared.yaml"]);

    let previewSource = "";
    await withMemoryChangePreview({
      home,
      project: "embedded",
      changeId: first.changeId,
      use: async ({ memoryRoot }) => {
        previewSource = await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8");
      }
    });
    assert.match(previewSource, /Linked preview/);

    const previewCache = new MemoryChangePreviewCache();
    const cachedRoots: string[] = [];
    try {
      for (let index = 0; index < 2; index += 1) {
        await previewCache.use({
          home,
          project: "embedded",
          changeId: first.changeId,
          use: async ({ memoryRoot }) => {
            cachedRoots.push(memoryRoot);
            assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Linked preview/);
          }
        });
      }
      assert.equal(cachedRoots[0], cachedRoots[1]);
    } finally {
      await previewCache.dispose();
    }
    await assert.rejects(realpath(cachedRoots[0]!));

    const view = createViewServer(await readViewConfig());
    await new Promise<void>((resolve, reject) => {
      view.once("error", reject);
      view.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(view.address() as AddressInfo).port}`;
    try {
      const formalResponse = await fetch(`${origin}/api/memories`);
      const formal = await formalResponse.json() as {
        memories: Array<{ entity: { defines?: string[] } }>;
        source?: { mode: string };
      };
      assert.equal(formalResponse.status, 200);
      assert.deepEqual(formal.source, { mode: "formal" });
      assert.deepEqual(formal.memories.find((memory) => memory.entity.defines?.includes("Published"))?.entity.defines, ["Published"]);

      const previewResponse = await fetch(`${origin}/api/memories?change=${encodeURIComponent(first.changeId)}`);
      const preview = await previewResponse.json() as {
        memories: Array<{ entity: { defines?: string[] } }>;
        source?: { mode: string; changeId: string; storeType: string; valid: boolean };
      };
      assert.equal(previewResponse.status, 200);
      assert.deepEqual(preview.memories.find((memory) => memory.entity.defines?.includes("Linked preview"))?.entity.defines, ["Linked preview"]);
      assert.equal(preview.source?.mode, "changeset");
      assert.equal(preview.source?.changeId, first.changeId);
      assert.equal(preview.source?.storeType, "embedded");
      assert.equal(preview.source?.valid, true);

      const previewSummaryResponse = await fetch(
        `${origin}/api/memories?representation=summary&change=${encodeURIComponent(first.changeId)}`
      );
      const previewSummarySource = await previewSummaryResponse.text();
      const previewSummary = JSON.parse(previewSummarySource) as {
        memories: Array<{ id: string; names?: string[]; entity?: unknown }>;
        source?: { mode: string; changeId: string };
      };
      assert.equal(previewSummaryResponse.status, 200);
      assert.equal(previewSummary.source?.mode, "changeset");
      assert.equal(previewSummary.source?.changeId, first.changeId);
      assert.deepEqual(
        previewSummary.memories.find((memory) => memory.id === "concepts/shared")?.names,
        ["shared"]
      );
      assert.equal(previewSummary.memories.some((memory) => memory.entity !== undefined), false);
      assert.doesNotMatch(previewSummarySource, /Linked preview/);

      const previewDetailResponse = await fetch(
        `${origin}/api/memories/concepts/shared?change=${encodeURIComponent(first.changeId)}`
      );
      const previewDetail = await previewDetailResponse.json() as {
        memory: { entity: { defines?: string[] } };
      };
      assert.equal(previewDetailResponse.status, 200);
      assert.deepEqual(previewDetail.memory.entity.defines, ["Linked preview"]);

      const missing = await fetch(`${origin}/api/memories?change=change-missing`);
      assert.equal(missing.status, 404);
      const missingDetail = await fetch(`${origin}/api/changes/change-missing`);
      assert.equal(missingDetail.status, 404);
      assert.equal((await missingDetail.json() as { code: string }).code, "changeset_not_found");
    } finally {
      await new Promise<void>((resolve) => view.close(() => resolve()));
    }

    const repeated = await validateMemoryChange();
    assert.equal(repeated.changeId, first.changeId);
    assert.equal(repeated.checkpointDigest, first.checkpointDigest);
    assert.deepEqual((await readdir(join(project.root, "changes"))).filter((name) => name.startsWith("change-")), [first.changeId]);

    await rm(join(linkedMemory, "concepts", "delete-me.yaml"));
    await rename(join(linkedMemory, "concepts", "rename-me.yaml"), join(linkedMemory, "concepts", "renamed.yaml"));
    await writeFile(
      join(linkedMemory, "concepts", "created.yaml"),
      `!concept\nsyntax: ${currentMemorySyntax}\nnames: [created]\ndefines: [Created]\n`
    );
    const expanded = await validateMemoryChange();
    assert.equal(expanded.changeId, first.changeId);
    assert.notEqual(expanded.checkpointDigest, first.checkpointDigest);
    const expandedChange = JSON.parse(await readFile(join(project.root, "changes", first.changeId, "change.json"), "utf8")) as {
      targets: Array<{ operation: string }>;
    };
    assert.deepEqual(new Set(expandedChange.targets.map((target) => target.operation)), new Set(["create", "delete", "rename", "update"]));
    assert.deepEqual(await readdir(join(project.root, "changes", first.changeId, "checkpoints")), [expanded.checkpointDigest]);

    let releaseSnapshot!: () => void;
    let snapshotEntered!: () => void;
    const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    const snapshotStarted = new Promise<void>((resolve) => { snapshotEntered = resolve; });
    const heldSnapshot = withMemoryChangeReviewSnapshot({
      project: "embedded",
      changeId: first.changeId,
      use: async () => {
        snapshotEntered();
        await snapshotGate;
      }
    });
    await snapshotStarted;
    let validationSettled = false;
    const concurrentValidation = validateMemoryChange().then((result) => {
      validationSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(validationSettled, false, "validation must wait until Review snapshot creation releases the checkpoint lock");
    releaseSnapshot();
    await heldSnapshot;
    assert.equal((await concurrentValidation).checkpointDigest, expanded.checkpointDigest);

    let expandedReviewId = "";
    const expandedView = createViewServer(await readViewConfig());
    await new Promise<void>((resolve, reject) => {
      expandedView.once("error", reject);
      expandedView.listen(0, "127.0.0.1", resolve);
    });
    const expandedOrigin = `http://127.0.0.1:${(expandedView.address() as AddressInfo).port}`;
    try {
      const changesResponse = await fetch(`${expandedOrigin}/api/changes`);
      const changesPayload = await changesResponse.json() as { changes: Array<{ id: string; targetCount: number }> };
      assert.equal(changesResponse.status, 200);
      assert.equal(changesPayload.changes.find((change) => change.id === first.changeId)?.targetCount, 4);

      const detailResponse = await fetch(`${expandedOrigin}/api/changes/${encodeURIComponent(first.changeId)}`);
      const detail = await detailResponse.json() as {
        targetMemories: Array<{ operation: string; memory: { path: string; entity: { names?: string[] } } }>;
      };
      assert.equal(detailResponse.status, 200);
      assert.deepEqual(
        detail.targetMemories.find((target) => target.operation === "delete")?.memory.entity.names,
        ["delete-me"]
      );

      const createCurrentReview = () => fetch(`${expandedOrigin}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "changeset", changeId: first.changeId })
      });
      const concurrentResponses = await Promise.all([createCurrentReview(), createCurrentReview()]);
      assert.deepEqual(concurrentResponses.map((item) => item.status).sort(), [201, 409]);
      const reviewResponse = concurrentResponses.find((item) => item.status === 201)!;
      const rejectedConcurrent = concurrentResponses.find((item) => item.status === 409)!;
      assert.match(await rejectedConcurrent.text(), /already exists/);
      const review = (await reviewResponse.json() as {
        review: {
          id: string;
          target: { digest: string };
          changeManifest: { targets: Array<{ operation: string }> };
        };
      }).review;
      assert.equal(reviewResponse.status, 201);
      assert.equal(review.target.digest, expanded.checkpointDigest);
      assert.deepEqual(
        new Set(review.changeManifest.targets.map((target) => target.operation)),
        new Set(["create", "delete", "rename", "update"])
      );
      expandedReviewId = review.id;

      const duplicateReview = await fetch(`${expandedOrigin}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "changeset", changeId: first.changeId })
      });
      assert.equal(duplicateReview.status, 409);
      assert.match(await duplicateReview.text(), /already exists/);

      const snapshotsResponse = await fetch(`${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}/snapshots`);
      const snapshots = await snapshotsResponse.json() as {
        memories: Array<{ memory: { path: string; entity: { defines?: string[] } } }>;
      };
      assert.equal(snapshotsResponse.status, 200);
      assert.equal(snapshots.memories.length, 4);
      assert.deepEqual(
        snapshots.memories.find((item) => item.memory.path === "concepts/shared.yaml")?.memory.entity.defines,
        ["Linked preview"]
      );

      const reviewBrowser = await chromium.launch({ headless: true });
      try {
        const page = await reviewBrowser.newPage({ viewport: { width: 1366, height: 900 } });
        await page.goto(
          `${expandedOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`
          + `/reviews/${encodeURIComponent(review.id)}`
        );
        const submit = page.getByRole("button", { name: "Submit", exact: true });
        await submit.waitFor();
        assert.equal(await submit.isEnabled(), true);
        await submit.click();
        await page.getByText("submitted · 0 comment(s)", { exact: true }).waitFor();
        await page.close();
      } finally {
        await reviewBrowser.close();
      }
      const submittedReview = await fetch(`${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}`);
      assert.equal(
        (await submittedReview.json() as { review: { status: string } }).review.status,
        "submitted"
      );
      const submittedChanges = await fetch(`${expandedOrigin}/api/changes`);
      assert.equal(
        ((await submittedChanges.json()) as { changes: Array<{ id: string; state: string }> }).changes
          .find((change) => change.id === first.changeId)?.state,
        "in_review"
      );

      await writeFile(
        join(linkedMemory, "concepts", "shared.yaml"),
        linkedSource.replace("Linked preview", "Newer stale review")
      );
      const newer = await validateMemoryChange();
      assert.notEqual(newer.checkpointDigest, expanded.checkpointDigest);

      const stalePatch = await fetch(`${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "must not change",
          status: "done",
          comments: [{
            id: "comment-on-stale-snapshot",
            source: "changeset",
            memoryId: "concepts/shared",
            memoryName: "shared",
            kind: "concepts",
            body: "This mutation must be rejected.",
            createdAt: new Date().toISOString()
          }]
        })
      });
      assert.equal(stalePatch.status, 409);
      assert.equal(
        (await stalePatch.json() as { code: string }).code,
        "changeset_review_stale"
      );
      const staleDelete = await fetch(`${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}`, {
        method: "DELETE"
      });
      assert.equal(staleDelete.status, 409);
      assert.equal(
        (await staleDelete.json() as { code: string }).code,
        "changeset_review_stale"
      );
      const unchangedStaleResponse = await fetch(
        `${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}`
      );
      const unchangedStale = (await unchangedStaleResponse.json() as {
        review: { title: string; status: string; comments: unknown[] };
      }).review;
      assert.equal(unchangedStale.title, `ChangeSet Review · ${first.changeId}`);
      assert.equal(unchangedStale.status, "submitted");
      assert.deepEqual(unchangedStale.comments, []);

      const creationBrowser = await chromium.launch({ headless: true });
      try {
        const page = await creationBrowser.newPage({ viewport: { width: 1366, height: 900 } });
        let createRequests = 0;
        page.on("request", (request) => {
          if (request.method() === "POST" && new URL(request.url()).pathname === "/api/reviews") createRequests += 1;
        });
        await page.goto(`${expandedOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
        const createReview = page.locator("#detail").getByRole("button", { name: "Create Review", exact: true });
        await createReview.waitFor();
        assert.equal(await createReview.isEnabled(), true);
        const createdResponse = page.waitForResponse((response) => (
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/reviews"
        ));
        await createReview.click();
        assert.equal((await createdResponse).status(), 201);
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#detail button")).some((button) => (
          button.textContent === "Create Review" && (button as HTMLButtonElement).disabled
        )));
        assert.equal(await createReview.isDisabled(), true);
        assert.match(await createReview.getAttribute("title") ?? "", /already exists/);
        assert.equal(createRequests, 1);
        await page.close();
      } finally {
        await creationBrowser.close();
      }

      await writeFile(join(linkedMemory, "concepts", "shared.yaml"), linkedSource);
      const restored = await validateMemoryChange();
      assert.equal(restored.checkpointDigest, expanded.checkpointDigest);
      const restoredDuplicate = await fetch(`${expandedOrigin}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "changeset", changeId: first.changeId })
      });
      assert.equal(restoredDuplicate.status, 409);
      assert.match(await restoredDuplicate.text(), new RegExp(review.id));

      const doneReview = await fetch(`${expandedOrigin}/api/reviews/${encodeURIComponent(review.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "done",
          comments: [{
            id: "comment-resolved",
            source: "changeset",
            memoryId: "concepts/shared",
            memoryName: "shared",
            kind: "concepts",
            body: "Resolved before completion.",
            createdAt: new Date().toISOString()
          }]
        })
      });
      assert.equal(doneReview.status, 200, await doneReview.text());
      const duplicateDoneReview = await fetch(`${expandedOrigin}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "changeset", changeId: first.changeId })
      });
      assert.equal(duplicateDoneReview.status, 409);
      assert.match(await duplicateDoneReview.text(), new RegExp(review.id));
      const approvedChanges = await fetch(`${expandedOrigin}/api/changes`);
      assert.equal(
        ((await approvedChanges.json()) as { changes: Array<{ id: string; state: string }> }).changes
          .find((change) => change.id === first.changeId)?.state,
        "approved"
      );
      const approvedBrowser = await chromium.launch({ headless: true });
      try {
        const page = await approvedBrowser.newPage({ viewport: { width: 1366, height: 900 } });
        await page.goto(`${expandedOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
        const createReview = page.locator("#detail").getByRole("button", { name: "Create Review", exact: true });
        await createReview.waitFor();
        assert.equal(await createReview.isDisabled(), true);
        assert.match(await createReview.getAttribute("title") ?? "", /already exists/);
        await page.close();
      } finally {
        await approvedBrowser.close();
      }
    } finally {
      await new Promise<void>((resolve) => expandedView.close(() => resolve()));
    }

    await writeFile(join(linkedMemory, "concepts", "shared.yaml"), "!concept\nnames: [Broken\n");
    const invalid = await validateMemoryChange();
    const canonicalLinkedMemory = await realpath(linkedMemory);
    assert(invalid.issues.some((issue) => issue.path === join(canonicalLinkedMemory, "concepts", "shared.yaml")));
    const invalidChange = JSON.parse(await readFile(join(project.root, "changes", first.changeId, "change.json"), "utf8")) as {
      checkpoint: { valid: boolean; issues: Array<{ path: string }> };
    };
    assert.equal(invalidChange.checkpoint.valid, false);
    assert(invalidChange.checkpoint.issues.some((issue) => issue.path === "concepts/shared.yaml"));

    const invalidView = createViewServer(await readViewConfig());
    await new Promise<void>((resolve, reject) => {
      invalidView.once("error", reject);
      invalidView.listen(0, "127.0.0.1", resolve);
    });
    const invalidOrigin = `http://127.0.0.1:${(invalidView.address() as AddressInfo).port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const historicalReviewsResponse = await fetch(
        `${invalidOrigin}/api/reviews?representation=summary&change_id=${encodeURIComponent(first.changeId)}`
      );
      const historicalReviews = await historicalReviewsResponse.json() as {
        reviews: Array<{ id: string; stale?: boolean }>;
      };
      assert.equal(historicalReviewsResponse.status, 200);
      assert.equal(historicalReviews.reviews.find((review) => review.id === expandedReviewId)?.stale, true);

      const historicalSnapshotResponse = await fetch(
        `${invalidOrigin}/api/reviews/${encodeURIComponent(expandedReviewId)}/snapshots`
      );
      const historicalSnapshotSource = await historicalSnapshotResponse.text();
      assert.equal(historicalSnapshotResponse.status, 200);
      assert.match(historicalSnapshotSource, /Linked preview/);
      assert.doesNotMatch(historicalSnapshotSource, /Broken/);

      const invalidReviewResponse = await fetch(`${invalidOrigin}/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "changeset", changeId: first.changeId })
      });
      assert.equal(invalidReviewResponse.status, 409);
      const invalidReviewError = await invalidReviewResponse.json() as { code: string; error: string };
      assert.equal(invalidReviewError.code, "changeset_validation_required");
      assert.match(invalidReviewError.error, /validation must pass/);

      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.goto(`${invalidOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
      await page.getByRole("heading", { name: "Validation diagnostics", exact: true }).waitFor();
      assert.match(await page.locator(".error-panel").first().textContent() ?? "", /concepts\/shared\.yaml/);
      const createReview = page.getByRole("button", { name: "Create Review", exact: true });
      assert.equal(await createReview.isDisabled(), true);
      assert.match(await page.getByText(/Fix the validation diagnostics/).textContent() ?? "", /memory change validate/);
      assert.equal(new URL(page.url()).pathname, `/projects/embedded/changes/${first.changeId}`);
      await page.close();
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => invalidView.close(() => resolve()));
    }
    await writeFile(join(linkedMemory, "concepts", "shared.yaml"), linkedSource);
    assert.deepEqual((await validateMemoryChange()).issues, []);

    const beforeOrdinaryValidate = await readdir(join(project.root, "changes"));
    await validateCommand({});
    assert.deepEqual(await readdir(join(project.root, "changes")), beforeOrdinaryValidate);

    await runGit(["add", ".memsphere/memory"], { cwd: linked });
    await runGit(["commit", "-m", "advance linked head"], { cwd: linked });
    await writeFile(join(linkedMemory, "concepts", "shared.yaml"), linkedSource.replace("Linked preview", "Next round"));
    const next = await validateMemoryChange();
    assert.notEqual(next.changeId, first.changeId);
    assert.notEqual(next.baseRevision, first.baseRevision);
    assert(next.completedChangeIds.includes(first.changeId));
    const completed = JSON.parse(await readFile(join(project.root, "changes", first.changeId, "change.json"), "utf8")) as {
      status: string;
    };
    assert.equal(completed.status, "completed");

    const completedView = createViewServer(await readViewConfig());
    await new Promise<void>((resolve, reject) => {
      completedView.once("error", reject);
      completedView.listen(0, "127.0.0.1", resolve);
    });
    const completedOrigin = `http://127.0.0.1:${(completedView.address() as AddressInfo).port}`;
    const completedBrowser = await chromium.launch({ headless: true });
    try {
      const page = await completedBrowser.newPage();
      await page.goto(`${completedOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
      await page.getByText("Completed ChangeSet", { exact: true }).waitFor();
      assert.equal(await page.getByText("Draft ChangeSet", { exact: true }).count(), 0);
    } finally {
      await completedBrowser.close();
      await new Promise<void>((resolve) => completedView.close(() => resolve()));
    }
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous.project;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded validation supports a Memory root equal to the Git worktree root", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-root-change-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(main);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "root-embedded";
    await runGit(["init", "-b", "master"], { cwd: main });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(main, kind), { recursive: true });
    }
    const published = `!concept\nsyntax: ${currentMemorySyntax}\nnames: [root-memory]\ndefines: [Published root]\n`;
    await writeFile(join(main, "concepts", "root-memory.yaml"), published);
    await runGit(["add", "concepts"], { cwd: main });
    await runGit(["commit", "-m", "root memory fixture"], { cwd: main });
    process.chdir(main);
    await projectCreateCommand("root-embedded", { embedded: main, bind: true });
    await runGit(["worktree", "add", "-b", "linked", linked], { cwd: main });

    process.chdir(linked);
    await writeFile(join(linked, "concepts", "root-memory.yaml"), published.replace("Published root", "Root preview"));
    const validation = await validateMemoryChange();
    assert.equal(validation.storeType, "embedded");
    assert.deepEqual(validation.issues, []);
    assert.equal(await readFile(join(main, "concepts", "root-memory.yaml"), "utf8"), published);

    const project = (await readProjectRegistry(home)).projects["root-embedded"];
    assert(project);
    const change = JSON.parse(await readFile(join(project.root, "changes", validation.changeId, "change.json"), "utf8")) as {
      source_worktree: { memory_path: string };
    };
    assert.equal(change.source_worktree.memory_path, ".");
    await withMemoryChangePreview({
      home,
      project: "root-embedded",
      changeId: validation.changeId,
      use: async ({ memoryRoot }) => {
        assert.match(await readFile(join(memoryRoot, "concepts", "root-memory.yaml"), "utf8"), /Root preview/);
      }
    });
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous.project;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});
