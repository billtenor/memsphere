// @integration-platform: native — verifies configuration CAS and real package identity.
import { appSettingsFixture } from "./helpers/app-settings.js";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { businessFixture } from "./helpers/business-data.js";
import { projectPaths } from "../src/project/paths.js";
import { readBusinessProject } from "../src/project/business-stores.js";
import { checkApp, installApp, configureApp } from "../src/app/install.js";
import { appStatePath, readAppState, writeAppState, type AppProject } from "../src/app/state.js";
import { readAppSettings, previewAppSettings, listAppSettings } from "../src/app/settings.js";
import { appSettingsCompositions } from "../src/app/settings-composition.js";
import { appManifestSchema } from "../src/app/contracts.js";
import type { ProjectContext } from "../src/project/resolver.js";
test("configuration reads and previews never migrate legacy state; CAS/no-op/ABA protect edits", async (t) => {
    const { project, context } = await appSettingsFixture(t);
    const state = await readAppState(project);
    delete state.installations["example.app"].configurationRevision;
    await writeAppState(project, state);
    const file = appStatePath(project), before = await readFile(file, "utf8");
    const a = await readAppSettings(project, "example.app");
    assert.equal(a.enabled, false);
    await previewAppSettings(project, a.id, a.config, a.revision);
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await listAppSettings(project))[0].id, a.id);
    const noop = await configureApp(context, a.id, a.config, context.primary, { expectedRevision: a.revision });
    assert.equal(noop.revision, a.revision);
    assert.equal(await readFile(file, "utf8"), before);
    const b = await configureApp(context, a.id, { ...a.config, name: "B" }, context.primary, { expectedRevision: a.revision });
    assert.notEqual(b.revision, a.revision);
    await assert.rejects(configureApp(context, a.id, b.config, context.primary, { expectedRevision: a.revision }), { code: "APP_CONFIG_CONFLICT" });
    const again = await configureApp(context, a.id, a.config);
    assert.notEqual(again.revision, a.revision);
    assert.notEqual(again.revision, b.revision);
    const committed = await readFile(file, "utf8");
    await assert.rejects(previewAppSettings(project, a.id, { name: "A", store: "missing" }, again.revision));
    await assert.rejects(configureApp(context, a.id, { name: 123, store: "first" }));
    assert.equal(await readFile(file, "utf8"), committed);
    assert.deepEqual((await readAppSettings(project, a.id)).config.untouched, { extra: true });
});
test("two simultaneous App saves accept one revision exactly once", async (t) => {
    const { project, context } = await appSettingsFixture(t);
    const a = await readAppSettings(project, "example.app");
    const results = await Promise.allSettled(["B", "C"].map(name => configureApp(context, a.id, { ...a.config, name }, context.primary, { expectedRevision: a.revision })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "APP_CONFIG_CONFLICT");
});
test("disabled Apps share a settings package through distinct bound instances; ambiguous Home identity rejects every owner", async (t) => {
    const { project, context, root, manifest } = await appSettingsFixture(t, true);
    await writeFile(join(root, "app.json"), JSON.stringify({ ...manifest, id: "second.app" }));
    await installApp(context, root, { name: "Second", store: "first" });
    const resolved = await appSettingsCompositions(project, []);
    assert.equal(resolved.result.length, 2);
    assert.equal(resolved.diagnostics.length, 0);
    assert.notEqual(resolved.result[0].composition.instances[0].instanceId, resolved.result[1].composition.instances[0].instanceId);
    const home = join(root, "home-settings");
    await mkdir(home);
    await writeFile(join(home, "module.json"), await readFile(join(root, "settings/module.json")));
    await writeFile(join(home, "index.js"), "export default {different:true};");
    const conflict = await appSettingsCompositions(project, [home]);
    assert.equal(conflict.result.length, 0);
    assert.equal(conflict.diagnostics.length, 2);
});
test("settings entrypoint must reference a declared View Package", () => {
    const base = { schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", entrypoints: { settings: { packageKey: "missing" } } };
    assert.equal(appManifestSchema.safeParse(base).success, false);
});

test("settings SDK compatibility is checked before any Plugin import",async t=>{
 const {project}=await appSettingsFixture(t,"incompatible");
 project.config.store={type:"embedded",repository_path:project.paths.root,memory_path:"memory"};
 await writeFile(project.paths.configPath,JSON.stringify(project.config));
 const check=await checkApp(project,"example.app");assert.equal(check.items.find(item=>item.name==="settings-view")?.available,false);const composition=await appSettingsCompositions(project,[]);assert.equal(composition.result[0].composition.instances.length,0);assert(composition.result[0].composition.diagnostics.some(item=>item.message?.includes("99.0.0")));
});
