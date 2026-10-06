import { dirname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Context } from "../data/api/context.js";
import type { DataManager } from "../data/api/data-manager.js";
import type { DataStore } from "../data/api/data-store.js";
import { Config } from "../data/api/config.js";
import { filesystemDataStoreExtension } from "../data/extensions/filesystem-datastore/index.js";
import { rawExtension } from "../data/extensions/raw/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { DefaultDataManager } from "../data/management/data-manager.js";
import { readBundledSystemModels } from "../reserved/models.js";
import type { ProjectModelInput } from "./model-registration.js";
import { readModelOperationStamp } from "./model-operation.js";

export const runDataModels = Object.freeze({
  artifact: "memsphere/run/artifact.json",
  memory: "memsphere/run/memory-snapshot-file.json",
  activityLog: "memsphere/run/agent-activity-log.json",
  activitySnapshot: "memsphere/run/agent-activity-snapshot.json"
});
/** Persisted ContentRef addresses are independent of model identities. */
export const runDataStoreIds = Object.freeze({
  artifact: "memsphere/run/artifact", memory: "memsphere/run/memory-snapshot-file",
  activityLog: "memsphere/run/agent-activity-log", activitySnapshot: "memsphere/run/agent-activity-snapshot"
});
export type RunDataKind = keyof typeof runDataModels;
export type RunDataArea = "current" | "archive";

const extensions = new DefaultDataExtensionRegistry([rawExtension, filesystemDataStoreExtension]);
const hosts = new Map<string, { manager: DataManager; area: RunDataArea; archiveRoot: string; projectKey?: string }>();

/** The same definitions used by Run assembly and the Project model catalog. */
export function runModelBindings() {
  const ids = new Set<string>(Object.values(runDataModels));
  return readBundledSystemModels().filter(entry => ids.has(entry.registration.modelRef)).map(entry => ({ model: {
    data: { id: entry.registration.modelRef, model: entry.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(entry.source)) } },
    definition: entry.definition
  } }));
}

/** Project assembly; roots and Store IDs are independent of any individual Run. */
export function prepareRunData(input: { runsRoot: string; archiveRoot: string; manager?: DataManager; project?: ProjectModelInput }): DataManager {
  const runsRoot = resolve(input.runsRoot);
  const archiveRoot = resolve(input.archiveRoot);
  const project = input.project && snapshotProjectInput(input.project);
  const projectKey = project && JSON.stringify(project);
  const existing = hosts.get(runsRoot);
  // Root-only callers (notably archive transfer) preserve an existing Project
  // assembly, including an injected manager. Only explicit configuration replaces it.
  if (!input.manager && existing?.area === "current" && existing.archiveRoot === archiveRoot
    && (project === undefined || existing.projectKey === projectKey)) return existing.manager;
  const contentManager = input.manager ?? new DefaultDataManager({
    extensions,
    models: runModelBindings(),
    stores: Object.entries(runDataModels).flatMap(([kind, model]) => (["current", "archive"] as const).map((area) => ({
      id: `${runDataStoreIds[kind as RunDataKind]}/${area}`,
      model,
      kind: "DataStore" as const,
      factory: "memsphere/filesystem",
      config: new Config({
        directory: area === "current" ? runsRoot : join(archiveRoot, "runs"),
        ...(kind === "activityLog" ? { contentTypeExtensions: { "application/x-ndjson": [".acp.jsonl"] } } : {})
      })
    })))
  });
  const manager = input.manager ?? withProjectModels(contentManager, project, dirname(runsRoot));
  if (existing && existing.archiveRoot !== archiveRoot) {
    const oldArchive = resolve(existing.archiveRoot, "runs");
    if (hosts.get(oldArchive)?.manager === existing.manager) hosts.delete(oldArchive);
  }
  hosts.set(runsRoot, { manager, area: "current", archiveRoot, projectKey });
  hosts.set(resolve(archiveRoot, "runs"), { manager, area: "archive", archiveRoot, projectKey });
  return manager;
}

function snapshotProjectInput(input: ProjectModelInput): ProjectModelInput {
  const root = resolve(input.root);
  const config = input.modelRegistration && structuredClone(input.modelRegistration);
  return {
    root,
    modelsDirectory: resolve(root, input.modelsDirectory ?? "models/json-schema/draft-07"),
    ...(config ? { modelRegistration: {
      storeId: config.storeId,
      stores: Object.fromEntries(Object.entries(config.stores).sort(([a], [b]) => a.localeCompare(b))
        .map(([id, store]) => [id, { ...store, directory: resolve(root, store.directory) }])),
      ...(config.excludedDirectories ? { excludedDirectories: config.excludedDirectories.map(path => resolve(root, path)).sort() } : {})
    } } : {})
  };
}

/** Reading content requires only its Store; explicit model access uses one Project snapshot. */
function withProjectModels(content: DataManager, configured: ProjectModelInput | undefined, root: string): DataManager {
  type Host = Awaited<ReturnType<typeof import("./models.js").createProjectModelHost>>;
  let prepared: Promise<Host | undefined> | undefined;
  let preparedStamp: string | undefined;
  const host = async (): Promise<Host | undefined> => {
    const stamp = await readModelOperationStamp(root);
    if (preparedStamp !== stamp) {
      prepared = undefined;
      preparedStamp = stamp;
    }
    if (!prepared) {
      prepared = (async () => {
        const input = configured ?? await implicitProjectInput(root);
        if (!input) return undefined; // Standalone content Store, without Project metadata.
        const { createProjectModelHost } = await import("./models.js");
        return createProjectModelHost({}, input);
      })().catch(error => { prepared = undefined; throw error; });
    }
    return prepared;
  };
  async function checked<T>(context: Context, operation: () => Promise<T>): Promise<T> {
    context.signal?.throwIfAborted();
    const value = await operation();
    context.signal?.throwIfAborted();
    return value;
  }
  return {
    getStore: content.getStore.bind(content),
    getModel: (context, ref) => checked(context, async () => {
      const project = await host();
      return project ? project.manager.getModel({}, ref) : content.getModel({}, ref);
    }),
    getRuntime: (context, ref) => checked(context, async () => {
      const project = await host();
      if (!project) return content.getRuntime({}, ref);
      // The host owns Runtime caching and rechecks its operation stamp on every access.
      return project.runtime(ref);
    })
  };
}

async function implicitProjectInput(root: string): Promise<ProjectModelInput | undefined> {
  try { await readFile(join(root, "project.json")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const { projectConfigSchema } = await import("./model.js");
  const config = projectConfigSchema.parse(JSON.parse(await readFile(join(root, "config.json"), "utf8")));
  return snapshotProjectInput({ root, modelsDirectory: config.modelsDirectory, modelRegistration: config.modelRegistration });
}

export async function runDataStore(root: string, kind: RunDataKind): Promise<DataStore> {
  const key = resolve(root);
  if (!hosts.has(key)) prepareRunData({ runsRoot: key, archiveRoot: join(dirname(key), "archives") });
  const host = hosts.get(key)!;
  const store = await host.manager.getStore({}, `${runDataStoreIds[kind]}/${host.area}`);
  if (store.kind !== "DataStore") throw new Error(`Run content requires a DataStore: ${store.id}`);
  return store;
}

export async function readRunContent(root: string, kind: RunDataKind, id: string): Promise<Buffer | undefined> {
  const stored = await (await runDataStore(root, kind)).get({}, id);
  return stored && Buffer.from(await readAll({}, stored.data.payload.content));
}

export async function requireRunContent(root: string, kind: RunDataKind, id: string): Promise<Buffer> {
  const bytes = await readRunContent(root, kind, id);
  if (bytes === undefined) throw new Error(`Run content not found: ${id}`);
  return bytes;
}

/** Business-level replacement, not a change to Store create/update semantics. */
export async function saveRunContent(root: string, kind: RunDataKind, id: string, contentType: string, bytes: Uint8Array, mode: "create" | "replace" = "replace"): Promise<void> {
  const store = await runDataStore(root, kind);
  const data = { id, model: store.model, payload: { contentType, content: bytesContent(bytes) } };
  if (mode === "create" || !await store.has({}, id)) await store.create({}, data);
  else await store.update({}, data);
}

export async function deleteRunContent(root: string, kind: RunDataKind, id: string): Promise<void> {
  await (await runDataStore(root, kind)).delete({}, id);
}
