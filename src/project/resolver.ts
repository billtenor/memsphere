import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { homePaths } from "../home.js";
import { projectConfigSchema, projectManifestSchema, type ProjectConfigFile, type ProjectManifest } from "./model.js";
import { projectPaths } from "./paths.js";
import { readProjectRegistry, type WorkspaceBinding } from "./registry.js";
import { resolveMainWorkspacePath, resolveWorkspaceIdentity, type WorkspaceIdentity } from "./workspace.js";

export type ResolvedProject = {
  name: string;
  manifest: ProjectManifest;
  config: ProjectConfigFile;
  paths: ReturnType<typeof projectPaths>;
  memoryRoot: string;
};

export type ProjectContext = {
  home: string;
  workspace: WorkspaceIdentity;
  binding?: WorkspaceBinding;
  primary: ResolvedProject;
  mounted: ResolvedProject[];
  explicit: boolean;
};

export async function resolveProjectContext(options: {
  home?: string;
  cwd?: string;
  project?: string;
  memoryScope?: "workspace" | "canonical";
} = {}): Promise<ProjectContext> {
  const paths = homePaths(options.home);
  const workspace = await resolveWorkspaceIdentity(options.cwd);
  const registry = await readProjectRegistry(paths.home);
  const binding = registry.workspaces[workspace.key];
  const target = options.project?.trim() || binding?.primary;
  if (!target) {
    throw new Error("current Workspace is not bound to a Primary Project; use memsphere project bind <name> or --project <name>");
  }
  const resolution = options.memoryScope === "canonical" ? undefined : { workspace };
  const primary = await resolveRegisteredProject(target, registry.projects, resolution);
  const mounted = options.project ? [] : await Promise.all(
    (binding?.mounted ?? []).map((name) => resolveRegisteredProject(name, registry.projects, resolution))
  );
  return { home: paths.home, workspace, binding, primary, mounted, explicit: Boolean(options.project) };
}

export async function resolveRegisteredProject(
  name: string,
  projects: Record<string, { root: string }>,
  options: { workspace: WorkspaceIdentity } | undefined = undefined
): Promise<ResolvedProject> {
  const registered = projects[name];
  if (!registered) throw new Error(`Project "${name}" is not registered`);
  let root: string;
  try {
    root = await realpath(resolve(registered.root));
  } catch (error) {
    throw new Error(`Project "${name}" root is missing: ${registered.root}`, { cause: error });
  }
  const paths = projectPaths(root);
  const manifest = projectManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, "utf8")));
  if (manifest.name !== name) throw new Error(`Project manifest name "${manifest.name}" does not match Registry name "${name}"`);
  const config = projectConfigSchema.parse(JSON.parse(await readFile(paths.configPath, "utf8")));
  const memoryRoot = config.store.type === "managed"
    ? paths.memoryRoot
    : options
      ? await resolveEmbeddedWorkspaceMemoryRoot(config.store, options.workspace)
      : await resolveEmbeddedCanonicalMemoryRoot(config.store);
  return { name, manifest, config, paths, memoryRoot };
}

async function resolveEmbeddedCanonicalMemoryRoot(
  store: Extract<ProjectConfigFile["store"], { type: "embedded" }>
): Promise<string> {
  const repository = await resolveEmbeddedRepository(store.repository_path);
  return resolveContainedMemoryRoot(repository.path, store.memory_path);
}

async function resolveEmbeddedWorkspaceMemoryRoot(
  store: Extract<ProjectConfigFile["store"], { type: "embedded" }>,
  workspace: WorkspaceIdentity
): Promise<string> {
  if (workspace.kind !== "git") {
    throw new Error("Embedded Project commands must run inside the Project's Git repository");
  }
  const repository = await resolveEmbeddedRepository(store.repository_path);
  if (repository.key !== workspace.key) {
    throw new Error("Embedded Project can only be used by worktrees of its own Git repository");
  }
  return resolveContainedMemoryRoot(workspace.path, store.memory_path, { mustExist: true });
}

async function resolveEmbeddedRepository(repositoryPath: string): Promise<{ path: string; key: string }> {
  const configuredPath = await realpath(repositoryPath);
  const repository = await resolveWorkspaceIdentity(configuredPath);
  if (repository.kind !== "git") throw new Error("Embedded repository_path must point to a Git main worktree");
  const mainPath = await resolveMainWorkspacePath(configuredPath);
  if (configuredPath !== mainPath) {
    throw new Error("Embedded repository_path must point to the Git main worktree");
  }
  return { path: mainPath, key: repository.key };
}

async function resolveContainedMemoryRoot(
  workspacePath: string,
  memoryPath: string,
  options: { mustExist?: boolean } = {}
): Promise<string> {
  const workspaceRoot = await realpath(workspacePath);
  const memoryRoot = resolve(workspaceRoot, memoryPath);
  assertWithin(workspaceRoot, memoryRoot, "Embedded Memory path escapes its Git Workspace");
  let existingPath = memoryRoot;
  while (true) {
    try {
      const resolvedExistingPath = await realpath(existingPath);
      assertWithin(
        workspaceRoot,
        resolvedExistingPath,
        "Embedded Memory path escapes its Git Workspace through a symbolic link"
      );
      if (options.mustExist && existingPath !== memoryRoot) {
        throw new Error(`Embedded Memory root is missing in the current Git worktree: ${memoryRoot}`);
      }
      return existingPath === memoryRoot ? resolvedExistingPath : memoryRoot;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(existingPath);
      if (parent === existingPath) throw error;
      existingPath = parent;
    }
  }
}

function assertWithin(root: string, candidate: string, message: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(message);
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
