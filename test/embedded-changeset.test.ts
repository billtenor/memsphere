import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { projectCreateCommand } from "../src/commands/project.js";
import { createViewServer } from "../src/commands/view.js";
import { runGit } from "../src/git.js";
import { validateCommand } from "../src/commands/validate.js";
import { readViewConfig } from "../src/config.js";
import {
  MemoryChangePreviewCache,
  createMemoryChangeComment,
  deleteMemoryChangeComment,
  listMemoryChanges,
  readMemoryChange,
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

    const firstChange = JSON.parse(
      await readFile(join(project.root, "changes", first.changeId, "change.json"), "utf8")
    ) as Record<string, unknown>;
    const legacyId = "change-legacy-without-store-type";
    const legacyChange = {
      ...firstChange,
      id: legacyId,
      status: "completed",
      published_revision: "legacy-revision"
    };
    delete legacyChange.store_type;
    await mkdir(join(project.root, "changes", legacyId));
    await writeFile(
      join(project.root, "changes", legacyId, "change.json"),
      `${JSON.stringify(legacyChange, null, 2)}\n`
    );
    assert.equal((await validateMemoryChange()).changeId, first.changeId);

    legacyChange.status = "abandoned";
    delete legacyChange.published_revision;
    await writeFile(
      join(project.root, "changes", legacyId, "change.json"),
      `${JSON.stringify(legacyChange, null, 2)}\n`
    );
    assert.equal((await validateMemoryChange()).changeId, first.changeId);

    legacyChange.status = "active";
    await writeFile(
      join(project.root, "changes", legacyId, "change.json"),
      `${JSON.stringify(legacyChange, null, 2)}\n`
    );
    await assert.rejects(validateMemoryChange(), /invalid persisted data.*store_type/s);
    await rm(join(project.root, "changes", legacyId), { recursive: true });

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
      checkpoint: { ...canonicalChange.checkpoint, digest: "f".repeat(64) }
    }, null, 2)}\n`);
    await assert.rejects(
      validateMemoryChange(),
      new RegExp(`multiple divergent Embedded ChangeSets.*${first.changeId}.*${divergentId}|multiple divergent Embedded ChangeSets.*${divergentId}.*${first.changeId}`)
    );
    assert.equal(
      (JSON.parse(await readFile(join(project.root, "changes", divergentId, "change.json"), "utf8")) as { status: string }).status,
      "active"
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

    const projectConfigPath = join(project.root, "config.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as Record<string, unknown>;
    await writeFile(projectConfigPath, `${JSON.stringify({
      ...projectConfig,
      control_plane: {
        runner: { permissions: [] },
        actors: { alice: { kind: "human", name: "Alice", permissions: [] } }
      }
    }, null, 2)}\n`);

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

      const changeDetailResponse = await fetch(`${origin}/api/changes/${encodeURIComponent(first.changeId)}`);
      const changeDetail = await changeDetailResponse.json() as {
        actorNames: Record<string, string>;
        actorKinds: Record<string, string>;
        change: { sourceWorktree?: { root: string; available: boolean } };
      };
      assert.equal(changeDetailResponse.status, 200);
      assert.deepEqual(changeDetail.actorNames, { alice: "Alice" });
      assert.deepEqual(changeDetail.actorKinds, { alice: "human" });
      assert([
        await realpath(linked),
        await realpath(linkedTwin)
      ].includes(changeDetail.change.sourceWorktree?.root ?? ""));
      assert.equal(changeDetail.change.sourceWorktree?.available, true);

      const changeRecordPath = join(project.root, "changes", first.changeId, "change.json");
      const originalChangeRecord = await readFile(changeRecordPath, "utf8");
      const unavailableSource = JSON.parse(originalChangeRecord) as {
        source_worktree: { root: string };
      };
      unavailableSource.source_worktree.root = join(fixture, "removed-linked-worktree");
      await writeFile(changeRecordPath, `${JSON.stringify(unavailableSource, null, 2)}\n`);
      try {
        const unavailableResponse = await fetch(`${origin}/api/changes/${encodeURIComponent(first.changeId)}`);
        const unavailable = await unavailableResponse.json() as {
          change: { status: string; sourceWorktree: { root: string; available: boolean } };
        };
        assert.equal(unavailableResponse.status, 200);
        assert.equal(unavailable.change.status, "active");
        assert.equal(unavailable.change.sourceWorktree.available, false);

        const sourceBrowser = await chromium.launch({ headless: true });
        try {
          const page = await sourceBrowser.newPage({ viewport: { width: 1366, height: 900 } });
          await page.goto(`${origin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
          await page.getByText("来源工作区不可用", { exact: true }).waitFor();
          assert.match(await page.locator(".memory-source-worktree .memory-muted").textContent() ?? "", /removed-linked-worktree/);
        } finally {
          await sourceBrowser.close();
        }
      } finally {
        await writeFile(changeRecordPath, originalChangeRecord);
      }

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

      const corruptId = "change-corrupt-store-type";
      const corruptRoot = join(project.root, "changes", corruptId);
      await mkdir(corruptRoot);
      const { store_type: _storeType, ...corruptChange } = canonicalChange;
      await writeFile(join(corruptRoot, "change.json"), `${JSON.stringify({
        ...corruptChange,
        id: corruptId
      }, null, 2)}\n`);
      try {
        const listResponse = await fetch(origin + "/api/changes");
        const listPayload = await listResponse.json() as {
          changes: Array<{ id: string; status: string; error?: string }>;
        };
        assert.equal(listResponse.status, 200);
        const unavailable = listPayload.changes.find((change) => change.id === corruptId);
        assert.equal(unavailable?.status, "unavailable");
        assert.match(unavailable?.error ?? "", /store_type/);

        const detailResponse = await fetch(origin + `/api/changes/${corruptId}`);
        const detailPayload = await detailResponse.json() as { code: string; error: string };
        assert.equal(detailResponse.status, 500);
        assert.equal(detailPayload.code, "changeset_integrity_error");
        assert.match(detailPayload.error, new RegExp(corruptId));
        assert.match(detailPayload.error, /store_type/);

        const corruptBrowser = await chromium.launch({ headless: true });
        try {
          const page = await corruptBrowser.newPage({ viewport: { width: 1366, height: 900 } });
          await page.goto(`${origin}/projects/embedded/changes/${corruptId}`);
          await page.locator(".memory-error").waitFor();
          assert.match(await page.locator(".memory-error").textContent() ?? "", new RegExp(corruptId));
          assert.match(await page.locator(".memory-error").textContent() ?? "", /store_type/);
        } finally {
          await corruptBrowser.close();
        }
      } finally {
        await rm(corruptRoot, { recursive: true, force: true });
      }
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
    let validationWaiting!: () => void;
    const validationQueued = new Promise<void>((resolve) => { validationWaiting = resolve; });
    const concurrentValidation = validateMemoryChange(undefined, { onLockWait: validationWaiting }).then((result) => {
      validationSettled = true;
      return result;
    });
    await Promise.race([
      validationQueued,
      delay(5_000, undefined, { ref: false }).then(() => {
        throw new Error("timed out waiting for validation to queue behind the checkpoint lock");
      })
    ]);
    assert.equal(validationSettled, false, "validation must wait until Review snapshot creation releases the checkpoint lock");
    releaseSnapshot();
    await heldSnapshot;
    assert.equal((await concurrentValidation).checkpointDigest, expanded.checkpointDigest);


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
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.goto(`${invalidOrigin}/projects/embedded/memories?change=${encodeURIComponent(first.changeId)}`);
      await page.getByRole("heading", { name: "草稿预览", exact: true }).waitFor();
      await page.getByRole("button", { name: "shared", exact: true }).click();
      await page.getByRole("heading", { name: "记忆 YAML 无效", exact: true }).waitFor();
      const changeContext = page.locator(".memory-change-context .memory-meta");
      assert.match(await changeContext.textContent() ?? "", /存储：embedded/);
      assert.match(await changeContext.textContent() ?? "", /校验失败/);
      assert.equal(await page.evaluate(() => localStorage.getItem("memsphere.changeActorSelection.v1")), null);
      assert.match(await page.locator(".memory-error").first().textContent() ?? "", /concepts\/shared\.yaml/);
      assert.equal(await page.getByRole("button", { name: "Create Review", exact: true }).count(), 0);
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
    const firstRead = await readMemoryChange({ home, project: "embedded", changeId: first.changeId });
    assert.equal(firstRead.status, "active");
    assert.match(firstRead.candidate_revision ?? "", /^[0-9a-f]{40,64}$/);
    const repeatedRead = await readMemoryChange({ home, project: "embedded", changeId: first.changeId });
    assert.equal(repeatedRead.updated_at, firstRead.updated_at);
    const withComment = await createMemoryChangeComment({
      home,
      project: "embedded",
      changeId: first.changeId,
      actor: { kind: "human", id: "reviewer", name: "Reviewer" },
      memoryReference: "concepts/shared",
      path: "concepts/shared.yaml",
      body: "CAS remains valid after repeated reconciliation reads",
      expectedUpdatedAt: repeatedRead.updated_at
    });
    const afterCommentRead = await readMemoryChange({ home, project: "embedded", changeId: first.changeId });
    assert.equal(afterCommentRead.comments.length, 1);
    await deleteMemoryChangeComment({
      home,
      project: "embedded",
      changeId: first.changeId,
      commentId: withComment.comment.id,
      actor: { kind: "human", id: "reviewer", name: "Reviewer" },
      expectedUpdatedAt: afterCommentRead.updated_at
    });

    const changePath = join(project.root, "changes", first.changeId, "change.json");
    const reusable = JSON.parse(await readFile(changePath, "utf8")) as Record<string, unknown>;
    await writeFile(changePath, `${JSON.stringify({ ...reusable, origin: "view" }, null, 2)}\n`);
    const forwarded = await validateMemoryChange(first.changeId);
    assert.equal(forwarded.changeId, first.changeId);
    assert.notEqual(forwarded.baseRevision, first.baseRevision);
    assert.notEqual(forwarded.checkpointDigest, first.checkpointDigest);
    const newerCandidate = await readMemoryChange({ home, project: "embedded", changeId: first.changeId });
    assert.equal(newerCandidate.status, "active");
    assert.equal(newerCandidate.candidate_revision, undefined);

    process.chdir(main);
    await runGit(["merge", "--no-ff", "linked", "-m", "merge linked memory"], { cwd: main });
    const staleCandidateCheck = (await listMemoryChanges({ home, project: "embedded" }))
      .find((change) => change.id === first.changeId);
    assert(staleCandidateCheck);
    assert.equal(staleCandidateCheck.status, "active");

    process.chdir(linked);
    await runGit(["add", ".memsphere/memory"], { cwd: linked });
    await runGit(["commit", "-m", "advance linked candidate"], { cwd: linked });
    process.chdir(main);
    await runGit(["merge", "--no-ff", "linked", "-m", "merge updated linked memory"], { cwd: main });
    const reconciled = (await listMemoryChanges({ home, project: "embedded" }))
      .find((change) => change.id === first.changeId);
    assert(reconciled);
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
      await page.locator(".view-shell-heading", { hasText: first.changeId }).waitFor();
      await page.locator(".view-shell-heading", { hasText: "已完成" }).waitFor();
      assert.equal(await page.locator(".view-shell-heading", { hasText: "进行中" }).count(), 0);
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
