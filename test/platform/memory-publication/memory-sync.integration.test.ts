import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withMemoryWriteAccess } from "../../../src/memory/write-access.js";
import { memorySyncPublishCommand } from "../../../src/commands/memory.js";
import { projectCloneCommand } from "../../../src/commands/project.js";
import { editMemories, publishMemoryChange, syncMemory, validateMemoryChange } from "../../../src/memory/changeset.js";
import { gitOutput, runGit } from "../../../src/git.js";
import { withFileLock } from "../../../src/persistence.js";
import { readProjectRegistry } from "../../../src/project/registry.js";
import { withCurrentMemorySyntax } from "../../helpers/memory.js";

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
      concepts: withCurrentMemorySyntax("!concept\nnames: [shared, Shared]\ndefines: [Base]\n"),
      statements: withCurrentMemorySyntax("!statement\nnames: [rules, Rules]\nasserts: [Base]\n"),
      schemas: withCurrentMemorySyntax("!schema\nnames: [shape, Shape]\ndefines: []\n"),
      procedures: withCurrentMemorySyntax("!procedure\nnames: [flow, Flow]\nflow: []\n")
    })) {
      await mkdir(join(seed, kind));
      await writeFile(join(seed, kind, "fixture.yaml"), source);
    }
    await writeFile(
      join(seed, "statements", "retained.yaml"),
      withCurrentMemorySyntax("!statement\nnames: [retained-rules, Retained Rules]\nasserts: [Retained]\n")
    );
    await writeFile(
      join(seed, "schemas", "retained.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [retained-shape, Retained Shape]\ndefines: []\n")
    );
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
    const projectRoot = registry.projects.shared.root;
    const memoryRoot = join(projectRoot, "memory");

    const ordinary = await editMemories({ references: ["Rules"] });
    const headBeforeRejectedPublish = (await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot })).stdout;
    const configBeforeRejectedPublish = await readFile(join(projectRoot, "config.json"), "utf8");
    await assert.rejects(
      memorySyncPublishCommand({ change: ordinary.change.id }),
      /is not a Sync ChangeSet/
    );
    assert.equal((await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot })).stdout, headBeforeRejectedPublish);
    assert.equal(await readFile(join(projectRoot, "config.json"), "utf8"), configBeforeRejectedPublish);
    const rejectedChange = JSON.parse(
      await readFile(join(projectRoot, "changes", ordinary.change.id, "change.json"), "utf8")
    ) as { status: string; published_revision?: string };
    assert.equal(rejectedChange.status, "active");
    assert.equal(rejectedChange.published_revision, undefined);

    await writeFile(join(organization, "statements", "fixture.yaml"), (await readFile(join(organization, "statements", "fixture.yaml"), "utf8")).replace("Base", "Organization"));
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "organization update"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });
    if (process.platform !== "win32") {
      const configPath = join(projectRoot, "config.json");
      const revisionBefore = JSON.parse(await readFile(configPath, "utf8")).store.published_revision as string;
      await chmod(projectRoot, 0o555);
      try {
        await assert.rejects(syncMemory(), /EACCES|permission denied/);
      } finally {
        await chmod(projectRoot, 0o755);
      }
      assert.equal(await gitOutput(["rev-parse", "HEAD"], memoryRoot), revisionBefore);
      assert.equal(JSON.parse(await readFile(configPath, "utf8")).store.published_revision, revisionBefore);
      assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");
    }
    await withMemoryWriteAccess(memoryRoot, async () => {
      await assert.rejects(syncMemory(), { code: "MEMORY_PUBLISH_BUSY" });
    });
    const entry = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
    const preload = join(fixture, "fail-stdout.mjs");
    await writeFile(preload, 'process.stdout.write = (_chunk, callback) => { setImmediate(() => callback(new Error("closed"))); return false; };');
    function call(args: string[], failOutput = false) {
      const result = spawnSync(process.execPath, [entry, "--project", "shared", ...args], {
        cwd: workspace, env: { ...process.env, ...(failOutput ? { NODE_OPTIONS: "--import=" + pathToFileURL(preload).href } : {}) },
        timeout: 30000, encoding: "utf8"
      });
      assert.ifError(result.error);
      assert.equal(result.status, failOutput ? 1 : 0, result.stderr);
      assert.equal(failOutput ? result.stdout : result.stderr, "");
      return failOutput ? JSON.parse(result.stderr).error : result.stdout;
    }
    const sync = await withFileLock(join(projectRoot, ".runtime", "memory-publish.lock"),
      async () => call(["memory", "sync", "--output", "json"], true));
    const revision = await gitOutput(["rev-parse", "HEAD"], memoryRoot);
    const inspect = { kind: "command", launcher: "memsphere", args: ["project", "show", "shared"] };
    assert.deepEqual(sync, { code: "OUTPUT_RENDER_FAILED", details: { savedId: revision }, nextAction: inspect });
    assert.equal(JSON.parse(call([...inspect.args, "--output", "json"])).revision, revision);
    assert.equal((await runGit(["rev-list", "--parents", "-n", "1", revision], { cwd: memoryRoot })).stdout.split(" ").length, 3);
    assert.deepEqual(JSON.parse(call(["memory", "sync", "--output", "json"])), { status: "synchronized", revision });
    assert.ok(call(["memory", "sync"]).includes(revision));
    const original = await readFile(join(memoryRoot, "concepts", "fixture.yaml"), "utf8");
    await writeFile(join(memoryRoot, "concepts", "fixture.yaml"), original + "# local edit\n");
    const restored = call(["memory", "recover", "Shared", "--restore", "--output", "json"], true);
    assert.deepEqual(restored, { code: "OUTPUT_RENDER_FAILED", details: { savedId: "Shared" }, nextAction: inspect });
    assert.equal(JSON.parse(call([...inspect.args, "--output", "json"])).health.status, "ok");
    assert.equal(await readFile(join(memoryRoot, "concepts", "fixture.yaml"), "utf8"), original);
    assert.equal(await gitOutput(["rev-parse", "HEAD"], memoryRoot), revision);

    await writeFile(join(memoryRoot, "concepts", "fixture.yaml"), original + "# recovered edit\n");
    const recovered = JSON.parse(call(["memory", "recover", "Shared", "--create-change", "--output", "json"]));
    assert.equal(recovered.status, "ready");
    assert.equal(await readFile(join(memoryRoot, "concepts", "fixture.yaml"), "utf8"), original);
    assert.match(await readFile(join(recovered.candidateRoot, "concepts", "fixture.yaml"), "utf8"), /recovered edit/);
    const local = await editMemories({ references: ["Shared"] });
    const localPath = join(local.candidateRoot, "concepts", "fixture.yaml");
    await writeFile(localPath, (await readFile(localPath, "utf8")).replace("Base", "Personal"));
    const published = JSON.parse(call(["memory", "publish", "--change", local.change.id, "--output", "json"]));
    assert.equal(published.status, "published");
    assert.equal(published.revision, await gitOutput(["rev-parse", "HEAD"], memoryRoot));
    assert.deepEqual(JSON.parse(call(["memory", "push", "--output", "json"])), { status: "pushed", storeType: "managed" });
    assert.equal(await gitOutput(["rev-parse", "refs/heads/users/test"], remote), published.revision);
    await writeFile(join(organization, "concepts", "fixture.yaml"), (await readFile(join(organization, "concepts", "fixture.yaml"), "utf8")).replace("Base", "Team"));
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "conflicting organization update"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });

    const conflict = JSON.parse(call(["memory", "sync", "--output", "json"]));
    assert.equal(conflict.status, "ready");
    assert.ok(conflict.changeId && conflict.candidateRoot);
    assert.deepEqual(conflict.nextAction.args, ["memory", "change", "validate", "--change", conflict.changeId]);
    const conflictPath = join(conflict.candidateRoot, "concepts", "fixture.yaml");
    assert.match(await readFile(conflictPath, "utf8"), /<<<<<<<|>>>>>>>/);
    await writeFile(conflictPath, withCurrentMemorySyntax("!concept\nnames: [shared, Shared]\ndefines: [Merged]\n"));
    const resolved = JSON.parse(call(["memory", "sync", "publish", "--change", conflict.changeId,
      "--message", "Resolve Memory sync", "--output", "json"]));
    assert.equal(resolved.changeId, conflict.changeId);
    assert.equal(resolved.status, "published");
    assert.equal(resolved.revision, await gitOutput(["rev-parse", "HEAD"], memoryRoot));
    assert.equal((await runGit(["rev-list", "--parents", "-n", "1", resolved.revision], { cwd: memoryRoot })).stdout.split(" ").length, 3);
    assert.equal((await runGit(["status", "--porcelain"], { cwd: memoryRoot })).stdout, "");

    const localDelete = await editMemories({ references: ["Rules"], operation: "delete" });
    await publishMemoryChange(localDelete.change.id);
    await writeFile(
      join(organization, "statements", "fixture.yaml"),
      (await readFile(join(organization, "statements", "fixture.yaml"), "utf8")).replace("Organization", "Organization changed")
    );
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "modify locally deleted memory"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });

    const conflictText = call(["memory", "sync"]);
    const changeId = /changeId[:：] ?(change-[^\s]+)/.exec(conflictText)?.[1];
    const candidateRoot = /candidateRoot[:：] ?(.+)/.exec(conflictText)?.[1];
    assert.ok(changeId && candidateRoot);
    assert.ok(conflictText.includes("memory change validate --change " + changeId));
    const deletedLocally = { change: { id: changeId }, candidateRoot: candidateRoot.startsWith('"') ? JSON.parse(candidateRoot) : candidateRoot };
    const recreatedCandidate = join(deletedLocally.candidateRoot, "statements", "fixture.yaml");
    assert.match(await readFile(recreatedCandidate, "utf8"), /Organization changed/);
    assert.match(await readFile(recreatedCandidate, "utf8"), /<<<<<<< current \(deleted\)/);
    await rm(recreatedCandidate);
    assert.deepEqual((await validateMemoryChange(deletedLocally.change.id)).issues, []);
    const keptDeletion = await publishMemoryChange(deletedLocally.change.id, "Keep local Memory deletion");
    assert.equal(keptDeletion.targets[0]?.operation, "delete");
    await assert.rejects(readFile(join(memoryRoot, "statements", "fixture.yaml")), /ENOENT/);

    const localShape = await editMemories({ references: ["Shape"] });
    const localShapePath = join(localShape.candidateRoot, "schemas", "fixture.yaml");
    await writeFile(localShapePath, (await readFile(localShapePath, "utf8")).replace("defines: []", "defines: [Personal shape]"));
    await publishMemoryChange(localShape.change.id);
    await rm(join(organization, "schemas", "fixture.yaml"));
    await runGit(["add", "-A"], { cwd: organization });
    await runGit(["commit", "-m", "delete locally modified memory"], { cwd: organization });
    await runGit(["push", "origin", "master"], { cwd: organization });

    const deletedUpstream = await syncMemory();
    assert(deletedUpstream.change && deletedUpstream.candidateRoot);
    const deletedCandidate = join(deletedUpstream.candidateRoot, "schemas", "fixture.yaml");
    assert.match(await readFile(deletedCandidate, "utf8"), /Personal shape/);
    assert.match(await readFile(deletedCandidate, "utf8"), />>>>>>> upstream \(deleted\)/);
    await rm(deletedCandidate);
    assert.deepEqual((await validateMemoryChange(deletedUpstream.change.id)).issues, []);
    const acceptedDeletion = await publishMemoryChange(deletedUpstream.change.id, "Accept upstream Memory deletion");
    assert.equal(acceptedDeletion.targets[0]?.operation, "delete");
    await assert.rejects(readFile(join(memoryRoot, "schemas", "fixture.yaml")), /ENOENT/);
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
