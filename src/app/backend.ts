import { pathToFileURL } from "node:url";
import { AppError } from "./contracts.js";
import { packageDigest, packagePath } from "./files.js";
import { readAppState, requireApp, type AppProject, type AppInstallation } from "./state.js";
import type { AppBackend } from "./index.js";
import { createProjectModelHost } from "../project/models.js";

export async function loadAppBackend(app: AppInstallation): Promise<AppBackend | undefined> {
  const spec = app.manifest.backend;
  if (!spec) return undefined;
  if (await packageDigest(app.packageRoot) !== app.packageDigest) throw new AppError("APP_CACHE_INVALID", `Modified App cache: ${app.manifest.id}`);
  const backend: AppBackend = (await import(pathToFileURL(await packagePath(app.packageRoot, spec.entry)).href)).default;
  if (!backend?.operations || Object.keys(backend.operations).sort().join("\0") !== Object.keys(spec.operations).sort().join("\0"))
    throw new AppError("APP_BACKEND_INVALID", "Backend operations do not match the manifest");
  for (const [name, entry] of Object.entries(backend.operations)) if (entry.kind !== spec.operations[name] || typeof entry.execute !== "function")
    throw new AppError("APP_BACKEND_INVALID", `Invalid backend operation: ${name}`);
  return backend;
}
export async function invokeAppOperation(project: AppProject, id: string, operation: string, input: unknown, signal?: AbortSignal) {
  const app = requireApp(await readAppState(project), id);
  if (!app.enabled) throw new AppError("APP_DISABLED", `App is disabled: ${id}`);
  const spec = app.manifest.backend;
  if (!spec || !Object.hasOwn(spec.operations, operation)) throw new AppError("APP_OPERATION_NOT_FOUND", `Undeclared operation: ${operation}`);
  const backend = (await loadAppBackend(app))!;
  const current = requireApp(await readAppState(project), id);
  if (!current.enabled) throw new AppError("APP_DISABLED", `App is disabled: ${id}`);
  const host = await createProjectModelHost({ signal }, { root: project.paths.root, memoryRoot: project.memoryRoot,
    modelsDirectory: project.config.modelsDirectory, modelRegistration: project.config.modelRegistration });
  return backend.operations[operation].execute({ project: project.name, app: id, config: Object.freeze(structuredClone(app.config)), signal,
    getStore: async key => {
      if (!app.manifest.stores.some(store => store.key === key)) throw new AppError("APP_STORE_NOT_FOUND", `Undeclared Store: ${key}`);
      return host.manager.getStore({ signal }, `apps/${id}/${key}`);
    }
  }, input);
}
