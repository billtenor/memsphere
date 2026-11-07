import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bundledReservedModelsRoot, readReservedModelCatalog, type ReservedModelManifest } from "../src/reserved/models.js";

function fixture(run: (root: string, manifest: ReservedModelManifest, save: () => void) => void): void {
  const root = mkdtempSync(join(tmpdir(), "reserved-models-"));
  try {
    cpSync(bundledReservedModelsRoot(), root, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as ReservedModelManifest;
    run(root, manifest, () => writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest)));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Different model identities may share one source asset without adding duplicate source files", () => fixture((root, manifest, save) => {
  const order = structuredClone(manifest.market_packages[0]!.models[1]!);
  order.registration = { ...order.registration, modelRef: "fixture/shared-order.json", package: "fixture.shared", package_name: "Shared source fixture" };
  manifest.market_packages.push({ id: "fixture.shared", name: "Shared source fixture", description: "Exercises source reuse", models: [order] });
  save();
  const catalog = readReservedModelCatalog(root);
  assert.equal(catalog.marketPackages[0]!.models[1]!.sourcePath, catalog.marketPackages[1]!.models[0]!.sourcePath);
  assert.equal(catalog.marketPackages[0]!.models[1]!.source, catalog.marketPackages[1]!.models[0]!.source);
}));

test("Catalog reads preserve UTF-8 BOM, whitespace and line endings without sharing mutable returned values", () => fixture((root, manifest) => {
  const path = join(root, manifest.market_packages[0]!.models[0]!.source);
  const source = `\uFEFF \r\n${readFileSync(path, "utf8")} \r\n`;
  writeFileSync(path, source);
  const catalog = readReservedModelCatalog(root);
  assert.equal(catalog.marketPackages[0]!.models[0]!.source, source);
  catalog.marketPackages[0]!.models[0]!.registration.name = "changed";
  assert.notEqual(readReservedModelCatalog(root).marketPackages[0]!.models[0]!.registration.name, "changed");
}));

test("Catalog gate rejects missing or unlisted sources, duplicated identities and unsupported manifest fields", () => {
  fixture((root, manifest) => { rmSync(join(root, manifest.market_packages[0]!.models[0]!.source)); assert.throws(() => readReservedModelCatalog(root), /Missing.*asset/); });
  fixture(root => { writeFileSync(join(root, "market-models/unlisted.json"), "{}"); assert.throws(() => readReservedModelCatalog(root), /missing from manifest/); });
  fixture((root, manifest, save) => { manifest.system_models.push(manifest.system_models[0]!); save(); assert.throws(() => readReservedModelCatalog(root), /Duplicate bundled modelRef/); });
  fixture((root, manifest, save) => { manifest.market_packages.push(manifest.market_packages[0]!); save(); assert.throws(() => readReservedModelCatalog(root), /Duplicate model market package/); });
  fixture((root, manifest) => { writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...manifest, version: 2 })); assert.throws(() => readReservedModelCatalog(root)); });
  fixture((root, manifest) => { writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...manifest, unknown: true })); assert.throws(() => readReservedModelCatalog(root)); });
});

test("Catalog gate rejects malformed definitions and inconsistent package or model storage bindings", () => {
  fixture((root, manifest) => { writeFileSync(join(root, manifest.market_packages[0]!.models[0]!.source), '{"required":42}'); assert.throws(() => readReservedModelCatalog(root), /Invalid JSON Schema/); });
  fixture((root, manifest) => { writeFileSync(join(root, manifest.market_packages[0]!.models[0]!.source), 'true'); assert.throws(() => readReservedModelCatalog(root), /must be an object/); });
  fixture((root, manifest) => { writeFileSync(join(root, manifest.market_packages[0]!.models[0]!.source), Buffer.from([0xff, 0xfe])); assert.throws(() => readReservedModelCatalog(root), /encoded data/); });
  fixture((root, manifest) => { writeFileSync(join(root, manifest.system_models[1]!.source), '{"type":"object"}'); assert.throws(() => readReservedModelCatalog(root), /Unsupported raw model/); });
  fixture((root, manifest, save) => { manifest.market_packages[0]!.models[0]!.registration.package = "different"; save(); assert.throws(() => readReservedModelCatalog(root), /Invalid bundled model package/); });
  fixture((root, manifest, save) => { manifest.system_models[0]!.registration.store_id = "models/system/raw"; save(); assert.throws(() => readReservedModelCatalog(root), /Store binding/); });
  fixture((root, manifest) => { writeFileSync(join(root, manifest.market_packages[0]!.models[0]!.source), '{"$ref":"examples/07-scalar-enum-root.json"}'); assert.throws(() => readReservedModelCatalog(root), { code: "MODEL_REFERENCE_UNSUPPORTED" }); });
});

test("Catalog asset paths reject traversal, source-category substitution and symlinks without following their targets", () => {
  fixture((root, manifest, save) => { manifest.market_packages[0]!.models[0]!.source = "../outside.json"; save(); assert.throws(() => readReservedModelCatalog(root), /portable/); });
  fixture((root, manifest, save) => { manifest.market_packages[0]!.models[0]!.source = "system-models/model-registration.json"; save(); assert.throws(() => readReservedModelCatalog(root), /Invalid market model asset/); });
  fixture((root, manifest) => {
    const path = join(root, manifest.market_packages[0]!.models[0]!.source);
    renameSync(path, `${path}.original`); symlinkSync(`${path}.original`, path);
    assert.throws(() => readReservedModelCatalog(root), /not a regular file/);
  });
  fixture(root => {
    const path = join(root, "market-models/examples");
    renameSync(path, `${path}-original`); symlinkSync(`${path}-original`, path, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => readReservedModelCatalog(root), /not a regular directory/);
  });
});

test("Home models are separately catalogued, reject collisions, bad paths and malformed sources", () => {
  const catalog = readReservedModelCatalog();
  assert.deepEqual(catalog.homeModels.map(m => m.id), ["memsphere/command-state.json", "memsphere/daemon-task.json"]);
  assert.ok(!catalog.systemModels.some(m => m.registration.modelRef === "memsphere/command-state.json"));
  fixture((root, manifest, save) => { manifest.home_models.push(manifest.home_models[0]); save(); assert.throws(() => readReservedModelCatalog(root), /Duplicate/); });
  fixture((root, manifest, save) => { manifest.home_models[0].id = manifest.system_models[0].registration.modelRef; save(); assert.throws(() => readReservedModelCatalog(root), /Duplicate/); });
  fixture((root, manifest, save) => { manifest.home_models[0].source = "../outside.json"; save(); assert.throws(() => readReservedModelCatalog(root)); });
  fixture((root, manifest) => { writeFileSync(join(root, manifest.home_models[0].source), "{"); assert.throws(() => readReservedModelCatalog(root)); });
});
