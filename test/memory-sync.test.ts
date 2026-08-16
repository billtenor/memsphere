import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCloneCommand } from "../src/commands/project.js";
import { editMemories, publishMemoryChange, syncMemory } from "../src/memory/changeset.js";
import { runGit } from "../src/git.js";
import { readProjectRegistry } from "../src/project/registry.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Memory sync creates merge commits and isolates conflicts in a Sync ChangeSet", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-sync-"));
  const seed = join(fixture, "seed");
  const remote = join(fixture, "remote.git");
  const workspace = join(fixture, "workspace");
  const organization = join(fixture, "organization");
  const home = join(fixture, "home");
  const gitConfig = join(fixture, "gitconfig");
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, gitConfig: process.env.GIT_CONFIG_GLOBAL };
  try {
    await mkdir(seed);
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    await runGit(["init", "-b", "master"], { cwd: seed });
    for (const [kind, source] of Object.entries({
      concepts: withCurrentMemorySyntax("!concept\nnames: [Shared]\ndefines: [Base]\n"),
      statements: withCurrentMemorySyntax("!statement\nnames: [Rules]\nasserts: [Base]\n"),
      schemas: withCurrentMemorySyntax("!schema\nnames: [Shape]\ndefines: []\n"),
      procedures: withCurrentMemorySyntax("!procedure\nnames: [Flow]\nflow: []\n")
    })) {
      await mkdir(join(seed, kind));
      await writeFile(join(seed, kind, "fixture.yaml"), source);
    }
    await runGit(["add", "-A"], { cwd: seed });
    await runGit(["commit", "-m", "seed"], { cwd: seed });
    await runGit(["branch", "users/test"], { cwd: seed });
    await runGit(["init", "--bare", remote]);
    await runGit(["remote", "add", "origin", remote], { cwd: seed });
    await runGit(["push", "origin", "master", "users/test"], { cwd: seed });
    await runGit(["clone", remote, organization]);

    process.env.MEMSPHERE_HOME = home;
    process.chdir(workspace);
    await projectCloneCommand(remote, { name: "shared", branch: "users/test", upstream: "origin/master", bind: true });
    const registry = await readProjectRegistry(home);
    const memoryRoot = join(registry.projects.shared.root, "memory");

    await writeFile(join(organization, "statements", "fixture.yaml"), (await readFile(join(organization, "statements", "fixture.yaml"), "utf8")).replace("Base", "Organization"));
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "organization update"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });
    const merged = await syncMemory();
    assert(merged.revision);
    assert.equal((await runGit(["rev-list", "--parents", "-n", "1", merged.revision], { cwd: memoryRoot })).stdout.split(" ").length, 3);

    const local = await editMemories({ references: ["Shared"] });
    const localPath = join(local.candidateRoot, "concepts", "fixture.yaml");
    await writeFile(localPath, (await readFile(localPath, "utf8")).replace("Base", "Personal"));
    await publishMemoryChange(local.change.id);
    await writeFile(join(organization, "concepts", "fixture.yaml"), (await readFile(join(organization, "concepts", "fixture.yaml"), "utf8")).replace("Base", "Team"));
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "conflicting organization update"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });

    const conflict = await syncMemory();
    assert(conflict.change?.merge_parent && conflict.candidateRoot);
    const conflictPath = join(conflict.candidateRoot, "concepts", "fixture.yaml");
    assert.match(await readFile(conflictPath, "utf8"), /<<<<<<<|>>>>>>>/);
    await writeFile(conflictPath, withCurrentMemorySyntax("!concept\nnames: [Shared]\ndefines: [Merged]\n"));
    const resolved = await publishMemoryChange(conflict.change.id, "Resolve Memory sync");
    assert(resolved.published_revision);
    assert.equal((await runGit(["rev-list", "--parents", "-n", "1", resolved.published_revision], { cwd: memoryRoot })).stdout.split(" ").length, 3);
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
