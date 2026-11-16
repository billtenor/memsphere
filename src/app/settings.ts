import type { AppSettingsStoreChoices } from "../view/app-settings-contracts.js";
import type { AppProject, AppInstallation } from "./state.js";
import { appConfigurationRevision, readAppState, requireApp } from "./state.js";
import { readAppPackage, validateAppConfig } from "./package.js";
import { AppError } from "./contracts.js";
import { packagePath, readJson } from "./files.js";
import { readBusinessProject } from "../project/business-stores.js";
import { projectStoreBinding, validateProjectStores } from "./project-stores.js";
import { withSharedStoreLock } from "../project/shared-store-lock.js";
export async function listAppSettings(project: AppProject) {
    return Object.values((await readAppState(project)).installations).map(app => ({ id: app.manifest.id, name: app.manifest.name, version: app.manifest.version, description: app.manifest.description, enabled: app.enabled, configurable: Boolean(app.manifest.configuration || app.manifest.entrypoints.settings || app.manifest.projectStores.length || Object.keys(app.config).length) }));
}
export async function appStoreChoices(project: AppProject, app: AppInstallation): Promise<AppSettingsStoreChoices[]> {
    const config = await readBusinessProject(project.paths.root);
    return Promise.all(app.manifest.projectStores.map(async (requirement) => {
        const candidates: string[] = [];
        for (const [id, binding] of Object.entries(config.dataStores ?? {})) {
            if (binding.model !== requirement.model || binding.kind !== (requirement.kind === "ValueStore" ? "value" : "data"))
                continue;
            const candidate = structuredClone(app);
            candidate.config[requirement.configKey] = id;
            try {
                await projectStoreBinding(project, candidate, requirement.key);
                candidates.push(id);
            }
            catch { /* Unavailable registrations are not selectable. */ }
        }
        let diagnostic: string | undefined;
        try {
            await projectStoreBinding(project, app, requirement.key);
        }
        catch (error) {
            diagnostic = String(error);
        }
        return { ...requirement, storeId: app.config[requirement.configKey] ?? null, candidates, ...(diagnostic ? { diagnostic } : {}) };
    }));
}
export async function readAppSettings(project: AppProject, id: string) {
    const app = requireApp(await readAppState(project), id);
    const pkg = await readAppPackage(app.packageRoot);
    if (pkg.packageDigest !== app.packageDigest)
        throw new AppError("APP_CACHE_INVALID", "Modified App package");
    return { id, name: app.manifest.name, version: app.manifest.version, enabled: app.enabled, config: app.config,
        revision: appConfigurationRevision(app), schema: app.manifest.configuration ? await readJson(await packagePath(app.packageRoot, app.manifest.configuration)) : null,
        projectStores: await appStoreChoices(project, app), customSettings: Boolean(app.manifest.entrypoints.settings),
        runtime: { state: "unknown", message: "Saved configuration is separate from the running View; restart may be required" },
        restartRequired: Boolean(app.manifest.backend || app.manifest.entrypoints.view.length), canWrite: true };
}
export async function previewAppSettings(project: AppProject, id: string, input: unknown, expectedRevision: string) {
    return withSharedStoreLock(project.paths.root, async () => {
        const app = requireApp(await readAppState(project), id);
        if (appConfigurationRevision(app) !== expectedRevision)
            throw new AppError("APP_CONFIG_CONFLICT", "App configuration changed; reload before editing");
        const pkg = await readAppPackage(app.packageRoot);
        if (pkg.packageDigest !== app.packageDigest)
            throw new AppError("APP_CACHE_INVALID", "Modified App package");
        const candidate = structuredClone(app);
        candidate.config = await validateAppConfig(app.packageRoot, app.manifest, input);
        await validateProjectStores(project, candidate);
        return { valid: true, config: candidate.config, revision: expectedRevision, restartRequired: Boolean(app.manifest.backend || app.manifest.entrypoints.view.length) };
    });
}
