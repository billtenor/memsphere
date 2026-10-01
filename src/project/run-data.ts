import { dirname, join, resolve } from "node:path";
import type { DataManager } from "../data/api/data-manager.js";
import type { DataStore } from "../data/api/data-store.js";
import { Config } from "../data/api/config.js";
import { filesystemDataStoreExtension } from "../data/extensions/filesystem-datastore/index.js";
import { RAW_MODEL, rawExtension } from "../data/extensions/raw/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { DefaultDataManager } from "../data/management/data-manager.js";

export const runDataModels = Object.freeze({
  artifact: "memsphere/run/artifact",
  memory: "memsphere/run/memory-snapshot-file",
  activityLog: "memsphere/run/agent-activity-log",
  activitySnapshot: "memsphere/run/agent-activity-snapshot"
});
export type RunDataKind = keyof typeof runDataModels;
export type RunDataArea = "current" | "archive";

const extensions = new DefaultDataExtensionRegistry([rawExtension, filesystemDataStoreExtension]);
const hosts = new Map<string, { manager: DataManager; area: RunDataArea; archiveRoot: string }>();

/** The same definitions used by Run assembly and the Project model catalog. */
export function runModelBindings() {
  return Object.values(runDataModels).map(id => ({ model: {
    data: { id, model: RAW_MODEL, payload: { contentType: "application/json", content: bytesContent(Buffer.from("{}")) } },
    definition: {}
  } }));
}

/** Project assembly; roots and Store IDs are independent of any individual Run. */
export function prepareRunData(input: { runsRoot: string; archiveRoot: string; manager?: DataManager }): DataManager {
  const runsRoot = resolve(input.runsRoot);
  const archiveRoot = resolve(input.archiveRoot);
  const existing = hosts.get(runsRoot);
  if (!input.manager && existing?.area === "current" && existing.archiveRoot === archiveRoot) return existing.manager;
  const manager = input.manager ?? new DefaultDataManager({
    extensions,
    models: runModelBindings(),
    stores: Object.entries(runDataModels).flatMap(([kind, model]) => (["current", "archive"] as const).map((area) => ({
      id: `${model}/${area}`,
      model,
      kind: "DataStore" as const,
      factory: "memsphere/filesystem",
      config: new Config({
        directory: area === "current" ? runsRoot : join(archiveRoot, "runs"),
        ...(kind === "activityLog" ? { contentTypeExtensions: { "application/x-ndjson": [".acp.jsonl"] } } : {})
      })
    })))
  });
  hosts.set(runsRoot, { manager, area: "current", archiveRoot });
  hosts.set(resolve(archiveRoot, "runs"), { manager, area: "archive", archiveRoot });
  return manager;
}

export async function runDataStore(root: string, kind: RunDataKind): Promise<DataStore> {
  const key = resolve(root);
  if (!hosts.has(key)) prepareRunData({ runsRoot: key, archiveRoot: join(dirname(key), "archives") });
  const host = hosts.get(key)!;
  const store = await host.manager.getStore({}, `${runDataModels[kind]}/${host.area}`);
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
