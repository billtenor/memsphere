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

    const explicit = await editMemories({
      references: ["concepts/Explicit Path"],
      createPaths: new Map([["concepts/Explicit Path", "concepts/human-readable.yaml"]])
    });
    assert.equal(explicit.change.targets[0]?.path, "concepts/human-readable.yaml");
    assert.match(await readFile(join(explicit.candidateRoot, "concepts", "human-readable.yaml"), "utf8"), /Explicit Path/);
    await publishMemoryChange(explicit.change.id);
    await assert.rejects(
      editMemories({
        references: ["concepts/Occupied Path"],
        createPaths: new Map([["concepts/Occupied Path", "concepts/human-readable.yaml"]])
      }),
      /explicit create path already exists/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/Unsafe"],
        createPaths: new Map([["concepts/Unsafe", "../concepts/unsafe.yaml"]])
      }),
      /invalid or escaping Memory path/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/Wrong Kind"],
        createPaths: new Map([["concepts/Wrong Kind", "procedures/wrong-kind.yaml"]])
      }),
      /kind does not match/
    );
    await assert.rejects(
      editMemories({
        references: ["concepts/First Path Owner", "concepts/Second Path Owner"],
        createPaths: new Map([
          ["concepts/First Path Owner", "concepts/shared-target.yaml"],
          ["concepts/Second Path Owner", "concepts/shared-target.yaml"]
        ])
      }),
      /path is targeted by multiple references/
    );

    const created = await editMemories({ references: ["concepts/Shared", "concepts/Other"] });
    const candidate = join(created.candidateRoot, "concepts", "shared.yaml");
    await writeFile(candidate, (await readFile(candidate, "utf8")).replace("defines: []", "defines: [Initial]"));
    const otherCandidate = join(created.candidateRoot, "concepts", "other.yaml");
    await writeFile(otherCandidate, (await readFile(otherCandidate, "utf8")).replace(
      "  - \"Other\"\n",
      "  - \"Other\"\n  - \"Other Alias\"\n"
    ));
    const candidateBeforeValidation = await readFile(candidate, "utf8");
    const changePath = join(registry.projects.project.root, "changes", created.change.id, "change.json");
    const changeBeforeValidation = await readFile(changePath, "utf8");
    const initialValidation = await validateMemoryChange(created.change.id);
    assert.deepEqual(initialValidation.issues, []);
    assert.deepEqual(await readdir(created.candidateRoot), ["concepts"]);
    assert.equal(await readFile(candidate, "utf8"), candidateBeforeValidation);
    assert.equal(await readFile(changePath, "utf8"), changeBeforeValidation);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
    assert.equal(await checkpointWorkspaceChanges(), 1);
    await rm(created.candidateRoot, { recursive: true, force: true });
    assert.equal(await resumeMemoryChange(created.change.id), created.candidateRoot);
    const published = await publishMemoryChange(created.change.id);
    assert.match(published.published_revision ?? "", /^[0-9a-f]{40,64}$/);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Initial/);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    const dependent = await editMemories({ references: ["concepts/Dependent"] });
    const dependentPath = join(dependent.candidateRoot, "concepts", "dependent.yaml");
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("defines: []", "defines:\n  - !ref\n    target: concepts/Shared"));
    assert.deepEqual((await validateMemoryChange(dependent.change.id)).issues, []);
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("concepts/Shared", "concepts/Missing"));
    const missingReference = await validateMemoryChange(dependent.change.id);
    assert(missingReference.issues.some((issue) => issue.path === dependentPath && issue.message.includes("was not found")));
    await writeFile(dependentPath, (await readFile(dependentPath, "utf8")).replace("concepts/Missing", "concepts/Shared"));
    await publishMemoryChange(dependent.change.id);

    const deleted = await editMemories({ references: ["Shared"], operation: "delete" });
    const deleteValidation = await validateMemoryChange(deleted.change.id);
    assert(deleteValidation.issues.some((issue) => issue.message.includes("was not found")));

    const renamed = await renameMemory({ reference: "concepts/Other Alias", newName: "Other Alias" });
    assert.equal(renamed.change.targets[0]?.path, "concepts/other.yaml");
    assert.equal(renamed.change.targets[0]?.destination_path, undefined);
    assert.deepEqual((await validateMemoryChange(renamed.change.id)).issues, []);
    const renamedCandidate = join(renamed.candidateRoot, renamed.change.targets[0].path);
    const renamedSource = await readFile(renamedCandidate, "utf8");
    assert.match(renamedSource, /- Other Alias\n  - Other\n/);
    assert.equal((renamedSource.match(/Other Alias/g) ?? []).length, 1);
    await publishMemoryChange(renamed.change.id);
    assert.equal(await readFile(join(memoryRoot, "concepts", "other.yaml"), "utf8"), renamedSource);
    await assert.rejects(readFile(join(memoryRoot, "concepts", "other-alias.yaml")), /ENOENT/);

    const invalidRenameChange = await renameMemory({ reference: "Other", newName: "Renamed Other" });
    const invalidRenameCandidate = join(invalidRenameChange.candidateRoot, invalidRenameChange.change.targets[0].path);
    await writeFile(invalidRenameCandidate, "!concept\nnames: [Broken\n");
    const invalidRename = await validateMemoryChange(invalidRenameChange.change.id);
    assert(invalidRename.issues.some((issue) => issue.path === invalidRenameCandidate));

    const conflictingRename = await renameMemory({ reference: "Other Alias", newName: "Shared" });
    const conflictingValidation = await validateMemoryChange(conflictingRename.change.id);
    assert(conflictingValidation.issues.some((issue) => issue.message.includes("conflicts within concepts")));
    await assert.rejects(publishMemoryChange(conflictingRename.change.id), /ChangeSet validation failed/);

    const duplicate = await editMemories({ references: ["concepts/Duplicate"] });
    const duplicatePath = join(duplicate.candidateRoot, duplicate.change.targets[0].path);
    await writeFile(
      duplicatePath,
      (await readFile(duplicatePath, "utf8")).replace("Duplicate", "Shared").replace("defines: []", "defines: [Duplicate name]")
    );
    assert((await validateMemoryChange(duplicate.change.id)).issues.some((issue) => issue.message.includes("conflicts within concepts")));

    const missingCandidate = await editMemories({ references: ["concepts/Missing Candidate"] });
    await rm(join(missingCandidate.candidateRoot, missingCandidate.change.targets[0].path));
    await assert.rejects(validateMemoryChange(missingCandidate.change.id), /candidate file is missing/);

    const first = await editMemories({ references: ["Shared"] });
    const second = await editMemories({ references: ["Shared"] });
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
    assert.deepEqual(listed.memories.filter((item) => item.frozen).map((item) => item.names[0]).sort(), ["Dependent", "Shared"]);
    await assert.rejects(catalog.read("Shared"), MemoryFrozenError);
    assert.equal((await catalog.read("Other")).names[0], "Other Alias");

    const recovered = await recoverMemory("Shared", "create-change");
    assert(recovered.change && recovered.candidateRoot);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /First/);
    assert.match(await readFile(join(recovered.candidateRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    await publishMemoryChange(recovered.change.id);
    await writeFile(join(memoryRoot, "concepts", "shared.yaml"), (await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8")).replace("Outside", "Discard"));
    await recoverMemory("Shared", "restore");
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    if (process.platform !== "win32") {
      const failed = await editMemories({ references: ["concepts/Atomic Failure"] });
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
      assert.equal(savedChange.status, "draft");
      assert.equal(savedChange.published_revision, undefined);

      const auditFailed = await editMemories({ references: ["concepts/Audit Failure"] });
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
      assert.equal(savedAuditChange.status, "draft");
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
    status: "draft",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    targets: [{
      operation: "update",
      reference: "concepts/Test",
      path: "../../outside.yaml",
      base_digest: "digest",
      added_revision: "abc123"
    }]
  }).success, false);
});
