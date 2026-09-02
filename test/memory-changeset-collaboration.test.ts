import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCreateCommand } from "../src/commands/project.js";
import { runGit } from "../src/git.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import {
  abandonMemoryChange,
  addMemoryChangeScope,
  archiveMemoryChange,
  claimMemoryChange,
  completeMemoryChange,
  createMemoryChangeComment,
  createViewMemoryChange,
  deleteMemoryChangeComment,
  editMemories,
  finishMemoryChange,
  publishMemoryChange,
  readMemoryChange,
  updateMemoryChangeComment,
  withMemoryChangeDetailSnapshot
} from "../src/memory/changeset.js";

test("View ChangeSet records attribution and drives flat Comment claim lifecycle", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-view-change-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "project";
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);
    await projectCreateCommand("project", { bind: true });
    const seed = await editMemories({ references: ["concepts/shared", "concepts/other"] });
    await writeFile(
      join(seed.candidateRoot, "concepts", "shared.yaml"),
      (await readFile(join(seed.candidateRoot, "concepts", "shared.yaml"), "utf8"))
        .replace("defines: []", "defines: [Published]")
    );
    await writeFile(
      join(seed.candidateRoot, "concepts", "other.yaml"),
      (await readFile(join(seed.candidateRoot, "concepts", "other.yaml"), "utf8"))
        .replace("defines: []", "defines: [Other published Memory]")
    );
    await publishMemoryChange(seed.change.id);

    const actor = { kind: "human" as const, id: "owner", name: "Owner" };
    const created = await createViewMemoryChange({
      home,
      project: "project",
      reference: "concepts/shared",
      actor
    });
    assert.equal(created.origin, "view");
    assert.deepEqual(created.created_by, actor);
    assert.equal(created.targets.length, 0);
    assert.equal(created.scope.length, 1);

    let snapshotOperation = "";
    await withMemoryChangeDetailSnapshot({
      home,
      project: "project",
      changeId: created.id,
      use: async ({ files }) => {
        assert.equal(files.length, 1);
        snapshotOperation = files[0]!.operation;
        assert(files[0]!.candidatePath);
        assert.match(await readFile(files[0]!.candidatePath, "utf8"), /!concept/);
      }
    });
    assert.equal(snapshotOperation, "unchanged");

    const path = created.scope[0]!.path;
    const first = await createMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      actor,
      memoryReference: created.scope[0]!.reference,
      path,
      target: "asserts[0]",
      location: { anchor: "asserts[0]", line: 1 },
      snapshot: "old value",
      body: "Please clarify this rule."
    });
    assert.equal(first.comment.status, "pending");
    assert.deepEqual(first.comment.submitted_by, actor);
    assert.equal(first.comment.base_revision, created.base_revision);

    const edited = await updateMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      commentId: first.comment.id,
      actor,
      body: "Please make this rule explicit."
    });
    assert.equal(edited.comment.body, "Please make this rule explicit.");
    await assert.rejects(
      updateMemoryChangeComment({
        home,
        project: "project",
        changeId: created.id,
        commentId: first.comment.id,
        actor: { kind: "human", id: "other", name: "Other" },
        body: "Not mine"
      }),
      /only the Comment submitter/
    );

    const disposable = await createMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      actor,
      memoryReference: created.scope[0]!.reference,
      path,
      body: "Temporary"
    });
    const withdrawable = await createMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      actor,
      memoryReference: created.scope[0]!.reference,
      path,
      body: "Withdraw after processing starts"
    });
    const second = await createMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      actor,
      memoryReference: created.scope[0]!.reference,
      path,
      body: "A second processing Comment"
    });
    const afterDelete = await deleteMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      commentId: disposable.comment.id,
      actor
    });
    assert(!afterDelete.comments.some((comment) => comment.id === disposable.comment.id));

    const claimed = await claimMemoryChange({ changeId: created.id });
    assert(claimed.change.claim);
    assert.equal(claimed.change.comments[0]!.status, "processing");
    const claimedSharedPath = join(claimed.candidateRoot, "concepts", "shared.yaml");
    await writeFile(
      claimedSharedPath,
      (await readFile(claimedSharedPath, "utf8")).replace("Published", "Unvalidated local edit")
    );
    const repeatedClaim = await claimMemoryChange({ changeId: created.id });
    assert.match(await readFile(repeatedClaim.candidateRoot + "/concepts/shared.yaml", "utf8"), /Unvalidated local edit/);
    assert.match(repeatedClaim.warnings.join("\n"), /existing candidate was preserved/);
    await assert.rejects(
      addMemoryChangeScope({
        home,
        project: "project",
        changeId: created.id,
        reference: "concepts/other"
      }),
      /cannot add Memory while the ChangeSet is claimed/
    );
    await assert.rejects(
      deleteMemoryChangeComment({
        home,
        project: "project",
        changeId: created.id,
        commentId: first.comment.id,
        actor
      }),
      /only pending Comments can be deleted/
    );
    const withdrawn = await updateMemoryChangeComment({
      home,
      project: "project",
      changeId: created.id,
      commentId: withdrawable.comment.id,
      actor,
      withdraw: true
    });
    assert.equal(withdrawn.comment.status, "completed");
    await assert.rejects(
      finishMemoryChange({ changeId: created.id }),
      /finish must complete every processing Comment/
    );
    await assert.rejects(
      finishMemoryChange({
        changeId: created.id,
        commentIds: [first.comment.id],
        reason: "rejected"
      }),
      new RegExp(second.comment.id)
    );
    await assert.rejects(
      finishMemoryChange({
        changeId: created.id,
        commentIds: [first.comment.id],
        reason: "fixed"
      }),
      /valid ChangeSet checkpoint/
    );
    const finished = await finishMemoryChange({
      changeId: created.id,
      commentIds: [first.comment.id, second.comment.id],
      reason: "rejected"
    });
    assert.equal(finished.comments[0]!.status, "completed");
    assert.equal(finished.claim, undefined);

    const abandoned = await abandonMemoryChange({ home, project: "project", changeId: created.id });
    assert.equal(abandoned.status, "abandoned");
    await assert.rejects(
      createMemoryChangeComment({
        home,
        project: "project",
        changeId: created.id,
        actor,
        memoryReference: created.scope[0]!.reference,
        path,
        body: "Too late"
      }),
      /already abandoned/
    );
    assert.equal((await readMemoryChange({ home, project: "project", changeId: created.id })).status, "abandoned");
    await assert.rejects(
      archiveMemoryChange({
        home,
        project: "project",
        changeId: created.id,
        expectedUpdatedAt: "2026-08-01T00:00:00.000Z"
      }),
      /modified by another operation/
    );
    const archivedAbandoned = await archiveMemoryChange({
      home,
      project: "project",
      changeId: created.id,
      expectedUpdatedAt: abandoned.updated_at
    });
    assert.equal(archivedAbandoned.kind, "changes");
    assert.equal(archivedAbandoned.id, created.id);
    assert.match(await readFile(join(archivedAbandoned.path, "change.json"), "utf8"), /"status": "abandoned"/);
    assert.match(await readFile(join(archivedAbandoned.path, ".archive.json"), "utf8"), /"kind": "changes"/);
    await assert.rejects(readMemoryChange({ home, project: "project", changeId: created.id }), /ENOENT/);

    const completable = await createViewMemoryChange({
      home,
      project: "project",
      reference: "concepts/shared",
      actor
    });
    await assert.rejects(
      archiveMemoryChange({ home, project: "project", changeId: completable.id }),
      /only terminal ChangeSets/
    );
    const completed = await completeMemoryChange(completable.id);
    assert.equal(completed.status, "completed");

    const stale = await createViewMemoryChange({
      home,
      project: "project",
      reference: "concepts/shared",
      actor
    });
    const concurrent = await editMemories({ references: ["concepts/shared", "concepts/later"] });
    const concurrentPath = join(concurrent.candidateRoot, "concepts", "shared.yaml");
    await writeFile(
      concurrentPath,
      (await readFile(concurrentPath, "utf8")).replace("Published", "Published concurrently")
    );
    const laterPath = join(concurrent.candidateRoot, "concepts", "later.yaml");
    await writeFile(
      laterPath,
      (await readFile(laterPath, "utf8")).replace("defines: []", "defines: [Published after ChangeSet creation]")
    );
    await publishMemoryChange(concurrent.change.id);
    await addMemoryChangeScope({
      home,
      project: "project",
      changeId: stale.id,
      reference: "concepts/later"
    });
    await withMemoryChangeDetailSnapshot({
      home,
      project: "project",
      changeId: stale.id,
      use: async ({ files }) => {
        const later = files.find((file) => file.reference === "concepts/later");
        assert(later);
        assert(later.candidatePath);
        assert.match(await readFile(later.candidatePath, "utf8"), /Published after ChangeSet creation/);
      }
    });
    await assert.rejects(
      claimMemoryChange({ changeId: stale.id }),
      /edit conflict: scoped Memory changed since ChangeSet creation/
    );
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

test("View ChangeSet uses the Git revision for an Embedded scope snapshot", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-view-embedded-change-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const memoryRoot = join(workspace, ".memsphere", "memory");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(join(memoryRoot, "concepts"), { recursive: true });
    for (const kind of ["statements", "schemas", "procedures"]) {
      await mkdir(join(memoryRoot, kind), { recursive: true });
    }
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await writeFile(
      join(memoryRoot, "concepts", "shared.yaml"),
      `!concept\nsyntax: ${currentMemorySyntax}\nnames: [shared]\ndefines: [Published]\n`
    );
    await runGit(["init", "-b", "master"], { cwd: workspace });
    await runGit(["add", ".memsphere/memory"], { cwd: workspace });
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    await runGit(["commit", "-m", "memory fixture"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "embedded";
    process.chdir(workspace);
    await projectCreateCommand("embedded", { embedded: memoryRoot, bind: true });

    const revision = (await runGit(["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const created = await createViewMemoryChange({
      home,
      project: "embedded",
      reference: "concepts/shared",
      actor: { kind: "human", id: "owner", name: "Owner" }
    });
    assert.equal(created.base_revision, revision);
    assert.equal(created.scope[0]?.added_revision, revision);
    await withMemoryChangeDetailSnapshot({
      home,
      project: "embedded",
      changeId: created.id,
      use: async ({ files }) => {
        assert.equal(files.length, 1);
        assert(files[0]!.candidatePath);
        assert.match(await readFile(files[0]!.candidatePath, "utf8"), /Published/);
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
