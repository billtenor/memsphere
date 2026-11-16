import { join } from "node:path";
import { readAppState, type AppProject } from "./state.js";
import { readAppPackage } from "./package.js";
import { AppError } from "./contracts.js";
import { digest, packageDigest } from "./files.js";
import { readModuleManifest } from "../module/manifest.js";
import { resolveViewPackageComposition } from "../module/package-registry.js";
import { VIEW_SDK_VERSION } from "../view/view-sdk.js";
/** Resolve separately per App before contribution grouping: portable :app is not a global preference. */
export async function appSettingsCompositions(project: AppProject | undefined, homePaths: readonly string[]) {
    const result: Array<{
        appId: string;
        composition: Awaited<ReturnType<typeof resolveViewPackageComposition>>;
    }> = [];
    const diagnostics: Array<{
        appId: string;
        error: string;
    }> = [];
    if (!project)
        return { result, diagnostics };
    const identities = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const path of homePaths) {
        try {
            const manifest = await readModuleManifest(join(path, "module.json"));
            const key = `${manifest.id}@${manifest.version}`, hash = await packageDigest(path);
            if (identities.has(key) && identities.get(key) !== hash)
                ambiguous.add(key);
            identities.set(key, hash);
        }
        catch { /* Existing registry reports unavailable Home packages. */ }
    }
    const packages: Array<{
        appId: string;
        path: string;
        moduleId: string;
        version: string;
        hash: string;
    }> = [];
    for (const app of Object.values((await readAppState(project)).installations)) {
        const entry = app.manifest.entrypoints.settings;
        if (!entry)
            continue;
        try {
            const pkg = await readAppPackage(app.packageRoot);
            if (pkg.packageDigest !== app.packageDigest)
                throw new AppError("APP_CACHE_INVALID", "Modified App package");
            const settings = pkg.views.find(v => v.key === entry.packageKey)!;
            const identity = `${settings.definition.id}@${settings.definition.version}`;
            const old = identities.get(identity);
            if (ambiguous.has(identity) || old && old !== settings.digest) {
                ambiguous.add(identity);
                throw new AppError("APP_PACKAGE_CONFLICT", `Conflicting View package: ${identity}`);
            }
            identities.set(identity, settings.digest);
            packages.push({ appId: app.manifest.id, path: settings.path, moduleId: settings.definition.id, version: settings.definition.version, hash: settings.digest });
        }
        catch (e) {
            diagnostics.push({ appId: app.manifest.id, error: e instanceof Error ? e.message : String(e) });
        }
    }
    // A conflict affects every owner of the ambiguous package identity, never "first path wins".
    for (const pkg of packages) {
        if (ambiguous.has(`${pkg.moduleId}@${pkg.version}`)) {
            diagnostics.push({ appId: pkg.appId, error: `Conflicting View package: ${pkg.moduleId}@${pkg.version}` });
            continue;
        }
        const instanceId = `app-settings-${digest(pkg.appId).slice(0, 20)}`;
        const composition = await resolveViewPackageComposition({ global: { installed: [{ path: pkg.path }] }, composition: { packages: [{ id: pkg.moduleId, version: pkg.version, enabled: true, instance_id: instanceId, config: {} }] }, sdkVersion: VIEW_SDK_VERSION });
        result.push({ appId: pkg.appId, composition });
    }
    return { result, diagnostics };
}
