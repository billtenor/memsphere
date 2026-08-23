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
      };
      assert.equal(changeDetailResponse.status, 200);
      assert.deepEqual(changeDetail.actorNames, { alice: "Alice" });
      assert.deepEqual(changeDetail.actorKinds, { alice: "human" });

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
      await page.goto(`${invalidOrigin}/projects/embedded/changes/${encodeURIComponent(first.changeId)}`);
      await page.getByRole("heading", { name: "Validation diagnostics", exact: true }).waitFor();
      assert.deepEqual(
        await page.evaluate(() => (window as unknown as { currentChangeOperator(): unknown }).currentChangeOperator()),
        { kind: "human", id: "alice" }
      );
      assert.match(await page.locator(".error-panel").first().textContent() ?? "", /concepts\/shared\.yaml/);
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
