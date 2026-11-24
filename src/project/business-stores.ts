import { TosDataStoreFactory, inspectPhysicalRecords, parseTosConfig } from "../data/extensions/tos-datastore/index.js";
import { TosJsonValueStoreFactory, parseTosJsonConfig } from "../data/extensions/tos-json-valuestore/index.js";
import { resolveTosCredentials } from "../tos-credentials.js";
import { validateTosRecord } from "./tos-record-validation.js";
import { ConfigRevisionConflictError, configRevision } from "../config-management.js";
import { withConfigFileLock } from "../config-file-lock.js";
import { randomUUID } from "node:crypto";
import { withSharedStoreLock } from "./shared-store-lock.js";
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
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { createProjectModelHost } from "./models.js";
import { projectConfigSchema, businessStoreBindingSchema, type ProjectConfigFile, type BusinessStoreBinding } from "./model.js";
import { canonicalPath, validateModelStoragePaths, within } from "./model-storage-paths.js";
import { readModelOperationStamp, assertModelOperationStamp, withConsistentModelRead } from "./model-operation.js";
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
  const remote: Array<{ id: string; region: string; bucket: string; prefix: string }> = [];
  for (const [id, input] of Object.entries(project.dataStores ?? {})) {
    assertBusinessStoreId(id);
    const binding = businessStoreBindingSchema.parse(input);
    assertModelRef(binding.model);
    const config = new Config(binding.config);
    if ((binding.factory === "memsphere/tos" || binding.factory === "memsphere/tos-json")) {
      const parsed = binding.factory === "memsphere/tos" ? parseTosConfig(config) : parseTosJsonConfig(config);
      if (remote.some(other => other.region === parsed.region && other.bucket === parsed.bucket &&
        (other.prefix.startsWith(parsed.prefix) || parsed.prefix.startsWith(other.prefix)))) throw serviceError("STORE_PATH_CONFLICT", `TOS Store ${id} overlaps another prefix`);
      remote.push({ id, ...parsed }); continue;
    }
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
async function readBusinessBindings(root: string) {
  const stamp = await readModelOperationStamp(root);
  const project = await readBusinessProject(root);
  const directories = await validateBusinessBindings(root, project);
  return { stamp, project, directories };
}

function selectBusinessBinding({ stamp, project, directories }: Awaited<ReturnType<typeof readBusinessBindings>>, id: string) {
  const binding = project.dataStores && Object.hasOwn(project.dataStores, id) ? project.dataStores[id] : undefined;
  if (!binding) throw serviceError("STORE_NOT_FOUND", `Business Store not found: ${id}`);
  const directory = directories.get(id);
  const location = (binding.factory === "memsphere/tos" || binding.factory === "memsphere/tos-json")
    ? { kind: "tos" as const, bucket: binding.config.bucket, prefix: binding.config.prefix }
    : { kind: "filesystem" as const, directory: directory! };
  return { project, binding, directory, location, stamp };
}

export async function getBusinessBinding(root: string, id: string) {
  assertBusinessStoreId(id);
  const snapshot = await readBusinessBindings(root);
  const state = selectBusinessBinding(snapshot, id);
  await assertModelOperationStamp(root, state.stamp);
  return state;
}

export function openBusinessStore(context: Context, root: string, id: string, options: { write?: boolean; runtime?: ModelRuntime } = {}) {
  return withConsistentModelRead(async () => {
    const state = await getBusinessBinding(root, id);
    return openBoundStore(context, root, id, state, options.runtime);
  });
}

/** Open related Stores against one validated set of bindings and worktree paths. */
export function openBusinessStores(context: Context, root: string, runtimes: ReadonlyMap<string, ModelRuntime>) {
  return withConsistentModelRead(async () => {
    for (const id of runtimes.keys()) assertBusinessStoreId(id);
    const snapshot = await readBusinessBindings(root);
    await assertModelOperationStamp(root, snapshot.stamp);
    const stores = new Map<string, Awaited<ReturnType<typeof openBoundStore>>>();
    for (const [id, runtime] of runtimes) {
      stores.set(id, await openBoundStore(context, root, id, selectBusinessBinding(snapshot, id), runtime));
    }
    return stores;
  });
}

async function openBoundStore(context: Context, root: string, id: string, state: ReturnType<typeof selectBusinessBinding>, providedRuntime?: ModelRuntime) {
  const runtime = providedRuntime ?? await (await createProjectModelHost(context, { root, ...state.project })).runtime(state.binding.model);
  if (state.binding.kind === "value") {
    try { assertJsonDescriptor(runtime.descriptor.root); }
    catch (cause) { throw serviceError("STORE_INCOMPATIBLE", "filesystem JSON ValueStore requires a JSON-compatible model", { cause: String(cause) }); }
  }
  if ((state.binding.factory === "memsphere/tos" || state.binding.factory === "memsphere/tos-json")) {
    const store = state.binding.factory === "memsphere/tos-json"
      ? await new TosJsonValueStoreFactory(resolveTosCredentials).createStore(context, id, runtime, new Config(state.binding.config))
      : await new TosDataStoreFactory(resolveTosCredentials).createStore(context, id, state.binding.model, new Config(state.binding.config));
    await assertModelOperationStamp(root, state.stamp);
    return { ...state, store, runtime };
  }
  const config = new Config({ ...state.binding.config, directory: state.directory! });
  await assertDirectoryProtocol(context, state.directory!, state.binding);
  const factory = state.binding.kind === "value" ? new FilesystemJsonValueStoreFactory() : new FilesystemDataStoreFactory();
  let store: ValueStore | DataStore;
  if (factory instanceof FilesystemJsonValueStoreFactory) store = await factory.openExisting(context, id, runtime, config);
  else store = await factory.openExisting(context, id, state.binding.model, config);
  await assertModelOperationStamp(root, state.stamp);
  return { ...state, store, runtime };
}
async function assertDirectoryProtocol(context: Context, directory: string, binding: BusinessStoreBinding) {
  if ((binding.factory === "memsphere/tos" || binding.factory === "memsphere/tos-json")) throw new TypeError("A remote Store has no local directory");
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
      if (file.isDirectory()) { validateRelativeFilePath(name); await visit(join(folder, file.name), name); continue; }
      if (!file.isFile()) throw serviceError("STORE_INCOMPATIBLE", `Unknown Store entry: ${name}`);
      if (binding.kind === "value") {
        if (!file.name.endsWith(".json")) throw serviceError("STORE_INCOMPATIBLE", `Unknown Store entry: ${name}`);
        validateRelativeFilePath(name.slice(0, -5));
      } else {
        validateRelativeFilePath(name);
        if (!extensions!.some(([suffix]) => file.name.toLowerCase().endsWith(suffix))) throw serviceError("STORE_INCOMPATIBLE", `No MIME mapping for Store entry: ${name}`);
      }
    }
  };
  await visit(directory);
}
async function validateExistingDirectory(context: Context, id: string, directory: string, binding: BusinessStoreBinding, runtime: ModelRuntime) {
  if ((binding.factory === "memsphere/tos" || binding.factory === "memsphere/tos-json")) throw new TypeError("A remote Store has no local directory");
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
/** Explicit preflight only; ordinary settings validation must not scan cloud data. */
export async function preflightBusinessBinding(context: Context, root: string, id: string, binding: BusinessStoreBinding, runtime: ModelRuntime, directory?: string, credentialsResolver = resolveTosCredentials): Promise<void> {
  if (binding.factory === "memsphere/tos-json") {
    const store = await new TosJsonValueStoreFactory(credentialsResolver).createStore(context, id, runtime, new Config(binding.config));
    for await (const _record of store.inspectPhysicalRecords(context)) { context.signal?.throwIfAborted(); }
  } else if (binding.factory === "memsphere/tos") {
    const store = await new TosDataStoreFactory(credentialsResolver).createStore(context, id, binding.model, new Config(binding.config));
    for await (const record of inspectPhysicalRecords(context, store)) await validateTosRecord(context, record, runtime);
  } else {
    if (!directory) throw new TypeError("Local Store directory is missing");
    await validateExistingDirectory(context, id, directory, binding, runtime);
  }
}

export async function createBusinessStore(context: Context, root: string, id: string, input: unknown, dryRun = false) {
  assertBusinessStoreId(id);
  const binding = businessStoreBindingSchema.parse(input);
  const path = join(root, "config.json"), source = await readFile(path, "utf8"), stamp = await readModelOperationStamp(root);
  const project = projectConfigSchema.parse(JSON.parse(source));
  if (project.dataStores && Object.hasOwn(project.dataStores, id)) throw serviceError("ALREADY_EXISTS", `Store already exists: ${id}`);
  const next = { ...project, dataStores: { ...project.dataStores, [id]: { ...binding, registrationId:randomUUID() } } };
  const directories = await validateBusinessBindings(root, next), directory = directories.get(id);
  const host = await createProjectModelHost(context, { root, ...project }), runtime = await host.runtime(binding.model);
  if (binding.kind === "value") {
    try { assertJsonDescriptor(runtime.descriptor.root); }
    catch { throw serviceError("STORE_INCOMPATIBLE", "filesystem JSON ValueStore requires a JSON-compatible model"); }
  }
  // Cloud I/O and compatibility reads occur before the short config CAS lock.
  await preflightBusinessBinding(context, root, id, binding, runtime, directory);
  const location = (binding.factory === "memsphere/tos" || binding.factory === "memsphere/tos-json") ? { kind: "tos" as const, bucket: binding.config.bucket, prefix: binding.config.prefix }
    : { kind: "filesystem" as const, directory: directory! };
  if (dryRun) return { operation: "data.store.create", storeId: id, binding, location, ...(directory ? { directory } : {}), dryRun: true };
  return withSharedStoreLock(root, () => withConfigFileLock(path, async () => {
    const current = await readFile(path, "utf8");
    if (current !== source) throw new ConfigRevisionConflictError(configRevision(source), configRevision(current));
    await assertModelOperationStamp(root, stamp);
    const absent: string[] = [];
    if (directory) {
      let ancestor = directory;
      while (true) {
        try { await stat(ancestor); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        absent.push(ancestor); ancestor = dirname(ancestor);
      }
    }
    try { if (directory) await mkdir(directory, { recursive: true }); await atomicWriteJson(path, next); }
    catch (error) {
      try {
        if (JSON.stringify(JSON.parse(await readFile(path, "utf8"))) === JSON.stringify(next))
          return { operation: "data.store.create", storeId: id, binding, location, ...(directory ? { directory } : {}), pendingCleanup: true };
      } catch { /* Keep the failure and clean only our empty local directories. */ }
      const remaining: string[] = [];
      for (const folder of absent) try { await rmdir(folder); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") remaining.push(folder); }
      if (remaining.length) throw serviceError("STORE_CLEANUP_REQUIRED", "Store creation failed; retained directories require attention", { directories: remaining });
      throw error;
    }
    return { operation: "data.store.create", storeId: id, binding, location, ...(directory ? { directory } : {}) };
  }, context.signal), context.signal);
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
  return dryRun ? execute() : withSharedStoreLock(root, () => withConfigFileLock(join(root, "config.json"), execute, context.signal), context.signal);
}
