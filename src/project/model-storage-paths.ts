import { realpath, readdir } from "node:fs/promises";
import { dirname, resolve, relative, sep, join } from "node:path";
import type { Context } from "../data/api/context.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import type { ProjectModelInput } from "./model-registration.js";
export const DEFAULT_MODEL_SCAN_DIRECTORY = "models/json-schema/draft-07";
export const MODEL_REGISTRATION_BACKUP_DIRECTORY = "backups/model-registration";
export function within(path: string, parent: string): boolean {
  const part = relative(parent, path);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !part.startsWith(sep));
}
/** Resolve existing ancestors, including aliases, without creating directories. */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
    const parent = dirname(absolute);
    if (parent === absolute)
      throw error;
    return resolve(await canonicalPath(parent), relative(parent, absolute));
  }
}
export async function validateModelStoragePaths(input: ProjectModelInput) {
  const modelsDirectory = await canonicalPath(resolve(input.root, input.modelsDirectory ?? DEFAULT_MODEL_SCAN_DIRECTORY));
  const config = input.modelRegistration ?? { storeId: "memsphere/model-registrations", stores: { "memsphere/model-registrations": { factory: "memsphere/filesystem-json", directory: "models/registrations" } } };
  const selected = config.stores[config.storeId];
  if (!selected || selected.factory !== "memsphere/filesystem-json")
    throw new TypeError(`Unavailable model registration Store: ${config.storeId}`);
  const backupDirectory = await canonicalPath(resolve(input.root, MODEL_REGISTRATION_BACKUP_DIRECTORY));
  const registrationDirectories: string[] = [];
  for (const [id, store] of Object.entries(config.stores)) {
    if (!id.trim() || store.factory !== "memsphere/filesystem-json" || !store.directory.trim())
      throw new TypeError(`Invalid model registration Store: ${id}`);
    const directory = await canonicalPath(resolve(input.root, store.directory));
    if (within(modelsDirectory, directory) || within(directory, backupDirectory) || within(backupDirectory, directory)) {
      throw new TypeError(`Model storage path conflict: ${modelsDirectory}, ${directory}, ${backupDirectory}`);
    }
    registrationDirectories.push(directory);
  }
  const retained = await Promise.all((config.excludedDirectories ?? []).map(path => canonicalPath(resolve(input.root, path))));
  for (const path of [...retained, backupDirectory]) {
    if (within(modelsDirectory, path))
      throw new TypeError(`Model storage path conflict: ${modelsDirectory}, ${path}`);
  }
  return { modelsDirectory, registrationDirectory: await canonicalPath(resolve(input.root, selected.directory)), backupDirectory,
    excludedDirectories: [...new Set([...registrationDirectories, ...retained, backupDirectory])] };
}
export async function discoverModelIds(context: Context, directory: string, excluded: string[]): Promise<string[]> {
  const ids: string[] = [];
  const visit = async (folder: string) => {
    context.signal?.throwIfAborted();
    if (excluded.some(root => within(folder, root)))
      return;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.toLowerCase().startsWith(".memsphere-"))
        continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory())
        await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const id = relative(directory, path).split(sep).join("/");
        validateRelativeFilePath(id);
        ids.push(id);
      }
    }
  };
  await visit(directory);
  return ids.sort();
}
export async function assertModelPath(directory: string, id: string, excluded: string[]) {
  validateRelativeFilePath(id);
  const path = resolve(directory, id);
  // Existing filesystem DataStore also rejects symlinks; this guards canonical excluded aliases.
  const canonical = await canonicalPath(path);
  if (!within(canonical, directory) || excluded.some(root => within(canonical, root)))
    throw new TypeError(`Excluded model path: ${id}`);
}
