import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homePaths, resolveMemsphereHome } from "../../src/home.js";
import { memoryKinds } from "../../src/memory/kinds.js";
import { projectPaths } from "../../src/project/paths.js";
import { initializeProjectModelRegistrations } from "../../src/project/model-registration.js";
import { updateProjectRegistry } from "../../src/project/registry.js";
import { resolveWorkspaceIdentity } from "../../src/project/workspace.js";
import { readBundledSystemMemories } from "../../src/reserved/store.js";
import { runGit } from "../../src/git.js";

let systemFiles: Promise<{ path: string; bytes: Buffer }[]> | undefined;

/** Construct an existing healthy Store; Project creation/bootstrap is tested separately. */
export async function managedProjectFixture(name: string, options: { bind?: boolean } = {}): Promise<void> {
  if (!process.env.MEMSPHERE_HOME) throw new Error("Project fixtures require an isolated MEMSPHERE_HOME");
  const home = resolveMemsphereHome();
  const root = join(homePaths(home).projectsRoot, name);
  const paths = projectPaths(root);
  await Promise.all([paths.changesRoot, paths.runsRoot, paths.archiveRoot, paths.evalsRoot, paths.runtimeRoot,
    ...memoryKinds.map(kind => join(paths.memoryRoot, kind))].map(path => mkdir(path, { recursive: true })));
  await writeFile(paths.manifestPath, JSON.stringify({ format_version: 1, name, created_at: "2026-10-06T00:00:00.000Z" }));
  await writeFile(paths.configPath, JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
  await initializeProjectModelRegistrations({}, { root });
  systemFiles ??= readBundledSystemMemories().then(files => Promise.all(files.map(async file => ({
    path: file.path, bytes: await readFile(file.sourcePath)
  }))));
  await Promise.all((await systemFiles).map(async file => {
    const path = join(paths.memoryRoot, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }));
  await runGit(["init", "-b", "master"], { cwd: paths.memoryRoot });
  await runGit(["add", "."], { cwd: paths.memoryRoot });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Existing Store fixture"], { cwd: paths.memoryRoot });
  const config = JSON.parse(await readFile(paths.configPath, "utf8"));
  config.store.published_revision = (await runGit(["rev-parse", "HEAD"], { cwd: paths.memoryRoot })).stdout;
  await writeFile(paths.configPath, JSON.stringify(config));
  const workspace = options.bind ? await resolveWorkspaceIdentity() : undefined;
  await updateProjectRegistry(home, registry => {
    registry.projects[name] = { root };
    if (workspace) registry.workspaces[workspace.key] = { primary: name, mounted: [] };
  });
}
