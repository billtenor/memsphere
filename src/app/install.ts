import { listAppMemoryEntries } from "./ownership.js";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import semver from "semver";
import { createAppMemoryChange, publishMemoryChange, validateMemoryChange, withAppMemoryReservation } from "../memory/changeset.js";
import { validateMemoryRoot } from "../validation.js";
import { atomicWriteFile } from "../persistence.js";
import { gitOutputRaw } from "../git.js";
import { projectConfigSchema } from "../project/model.js";
import type { ProjectContext, ResolvedProject } from "../project/resolver.js";
import { AppError, cliBindingSchema } from "./contracts.js";
import { digest, isMissing, packageDigest, readJson } from "./files.js";
import { readAppPackage, resolveConfigValues, validateAppConfig } from "./package.js";
import { assertWritableAppTarget, readAppState, requireApp, withAppLock, writeAppState, type AppInstallation, type AppProject } from "./state.js";
import { checkCli, cliCatalog } from "../tools/registry.js";
import { DefaultMemoryCatalog } from "../memory/catalog.js";
import { AppMemoryProvider } from "./memory-provider.js";
import { resolveViewPackageComposition } from "../module/package-registry.js";

function bindings(app: AppInstallation, project: AppProject): AppInstallation["bindings"] {
  const result: AppInstallation["bindings"] = {};
  for (const id of [...app.descriptors.map(d => d.id), ...app.manifest.dependencies.filter(d => d.kind === "cli").map(d => d.id)])
    result[id] = { schemaVersion: 1, cwd: project.paths.root };
  for (const binding of app.manifest.cliBindings) {
    const { cli, ...value } = binding;
    if (!Object.hasOwn(result, cli)) throw new AppError("CLI_NOT_IN_APP", `Undeclared CLI binding: ${cli}`);
    result[cli] = cliBindingSchema.parse({ schemaVersion: 1, cwd: project.paths.root, ...resolveConfigValues(value, app.config) as object });
    if (result[cli].cwd) result[cli].cwd = resolve(project.paths.root, result[cli].cwd!);
  }
  return result;
}
export async function installApp(context: ProjectContext, directory: string, config: unknown = {}, options: {
  target?: ResolvedProject; afterMemoryPublish?: () => Promise<void>;
} = {}) {
  const project = options.target ?? context.primary;
  assertWritableAppTarget(context, project);
  const pkg = await readAppPackage(directory);
  const configuration = await validateAppConfig(pkg.root, pkg.manifest, config);
  return withAppLock(project, async () => {
    const state = await readAppState(project);
    const installed = state.installations[pkg.manifest.id];
    if (installed) {
      if (installed.packageDigest !== pkg.packageDigest) throw new AppError("APP_ALREADY_INSTALLED", `App content differs: ${pkg.manifest.id}; installation does not upgrade`);
      for (const memory of installed.memories) if (digest(await readFile(resolve(project.memoryRoot, memory.path))) !== memory.digest)
        throw new AppError("APP_LOCAL_CHANGES", `Installed Memory was modified: ${memory.reference}`);
      if (JSON.stringify(installed.config) !== JSON.stringify(configuration)) throw new AppError("APP_CONFIG_CHANGED", "Use app configure to change installation configuration");
      return { id: pkg.manifest.id, status: "unchanged", enabled: installed.enabled };
    }
    const pending = state.operations[pkg.manifest.id];
    if (pending && pending.packageDigest !== pkg.packageDigest) throw new AppError("APP_PENDING_CONFLICT", "Retry with the same App contents");
    if (Object.keys(state.operations).some(id => id !== pkg.manifest.id)) throw new AppError("APP_INSTALL_PENDING", "Finish the pending App installation first");
    const { registry } = await cliCatalog(project);
    for (const descriptor of pkg.descriptors) if (registry.descriptors[descriptor.id] && JSON.stringify(registry.descriptors[descriptor.id]) !== JSON.stringify(descriptor))
      throw new AppError("CLI_CONFLICT", `Conflicting CLI descriptor: ${descriptor.id}`);
    const allModelRefs = new Map<string, string>();
    const packageIdentities = new Map<string, string>();
    const viewInstances = new Set<string>();
    for (const previous of Object.values(state.installations)) {
      const other = await readAppPackage(previous.packageRoot);
      for (const pack of other.models) for (const model of pack.definition.models)
        allModelRefs.set(model.modelRef, `${pack.definition.id}@${pack.definition.version}:${pack.digest}`);
      for (const [kind, packs] of [["model", other.models], ["view", other.views]] as const)
        for (const pack of packs) packageIdentities.set(`${kind}:${pack.definition.id}@${pack.definition.version}`, pack.digest);
      for (const v of previous.manifest.entrypoints.view) viewInstances.add(v.instanceId);
    }
    for (const [kind, packs] of [["model", pkg.models], ["view", pkg.views]] as const) for (const pack of packs) {
      const key = `${kind}:${pack.definition.id}@${pack.definition.version}`;
      if (packageIdentities.has(key) && packageIdentities.get(key) !== pack.digest) throw new AppError("APP_PACKAGE_CONFLICT", `Different content for ${key}`);
      packageIdentities.set(key, pack.digest);
    }
    const { createProjectModelHost } = await import("../project/models.js");
    const existingHost = await createProjectModelHost({}, { root: project.paths.root, memoryRoot: project.memoryRoot,
      modelsDirectory: project.config.modelsDirectory, modelRegistration: project.config.modelRegistration });
    const existingModels = new Set((await existingHost.list()).map(model => model.id));
    for (const pack of pkg.models) for (const model of pack.definition.models) {
      const identity = `${pack.definition.id}@${pack.definition.version}:${pack.digest}`;
      if (allModelRefs.has(model.modelRef) ? allModelRefs.get(model.modelRef) !== identity : existingModels.has(model.modelRef))
        throw new AppError("APP_MODEL_CONFLICT", `Duplicate modelRef: ${model.modelRef}`);
      allModelRefs.set(model.modelRef, identity);
    }
    for (const view of pkg.manifest.entrypoints.view) if (viewInstances.has(view.instanceId)) throw new AppError("APP_VIEW_CONFLICT", `Duplicate View instance: ${view.instanceId}`);
    for (const memory of pkg.memories) {
      const current = await readFile(resolve(project.memoryRoot, memory.path)).catch(error => { if (isMissing(error)) return undefined; throw error; });
      if (current && (!pending || digest(current) !== memory.digest)) throw new AppError("APP_MEMORY_CONFLICT", `Memory target exists or changed: ${memory.path}`);
    }
    // Validate the complete effective Store before reserving or publishing anything.
    const staging = await mkdtemp(resolve(tmpdir(), "memsphere-app-candidate-"));
    try {
      await cp(project.memoryRoot, staging, { recursive: true, filter: path => !path.endsWith("/.git") });
      for (const memory of pkg.memories) await atomicWriteFile(resolve(staging, memory.path), memory.source.toString("utf8"));
      const validation = await validateMemoryRoot(staging);
      if (validation.issues.length) throw new AppError("APP_MEMORY_INVALID", "App conflicts with the effective Project Memory", validation.issues);
    } finally { await rm(staging, { recursive: true, force: true }); }
    const cache = resolve(context.home, "apps", "cache", pkg.packageDigest);
    try {
      await mkdir(dirname(cache), { recursive: true });
      await cp(pkg.root, cache, { recursive: true, force: false, errorOnExist: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ERR_FS_CP_EEXIST" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (await packageDigest(cache) !== pkg.packageDigest) throw new AppError("APP_CACHE_INVALID", "Cached App content does not match its digest");
    const operation = pending ?? { id: randomUUID(), packageDigest: pkg.packageDigest, memories: pkg.memories.map(({ source, ...m }) => m) };
    const app: AppInstallation = { manifest: pkg.manifest, packageDigest: pkg.packageDigest, packageRoot: cache,
      installedAt: new Date().toISOString(), enabled: false, config: configuration, memories: operation.memories,
      descriptors: pkg.descriptors, bindings: {}, operationId: operation.id };
    app.bindings = bindings(app, project);
    await withAppMemoryReservation(project, async () => {
      // A regular Memory publish may have completed during package preparation.
      // Reserve only after rechecking its result under the shared mutation lock.
      for (const memory of pkg.memories) {
        const current = await readFile(resolve(project.memoryRoot, memory.path)).catch(error => { if (isMissing(error)) return undefined; throw error; });
        if (current && (!pending || digest(current) !== memory.digest)) throw new AppError("APP_MEMORY_CONFLICT", `Memory target changed before reservation: ${memory.path}`);
      }
      state.operations[pkg.manifest.id] = operation;
      await writeAppState(project, state);
    });
    try {
      if (pkg.memories.length) {
        if (!operation.changeId) {
          const change = await createAppMemoryChange({ appId: pkg.manifest.id, operationId: operation.id,
            context, ownership: Object.fromEntries(app.memories.map(memory => [memory.path, {
              id: app.manifest.id, version: app.manifest.version, assetKey: memory.key, enabled: false, packageDigest: app.packageDigest
            }])),
            packageDigest: pkg.packageDigest, targets: pkg.memories });
          operation.changeId = change.id;
          await writeAppState(project, state);
        }
        let allApplied = true;
        const publicationConfig = projectConfigSchema.parse(await readJson(project.paths.configPath));
        for (const memory of pkg.memories) {
          const current = await readFile(resolve(project.memoryRoot, memory.path)).catch(error => { if (isMissing(error)) return undefined; throw error; });
          if (!current || digest(current) !== memory.digest) allApplied = false;
          if (publicationConfig.store.type === "managed") {
            try { if (digest(await gitOutputRaw(["show", `${publicationConfig.store.published_revision}:${memory.path}`], project.memoryRoot)) !== memory.digest) allApplied = false; }
            catch { allApplied = false; }
          }
        }
        if (!allApplied) {
          const validated = await validateMemoryChange(operation.changeId, { context });
          if (validated.issues.length) throw new AppError("APP_MEMORY_INVALID", "App ChangeSet failed validation", validated.issues);
          await publishMemoryChange(operation.changeId, undefined, { context });
        }
        app.changeId = operation.changeId;
      }
      await options.afterMemoryPublish?.();
      for (const memory of app.memories) if (digest(await readFile(resolve(project.memoryRoot, memory.path))) !== memory.digest)
        throw new AppError("APP_MEMORY_CONFLICT", `Memory changed before installation commit: ${memory.path}`);
      const currentConfig = projectConfigSchema.parse(await readJson(project.paths.configPath));
      if (currentConfig.store.type === "managed") app.memoryRevision = currentConfig.store.published_revision;
      state.installations[pkg.manifest.id] = app;
      delete state.operations[pkg.manifest.id];
      await writeAppState(project, state);
      return { id: pkg.manifest.id, version: pkg.manifest.version, status: "installed", enabled: false, next: `memsphere --project ${project.name} app enable ${pkg.manifest.id}` };
    } catch (error) {
      const actual = await readAppState(project);
      if (actual.installations[pkg.manifest.id]?.operationId === operation.id) return { id: pkg.manifest.id, status: "installed", enabled: false, diagnostic: String(error) };
      if (actual.operations[pkg.manifest.id]) {
        actual.operations[pkg.manifest.id].error = String(error);
        await writeAppState(project, actual);
      }
      throw error;
    }
  });
}
export async function checkApp(project: AppProject, id: string) {
  const state = await readAppState(project), app = requireApp(state, id);
  const items: Array<{ name: string; available: boolean; message?: string }> = [];
  const add = (name: string, available: boolean, message?: string) => items.push({ name, available, message });
  add("package", await packageDigest(app.packageRoot) === app.packageDigest);
  const packages = [] as Awaited<ReturnType<typeof readAppPackage>>[];
  for (const installed of Object.values(state.installations)) {
    try { packages.push(await readAppPackage(installed.packageRoot)); }
    catch (error) { if (installed.manifest.id === id) { add("package", false, String(error)); return { id, status: "unavailable", items }; } }
  }
  const catalog = new DefaultMemoryCatalog(new AppMemoryProvider(project.paths.root, project.memoryRoot));
  const entries = await listAppMemoryEntries(catalog);
  for (const entry of app.manifest.entrypoints.agent) {
    try {
      const asset = app.memories.find(memory => memory.reference === entry);
      const current = asset ? entries.find(item => item.app?.id === id && item.app.assetKey === asset.key)?.reference : entry;
      if (!current) throw new AppError("APP_MEMORY_MISSING", `Missing entrypoint: ${entry}`);
      await catalog.resolve(current); add(`entrypoint:${entry}`, true);
    }
    catch (error) { add(`entrypoint:${entry}`, false, String(error)); }
  }
  for (const memory of app.memories) {
    try { await readFile(resolve(project.memoryRoot, memory.path)); add(memory.reference, true); }
    catch (error) { if (!isMissing(error)) throw error; add(memory.reference, false); }
  }
  for (const dependency of app.manifest.dependencies.filter(d => d.kind === "app")) {
    const target = state.installations[dependency.id];
    add(`app:${dependency.id}`, Boolean(target?.enabled && (!dependency.version || semver.satisfies(target.manifest.version, dependency.version))));
  }
  for (const dependency of app.manifest.dependencies.filter(d => !["app", "cli"].includes(d.kind))) {
    try {
      if (dependency.kind === "memory") { await catalog.resolve(dependency.id); add(`memory:${dependency.id}`, true); continue; }
      const candidates = packages.flatMap<{ id: string; version: string }>(pkg => dependency.kind === "modelPackage" ? pkg.models.map(m => m.definition)
        : dependency.kind === "viewPackage" ? pkg.views.map(v => v.definition) : pkg.manifest.assets.dataExtensions);
      if (dependency.kind === "dataExtension") {
        const builtins = await import("../data/extensions/index.js");
        candidates.push(builtins.filesystemDataStoreExtension, builtins.filesystemJsonValueStoreExtension,
          builtins.jsonSchemaExtension, builtins.jsonSchemaMetaModelExtension, builtins.jsonSerializerExtension, builtins.rawExtension);
      }
      const found = candidates.find(candidate => candidate.id === dependency.id && (!dependency.version || semver.satisfies(candidate.version, dependency.version)));
      add(`${dependency.kind}:${dependency.id}`, Boolean(found));
    } catch (error) { add(`${dependency.kind}:${dependency.id}`, false, String(error)); }
  }
  try {
    await (await import("./backend.js")).loadAppBackend(app);
    const { createProjectModelHost } = await import("../project/models.js");
    const host = await createProjectModelHost({}, { root: project.paths.root, memoryRoot: project.memoryRoot,
      modelsDirectory: project.config.modelsDirectory, modelRegistration: project.config.modelRegistration, enableApp: id });
    const own = packages.find(pkg => pkg.manifest.id === id)!;
    for (const pack of own.models) for (const dependency of pack.definition.dependencies ?? [])
      add(`modelPackage:${dependency.id}`, packages.some(pkg => pkg.models.some(m => m.definition.id === dependency.id
        && (!dependency.version || semver.satisfies(m.definition.version, dependency.version)))));
    for (const model of own.models.flatMap(pkg => pkg.definition.models)) await host.manager.getRuntime({}, model.modelRef);
    for (const store of app.manifest.stores) await host.manager.getStore({}, `apps/${id}/${store.key}`);
    add("models-and-stores", true);
    if (own.views.length) {
      const view = await resolveViewPackageComposition({ global: { installed: own.views.map(v => ({ path: v.path })) },
        composition: { packages: app.manifest.entrypoints.view.map(entry => {
          const v = own.views.find(v => v.key === entry.packageKey)!;
          return { id: v.definition.id, version: v.definition.version, enabled: true, instance_id: entry.instanceId };
        }) }, sdkVersion: "1.0.0" });
      add("view", view.instances.length === app.manifest.entrypoints.view.length && view.diagnostics.every(d => d.state === "resolved"), JSON.stringify(view.diagnostics));
    }
  } catch (error) { add("composition", false, String(error)); }
  for (const cli of Object.keys(app.bindings)) {
    try { const check = await checkCli(project, cli, id, { allowDisabled: true }); add(`cli:${cli}`, check.status === "available", JSON.stringify(check.items)); }
    catch (error) { add(`cli:${cli}`, false, String(error)); }
  }
  return { id, status: items.every(i => i.available) ? "available" : "unavailable", items };
}
export async function configureApp(context: ProjectContext, id: string, config: unknown, target = context.primary) {
  assertWritableAppTarget(context, target);
  return withAppLock(target, async () => {
    const state = await readAppState(target), app = requireApp(state, id);
    app.config = await validateAppConfig(app.packageRoot, app.manifest, config);
    app.bindings = bindings(app, target);
    for (const [key, binding] of Object.entries(app.bindingOverrides ?? {})) if (app.bindings[key]) app.bindings[key] = { ...app.bindings[key], ...binding };
    await writeAppState(target, state);
    return { id, status: "configured", restartRequired: Boolean(app.manifest.backend || app.manifest.entrypoints.view.length) };
  });
}
export async function setAppEnabled(context: ProjectContext, id: string, enabled: boolean, target = context.primary) {
  assertWritableAppTarget(context, target);
  return withAppLock(target, async () => {
    const state = await readAppState(target), app = requireApp(state, id);
    if (enabled) { const check = await checkApp(target, id); if (check.status !== "available") throw new AppError("APP_NOT_READY", "App dependencies are not ready", check); }
    app.enabled = enabled;
    await writeAppState(target, state);
    return { id, enabled, restartRequired: Boolean(app.manifest.backend || app.manifest.entrypoints.view.length) };
  });
}
