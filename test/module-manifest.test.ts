import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { builtinModuleCatalog } from "../src/module/builtin-catalog.js";
import {
  isViewSdkCompatible,
  parseModuleManifest,
  resolveModuleViewEntry
} from "../src/module/manifest.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("Builtin Catalog declares four immutable and uniquely identified Modules", () => {
  assert.deepEqual(
    builtinModuleCatalog.map(entry => entry.moduleId),
    ["org.memsphere.memory", "org.memsphere.run", "org.memsphere.reference", "org.memsphere.settings"]
  );
  assert.equal(new Set(builtinModuleCatalog.map(entry => entry.instanceId)).size, 4);
  assert.equal(Object.isFrozen(builtinModuleCatalog), true);
  assert.equal(builtinModuleCatalog.every(entry => Object.isFrozen(entry.routes)), true);

  const market = builtinModuleCatalog[0].routes.find(route => route.id === "market");
  assert.equal(market?.path, "/market");
  assert.deepEqual(market?.aliases, ["/memory-market"]);
});

test("Builtin Manifests use the minimum View contract and match their Catalog identity", async () => {
  for (const catalogEntry of builtinModuleCatalog) {
    const manifestPath = resolve(repositoryRoot, "modules", catalogEntry.packageDirectory, "module.json");
    const manifest = parseModuleManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    assert.equal(manifest.id, catalogEntry.moduleId);
    assert.equal(manifest.view.entry, "./dist/view/index.js");
    assert.equal(isViewSdkCompatible(manifest, "1.0.0"), true);
    assert.equal(isViewSdkCompatible(manifest, "2.0.0"), false);
  }
});

test("Manifest parser rejects invalid SemVer, unknown fields, and unsafe View entries", () => {
  const valid = {
    schemaVersion: 1,
    id: "com.example.module",
    version: "1.2.3",
    view: { entry: "./dist/view/index.js", sdk: "^1.0.0" }
  };
  assert.equal(parseModuleManifest(valid).id, valid.id);

  for (const candidate of [
    { ...valid, version: "latest" },
    { ...valid, view: { ...valid.view, sdk: "not a range" } },
    { ...valid, view: { ...valid.view, entry: "/tmp/plugin.js" } },
    { ...valid, view: { ...valid.view, entry: "../plugin.js" } },
    { ...valid, view: { ...valid.view, entry: "./dist/../plugin.js" } },
    { ...valid, unexpected: true }
  ]) {
    assert.throws(() => parseModuleManifest(candidate));
  }
});

test("View entry resolution remains inside the Module package", () => {
  const root = resolve(repositoryRoot, "modules", "org.memsphere.memory");
  const manifest = parseModuleManifest({
    schemaVersion: 1,
    id: "org.memsphere.memory",
    version: "0.1.2",
    view: { entry: "./dist/view/index.js", sdk: "^1.0.0" }
  });
  assert.equal(resolveModuleViewEntry(root, manifest), resolve(root, "dist/view/index.js"));
});

test("View asset build reads source contracts instead of depending on partially built dist files", async () => {
  const script = await readFile(resolve(repositoryRoot, "scripts/build-view-assets.mjs"), "utf8");
  const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")) as {
    scripts?: { build?: string };
  };

  assert.match(script, /src\/module\/builtin-catalog\.ts/);
  assert.match(script, /src\/module\/manifest\.ts/);
  assert.doesNotMatch(script, /dist\/module\/(?:builtin-catalog|manifest)\.js/);
  assert.match(packageJson.scripts?.build ?? "", /node --import tsx scripts\/build-view-assets\.mjs/);
});
