import { mkdir, readFile, readdir, rmdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Config } from "../data/api/config.js";
import type { Context } from "../data/api/context.js";
import type { ModelRuntime } from "../data/api/model-runtime.js";
import type { DataStore } from "../data/api/data-store.js";
import type { ValueStore } from "../data/api/value-store.js";
import { FilesystemJsonValueStoreFactory, parseFilesystemJsonValueStoreConfig, validateFilesystemJsonStoreMetadata, FILESYSTEM_JSON_METADATA_DIRECTORY } from "../data/extensions/filesystem-json-valuestore/index.js";
import { FilesystemDataStoreFactory, parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { assertJsonDescriptor } from "../data/extensions/json-serializer/index.js";
import { listRelativeFilenames } from "../data/extensions/shared/filesystem.js";
import { validateFilename, validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { createProjectModelHost } from "./models.js";
import { projectConfigSchema, businessStoreBindingSchema, type ProjectConfigFile, type BusinessStoreBinding } from "./model.js";
import { canonicalPath, validateModelStoragePaths, within } from "./model-storage-paths.js";
import { readModelOperationStamp, assertModelOperationStamp, withProjectSettingsLock, withConsistentModelRead } from "./model-operation.js";
import { atomicWriteJson } from "../persistence.js";
import { assertModelRef } from "./model-registration-contract.js";
import { runGit } from "../git.js";

export const serviceError = (code: string, message: string, details?: unknown) => Object.assign(new Error(message), { code, details });
export async function readBusinessProject(root: string): Promise<ProjectConfigFile> {
  return projectConfigSchema.parse(JSON.parse(await readFile(join(root, "config.json"), "utf8")));
}
export function assertBusinessStoreId(id: string) {
  if (!id.trim() || id.includes("\0") || id === "__proto__") throw serviceError("INVALID_ARGUMENT", "Store ID must be nonblank and cannot be __proto__");
  if (/^(?:models|runs?|archives?)(?:\/|$)/.test(id) || /^(?:memsphere\/model-registrations|memsphere\/run)(?:\/|$)/.test(id))
    throw serviceError("SYSTEM_STORE_FORBIDDEN", `Reserved Store ID: ${id}`);
}
export async function validateBusinessBindings(root: string, project: ProjectConfigFile) {
  const paths = await validateModelStoragePaths({ root, ...project });
  const protectedInputs = [paths.modelsDirectory, paths.backupDirectory, ...paths.excludedDirectories,
    ...["memory", "runs", "archives", "changes", "evals", ".runtime"].map(path => join(root, path)),
    ...(project.store.type === "embedded" ? [resolve(project.store.repository_path, project.store.memory_path)] : [])];
  if (project.store.type === "embedded" && Object.keys(project.dataStores ?? {}).length) {
    // Data stays rooted at the Registry Project; protect its Memory in every linked worktree as well.
    const memoryPath = project.store.memory_path;
    const { stdout } = await runGit(["worktree", "list", "--porcelain", "-z"], { cwd: project.store.repository_path, preserveStdout: true });
    protectedInputs.push(...stdout.split("\0").filter(field => field.startsWith("worktree "))
      .map(field => resolve(field.slice("worktree ".length), memoryPath)));
  }
  const protectedPaths = await Promise.all(protectedInputs.map(canonicalPath));
  const directories = new Map<string, string>();
  for (const [id, input] of Object.entries(project.dataStores ?? {})) {
    assertBusinessStoreId(id);
    const binding = businessStoreBindingSchema.parse(input);
    assertModelRef(binding.model);
    const config = new Config(binding.config);
    if (binding.kind === "data") parseFilesystemDataStoreConfig(config);
    else parseFilesystemJsonValueStoreConfig(config);
    const directory = await canonicalPath(resolve(root, binding.config.directory));
    if (protectedPaths.some(path => within(directory, path) || within(path, directory)))
      throw serviceError("STORE_PATH_CONFLICT", `Store ${id} overlaps system storage`, { storeId: id, directory });
    for (const [otherId, other] of directories) if (within(directory, other) || within(other, directory))
      throw serviceError("STORE_PATH_CONFLICT", `Stores ${id} and ${otherId} overlap`, { storeId: id, otherStoreId: otherId, directory });
    directories.set(id, directory);
  }
  return directories;
}
export async function getBusinessBinding(root: string, id: string) {
  assertBusinessStoreId(id);
  const stamp = await readModelOperationStamp(root);
  const project = await readBusinessProject(root);
  const directories = await validateBusinessBindings(root, project);
  const binding = project.dataStores && Object.hasOwn(project.dataStores, id) ? project.dataStores[id] : undefined;
  if (!binding) throw serviceError("STORE_NOT_FOUND", `Business Store not found: ${id}`);
  await assertModelOperationStamp(root, stamp);
  return { project, binding, directory: directories.get(id)!, stamp };
}
export function openBusinessStore(context: Context, root: string, id: string, options: { write?: boolean; runtime?: ModelRuntime } = {}) {
  return withConsistentModelRead(() => openBusinessStoreOnce(context, root, id, options));
}
async function openBusinessStoreOnce(context: Context, root: string, id: string, options: { write?: boolean; runtime?: ModelRuntime }) {
  const state = await getBusinessBinding(root, id);
  const host = await createProjectModelHost(context, { root, ...state.project });
  const runtime = options.runtime ?? await host.runtime(state.binding.model);
  if (state.binding.kind === "value") {
    try { assertJsonDescriptor(runtime.descriptor.root); }
    catch (cause) { throw serviceError("STORE_INCOMPATIBLE", "filesystem JSON ValueStore requires a JSON-compatible model", { cause: String(cause) }); }
  }
  const config = new Config({ ...state.binding.config, directory: state.directory });
  await assertDirectoryProtocol(context, state.directory, state.binding);
  const factory = state.binding.kind === "value" ? new FilesystemJsonValueStoreFactory() : new FilesystemDataStoreFactory();
  let store: ValueStore | DataStore;
  if (factory instanceof FilesystemJsonValueStoreFactory) store = await factory.openExisting(context, id, runtime, config);
  else store = await factory.openExisting(context, id, state.binding.model, config);
  await assertModelOperationStamp(root, state.stamp);
  return { ...state, store, runtime };
}
async function assertDirectoryProtocol(context: Context, directory: string, binding: BusinessStoreBinding) {
  const extensions = binding.kind === "data" ? parseFilesystemDataStoreConfig(new Config(binding.config)).extensions : undefined;
  const visit = async (folder: string, prefix = ""): Promise<void> => {
    for (const file of await readdir(folder, { withFileTypes: true })) {
      context.signal?.throwIfAborted();
      const name = prefix ? `${prefix}/${file.name}` : file.name;
      if (file.isSymbolicLink()) throw serviceError("STORE_INCOMPATIBLE", `Symbolic link in Store: ${name}`);
      // atomicPublish creates these regular files before link/rename, including in subdirectories.
      // They may still belong to a live writer; validate their name/type, never delete them.
      if (file.isFile() && /^\.memsphere-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(file.name)) continue;
      if (binding.kind === "value" && !prefix && file.name === FILESYSTEM_JSON_METADATA_DIRECTORY && file.isDirectory()) {
        await validateFilesystemJsonStoreMetadata(context, directory); continue;
      }
      if (file.name.toLowerCase().startsWith(".memsphere-")) throw serviceError("STORE_INCOMPATIBLE", `Unknown internal Store entry: ${name}`);
      if (file.isDirectory() && binding.kind === "data") { validateRelativeFilePath(name); await visit(join(folder, file.name), name); continue; }
      if (!file.isFile()) throw serviceError("STORE_INCOMPATIBLE", `Unknown Store entry: ${name}`);
      if (binding.kind === "value") {
        if (!file.name.endsWith(".json")) throw serviceError("STORE_INCOMPATIBLE", `Unknown Store entry: ${name}`);
        validateFilename(file.name.slice(0, -5));
      } else {
        validateRelativeFilePath(name);
        if (!extensions!.some(([suffix]) => file.name.toLowerCase().endsWith(suffix))) throw serviceError("STORE_INCOMPATIBLE", `No MIME mapping for Store entry: ${name}`);
      }
    }
  };
  await visit(directory);
}
async function validateExistingDirectory(context: Context, id: string, directory: string, binding: BusinessStoreBinding, runtime: ModelRuntime) {
  try { if (!(await stat(directory)).isDirectory()) throw new TypeError(`Not a directory: ${directory}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await assertDirectoryProtocol(context, directory, binding);
  const config = new Config({ ...binding.config, directory });
  const store = binding.kind === "value"
    ? await new FilesystemJsonValueStoreFactory().openExisting(context, id, runtime, config)
    : await new FilesystemDataStoreFactory().openExisting(context, id, binding.model, config);
  if (binding.kind === "data") {
    const { extensions } = parseFilesystemDataStoreConfig(config);
    for (const name of await listRelativeFilenames(context, directory)) {
      if (!extensions.some(([suffix]) => name.toLowerCase().endsWith(suffix))) throw serviceError("STORE_INCOMPATIBLE", `No MIME mapping for Store entry: ${name}`);
    }
  }
  let cursor: string | undefined;
  do {
    const page = await store.list(context, { limit: 1000, cursor });
    for (const item of page.items) {
      const record = await store.get(context, item.id);
      if (!record) throw serviceError("STORE_CHANGED", "Store changed during compatibility scan");
      if ("data" in record) {
        // Payload writes promise file/MIME compatibility, not structured model validation.
        // Existing opaque bytes retain the same contract when explicitly re-registering.
        if (record.data.model !== binding.model) throw serviceError("STORE_INCOMPATIBLE", `Wrong model for Payload ${item.id}`);
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}
export async function createBusinessStore(context: Context, root: string, id: string, input: unknown, dryRun = false) {
  assertBusinessStoreId(id);
  const binding = businessStoreBindingSchema.parse(input);
  const execute = async () => {
    await readModelOperationStamp(root);
    const project = await readBusinessProject(root);
    if (project.dataStores && Object.hasOwn(project.dataStores, id)) throw serviceError("ALREADY_EXISTS", `Store already exists: ${id}`);
    const next = { ...project, dataStores: { ...project.dataStores, [id]: binding } };
    const directories = await validateBusinessBindings(root, next);
    const directory = directories.get(id)!;
    const host = await createProjectModelHost(context, { root, ...project });
    const runtime = await host.runtime(binding.model);
    if (binding.kind === "value") {
      try { assertJsonDescriptor(runtime.descriptor.root); }
      catch (cause) { throw serviceError("STORE_INCOMPATIBLE", "filesystem JSON ValueStore requires a JSON-compatible model", { cause: String(cause) }); }
    }
    await validateExistingDirectory(context, id, directory, binding, runtime);
    if (dryRun) return { operation: "data.store.create", storeId: id, binding, directory, dryRun: true };
    const absent: string[] = [];
    let ancestor = directory;
    while (true) {
      try { await stat(ancestor); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      absent.push(ancestor); ancestor = dirname(ancestor);
    }
    try {
      await mkdir(directory, { recursive: true });
      await atomicWriteJson(join(root, "config.json"), next);
    } catch (error) {
      // Atomic rename may have committed even if a subsequent durability check failed.
      try {
        if (JSON.stringify(JSON.parse(await readFile(join(root, "config.json"), "utf8"))) === JSON.stringify(next))
          return { operation: "data.store.create", storeId: id, binding, directory, pendingCleanup: true };
      } catch { /* Preserve the original error and attempt only our own empty directories. */ }
      const remaining: string[] = [];
      for (const path of absent) try { await rmdir(path); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") remaining.push(path); }
      if (remaining.length) throw serviceError("STORE_CLEANUP_REQUIRED", "Store creation failed; retained directories require attention", { directories: remaining, cause: String(error) });
      throw error;
    }
    return { operation: "data.store.create", storeId: id, binding, directory };
  };
  return dryRun ? execute() : withProjectSettingsLock(root, execute, context.signal);
}
export async function removeBusinessStore(context: Context, root: string, id: string, dryRun = false) {
  const execute = async () => {
    const state = await getBusinessBinding(root, id);
    if (!dryRun) {
      const next = structuredClone(state.project); delete next.dataStores![id];
      await atomicWriteJson(join(root, "config.json"), next);
    }
    return { operation: "data.store.remove", storeId: id, dataRetained: true, directory: state.directory, ...(dryRun ? { dryRun: true } : {}) };
  };
  return dryRun ? execute() : withProjectSettingsLock(root, execute, context.signal);
}
