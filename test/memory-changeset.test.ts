import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCreateCommand } from "../src/commands/project.js";
import { gitOutput, runGit } from "../src/git.js";
import {
  checkpointWorkspaceChanges,
  editMemories,
  failMemoryChange,
  memoryChangeSetSchema,
  publishMemoryChange,
  recoverMemory,
  renameMemory,
  resumeMemoryChange,
  validateMemoryChange
} from "../src/memory/changeset.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { DefaultMemoryCatalog, MemoryFrozenError } from "../src/memory/catalog.js";
import { ProjectMemoryProvider } from "../src/memory/project-provider.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import { readMemoryFile } from "../src/memory/store.js";

test("Managed ChangeSet publishes atomically and enforces target CAS", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-changeset-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, gitConfig: process.env.GIT_CONFIG_GLOBAL };
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.env.MEMSPHERE_HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.chdir(workspace);
    await projectCreateCommand("project", { bind: true });
    const registry = await readProjectRegistry(home);
    const memoryRoot = join(registry.projects.project.root, "memory");

    await assert.rejects(
      editMemories({ references: ["statements/MemoryBase MR 功能交付评审规范"] }),
      /invalid Memory reference/
    );
    const canonicalExample = await editMemories({
      references: ["statements/memorybase-mr-functional-delivery-review-rules"]
    });
    assert.equal(
      canonicalExample.change.targets[0]?.path,
      "statements/memorybase-mr-functional-delivery-review-rules.yaml"
    );
    const canonicalCandidate = join(
      canonicalExample.candidateRoot,
      "statements",
      "memorybase-mr-functional-delivery-review-rules.yaml"
    );
    await writeFile(
      canonicalCandidate,
      (await readFile(canonicalCandidate, "utf8")).replace("asserts: []", "asserts: [Canonical statement.]")
    );
    await publishMemoryChange(canonicalExample.change.id);
    const explicit = await editMemories({
      references: ["concepts/explicit-path"],
      createPaths: new Map([["concepts/explicit-path", "concepts/human-readable.yaml"]])
    });
    assert.equal(explicit.change.targets[0]?.path, "concepts/human-readable.yaml");
    assert.match(await readFile(join(explicit.candidateRoot, "concepts", "human-readable.yaml"), "utf8"), /explicit-path/);
    await publishMemoryChange(explicit.change.id);
    await assert.rejects(
      editMemories({
        references: ["concepts/occupied-path"],
        createPaths: new Map([["concepts/occupied-path", "concepts/human-readable.yaml"]])
      }),
      /explicit create path already exists/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/unsafe"],
        createPaths: new Map([["concepts/unsafe", "../concepts/unsafe.yaml"]])
      }),
      /invalid or escaping Memory path/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/wrong-kind"],
        createPaths: new Map([["concepts/wrong-kind", "procedures/wrong-kind.yaml"]])
      }),
      /kind does not match/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/first-path-owner", "concepts/second-path-owner"],
        createPaths: new Map([
          ["concepts/first-path-owner", "concepts/shared-target.yaml"],
          ["concepts/second-path-owner", "concepts/shared-target.yaml"]
        ])
      }),
      /path is targeted by multiple references/
    );

    const created = await editMemories({ references: ["concepts/shared", "concepts/other"] });
    const candidate = join(created.candidateRoot, "concepts", "shared.yaml");
    await writeFile(candidate, (await readFile(candidate, "utf8")).replace("defines: []", "defines: [Initial]"));
    const otherCandidate = join(created.candidateRoot, "concepts", "other.yaml");
    const otherMemory = await readMemoryFile("concepts", otherCandidate);
    otherMemory.entity.names.push("Other Alias");
    await writeFile(otherCandidate, serializeMemoryYaml(otherMemory.entity));
    const candidateBeforeValidation = await readFile(candidate, "utf8");
    const changePath = join(registry.projects.project.root, "changes", created.change.id, "change.json");
    const initialValidation = await validateMemoryChange(created.change.id);
    assert.deepEqual(initialValidation.issues, []);
    assert.deepEqual(await readdir(created.candidateRoot), ["concepts"]);
    assert.equal(await readFile(candidate, "utf8"), candidateBeforeValidation);
    const validatedChange = memoryChangeSetSchema.parse(JSON.parse(await readFile(changePath, "utf8")));
    assert.equal(validatedChange.store_type, "managed");
    assert.equal(validatedChange.checkpoint?.valid, true);
    assert.equal(validatedChange.checkpoint?.digest, initialValidation.checkpointDigest);
    assert.equal(validatedChange.checkpoint?.base_revision, validatedChange.base_revision);
    const checkpointRoot = join(
      registry.projects.project.root,
      "changes",
      created.change.id,
      "checkpoints",
      initialValidation.checkpointDigest,
      "memory"
    );
    assert.deepEqual(await readdir(checkpointRoot), ["concepts"]);
    assert.deepEqual((await readdir(join(checkpointRoot, "concepts"))).sort(), ["other.yaml", "shared.yaml"]);
    const repeatedValidation = await validateMemoryChange();
    assert.equal(repeatedValidation.changeId, created.change.id);
    assert.equal(repeatedValidation.checkpointDigest, initialValidation.checkpointDigest);
    assert.deepEqual(await readdir(join(registry.projects.project.root, "changes", created.change.id, "checkpoints")), [
      initialValidation.checkpointDigest
    ]);
    const competing = await editMemories({ references: ["concepts/competing-active"] });
    await assert.rejects(validateMemoryChange(), /multiple active Managed ChangeSets.*provide one explicitly/);
    await rm(join(competing.candidateRoot, ".."), { recursive: true, force: true });
    await rm(join(registry.projects.project.root, "changes", competing.change.id), { recursive: true, force: true });
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
    assert.equal(await checkpointWorkspaceChanges(), 1);
    await rm(created.candidateRoot, { recursive: true, force: true });
    assert.equal(await resumeMemoryChange(created.change.id), created.candidateRoot);
    const published = await publishMemoryChange(created.change.id);
    assert.equal(published.status, "completed");
    assert.match(published.published_revision ?? "", /^[0-9a-f]{40,64}$/);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Initial/);
    assert.deepEqual((await readMemoryFile("concepts", join(memoryRoot, "concepts", "other.yaml"))).entity.names, ["other", "Other Alias"]);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    const concurrentA = await editMemories({ references: ["concepts/concurrent-a"] });
    const concurrentB = await editMemories({ references: ["concepts/concurrent-b"] });
    await Promise.all([
      publishMemoryChange(concurrentA.change.id),
      publishMemoryChange(concurrentB.change.id)
    ]);
    assert.match(await readFile(join(memoryRoot, concurrentA.change.targets[0].path), "utf8"), /concurrent-a/);
    assert.match(await readFile(join(memoryRoot, concurrentB.change.targets[0].path), "utf8"), /concurrent-b/);
    assert.deepEqual((await readMemoryFile("concepts", join(memoryRoot, "concepts", "other.yaml"))).entity.names, ["other", "Other Alias"]);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    const dependent = await editMemories({ references: ["concepts/dependent"] });
    const dependentPath = join(dependent.candidateRoot, "concepts", "dependent.yaml");
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("defines: []", "defines:\n  - !ref\n    target: concepts/shared"));
    assert.deepEqual((await validateMemoryChange(dependent.change.id)).issues, []);
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("concepts/shared", "concepts/missing"));
    const missingReference = await validateMemoryChange(dependent.change.id);
    assert(missingReference.issues.some((issue) => issue.path === dependentPath && issue.message.includes("was not found")));
    const persistedMissingReference = memoryChangeSetSchema.parse(JSON.parse(await readFile(
      join(registry.projects.project.root, "changes", dependent.change.id, "change.json"),
      "utf8"
    )));
    assert(persistedMissingReference.checkpoint?.issues.some((issue) => (
      issue.path === "concepts/dependent.yaml" && issue.message.includes("was not found")
    )));
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("concepts/missing", "concepts/shared"));
    await publishMemoryChange(dependent.change.id);
    assert.deepEqual((await readMemoryFile("concepts", join(memoryRoot, "concepts", "other.yaml"))).entity.names, ["other", "Other Alias"]);

    const deleted = await editMemories({ references: ["shared"], operation: "delete" });
    const deleteValidation = await validateMemoryChange(deleted.change.id);
    assert(deleteValidation.issues.some((issue) => issue.message.includes("was not found")));

    await assert.rejects(renameMemory({ reference: "concepts/Other Alias", newName: "other-renamed" }), /invalid Memory reference/);
    await assert.rejects(renameMemory({ reference: " concepts/other ", newName: "other-renamed" }), /surrounding whitespace/);
    const renamed = await renameMemory({ reference: "Other Alias", newName: "other-renamed" });
    assert.equal(renamed.change.targets[0]?.path, "concepts/other.yaml");
    assert.equal(renamed.change.targets[0]?.destination_path, undefined);
    assert.deepEqual((await validateMemoryChange(renamed.change.id)).issues, []);
    const renamedCandidate = join(renamed.candidateRoot, renamed.change.targets[0].path);
    const renamedSource = await readFile(renamedCandidate, "utf8");
    assert.match(renamedSource, /- other-renamed\n  - other\n  - Other Alias\n/);
    assert.equal((renamedSource.match(/other-renamed/g) ?? []).length, 1);
    await publishMemoryChange(renamed.change.id);
    assert.equal(await readFile(join(memoryRoot, "concepts", "other.yaml"), "utf8"), renamedSource);
    await assert.rejects(readFile(join(memoryRoot, "concepts", "other-alias.yaml")), /ENOENT/);

    await assert.rejects(renameMemory({ reference: "other", newName: "Renamed Other" }), /lowercase ASCII kebab-case/);
    const invalidRenameChange = await renameMemory({ reference: "other", newName: "renamed-other" });
    const invalidRenameCandidate = join(invalidRenameChange.candidateRoot, invalidRenameChange.change.targets[0].path);
    await writeFile(invalidRenameCandidate, "!concept\nnames: [Broken\n");
    const invalidRename = await validateMemoryChange(invalidRenameChange.change.id);
    assert(invalidRename.issues.some((issue) => issue.path === invalidRenameCandidate));

    const conflictingRename = await renameMemory({ reference: "Other Alias", newName: "shared" });
    const conflictingValidation = await validateMemoryChange(conflictingRename.change.id);
    assert(conflictingValidation.issues.some((issue) => issue.message.includes("conflicts within concepts")));
    await assert.rejects(publishMemoryChange(conflictingRename.change.id), /ChangeSet validation failed/);

    const duplicate = await editMemories({ references: ["concepts/duplicate"] });
    const duplicatePath = join(duplicate.candidateRoot, duplicate.change.targets[0].path);
    await writeFile(
      duplicatePath,
      (await readFile(duplicatePath, "utf8")).replace("duplicate", "shared").replace("defines: []", "defines: [Duplicate name]")
    );
    assert((await validateMemoryChange(duplicate.change.id)).issues.some((issue) => issue.message.includes("conflicts within concepts")));

    const missingCandidate = await editMemories({ references: ["concepts/missing-candidate"] });
    await rm(join(missingCandidate.candidateRoot, missingCandidate.change.targets[0].path));
    await assert.rejects(validateMemoryChange(missingCandidate.change.id), /candidate file is missing/);

    const diagnosedFailure = await editMemories({ references: ["concepts/diagnosed-failure"] });
    const diagnosedValidation = await validateMemoryChange(diagnosedFailure.change.id);
    assert.deepEqual(diagnosedValidation.issues, []);
    const failedChange = await failMemoryChange(
      diagnosedFailure.change.id,
      "validate",
      new Error("diagnostic summary\nprivate detail")
    );
    assert.equal(failedChange.status, "abandoned");
    assert.equal(failedChange.failure?.stage, "validate");
    assert.equal(failedChange.failure?.summary, "diagnostic summary");
    assert.equal(failedChange.checkpoint?.digest, diagnosedValidation.checkpointDigest);
    await assert.rejects(validateMemoryChange(diagnosedFailure.change.id), /already abandoned/);
    await assert.rejects(publishMemoryChange(diagnosedFailure.change.id), /already abandoned/);
    await assert.rejects(resumeMemoryChange(diagnosedFailure.change.id), /already abandoned/);
    await assert.rejects(editMemories({
      references: ["concepts/another-failure"],
      changeId: diagnosedFailure.change.id
    }), /already abandoned/);

    const first = await editMemories({ references: ["shared"] });
    const second = await editMemories({ references: ["shared"] });
    await writeFile(join(first.candidateRoot, "concepts", "shared.yaml"), (await readFile(join(first.candidateRoot, "concepts", "shared.yaml"), "utf8")).replace("Initial", "First"));
    await writeFile(join(second.candidateRoot, "concepts", "shared.yaml"), (await readFile(join(second.candidateRoot, "concepts", "shared.yaml"), "utf8")).replace("Initial", "Second"));
    assert.deepEqual((await validateMemoryChange(first.change.id)).issues, []);
    await publishMemoryChange(first.change.id);
    await assert.rejects(validateMemoryChange(second.change.id), /edit conflict/);
    await assert.rejects(publishMemoryChange(second.change.id), /edit conflict/);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /First/);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    await writeFile(join(memoryRoot, "concepts", "shared.yaml"), (await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8")).replace("First", "Outside"));
    const config = JSON.parse(await readFile(join(registry.projects.project.root, "config.json"), "utf8")) as {
      store: { branch: string; published_revision: string };
    };
    const catalog = new DefaultMemoryCatalog(new ProjectMemoryProvider([{
      name: "project",
      memoryRoot,
      revision: config.store.published_revision,
      managed: { branch: config.store.branch, publishedRevision: config.store.published_revision }
    }]));
    const listed = await catalog.list();
    assert.deepEqual(listed.memories.filter((item) => item.frozen).map((item) => item.names[0]).sort(), ["dependent", "shared"]);
    await assert.rejects(catalog.read("shared"), MemoryFrozenError);
    assert.equal((await catalog.read("Other Alias")).names[0], "other-renamed");

    const recovered = await recoverMemory("shared", "create-change");
    assert(recovered.change && recovered.candidateRoot);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /First/);
    assert.match(await readFile(join(recovered.candidateRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    await publishMemoryChange(recovered.change.id);
    await writeFile(join(memoryRoot, "concepts", "shared.yaml"), (await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8")).replace("Outside", "Discard"));
    await recoverMemory("shared", "restore");
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    if (process.platform !== "win32") {
      const workspaceChangesRoot = join(workspace, ".memsphere-work", "changes");
      await writeFile(
        join(memoryRoot, "concepts", "shared.yaml"),
        (await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8")).replace("Outside", "Recovery Failure")
      );
      await chmod(workspaceChangesRoot, 0o555);
      try {
        await assert.rejects(recoverMemory("shared", "create-change"), /EACCES|permission denied/);
      } finally {
        await chmod(workspaceChangesRoot, 0o755);
      }
      assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Recovery Failure/);
      await recoverMemory("shared", "restore");

      const failed = await editMemories({ references: ["concepts/atomic-failure"] });
      const projectRoot = registry.projects.project.root;
      const configPath = join(projectRoot, "config.json");
      const revisionBefore = JSON.parse(await readFile(configPath, "utf8")).store.published_revision as string;
      await chmod(projectRoot, 0o555);
      try {
        await assert.rejects(publishMemoryChange(failed.change.id), /EACCES|permission denied/);
      } finally {
        await chmod(projectRoot, 0o755);
      }
      const revisionAfter = JSON.parse(await readFile(configPath, "utf8")).store.published_revision as string;
      const savedChange = JSON.parse(await readFile(
        join(projectRoot, "changes", failed.change.id, "change.json"),
        "utf8"
      )) as { status: string; published_revision?: string };
      assert.equal(await gitOutput(["rev-parse", "HEAD"], memoryRoot), revisionBefore);
      assert.equal(revisionAfter, revisionBefore);
      assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
      assert.equal(savedChange.status, "active");
      assert.equal(savedChange.published_revision, undefined);

      const auditFailed = await editMemories({ references: ["concepts/audit-failure"] });
      const auditChangeRoot = join(projectRoot, "changes", auditFailed.change.id);
      await chmod(auditChangeRoot, 0o555);
      try {
        await assert.rejects(publishMemoryChange(auditFailed.change.id), /EACCES|permission denied/);
      } finally {
        await chmod(auditChangeRoot, 0o755);
      }
      const configAfterAuditFailure = JSON.parse(await readFile(configPath, "utf8")).store.published_revision as string;
      const savedAuditChange = JSON.parse(await readFile(
        join(auditChangeRoot, "change.json"),
        "utf8"
      )) as { status: string; published_revision?: string };
      assert.equal(await gitOutput(["rev-parse", "HEAD"], memoryRoot), revisionBefore);
      assert.equal(configAfterAuditFailure, revisionBefore);
      assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
      assert.equal(savedAuditChange.status, "active");
      assert.equal(savedAuditChange.published_revision, undefined);
    }
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("ChangeSet metadata rejects path traversal", () => {
  assert.equal(memoryChangeSetSchema.safeParse({
    format_version: 1,
    id: "change-test",
    project: "project",
    workspace_key: "path:/workspace",
    base_revision: "abc123",
    status: "active",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    targets: [{
      operation: "update",
      reference: "concepts/test",
      path: "../../outside.yaml",
      base_digest: "digest",
      added_revision: "abc123"
    }]
  }).success, false);
});

test("ChangeSet metadata accepts only the active lifecycle vocabulary", () => {
  const base = {
    format_version: 1 as const,
    id: "change-lifecycle",
    project: "project",
    workspace_key: "path:/workspace",
    base_revision: "abc123",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    targets: []
  };
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "active" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "completed" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "abandoned" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "draft" }).success, false);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "published" }).success, false);
});
