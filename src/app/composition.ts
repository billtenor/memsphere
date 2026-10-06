import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Config, type JsonObject } from "../data/api/config.js";
import type { DataExtension } from "../data/api/extension.js";
import type { StoreBinding } from "../data/management/data-manager.js";
import { projectConfigSchema } from "../project/model.js";
import { projectPaths } from "../project/paths.js";
import { AppError } from "./contracts.js";
import { digest, isMissing, packagePath, readJson } from "./files.js";
import { readAppPackage, resolveConfigValues } from "./package.js";
import { readAppState, type AppProject } from "./state.js";
import type { MemsphereConfig } from "../config.js";

export async function appProjectFromRoot(root: string, memoryRoot?: string): Promise<AppProject | undefined> {
  const paths = projectPaths(root);
  try {
    // Model-only hosts also use this API; a Project config is needed only once App state exists.
    await stat(resolve(root, "apps"));
    const config = projectConfigSchema.parse(await readJson(paths.configPath));
    return { name: root, config, paths, memoryRoot: memoryRoot ?? (config.store.type === "managed" ? paths.memoryRoot : resolve(config.store.repository_path, config.store.memory_path)) };
  } catch (error) { if (isMissing(error)) return undefined; throw error; }
}
export async function appDataComposition(project: AppProject | undefined, enableApp?: string) {
  const models = new Map<string, { source: string; metaModel: string; appId: string; enabled: boolean; packageId: string }>();
  const extensions = new Map<string, DataExtension>();
  const modelIdentities = new Map<string, string>();
  const extensionIdentities = new Map<string, string>();
  const stores: StoreBinding[] = [];
  const unavailableApps: Array<{ appId: string; message: string }> = [];
  if (!project) return { models, extensions: [], stores, unavailableApps };
  const state = await readAppState(project);
  for (const app of Object.values(state.installations)) {
    let pkg: Awaited<ReturnType<typeof readAppPackage>>;
    try {
      pkg = await readAppPackage(app.packageRoot);
      if (pkg.packageDigest !== app.packageDigest) throw new AppError("APP_CACHE_INVALID", `Modified App cache: ${app.manifest.id}`);
    } catch (error) {
      if (app.manifest.id === enableApp) throw error;
      unavailableApps.push({ appId: app.manifest.id, message: String(error) });
      continue;
    }
    for (const pack of pkg.models) for (const definition of pack.definition.models) {
      const identity = `${pack.definition.id}@${pack.definition.version}:${pack.digest}`;
      if (models.has(definition.modelRef)) {
        if (modelIdentities.get(definition.modelRef) !== identity) throw new AppError("APP_MODEL_CONFLICT", `Duplicate model: ${definition.modelRef}`);
        continue;
      }
      modelIdentities.set(definition.modelRef, identity);
      models.set(definition.modelRef, { source: await readFile(await packagePath(pack.path, definition.path), "utf8"), metaModel: definition.metaModel,
        appId: app.manifest.id, enabled: app.enabled, packageId: pack.definition.id });
    }
    if (!app.enabled && app.manifest.id !== enableApp) continue;
    try {
      const stagedExtensions: Array<{ id: string; identity: string; extension: DataExtension }> = [];
      for (const entry of app.manifest.assets.dataExtensions) {
        const loaded: DataExtension = (await import(pathToFileURL(await packagePath(app.packageRoot, entry.entry)).href)).default;
        if (loaded?.id !== entry.id || loaded.version !== entry.version) throw new AppError("APP_EXTENSION_INVALID", `DataExtension export differs: ${entry.id}`);
        const identity = `${entry.version}:${digest(await readFile(resolve(app.packageRoot, entry.entry)))}`;
        if (extensions.has(entry.id) && extensionIdentities.get(entry.id) !== identity) throw new AppError("APP_EXTENSION_CONFLICT", `Conflicting DataExtension: ${entry.id}`);
        if (!extensions.has(entry.id)) stagedExtensions.push({ id: entry.id, identity, extension: loaded });
      }
      const stagedStores = app.manifest.stores.map(store => {
        const config = resolveConfigValues(store.config, app.config) as JsonObject;
        if (typeof config.directory === "string") config.directory = resolve(project.paths.root, config.directory);
        return { id: `apps/${app.manifest.id}/${store.key}`, model: store.model, kind: store.kind, factory: store.factory, config: new Config(config) };
      });
      for (const entry of stagedExtensions) { extensions.set(entry.id, entry.extension); extensionIdentities.set(entry.id, entry.identity); }
      stores.push(...stagedStores);
    } catch (error) {
      if (app.manifest.id === enableApp) throw error;
      unavailableApps.push({ appId: app.manifest.id, message: String(error) });
    }
  }
  return { models, extensions: [...extensions.values()], stores, unavailableApps };
}

export async function appViewComposition(config: MemsphereConfig) {
  const project = await appProjectFromRoot(resolve(config.configPath, ".."), config.memoryRoot);
  const global = structuredClone(config.viewPackages ?? { installed: [] });
  const composition = structuredClone(config.viewComposition ?? { packages: [] });
  const apps = new Map<string, string>();
  const packages = new Map<string, string>();
  const diagnostics: Array<{ state: "invalid"; message: string }> = [];
  if (!project) return { global, composition, apps, diagnostics };
  for (const app of Object.values((await readAppState(project)).installations)) {
    if (!app.enabled) continue;
    let pkg: Awaited<ReturnType<typeof readAppPackage>>;
    try { pkg = await readAppPackage(app.packageRoot);
    if (pkg.packageDigest !== app.packageDigest) throw new AppError("APP_CACHE_INVALID", `Modified App cache: ${app.manifest.id}`);
    } catch (error) { diagnostics.push({ state: "invalid", message: `App ${app.manifest.id}: ${String(error)}` }); continue; }
    try {
      for (const entry of app.manifest.entrypoints.view) {
        const view = pkg.views.find(view => view.key === entry.packageKey)!;
        const identity = `${view.definition.id}@${view.definition.version}`;
        if (packages.has(identity) && packages.get(identity) !== view.digest) throw new AppError("APP_PACKAGE_CONFLICT", `Different View content: ${identity}`);
        if (composition.packages.some(instance => (instance.instance_id ?? instance.id) === entry.instanceId)) throw new AppError("APP_VIEW_CONFLICT", `View instance already exists: ${entry.instanceId}`);
        resolveConfigValues(entry.config ?? {}, app.config);
      }
    } catch (error) { diagnostics.push({ state: "invalid", message: `App ${app.manifest.id}: ${String(error)}` }); continue; }
    for (const entry of app.manifest.entrypoints.view) {
      const view = pkg.views.find(view => view.key === entry.packageKey)!;
      const identity = `${view.definition.id}@${view.definition.version}`;
      if (packages.has(identity) && packages.get(identity) !== view.digest) throw new AppError("APP_PACKAGE_CONFLICT", `Different View content: ${identity}`);
      if (!packages.has(identity) && !global.installed.some(record => record.path === view.path)) global.installed.push({ path: view.path });
      packages.set(identity, view.digest);
      if (composition.packages.some(instance => (instance.instance_id ?? instance.id) === entry.instanceId))
        throw new AppError("APP_VIEW_CONFLICT", `View instance already exists: ${entry.instanceId}`);
      composition.packages.push({ id: view.definition.id, version: view.definition.version, enabled: true,
        instance_id: entry.instanceId, config: resolveConfigValues(entry.config ?? {}, app.config) as Record<string, unknown> });
      apps.set(entry.instanceId, app.manifest.id);
    }
  }
  return { global, composition, apps, diagnostics };
}
