import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { withNewProjectDirectory, assertProjectPrepared, projectPreparationPath } from "../src/project/preparation.js";
import { readProjectRegistry, updateProjectRegistry } from "../src/project/registry.js";
import { homePaths } from "../src/home.js";
import { resolveRegisteredProject } from "../src/project/resolver.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-project-preparation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, "home");
  await mkdir(home);
  return { directory, home, root: join(directory, "project") };
}

test("Only the creating call sees an unpublished Project; other calls cannot use or register it", async t => {
  const f = await fixture(t);
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  const creation = withNewProjectDirectory(f.home, "new-project", f.root, async () => {
    assert.equal((await readProjectRegistry(f.home)).projects["new-project"].root, await realpath(f.root));
    await assertProjectPrepared(f.root);
    await writeFile(join(f.root, "project.json"), JSON.stringify({ format_version: 1, name: "new-project", created_at: new Date().toISOString() }));
    await writeFile(join(f.root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
    // Registry writes must never persist the private bootstrap overlay.
    await updateProjectRegistry(f.home, () => {});
    ready(); await resumed;
    await updateProjectRegistry(f.home, registry => { registry.projects["new-project"] = { root: f.root }; });
  });
  await started;
  try {
    assert.equal((await readProjectRegistry(f.home)).projects["new-project"], undefined);
    assert.equal(JSON.parse(await readFile(homePaths(f.home).registryPath, "utf8")).projects["new-project"], undefined);
    await assert.rejects(assertProjectPrepared(f.root), { code: "PROJECT_PREPARATION_PENDING" });
    await assert.rejects(resolveRegisteredProject("new-project", { "new-project": { root: f.root } }), { code: "PROJECT_PREPARATION_PENDING" });
    await assert.rejects(withNewProjectDirectory(f.home, "new-project", f.root, async () => assert.fail()), { code: "EEXIST" });
    assert.equal((await readFile(projectPreparationPath(f.root), "utf8")).length > 0, true);
  } finally { release(); await creation; }
  await assertProjectPrepared(f.root);
  assert.equal((await resolveRegisteredProject("new-project", (await readProjectRegistry(f.home)).projects)).paths.root, await realpath(f.root));
});

test("Failed preparation removes only its own directory and never registers a Project", async t => {
  const f = await fixture(t);
  await assert.rejects(withNewProjectDirectory(f.home, "failed", f.root, async () => { throw Error("bootstrap failed"); }), /bootstrap failed/);
  await assert.rejects(readFile(projectPreparationPath(f.root)), { code: "ENOENT" });
  assert.equal((await readProjectRegistry(f.home)).projects.failed, undefined);
  await mkdir(f.root);
  await writeFile(join(f.root, "keep"), "existing root");
  await assert.rejects(withNewProjectDirectory(f.home, "failed", f.root, async () => {}), { code: "EEXIST" });
  assert.equal(await readFile(join(f.root, "keep"), "utf8"), "existing root");
});

test("Cleanup preserves a directory that replaced the original preparation", async t => {
  const f = await fixture(t);
  await assert.rejects(withNewProjectDirectory(f.home, "replaced", f.root, async () => {
    await rm(f.root, { recursive: true }); await mkdir(f.root);
    await writeFile(join(f.root, "keep"), "replacement");
    throw Error("interrupted");
  }), /interrupted/);
  assert.equal(await readFile(join(f.root, "keep"), "utf8"), "replacement");
});


test("Concurrent registration checks the name and workspace binding inside the Registry update", async t => {
  const f = await fixture(t);
  const previousHome = process.env.MEMSPHERE_HOME;
  process.env.MEMSPHERE_HOME = f.home;
  try {
    const { projectRegisterCommand } = await import("../src/commands/project.js");
    const roots = [f.root, join(f.directory, "other-project")];
    for (const [index, root] of roots.entries()) {
      await mkdir(root);
      await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: `registered-${index}`, created_at: new Date().toISOString() }));
      await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
    }
    const results = await Promise.allSettled(roots.map(root => projectRegisterCommand(root, { bind: true })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(Object.keys((await readProjectRegistry(f.home)).projects).length, 1);
    assert.equal(Object.keys((await readProjectRegistry(f.home)).workspaces).length, 1);
    for (const root of roots) assert.match(await readFile(join(root, "project.json"), "utf8"), /registered-/);
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
  }
});


test("Private bootstrap resolves a Project through an aliased parent directory", async t => {
  const f = await fixture(t);
  const alias = join(f.directory, "alias");
  await symlink(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
  const root = join(alias, "project");
  await withNewProjectDirectory(f.home, "aliased", root, async () => {
    const registry = await readProjectRegistry(f.home);
    assert.equal(registry.projects.aliased.root, await realpath(f.root));
    await assertProjectPrepared(f.root);
  });
  await assertProjectPrepared(f.root);
});

test("An error reported after Registry publication preserves the published Project", async t => {
  const f = await fixture(t);
  await assert.rejects(withNewProjectDirectory(f.home, "published", f.root, async () => {
    await writeFile(join(f.root, "keep"), "published content");
    await updateProjectRegistry(f.home, registry => { registry.projects.published = { root: f.root }; });
    throw Error("publication reported failure");
  }), /publication reported failure/);
  assert.equal(await readFile(join(f.root, "keep"), "utf8"), "published content");
  await assertProjectPrepared(f.root);
});
