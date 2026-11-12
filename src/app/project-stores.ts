import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { AppError } from "./contracts.js";
import type { AppInstallation, AppProject } from "./state.js";
import { getBusinessBinding, openBusinessStore } from "../project/business-stores.js";
import { ENTITIES, storeId } from "../context_control/model-assets.js";

export interface ProjectStoreBindingAdapters {
  getBinding: (root: string, id: string) => Promise<Pick<Awaited<ReturnType<typeof getBusinessBinding>>, "binding">>;
  openStore: (context: Parameters<typeof openBusinessStore>[0], root: string, id: string) => Promise<Pick<Awaited<ReturnType<typeof openBusinessStore>>, "store">>;
  realpath: (path: string) => Promise<string>;
}

/** Keep binding policy real while the registry/Store/path IO has explicit seams. */
export function createProjectStoreBindingResolver(adapters: ProjectStoreBindingAdapters) {
  return async function projectStoreBinding(project: AppProject, app: AppInstallation, key: string, signal?: AbortSignal) {
    const declaration = app.manifest.projectStores.find(item => item.key === key);
    if (!declaration) throw new AppError("APP_STORE_NOT_FOUND", `Undeclared Project Store: ${key}`);
    const id = app.config[declaration.configKey];
    if (typeof id !== "string" || !id.trim()) throw new AppError("APP_STORE_UNBOUND", `Missing Project Store binding: ${key}`);
    if (ENTITIES.some(entity => storeId(entity) === id)) throw new AppError("APP_STORE_FORBIDDEN", `System Store cannot be bound: ${id}`);
    const target = await adapters.getBinding(project.paths.root, id);
    if (target.binding.model !== declaration.model || (target.binding.kind === "value" ? "ValueStore" : "DataStore") !== declaration.kind)
      throw new AppError("APP_STORE_MISMATCH", `Incompatible Project Store: ${key} -> ${id}`);
    const opened = await adapters.openStore({ signal }, project.paths.root, id);
    const token = createHash("sha256").update(JSON.stringify([await adapters.realpath(project.paths.root), await adapters.realpath(project.memoryRoot), app.manifest.id, key, app.projectStoreGenerations?.[key] ?? "legacy", id, target.binding.registrationId ?? "legacy", declaration.model, declaration.kind])).digest("hex");
    return { storeId: id, token, store: opened.store };
  };
}

export const projectStoreBinding = createProjectStoreBindingResolver({
  getBinding: getBusinessBinding, openStore: openBusinessStore, realpath: path => realpath(path)
});

export async function validateProjectStores(project: AppProject, app: AppInstallation, allowUnbound = false) {
  for (const declaration of app.manifest.projectStores) {
    const value = app.config[declaration.configKey];
    if (allowUnbound && value === undefined) continue;
    await projectStoreBinding(project, app, declaration.key);
  }
}

export function updateProjectStoreGenerations(app: AppInstallation, priorConfig: Record<string, unknown> = {}) {
  const next = { ...app.projectStoreGenerations };
  for (const declaration of app.manifest.projectStores) {
    if (!next[declaration.key] || priorConfig[declaration.configKey] !== app.config[declaration.configKey]) next[declaration.key] = randomUUID();
  }
  app.projectStoreGenerations = next;
}
