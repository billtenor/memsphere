import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { homePaths } from "../home.js";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { projectNameSchema, type ProjectRecord } from "./model.js";

const registryProjectSchema = z.object({ root: z.string().min(1) }).strict();
const workspaceBindingSchema = z.object({
  primary: projectNameSchema,
  mounted: z.array(projectNameSchema).default([])
}).strict();

export const projectRegistrySchema = z.object({
  format_version: z.literal(1),
  projects: z.record(projectNameSchema, registryProjectSchema).default({}),
  workspaces: z.record(z.string().min(1), workspaceBindingSchema).default({})
}).strict();

export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
export type WorkspaceBinding = z.infer<typeof workspaceBindingSchema>;

export function emptyProjectRegistry(): ProjectRegistry {
  return { format_version: 1, projects: {}, workspaces: {} };
}

export async function readProjectRegistry(home?: string): Promise<ProjectRegistry> {
  const path = homePaths(home).registryPath;
  try {
    return projectRegistrySchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissing(error)) return emptyProjectRegistry();
    throw new Error(`invalid Project Registry: ${path}`, { cause: error });
  }
}

export async function updateProjectRegistry(
  home: string | undefined,
  update: (registry: ProjectRegistry) => void | Promise<void>
): Promise<ProjectRegistry> {
  const paths = homePaths(home);
  return withFileLock(resolve(paths.runtimeRoot, "registry.lock"), async () => {
    const registry = await readProjectRegistry(paths.home);
    await update(registry);
    const validated = projectRegistrySchema.parse(registry);
    await atomicWriteJson(paths.registryPath, validated);
    return validated;
  });
}

export async function listRegisteredProjects(home?: string): Promise<ProjectRecord[]> {
  const registry = await readProjectRegistry(home);
  return Promise.all(Object.entries(registry.projects).sort(([a], [b]) => a.localeCompare(b)).map(async ([name, entry]) => ({
    name,
    root: resolve(entry.root),
    missing: !await pathExists(entry.root)
  })));
}

export async function assertSafeProjectRoot(path: string): Promise<string> {
  const absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  const candidate = resolve(parent, absolute.slice(dirname(absolute).length + 1));
  if (candidate !== absolute) throw new Error(`Project Root escapes its parent: ${path}`);
  return absolute;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
