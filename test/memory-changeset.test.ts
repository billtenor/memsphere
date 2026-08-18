import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCreateCommand } from "../src/commands/project.js";
import { runGit } from "../src/git.js";
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

    const created = await editMemories({ references: ["concepts/Shared", "concepts/Other"] });
    const candidate = join(created.candidateRoot, "concepts", "shared.yaml");
    await writeFile(candidate, (await readFile(candidate, "utf8")).replace("defines: []", "defines: [Initial]"));
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

    const renamed = await renameMemory({ reference: "Other", newName: "Renamed Other" });
    assert.deepEqual((await validateMemoryChange(renamed.change.id)).issues, []);
    const renamedCandidate = join(renamed.candidateRoot, renamed.change.targets[0].path);
    await writeFile(renamedCandidate, "!concept\nnames: [Broken\n");
    const invalidRename = await validateMemoryChange(renamed.change.id);
    assert(invalidRename.issues.some((issue) => issue.path === renamedCandidate));

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
    assert.equal((await catalog.read("Other")).names[0], "Other");

    const recovered = await recoverMemory("Shared", "create-change");
    assert(recovered.change && recovered.candidateRoot);
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /First/);
    assert.match(await readFile(join(recovered.candidateRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    await publishMemoryChange(recovered.change.id);
    await writeFile(join(memoryRoot, "concepts", "shared.yaml"), (await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8")).replace("Outside", "Discard"));
    await recoverMemory("Shared", "restore");
    assert.match(await readFile(join(memoryRoot, "concepts", "shared.yaml"), "utf8"), /Outside/);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
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
