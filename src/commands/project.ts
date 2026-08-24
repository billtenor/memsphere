import { cp, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homePaths, resolveMemsphereHome } from "../home.js";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { gitOutput, runGit } from "../git.js";
import { projectConfigSchema, projectManifestSchema, assertProjectName, type ProjectConfigFile } from "../project/model.js";
import { ensureMemoryDirectories } from "../validation.js";
import { projectPaths } from "../project/paths.js";
import { listRegisteredProjects, pathExists, readProjectRegistry, updateProjectRegistry } from "../project/registry.js";
import { resolveRegisteredProject } from "../project/resolver.js";
import { resolveMainWorkspacePath, resolveWorkspaceIdentity } from "../project/workspace.js";
import { editMemories, publishMemoryChange } from "../memory/changeset.js";
import { bundledReservedMemoryRoot, readBundledSystemMemories } from "../reserved/store.js";
import { assertWindowsPrerequisites } from "../windows-prerequisites.js";

type BindOption = { bind?: boolean };
type OutputOption = { output?: "text" | "json" };

export async function projectCreateCommand(
  nameInput: string,
  options: BindOption & { embedded?: string } = {}
): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const root = resolve(homePaths(home).projectsRoot, name);
  await withProjectLock(home, name, async () => {
    await preflightNewProject({ home, name, root, bind: options.bind });
    const stagingRoot = `${root}.creating-${process.pid}-${Date.now()}`;
    let moved = false;
    let registered = false;
    let registryWritten = false;
    try {
      const config = options.embedded
        ? await createEmbeddedProject(stagingRoot, options.embedded)
        : await createManagedProject(stagingRoot);
      await writeProjectMetadata(stagingRoot, name, config);
      await rename(stagingRoot, root);
      moved = true;
      await registerCreatedProject(home, name, root, options.bind);
      registryWritten = true;
      if (!options.embedded) await bootstrapManagedSystemMemory(name);
      registered = true;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (registryWritten && !registered) await rollbackCreatedRegistration(home, name, root);
      if (moved && !registered) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  console.log(`Created Project: ${name}`);
  console.log(`Project Root: ${root}`);
}

async function bootstrapManagedSystemMemory(projectName: string): Promise<void> {
  const sourceRoot = bundledReservedMemoryRoot();
  const memories = await readBundledSystemMemories(sourceRoot);
  const previous = process.env.MEMSPHERE_PROJECT;
  try {
    process.env.MEMSPHERE_PROJECT = projectName;
    const result = await editMemories({
      references: memories.map((memory) => memory.reference),
      createPaths: new Map(memories.map((memory) => [memory.reference, memory.path]))
    });
    for (const memory of memories) {
      const target = result.change.targets.find((candidate) => candidate.reference === memory.reference);
      if (!target) throw new Error(`bootstrap ChangeSet target is missing: ${memory.reference}`);
      await cp(resolve(sourceRoot, memory.path), resolve(result.candidateRoot, target.path));
    }
    await publishMemoryChange(result.change.id, "Bootstrap Memsphere system Memory");
    await rm(resolve(result.candidateRoot, ".."), { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous;
  }
}

async function rollbackCreatedRegistration(home: string, name: string, root: string): Promise<void> {
  await updateProjectRegistry(home, (registry) => {
    if (registry.projects[name]?.root === root) delete registry.projects[name];
    for (const [key, binding] of Object.entries(registry.workspaces)) {
      if (binding.primary === name) delete registry.workspaces[key];
      else binding.mounted = binding.mounted.filter((mounted) => mounted !== name);
    }
  }).catch(() => undefined);
}

export async function projectCloneCommand(
  source: string,
  options: BindOption & { name?: string; branch?: string; upstream?: string } = {}
): Promise<void> {
  const name = assertProjectName(options.name?.trim() ?? "");
  const home = resolveMemsphereHome();
  const root = resolve(homePaths(home).projectsRoot, name);
  await withProjectLock(home, name, async () => {
    await preflightNewProject({ home, name, root, bind: options.bind });
    const stagingRoot = `${root}.creating-${process.pid}-${Date.now()}`;
    let moved = false;
    let registered = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      const memoryRoot = projectPaths(stagingRoot).memoryRoot;
      const cloneArgs = ["clone", ...(options.branch ? ["--branch", options.branch] : []), "--", source, memoryRoot];
      await runGit(cloneArgs);
      const revision = await gitOutput(["rev-parse", "HEAD"], memoryRoot).catch(() => "");
      if (!revision) throw new Error("cannot clone a completely empty Memory repository; create its root commit first");
      const branch = options.branch ?? await gitOutput(["branch", "--show-current"], memoryRoot);
      if (!branch) throw new Error("cloned Memory repository is not on a branch");
      const validation = await import("../validation.js").then(({ validateMemoryRoot }) => validateMemoryRoot(memoryRoot));
      if (validation.issues.length > 0) throw new Error(`cloned repository is not a valid Memory Store: ${validation.issues[0].message}`);
      await writeProjectMetadata(stagingRoot, name, {
        store: { type: "managed", branch, ...(options.upstream ? { upstream: options.upstream } : {}), published_revision: revision }
      });
      await rename(stagingRoot, root);
      moved = true;
      await registerCreatedProject(home, name, root, options.bind);
      registered = true;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (moved && !registered) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  console.log(`Cloned Project: ${name}`);
  console.log(`Project Root: ${root}`);
}

export async function projectRegisterCommand(rootInput: string, options: BindOption = {}): Promise<void> {
  const root = await realpath(resolve(rootInput));
  const paths = projectPaths(root);
  const manifest = projectManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, "utf8")));
  projectConfigSchema.parse(JSON.parse(await readFile(paths.configPath, "utf8")));
  const home = resolveMemsphereHome();
  await withProjectLock(home, manifest.name, async () => {
    const registry = await readProjectRegistry(home);
    const existing = registry.projects[manifest.name];
    if (existing && await pathExists(existing.root)) {
      const current = await realpath(existing.root);
      if (current !== root) throw new Error(`Project "${manifest.name}" is already registered at ${current}`);
      throw new Error(`Project "${manifest.name}" is already registered`);
    }
    if (options.bind) await assertWorkspaceUnbound(registry);
    await registerCreatedProject(home, manifest.name, root, options.bind);
  });
  console.log(`Registered Project: ${manifest.name}`);
  console.log(`Project Root: ${root}`);
}

function withProjectLock<T>(home: string, name: string, action: () => Promise<T>): Promise<T> {
  return withFileLock(resolve(homePaths(home).runtimeRoot, "projects", `${name}.lock`), action);
}

export async function projectListCommand(options: OutputOption = {}): Promise<void> {
  const home = resolveMemsphereHome();
  const registry = await readProjectRegistry(home);
  const projects = await listRegisteredProjects(home);
  const workspace = await resolveWorkspaceIdentity();
  const binding = registry.workspaces[workspace.key];
  const result = projects.map((project) => ({
    ...project,
    primary: binding?.primary === project.name,
    mounted: binding?.mounted.includes(project.name) ?? false
  }));
  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.length === 0) {
    console.log("No registered Projects.");
    return;
  }
  for (const item of result) {
    const relation = item.primary ? "primary" : item.mounted ? "mounted" : "unbound";
    console.log(`${item.name}\t${item.missing ? "missing" : "available"}\t${relation}\t${item.root}`);
  }
}

export async function projectShowCommand(nameInput: string | undefined, options: OutputOption = {}): Promise<void> {
  const home = resolveMemsphereHome();
  const registry = await readProjectRegistry(home);
  const workspace = await resolveWorkspaceIdentity();
  const name = nameInput?.trim() || registry.workspaces[workspace.key]?.primary;
  if (!name) throw new Error("provide a Project name or bind the current Workspace");
  const project = await resolveRegisteredProject(name, registry.projects);
  const health = await projectHealth(project.memoryRoot, project.config);
  const effective = await resolveRegisteredProject(name, registry.projects, { workspace }).catch(() => undefined);
  const result = {
    name,
    root: project.paths.root,
    store: project.config.store,
    canonical_memory_root: project.memoryRoot,
    ...(effective ? { effective_memory_root: effective.memoryRoot } : {}),
    health
  };
  if (options.output === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Project: ${name}`);
    console.log(`Root: ${project.paths.root}`);
    console.log(`Store: ${project.config.store.type}`);
    console.log(`Canonical Memory Root: ${project.memoryRoot}`);
    if (effective) console.log(`Effective Memory Root: ${effective.memoryRoot}`);
    console.log(`Health: ${health.status}${health.detail ? ` (${health.detail})` : ""}`);
  }
}

export async function projectBindCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, async (registry) => {
    if (!registry.projects[name]) throw new Error(`Project "${name}" is not registered`);
    await assertProjectWorkspaceCompatible(await resolveRegisteredProject(name, registry.projects), workspace);
    const current = registry.workspaces[workspace.key];
    if (current) {
      throw new Error(
        `Workspace is already bound to Primary Project "${current.primary}"; run memsphere project unbind before binding another Project`
      );
    }
    registry.workspaces[workspace.key] = { primary: name, mounted: [] };
  });
  console.log(`Bound Workspace to Primary Project: ${name}`);
}

export async function projectUnbindCommand(): Promise<void> {
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, (registry) => {
    if (!registry.workspaces[workspace.key]) throw new Error("current Workspace is not bound");
    delete registry.workspaces[workspace.key];
  });
  console.log("Unbound current Workspace.");
}

export async function projectMountCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, async (registry) => {
    if (!registry.projects[name]) throw new Error(`Project "${name}" is not registered`);
    await assertProjectWorkspaceCompatible(await resolveRegisteredProject(name, registry.projects), workspace);
    const binding = registry.workspaces[workspace.key];
    if (!binding) throw new Error("current Workspace is not bound to a Primary Project");
    if (binding.primary === name) throw new Error(`Project "${name}" is already the Primary Project`);
    if (binding.mounted.includes(name)) throw new Error(`Project "${name}" is already mounted`);
    binding.mounted.push(name);
  });
  console.log(`Mounted read-only Project: ${name}`);
}

async function assertProjectWorkspaceCompatible(
  project: Awaited<ReturnType<typeof resolveRegisteredProject>>,
  workspace: Awaited<ReturnType<typeof resolveWorkspaceIdentity>>
): Promise<void> {
  if (project.config.store.type !== "embedded") return;
  const storeWorkspace = await resolveWorkspaceIdentity(project.config.store.repository_path);
  if (workspace.kind !== "git" || storeWorkspace.kind !== "git" || workspace.key !== storeWorkspace.key) {
    throw new Error(
      `Embedded Project "${project.name}" can only be used by worktrees of its own Git repository; use a Managed Project for cross-repository sharing`
    );
  }
}

export async function projectUnmountCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, (registry) => {
    const binding = registry.workspaces[workspace.key];
    if (!binding) throw new Error("current Workspace is not bound to a Primary Project");
    const index = binding.mounted.indexOf(name);
    if (index < 0) throw new Error(`Project "${name}" is not mounted`);
    binding.mounted.splice(index, 1);
  });
  console.log(`Unmounted Project: ${name}`);
}

export async function projectPruneCommand(): Promise<void> {
  const home = resolveMemsphereHome();
  const missing = new Set((await listRegisteredProjects(home)).filter((project) => project.missing).map((project) => project.name));
  await updateProjectRegistry(home, (registry) => {
    for (const name of missing) delete registry.projects[name];
    for (const [key, binding] of Object.entries(registry.workspaces)) {
      if (missing.has(binding.primary)) {
        delete registry.workspaces[key];
        continue;
      }
      binding.mounted = binding.mounted.filter((name) => !missing.has(name));
    }
  });
  console.log(`Pruned missing Projects: ${missing.size}`);
}

async function preflightNewProject(input: { home: string; name: string; root: string; bind?: boolean }): Promise<void> {
  await assertWindowsPrerequisites();
  const registry = await readProjectRegistry(input.home);
  if (registry.projects[input.name]) throw new Error(`Project "${input.name}" is already registered`);
  if (await pathExists(input.root)) throw new Error(`Project Root already exists: ${input.root}`);
  if (input.bind) await assertWorkspaceUnbound(registry);
  await mkdir(dirname(input.root), { recursive: true });
}

async function assertWorkspaceUnbound(registry: Awaited<ReturnType<typeof readProjectRegistry>>): Promise<void> {
  const workspace = await resolveWorkspaceIdentity();
  const binding = registry.workspaces[workspace.key];
  if (binding) throw new Error(`Workspace is already bound to Primary Project "${binding.primary}"`);
}

async function createManagedProject(root: string): Promise<ProjectConfigFile> {
  await assertGitIdentity();
  const paths = projectPaths(root);
  await mkdir(paths.memoryRoot, { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: paths.memoryRoot });
  await runGit(["commit", "--allow-empty", "-m", "Initialize Memsphere Memory Store"], { cwd: paths.memoryRoot });
  const revision = await gitOutput(["rev-parse", "HEAD"], paths.memoryRoot);
  await ensureMemoryDirectories(paths.memoryRoot);
  return { store: { type: "managed", branch: "master", published_revision: revision } };
}

async function createEmbeddedProject(root: string, memoryPathInput: string): Promise<ProjectConfigFile> {
  const memoryPath = await realpath(resolve(memoryPathInput));
  const workspace = await resolveWorkspaceIdentity(memoryPath);
  const current = await resolveWorkspaceIdentity();
  if (workspace.kind !== "git" || current.kind !== "git") throw new Error("Embedded Memory must be inside the current Git repository");
  if (workspace.key !== current.key) throw new Error("Embedded Memory must use the current Git repository; use a Managed Project for cross-repository sharing");
  const rel = relative(current.path, memoryPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Embedded Memory path escapes its Git Workspace");
  const memoryRelativePath = (rel || ".").replaceAll("\\", "/");
  const repositoryPath = await resolveMainWorkspacePath(current.path);
  const canonicalMemoryPath = await realpath(resolve(repositoryPath, memoryRelativePath));
  if (canonicalMemoryPath !== repositoryPath && !canonicalMemoryPath.startsWith(`${repositoryPath}${sep}`)) {
    throw new Error("Embedded Memory path escapes the main Git worktree through a symbolic link");
  }
  await mkdir(root, { recursive: true });
  return { store: { type: "embedded", repository_path: repositoryPath, memory_path: memoryRelativePath } };
}

async function writeProjectMetadata(root: string, name: string, config: ProjectConfigFile): Promise<void> {
  const paths = projectPaths(root);
  await Promise.all([
    mkdir(paths.changesRoot, { recursive: true }),
    mkdir(paths.runsRoot, { recursive: true }),
    mkdir(paths.archiveRoot, { recursive: true }),
    mkdir(paths.evalsRoot, { recursive: true }),
    mkdir(paths.runtimeRoot, { recursive: true })
  ]);
  await atomicWriteJson(paths.manifestPath, { format_version: 1, name, created_at: new Date().toISOString() });
  await atomicWriteJson(paths.configPath, projectConfigSchema.parse(config));
}

async function registerCreatedProject(home: string, name: string, root: string, bind?: boolean): Promise<void> {
  const workspace = bind ? await resolveWorkspaceIdentity() : undefined;
  await updateProjectRegistry(home, (registry) => {
    if (registry.projects[name]) throw new Error(`Project "${name}" became registered concurrently`);
    if (workspace && registry.workspaces[workspace.key]) throw new Error("Workspace became bound concurrently");
    registry.projects[name] = { root };
    if (workspace) registry.workspaces[workspace.key] = { primary: name, mounted: [] };
  });
}

async function assertGitIdentity(): Promise<void> {
  const [name, email] = await Promise.all([
    runGit(["config", "--get", "user.name"], { allowFailure: true }),
    runGit(["config", "--get", "user.email"], { allowFailure: true })
  ]);
  if (!name.stdout || !email.stdout) {
    throw new Error("Git identity is required. Configure git config --global user.name and git config --global user.email.");
  }
}

async function projectHealth(memoryRoot: string, config: ProjectConfigFile): Promise<{ status: "ok" | "unhealthy"; detail?: string }> {
  if (config.store.type === "embedded") return { status: await pathExists(memoryRoot) ? "ok" : "unhealthy", ...(!await pathExists(memoryRoot) ? { detail: "Memory path is missing" } : {}) };
  try {
    const [branch, revision, porcelain] = await Promise.all([
      gitOutput(["branch", "--show-current"], memoryRoot),
      gitOutput(["rev-parse", "HEAD"], memoryRoot),
      gitOutput(["status", "--porcelain"], memoryRoot)
    ]);
    if (branch !== config.store.branch) return { status: "unhealthy", detail: `expected branch ${config.store.branch}; found ${branch}` };
    if (revision !== config.store.published_revision) return { status: "unhealthy", detail: "HEAD differs from published revision" };
    if (porcelain) return { status: "unhealthy", detail: "Memory working tree is dirty" };
    return { status: "ok" };
  } catch (error) {
    return { status: "unhealthy", detail: error instanceof Error ? error.message : String(error) };
  }
}
