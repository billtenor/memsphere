import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readReservedModelCatalog } from "../dist/reserved/models.js";

const catalog = readReservedModelCatalog();
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const path of ["reserved-models", "scripts/relocate-example-models.mjs"]) {
  assert.ok(manifest.files.includes(path), `Missing npm files entry: ${path}`);
}
await readFile(new URL("./relocate-example-models.mjs", import.meta.url));
await readFile(new URL("../dist/project/example-relocation.js", import.meta.url));
await readFile(new URL("../dist/project/example-relocation-baseline.js", import.meta.url));
console.log(`Reserved models validated: ${catalog.systemModels.length} system models, ${catalog.marketPackages.length} market packages.`);
