import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { homePaths } from "../home.js";
import { projectConfigSchema, projectManifestSchema, type ProjectConfigFile, type ProjectManifest } from "./model.js";
import { projectPaths } from "./paths.js";
import { readProjectRegistry, type WorkspaceBinding } from "./registry.js";
import { resolveWorkspaceIdentity, type WorkspaceIdentity } from "./workspace.js";

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
} = {}): Promise<ProjectContext> {
  const paths = homePaths(options.home);
  const workspace = await resolveWorkspaceIdentity(options.cwd);
  const registry = await readProjectRegistry(paths.home);
  const binding = registry.workspaces[workspace.key];
  const target = options.project?.trim() || binding?.primary;
  if (!target) {
    throw new Error("current Workspace is not bound to a Primary Project; use memsphere project bind <name> or --project <name>");
  }
  const primary = await resolveRegisteredProject(target, registry.projects);
  const mounted = options.project ? [] : await Promise.all((binding?.mounted ?? []).map((name) => resolveRegisteredProject(name, registry.projects)));
  return { home: paths.home, workspace, binding, primary, mounted, explicit: Boolean(options.project) };
}

export async function resolveRegisteredProject(
  name: string,
  projects: Record<string, { root: string }>
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
  const memoryRoot = config.store.type === "managed" ? paths.memoryRoot : resolve(config.store.memory_path);
  return { name, manifest, config, paths, memoryRoot };
}
