import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProjectConfig } from "../src/config.js";
import { runGit } from "../src/git.js";
import { projectConfigSchema } from "../src/project/model.js";
import { resolveProjectContext } from "../src/project/resolver.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { editEmbeddedMemories } from "../src/memory/changeset.js";

test("Embedded Projects resolve workspace Memory for CLI and canonical Memory for View", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-embedded-resolver-"));
  const home = join(fixture, "home");
  const main = join(fixture, "main");
  const linked = join(fixture, "linked");
  const projectRoot = join(home, "projects", "embedded");
  const memoryRelative = ".memsphere/memory";
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME };
  try {
    await mkdir(join(main, memoryRelative, "concepts"), { recursive: true });
    for (const kind of ["statements", "procedures", "schemas"]) {
      await mkdir(join(main, memoryRelative, kind), { recursive: true });
    }
    await writeFile(
      join(main, memoryRelative, "concepts", "source.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [source]\ndefines: [main]\n")
    );
    await runGit(["init", "-b", "master"], { cwd: main });
    await runGit(["add", ".memsphere"], { cwd: main });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"], { cwd: main });
    await runGit(["worktree", "add", "-b", "feature", linked], { cwd: main });
    const canonicalMain = await realpath(main);
    const canonicalLinked = await realpath(linked);
    await writeFile(
      join(linked, memoryRelative, "concepts", "source.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [source]\ndefines: [linked]\n")
    );

    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "project.json"), `${JSON.stringify({
      format_version: 1,
      name: "embedded",
      created_at: new Date().toISOString()
    })}\n`);
    await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: main, memory_path: memoryRelative }
    })}\n`);
    const workspace = await resolveWorkspaceIdentity(main);
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: { embedded: { root: projectRoot } },
      workspaces: { [workspace.key]: { primary: "embedded", mounted: [] } }
    })}\n`);

    const linkedContext = await resolveProjectContext({ home, cwd: linked });
    assert.equal(linkedContext.primary.memoryRoot, join(canonicalLinked, memoryRelative));
    assert.match(await readFile(join(linkedContext.primary.memoryRoot, "concepts", "source.yaml"), "utf8"), /linked/);

    const canonical = await readProjectConfig("embedded", home);
    assert.equal(canonical.memoryRoot, join(canonicalMain, memoryRelative));
    assert.match(await readFile(join(canonical.memoryRoot, "concepts", "source.yaml"), "utf8"), /main/);

    await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: linked, memory_path: memoryRelative }
    })}\n`);
    await assert.rejects(readProjectConfig("embedded", home), /must point to the Git main worktree/);
    await assert.rejects(resolveProjectContext({ home, cwd: linked }), /must point to the Git main worktree/);
    await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: main, memory_path: memoryRelative }
    })}\n`);

    process.env.MEMSPHERE_HOME = home;
    process.chdir(linked);
    const edit = await editEmbeddedMemories(["concepts/linked-only"]);
    assert.equal(edit.memoryRoot, join(canonicalLinked, memoryRelative));
    assert.match(await readFile(join(linked, memoryRelative, "concepts", "linked-only.yaml"), "utf8"), /linked-only/);
    await assert.rejects(readFile(join(main, memoryRelative, "concepts", "linked-only.yaml")), /ENOENT/);
    process.chdir(previous.cwd);

    const other = join(fixture, "other");
    await mkdir(other);
    await runGit(["init", "-b", "master"], { cwd: other });
    await assert.rejects(
      resolveProjectContext({ home, cwd: other, project: "embedded" }),
      /only be used by worktrees of its own Git repository/
    );

    await rm(join(linked, ".memsphere"), { recursive: true, force: true });
    assert.equal((await resolveProjectContext({ home, cwd: linked })).primary.memoryRoot, join(canonicalLinked, memoryRelative));

    if (process.platform !== "win32") {
      const outside = join(fixture, "outside-memory");
      await mkdir(outside);
      await symlink(outside, join(linked, ".memsphere"), "dir");
      await assert.rejects(
        resolveProjectContext({ home, cwd: linked }),
        /symbolic link/
      );
      process.chdir(linked);
      await assert.rejects(editEmbeddedMemories(["concepts/escaped"]), /symbolic link/);
      process.chdir(previous.cwd);
      await rm(join(linked, ".memsphere"), { force: true });

      const canonicalLink = join(main, ".canonical-link");
      await symlink(outside, canonicalLink, "dir");
      await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
        store: { type: "embedded", repository_path: main, memory_path: ".canonical-link/missing" }
      })}\n`);
      await assert.rejects(readProjectConfig("embedded", home), /symbolic link/);
    }
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Embedded Project config requires an absolute repository and relative Memory path", () => {
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "embedded", repository_path: "/repo", memory_path: ".memsphere/memory" }
  }).success, true);
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "embedded", memory_path: "/repo/.memsphere/memory" }
  }).success, false);
  for (const memoryPath of ["/absolute", "../escape", "nested/../memory", "nested\\memory"]) {
    assert.equal(projectConfigSchema.safeParse({
      store: { type: "embedded", repository_path: "/repo", memory_path: memoryPath }
    }).success, false, memoryPath);
  }
});
